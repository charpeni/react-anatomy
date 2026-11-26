---
title: Trace a prop in source
description: Follow one prop through your source code. See who passed it, where it is used, and where the chain stops.
---

The [Props inspector](/docs/props/) shows the value a component received. **Trace in source** follows a prop from the JSX that supplied it through components that forward or rename it to the line that reads it.

Load a local source analysis to start tracing.

<video controls playsinline preload="none" width="1600" height="900" poster="/media/docs/trace-a-prop-in-source.jpg" aria-label="Trace the Resolve callback to its click handler">
  <source src="/media/docs/trace-a-prop-in-source.webm" type="video/webm">
  <source src="/media/docs/trace-a-prop-in-source.mp4" type="video/mp4">
  <track kind="captions" srclang="en" label="English" src="/media/docs/trace-a-prop-in-source.vtt">
  <a href="/media/docs/trace-a-prop-in-source.mp4">Watch the video</a>
</video>

<details>
<summary>Video transcript</summary>
<p>This Resolve button closes a support ticket. Where is the callback defined? And how does it reach the button?</p>
<p>Trace in source follows a prop through your code, even when a component gives it a new name.</p>
<p>With <code>Queue</code> selected and a matching source analysis loaded, choose <code>onResolve</code> in Props.</p>
<p>Under Supplied by, the callback starts in <code>DeskApp</code>. <code>Queue</code> passes it to <code>TicketRow</code> as <code>onDismiss</code>.</p>
<p>Follow the link to a mounted ticket row. Its click handler calls <code>onDismiss</code> with the ticket ID.</p>
<p>Try it on the page. Click Resolve on that row. The ticket changes to resolved.</p>
</details>

## What a trace tells you

| Result                                            | Meaning                                                                                                                                 |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Used here**                                     | The component reads the value: in its output, a condition, a hook, or a DOM attribute.                                                  |
| **Used here, only in a deferred event handler**   | The only read is inside a handler such as `onClick={() => onDismiss(id)}`. It runs when the event fires, not while rendering.           |
| **Forwarded only here**                           | The component passes the value on unchanged and does nothing else with it. A rename such as `onDismiss={onResolve}` is still a forward. |
| **Used and forwarded**                            | The component reads the value and also passes it to a child.                                                                            |
| **Derived from this prop**                        | A projection or computed value is passed on: `status={project.status}`, `label={format(project)}`, or each item of `projects.map(…)`.   |
| **Received, unused here**                         | An element passes the prop, and nothing in the analyzed receiver reads it or passes it on.                                              |
| **Forwarded, no consumer found in analyzed code** | Every path the value takes ends at a receiver that does not use it.                                                                     |
| **Unknown beyond this point**                     | The value reaches code that was not or cannot be analyzed.                                                                              |

Each row gives the file, line, and column and highlights the relevant code.

Before removing an unused prop, check the caller’s expression for side effects and look for callers outside the analyzed files.

## Create a source analysis

From a [React Anatomy checkout](https://github.com/charpeni/react-anatomy), run the analyzer on your app’s TypeScript or JavaScript source. It uses the TypeScript compiler and writes a JSON report.

```sh
git clone https://github.com/charpeni/react-anatomy
cd react-anatomy
pnpm install --frozen-lockfile
pnpm trace:source --root /path/to/app/src --out /path/to/app/anatomy-trace.json /path/to/app/src
```

The analyzer resolves TypeScript path aliases using the nearest `tsconfig.json` at or above `--root`, including inherited mappings. Pass `--tsconfig /path/to/tsconfig.app.json` to select another configuration. Your app’s `target` and `lib` settings can use values newer than the analyzer’s bundled TypeScript version. Include the aliased source files in the analysis. Aliases defined only in your bundler need an equivalent TypeScript mapping.

Pass files or directories to analyze. The report uses paths relative to `--root`. The analyzer skips tests, stories, `node_modules`, and `dist`, and prints the counts of resolved and unresolved components and elements.

Treat the report like source code. It includes relative file paths, source positions, and snippets from your app.

## Load it

1. Select a component in Anatomy.
2. Open **Trace in source** in the details pane and choose **Load source analysis…**.
3. Pick a prop from the **Prop** list, or click a prop in **Props**.

The panel keeps the report in memory until you remove it or close the panel. The file stays on your computer.

## Join the trace to the running page

Several JSX elements can render a `TicketRow`. Without build metadata, choose one of those elements yourself. Anatomy labels the result **Chosen by you** and **Source only**.

To trace the instance you selected on the page, add the esbuild plugin to your development build. For another bundler, call `instrumentSource()` from its transform hook.

```ts
import { anatomySourcePlugin } from './react-anatomy/packages/extension/scripts/source-trace/esbuild-plugin.ts';

await build({
  // …your options
  plugins: [anatomySourcePlugin({ root: 'src' })],
});
```

Use the same `root` for the plugin and the analyzer. For each JSX element that renders a component, the plugin records the file, source position, and file hash in a weak map keyed by the props object. Your component receives its original props, source line numbers stay the same, and JavaScript can collect the record along with the props.

With that metadata, Anatomy shows **Call site verified** and:

- starts from the exact element that created the selected instance;
- follows the supply chain through the mounted components that created each element, with a **Select** button for each;
- counts the mounted components below at each forwarding element and lets you jump to one.

In development, Anatomy uses React’s record of which component created each element. Without that record, it can follow a prop upstream only if a single enclosing instance could have supplied it. The trace stops if several instances match, an ancestor lacks metadata, or the ancestry scan ends early.

## Stale builds and partial input

The analysis and the page must be made from the same text.

- If the file that created the selected instance differs, Anatomy reports **Out of date** and makes no claim about the instance.
- If any other file the result relies on differs, or the build recorded no hash for it, the result is marked **Not verified against this build** and **Source only**. This covers each component and element on the path, a module that re-exports a component, and a wrapper that receives an element as a prop or child.
- An element written in a file you did not analyze is reported as outside the analysis.

After editing source, rebuild the page and run the analyzer again.

## When the answer is unknown

A trace can stop at any of these points.

- A spread whose keys cannot be listed from source, such as `{...options(ticket)}`.
- The whole props object passed to a function or hook, enumerated, or read with a computed name.
- A component chosen at runtime, produced by a higher-order function, loaded with `lazy()`, or implemented as a class.
- A component held in a `let` or `var` binding, or in any binding that is written again after its declaration.
- A component imported through a module that was not analyzed.
- A component whose implementation is outside the analyzed files.
- A custom `memo` comparator, which reads props outside the component body.
- An element handed to another component that may read its props, as in `<Tabs><Tab label="…" /></Tabs>`.
- A default value that runs code, a recursive path, a prop binding that is reassigned, or props reached through a rest parameter, `arguments`, or `eval`.

A value passed as an argument to a function counts as a use. The function is not followed.

## Limits

- Function components only. Context, state derived from props, and values that travel through stores are not followed.
- A local that is reassigned is treated as a new value.
- Elements created with `createElement` or copied with `cloneElement` have no call-site record.
- The plugin is provided for esbuild. Other bundlers need a small transform that calls `instrumentSource()`.
- The trace describes the paths a prop can take in source. To check that a handler runs, trigger the event on the page.

## What Anatomy reads

From the page, a trace reads prop **names**, and the file path, text hash, and position that the plugin recorded for the selected component and the components around it. It reads at most 100 ancestors and 400 stamped descendants. Prop values are not read for a trace. See the [privacy policy](/privacy/).

## Investigate unused props

The same analysis powers [Unused props](/docs/unused-props/). Open a candidate there and choose **Trace in source** to follow that prop.
