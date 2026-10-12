# A Content-Security-Policy for the project website, and its downloads the Release it is built from

The Project website (ADR 0031) is the page a visitor downloads Lanewise from, so what it links to and what it runs matter as much as the installers do. Until now it had no Content-Security-Policy: GitHub Pages sends no headers of a site's own, and nothing had been put in the page instead. Its download buttons were built from whichever Release GitHub's `releases/latest` named, as long as every link was on this repository's Releases. React draws everything the page shows as text, and the page loads nothing from another origin, so no way in was known. But nothing stood behind either if it ever failed. The pen-testing PRD's R4 (#30) asked whether Release data read at build time could reach the page or change a download link, about the page's inline scripts and whether a meta CSP would hold, and whether anything third-party is loaded. This is the answer, as defence in depth.

## A policy in the page's head, put there when it is built

`website/vite.config.ts` puts a `<meta http-equiv="Content-Security-Policy">` straight after `<meta charset>`, before anything it governs, when the site is built:

| Directive | Sources | Why |
| --- | --- | --- |
| `default-src` | `'self'` | The page's stylesheet, chunks, icons, screenshots and manifest are all its own. A font, picture, frame or request anywhere else is refused |
| `script-src` | `'self'`, the theme script's `sha256` | Vite's module script and its lazy chunks, and the one inline script, which follows the OS's light or dark setting before first paint |
| `style-src` | `'self'` | The built stylesheet. The page has no `style` attribute or `<style>`; React and the theme script set styles through the CSSOM, which the policy allows |
| `object-src` | `'none'` | No plugin content |
| `base-uri` | `'none'` | Nothing can move where the page's relative links point |
| `form-action` | `'none'` | The page has no form |

The JSON-LD block is data, which no browser runs, so the policy doesn't name it. `'unsafe-inline'`, `'unsafe-eval'`, `data:`, `blob:`, wildcards and other origins appear nowhere. The hash is worked out from `index.html` as the config loads, and the config refuses to load if `index.html` has any inline script but the theme's, so a second one fails the build and every website test rather than be refused in a visitor's browser.

The policy is put in only when the site is built. The dev server and React's refresh run inline scripts of their own, so `pnpm website:dev` has none, as `pnpm dev` has none for the app (ADR 0050).

Every directive is one each browser engine knows. `manifest-src`, the narrowest for the manifest, is left out because WebKit doesn't know it and says so in the console; `default-src 'self'` covers it in every engine.

## The downloads are the Release the website is built from

`downloadsOf` (`website/src/downloads.ts`) now takes the version the website is built from, the root `package.json`'s, which is also the footer's, and refuses a Release whose tag isn't `v` and that version. `release.yml`'s `website` job checks out the Release's tag when the run made one, and `main` otherwise, where `package.json` holds the last Release's version, since semantic-release commits it there (ADR 0029). So the version a visitor sees in the download section and in the footer are always the same, and a tag can only ever be one shape. The rest of what ADR 0031 said holds: every link is on this repository's Releases, a platform whose installer is missing links to the Release's page, and a Release's other words, its name, notes and author, are never read.

A Release made any other way, such as by hand, fails the website's build with a message naming both versions, and the website stays as it was until the next push to `main` builds it again.

## What it doesn't do

- **It can't stop the page being framed.** `frame-ancestors` has no effect in a `<meta>`, and GitHub Pages sends no `X-Frame-Options`. The page has nothing to do but follow links, and a framed download link still downloads the Release's file.
- **It holds against what's in front of the site, too.** The custom domain is served through Cloudflare (its `server` header), which can add scripts of its own to a page, such as an analytics beacon. On 12 October 2026 it added none: every file the site served was the same, byte for byte, as this tree builds. If one is ever turned on, the policy refuses its script.
- **It doesn't stop what the build itself writes.** The policy is written by the build. An npm package the build runs could write another policy, or another page. That's the same trust the Desktop App's build has (R2's record), and the website's build runs with a token that can only read.
- **It doesn't make a Release's files what was built.** The download links name files on the Release. Who can change a Release's files once it's published is ADR 0052's.

## Look again

When the page loads something from another origin, such as a web font; if the site is ever sent with headers of its own, by Cloudflare or another host, where the policy should go in a header too, with `frame-ancestors 'none'`; at the next Pen-test round; and by **12 April 2027** at the latest, whichever comes first.

## Considered options

- **No policy, with a dated decision.** Left out: the policy costs one small plugin and a test, and in WebKitGTK the built page raised no violation while every injected script, picture, request and inline style the round tried was refused.
- **The theme script as a file of its own**, so the policy needs no hash. Left out for the reason ADR 0050 gives for the app: it would be one more request before first paint, and the hash costs nothing to keep.
- **Hashing every inline script the built page has.** Left out: anything that got into the page as it was built would be hashed and allowed with it. The hash is of the source's one script.
- **`require-trusted-types-for 'script'`.** Only Chromium has it, and the page has no HTML sink for it to guard.
- **Checksums beside the download buttons.** Left out: they would come from the same Release as the files, so they would add no trust a changed Release didn't also change.

## Consequences

- A change that makes the page load something new, from another origin or inline, has to change the policy and `website/src/build.test.ts`, and be checked in a browser on the built site, since the dev server has no policy.
- `website/src/build.test.ts` builds the website as the deploy job does, with a Release whose own words hold markup, and checks the policy, what the page loads, and its download links. It adds about two seconds to `pnpm test`.
- A Release made by hand, rather than by `release.yml`, isn't offered on the website.

## Hand checks

On the deployed site, `https://lanewise.adrianeyre.co.uk/`, in Chrome, Firefox and Safari, with each one's console open:

1. Load the page. The console shows no message naming `Content-Security-Policy`, and the page draws in the OS's light or dark setting with no flash of the other.
2. Change the OS between light and dark. The page follows.
3. Open each footer dialog: the version's Changelog, Privacy Policy, Terms and Conditions, Cookie Policy, Accessibility and Credits. Each opens, with its text, and still no message in the console.
4. In Chrome's DevTools → Network, reload. Every request is to `lanewise.adrianeyre.co.uk`.
5. Check that the download buttons' version, the footer's version and the latest Release on GitHub are the same.
6. Run Lighthouse, as `website/README.md` says. Best practices is still 100.
7. In Cloudflare's dashboard for `adrianeyre.co.uk`, check that nothing adds a script to `lanewise.adrianeyre.co.uk`: Web Analytics' automatic setup, Rocket Loader and Zaraz are off. The policy would refuse their scripts, and Rocket Loader would stop the page's own from running.
