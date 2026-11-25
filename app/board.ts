import { fadingCell, type GameState, type Side } from "../shared/engine";

/** Keyboard layouts from the original game: a 3x3 block of keys per player. */
export const KEYMAP: Record<Side, string> = { X: "qweasdzxc", O: "uiohjkbnm" };

/** Map a key to a board cell. Digits 1-9 always work; letters use the given layouts. */
export function keyToCell(key: string, layouts: Side[]): number {
  if (/^[1-9]$/.test(key)) return Number(key) - 1;
  for (const side of layouts) {
    const i = KEYMAP[side].indexOf(key);
    if (i >= 0) return i;
  }
  return -1;
}

const HINT = "absolute bottom-1 hidden size-8 items-center justify-center rounded border border-white text-sm text-white";

export class Board {
  private cells: HTMLButtonElement[] = [];
  private values: HTMLElement[] = [];
  private hints: Record<Side, HTMLElement[]> = { X: [], O: [] };

  constructor(root: HTMLElement, onCell: (cell: number) => void) {
    root.replaceChildren();
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.setAttribute("aria-label", `Cell ${i + 1}`);
      cell.className =
        "relative flex aspect-square w-full items-center justify-center rounded-lg bg-linear-to-t from-slate-900/50 " +
        "outline-white outline-offset-4 transition-colors enabled:cursor-pointer enabled:hover:bg-white/10";

      const hintX = document.createElement("span");
      hintX.className = `${HINT} left-1 bg-rose-700`;
      hintX.textContent = KEYMAP.X[i];

      const value = document.createElement("span");
      value.className =
        "font-indie text-[clamp(3rem,13vmin,6rem)] leading-none text-white scale-0 translate-y-20 transition-all duration-200";

      const hintO = document.createElement("span");
      hintO.className = `${HINT} right-1 bg-indigo-700`;
      hintO.textContent = KEYMAP.O[i];

      // Drop the letter once a removed piece has finished shrinking away.
      value.addEventListener("transitionend", () => {
        if (value.classList.contains("scale-0")) value.textContent = "";
      });

      cell.append(hintX, value, hintO);
      cell.addEventListener("click", () => onCell(i));
      root.append(cell);

      this.cells.push(cell);
      this.values.push(value);
      this.hints.X.push(hintX);
      this.hints.O.push(hintO);
    }
  }

  /** Show keyboard hint badges (desktop only) for the given layouts. */
  showHints(sides: Side[]): void {
    for (const side of ["X", "O"] as const) {
      for (const hint of this.hints[side]) hint.classList.toggle("md:flex", sides.includes(side));
    }
  }

  render(game: GameState, interactive: boolean): void {
    const fading = { X: fadingCell(game, "X"), O: fadingCell(game, "O") };
    const winLine = new Set(game.winLine ?? []);

    for (let i = 0; i < 9; i++) {
      const piece = game.board[i];
      const value = this.values[i];
      const cell = this.cells[i];

      if (piece) value.textContent = piece;
      value.classList.toggle("scale-0", !piece);
      value.classList.toggle("translate-y-20", !piece);
      value.classList.toggle("scale-100", !!piece);
      value.classList.toggle("translate-y-0", !!piece);

      const isFading = !!piece && !game.winner && fading[piece] === i;
      value.classList.toggle("text-rose-500", isFading && piece === "X");
      value.classList.toggle("text-indigo-500", isFading && piece === "O");
      value.classList.toggle("text-white", !isFading);

      const won = winLine.has(i);
      cell.classList.toggle("bg-rose-700", won && game.winner === "X");
      cell.classList.toggle("bg-indigo-700", won && game.winner === "O");
      cell.classList.toggle("bg-linear-to-t", !won);
      cell.classList.toggle("from-slate-900/50", !won);

      cell.disabled = !interactive || piece !== null;
    }
  }
}
