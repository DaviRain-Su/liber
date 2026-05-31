import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Liber reader prototype, ported from the Claude Design handoff bundle to a
// real Vite + React build. JSX is handled by @vitejs/plugin-react (the original
// prototype used in-browser Babel-standalone, which is dropped here).
//
// Two HTML entries, mirroring the design bundle's pages:
//   index.html  → src/main.jsx   — the full product (library → detail → reader)
//   reader.html → src/reader.jsx — the focused "Liber Reader" surface that
//                                  boots straight into the full-screen Reader
export default defineConfig({
  plugins: [react()],
  server: { host: true },
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        reader: resolve(root, "reader.html"),
      },
    },
  },
});
