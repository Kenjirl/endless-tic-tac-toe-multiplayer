import "./style.css";
import Swal from "sweetalert2";
import { applyMove, newGame, otherSide, sideToMove, type GameState, type Side } from "../shared/engine";
import { CLOSE, CODE_PATTERN, normalizeCode, type RoomView } from "../shared/protocol";
import { Board, keyToCell } from "./board";
import { celebrate, sounds } from "./fx";
import { RoomConnection } from "./net";

// --- DOM ---------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  lobby: $("lobby"),
  game: $("game"),
  createBtn: $<HTMLButtonElement>("createBtn"),
  joinForm: $<HTMLFormElement>("joinForm"),
  codeInput: $<HTMLInputElement>("codeInput"),
  lobbyError: $("lobbyError"),
  localBtn: $("localBtn"),
  statusPill: $("statusPill"),
  statusSub: $("statusSub"),
  statusMain: $("statusMain"),
  notice: $("notice"),
  board: $("board"),
  panel: $("panel"),
  leaveBtn: $<HTMLButtonElement>("leaveBtn"),
  restartBtn: $<HTMLButtonElement>("restartBtn"),
};

const BUTTON =
  "rounded-full px-5 py-2.5 font-bold shadow transition active:scale-[0.98] disabled:cursor-default disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-indigo-700 text-white hover:bg-indigo-800`;
const SECONDARY = `${BUTTON} bg-slate-100 text-indigo-700 hover:bg-slate-200`;

const toast = Swal.mixin({
  toast: true,
  position: "top",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
});

function showScreen(screen: "lobby" | "game"): void {
  ui.lobby.hidden = screen !== "lobby";
  ui.game.hidden = screen !== "game";
}

function setStatus(main: string, sub: string, active: boolean): void {
  ui.statusMain.textContent = main;
  ui.statusSub.textContent = sub;
  ui.statusPill.classList.toggle("bg-white", active);
  ui.statusPill.classList.toggle("bg-white/50", !active);
}

function setNotice(text: string | null): void {
  ui.notice.hidden = !text;
  ui.notice.textContent = text ?? "";
}

/** Fill the panel under the board. `actions` maps data-action names to handlers. */
function showPanel(html: string, actions: Record<string, () => void> = {}): void {
  ui.panel.innerHTML = html;
  ui.panel.hidden = false;
  setBoardCompact(true);
  for (const el of ui.panel.querySelectorAll<HTMLElement>("[data-action]")) {
    const handler = actions[el.dataset.action!];
    if (handler) el.addEventListener("click", handler);
  }
}

function hidePanel(): void {
  ui.panel.hidden = true;
  ui.panel.replaceChildren();
  setBoardCompact(false);
}

/** Shrink the board while the panel is showing so everything fits on short screens. */
function setBoardCompact(compact: boolean): void {
  ui.board.classList.toggle("w-[min(600px,92vw,56dvh)]", !compact);
  ui.board.classList.toggle("w-[min(600px,92vw,40dvh)]", compact);
}

function showLobbyError(text: string | null): void {
  ui.lobbyError.hidden = !text;
  ui.lobbyError.textContent = text ?? "";
}

// --- Modes -------------------------------------------------------------------

/** What the board, keyboard and footer buttons do in the current screen. */
interface Mode {
  onCell(cell: number): void;
  onKey(key: string): void;
  leave(): void;
  restart?(): void;
  dispose(): void;
}

let mode: Mode | null = null;
const board = new Board(ui.board, (cell) => mode?.onCell(cell));

function toLobby(): void {
  mode?.dispose();
  mode = null;
  history.replaceState(null, "", "/");
  hidePanel();
  setNotice(null);
  showScreen("lobby");
}

// --- Local (same device) -----------------------------------------------------

function startLocal(): void {
  mode?.dispose();
  history.replaceState(null, "", "/");
  showScreen("game");
  ui.restartBtn.hidden = false;
  board.showHints(["X", "O"]);
  setNotice(null);

  let state: GameState = newGame();

  const render = () => {
    board.render(state, !state.winner);
    if (state.winner) {
      setStatus(`${state.winner} wins!`, `Turn ${state.turn} · this device`, true);
      showPanel(
        `<p class="font-indie text-4xl text-indigo-700">${state.winner} wins!</p>
         <p class="mt-1 text-sm">Three in a row.</p>
         <button data-action="again" class="${PRIMARY} mt-4">Play again</button>`,
        { again: reset },
      );
    } else {
      const turn = sideToMove(state);
      const main = state.turn === 0 ? "Endless Tic-Tac-Toe" : `${turn}'s turn`;
      setStatus(main, `Turn ${state.turn + 1} · this device`, state.turn > 0);
      hidePanel();
    }
  };

  const reset = () => {
    state = newGame();
    sounds.start();
    render();
  };

  mode = {
    onCell(cell) {
      const result = applyMove(state, sideToMove(state), cell);
      if (!result.ok) return;
      state = result.state;
      sounds.pop();
      if (state.winner) {
        sounds.finish();
        celebrate();
      }
      render();
    },
    onKey(key) {
      if (state.winner) return;
      const cell = keyToCell(key, [sideToMove(state)]);
      if (cell >= 0) this.onCell(cell);
    },
    leave: toLobby,
    async restart() {
      if (state.turn === 0) return;
      const { isConfirmed } = await Swal.fire({
        title: "Restart the game?",
        icon: "question",
        iconColor: "#be123c",
        showCancelButton: true,
        confirmButtonColor: "#4338ca",
        confirmButtonText: "Restart",
      });
      if (isConfirmed) reset();
    },
    dispose() {},
  };

  render();
}

// --- Online ------------------------------------------------------------------

/** Identifies this tab's seat in a room. Survives refreshes, unique per tab. */
function playerToken(): string {
  let token = sessionStorage.getItem("ettt-token");
  if (!token) {
    token = crypto.randomUUID();
    sessionStorage.setItem("ettt-token", token);
  }
  return token;
}

function roomLink(code: string): string {
  return `${location.origin}/?room=${code}`;
}

async function copyLink(code: string): Promise<void> {
  const link = roomLink(code);
  try {
    await navigator.clipboard.writeText(link);
    void toast.fire({ icon: "success", title: "Link copied" });
  } catch {
    // Clipboard needs HTTPS; fall back to a field the user can copy from.
    void Swal.fire({ title: "Copy this link", input: "text", inputValue: link, confirmButtonColor: "#4338ca" });
  }
}

function shareLink(code: string): void {
  navigator
    .share({ title: "Endless Tic-Tac-Toe", text: `Join my room: ${code}`, url: roomLink(code) })
    .catch(() => {});
}

function inviteHtml(code: string): string {
  const share = "share" in navigator ? `<button data-action="share" class="${SECONDARY}">Share</button>` : "";
  return `
    <p class="text-xs font-bold uppercase tracking-widest text-slate-500">Room code</p>
    <p class="text-brand my-1 select-all text-5xl font-bold tracking-[0.25em]">${code}</p>
    <div class="mt-3 flex justify-center gap-2">
      <button data-action="copy" class="${PRIMARY}">Copy link</button>
      ${share}
    </div>`;
}

function joinRoom(code: string): void {
  mode?.dispose();
  history.replaceState(null, "", `/?room=${code}`);
  showScreen("game");
  ui.restartBtn.hidden = true;
  board.showHints([]);
  board.render(newGame(), false);
  setStatus("Connecting…", `Room ${code}`, false);
  setNotice(null);
  hidePanel();

  let view: RoomView | null = null;
  let me: Side | null = null;
  let connected = false;
  let receivedAt = 0;
  let disposed = false;
  let leaveTimer: number | undefined;
  /** Remember which panel is showing so it isn't rebuilt (and its buttons re-created) on every update. */
  let panelKey = "";

  const inviteActions = { copy: () => copyLink(code), share: () => shareLink(code) };

  const conn = new RoomConnection(code, playerToken(), {
    onOpen() {
      connected = true;
      render();
    },
    onDrop() {
      connected = false;
      render();
    },
    onMessage(msg) {
      if (msg.type === "error") {
        if (!msg.fatal) console.debug("Server rejected action:", msg.code);
        return;
      }
      const prev = view;
      const prevMe = me;
      view = msg.room;
      me = msg.you;
      receivedAt = performance.now();
      playEvents(prev, prevMe);
      render();
    },
    async onClosed(closeCode) {
      connected = false;
      if (disposed) return;
      if (closeCode === CLOSE.left) return toLobby();
      if (closeCode === CLOSE.replaced) {
        const { isConfirmed } = await Swal.fire({
          title: "Opened in another tab",
          text: "This room is now being played from another tab or window.",
          icon: "info",
          showCancelButton: true,
          confirmButtonText: "Play here",
          cancelButtonText: "Back to menu",
          confirmButtonColor: "#4338ca",
        });
        if (disposed) return;
        return isConfirmed ? conn.reconnect() : toLobby();
      }
      const messages: Record<number, [string, string]> = {
        [CLOSE.notFound]: ["Room not found", `There's no room with code ${code}. It may have expired.`],
        [CLOSE.full]: ["Room is full", "Two players are already in this room."],
      };
      const [title, text] = messages[closeCode] ?? ["Can't join", "Something went wrong joining this room."];
      toLobby();
      void Swal.fire({ title, text, icon: "error", confirmButtonColor: "#4338ca" });
    },
  });

  /** Sounds, confetti and toasts for what changed between two server states. */
  function playEvents(prev: RoomView | null, prevMe: Side | null): void {
    if (!view || !me) return;
    const started = view.status === "playing" && view.game.turn === 0 && prev?.status !== "playing";
    if (started) {
      sounds.start();
      void toast.fire({
        icon: "success",
        title: `Game on! You are ${me}`,
        text: me === "X" ? "You move first." : "Your opponent moves first.",
      });
    } else if (prev && view.game.turn > prev.game.turn) {
      sounds.pop();
    }
    if (view.status === "finished" && prev?.status === "playing") {
      sounds.finish();
      if (view.game.winner === me) celebrate();
    }
    if (prev && prevMe && prev.seats[otherSide(prevMe)].taken && !view.seats[otherSide(me)].taken) {
      void toast.fire({ icon: "info", title: "Your opponent left the room" });
    }
  }

  function render(): void {
    if (!view || !me) return;
    const opp = otherSide(me);
    const { game, status } = view;
    const myTurn = status === "playing" && sideToMove(game) === me;

    board.showHints([me]);
    board.render(game, connected && myTurn);

    const sub = `Room ${view.code} · You are ${me}`;
    if (status === "waiting") setStatus("Waiting for opponent…", sub, false);
    else if (status === "playing") setStatus(`Turn ${game.turn + 1} · ${myTurn ? "Your turn" : "Opponent's turn"}`, sub, true);
    else setStatus(game.winner === me ? "You win!" : "You lose", sub, true);

    renderNotice();
    renderPanel(opp);
  }

  function renderNotice(): void {
    if (!view || !me) return;
    const opp = view.seats[otherSide(me)];
    if (!connected) {
      setNotice("Connection lost. Reconnecting…");
    } else if (view.status === "playing" && opp.taken && !opp.online && opp.forfeitInMs !== null) {
      const left = Math.max(0, Math.ceil((opp.forfeitInMs - (performance.now() - receivedAt)) / 1000));
      setNotice(`Opponent disconnected · they forfeit in ${left}s`);
    } else {
      setNotice(null);
    }
  }

  function renderPanel(opp: Side): void {
    if (!view || !me) return;
    const { status, game, endReason, rematch, score, seats } = view;

    if (status === "playing") {
      panelKey = "";
      return hidePanel();
    }

    if (status === "waiting") {
      if (panelKey === "waiting") return;
      panelKey = "waiting";
      return showPanel(
        `<p class="font-bold text-slate-800">Invite a friend</p>
         ${inviteHtml(view.code)}
         <p class="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500">
           <span class="size-2 animate-pulse rounded-full bg-fuchsia-600"></span>Waiting for an opponent to join…
         </p>`,
        inviteActions,
      );
    }

    // finished
    const won = game.winner === me;
    const reasons: Record<string, [string, string]> = {
      line: ["Three in a row!", "Your opponent got three in a row."],
      forfeit: ["Your opponent was disconnected for too long.", "You were disconnected for too long."],
      left: ["Your opponent left the game.", "You left the game."],
    };
    const reason = reasons[endReason ?? "line"][won ? 0 : 1];
    const oppHere = seats[opp].taken;

    let rematchHtml: string;
    if (!oppHere) {
      rematchHtml = `<p class="mt-4 text-sm text-slate-500">Your opponent left. Invite someone new:</p>${inviteHtml(view.code)}`;
    } else {
      const label = rematch[me] ? "Waiting for opponent…" : rematch[opp] ? "Accept rematch" : "Rematch";
      const hint = rematch[opp] && !rematch[me] ? "Your opponent wants a rematch!" : "Sides swap every game.";
      rematchHtml = `
        <button data-action="rematch" class="${PRIMARY} mt-4" ${rematch[me] ? "disabled" : ""}>${label}</button>
        <p class="mt-2 text-xs text-slate-500">${hint}</p>`;
    }

    const key = `finished|${won}|${reason}|${oppHere}|${rematch.X}|${rematch.O}|${score.X}|${score.O}`;
    if (panelKey === key) return;
    panelKey = key;
    showPanel(
      `<p class="font-indie text-4xl ${won ? "text-indigo-700" : "text-rose-700"}">${won ? "You win!" : "You lose"}</p>
       <p class="mt-1 text-sm">${reason}</p>
       <p class="mt-3 text-sm font-semibold text-slate-500">You <span class="text-lg text-slate-800">${score[me]} – ${score[opp]}</span> Opponent</p>
       ${rematchHtml}`,
      {
        ...inviteActions,
        rematch: () => conn.send({ type: "rematch" }),
      },
    );
  }

  const countdown = window.setInterval(renderNotice, 500);

  mode = {
    onCell(cell) {
      if (!view || !me || view.status !== "playing" || sideToMove(view.game) !== me) return;
      conn.send({ type: "move", cell });
    },
    onKey(key) {
      if (!me) return;
      const cell = keyToCell(key, [me]);
      if (cell >= 0) this.onCell(cell);
    },
    async leave() {
      const inGame = view && me && view.status === "playing" && view.seats[otherSide(me)].taken;
      if (inGame) {
        const { isConfirmed } = await Swal.fire({
          title: "Leave the game?",
          text: "You will lose this game.",
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "Leave",
          confirmButtonColor: "#be123c",
        });
        if (!isConfirmed || disposed) return;
      }
      // Tell the server so the seat frees up; fall back if it doesn't answer.
      if (conn.send({ type: "leave" })) leaveTimer = window.setTimeout(toLobby, 1500);
      else toLobby();
    },
    dispose() {
      disposed = true;
      clearInterval(countdown);
      clearTimeout(leaveTimer);
      conn.close();
    },
  };
}

async function createRoom(): Promise<void> {
  ui.createBtn.disabled = true;
  showLobbyError(null);
  try {
    const res = await fetch("/api/rooms", { method: "POST" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code } = (await res.json()) as { code: string };
    joinRoom(code);
  } catch (err) {
    console.error(err);
    showLobbyError("Couldn't create a room. Please try again.");
  } finally {
    ui.createBtn.disabled = false;
  }
}

// --- How to play -------------------------------------------------------------

const KEY = "inline-block w-6 rounded bg-slate-100 py-0.5 font-mono text-xs font-bold";

function keyRow(keys: string): string {
  return keys
    .split("")
    .map((k) => `<kbd class="${KEY}">${k}</kbd>`)
    .join(" ");
}

function showHowToPlay(): void {
  void Swal.fire({
    title: "How to play",
    confirmButtonText: "Got it",
    confirmButtonColor: "#4338ca",
    html: `
      <ul class="list-disc space-y-1.5 pl-5 text-left text-sm text-slate-600">
        <li>Like ordinary Tic-Tac-Toe: get <b>three in a row</b> to win. X moves first.</li>
        <li>Each player keeps at most <b>3 pieces</b> on the board.</li>
        <li>When you have 3, your oldest piece turns
          <b class="text-rose-600">red</b> (X) or <b class="text-indigo-600">blue</b> (O):
          it disappears on your next move.</li>
        <li>The board never fills up, so someone always wins eventually.</li>
        <li>Online, sides swap after every rematch.</li>
      </ul>
      <p class="mt-5 text-xs font-bold uppercase tracking-widest text-slate-500">Keyboard</p>
      <div class="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-500">
        ${(
          [
            ["Player X", "qwe", "asd", "zxc"],
            ["Board", "123", "456", "789"],
            ["Player O", "uio", "hjk", "bnm"],
          ] as const
        )
          .map(
            ([label, ...rows]) =>
              `<div class="space-y-1"><p class="font-semibold">${label}</p>${rows
                .map((r) => `<div>${keyRow(r)}</div>`)
                .join("")}</div>`,
          )
          .join("")}
      </div>`,
  });
}

// --- Wiring ------------------------------------------------------------------

$("helpBtn").addEventListener("click", showHowToPlay);

ui.createBtn.addEventListener("click", createRoom);
ui.localBtn.addEventListener("click", startLocal);
ui.leaveBtn.addEventListener("click", () => mode?.leave());
ui.restartBtn.addEventListener("click", () => mode?.restart?.());

ui.codeInput.addEventListener("input", () => {
  ui.codeInput.value = normalizeCode(ui.codeInput.value).replace(/[^A-Z0-9]/g, "");
  showLobbyError(null);
});

ui.joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = normalizeCode(ui.codeInput.value);
  if (!CODE_PATTERN.test(code)) return showLobbyError("Room codes are 4 letters/numbers, like K7QM.");
  ui.codeInput.value = "";
  joinRoom(code);
});

document.addEventListener("keydown", (event) => {
  if (!mode || ui.game.hidden || Swal.isVisible()) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement) return;
  mode.onKey(event.key.toLowerCase());
});

// Open a room straight from a shared link (/?room=K7QM).
const linked = new URLSearchParams(location.search).get("room");
if (linked) {
  const code = normalizeCode(linked);
  if (CODE_PATTERN.test(code)) joinRoom(code);
  else {
    history.replaceState(null, "", "/");
    showLobbyError(`"${linked.slice(0, 8)}" isn't a valid room code.`);
  }
}
