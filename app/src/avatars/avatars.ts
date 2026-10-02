import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Authors' pictures from GitHub, for a repository whose remote is there
 * (ADR 0035): drawn in the Commit graph's lanes and beside each author's
 * name, in place of their initials once they've loaded. Only the author's
 * email, as the commit has it, goes to GitHub, and only while Settings'
 * "Pictures from GitHub" is on. Until one loads, offline, or with it off,
 * the initials are shown.
 */

/** The only place pictures come from. */
export const AVATAR_HOST = "https://avatars.githubusercontent.com";

/** How many pixels across a picture is asked for: enough for a high-density screen. */
const SIZE = 64;

/**
 * A GitHub user's picture for `email`: by their user ID from a GitHub
 * no-reply address, which names it, or else by the email itself, as GitHub
 * draws commits' authors. GitHub answers an email it doesn't know with an
 * identicon of its own.
 */
export function avatarUrl(email: string): string {
  const address = email.trim().toLowerCase();
  const noReply = /^(\d+)\+[^@]+@users\.noreply\.github\.com$/.exec(address);
  if (noReply) return `${AVATAR_HOST}/u/${noReply[1]}?s=${SIZE}`;
  return `${AVATAR_HOST}/u/e?email=${encodeURIComponent(address)}&s=${SIZE}`;
}

/** Whether `url` is a remote on GitHub.com, over HTTPS or SSH. */
export function isGitHubRemote(url: string | null): boolean {
  if (url === null) return false;
  return /^(https?:\/\/([^@/]+@)?|ssh:\/\/([^@/]+@)?|[^@/]+@)github\.com[/:]/i.test(url.trim());
}

type Picture = HTMLImageElement | "loading" | "failed";

const pictures = new Map<string, Picture>();
const listeners = new Set<() => void>();
let loaded = 0;

function changed() {
  loaded++;
  for (const listener of listeners) listener();
}

/**
 * `email`'s picture, if it has loaded; asking for it the first time. The
 * pictures load once for the run, and those that fail aren't asked for again.
 */
export function pictureOf(email: string): HTMLImageElement | null {
  const key = email.trim().toLowerCase();
  if (key === "") return null;
  const known = pictures.get(key);
  if (known !== undefined) return typeof known === "string" ? null : known;
  if (typeof Image === "undefined") return null;
  pictures.set(key, "loading");
  const image = new Image();
  image.decoding = "async";
  image.referrerPolicy = "no-referrer";
  image.addEventListener("load", () => {
    pictures.set(key, image);
    changed();
  });
  image.addEventListener("error", () => {
    pictures.set(key, "failed");
    changed();
  });
  image.src = avatarUrl(key);
  return null;
}

/** Counts the pictures that have loaded or failed, so what draws them draws again as they do. */
export function usePicturesLoaded(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => loaded,
    () => loaded,
  );
}

/** Whether pictures from GitHub are shown for the repository drawn: Settings allows them, and its remote is on GitHub. */
export const AvatarsShown = createContext(false);

export function useAvatarsShown(): boolean {
  return useContext(AvatarsShown);
}

/** Forgets every picture, for a test. */
export function forgetPictures(): void {
  pictures.clear();
  loaded = 0;
}
