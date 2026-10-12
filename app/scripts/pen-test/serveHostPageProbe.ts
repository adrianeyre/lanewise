/**
 * Serves the Host page probe (`hostPageProbe.ts`) for Lanewise's first
 * Pen-test round (pen-testing PRD §6, W2), run by hand on a disposable
 * machine and never in CI:
 *
 *   pnpm pen-test:host-page-probe --cert <cert.pem> --key <key.pem> [--name lanewise-probe.test] [--port 8443]
 *
 * A Host page only goes to `https` pages, so the probe is served over TLS,
 * with a certificate for `--name` that only the disposable machine trusts,
 * and that machine's hosts file points the name at `127.0.0.1`. It listens
 * there alone, and answers nothing but the probe page (`docs/pen-test/W2.md`,
 * hand check A).
 */

import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { parseArgs } from "node:util";

import { handler } from "./hostPageProbe";

const { values } = parseArgs({
  options: {
    cert: { type: "string" },
    key: { type: "string" },
    name: { type: "string", default: "lanewise-probe.test" },
    port: { type: "string", default: "8443" },
  },
});

if (values.cert === undefined || values.key === undefined) {
  console.error("Usage: pnpm pen-test:host-page-probe --cert <cert.pem> --key <key.pem> [--name lanewise-probe.test] [--port 8443]");
  process.exit(2);
}

const port = Number(values.port);
createServer({ cert: readFileSync(values.cert), key: readFileSync(values.key) }, handler).listen(port, "127.0.0.1", () => {
  console.log(`The Host page probe is at https://${values.name}:${port}/ — Ctrl+C stops it.`);
});
