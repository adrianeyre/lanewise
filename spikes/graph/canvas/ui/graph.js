// The graph spike's canvas (issue #7, ADR 0005). Throwaway.
//
// A virtualized canvas: the canvas is the size of the viewport, a spacer
// gives the scrollbar the whole history's height, and each frame draws only
// the rows on screen from pages of rows fetched from Rust over IPC.

const { invoke } = window.__TAURI__.core;

const ROW = 24;
const LANE = 14;
const PAD = 10;
const PAGE = 200;
/** Pages kept either side of the one on screen. */
const KEEP = 6;
/** The graph never takes more than this share of the width. */
const MAX_GRAPH = 0.45;
const PALETTE = ["#0b61a4", "#c0392b", "#1e8449", "#7d3c98", "#a0522d", "#8a6d0b", "#117a8b", "#c2185b"];

const viewport = document.getElementById("viewport");
const canvas = document.getElementById("canvas");
const spacer = document.getElementById("spacer");
const status = document.getElementById("status");
const results = document.getElementById("results");
const ctx = canvas.getContext("2d", { alpha: false });

let total = 0;
let generation = 0;
/** Page index to `{ rows, segments }`, or `null` while it is being fetched. */
let pages = new Map();
/** How long each page took to arrive, in ms, and how big its JSON was. */
let fetches = [];
let scheduled = false;

const color = (id) => PALETTE[id % PALETTE.length];
const x = (column) => PAD + column * LANE + LANE / 2;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  spacer.style.height = `${Math.max(0, total * ROW - height)}px`;
}

function fetchPage(page) {
  if (pages.has(page) || page < 0 || page * PAGE >= total) return;
  pages.set(page, null);
  const asked = generation;
  const asking = performance.now();
  invoke("rows", { start: page * PAGE, count: PAGE }).then((window) => {
    if (asked !== generation) return;
    fetches.push({ ms: performance.now() - asking, bytes: JSON.stringify(window).length });
    const segments = [];
    const s = window.segments ?? [];
    for (let i = 0; i < s.length; i += 7) {
      segments.push({ id: s[i], start: s[i + 1], len: s[i + 2], from: s[i + 3], column: s[i + 4], to: s[i + 5], color: s[i + 6] });
    }
    pages.set(page, { rows: window.rows, segments });
    schedule();
  });
}

/** Fetches the pages the rows on screen are in, and one either side; forgets far ones. */
function wantPages(first, last) {
  const from = Math.floor(first / PAGE);
  const to = Math.floor(last / PAGE);
  for (let page = from; page <= to; page++) fetchPage(page);
  fetchPage(to + 1);
  fetchPage(from - 1);
  for (const page of pages.keys()) {
    if (page < from - KEEP || page > to + KEEP) pages.delete(page);
  }
}

function rowAt(row) {
  const page = pages.get(Math.floor(row / PAGE));
  return page ? page.rows[row % PAGE] : undefined;
}

/** Adds a line from `(c1, y1)` down to `(c2, y2)`, curved if it changes column. */
function line(path, c1, y1, c2, y2) {
  path.moveTo(x(c1), y1);
  if (c1 === c2) path.lineTo(x(c2), y2);
  else path.bezierCurveTo(x(c1), (y1 + y2) / 2, x(c2), (y1 + y2) / 2, x(c2), y2);
}

/** Draws the rows on screen. Returns what the frame drew, for the benchmark. */
function draw() {
  const started = performance.now();
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const top = viewport.scrollTop;
  const first = Math.max(0, Math.floor(top / ROW) - 1);
  const last = Math.min(total - 1, Math.ceil((top + height) / ROW));
  const mid = (row) => row * ROW - top + ROW / 2;
  wantPages(first, last);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // How wide the graph is on screen, up to its share of the width.
  let widest = 0;
  let blank = 0;
  const paths = new Map();
  const pathFor = (id) => {
    const key = color(id);
    if (!paths.has(key)) paths.set(key, new Path2D());
    return paths.get(key);
  };
  const seen = new Set();
  for (let page = Math.floor(first / PAGE); page <= Math.floor(last / PAGE); page++) {
    const loaded = pages.get(page);
    if (!loaded) continue;
    for (const s of loaded.segments) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const end = s.start + s.len;
      if (end < first || s.start > last + 1) continue;
      widest = Math.max(widest, s.from, s.column, s.to);
      const path = pathFor(s.color);
      if (s.len === 1) {
        line(path, s.from, mid(s.start), s.to, mid(end));
        continue;
      }
      if (s.start >= first - 1) line(path, s.from, mid(s.start), s.column, mid(s.start + 1));
      const down = Math.max(s.start + 1, first - 1);
      const up = Math.min(end - 1, last + 1);
      if (up > down) line(path, s.column, mid(down), s.column, mid(up));
      if (end <= last + 1) line(path, s.column, mid(end - 1), s.to, mid(end));
    }
  }
  for (let row = first; row <= last; row++) {
    const r = rowAt(row);
    if (!r) {
      blank++;
      continue;
    }
    widest = Math.max(widest, r.node);
    const edges = r.edges ?? [];
    for (let i = 0; i < edges.length; i += 3) {
      widest = Math.max(widest, edges[i], edges[i + 1]);
      line(pathFor(edges[i + 2]), edges[i], mid(row), edges[i + 1], mid(row + 1));
    }
    if (r.stubsDown?.length) {
      const path = pathFor(r.color);
      path.moveTo(x(r.node), mid(row));
      path.lineTo(x(r.node), mid(row) + ROW * 0.55);
    }
    if (r.stubsUp?.length) {
      const path = pathFor(r.color);
      path.moveTo(x(r.node), mid(row) - ROW * 0.55);
      path.lineTo(x(r.node), mid(row));
    }
  }
  const graph = Math.min(width * MAX_GRAPH, PAD * 2 + (widest + 1) * LANE);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, graph, height);
  ctx.clip();
  ctx.lineWidth = 2;
  for (const [key, path] of paths) {
    ctx.strokeStyle = key;
    ctx.stroke(path);
  }
  for (let row = first; row <= last; row++) {
    const r = rowAt(row);
    if (!r) continue;
    ctx.beginPath();
    ctx.arc(x(r.node), mid(row), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color(r.color);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    // A cut edge ends in an arrowhead: this commit's parent, or child, is far away.
    for (const [list, dir] of [
      [r.stubsDown, 1],
      [r.stubsUp, -1],
    ]) {
      if (!list?.length) continue;
      const tip = mid(row) + dir * ROW * 0.6;
      ctx.beginPath();
      ctx.moveTo(x(r.node) - 3.5, tip - dir * 4);
      ctx.lineTo(x(r.node), tip);
      ctx.lineTo(x(r.node) + 3.5, tip - dir * 4);
      ctx.fillStyle = color(r.color);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.textBaseline = "middle";
  for (let row = first; row <= last; row++) {
    const r = rowAt(row);
    const y = mid(row);
    if (!r) {
      ctx.fillStyle = "#e8ebef";
      ctx.fillRect(graph + 8, y - 5, 360, 10);
      continue;
    }
    let left = graph + 8;
    ctx.font = "12px ui-monospace, monospace";
    ctx.fillStyle = "#5b6470";
    ctx.fillText(r.id.slice(0, 8), left, y);
    left += 70;
    ctx.font = "13px system-ui, sans-serif";
    for (const name of r.refs ?? []) {
      const w = ctx.measureText(name).width + 10;
      ctx.fillStyle = "#e3edf7";
      ctx.fillRect(left, y - 9, w, 18);
      ctx.fillStyle = "#0b3d66";
      ctx.fillText(name, left + 5, y);
      left += w + 4;
    }
    ctx.fillStyle = "#1c1f24";
    ctx.fillText(r.summary, left, y, Math.max(0, width - left - 190));
    ctx.fillStyle = "#5b6470";
    ctx.fillText(r.author, width - 180, y, 170);
  }
  return { ms: performance.now() - started, blank, rows: last - first + 1 };
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const frame = draw();
    status.value = `${total.toLocaleString()} rows · row ${Math.floor(viewport.scrollTop / ROW).toLocaleString()} · drew in ${frame.ms.toFixed(1)} ms`;
  });
}

async function open(config) {
  generation++;
  pages = new Map();
  fetches = [];
  const started = performance.now();
  const opened = await invoke("open", {
    repository: config.repository,
    order: config.order,
    style: config.style,
    format: config.format,
  });
  total = opened.rows;
  resize();
  return { ...opened, openMs: performance.now() - started };
}

/** Resolves once every row on screen has arrived and been drawn. */
function drawnInFull() {
  return new Promise((resolve) => {
    const tick = () => {
      const frame = draw();
      if (frame.blank === 0) resolve(frame);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const percentile = (values, p) => {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
};
const summary = (values) => ({
  n: values.length,
  p50: +percentile(values, 50).toFixed(2),
  p95: +percentile(values, 95).toFixed(2),
  p99: +percentile(values, 99).toFixed(2),
  max: +Math.max(0, ...values).toFixed(2),
});

/**
 * Scrolls by `step(frame)` pixels (or to `jump(frame)`) each animation frame,
 * drawing in the frame, and records how long frames and draws took.
 */
function scenario(frames, { step, jump }) {
  return new Promise((resolve) => {
    const intervals = [];
    const draws = [];
    let blankFrames = 0;
    let last;
    let n = 0;
    const max = total * ROW - viewport.clientHeight;
    const tick = (now) => {
      if (last !== undefined) intervals.push(now - last);
      last = now;
      if (jump) {
        const to = jump(n);
        if (to !== undefined) viewport.scrollTop = to;
      } else {
        viewport.scrollTop = Math.min(max, viewport.scrollTop + step);
      }
      const frame = draw();
      draws.push(frame.ms);
      if (frame.blank > 0) blankFrames++;
      if (++n < frames) requestAnimationFrame(tick);
      else
        resolve({
          frameIntervalMs: summary(intervals),
          // performance.now() is rounded to a millisecond, so a frame is
          // only counted as dropped once it is half a frame late.
          over25ms: intervals.filter((t) => t > 25).length,
          over50ms: intervals.filter((t) => t > 50).length,
          drawMs: summary(draws),
          framesWithBlankRows: blankFrames,
        });
    };
    requestAnimationFrame(tick);
  });
}

async function bench(config, opened) {
  const firstScreen = await drawnInFull();
  const firstScreenMs = performance.now();
  const out = {
    config,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: [viewport.clientWidth, viewport.clientHeight],
    opened,
    firstScreen: { sinceNavigationMs: +firstScreenMs.toFixed(1), rows: firstScreen.rows },
    scenarios: {},
  };
  // Nothing drawn: how often this webview runs animation frames at all.
  out.scenarios.idle = await new Promise((resolve) => {
    const intervals = [];
    let last;
    const tick = (now) => {
      if (last !== undefined) intervals.push(now - last);
      last = now;
      if (intervals.length < 120) requestAnimationFrame(tick);
      else resolve({ frameIntervalMs: summary(intervals) });
    };
    requestAnimationFrame(tick);
  });
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const plans = [
    ["steady, 5 rows a frame", 600, { step: ROW * 5 }],
    ["fast, 25 rows a frame", 600, { step: ROW * 25 }],
    ["fling, 100 rows a frame", 300, { step: ROW * 100 }],
    ["scrollbar jumps, every 10 frames", 300, { jump: (n) => (n % 10 === 0 ? Math.floor(random() * total) * ROW : undefined) }],
  ];
  for (const [name, frames, plan] of plans) {
    viewport.scrollTop = 0;
    await drawnInFull();
    fetches = [];
    out.scenarios[name] = await scenario(frames, plan);
    out.scenarios[name].pageFetchMs = summary(fetches.map((f) => f.ms));
    out.scenarios[name].pageKiB = +(fetches.reduce((a, f) => a + f.bytes, 0) / Math.max(1, fetches.length) / 1024).toFixed(1);
  }
  return out;
}

async function start() {
  const config = await invoke("config");
  for (const key of ["order", "style", "format"]) document.getElementById(key).value = config[key];
  const reopen = async () => {
    for (const key of ["order", "style", "format"]) config[key] = document.getElementById(key).value;
    status.value = "Laying out…";
    const opened = await open(config);
    status.value = `${opened.rows.toLocaleString()} rows laid out in ${opened.openMs.toFixed(0)} ms`;
    schedule();
    return opened;
  };
  for (const key of ["order", "style", "format"]) document.getElementById(key).addEventListener("change", reopen);
  viewport.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", () => {
    resize();
    schedule();
  });
  document.getElementById("bench").addEventListener("click", async () => {
    const out = await bench({ ...config }, await reopen());
    results.hidden = false;
    results.textContent = JSON.stringify(out, null, 2);
  });

  const opened = await reopen();
  if (config.mode === "bench") {
    await invoke("report", { text: JSON.stringify(await bench(config, opened), null, 2) });
  } else if (config.mode === "screenshot") {
    viewport.scrollTop = config.row * ROW;
    await drawnInFull();
    await drawnInFull();
    await invoke("screenshot");
  } else {
    viewport.focus();
  }
}

start();
