import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { credits } from "./scripts/credits.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

// The version the footer shows, which the Desktop App's `tauri.conf.json` takes
// too, and the author the Credits name, are the repository's own.
const { version, author } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  author: string;
};

/** The dev server's port. `desktop/tauri.conf.json`'s `devUrl` names it too, so it must not drift. */
const PORT = 5150;

export default defineConfig({
  // Relative, so the one build works in the Desktop App's window and when
  // `serve` hands it to a browser in Web Mode (ADR 0003).
  base: "./",
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    "import.meta.env.VITE_APP_AUTHOR": JSON.stringify(author),
  },
  // `virtual:credits`, the bundled npm packages and crates and their licences, for the Credits dialog.
  plugins: [react(), credits(root, fileURLToPath(new URL(".", import.meta.url)))],
  // Tauri's CLI prints the Rust build's output; clearing the screen would hide it.
  clearScreen: false,
  server: {
    port: PORT,
    strictPort: true,
  },
  preview: {
    port: PORT,
    strictPort: true,
  },
  test: {
    // A test that draws the UI opts into jsdom with a `// @vitest-environment jsdom` first line.
    environment: "node",
  },
});
