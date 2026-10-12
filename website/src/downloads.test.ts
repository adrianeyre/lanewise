import { expect, test } from "vitest";

import { downloadsOf, type GitHubRelease, RELEASES_URL } from "./downloads";

const asset = (tag: string, name: string) => ({ name, browser_download_url: `${RELEASES_URL}/download/${tag}/${name}` });

function release(tag: string, names: string[]): GitHubRelease {
  return { tag_name: tag, html_url: `${RELEASES_URL}/tag/${tag}`, assets: names.map((name) => asset(tag, name)) };
}

test("the latest Release's disk image and installer are the downloads, and its page has the notes", () => {
  const latest = release("v1.4.2", [
    "Lanewise_1.4.2_universal.dmg",
    "Lanewise_1.4.2_x64-setup.exe",
    "Lanewise_universal.app.tar.gz",
    "Lanewise_1.4.2_x64-setup.exe.sig",
    "latest.json",
  ]);
  expect(downloadsOf(latest, "1.4.2")).toEqual({
    version: "1.4.2",
    notes: "https://github.com/adrianeyre/lanewise/releases/tag/v1.4.2",
    macos: "https://github.com/adrianeyre/lanewise/releases/download/v1.4.2/Lanewise_1.4.2_universal.dmg",
    windows: "https://github.com/adrianeyre/lanewise/releases/download/v1.4.2/Lanewise_1.4.2_x64-setup.exe",
  });
});

test("a platform whose installer the Release lacks links to the Release's page instead", () => {
  const latest = release("v2.0.0", ["Lanewise_2.0.0_universal.dmg"]);
  expect(downloadsOf(latest, "2.0.0").windows).toBe(`${RELEASES_URL}/tag/v2.0.0`);
  expect(downloadsOf(latest, "2.0.0").macos).toBe(`${RELEASES_URL}/download/v2.0.0/Lanewise_2.0.0_universal.dmg`);
});

test("an installer of another version isn't offered as this one", () => {
  const latest = release("v2.0.0", ["Lanewise_1.9.0_universal.dmg", "Lanewise_1.9.0_x64-setup.exe"]);
  expect(downloadsOf(latest, "2.0.0")).toMatchObject({ macos: `${RELEASES_URL}/tag/v2.0.0`, windows: `${RELEASES_URL}/tag/v2.0.0` });
});

test("a link anywhere but this repository's Releases is refused, so the build fails rather than offer it", () => {
  const elsewhere = release("v1.0.0", []);
  elsewhere.html_url = "https://github.com/someone/else/releases/tag/v1.0.0";
  expect(() => downloadsOf(elsewhere, "1.0.0")).toThrow(/not https:\/\/github\.com\/adrianeyre\/lanewise\/releases\/tag\/v1\.0\.0/);

  const download = release("v1.0.0", ["Lanewise_1.0.0_universal.dmg"]);
  download.assets[0]!.browser_download_url = "https://example.com/Lanewise_1.0.0_universal.dmg";
  expect(() => downloadsOf(download, "1.0.0")).toThrow(/Lanewise_1\.0\.0_universal\.dmg is at https:\/\/example\.com/);
});

test("only the Release the website is built from is offered, so the buttons are always the footer's version", () => {
  const latest = release("v2.0.0", ["Lanewise_2.0.0_universal.dmg", "Lanewise_2.0.0_x64-setup.exe"]);
  expect(() => downloadsOf(latest, "1.9.0")).toThrow(
    "The latest Release is v2.0.0, but the website is built from version 1.9.0",
  );
  expect(() => downloadsOf(release("2.0.0", []), "2.0.0")).toThrow(/latest Release is 2\.0\.0/);
  expect(() => downloadsOf(release("v2.0.0/x", []), "2.0.0")).toThrow(/latest Release is v2\.0\.0\/x/);
});
