# The project website, prerendered from React and deployed to GitHub Pages after each push to main

PRD §12.1 asks for a static project website on GitHub Pages at `https://lanewise.adrianeyre.co.uk/`, deployed from CI on pushes to `main` as soundcheck's is, with full SEO. It is a landing and download page, not the app: ADR 0003 stands, and Web Mode is still a local server. PRD §7.11 asks for the same footer on it as on every page, and PRD §11 for WCAG 2.2 AA. This ADR records how `website/` is built, what its head holds, where its download buttons come from and how `release.yml` deploys it.

## A package of its own, drawn from the app's components and stylesheet

`website/` is a third pnpm workspace package, `@lanewise/website`, beside `app` and `bench`. It is React, built by Vite, as the app is, so it can take what the app already has rather than copy it:

- the footer (`app/src/legal/Footer.tsx`), with its Cookie Policy, Accessibility and Credits dialogs, which open links in a new tab when no `onOpenLink` is given;
- `ExternalLink`, and the repository's URLs in `app/src/legal/links.ts`;
- the app's `styles.css`: the Theme's tokens for both themes, the type, the focus outline, reduced motion, `.button` and the footer's and dialogs' rules. `website/src/site.css` adds only the page's layout, in those tokens;
- the app's test helpers: `expectNoAxeViolations`, and the token and contrast functions in `app/src/test/styles.ts`.

It ships only React, React DOM and lucide-react, all of them among the app's own packages, which a test checks. So the footer's Credits are the app's, built by the same `credits` plugin from `app/`: Lanewise's npm packages and crates, the website's included.

The page isn't on a Grid (PRD §7.1) and has no Settings, so it has no Theme choice of its own. An inline script in `index.html` follows the OS's light or dark setting before first paint, and as it changes, as the app's System Theme does. It saves nothing, since the Cookie Policy says the website stores nothing on your device at all, and a test checks the website's code never touches storage.

## Drawn to HTML when it is built

Search engines, link previews and anyone without JavaScript should get the whole page, not an empty `<div>`. `vite build` builds two of Vite's environments in turn (`builder.buildApp` in `vite.config.ts`):

1. `ssr`, from `src/prerender.tsx`, into `website/.prerender/`, which is ignored and never shipped;
2. the client. A small plugin's `transformIndexHtml` imports the `ssr` build and puts `renderToString` of the page into `index.html`'s `<!--site-->`.

`src/main.tsx` then hydrates the same tree, which only the footer's dialogs need. The dev server hasn't drawn it, so there `main.tsx` renders it instead. A dedicated static-site generator would do the same with more to learn and another set of dependencies. Two builds of a page this size take about two seconds.

`base` is `/`: GitHub Pages serves the site at the root of its custom domain, `lanewise.adrianeyre.co.uk` (Settings → Pages → Custom domain), so Vite puts the icons and assets there. It was `/lanewise/`, where Pages serves a repository's site without one, until the custom domain was set; on the custom domain those paths were not found, and the page showed only its prerendered text, unstyled.

## The head holds soundcheck's SEO, and tests hold the head

`website/index.html` has what soundcheck's has:

- a title, description, keywords, author, canonical URL and `robots`;
- Open Graph, with a 1200 × 630 image and its alt text, and a `summary_large_image` Twitter card;
- an ICO, SVG and 16 and 32 px PNG favicons, a 180 px Apple touch icon and a web app manifest with 192 and 512 px icons and a maskable one;
- `color-scheme: light dark` and a `theme-color` for each theme, which are the Theme's `--background`s;
- `SoftwareApplication` JSON-LD: free, under the MIT licence, for Windows and macOS.

`public/` has `robots.txt`, which names `sitemap.xml`, and the sitemap, which lists the page. `website/src/head.test.ts` reads them all and checks that each file the head names is there at the size it says, each colour matches its token and every link to Lanewise is to `adrianeyre/lanewise` or its Pages.

The icons are drawn from the logo, `desktop/icons/logo.svg`, as the Desktop App's are, and the Open Graph image from `website/icons/og-image.svg`. `website/README.md` says how to draw them again.

## The downloads are the latest Release's, looked up when the site is built

The download buttons link to the latest Release's universal disk image and NSIS installer, whose names ADR 0029 fixes: `Lanewise_<version>_universal.dmg` and `Lanewise_<version>_x64-setup.exe`. The deploy job asks GitHub's API for `releases/latest`, which is never a draft or a pre-release, and names the file it saved in `LANEWISE_LATEST_RELEASE`. `downloadsOf` (`website/src/downloads.ts`) turns it into the links when Vite builds the page:

- a platform whose installer the Release lacks links to the Release's page;
- a link anywhere but this repository's Releases fails the build;
- before the first Release there is nothing to save, and the page says there's nothing to download yet and links to the Releases.

Looking the Release up in the visitor's browser instead would send every visitor's browser to GitHub's API, whose unauthenticated rate limit is shared by address, and would leave the buttons empty without JavaScript. A Release is only ever made by `release.yml` on a push to `main`, and the website is deployed at the end of that same run, so a build-time lookup is never out of date.

## `release.yml` deploys it last, and only where Pages is turned on

Two jobs at the end of `release.yml`, which runs on every push to `main` (ADR 0029):

- **`pages`** asks `repos/adrianeyre/lanewise/pages` whether GitHub Pages is on with GitHub Actions as its source (`build_type` `workflow`). If it isn't, the job prints a notice saying so and the website isn't deployed, and the run stays green. Turning Pages on is a one-time step for the maintainer (the README's "The project website").
- **`website`** runs only when Pages is on and everything before it has passed: `verify`, `release`, and `publish` when there was a Release to publish. It checks out the version commit semantic-release made, if it made one, so the footer's version is the Release's. It saves the latest Release, builds the site, and deploys `website/dist` with `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`. It has `pages: write` and `id-token: write` only, in the `github-pages` environment, one deployment at a time and never cancelled.

Only a push to `main` of `adrianeyre/lanewise` deploys: a `workflow_dispatch` run and a fork's `main` don't. The job installs Rust because the Credits run `cargo metadata`. A pull request's `ci.yml` builds the site on every operating system too, so a change that breaks the build fails before it reaches `main`.

## Checked by hand in Chrome, and by tests in jsdom

jsdom lays nothing out (see `app/src/test/axe.ts`), so the page's tests run axe on it in both themes, with and without a Release, and compute contrast from the tokens for each pair `site.css` draws. Lighthouse and axe in a real browser are hand checks, in both themes (`website/README.md`). When this was built, Lighthouse scored 100 for performance, accessibility, best practices and SEO in both, and axe found no violations on the page or in any footer dialog, at desktop and phone widths.
