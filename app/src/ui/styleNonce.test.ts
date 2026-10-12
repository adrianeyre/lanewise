// @vitest-environment jsdom
import { EditorView } from "@codemirror/view";
import { afterEach, expect, test } from "vitest";

import { resolutionEditor, sideEditor } from "../conflicts/conflictEditors";
import { diffDocument } from "../diff/document";
import { diffEditor } from "../diff/editor";
import { editorStyleNonce, STYLE_NONCE_META, styleNonce } from "./styleNonce";

/** A new element in the page, for an editor to draw in. */
function parent(): HTMLElement {
  return document.body.appendChild(document.createElement("div"));
}

/** A page whose head has `meta`, as `index.html` has it once Tauri has served it. */
function pageWith(meta: string): Document {
  const page = document.implementation.createHTMLDocument("Lanewise");
  page.head.innerHTML = meta;
  return page;
}

afterEach(() => {
  document.head.querySelector(`meta[name="${STYLE_NONCE_META}"]`)?.remove();
  document.body.replaceChildren();
});

test("a page's style nonce is the one Tauri put in, and there's none where it didn't", () => {
  expect(styleNonce(pageWith(`<meta name="${STYLE_NONCE_META}" content="8172635549012">`))).toBe("8172635549012");
  // `pnpm dev`, a test, or a Content-Security-Policy that isn't set: the placeholder, which no policy names.
  expect(styleNonce(pageWith(`<meta name="${STYLE_NONCE_META}" content="__TAURI_STYLE_NONCE__">`))).toBeNull();
  expect(styleNonce(pageWith(`<meta name="${STYLE_NONCE_META}" content="">`))).toBeNull();
  expect(styleNonce(pageWith(`<meta name="${STYLE_NONCE_META}" content="a b">`))).toBeNull();
  expect(styleNonce(pageWith(""))).toBeNull();
  expect(editorStyleNonce(pageWith(""))).toEqual([]);
});

test("every CodeMirror editor is given the page's style nonce, so the <style> its themes go in is one the Content-Security-Policy allows (ADR 0050)", () => {
  const meta = document.createElement("meta");
  meta.name = STYLE_NONCE_META;
  meta.content = "4401";
  document.head.append(meta);

  const views = [
    diffEditor(parent(), diffDocument([]), "Diff", "notes.ts").view,
    sideEditor(parent(), "ours\n", "Ours", "", []),
    resolutionEditor(parent(), "resolved\n", "Resolution", "", () => {}),
  ];

  expect(views.map((view) => view.state.facet(EditorView.cspNonce))).toEqual(["4401", "4401", "4401"]);
  const styles = [...document.head.querySelectorAll("style")];
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.filter((style) => (style.nonce || style.getAttribute("nonce")) !== "4401")).toEqual([]);
  for (const view of views) view.destroy();
});
