# Unused props: proof of concept

Open **Unused props** in the component details pane and load a local source analysis. Anatomy uses development build metadata to find the JSX element that created the selected instance. It checks whether the receiving component or its children read the props that element passes.

## What counts as a candidate

A prop is reported as having no reader only when all three hold:

1. The JSX element supplies the prop as an attribute or through an object literal whose keys the analyzer can list.
2. The element resolves to a function component in the analyzed files.
3. The trace finds that the receiver ignores the prop (`unused`), or only forwards it and every forwarding path ends without a reader. A custom memo comparator, a default that runs code, or another component that receives the element can leave a path unresolved.

Anatomy reads the call-site metadata, build hashes, and the prop names on this render. It checks how the code uses each prop without wrapping the app’s props in a proxy or installing getters.

## Tiers

| Tier in the panel       | Meaning                                                                             | Example in the fixture               |
| ----------------------- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| No reader found         | Written here; the component neither reads it nor passes it on.                      | `legacyTheme` on `<PlanCard>`        |
| No reader found         | Passed down, and no analyzed component below reads it.                              | `onPrint` on `<Toolbar>`             |
| Not proven              | No reader found, but the prop arrived by a spread, so only on some renders.         | `trialDays` on the Team `<PlanCard>` |
| Not proven              | An analysis boundary: the prop may be read where the trace cannot follow.           | `version` on `<SeatMeter>`           |
| Used, but easy to miss  | Read or passed on in a way a skim of the component, or a runtime check, would miss. | `trackingId` on `<PlanCard>`         |
| Used                    | Read or passed down in plain sight.                                                 | `plan` on `<PlanCard>`               |
| Not observed (no rows)  | The build has no record of the JSX element that created this instance.              | `PlanLink`, or any page at `/plain`  |
| Not supported (no rows) | The component cannot be analyzed from source.                                       | `<Tooltip>`, `<TrackedFooter>`       |

## What separates "unused" from "looks unused"

Each row is a regression in `scripts/check-unused-props.ts`.

| The prop is…                                                              | Reported as                                                     | Why                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| read only in an event handler or an effect                                | used, easy to miss                                              | The handler or effect reads the prop after render.                                               |
| read in a branch this render did not take                                 | used                                                            | The analyzer checks both branches.                                                               |
| only a hook dependency                                                    | used, easy to miss                                              | Its value is never read, but a change re-runs the hook.                                          |
| forwarded by a rest spread to a component that reads it                   | used, easy to miss                                              | The component never names it.                                                                    |
| spread onto a DOM element                                                 | used, easy to miss                                              | The DOM spread includes the prop without naming it.                                              |
| forwarded, and read nowhere below                                         | no reader (dead end)                                            | Follow the prop to the component where forwarding stops.                                         |
| named only to keep it out of `...rest`                                    | no reader, with a warning                                       | Destructuring keeps the key out of the forwarded props.                                          |
| read only by a custom `memo` comparator                                   | not proven                                                      | The comparator runs outside the component body.                                                  |
| in a props object passed to a hook, a helper, or `createElement`          | not proven                                                      | Any prop may be read there.                                                                      |
| read through `arguments`, `eval`, or a computed name                      | not proven                                                      | Implicit readers.                                                                                |
| read by the parent from the child element (`<Tabs><Tab label>`)           | not proven                                                      | The receiving component is not the only reader of an element's props.                            |
| given a default that runs code (`{ old = register() }`)                   | not proven                                                      | Passing the prop skips that code, even though the value is ignored.                              |
| delivered by a spread whose keys source cannot list                       | not proven (this render)                                        | It may be absent on other renders.                                                               |
| on an instance with more props than the page reports (200 names)          | judged from source if written; spread-only props may be missing | The list is marked partial. A written prop missing from a partial list is not treated as absent. |
| in a component whose file changed after the analysis                      | not proven                                                      | The element's stamp covers only its own file. The build's per-file hashes catch the rest.        |
| computed by a call at the call site (`size={recordMetric()}`)             | no reader, with a note                                          | The receiver ignores the result; the caller still runs the expression.                           |
| `key` or `ref`                                                            | not listed / handled by React                                   | React consumes them.                                                                             |
| on a class, a lazy component, a higher-order component, or a package      | not supported                                                   | No function body to analyze.                                                                     |
| on an instance made with `createElement`/`cloneElement`, or a plain build | not observed                                                    | The page cannot say which element created the instance.                                          |

## Why not watch reads at runtime

Watching a render would miss `trackingId` until someone clicks and `details` on `<Notice kind="info">` until the error branch runs. Wrapping the props in a proxy would also change the object the app receives. The analyzer checks both branches and event handlers in source.

## Limits

- Check other JSX and non-JSX callers, tests, and types before removing a prop. The audit covers one call site at a time.
- The build plugin identifies the call site. The source analysis supplies the paths that a prop takes from there.
- The analyzer follows function components. Context reads and provider values stop a trace.
- With a custom `memo` comparator, any prop the component body ignores stays **Not proven**. The comparator might read it.
- The analyzer stops at nested destructuring patterns, even when the pattern visibly reads the prop.

## Run it

```sh
pnpm --filter @react-anatomy/extension exec node scripts/check-unused-props.ts        # analyzer + audit, Node only
pnpm --filter @react-anatomy/extension run build:extension
pnpm --filter @react-anatomy/extension exec node scripts/check-unused-props-panel.ts  # the real extension in Chrome
```

By hand:

1. `pnpm --filter @react-anatomy/extension run build:extension`, then `pnpm --filter @react-anatomy/extension exec node scripts/unused-props/serve.ts`. It prints the fixture URL and writes `dist/unused-props-report.json`.
2. Load `packages/extension/dist/extension` as an unpacked extension, open the URL, and open DevTools → Anatomy.
3. Select the first **PlanCard**. In **Unused props**, load `dist/unused-props-report.json`.
4. **Positive:** `legacyTheme` is under "No reader found", with the caller's line (`BillingApp.tsx:38`) and `PlanCard`'s parameter list.
5. **Near miss:** `trackingId` is under "Used, but easy to miss": it is read only inside the click handler (`PlanCard.tsx:18`).
6. **This render only:** `trialDays` is under "Not proven" on the Team card and missing on the Business card.
7. Select `SeatMeter` (comparator), `Toolbar` (dead end), `Tooltip` (not supported), `PlanLink` (not observed). Open `/plain` for a build without metadata.

## Code

- `src/source-trace/unused-props.ts`: the audit, a pure function of the loaded analysis and the page evidence.
- `src/source-trace/UnusedProps.tsx`, `unused-props.css`: the section.
- `scripts/fixtures/unused-props/`: the billing app, plus `Regressions.tsx`, which is analyzed but never bundled.
- `scripts/check-unused-props.ts`, `scripts/check-unused-props-panel.ts`, `scripts/unused-props/`: checks, fixture build, and server.

The analyzer, report format, and esbuild plugin live in `scripts/source-trace/` and `src/source-trace/`. The `source-evidence` page action reads the selected instance’s call site, prop names, and build hashes.
