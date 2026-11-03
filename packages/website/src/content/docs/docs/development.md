---
title: Local development
description: Work on the extension and Astro website in the local monorepo.
---

The repository uses pnpm workspaces. Use **Node 24.22.1** and **pnpm 12.16.1**. Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

The website normally starts at `http://localhost:4321`; use the address Astro prints if that port is occupied. Astro renders the custom landing page; Starlight serves these docs under `/docs/`.

## Build the extension

```sh
pnpm run build:extension
```

In `chrome://extensions` or `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `packages/extension/dist/extension`. Reopen DevTools if it was already open, then choose **Anatomy**.

```sh
pnpm run dev:extension
```

This builds the extension and serves an independent React fixture at `http://localhost:4174`. It does not watch extension files: rebuild and reload the extension after changing its source.

## Build for Firefox

```sh
pnpm run build:firefox
```

In desktop Firefox 140 or later, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on…**, and select `packages/extension/dist/firefox/manifest.json`. Reopen Developer Tools, then choose **Anatomy**.

Firefox removes this temporary add-on when it restarts. Permanent installation requires Mozilla signing; local packaging does not sign or publish it.

`pnpm run dev:firefox` launches Firefox in a separate profile and reloads the extension when the built files change. Rebuild after source edits. Chrome and Firefox use the same capture engine and inspector; Firefox's manifest uses a background event page instead of a service worker.

## Check the workspace

```sh
pnpm run format
pnpm run check
pnpm run build
pnpm test
pnpm run test:website
```

Oxfmt formats both apps, including Astro, CSS, and Markdown. Oxlint checks JavaScript and TypeScript, including the JavaScript portions of Astro files. `astro check` covers Astro templates and types.

The extension tests load the real extension in Chromium. Install a browser with `pnpm --filter @react-anatomy/extension exec playwright install chromium`. On Linux, install the browser dependencies with `pnpm --filter @react-anatomy/extension exec playwright install --with-deps chromium` as needed. Tests use full Chromium in headless mode and do not require a display server. `CHROME_PATH` can select an existing Chromium binary; `CHROME_SYSROOT` can supply a custom library root.

For Firefox, install desktop Firefox and run `pnpm run test:firefox`. This runs Mozilla's extension linter and a browser suite against the real Anatomy DevTools panel and toolbar action. Selenium Manager locates Firefox and geckodriver, or use `FIREFOX_PATH` and `GECKODRIVER_PATH` to select them explicitly. Use geckodriver 0.36 or later. `FIREFOX_SYSROOT` optionally supplies Linux shared libraries.

## Compatibility validation

The compatibility workloads have their own lockfile and dependencies. Install them once, then run the browser matrix:

```sh
pnpm run setup:compatibility
pnpm run test:compatibility
```

This builds and checks six pinned React versions, Excalidraw, and Next.js App Router in the real Chrome/Chromium and Firefox DevTools panels. Use the browser environment variables above to select versions; run against the minimum and current stable browsers for a release. It does not download browser binaries itself beyond Selenium Manager's normal browser/driver discovery.

`pnpm run test:public-apps` separately checks react.dev and shadcn/ui over the network. Results and screenshots are written to `packages/extension/artifacts/compatibility/results/`. Public deployments supplement the pinned workloads; their changes or availability can fail the public-site check without changing the repeatable local matrix.

The [Compatibility page](/docs/compatibility/) summarizes browser and React requirements. Detailed test results and release checks live in the repository’s `docs/validation/` notes.

## Package a local build

```sh
pnpm run package:extension
pnpm run package:firefox
```

These commands write separate versioned ZIPs under `packages/extension/artifacts/`. Extract the Chrome archive before using **Load unpacked**, or the Firefox archive before selecting its `manifest.json` under **Load Temporary Add-on…**. Packaging does not publish anything.

## Landing-page example

The website bundles the Orbit sample app and the real Anatomy inspector into two isolated frames. The sample is interactive; the inspector reads its actual React tree and props. Its transport is restricted to that sample, so it does not inspect other pages or require extension permissions.

The example bundles are generated before `dev` and `build`. If you change the demo or extension source while Astro is already running, rebuild them and reload:

```sh
pnpm --filter @react-anatomy/website exec node scripts/build-demo.ts
```

`pnpm run test:website` builds the site and checks the example’s desktop and mobile interactions, reduced motion, screenshots, and documentation search in Chromium.

## Shared identity

The approved **Exploded Stack** artwork lives in `packages/brand`. The extension build copies its size-specific icons; the website imports the SVGs. Edit the shared package to update the source artwork in one place.

The inspector UI and rendering modules use strict TypeScript. Run `pnpm run type-check` to check the extension and website. Oxlint, Oxfmt, type-checking, website checks, and browser suites run as separate CI matrix jobs.
