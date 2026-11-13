import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../../src/styles.css";
import "./drawings.css";

import { AppScene, isAppScene } from "./appScenes";
import { Drawing, isDrawing } from "./drawings";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

const scene = decodeURIComponent(location.hash.slice(1));

function findScene() {
  if (isAppScene(scene)) return <AppScene name={scene} />;
  if (isDrawing(scene)) return <Drawing name={scene} />;
  throw new Error(`No scene named “${scene}”`);
}

createRoot(root).render(<StrictMode>{findScene()}</StrictMode>);
