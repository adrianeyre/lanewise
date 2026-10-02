// Turns the canvas benchmark's JSON files into the Markdown tables in
// results/ and ADR 0005: `node summarize.mjs <dir>`. Throwaway (issue #7).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const runs = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .toSorted()
  .map((name) => ({ name: name.replace(/\.json$/, ""), ...JSON.parse(readFileSync(join(dir, name), "utf8")) }));

const first = runs[0];
console.log(`${first.userAgent}, viewport ${first.viewport.join("×")} CSS px.\n`);
console.log("| Run | Scale | Opened in, ms (load / order / layout) | First screen drawn, ms after navigation | Idle frame p50 / max, ms |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const run of runs) {
  const o = run.opened;
  const idle = run.scenarios.idle.frameIntervalMs;
  const parts = [o.loadMs, o.orderMs, o.layoutMs].map((ms) => ms.toFixed(0)).join(" / ");
  console.log(`| ${run.name} | ${run.devicePixelRatio} | ${o.openMs.toFixed(0)} (${parts}) | ${run.firstScreen.sinceNavigationMs.toFixed(0)} | ${idle.p50} / ${idle.max} |`);
}
console.log(
  "\n| Run | Scenario | Frame interval p50 / p95 / p99 / max, ms | Frames over 25 ms / 50 ms | Draw p50 / p99 / max, ms | Frames with rows not yet loaded | Page fetch p50 / p95 / max, ms | Page, KiB |",
);
console.log("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const run of runs) {
  for (const [scenario, s] of Object.entries(run.scenarios)) {
    if (scenario === "idle") continue;
    const f = s.frameIntervalMs;
    const d = s.drawMs;
    const p = s.pageFetchMs;
    console.log(
      `| ${run.name} | ${scenario} | ${f.p50} / ${f.p95} / ${f.p99} / ${f.max} | ${s.over25ms} / ${s.over50ms} of ${f.n} | ${d.p50} / ${d.p99} / ${d.max} | ${s.framesWithBlankRows} | ${p.p50} / ${p.p95} / ${p.max} | ${s.pageKiB} |`,
    );
  }
}
