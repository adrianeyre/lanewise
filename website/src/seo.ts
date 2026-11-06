import { SCREENSHOTS } from "./screenshots";

// What search engines read of the website beyond its head's tags: its
// structured data and its sitemap, both drawn when it is built, from the
// version and Release it is built with and the screenshots the page shows.

/** Where GitHub Pages serves the website: this repository's custom domain, at its root (ADR 0031). */
export const SITE = "https://lanewise.adrianeyre.co.uk/";

/** The picture a shared link previews with, in `public/`, 1200 by 630. */
export const OG_IMAGE = "og-image.png";

const REPOSITORY = "https://github.com/adrianeyre/lanewise";

const DESCRIPTION =
  "A free, open-source desktop Git client for Windows and macOS, with a visual commit graph and AI-assisted merge conflict resolution.";

/** What Lanewise does, as the page's feature grid says it. */
export const FEATURES = [
  "A visual Commit graph, with branches, tags and remotes labelled, quick on a repository of more than 100,000 commits",
  "Stage files or single hunks, commit and amend",
  "Clone, fetch, pull and push through the Git you already have",
  "Apply, pop and drop stashes from the Commit graph",
  "Split diffs, side by side",
  "A three-way view of merge conflicts: Base, Ours and Theirs, resolved one Conflict Hunk at a time",
  "AI Suggestions for merge conflicts from Claude, Gemini, OpenAI, xAI, Meta or a local model, with your own API key, never applied for you",
  "Sign-in to GitHub.com and GitHub Enterprise Server through Git Credential Manager",
  "No account, no telemetry and no subscription",
] as const;

/**
 * The page's JSON-LD: the website, its author and Lanewise itself, at
 * `version`, linked by their `@id`s, with the Release's `notes` when there is
 * one. It claims no rating or review, since Lanewise has none to give.
 */
export function structuredData({ version, author, notes }: { version: string; author: string; notes: string | null }): object {
  const website = `${SITE}#website`;
  const person = `${SITE}#author`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": website,
        url: SITE,
        name: "Lanewise",
        description: DESCRIPTION,
        inLanguage: "en-GB",
        publisher: { "@id": person },
      },
      { "@type": "Person", "@id": person, name: author },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE}#software`,
        name: "Lanewise",
        description: DESCRIPTION,
        url: SITE,
        mainEntityOfPage: { "@id": website },
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Git client",
        operatingSystem: "Windows 10, Windows 11, macOS 14 or later",
        softwareVersion: version,
        downloadUrl: `${REPOSITORY}/releases/latest`,
        ...(notes === null ? {} : { releaseNotes: notes }),
        image: `${SITE}${OG_IMAGE}`,
        screenshot: SCREENSHOTS.map((screenshot) => ({
          "@type": "ImageObject",
          contentUrl: `${SITE}${screenshot.src}`,
          width: screenshot.width,
          height: screenshot.height,
          caption: screenshot.caption,
        })),
        featureList: [...FEATURES],
        license: "https://opensource.org/license/mit",
        isAccessibleForFree: true,
        codeRepository: REPOSITORY,
        author: { "@id": person },
        offers: { "@type": "Offer", price: "0", priceCurrency: "GBP" },
      },
    ],
  };
}

/** `data` as a JSON-LD `<script>`, with every `<` escaped so no text in it can close the element. */
export function structuredDataScript(data: object): string {
  const json = JSON.stringify(data, null, 2).replaceAll("<", "\\u003c");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * The sitemap: the one page, with the pictures on it for image search, and
 * when it last changed, which is when the Release it offers was published,
 * since that is what changes its version and downloads. Built without a
 * Release, it says no date rather than guess one.
 */
export function sitemap(lastModified: string | null): string {
  const images = [OG_IMAGE, ...SCREENSHOTS.map(({ src }) => src)].map(
    (src) => `    <image:image>\n      <image:loc>${xml(`${SITE}${src}`)}</image:loc>\n    </image:image>\n`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n',
    "  <url>\n",
    `    <loc>${xml(SITE)}</loc>\n`,
    lastModified === null ? "" : `    <lastmod>${xml(lastModified)}</lastmod>\n`,
    ...images,
    "  </url>\n",
    "</urlset>\n",
  ].join("");
}
