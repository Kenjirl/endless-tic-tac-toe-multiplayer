import type { GameState, Side } from "./engine";

/** Room codes use an alphabet without look-alike characters (no I, O, 0, 1). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 4;
export const CODE_PATTERN = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

export function normalizeCode(input: string): string {
  return input.trim().toUpperCase();
}

/** A player who goes offline mid-game loses after this long. */
export const FORFEIT_MS = 60_000;

export type RoomStatus = "waiting" | "playing" | "finished";
export type EndReason = "line" | "forfeit" | "left";

export interface SeatView {
  /** Someone holds this seat. */
  taken: boolean;
  /** That player has an open connection right now. */
  online: boolean;
  /** Milliseconds until this player forfeits for being offline, if counting down. */
  forfeitInMs: number | null;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  game: GameState;
  endReason: EndReason | null;
  seats: Record<Side, SeatView>;
  rematch: Record<Side, boolean>;
  score: Record<Side, number>;
  /** The move that produced this state, so clients can play sounds/animations. */
  lastMove: { side: Side; cell: number; removed: number | null } | null;
}

export type ClientMessage =
  | { type: "move"; cell: number }
  | { type: "rematch" }
  | { type: "leave" };

export type ErrorCode =
  | "not_found"
  | "full"
  | "bad_request"
  | "not_playing"
  | "game_over"
  | "not_your_turn"
  | "occupied"
  | "invalid_cell";

export type ServerMessage =
  | { type: "state"; you: Side | null; room: RoomView }
  | { type: "error"; code: ErrorCode; fatal: boolean };

/** WebSocket close codes the server uses. Fatal ones mean "don't reconnect". */
export const CLOSE = {
  notFound: 4004,
  full: 4003,
  badRequest: 4000,
  replaced: 4001,
  left: 4002,
} as const;
