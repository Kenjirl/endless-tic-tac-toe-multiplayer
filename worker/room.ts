import { DurableObject } from "cloudflare:workers";
import { applyMove, newGame, otherSide, type GameState, type Side } from "../shared/engine";
import {
  CLOSE,
  FORFEIT_MS,
  type ClientMessage,
  type EndReason,
  type ErrorCode,
  type RoomStatus,
  type RoomView,
  type ServerMessage,
} from "../shared/protocol";

/** A room with nobody connected is deleted after this long. */
const IDLE_MS = 30 * 60_000;
const SIDES: Side[] = ["X", "O"];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

interface RoomData {
  code: string;
  /** Secret token of the player sitting on each side. */
  seats: Record<Side, string | null>;
  status: RoomStatus;
  game: GameState;
  endReason: EndReason | null;
  rematch: Record<Side, boolean>;
  score: Record<Side, number>;
  /** When each seated player lost their last connection. */
  offlineSince: Record<Side, number | null>;
  lastMove: RoomView["lastMove"];
  lastActivity: number;
}

interface Attachment {
  token: string;
}

/**
 * One instance per room code. Holds the authoritative game state, validates
 * every move, and broadcasts the result to both players over WebSockets.
 * Uses the WebSocket Hibernation API so idle rooms cost nothing.
 */
export class Room extends DurableObject<Env> {
  private room: RoomData | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomData>("room")) ?? null;
    });
  }

  /** Called by the Worker when a room is created. Returns false if the code is taken. */
  async create(code: string): Promise<boolean> {
    if (this.room) return false;
    this.room = {
      code,
      seats: { X: null, O: null },
      status: "waiting",
      game: newGame(),
      endReason: null,
      rematch: { X: false, O: false },
      score: { X: 0, O: 0 },
      offlineSince: { X: null, O: null },
      lastMove: null,
      lastActivity: Date.now(),
    };
    await this.persist();
    return true;
  }

  async fetch(request: Request): Promise<Response> {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    const room = this.room;
    if (!room) return this.reject(server, client, "not_found", CLOSE.notFound);
    if (!TOKEN_PATTERN.test(token)) return this.reject(server, client, "bad_request", CLOSE.badRequest);

    let side = this.sideOf(token);
    if (!side) {
      side = SIDES.find((s) => room.seats[s] === null) ?? null;
      if (!side) return this.reject(server, client, "full", CLOSE.full);
      room.seats[side] = token;
      room.score = { X: 0, O: 0 }; // new opponent, new score
      if (room.seats.X && room.seats.O && room.status !== "playing") this.startGame();
    }

    // One connection per player: a newer tab replaces the older one.
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== server && this.tokenOf(ws) === token) ws.close(CLOSE.replaced, "replaced");
    }
    server.serializeAttachment({ token } satisfies Attachment);
    room.offlineSince[side] = null;

    await this.persist();
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    const side = this.sideOf(this.tokenOf(ws));
    if (!room || !side) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.sendError(ws, "bad_request");
    }

    switch (msg.type) {
      case "move": {
        if (room.status !== "playing") return this.sendError(ws, "not_playing");
        const result = applyMove(room.game, side, msg.cell);
        if (!result.ok) return this.sendError(ws, result.error);
        room.game = result.state;
        room.lastMove = { side, cell: msg.cell, removed: result.removed };
        if (result.state.winner) this.finish(result.state.winner, "line");
        break;
      }
      case "rematch": {
        if (room.status !== "finished" || !room.seats.X || !room.seats.O) return;
        room.rematch[side] = true;
        if (room.rematch.X && room.rematch.O) {
          // Swap sides so both players get to move first.
          room.seats = { X: room.seats.O, O: room.seats.X };
          room.score = { X: room.score.O, O: room.score.X };
          room.offlineSince = { X: room.offlineSince.O, O: room.offlineSince.X };
          this.startGame();
        }
        break;
      }
      case "leave": {
        if (room.status === "playing" && room.seats[otherSide(side)]) {
          this.finish(otherSide(side), "left");
        }
        room.seats[side] = null;
        room.offlineSince[side] = null;
        room.rematch = { X: false, O: false };
        ws.close(CLOSE.left, "left");
        break;
      }
      default:
        return this.sendError(ws, "bad_request");
    }

    await this.persist();
    this.broadcast();
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  /** Runs forfeits for players who stayed offline too long, and deletes idle rooms. */
  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();

    for (const side of SIDES) {
      const since = room.offlineSince[side];
      if (since === null || now - since < FORFEIT_MS || this.isOnline(side)) continue;
      if (room.status === "playing" && room.seats[otherSide(side)]) {
        this.finish(otherSide(side), "forfeit");
      }
      // Free the seat so someone else can join with the code.
      room.seats[side] = null;
      room.offlineSince[side] = null;
      room.rematch = { X: false, O: false };
    }

    if (this.ctx.getWebSockets().length === 0 && now - room.lastActivity >= IDLE_MS) {
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }

    await this.persist();
    this.broadcast();
  }

  // --- helpers ---------------------------------------------------------------

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const room = this.room;
    const side = this.sideOf(this.tokenOf(ws));
    try {
      ws.close(1000, "bye");
    } catch {
      // already closed
    }
    if (!room || !side || this.isOnline(side, ws)) return;
    room.offlineSince[side] = Date.now();
    await this.persist();
    this.broadcast();
  }

  private startGame(): void {
    const room = this.room!;
    room.game = newGame();
    room.status = "playing";
    room.endReason = null;
    room.rematch = { X: false, O: false };
    room.lastMove = null;
  }

  private finish(winner: Side, reason: EndReason): void {
    const room = this.room!;
    room.status = "finished";
    room.endReason = reason;
    room.score[winner]++;
    if (!room.game.winner) room.game = { ...room.game, winner, winLine: null };
  }

  private async persist(): Promise<void> {
    const room = this.room!;
    room.lastActivity = Date.now();
    await this.ctx.storage.put("room", room);

    const deadlines = SIDES.map((s) => room.offlineSince[s])
      .filter((t): t is number => t !== null)
      .map((t) => t + FORFEIT_MS);
    await this.ctx.storage.setAlarm(Math.min(room.lastActivity + IDLE_MS, ...deadlines));
  }

  private tokenOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.token ?? null;
  }

  private sideOf(token: string | null): Side | null {
    if (!token || !this.room) return null;
    return SIDES.find((s) => this.room!.seats[s] === token) ?? null;
  }

  private isOnline(side: Side, except?: WebSocket): boolean {
    const token = this.room?.seats[side];
    if (!token) return false;
    return this.ctx
      .getWebSockets()
      .some((ws) => ws !== except && ws.readyState === WebSocket.OPEN && this.tokenOf(ws) === token);
  }

  private view(): RoomView {
    const room = this.room!;
    const now = Date.now();
    const seat = (side: Side) => {
      const since = room.offlineSince[side];
      return {
        taken: room.seats[side] !== null,
        online: this.isOnline(side),
        forfeitInMs: since === null ? null : Math.max(0, since + FORFEIT_MS - now),
      };
    };
    return {
      code: room.code,
      status: room.status,
      game: room.game,
      endReason: room.endReason,
      seats: { X: seat("X"), O: seat("O") },
      rematch: room.rematch,
      score: room.score,
      lastMove: room.lastMove,
    };
  }

  private broadcast(): void {
    if (!this.room) return;
    const room = this.view();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      const you = this.sideOf(this.tokenOf(ws));
      if (!you) continue;
      this.send(ws, { type: "state", you, room });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket went away; webSocketClose will handle it
    }
  }

  private sendError(ws: WebSocket, code: ErrorCode): void {
    this.send(ws, { type: "error", code, fatal: false });
  }

  private reject(server: WebSocket, client: WebSocket, code: ErrorCode, closeCode: number): Response {
    this.send(server, { type: "error", code, fatal: true });
    server.close(closeCode, code);
    return new Response(null, { status: 101, webSocket: client });
  }
}
