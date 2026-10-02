import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

import { App } from "./App";
import { tauriPlatform } from "./platform/tauri";
import { unavailablePlatform } from "./platform/unavailable";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

const platform = tauriPlatform() ?? unavailablePlatform;

createRoot(root).render(
  <StrictMode>
    <App platform={platform} />
  </StrictMode>,
);
