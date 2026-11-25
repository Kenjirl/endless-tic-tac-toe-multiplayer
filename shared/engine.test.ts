import { describe, expect, it } from "vitest";
import { applyMove, fadingCell, newGame, sideToMove, type GameState, type Side } from "./engine";

/** Play a list of cells, alternating X and O starting from X. */
function play(cells: number[], from: GameState = newGame()): GameState {
  let s = from;
  for (const cell of cells) {
    const r = applyMove(s, sideToMove(s), cell);
    if (!r.ok) throw new Error(`move ${cell} failed: ${r.error}`);
    s = r.state;
  }
  return s;
}

describe("engine", () => {
  it("starts empty with X to move", () => {
    const s = newGame();
    expect(s.board.every((c) => c === null)).toBe(true);
    expect(sideToMove(s)).toBe("X");
  });

  it("alternates turns", () => {
    const s = play([0]);
    expect(s.board[0]).toBe("X");
    expect(sideToMove(s)).toBe("O");
  });

  it("rejects moving out of turn, onto an occupied cell, or off the board", () => {
    const s = play([4]);
    expect(applyMove(s, "X", 0)).toEqual({ ok: false, error: "not_your_turn" });
    expect(applyMove(s, "O", 4)).toEqual({ ok: false, error: "occupied" });
    expect(applyMove(s, "O", 9)).toEqual({ ok: false, error: "invalid_cell" });
    expect(applyMove(s, "O", 1.5)).toEqual({ ok: false, error: "invalid_cell" });
  });

  it("does not mutate the input state", () => {
    const s = newGame();
    applyMove(s, "X", 0);
    expect(s.board[0]).toBeNull();
    expect(s.queue.X).toEqual([]);
  });

  it("marks the oldest piece as fading once a side has 3 pieces", () => {
    // X: 0, 1, 5   O: 3, 4
    const s = play([0, 3, 1, 4, 5]);
    expect(fadingCell(s, "X")).toBe(0);
    expect(fadingCell(s, "O")).toBeNull();
  });

  it("removes the oldest piece when a 4th is placed", () => {
    // X: 0, 1, 5, then 8 -> 0 disappears
    const s = play([0, 3, 1, 4, 5, 6, 8]);
    const r = s.board;
    expect(r[0]).toBeNull();
    expect(s.queue.X).toEqual([1, 5, 8]);
    expect(fadingCell(s, "X")).toBe(1);
    expect(s.board.filter((c) => c !== null)).toHaveLength(6);
  });

  it("reports the removed cell", () => {
    const s = play([0, 3, 1, 4, 5, 6]);
    const r = applyMove(s, "X", 8);
    expect(r.ok && r.removed).toBe(0);
  });

  it("detects a win", () => {
    // X: 0, 1, 2 -> top row
    const s = play([0, 3, 1, 4, 2]);
    expect(s.winner).toBe("X");
    expect(s.winLine).toEqual([0, 1, 2]);
    expect(applyMove(s, "O", 5)).toEqual({ ok: false, error: "game_over" });
  });

  it("checks the win after removing the oldest piece", () => {
    // X: 0, 4, 8 would be a diagonal, but X's 4th piece removes 0 first.
    // X: 0, 4, 2   O: 1, 7, 5
    let s = play([0, 1, 4, 7, 2, 5]);
    expect(s.winner).toBeNull();
    // X plays 8: 0 is removed, leaving 4, 2, 8 -> not a line.
    s = play([8], s);
    expect(s.board[0]).toBeNull();
    expect(s.winner).toBeNull();
    // O plays 3: 1 is removed, O has 7, 5, 3 -> not a line.
    s = play([3], s);
    // X plays 6: 4 is removed, X has 2, 8, 6 -> not a line.
    s = play([6], s);
    expect(s.queue.X).toEqual([2, 8, 6]);
    expect(s.winner).toBeNull();
  });

  it("detects a win for O", () => {
    // X: 3, 4, 0   O: 6, 7, 8 -> bottom row
    const s = play([3, 6, 4, 7, 0, 8]);
    expect(s.winner).toBe("O");
    expect(s.winLine).toEqual([6, 7, 8]);
  });

  it("never fills the board", () => {
    // Long game without a winner: board never has more than 6 pieces.
    let s = newGame();
    const order = [0, 1, 2, 4, 3, 5, 7, 6, 8];
    for (let i = 0; i < 60 && !s.winner; i++) {
      const side: Side = sideToMove(s);
      const empty = order.find((c) => s.board[c] === null)!;
      const r = applyMove(s, side, empty);
      if (!r.ok) throw new Error(r.error);
      s = r.state;
      expect(s.board.filter((c) => c !== null).length).toBeLessThanOrEqual(6);
    }
  });
});
