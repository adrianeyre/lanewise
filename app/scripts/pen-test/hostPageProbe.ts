/**
 * The Host page probe for Lanewise's first Pen-test round (pen-testing PRD
 * §6, W2, `docs/pen-test/W2.md`): one page that a Host page in a Release is
 * sent on to, which checks from inside it that it reaches none of
 * Lanewise's commands, from its own frame or any frame in it, and goes to
 * none of Lanewise's own origins. It shows what it found on the page
 * itself, and sends nothing anywhere: `serveHostPageProbe.ts` serves it on
 * the disposable machine alone.
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/** The page, whole: no request is made for anything else. */
export const PROBE_PAGE = String.raw`<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Lanewise Host page probe</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 1.5rem; max-width: 60rem; }
  .held { color: #0a5c2b; } .broke { color: #a1001b; font-weight: bold; }
  iframe { width: 18rem; height: 6rem; border: 2px solid #555; margin: 0.25rem; }
  button { font: inherit; padding: 0.25rem 0.75rem; }
  :focus-visible { outline: 3px solid #1a5fb4; outline-offset: 2px; }
</style>
<h1>Lanewise Host page probe</h1>
<p>Synthetic, for the Pen-test round (<code>docs/pen-test/W2.md</code>). Open it only in a Host page of a disposable Release. It sends nothing anywhere.</p>
<p><button type="button" id="run">Run the probes</button> <button type="button" id="clear">Start again</button></p>
<h2>Results</h2>
<ol id="results" aria-live="polite"></ol>
<h2 id="frames-heading">Frames at Lanewise's own origins</h2>
<p>Each box must be empty or an error page. If one shows Lanewise's own window, that probe broke.</p>
<div id="frames" aria-labelledby="frames-heading"></div>
<script>
(function () {
  "use strict";
  var STORE = "lanewise-host-page-probe";
  var WINDOWS = navigator.userAgent.indexOf("Windows") !== -1;
  var IPC = WINDOWS ? "http://ipc.localhost/call" : "ipc://localhost/call";
  var APP = WINDOWS ? "http://tauri.localhost/" : "tauri://localhost/";
  var NAVIGATIONS = [APP, APP + "index.html", IPC, "data:text/html,probe", "blob:", "about:srcdoc", "file:///"];
  var COMMANDS = [
    ["call", { name: "recentRepositories", request: {} }],
    ["update_status", {}],
    ["host_page_open", { page: 9999, url: "https://github.com/", bounds: { x: 0, y: 0, width: 1, height: 1, viewport: 1 } }],
    ["host_page_go", { page: 9999, go: "reload" }],
    ["plugin:event|emit", { event: "host-page", payload: { kind: "title", page: 0, title: "probe" } }],
    ["plugin:opener|open_url", { url: "https://github.com/" }],
    ["plugin:http|fetch", { clientConfig: { method: "GET", url: "https://raw.githubusercontent.com/adrianeyre/lanewise/main/catalog/models.json", headers: [], data: null } }],
    ["plugin:clipboard-manager|write_text", { text: "probe" }],
  ];
  var FRAMES = ["srcdoc", "sandboxed srcdoc", "blob", "data", "about:blank, written"];
  var T = window.__TAURI_INTERNALS__;
  var key = null;
  var state = JSON.parse(sessionStorage.getItem(STORE) || "null") || { results: [], at: -1, since: 0 };
  var list = document.getElementById("results");

  function save() { sessionStorage.setItem(STORE, JSON.stringify(state)); }
  function draw() {
    list.textContent = "";
    state.results.forEach(function (r) {
      var item = document.createElement("li");
      item.className = r.held === true ? "held" : r.held === false ? "broke" : "";
      item.textContent = (r.held === true ? "Held: " : r.held === false ? "BROKE: " : "Seen: ") + r.probe + " — " + r.detail;
      list.append(item);
    });
  }
  function record(probe, held, detail) { state.results.push({ probe: probe, held: held, detail: String(detail) }); save(); draw(); }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /** Whether a command answered, refused, or never answered. */
  function invoke(cmd, args) {
    var real = window.fetch;
    // The key Tauri's own script sends, so a frame's request is judged by its origin, not dropped for lacking it.
    window.fetch = function (url, options) {
      var headers = options && options.headers;
      if (headers && typeof headers.get === "function" && headers.get("Tauri-Invoke-Key")) key = headers.get("Tauri-Invoke-Key");
      return real.apply(this, arguments);
    };
    var answer = Promise.race([
      T.invoke(cmd, args).then(function (reply) { return { ok: reply }; }, function (refused) { return { refused: refused }; }),
      sleep(4000).then(function () { return { silent: true }; }),
    ]);
    window.fetch = real;
    return answer;
  }

  function frameScript(label, ok, error) {
    return "<script>(function(){var o={label:" + JSON.stringify(label) + ",origin:String(self.origin),internals:!!window.__TAURI_INTERNALS__};" +
      "var message=JSON.stringify({cmd:'call',callback:" + ok + ",error:" + error + ",options:{},payload:{name:'recentRepositories',request:{}},__TAURI_INVOKE_KEY__:" + JSON.stringify(key) + "});" +
      "try{if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.ipc){window.webkit.messageHandlers.ipc.postMessage(message);o.posted='webkit'}" +
      "else if(window.chrome&&window.chrome.webview){window.chrome.webview.postMessage(message);o.posted='webview2'}else if(window.ipc){window.ipc.postMessage(message);o.posted='ipc'}}catch(e){o.posted='threw '+e}" +
      "fetch(" + JSON.stringify(IPC) + ",{method:'POST',body:JSON.stringify({name:'recentRepositories',request:{}}),headers:{'Content-Type':'application/json','Tauri-Callback':'" + ok + "','Tauri-Error':'" + error + "','Tauri-Invoke-Key':" + JSON.stringify(key || "") + "}})" +
      ".then(function(r){o.fetched=r.headers.get('Tauri-Response')||String(r.status)},function(e){o.fetched='failed'})" +
      ".then(function(){parent.postMessage({probe:o},'*')})})()<\/script>";
  }

  async function frames() {
    var heard = {};
    window.addEventListener("message", function (event) { if (event.data && event.data.probe) heard[event.data.probe.label] = event.data.probe; });
    var replies = {};
    FRAMES.forEach(function (label) {
      var ok = T.transformCallback(function (reply) { replies[label] = { ok: reply }; });
      var error = T.transformCallback(function (refused) { replies[label] = { refused: refused }; });
      var html = frameScript(label, ok, error);
      var frame = document.createElement("iframe");
      frame.title = label;
      frame.hidden = true;
      if (label === "sandboxed srcdoc") frame.sandbox = "allow-scripts";
      if (label.indexOf("srcdoc") !== -1) frame.srcdoc = html;
      if (label === "blob") frame.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      if (label === "data") frame.src = "data:text/html," + encodeURIComponent(html);
      document.body.append(frame);
      if (label === "about:blank, written") { frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close(); }
    });
    await sleep(4000);
    FRAMES.forEach(function (label) {
      var seen = heard[label];
      var reply = replies[label];
      if (seen === undefined && reply === undefined) return record("the " + label + " frame", true, "it didn't load, or ran nothing");
      var broke = (reply !== undefined && "ok" in reply) || (seen !== undefined && seen.fetched === "ok");
      record("the " + label + " frame reaching call", !broke,
        "origin " + (seen ? seen.origin : "?") + ", Tauri's internals " + (seen && seen.internals ? "present" : "absent") +
        ", message " + (seen ? seen.posted || "not sent" : "?") + " → " + (reply ? ("ok" in reply ? "answered" : "refused: " + reply.refused) : "no answer") +
        ", request " + (seen ? seen.fetched : "?"));
    });
    var box = document.getElementById("frames");
    [APP, APP + "index.html", IPC].forEach(function (url) {
      var frame = document.createElement("iframe");
      frame.title = "A frame at " + url;
      frame.src = url;
      box.append(frame);
    });
  }

  async function run() {
    state = { results: [], at: -1, since: 0 };
    save();
    if (!T) record("Tauri's internals in this page", null, "absent");
    else {
      record("Tauri's internals in this page", null, "present, as Tauri injects them into every webview's top frame");
      for (var i = 0; i < COMMANDS.length; i++) {
        var answer = await invoke(COMMANDS[i][0], COMMANDS[i][1]);
        record("the command " + COMMANDS[i][0], !("ok" in answer), "ok" in answer ? "answered " + JSON.stringify(answer.ok) : answer.silent ? "no answer" : "refused: " + answer.refused);
      }
      await frames();
    }
    navigate(0);
  }

  /** Tries the next of NAVIGATIONS; one that doesn't happen leaves this page running to try the one after. */
  function navigate(at) {
    if (at >= NAVIGATIONS.length) { record("every navigation", null, "tried: see the frames below too"); state.at = -1; save(); return; }
    state.at = at;
    state.since = Date.now();
    save();
    var to = NAVIGATIONS[at];
    if (to === "blob:") to = URL.createObjectURL(new Blob(["<p>probe</p>"], { type: "text/html" }));
    setTimeout(function () { record("a navigation to " + NAVIGATIONS[at], true, "refused: the page stayed here"); navigate(at + 1); }, 2500);
    location.href = to;
  }

  // Back here with a navigation pending: it happened, and Back brought the page back.
  if (state.at >= 0) {
    var left = NAVIGATIONS[state.at];
    record("a navigation to " + left, false, "the page went there");
    navigate(state.at + 1);
  }
  draw();
  document.getElementById("run").addEventListener("click", function () { void run(); });
  document.getElementById("clear").addEventListener("click", function () { state = { results: [], at: -1, since: 0 }; save(); draw(); });
})();
</script>
</html>
`;

/** Serves the probe at `/`, and nothing else. */
export function handler(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== "GET" || (request.url ?? "/").split("?")[0] !== "/") {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found\n");
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(PROBE_PAGE);
}
