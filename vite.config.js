import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Liber reader prototype, ported from the Claude Design handoff bundle to a
// real Vite + React build. JSX is handled by @vitejs/plugin-react (the original
// prototype used in-browser Babel-standalone, which is dropped here).
export default defineConfig({
  plugins: [react()],
  server: { host: true },
});
