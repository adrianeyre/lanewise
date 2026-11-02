import { Check } from "lucide-react";
import type { ReactNode } from "react";

import { type Act, Stage } from "./Stage";
import { Code, type CodeLine } from "./parts";

/**
 * The feature grid's pictures, one Stage each (stageshow's `bento.md`): the
 * Commit graph, a stash's menu, the Model Providers and a split diff. Each
 * shows one thing, without the window around it, at about the app's size.
 */

/** Each row of a drawn graph, in design pixels. */
const ROW = 30;
/** The distance between lanes. */
const LANE = 22;

/** A commit's dot: on lane `lane` of row `row`, in lane colour `colour`, with the author's initials. */
interface Dot {
  row: number;
  lane: number;
  colour: number;
  initials: string;
}

/** The y of the middle of row `row`. */
const rowY = (row: number) => row * ROW + ROW / 2;
/** The x of lane `lane`. */
const laneX = (lane: number) => (lane + 1) * LANE;

/** A lane's line from row `from` to row `to`, curving across between lanes as the app draws a branch or a merge. */
function Edge({ from, to, colour }: { from: [row: number, lane: number]; to: [row: number, lane: number]; colour: number }) {
  const [x1, y1, x2, y2] = [laneX(from[1]), rowY(from[0]), laneX(to[1]), rowY(to[0])];
  const d =
    x1 === x2
      ? `M ${x1} ${y1} V ${y2}`
      : `M ${x1} ${y1} C ${x1} ${y1 + ROW * 0.7}, ${x2} ${y2 - ROW * 0.7}, ${x2} ${y2}`;
  return <path d={d} className={`lw-edge lw-lane-${colour}`} />;
}

function Dots({ dots }: { dots: readonly Dot[] }) {
  return (
    <>
      {dots.map((dot) => (
        <g key={`${dot.row}:${dot.lane}`} className={`lw-dot lw-lane-${dot.colour}`}>
          <circle cx={laneX(dot.lane)} cy={rowY(dot.row)} r={9} />
          <text x={laneX(dot.lane)} y={rowY(dot.row)} dy="0.35em" textAnchor="middle">
            {dot.initials}
          </text>
        </g>
      ))}
    </>
  );
}

/** A Label, as the Branch / tag column draws it. */
function Label({ name, kind }: { name: string; kind: "current" | "branch" | "tag" }) {
  return (
    <span className="lw-label" data-kind={kind}>
      {name}
    </span>
  );
}

/** A grey bar where words would be, which the eye passes over. */
function Bar({ width, className }: { width: number; className?: string }) {
  return <span className={className === undefined ? "lw-bar" : `lw-bar ${className}`} data-width={width} />;
}

interface GraphRow {
  labels?: { name: string; kind: "current" | "branch" | "tag" }[];
  subject?: string;
  /** The subject's bar, in tenths of the column, for a row whose words don't matter. */
  bar?: number;
}

const GRAPH_ROWS: GraphRow[] = [
  { labels: [{ name: "main", kind: "current" }], subject: "Say how often readings refresh" },
  { bar: 7 },
  { labels: [{ name: "feature/units", kind: "branch" }], subject: "Show the temperature in Fahrenheit too" },
  { bar: 5 },
  { labels: [{ name: "v0.2.0", kind: "tag" }], subject: "Merge branch 'feature/humidity'" },
  { bar: 6 },
  { bar: 8 },
  { bar: 5 },
  { bar: 7 },
];

const GRAPH_DOTS: Dot[] = [
  { row: 0, lane: 0, colour: 0, initials: "KJ" },
  { row: 1, lane: 0, colour: 0, initials: "AL" },
  { row: 2, lane: 1, colour: 1, initials: "MH" },
  { row: 3, lane: 1, colour: 1, initials: "MH" },
  { row: 4, lane: 0, colour: 0, initials: "GH" },
  { row: 5, lane: 1, colour: 3, initials: "KJ" },
  { row: 6, lane: 1, colour: 3, initials: "KJ" },
  { row: 7, lane: 0, colour: 0, initials: "AL" },
  { row: 8, lane: 0, colour: 0, initials: "MH" },
];

/** The Commit graph's rows: Labels, lanes with each author's initials, and subjects, the middle ones as bars. */
function GraphRows({ rows, dots, edges, lanes }: { rows: GraphRow[]; dots: Dot[]; edges: ReactNode; lanes: number }) {
  return (
    <div className="lw-graph">
      <svg className="lw-graph-lanes" width={(lanes + 1) * LANE} height={rows.length * ROW} aria-hidden="true">
        {edges}
        <Dots dots={dots} />
      </svg>
      {rows.map((row, index) => (
        <div key={index} className="lw-graph-row" data-row={index}>
          <span className="lw-graph-labels">
            {row.labels?.map((label) => <Label key={label.name} {...label} />)}
          </span>
          <span className="lw-graph-subject">
            {row.subject ?? <Bar width={row.bar ?? 6} />}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The Commit graph: branches, a merge and a tag, each commit with its author's initials. */
export function GraphTile() {
  return (
    <Stage
      name="graph"
      width={660}
      height={290}
      compact={{ below: 520, width: 358, height: 290 }}
      initial={{}}
      poster={{}}
      label="Lanewise's Commit graph: main, the current branch, at the top, feature/units on a lane of its own beside it, and the tag v0.2.0 on a merge of feature/humidity back into main, each commit marked with its author's initials."
    >
      {() => (
        <div className="graph-panel">
          <div className="graph-head">
            <span>Branch / tag</span>
            <span>Graph</span>
            <span>Subject</span>
          </div>
          <GraphRows
            rows={GRAPH_ROWS}
            dots={GRAPH_DOTS}
            lanes={2}
            edges={
              <>
                <Edge from={[0, 0]} to={[8.6, 0]} colour={0} />
                <Edge from={[1, 0]} to={[2, 1]} colour={1} />
                <Edge from={[2, 1]} to={[3, 1]} colour={1} />
                <Edge from={[3, 1]} to={[4, 0]} colour={1} />
                <Edge from={[4, 0]} to={[5, 1]} colour={3} />
                <Edge from={[5, 1]} to={[6, 1]} colour={3} />
                <Edge from={[6, 1]} to={[7, 0]} colour={3} />
              </>
            }
          />
        </div>
      )}
    </Stage>
  );
}

interface StashScene {
  menu: boolean;
  hover: string | null;
}

const STASH_ACTIONS = ["Show stash", "Apply", "Pop", "Drop…"];

async function stashStory(a: Act<StashScene>) {
  await a.wait(400);
  await a.move("stash");
  await a.click();
  a.set({ menu: true });
  await a.wait(350);
  await a.move("Pop");
  a.set({ hover: "Pop" });
  await a.wait(500);
}

const STASH_DOTS: Dot[] = [
  { row: 0, lane: 0, colour: 2, initials: "GH" },
  { row: 1, lane: 0, colour: 2, initials: "AL" },
  { row: 2, lane: 0, colour: 2, initials: "MH" },
  { row: 3, lane: 0, colour: 2, initials: "KJ" },
  { row: 4, lane: 0, colour: 2, initials: "AL" },
  { row: 5, lane: 0, colour: 2, initials: "GH" },
  { row: 6, lane: 0, colour: 2, initials: "KJ" },
];

/** A stash beside the commit it was made on, right-clicked, with its menu open. */
export function StashTile() {
  return (
    <Stage
      name="stash"
      width={340}
      height={280}
      initial={{ menu: false, hover: null }}
      poster={{ menu: true, hover: "Pop" }}
      script={stashStory}
      pointer={{ wide: { x: 250, y: 230 }, compact: { x: 250, y: 230 } }}
      label="A stash drawn as a dotted square beside the commit it was made on, Keep a changelog, right-clicked: its menu offers Show stash, Apply, Pop and Drop…, with Pop about to be chosen."
    >
      {(scene) => (
        <div className="stash-panel">
          <GraphRows
            rows={[
              { bar: 6 },
              { subject: "Keep a changelog" },
              { bar: 8 },
              { bar: 5 },
              { bar: 7 },
              { bar: 6 },
              { bar: 4 },
            ]}
            dots={STASH_DOTS}
            lanes={2}
            edges={
              <>
                <Edge from={[0, 0]} to={[6.6, 0]} colour={2} />
                <path d={`M ${laneX(0)} ${rowY(1)} H ${laneX(1) - 8}`} className="lw-edge lw-edge-stash" />
                <rect
                  x={laneX(1) - 8}
                  y={rowY(1) - 8}
                  width={16}
                  height={16}
                  className="lw-stash"
                  data-target="stash"
                  data-menu={scene.menu || undefined}
                />
              </>
            }
          />
          <div className="lw-menu stash-menu" data-open={scene.menu || undefined}>
            {STASH_ACTIONS.map((action) => (
              <div key={action} className="lw-menu-item" data-target={action} data-hover={scene.hover === action || undefined}>
                {action}
              </div>
            ))}
          </div>
        </div>
      )}
    </Stage>
  );
}

const PROVIDERS = [
  "Anthropic (Claude)",
  "Google (Gemini)",
  "OpenAI (ChatGPT models)",
  "xAI (Grok)",
  "Meta (Muse Spark)",
  "Local server",
];

/** Settings' Model Providers, Anthropic chosen, with its API key in the system's credential store. */
export function ProvidersTile() {
  return (
    <Stage
      name="providers"
      width={340}
      height={280}
      initial={{}}
      poster={{}}
      label="Lanewise's AI settings: the Model Providers Anthropic (Claude), Google (Gemini), OpenAI, xAI (Grok), Meta and a local server, such as Ollama, with Anthropic chosen and its API key saved in the system's credential store."
    >
      {() => (
        <div className="providers-panel">
          <div className="lw-kicker">Model Provider</div>
          <div className="providers-list">
            {PROVIDERS.map((provider, index) => (
              <div key={provider} className="providers-item" data-chosen={index === 0 || undefined}>
                <span className="providers-radio" />
                <span className="providers-name">{provider}</span>
              </div>
            ))}
          </div>
          <div className="providers-key">
            <div className="providers-key-label">API key</div>
            <div className="providers-key-field">
              <span className="providers-key-dots">••••••••••••••••</span>
              <span className="providers-key-saved">
                <Check aria-hidden="true" className="lw-icon" />
                Saved
              </span>
            </div>
          </div>
        </div>
      )}
    </Stage>
  );
}

const BEFORE: CodeLine[] = [
  { text: 'import { read } from "./io";' },
  { text: "" },
  { text: "export const EVERY = 60;", kind: "removed" },
  { text: "" },
  { text: "export function start() {" },
  { text: "  every(EVERY, show);" },
  { text: "}" },
];

const AFTER: CodeLine[] = [
  { text: 'import { read } from "./io";' },
  { text: "" },
  { text: "/** In seconds. */", kind: "added" },
  { text: "export const EVERY = 30;", kind: "added" },
  { text: "" },
  { text: "export function start() {" },
  { text: "  every(EVERY, show);" },
  { text: "}" },
];

/** A file's diff, split: as it was beside as it is. */
export function DiffTile() {
  return (
    <Stage
      name="diff"
      width={660}
      height={250}
      compact={{ below: 520, width: 358, height: 330 }}
      initial={{}}
      poster={{}}
      label="A split diff of src/display.ts: on the left, the file as it was, its line export const EVERY = 60 removed; on the right, as it is, with a comment and export const EVERY = 30 added."
    >
      {() => (
        <div className="diff-panel">
          <div className="diff-file">src/display.ts</div>
          <div className="diff-sides">
            <Code lines={BEFORE} className="diff-side" />
            <Code lines={AFTER} className="diff-side" />
          </div>
        </div>
      )}
    </Stage>
  );
}
