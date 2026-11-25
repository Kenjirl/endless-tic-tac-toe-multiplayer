import { CODE_ALPHABET, CODE_LENGTH, CODE_PATTERN, normalizeCode } from "../shared/protocol";

export { Room } from "./room";

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function roomStub(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    // POST /api/rooms -> { code }
    if (url.pathname === "/api/rooms") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomCode();
        if (await roomStub(env, code).create(code)) return Response.json({ code });
      }
      return Response.json({ error: "Could not allocate a room code" }, { status: 503 });
    }

    // GET /api/rooms/:code/ws -> WebSocket into the room
    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)\/ws$/);
    if (match) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      const code = normalizeCode(decodeURIComponent(match[1]));
      if (!CODE_PATTERN.test(code)) return new Response("Invalid room code", { status: 400 });
      return roomStub(env, code).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
