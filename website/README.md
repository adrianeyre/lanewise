# The project website

Lanewise's page on GitHub Pages, `https://lanewise.adrianeyre.co.uk/` (PRD §12.1, ADR 0031): what Lanewise is, screenshots, the latest Release's downloads, the documentation and the footer. It is not the app (ADR 0003).

```bash
pnpm website:dev    # the page, drawn in the browser, at http://localhost:5160/
pnpm website:build  # website/dist, with the page drawn into index.html
pnpm --filter @lanewise/website preview  # serves website/dist at http://localhost:5160/
```

`pnpm test` and `pnpm typecheck` include it. `release.yml` deploys it after each push to `main` (`docs/releases.md`, "The project website").

## The downloads

The build offers the Release it is given in `LANEWISE_LATEST_RELEASE`, the path to a JSON file of GitHub's `releases/latest`, and says there's nothing to download yet without one. To see the buttons locally:

```bash
gh api repos/adrianeyre/lanewise/releases/latest > /tmp/latest-release.json
LANEWISE_LATEST_RELEASE=/tmp/latest-release.json pnpm website:build
```

## Screenshots

`public/screenshots/` has Lanewise at 1680 × 1050, as lossless WebP: the Repository page and a file's split diff in the light Theme, and the Conflicts page in the dark Theme. They were taken of the Desktop App, over WebDriver under Xvfb as `bench/` drives it, of a demo repository: a small weather-station project with a branch merged and two open, tags, a remote, a stash and changes in the working tree, and a clone of it partway through merging `origin/feature/units`, conflicted in `src/format.ts`. Its authors are made up, with `example.com` emails, so no one's picture is fetched. `src/screenshots.ts` describes each in words. A new one goes in both, with its size, and `head.test.ts` checks the file is that size.

`pnpm website:screenshots` takes them again: `scripts/demoRepository.sh` makes the demo repository in a temporary folder, and `scripts/screenshots.ts` opens it in the Desktop App's release build through `tauri-driver`, as `bench/` does, and writes each file. It needs the release build, `tauri-driver`, WebKitGTK's `WebKitWebDriver` and ImageMagick, as `bench/README.md` says, and on Linux a 1680 × 1050 screen:

```bash
pnpm exec tauri build --no-bundle
xvfb-run -a -s "-screen 0 1680x1050x24" pnpm website:screenshots
```

Check each one, and its words in `src/screenshots.ts` and the README, before committing it. To convert a PNG by hand:

```bash
convert shot.png -strip -define webp:lossless=true public/screenshots/<name>.webp
```

## The icons and the Open Graph image

These are drawn from the logo, `desktop/icons/logo.svg`, with its mark in `public/favicon.svg`, `icons/maskable.svg` and `icons/og-image.svg`; `app/public/` has copies of the favicons and device icons. ImageMagick's own SVG renderer drops the strokes and the text, so the PNGs come from Tauri's icon command, which uses resvg, and the Open Graph image from Chrome:

```bash
pnpm exec tauri icon website/public/favicon.svg -o /tmp/icons -p 16,32,48,192,512
pnpm exec tauri icon website/icons/maskable.svg -o /tmp/maskable -p 180,512
cp /tmp/icons/16x16.png website/public/favicon-16.png
cp /tmp/icons/32x32.png website/public/favicon-32.png
cp /tmp/icons/192x192.png website/public/icon-192.png
cp /tmp/icons/512x512.png website/public/icon-512.png
cp /tmp/maskable/180x180.png website/public/apple-touch-icon.png
cp /tmp/maskable/512x512.png website/public/icon-maskable-512.png
convert /tmp/icons/16x16.png /tmp/icons/32x32.png /tmp/icons/48x48.png website/public/favicon.ico
chrome --headless --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 \
  --screenshot=website/public/og-image.png website/icons/og-image.svg
```

## Hand checks

jsdom lays nothing out, so the tests can't measure the page as a browser draws it. Before a change to how it looks, build it, serve it with `preview`, and in Chrome, with `prefers-color-scheme` set to light and then dark (DevTools → Rendering → Emulate CSS media feature):

- run Lighthouse (DevTools → Lighthouse): accessibility and SEO must be 100;
- run axe (the axe DevTools extension) on the page and on each footer dialog: no violations;
- check it at a phone's width and at 200% zoom, and go through it with the keyboard alone.
