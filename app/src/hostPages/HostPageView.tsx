import { ArrowLeft, ArrowRight, ExternalLink, LoaderCircle, MousePointerClick, RotateCw } from "lucide-react";
import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

import { HostLogo } from "../hosts/OpenOnHost";
import { webPageOf } from "../hosts/webPage";
import type { HostPageBounds, HostPages } from "../platform/platform";
import { tabName } from "../tabs/RepositoryTabs";
import type { HostPageTab } from "../tabs/tabs";

interface Props {
  tab: HostPageTab;
  hostPages: HostPages;
  /** Opens the page in the user's own browser, rather than here. */
  onOpenInBrowser: (url: string) => void;
  /** Where focus goes as the page's F6 hands it back: the toolbar's first button. */
  toolbar: RefObject<HTMLButtonElement | null>;
  /** Called with why the Host page couldn't open or move, if it couldn't. */
  onProblem: (problem: string) => void;
}

/** What's drawn over the page, so the Host page, which is drawn over everything, must make way. */
const OVER = "dialog[open], .menu-list";

/** The Activity indicator, which the Host page makes room for below it. */
const ACTIVITY = ".activity";

/** Where the Host page goes: `view`'s place, less room for the Activity indicator while it shows. */
function boundsOf(view: HTMLElement): HostPageBounds {
  const box = view.getBoundingClientRect();
  const activity = document.querySelector(ACTIVITY)?.getBoundingClientRect();
  const bottom = activity === undefined ? box.bottom : Math.min(box.bottom, Math.max(box.top, activity.top - 8));
  return { x: box.left, y: box.top, width: box.width, height: bottom - box.top, viewport: window.innerWidth };
}

function same(a: HostPageBounds | null, b: HostPageBounds): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.viewport === b.viewport;
}

/**
 * A Host page's Tab (ADR 0042): a toolbar of Back, Forward, Reload, where
 * the page is and Open in browser, over the page itself. The page is a
 * native webview the shell lays over this Tab's place, so it's kept there
 * as the place moves or resizes, hidden while a menu or dialog is open over
 * it, which it would otherwise hide, kept clear of the Activity indicator,
 * and hidden while another Tab is shown. F6 moves focus into the page, and
 * the page's own F6 hands it back to the toolbar, so the keyboard is never
 * trapped in it; Ctrl or Cmd+W there closes the Tab.
 */
export function HostPageView({ tab, hostPages, onOpenInBrowser, toolbar, onProblem }: Props) {
  const view = useRef<HTMLDivElement>(null);
  const page = tab.key;
  const opened = useRef(tab.url);
  const latestProblem = useRef(onProblem);
  useLayoutEffect(() => {
    latestProblem.current = onProblem;
  });

  // Opened, or shown again, over this Tab's place, and kept there until another Tab is shown.
  useEffect(() => {
    const element = view.current;
    if (!element) return;
    const failed = (failure: unknown) =>
      latestProblem.current(failure instanceof Error ? failure.message : String(failure));
    let last: HostPageBounds | null = boundsOf(element);
    let covered = document.querySelector(OVER) !== null;
    void hostPages.open(page, opened.current, last).then(() => {
      if (covered) return hostPages.show(page, false);
    }, failed);
    // Its place is read each frame, since nothing says when a Widget above it, such as a notice, moves it.
    let frame = requestAnimationFrame(function follow() {
      const now = boundsOf(element);
      if (!same(last, now)) {
        last = now;
        hostPages.place(page, now).catch(failed);
      }
      frame = requestAnimationFrame(follow);
    });
    const watch = new MutationObserver(() => {
      const over = document.querySelector(OVER) !== null;
      if (over === covered) return;
      covered = over;
      hostPages.show(page, !over).catch(failed);
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      hostPages.show(page, false).catch(() => {});
    };
  }, [hostPages, page]);

  const web = webPageOf(tab.url);
  const go = (to: "back" | "forward" | "reload" | "focus") => {
    hostPages.go(page, to).catch((failure: unknown) => onProblem(String(failure)));
  };
  const name = tabName(tab);

  return (
    <section className="host-page" aria-label={name}>
      <div
        role="toolbar"
        aria-label="Page"
        className="host-page-toolbar"
        onKeyDown={(event) => {
          if (event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            go("focus");
          }
        }}
      >
        <button ref={toolbar} type="button" className="icon-button" aria-label="Back" title="Back" onClick={() => go("back")}>
          <ArrowLeft aria-hidden="true" className="button-icon" />
        </button>
        <button type="button" className="icon-button" aria-label="Forward" title="Forward" onClick={() => go("forward")}>
          <ArrowRight aria-hidden="true" className="button-icon" />
        </button>
        <button type="button" className="icon-button" aria-label="Reload" title="Reload" onClick={() => go("reload")}>
          {tab.loading ? (
            <LoaderCircle aria-hidden="true" className="button-icon activity-spinner" />
          ) : (
            <RotateCw aria-hidden="true" className="button-icon" />
          )}
        </button>
        <p className="host-page-address" title={tab.url}>
          {web !== null && <HostLogo integration={web.integration} />}
          <span className="host-page-url">{tab.url}</span>
        </p>
        <p role="status" className="visually-hidden">
          {tab.loading ? `Loading ${name}…` : ""}
        </p>
        <button
          type="button"
          className="button button-small"
          title="Move focus into the page: F6 there brings it back here"
          onClick={() => go("focus")}
        >
          <MousePointerClick aria-hidden="true" className="button-icon" />
          Go to the page <kbd>F6</kbd>
        </button>
        <button type="button" className="button button-small" onClick={() => onOpenInBrowser(tab.url)}>
          <ExternalLink aria-hidden="true" className="button-icon" />
          Open in browser
        </button>
      </div>
      {/* The Host page is drawn over this by the shell. */}
      <div ref={view} className="host-page-view" />
    </section>
  );
}
