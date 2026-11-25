import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), cloudflare()],
  server: { host: true },
  // Pre-bundle up front so a dev-server restart doesn't leave stale dependency requests hanging.
  optimizeDeps: { include: ["sweetalert2", "@tsparticles/confetti"] },
});
