# Compatibility workloads

These apps are test inputs, not part of the shipped extension or website. Their dependencies are installed separately so the product cannot accidentally acquire a different React runtime.

From the monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm run setup:compatibility
pnpm run test:compatibility
```

The first command installs the product tools and Excalidraw 0.18.1. The second installs this directory's locked dependencies with lifecycle scripts disabled. The third builds the extension for both browsers, builds the workloads, builds Next.js, and runs the native DevTools checks in Chrome/Chromium and Firefox. The standard `CHROME_PATH`, `CHROME_SYSROOT`, `FIREFOX_PATH`, `GECKODRIVER_PATH`, and `FIREFOX_SYSROOT` environment variables select installed browsers.

This is a separate pnpm workspace with its own lockfile. Automatic peer installation and strict peer checks are disabled only here because the fixtures intentionally install several React/React DOM aliases together. The esbuild aliases select the matching pair for each workload, including transitive React imports. The browser suite verifies the React version actually loaded on the page. The main workspace keeps its normal dependency resolution.

## Workloads

- `workspace.tsx`: a routed issue workspace using React Router 7.18.5. Six React versions are built in development and minified production. It exercises Strict Mode, context, a class boundary, memoization, live props, portals, and navigation.
- `excalidraw.tsx`: the actual published Excalidraw 0.18.1 editor, with a small local scene, on React 18.3.1 and 19.3.1. Excalidraw's package assets are served locally. This is an editor integration, not a clone of its UI or a test of its hosted collaboration service.
- `next-app/`: Next.js 16.4.4 App Router, in development and production. Server rendering, Suspense streaming, hydration, client props, portals, and navigation are exercised. Next's bundled renderer reports a canary version independently of the installed `react` package; the report records its actual version.

The apps do not import Anatomy or install a React DevTools hook. The test driver installs the real browser extension, opens its native DevTools panel, and interacts with that panel and the inspected page. It waits for hydration independently of the inspector, then requests an explicit capture. Picker checks compare the page's actual hit ID to the selected tree row and wait for that component's props to finish loading.

## Public applications

```sh
pnpm run test:public-apps
```

This separate command needs internet access. It checks `https://react.dev/learn` and `https://ui.shadcn.com/examples/dashboard`. It reads public pages, captures their visible layout, picks a region, opens its props and focuses its subtree. It does not log in, post, save application changes, or use real customer data. It exercises **Capture more** when a page exceeds the initial budget.

Public deployments change and can block automated browsers. A failed or inaccessible run remains failed; it is never silently counted as supported. Unless a deployed runtime can be independently identified, the React version remains unknown.

## Individual runs and evidence

From `packages/extension`, after the workloads are built:

```sh
node scripts/compatibility/check.ts --browser=chrome
node scripts/compatibility/check.ts --browser=firefox
node scripts/compatibility/check.ts --browser=chrome --only=excalidraw
node scripts/compatibility/check.ts --browser=firefox --public
```

Use `--only=` to filter case IDs while investigating a failure. A filtered run is not a complete matrix.

Results and native screenshots are written to `artifacts/compatibility/results/<browser-version>/`. JSON includes the exact browser and extension version, the shipped panel bundle's SHA-256, actual app runtime version where known, component counts, partial-capture status, performed checks, and failures. Chrome also records uncaught page errors; Firefox records that field as `null` because this harness does not collect them. Browser behavior assertions run in both.

The dated record in the local, ignored `docs/validation/` directory is a concise copy of completed results. Do not change its pass counts or tested versions without rerunning the corresponding native checks. Public-site results are supplemental; the pinned local matrix is the repeatable release check.
