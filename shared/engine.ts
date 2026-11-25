/**
 * Pure game rules for Endless Tic-Tac-Toe, shared by the browser and the server.
 *
 * Rules (same as the original single-device game):
 * - X moves first, players alternate.
 * - Each player keeps at most LIMIT pieces on the board. Placing one more
 *   removes that player's oldest piece (FIFO).
 * - When a player has exactly LIMIT pieces, their oldest one is "fading":
 *   it will disappear on that player's next move.
 * - A player wins when their pieces form a line. Only the player who just
 *   moved can win, and the check happens after the oldest piece is removed.
 */

export type Side = "X" | "O";

export const LIMIT = 3;

export const WIN_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // horizontal
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // vertical
  [0, 4, 8], [2, 4, 6],            // diagonal
];

export interface GameState {
  board: (Side | null)[];
  /** Cells owned by each side, oldest first. */
  queue: Record<Side, number[]>;
  /** Number of moves made so far. Even = X to move, odd = O to move. */
  turn: number;
  winner: Side | null;
  winLine: number[] | null;
}

export type MoveError = "game_over" | "not_your_turn" | "occupied" | "invalid_cell";

export type MoveResult =
  | { ok: true; state: GameState; removed: number | null }
  | { ok: false; error: MoveError };

export function newGame(): GameState {
  return {
    board: Array<Side | null>(9).fill(null),
    queue: { X: [], O: [] },
    turn: 0,
    winner: null,
    winLine: null,
  };
}

export function otherSide(side: Side): Side {
  return side === "X" ? "O" : "X";
}

export function sideToMove(state: GameState): Side {
  return state.turn % 2 === 0 ? "X" : "O";
}

/** The cell of `side` that will disappear on its next move, if any. */
export function fadingCell(state: GameState, side: Side): number | null {
  const q = state.queue[side];
  return q.length === LIMIT ? q[0] : null;
}

export function applyMove(state: GameState, side: Side, cell: number): MoveResult {
  if (state.winner) return { ok: false, error: "game_over" };
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { ok: false, error: "invalid_cell" };
  if (sideToMove(state) !== side) return { ok: false, error: "not_your_turn" };
  if (state.board[cell] !== null) return { ok: false, error: "occupied" };

  const board = state.board.slice();
  const queue: Record<Side, number[]> = { X: state.queue.X.slice(), O: state.queue.O.slice() };

  board[cell] = side;
  queue[side].push(cell);

  let removed: number | null = null;
  if (queue[side].length > LIMIT) {
    removed = queue[side].shift()!;
    board[removed] = null;
  }

  let winner: Side | null = null;
  let winLine: number[] | null = null;
  if (queue[side].length === LIMIT) {
    const line = WIN_LINES.find((l) => l.every((c) => board[c] === side));
    if (line) {
      winner = side;
      winLine = [...line];
    }
  }

  return {
    ok: true,
    removed,
    state: { board, queue, turn: state.turn + 1, winner, winLine },
  };
}
