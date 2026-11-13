import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, "app/node_modules/playwright/package.json"), "utf8")) as {
  version: string;
};
const site = mkdtempSync(join(tmpdir(), "lanewise-setup-pictures-"));

try {
  execFileSync(
    "pnpm",
    ["--filter", "@lanewise/app", "exec", "vite", "build", "--config", "scripts/setupGuide/vite.config.ts", "--outDir", site],
    { cwd: root, stdio: "inherit" },
  );
  execFileSync(
    "docker",
    [
      "run",
      "--rm",
      "--init",
      "--volume",
      `${root}:/work`,
      "--volume",
      `${site}:/site:ro`,
      "--workdir",
      "/work",
      `mcr.microsoft.com/playwright:v${version}-noble`,
      "node",
      "app/scripts/setupGuide/shootPictures.ts",
      "/site",
      "/work",
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(site, { recursive: true, force: true });
}
