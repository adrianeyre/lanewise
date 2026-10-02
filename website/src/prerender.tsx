import { StrictMode } from "react";
import { renderToString } from "react-dom/server";

import { Site } from "./Site";

/**
 * The page as HTML, which the build puts in `index.html` (`vite.config.ts`),
 * so search engines, link previews and anyone without JavaScript get all of
 * it. `main.tsx` hydrates the same tree.
 */
export function prerender(): string {
  return renderToString(
    <StrictMode>
      <Site downloads={import.meta.env.VITE_DOWNLOADS} />
    </StrictMode>,
  );
}
