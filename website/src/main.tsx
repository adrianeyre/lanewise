import "../../app/src/styles.css";
import "./site.css";

import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { Site } from "./Site";

const root = document.getElementById("root")!;
const site = (
  <StrictMode>
    <Site downloads={import.meta.env.VITE_DOWNLOADS} />
  </StrictMode>
);

// A build has already drawn the page (`prerender.tsx`), which this makes the
// footer's dialogs work on; the dev server hasn't, so it draws it here.
if (root.firstElementChild) hydrateRoot(root, site);
else createRoot(root).render(site);
