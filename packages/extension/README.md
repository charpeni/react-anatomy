# React Anatomy

See how your React page is built. In 3D.

A browser extension for understanding how a React page is composed. Capture the page, separate its component hierarchy in 3D, select components on the page, and focus on a subtree.

The extension has separate Chrome and Firefox builds sharing the same inspector, published on the [Chrome Web Store](https://chromewebstore.google.com/detail/react-anatomy/cllgnlljmehhoemdlfngkkpienkglkml) and [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/react-anatomy/). Both require desktop version 140 or later. Brave and Edge can install the Chrome Web Store release; a separate Edge store listing is deferred, and Safari is outside the release plan.

The extension attaches to an already running React app. No npm package, source changes, or page reload is required. Captures and props are processed locally; recreating the page can load assets from their original servers. See the [privacy policy](../website/src/content/docs/privacy.md).

## Install

Install the published extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/react-anatomy/cllgnlljmehhoemdlfngkkpienkglkml) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/react-anatomy/). Then open DevTools on a React page and choose **Anatomy**; it may be under the `»` menu.

### Load a development build in Chrome

1. At the monorepo root, run `pnpm install --frozen-lockfile` and `pnpm run build:extension`. For an archive, run `pnpm run package:extension` and extract `packages/extension/artifacts/react-anatomy-extension-<version>.zip`.
2. Open `chrome://extensions` (or `edge://extensions`) and enable **Developer mode**.
3. Click **Load unpacked**, then select the extracted folder containing `manifest.json`, or `packages/extension/dist/extension` from a local build.
4. Open your React app and open DevTools. Choose **Anatomy** in the panel tabs; it may be under the `»` menu. If DevTools was already open when you installed the extension, close and reopen DevTools.

The first capture happens automatically. Undock DevTools when you want more room for the 3D scene. You can also click the React Anatomy extension button on the app's tab to open an inspector window. The toolbar route uses Chrome's temporary `activeTab` grant; open it again from the target page after navigation to a different origin.

### Load a development build in Firefox

Run `pnpm run build:firefox` from the monorepo root, or `pnpm run package:firefox` for `packages/extension/artifacts/react-anatomy-firefox-<version>.zip`.

1. Extract the archive if using the ZIP.
2. In desktop Firefox 140 or later, open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…** and select `manifest.json` from the extracted folder or `packages/extension/dist/firefox`.
4. Open a React page, reopen Developer Tools, and choose **Anatomy**. The toolbar button also opens a separate inspector window.

This is an unsigned development build. Firefox removes temporary add-ons when it restarts; for a permanent installation, use the signed release from Firefox Add-ons.

## Explore the page

The panel uses the DevTools color theme and compact, system-font controls. Drag the pane dividers to resize the tree and inspector. Arrow keys navigate and expand the component tree; prop objects and inspector sections can be expanded individually.

- **Explode view** separates the component levels; **Layer separation** controls the distance.
- **Layer depth** moves from the main structure to the details. Collapsing a tree branch reunites its descendants with their parent.
- Drag the scene to orbit; scroll to zoom. **Front** restores a front-facing camera.
- Click a plane or tree row to see its component path, props, and rendered bounds.
- Double-click a component or press **F** to focus its subtree. Use its breadcrumbs or **Escape** to return to the page.
- **Pick on page** lets you select the component by clicking its visible output in your actual app. Escape on the page cancels picking.
- **Highlight on page** reconnects an inspector selection to its original output. **Reveal in Elements** opens that DOM element in the browser's DOM inspector (Elements in Chrome, Inspector in Firefox).
- **Follow changes** refreshes after rendered DOM, viewport, or scroll changes. Surviving React components keep their selection. With following off, React Anatomy marks the snapshot when the page changes.
- **R** captures again, **C** toggles the page picker, **/** focuses component search, and **0** resets the view. These shortcuts leave text inputs alone.

Reduced-motion preferences remove animated transforms while preserving the interactive controls. The layout adapts to narrow or short DevTools panels; the sidebar icon opens component details when the sidebar is hidden.

The 3D view combines wrappers with identical DOM output into one plane, while the tree and props inspector retain every component. Enable **Wrappers** to separate them. **Layer depth** counts displayed layers; the Layout section reports original React nesting. A banner identifies truncated captures.

**Auto depth** is the default. It chooses an overview across visible regions of the page, traversing intermediate layout containers independently in each branch. It uses visible bounds, not component names, and leaves omitted content in the nearest displayed parent texture. Selecting any captured component reveals its layer. Move the Layer depth slider for a uniform manual cutoff; click Auto to restore the overview. Focus subtree applies the overview to the selected component, making smaller local details visible. The original React tree and manual layer hierarchy remain intact.

## Inspect component props

Select a component in the tree, the 3D view, or the page picker. Its **Props** section reads the current committed React props. Expand objects, arrays, Map/Set entries, and React children; filter top-level prop names with **Filter prop names**. Large collections and long strings have **Show more** controls. The path below the values identifies the property you last selected.

Use **Refresh props** to reread values without recapturing the page. This also handles React updates that produce no DOM changes. A new page capture refreshes the selected component's props while retaining its expanded paths. Changing components clears the old inspection.

Inspection is read-only. It does not invoke property getters, callbacks, or `toJSON`; accessors appear as unevaluated getters. Types such as `undefined`, `NaN`, `Infinity`, bigint, and symbols remain distinguishable. Circular references are marked. React children expose their type, key, and props without traversing React's private owner graph.

Values are read as branches expand; this is a live inspector, not a historical props snapshot. If the committed props object changes or the component unmounts, expansion asks you to refresh or recapture. Each request returns at most 50 entries or 10,000 string characters. Inspection caps collections at 10,000 entries, strings at 1,000,000 characters, and retained value handles at 5,000 per session; limits are displayed. App-defined proxies may still run their own JavaScript traps during reflection. Props are kept in the page until requested and are never uploaded.

## Run and verify locally

```sh
pnpm install --frozen-lockfile                  # From the monorepo root
pnpm run build:extension # Produces packages/extension/dist/extension
pnpm run dev:extension   # Builds and serves an independent React app on port 4174
pnpm test                # Builds, starts a temporary fixture server, tests in Chromium
```

`pnpm test` needs Chromium. Install it with `pnpm --filter @react-anatomy/extension exec playwright install chromium` or set `CHROME_PATH` to an extension-capable Chromium executable. The test harness uses a temporary browser profile and loads the real extension. It opens the actual DevTools panel and verifies capture, selection, focus, stale-snapshot detection, following updates, page picking, highlighting, fragments, memo/forwardRef components, null output, multiple roots, portals, navigation, reconnection, viewer-side sanitization, and lazy props inspection (including refresh without DOM updates, getter avoidance, pagination, unmounts, and selection races).

To record the extension, run `pnpm --filter @react-anatomy/extension run record:extension` after building. It uses Chrome's screencast frames from the real DevTools panel and writes `artifacts/react-anatomy-devtools.mp4`. The recording contains captions and no audio. `pnpm --filter @react-anatomy/extension run record:props` records the props workflow to `artifacts/react-anatomy-props.mp4`.

For the narrated introduction, run `pnpm run record:intro`. It starts with a regular React website, opens the **Anatomy** DevTools tab, then explores the page in 3D and inspects component props. The pipeline exports a 1080p sharing copy, 1440p masters with and without burned-in subtitles, subtitle files, a poster, and the extension archive to `artifacts/intro/deliverables/`. Subtitles appear over the footage; narration is generated with OpenAI text-to-speech. Provide `OPENAI_API_KEY` through the secure credential file configured for `scripts/intro/tts.ts`. Generated clips are cached locally.

The earlier silent feature tour remains available through `pnpm run record:demo`, which writes to `artifacts/demo/deliverables/`. Recording, composition, rendering, and validation are separate scripts so editing changes can reuse recorded footage. IBM Plex Mono is bundled under its included OFL license.

### Firefox verification

```sh
pnpm run test:firefox
```

Install desktop Firefox first. Selenium Manager locates Firefox and geckodriver; set `FIREFOX_PATH` and `GECKODRIVER_PATH` to use specific binaries (geckodriver 0.36+). `FIREFOX_SYSROOT` can supply Linux shared libraries on a minimal host. The harness runs headless in an isolated temporary profile and uses WebDriver's privileged context only to reach the real native DevTools panel. These test privileges are not part of the extension.

The suite covers the native panel and a real toolbar click, including `activeTab`, MAIN-world scripting, capture, 3D layers, focus, picking, highlighting, reveal in Firefox Inspector, following updates, navigation, production components, typed and nested props, array paging, getter avoidance, unmounts, and viewer sanitization. Evidence goes to `artifacts/firefox/<browser-version>/`.

`web-ext lint` currently reports no errors and four warnings: one Android minimum-version warning for the desktop data-consent declaration, and three dynamic `innerHTML` warnings (two in React's renderer, one in our inert snapshot parser). Firefox Android is not a target. Snapshot markup is parsed in an inert template and stripped of active elements and disallowed attributes before rendering; the browser suites exercise this boundary. These warnings remain visible for review.

## How it works

- `src/inspector/page-agent.ts` is the inspected-page interface. It reads an existing React DevTools hook when available, otherwise discovers current roots through React's DOM/Fiber associations. It does not install or replace React's hook. It reads component metadata, measures host elements, and serializes a computed-style DOM snapshot once.
- `src/inspector/transport.ts` connects either a native DevTools panel through `inspectedWindow.eval`, or a toolbar-launched window through `chrome.scripting` in the page's main world. The extension requests only `activeTab` and `scripting`; it has no blanket host access or permanent content script.
- `src/inspector/snapshot.ts` independently sanitizes the page's serialized markup and font rules. It splits the inert visual snapshot at component host IDs, allowing collapsed or expanded hierarchies to retain their content.
- `src/inspector/panel.tsx` runs the capture lifecycle and toolbar. `Viewer.tsx` holds the selection, layer, and camera state for a capture and composes the tree (`ComponentTree.tsx`), the CSS 3D scene (`SceneStage.tsx`), its controls (`StageControls.tsx`), and the details pane (`ComponentDetails.tsx`). The inspected app never runs inside the viewer. Page observers and picker listeners are cleaned up on disposal, with an idle timeout as a fallback.

Frames represent React composition depth, not CSS z-index or browser compositing layers. Multiple-root components and portals keep their logical React parent. Components without visible output remain in the tree, without invented planes.

## Current limits

Captures start at 2,000 components and 300 nested levels. The partial-hierarchy banner identifies the limit and provides **Capture more**, which raises the limit that was reached: components to 5,000, and nesting to 600 and then 1,000 levels. The larger budget is retained for manual and automatic recaptures of the same page and resets on navigation. Reaching a maximum remains explicitly marked as partial.

The supported target is React DOM 18.2, 18.3, and 19.0–19.3 on desktop Chrome 140+ and Firefox 140+. The compatibility suite covers six pinned React releases, Excalidraw, and Next.js, with supplemental checks on react.dev and shadcn/ui. See the [compatibility workloads](validation/README.md) and [support policy](../website/src/content/docs/docs/compatibility.md). React's Fiber structure and DOM associations are private APIs, so broader React-version compatibility needs testing. Production builds may expose minified or anonymous component names. Server-only components are not present in the client Fiber tree.

Capture is for the top document and current viewport. The visual snapshot includes the rendered content of open shadow roots, such as web components; iframe contents and closed shadow roots are not captured. DOM cloning approximates the painted result: pseudo-elements, complex clipping/transforms, video, cross-origin fonts, SVG references, and tainted canvas can differ from the original page. Relevant capture limits and font/canvas issues appear under **Capture notes**. Ordinary visible controls are captured, but password values are excluded.

Follow mode observes rendered DOM and viewport changes; it is not a complete React commit profiler. A React-only change with no DOM mutation may require a manual capture. Source-map navigation, full-page capture, editing props, and persistent exports are not implemented.

## Original experience studies

The original standalone prototypes are retained. Run `pnpm run build:prototype` and open `dist/prototype.html`, or `pnpm --filter @react-anatomy/extension run dev:prototype`. The `?variant=A|B|C` switch compares the spatial workbench, subtree lens, and depth atlas. Their source is `src/prototype.tsx` and `src/capture.ts`, which the extension bundles do not include.

Fonts: DM Sans and IBM Plex Mono, distributed under the SIL Open Font License; license texts are in `licenses/`.
