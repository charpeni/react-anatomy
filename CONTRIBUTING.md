# Contributing

React Anatomy uses pnpm workspaces, with all packages under `packages/`.

## Setup

Use Node **24.22.1** (`nvm use`) and **pnpm 12.16.1**. From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
```

See the [extension guide](packages/extension/README.md) for loading the extension in a browser and the [website guide](packages/website/README.md) for the live example and documentation.

## Commands

| Command                | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `pnpm dev`             | Start the website and public docs                       |
| `pnpm dev:extension`   | Build the extension and serve its React fixture         |
| `pnpm dev:firefox`     | Launch a Firefox profile with the development extension |
| `pnpm build`           | Build the extension and website                         |
| `pnpm build:extension` | Build the unpacked Chrome extension                     |
| `pnpm build:firefox`   | Build the unpacked Firefox extension                    |
| `pnpm build:website`   | Build the static site into `packages/website/dist`      |
| `pnpm check`           | Run Oxlint, Oxfmt, and TypeScript checks                |
| `pnpm format`          | Format the workspace                                    |
| `pnpm test`            | Run unit checks and the native Chrome extension suite   |
| `pnpm test:firefox`    | Run Mozilla's linter and the native Firefox suite       |
| `pnpm test:website`    | Build and test the website in Chromium                  |
| `pnpm test:release`    | Check release tooling without contacting stores         |

## Code style

Oxfmt handles formatting. Oxlint requires braces for control-flow bodies and one variable per declaration. Separate logical steps with blank lines, and keep related state declarations together.

The extension, website browser code, fixtures, prototypes, build scripts, tests, and release
tools use strict TypeScript. Node 24 runs tooling directly from `.ts` files using native type
stripping, so use erasable syntax and explicit `.ts` imports. esbuild produces the JavaScript
bundles browsers need. Astro checks the website's `.astro` components as well.

Run `pnpm setup:compatibility` once before the first type check; the pinned React/Next.js
workloads have their own dependency workspace. The CI TypeScript job checks those fixtures too.

`pnpm check` checks both packages. Generated builds, captures, lockfiles, outlined brand SVGs, and embedded font stylesheets are excluded from formatting.

## Browser tests

Install Playwright's Chromium before running the Chrome and website suites:

```sh
pnpm --filter @react-anatomy/extension exec playwright install chromium
pnpm test
pnpm test:website
```

On Linux, add `--with-deps` to the browser installation command if system libraries are missing. The tests run headlessly and load the real extension and its DevTools panel. `CHROME_PATH` selects an existing extension-capable Chromium executable; `CHROME_SYSROOT` optionally supplies Linux libraries.

For Firefox, install desktop Firefox and run `pnpm test:firefox`. Selenium Manager locates Firefox and geckodriver. `FIREFOX_PATH` and `GECKODRIVER_PATH` select explicit binaries; use geckodriver 0.36 or later. `FIREFOX_SYSROOT` optionally supplies Linux libraries.

Screenshots and diagnostics are written to ignored `artifacts/` directories inside each package.

### Compatibility workloads

The React-version fixtures use a separate, pinned pnpm workspace:

```sh
pnpm setup:compatibility
pnpm test:compatibility
pnpm test:public-apps
```

The last command checks public sites over the network. See the [workload guide](packages/extension/validation/README.md) and [support policy](packages/website/src/content/docs/docs/compatibility.md) for coverage and limits.

## Continuous integration

GitHub Actions runs seven independent matrix jobs: Oxlint, Oxfmt, TypeScript, website, Chrome extension, Firefox extension, and release tooling. Failed browser jobs upload diagnostics.

## Packaging

`pnpm package:extension` and `pnpm package:firefox` create local ZIPs. `pnpm release:prepare` runs the release checks and creates verified browser and source archives. Preparation does not upload or publish anything.

The separate `release:chrome` and `release:firefox` commands provide `plan`, `submit`, and `status` actions. Submission requires store credentials. Chrome submissions are staged for review; a listed Firefox submission may become public after approval.

Website deployment is documented in the [website guide](packages/website/README.md#deployment). It is independent of browser-store submissions.

## README screenshot

Run `pnpm --filter @react-anatomy/extension run screenshot:readme` to capture the real DevTools panel against the sample app. Review `packages/extension/assets/extension.png` before committing it.
