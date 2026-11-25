import { CLOSE, type ClientMessage, type ErrorCode, type ServerMessage } from "../shared/protocol";

const FATAL_ERROR_CLOSE: Partial<Record<ErrorCode, number>> = {
  not_found: CLOSE.notFound,
  full: CLOSE.full,
  bad_request: CLOSE.badRequest,
};

/** Close codes after which reconnecting makes no sense. */
const FINAL_CODES = new Set<number>([CLOSE.notFound, CLOSE.full, CLOSE.badRequest, CLOSE.replaced, CLOSE.left]);

export interface ConnectionHandlers {
  onOpen(): void;
  /** The connection dropped and we're trying again. */
  onDrop(): void;
  onMessage(msg: ServerMessage): void;
  /** The server ended the connection for good (see CLOSE codes). */
  onClosed(code: number): void;
}

/** A WebSocket to one room that reconnects on its own after network hiccups. */
export class RoomConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private retryTimer: number | undefined;

  constructor(
    private readonly code: string,
    private readonly token: string,
    private readonly handlers: ConnectionHandlers,
  ) {
    window.addEventListener("online", this.retryNow);
    document.addEventListener("visibilitychange", this.retryNow);
    this.open();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): boolean {
    if (!this.isOpen) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  /** Reconnect after a final close (e.g. take the seat back from another tab). */
  reconnect(): void {
    this.stopped = false;
    this.attempt = 0;
    this.open();
  }

  close(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    window.removeEventListener("online", this.retryNow);
    document.removeEventListener("visibilitychange", this.retryNow);
    this.ws?.close(1000, "bye");
    this.ws = null;
  }

  private open(): void {
    clearTimeout(this.retryTimer);
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/api/rooms/${this.code}/ws?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onOpen();
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data);
      } catch (err) {
        console.error("Bad message from server", err);
        return;
      }
      // A rejected join: the server's close frame doesn't always arrive, so stop here.
      if (msg.type === "error" && msg.fatal) {
        this.stopped = true;
        this.ws = null;
        ws.close(1000, "rejected");
        this.handlers.onClosed(FATAL_ERROR_CLOSE[msg.code] ?? CLOSE.badRequest);
        return;
      }
      this.handlers.onMessage(msg);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return; // an older socket we already replaced
      this.ws = null;
      if (this.stopped) return;
      if (FINAL_CODES.has(event.code)) {
        this.stopped = true;
        this.handlers.onClosed(event.code);
        return;
      }
      this.handlers.onDrop();
      const delay = Math.min(500 * 2 ** this.attempt++, 8000);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  /** Skip the backoff when the network or the tab comes back. */
  private retryNow = (): void => {
    if (this.stopped || document.visibilityState !== "visible") return;
    if (!this.ws) this.open();
  };
}
