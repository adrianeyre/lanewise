import { REPOSITORY_URL } from "../../app/src/legal/links.ts";

/** Every Release, which the download section links to when there isn't one yet. */
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;

/**
 * The latest Release, as much of it as the website needs, as GitHub's API
 * gives it: `GET /repos/adrianeyre/lanewise/releases/latest`, which is never
 * a draft or a pre-release. The deploy job saves it to a file and names it in
 * `LANEWISE_LATEST_RELEASE` for the build (`vite.config.ts`).
 */
export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

/** What the download buttons link to: the latest Release's installers, or its page where one is missing. */
export interface Downloads {
  version: string;
  /** The Release's page, with its notes. */
  notes: string;
  /** The universal disk image, for Apple Silicon and Intel Macs. */
  macos: string;
  /** The NSIS installer, for Windows on x64. */
  windows: string;
}

/**
 * The downloads of `release`, whose installers are named for its version as
 * the release workflow names them (ADR 0029). A Release without one of them
 * links that button to its page instead. A Release of any version but
 * `version`, the one the website is built from and its footer shows, and a
 * link anywhere but this repository's Releases, are refused (ADR 0054).
 */
export function downloadsOf(release: GitHubRelease, version: string): Downloads {
  if (release.tag_name !== `v${version}`) {
    throw new Error(`The latest Release is ${release.tag_name}, but the website is built from version ${version}`);
  }
  const notes = `${RELEASES_URL}/tag/${release.tag_name}`;
  if (release.html_url !== notes) throw new Error(`The latest Release's page is ${release.html_url}, not ${notes}`);
  const asset = (name: string) => {
    const url = release.assets.find((candidate) => candidate.name === name)?.browser_download_url;
    if (url !== undefined && url !== `${RELEASES_URL}/download/${release.tag_name}/${name}`) {
      throw new Error(`The latest Release's ${name} is at ${url}, not on ${RELEASES_URL}`);
    }
    return url ?? notes;
  };
  return {
    version,
    notes,
    macos: asset(`Lanewise_${version}_universal.dmg`),
    windows: asset(`Lanewise_${version}_x64-setup.exe`),
  };
}
