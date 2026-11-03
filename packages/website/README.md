# React Anatomy website

Custom Astro landing page at `/`, with Starlight docs under `/docs/`. The static site is configured for `https://react-anatomy.com`. Hosting settings are in [Deployment](#deployment) below.

From the repository root:

```sh
pnpm run dev
pnpm run build:website
pnpm run check
```

To inspect the built website, run `pnpm --filter @react-anatomy/website run preview`. Use the URL printed by Astro.

- `src/pages/index.astro`: landing page.
- `src/components/InteractiveDemo.astro`: example browser frame and walkthrough controls.
- `src/scripts/interactive-demo.ts`: lazy inspector loading and walkthrough coordination.
- `demo/`: sample bridge, alternate inspector transport, and viewport styles.
- `scripts/build-demo.ts`: bundles the shared extension code into the ignored `public/interactive/` directory.
- `scripts/check-demo.ts`: real-browser regression checks for the example and docs.
- `src/styles/landing.css`: responsive landing-page styles.
- `src/content/docs/docs/`: Starlight documentation. `index.md` explains the mental model (the rendered page and its React tree, not the import graph); `understand`, `explain-a-change` and `generated-code` are task guides; `explore`, `props`, `limitations` and `development` are reference pages. The sidebar groups are defined in `astro.config.ts`.
- `src/pages/404.astro`: missing-page content.
- `src/styles/docs.css`: shared brand colours for Starlight.
- `public/media/`: native extension screenshots used by the landing page and docs. `composition-front.png` (the capture beside the Excalidraw sketch) is a real DevTools capture of the Orbit sample at a 1000×640 viewport: Front camera, 65% separation, ProjectList selected, component tree hidden, panel zoom at 90%, cropped to the composition at native 3× density (2901×1812). The ignored `artifacts/live-demo-review/capture-front-v3.mjs` helper reproduces it with the extension harness. It sets the browser scale as well as the DevTools viewport scale and verifies that the panel reports `devicePixelRatio === 3`; increasing only the outer screenshot size leaves the embedded panel at 1× and produces soft text.

Brand assets are imported from `@react-anatomy/brand`. The logo and favicon are built from shared source. The interactive example imports the actual Orbit React fixture and inspector from `@react-anatomy/extension`; only the transport is replaced with a bridge to the bundled sample. It cannot inspect other sites. The extension’s inspector, props handling, and layout code remain unchanged.

The sample loads with the page; the heavier inspector loads when a visitor opens Anatomy. The `predev` and `prebuild` scripts generate both bundles. After editing inspector or demo source while the Astro dev server is already running, run `pnpm --filter @react-anatomy/website exec node scripts/build-demo.ts` and reload the page.

Wheel and trackpad scrolling over either example frame moves the landing page. The website intercepts wheel events before they reach the shared inspector, including over the tree and props pane; zoom buttons and mouse dragging remain available. On touch devices, Orbit uses native browser scrolling: its clipped document cannot scroll internally, so swipes scroll the landing page with normal gesture handling. In the inspector, drags starting in the 3D canvas rotate the view without scrolling the page; swipes elsewhere are forwarded using screen coordinates, which stay stable as the iframe moves. Splitters and sliders also keep their own touch gestures. The extension itself keeps its normal scroll-to-zoom behaviour. Browser zoom gestures retain their default handling. The forwarding is reattached when either frame reloads or the example restarts.

Run `pnpm run test:website` at the repository root for the browser checks. Tests start their own static server against the production build. As with the extension tests, install Playwright Chromium or provide `CHROME_PATH` and optionally `CHROME_SYSROOT`.

The documentation uses real screenshots of the native DevTools extension. Screenshots and diagrams on the landing page and in the docs open in a PhotoSwipe lightbox without changing the URL. The viewer supports zoom, touch gestures, arrow-key navigation, Escape to close, and focus restoration. The viewer core and full-size image dimensions load on first interaction; the normal image link remains as a no-JavaScript fallback. The previous video, poster, and subtitles are preserved under the ignored `artifacts/previous-intro/` folder and are no longer served.

## Automatic demo introduction

On the first downward scroll to the example, `demo-introduction.ts` briefly holds the page, moves an illustrated cursor to the Anatomy tab, and opens the real inspector. Scrolling resumes after separation finishes, with a hard 3.5-second limit even if loading fails. Escape, Skip intro, reversing direction, or interacting with the demo cancels the sequence. Keyboard navigation bypasses it; reduced motion opens the inspector without moving the cursor or holding scroll.

A single `react-anatomy.demo-introduction` flag in session storage prevents replay in that tab session. No data leaves the browser. To replay during development, run `sessionStorage.removeItem('react-anatomy.demo-introduction'); location.reload();` in the page console. The browser tests use fresh sessions for this flow and mark it seen when testing the existing manual walkthrough.

## Excalidraw illustration

The landing page's layout diagram is a real Excalidraw drawing. Its editable source and SVG/PNG exports live in `public/media/diagrams/page-composition.*`. Open the `.excalidraw` file in Excalidraw to edit it, then save it back to that location.

Run `pnpm --filter @react-anatomy/website run export:diagram` to regenerate the exports with the pinned Excalidraw editor and its own export functions. This uses Playwright Chromium with the same `CHROME_PATH`/`CHROME_SYSROOT` options as the browser checks. The SVG embeds Excalifont, the PNG is exported at 2×, and both include the editable scene. The exporter also saves an editor screenshot to the ignored `artifacts/excalidraw/` directory for review.

Excalidraw is a development dependency; the landing page loads only the static SVG. Rebuild the website after exporting to update the production preview.

## Editorial note

The release scope is Chrome and Firefox. A separate Edge store listing is deferred. Safari is excluded because the project will not take on the annual Apple Developer Program fee. Keep that scope separate from technical API compatibility.

This is a developer tool, not a product being sold. Write the landing page and docs as one developer explaining a tool to another: what it is (a browser extension that adds an Anatomy panel to the browser’s developer tools), how it works, and when the view is useful. Keep the page-composition mental model and the Excalidraw origin story. Avoid conversion language, growth tactics, promotional hype, competitive claims against other tools, invented social proof, and claims that a store listing is live before it exists. The owner requested placeholder install links in the browser section; use those until the real store URLs exist. Frame the product as browser-neutral; state current validation separately and precisely (separate MV3 builds with automated checks in Chromium and desktop Firefox 140.0 ESR and 159.0), without claiming tested support on other browsers.

Compatibility facts for future wording, checked against MDN browser-compat-data (`webextensions/api/devtools.json`, `webextensions/manifest/background.json`): `devtools.panels.create`, `devtools.inspectedWindow.eval`, `devtools.network.onNavigated` and the `devtools_page` manifest key are supported on desktop Chrome, Firefox and Safari (Safari since 16), so do not describe Safari as fundamentally unsupported. Firefox lacks `background.service_worker`; our Firefox build uses a `background.scripts` manifest variant and has its own native browser tests; Firefox supports `scripting.ExecutionWorld.MAIN` since 128. Safari would need its own packaging and validation. `devtools_page` is not available on Firefox for Android or Safari on iOS. Source: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools/panels/create

The install section sits immediately below the live example and uses the selected “Two routes” layout: Chrome Web Store and Firefox Add-ons each have an install action, with the Brave/Edge logos and compatibility note inside the Chrome route. The routes sit side by side on wider screens and stack on phones. Store labels and controls use Instrument Sans; the browser icons are hosted locally. Keep the quiet Compatibility notes link beside the section heading. The “Add to Chrome” / “Add to Firefox” links remain placeholders, without development or validation labels. Clicking a placeholder reveals “Download links coming soon.” on the same page. When store listings exist, replace each anchor’s `href` and remove its `data-store-placeholder` attribute; remove the placeholder handler and notice when both are live. Keep detailed implementation and validation records in the local, ignored `docs/validation/` notes. Icon sources and attribution are in `public/media/browsers/README.md`.

The landing page previews the intended install flow with placeholder links. There are no live store links, store badges, signup forms, analytics, or placeholder social accounts. The production `site` URL is `https://react-anatomy.com`; setting it generates canonical URLs and the sitemap but does not deploy the site.

Pagefind is pinned to 1.5.2 at the workspace root. Its 1.6 Linux binary crashes with an illegal instruction on the current host CPU, while 1.5.2 works and satisfies Starlight’s supported range. `scripts/check-build.ts` verifies that the generated search assets exist, because the upstream service failure can otherwise let Astro exit successfully without an index.

The header GitHub link points to the public repository at `https://github.com/charpeni/react-anatomy`. Browser install links remain their existing placeholders. The public `/docs/compatibility/` page covers browser and React requirements plus practical limits. Keep exact build numbers, test counts, dated results, and remaining QA work in the local, ignored `docs/validation/` notes.

## Typography

The website and documentation use **Instrument Sans**, self-hosted as variable WOFF2 files in `public/fonts/instrument-sans/`. Shared font faces and the `--font-sans` token live in `src/styles/fonts.css`; Starlight uses the same token. Normal and italic styles cover weights 400–700. The Latin regular face is preloaded, with italic and Latin Extended subsets loaded as needed. Provenance, checksums, and the OFL license are included with the font files. The native inspector and sample app retain their own typography, and the approved outlined logo lockups remain Inter.

## Landing introduction

`ExplodedHero.astro` presents the introduction as a fixed, front-facing composition of HTML layers. The component labels are a hand-authored illustration, with Emphasis nested inside Heading. There is no camera interaction or extra keyboard stop; the text stays selectable and the links remain ordinary links.

The layers separate once on load using CSS transforms. Reduced motion and JavaScript-disabled browsers show the completed view immediately; focusing a hero link finishes the entrance. Keep this illustration separate from the live React capture in the example below it.

## 404 page

`Exploded404.astro` presents the missing-page label, heading, and navigation as real HTML on CSS 3D planes. The component-style labels illustrate this static page; they do not come from a captured React tree. The view unfolds once, then stays exploded. Its only interaction is camera rotation: drag with a mouse, swipe horizontally on touch, or focus the view and use arrow keys. Vertical touch scrolling and pinch zoom remain native, and links never start a drag.

`src/scripts/exploded-404.ts` handles rotation and input cancellation. Reduced motion skips the entrance; without JavaScript, the static exploded page and both navigation links still work. Keep the response status at 404 and the page marked `noindex`. The website browser suite checks those behaviors along with narrow layouts and navigation from the transformed links.

## Search and sharing

`src/lib/site.ts` owns the production URL, product description, maintainer identity, and structured metadata. `Seo.astro` provides the landing-page metadata; `DocsHead.astro` extends Starlight's existing head without duplicating its title, description, or canonical URL. Public pages have Open Graph and Twitter previews and JSON-LD describing the website, software, and documentation. Do not add ratings, store URLs, release dates, or availability claims until they are real. Keep supported-version statements in the metadata and FAQ aligned with the compatibility guide.

`/robots.txt` points to Starlight's sitemap. The sitemap contains canonical HTML pages; the bundled example and 404 page stay out of search results. `src/integrations/static-headers.ts` writes Cloudflare's `_headers` file so the demo resources and text equivalents receive `X-Robots-Tag: noindex`. Markdown responses also identify their canonical HTML page with an HTTP `Link` header. Crawling stays allowed so these directives can be read.

`/llms.txt` is an optional documentation index for agents. Every guide and the privacy policy also have a `.md` URL, linked from the documentation footer and head. These files are generated from the same content collection as the HTML, with absolute links and a source URL for citation. There is no separate copy of the docs to maintain. Clear, crawlable content is the foundation of search and AI discovery; these text exports are a convenience, not a ranking mechanism. See [Google's guidance for AI features](https://developers.google.com/search/docs/appearance/ai-features).

The social preview is a 1200×630 PNG composed from the shared logo, Instrument Sans, and the real extension screenshot. To refresh it locally with Playwright Chromium installed:

```sh
pnpm --filter @react-anatomy/website run generate:social
```

Review `public/media/react-anatomy-social.png` before committing it. Deployment serves this checked-in image and does not need a browser to render it. Landing-page screenshot thumbnails use responsive WebP variants; image viewers retain the full-resolution originals.

Build checks cover the sitemap, crawl directives, text exports, citation links, and preview dimensions. The website browser suite verifies one canonical URL and description per public page, structured metadata, social previews, and image-viewer behavior.

Once the domain is connected, verify `react-anatomy.com` in Google Search Console and Bing Webmaster Tools and submit `https://react-anatomy.com/sitemap-index.xml`. Those account-level steps are separate from deployment. If Cloudflare bot settings change, verify that search crawlers can still fetch the public pages and robots file.

## Privacy policy

The extension policy is at `/privacy/`, authored in `src/content/docs/privacy.md`, and linked from the landing and documentation footers. Its production address is `https://react-anatomy.com/privacy/`, with `info@react-anatomy.com` as the contact. Keep the wording aligned with extension behavior, especially persistence, external page assets, and props that may contain sensitive data.

## Deployment

Cloudflare Workers serves the static website and public docs. The root `wrangler.jsonc` points to the built files; no server or Astro adapter is needed.

Connect `charpeni/react-anatomy` through the Worker's GitHub integration, then use these build settings:

| Setting                    | Value                         |
| -------------------------- | ----------------------------- |
| Production branch          | `main`                        |
| Root directory             | Repository root (leave blank) |
| Build command              | `pnpm run build:website`      |
| Deploy command             | `pnpm exec wrangler deploy`   |
| `NODE_VERSION`             | `24.22.1`                     |
| `PNPM_VERSION`             | `12.16.1`                     |
| `ASTRO_TELEMETRY_DISABLED` | `1`                           |

The Worker name must match `name` in `wrangler.jsonc`. Wrangler is pinned in the root package. `pnpm check:deploy` verifies the build and deployment configuration without publishing; `pnpm deploy:website` builds and deploys using your Cloudflare credentials.

After deployment succeeds, add `react-anatomy.com` under the Worker's **Settings → Domains & Routes → Add → Custom domain**. Check the landing page, `/docs/`, `/privacy/`, the live example, search, screenshot viewers, and a nonexistent URL. Unknown paths must return the site's 404 page, not the landing page.

GitHub integration deploys `main`; it does not publish the browser extensions.
