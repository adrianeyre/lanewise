import { Check, OctagonX, Pencil, Play, Redo2, RotateCcw, Sparkles, Undo2, X } from "lucide-react";

import { type Act, Stage } from "./Stage";
import { Chrome, Code, type CodeLine, Swap } from "./parts";

/**
 * The page's hero: Lanewise's Conflicts page, partway through a merge, where
 * an AI Suggestion is asked for, accepted and the file marked resolved, so
 * the merge can continue. The story is the PRD's own (§8): the Suggestion is
 * shown, with its Confidence and why, and goes in only when it's accepted.
 */

interface Scene {
  /** `idle`, then `asking` the Model Provider, then a Suggestion `shown`, then `accepted`. */
  suggestion: "idle" | "asking" | "shown" | "accepted";
  /** How much of the explanation has come in, in words. */
  why: number;
  /** Whether the Resolution has the Suggestion in place of its Conflict Hunk. */
  resolved: boolean;
  /** Whether the file is marked resolved, so the merge can continue. */
  marked: boolean;
}

const INITIAL: Scene = { suggestion: "idle", why: 0, resolved: false, marked: false };
const WHY = "Keeps main's rounding and adds the Fahrenheit from feature/units.".split(" ");
const POSTER: Scene = { suggestion: "accepted", why: WHY.length, resolved: true, marked: true };

/** The Resolution's lines, before and after: the Conflict Hunk's close up as the Suggestion's open in their place. */
function resolution(resolved: boolean): CodeLine[] {
  const hunk = !resolved;
  return [
    { text: "export function format(c: number) {" },
    { text: "<<<<<<< HEAD", kind: "marker", shown: hunk },
    { text: "  return `${round(c)} °C`;", kind: "ours", shown: hunk },
    { text: "=======", kind: "marker", shown: hunk },
    { text: "  const f = (c * 9) / 5 + 32;", kind: "theirs", shown: hunk },
    { text: "  return `${c} °C, ${f} °F`;", kind: "theirs", shown: hunk },
    { text: ">>>>>>> origin/feature/units", kind: "marker", shown: hunk },
    { text: "  const f = round((c * 9) / 5 + 32);", kind: "added", shown: resolved },
    { text: "  return `${round(c)} °C, ${f} °F`;", kind: "added", shown: resolved },
    { text: "}" },
  ];
}

async function story(a: Act<Scene>) {
  await a.wait(700);
  await a.move("suggest");
  await a.wait(150);
  await a.click();
  a.set({ suggestion: "asking" });
  await a.wait(1200);
  a.set({ suggestion: "shown" });
  for (let words = 1; words <= WHY.length; words++) {
    a.set({ why: words });
    await a.wait(55);
  }
  await a.wait(900);
  await a.move("accept");
  await a.wait(200);
  await a.click();
  a.set({ suggestion: "accepted", resolved: true });
  await a.wait(1400);
  await a.move("mark");
  await a.wait(200);
  await a.click();
  a.set({ marked: true });
  await a.wait(600);
}

export function HeroScene() {
  return (
    <Stage
      name="hero"
      width={1040}
      height={470}
      compact={{ below: 640, width: 358, height: 500 }}
      initial={INITIAL}
      poster={POSTER}
      script={story}
      pointer={{ wide: { x: 560, y: 120 }, compact: { x: 250, y: 150 } }}
      controls
      label="Lanewise's Conflicts page during a merge of origin/feature/units into main. An AI Suggestion for the one Conflict Hunk in src/format.ts, made by Anthropic's Claude with High Confidence, keeps the rounding from main and the Fahrenheit from feature/units. It has been accepted into the Resolution and the file marked resolved, so the merge can continue."
    >
      {(scene, layout) => (
        <div className="hero-window lw-window">
          <Chrome />
          <div className="hero-merge">
            <div className="lw-kicker">Merge in progress</div>
            <div className="hero-merge-said">
              Merging “origin/feature/units” into “main”:{" "}
              <Swap
                id={scene.marked ? "done" : "left"}
                text={scene.marked ? "every file is resolved." : "1 file still conflicted."}
              />
            </div>
            {layout === "wide" && (
              <div className="hero-merge-actions">
                  <span className="lw-button" data-primary={scene.marked || undefined}>
                    <Play aria-hidden="true" className="lw-icon" />
                    Continue
                  </span>
                  <span className="lw-button">
                    <OctagonX aria-hidden="true" className="lw-icon" />
                    Abort merge
                  </span>
              </div>
            )}
          </div>
          <div className="hero-body">
            <section className="hero-resolution">
              <div className="hero-resolution-head">
                <div>
                  <div className="lw-kicker">Resolution</div>
                  <div className="hero-file">src/format.ts</div>
                </div>
                {layout === "compact" ? (
                  <SuggestButton asking={scene.suggestion === "asking"} />
                ) : (
                  <MarkResolved marked={scene.marked} />
                )}
              </div>
              {layout === "wide" && (
                <div className="hero-hunks">
                  <Swap
                    id={scene.resolved ? "none" : "one"}
                    text={scene.resolved ? "No Conflict Hunks left." : "1 Conflict Hunk left."}
                  />
                </div>
              )}
              <Code lines={resolution(scene.resolved)} />
              {layout === "wide" && (
                <div className="hero-resolution-foot">
                  <span className="lw-button lw-button-small">
                    <Undo2 aria-hidden="true" className="lw-icon" />
                    Undo
                  </span>
                  <span className="lw-button lw-button-small">
                    <Redo2 aria-hidden="true" className="lw-icon" />
                    Redo
                  </span>
                  <span className="lw-button lw-button-small">
                    <RotateCcw aria-hidden="true" className="lw-icon" />
                    Start over
                  </span>
                </div>
              )}
              {layout === "compact" && (
                // Room is made for it once there's nothing left to resolve.
                <div className="lw-collapse" data-open={scene.resolved || undefined}>
                  <div className="lw-collapse-inner">
                    <div className="hero-resolution-foot">
                      <MarkResolved marked={scene.marked} />
                    </div>
                  </div>
                </div>
              )}
            </section>
            {layout === "wide" ? (
              <section className="hero-suggestion">
                <div className="lw-kicker">AI Suggestion</div>
                <SuggestButton asking={scene.suggestion === "asking"} />
                <Suggestion scene={scene} />
              </section>
            ) : (
              <div
                className="lw-collapse hero-sheet"
                data-open={scene.suggestion === "shown" || scene.suggestion === "accepted" || undefined}
              >
                <div className="lw-collapse-inner">
                  <Suggestion scene={scene} short />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Stage>
  );
}

function MarkResolved({ marked }: { marked: boolean }) {
  return (
    <span className="lw-button" data-target="mark" data-pressed={marked || undefined}>
      {marked ? <Check aria-hidden="true" className="lw-icon" /> : null}
      {marked ? "Resolved" : "Mark resolved"}
    </span>
  );
}

function SuggestButton({ asking }: { asking: boolean }) {
  return (
    <span className="lw-button hero-suggest" data-target="suggest" data-busy={asking || undefined}>
      <Sparkles aria-hidden="true" className="lw-icon" />
      {asking ? "Asking Claude…" : "Suggest a resolution"}
    </span>
  );
}

/** The Suggestion, as the AI Suggestion Widget shows it: labelled, with who made it, its Confidence, why, and Accept, Edit and Reject. */
function Suggestion({ scene, short = false }: { scene: Scene; short?: boolean }) {
  const open = scene.suggestion === "shown" || scene.suggestion === "accepted";
  return (
    <div className="hero-card" data-open={open || undefined} data-used={scene.suggestion === "accepted" || undefined}>
      <span className="hero-card-label">AI-generated</span>
      <div className="hero-card-title">Suggestion for Conflict Hunk 1</div>
      {!short && <div className="hero-card-note">Made by Anthropic (Claude).</div>}
      <div className="hero-card-confidence">Confidence: High</div>
      {!short && (
        <>
          <div className="hero-card-why-heading">Why</div>
          <p className="hero-card-why">
            {WHY.map((word, index) => (
              <span key={index} data-in={index < scene.why || undefined}>
                {word}{" "}
              </span>
            ))}
          </p>
        </>
      )}
      <div className="hero-card-actions">
        <span className="lw-button lw-button-small" data-target="accept" data-primary>
          <Check aria-hidden="true" className="lw-icon" />
          {scene.suggestion === "accepted" ? "Accepted" : "Accept"}
        </span>
        <span className="lw-button lw-button-small">
          <Pencil aria-hidden="true" className="lw-icon" />
          Edit
        </span>
        <span className="lw-button lw-button-small">
          <X aria-hidden="true" className="lw-icon" />
          Reject
        </span>
      </div>
    </div>
  );
}
