import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import type { Credits } from "../credits.ts";

const { version, author } = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  version: string;
  author: string;
};

const NO_CREDITS: Credits = { npm: [], crates: [], texts: [] };

function buildEmptyCredits(): Plugin {
  return {
    name: "lanewise-setup-guide-credits",
    resolveId: (source) => (source === "virtual:credits" ? "\0virtual:credits" : undefined),
    load: (id) => (id === "\0virtual:credits" ? `export default ${JSON.stringify(NO_CREDITS)};` : undefined),
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    "import.meta.env.VITE_APP_AUTHOR": JSON.stringify(author),
  },
  plugins: [react(), buildEmptyCredits()],
  build: { emptyOutDir: true },
});
