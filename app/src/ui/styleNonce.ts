import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** The `<meta>` in `index.html` that Tauri puts this page load's style nonce in. */
export const STYLE_NONCE_META = "lanewise-style-nonce";

/**
 * The nonce the Desktop App's Content-Security-Policy allows `<style>`
 * elements by for this page load (ADR 0050), or `null` where the page has
 * none: in a test, the browser in `pnpm dev`, or the placeholder Tauri
 * hasn't replaced, which no policy names.
 */
export function styleNonce(page: Document = document): string | null {
  const nonce = page.querySelector<HTMLMetaElement>(`meta[name="${STYLE_NONCE_META}"]`)?.content ?? "";
  return /^[A-Za-z0-9+/=_-]+$/.test(nonce) && !nonce.startsWith("__") ? nonce : null;
}

/**
 * Gives a CodeMirror editor the page's style nonce, so the `<style>`
 * element its themes are written into is one the Content-Security-Policy
 * allows. Every editor gets it: whichever is made first writes the element.
 */
export function editorStyleNonce(page: Document = document): Extension {
  const nonce = styleNonce(page);
  return nonce === null ? [] : EditorView.cspNonce.of(nonce);
}
