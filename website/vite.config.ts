import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";

import { credits } from "../app/scripts/credits.ts";
import { type Downloads, downloadsOf, type GitHubRelease } from "./src/downloads.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

// The footer's version and the Credits' author are the repository's own, as in the app.
const { version, author } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
  author: string;
};

/**
 * The latest Release, which the deploy job saves from GitHub's API and names
 * in `LANEWISE_LATEST_RELEASE`. Without one, before the first Release or in
 * development, the page says there's nothing to download yet.
 */
function latestDownloads(): Downloads | null {
  const file = process.env.LANEWISE_LATEST_RELEASE;
  if (file === undefined || file === "") return null;
  return downloadsOf(JSON.parse(readFileSync(file, "utf8")) as GitHubRelease);
}

/** Where the page is drawn to HTML when it is built: the `ssr` environment's output, which nothing ships. */
const PRERENDER = ".prerender";

/**
 * Draws the page into `index.html`'s `<!--site-->` when it is built, from
 * `src/prerender.tsx`, which `buildApp` builds first. In development the
 * page is drawn in the browser alone.
 */
function prerender(): Plugin {
  return {
    name: "lanewise-website-prerender",
    transformIndexHtml: {
      order: "post",
      async handler(html, { server }) {
        if (server) return html;
        const built = pathToFileURL(fileURLToPath(new URL(`${PRERENDER}/prerender.js`, import.meta.url))).href;
        const { prerender: draw } = (await import(built)) as typeof import("./src/prerender.tsx");
        if (!html.includes("<!--site-->")) throw new Error("index.html has no <!--site--> to draw the page into");
        return html.replace("<!--site-->", draw());
      },
    },
  };
}

/** The dev server's and preview's port, beside the app's 5150. */
const PORT = 5160;

export default defineConfig({
  // GitHub Pages serves the site at the root of its custom domain, lanewise.adrianeyre.co.uk (ADR 0031).
  base: "/",
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(version),
    "import.meta.env.VITE_APP_AUTHOR": JSON.stringify(author),
    "import.meta.env.VITE_DOWNLOADS": JSON.stringify(latestDownloads()),
  },
  // The footer's Credits are Lanewise's, the same as in the app, whose npm packages include the website's.
  plugins: [react(), credits(root, fileURLToPath(new URL("../app", import.meta.url))), prerender()],
  // The footer comes from `app/src/legal/`, so React must be the website's one copy.
  resolve: { dedupe: ["react", "react-dom"] },
  environments: {
    ssr: {
      build: {
        outDir: PRERENDER,
        emptyOutDir: true,
        rolldownOptions: { input: "src/prerender.tsx" },
      },
    },
  },
  builder: {
    async buildApp(builder) {
      await builder.build(builder.environments.ssr!);
      await builder.build(builder.environments.client!);
    },
  },
  server: {
    port: PORT,
    strictPort: true,
  },
  preview: {
    port: PORT,
    strictPort: true,
  },
  test: {
    // A test that draws the page opts into jsdom with a `// @vitest-environment jsdom` first line.
    environment: "node",
  },
});
