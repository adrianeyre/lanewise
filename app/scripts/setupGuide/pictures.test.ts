import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

import { expect, test } from "vitest";

import { APP_SCENES } from "./appScenes";
import { DRAWINGS } from "./drawings";
import { APP_SCENE_NAMES, DRAWING_NAMES, PICTURES, PICTURES_FOLDER } from "./pictures";

const root = join(import.meta.dirname, "..", "..", "..");
const GUIDES = ["docs/setup/README.md", "docs/setup/windows.md", "docs/setup/macos.md", "docs/setup/linux.md", "docs/setup/first-steps.md"];

function findImages(guide: string): { alt: string; path: string }[] {
  const text = readFileSync(join(root, guide), "utf8");
  return [...text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map(([, alt = "", target = ""]) => ({
    alt,
    path: normalize(join(dirname(guide), target)).replaceAll("\\", "/"),
  }));
}

const IMAGES = GUIDES.flatMap((guide) => findImages(guide).map((image) => ({ guide, ...image })));

test("each scene the pictures name is one the page draws, and each it draws is pictured", () => {
  expect(APP_SCENE_NAMES.toSorted()).toEqual(Object.keys(APP_SCENES).toSorted());
  expect(DRAWING_NAMES.toSorted()).toEqual(Object.keys(DRAWINGS).toSorted());
  const files = PICTURES.map(({ file }) => file);
  expect(files).toEqual([...new Set(files)]);
});

test("every picture is in the pictures folder, and nothing else is", () => {
  const taken = readdirSync(join(root, PICTURES_FOLDER)).toSorted();
  expect(taken).toEqual(PICTURES.map(({ file }) => file).toSorted());
});

test("every Setup picture is in a Setup guide, and every image a guide shows is there", () => {
  const shown = new Set(IMAGES.map(({ path }) => path));
  expect(PICTURES.map(({ file }) => `${PICTURES_FOLDER}/${file}`).filter((path) => !shown.has(path))).toEqual([]);
  expect(IMAGES.filter(({ path }) => !existsSync(join(root, path))).map(({ guide, path }) => `${guide}: ${path}`)).toEqual([]);
});

test("every image in the Setup guides says what it shows in words", () => {
  expect(IMAGES.filter(({ alt }) => alt.split(" ").length < 8).map(({ guide, path }) => `${guide}: ${path}`)).toEqual([]);
});
