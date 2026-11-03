---
title: React component inspection
description: Understand how a React page is composed. React Anatomy connects a running page to the components React rendered for it, inside DevTools.
---

React Anatomy is a browser extension for understanding how a React page is composed. It adds an **Anatomy** panel to DevTools that connects what you see on a running page with the components React rendered for it, and separates the page into layers you can explore in 3D.

**This is a work in progress.** There is no public release or store listing yet. [Explore the interactive example](/#demo) to see the experience. It runs the inspector against a bundled sample app, so you can explore without installing the extension.

## The mental model

Think of the layout diagram you might sketch by hand to understand a screen or explain a change: boxes for regions, nested the way the page is built. Anatomy draws that diagram from the running page. The boxes come from what is on screen; the names, nesting, and inputs come from React.

The panel has three connected views:

- **Component tree:** the hierarchy React rendered, from the root down to the smallest captured component.
- **3D view:** the visible page, split into planes that belong to those components.
- **Inspector:** the selected component’s live props, size, key, and the chain of components above it.

Selecting a component in one view selects it in the others. When you know what something looks like but not what it is called, pick it directly on the page.

[![The real Anatomy DevTools panel: the captured component tree at the left, the same page separated into layers in the middle, and the component inspector at the right.](/media/docs/hierarchy.png)](/media/docs/hierarchy.png)

_A sample workspace layout in the real extension. The tree and the 3D scene show the same page from two perspectives. Select the image to open it at full size._

## Rendered structure, not source structure

Anatomy shows the components that rendered **for this page, in its current state**. That is a different map from your files and imports:

| Anatomy shows                                                    | Anatomy does not show                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Function and class components, including `memo` and `forwardRef` | Imports, modules, files, or package dependencies              |
| Each rendered instance, with its own key and props               | Components that are imported but not rendered right now       |
| How components nest at runtime                                   | Where a component is defined in your source                   |
| Which part of the page each component’s DOM output covers        | DOM elements as tree rows (they are the output of components) |

A component rendered three times by a list appears three times. A conditional branch that is not rendered right now does not appear until the page shows it. To see another state — an empty list, an error, a different route — put the page in that state and capture again.

## What it is, and what it isn’t

React Anatomy is an inspector. It helps you read and explain structure. It does not review code, judge whether a structure is good, open source files, export diagrams, or compare two captures. Those decisions and explanations stay with you, and the guides show manual workflows for them.

## Choose a guide

- [Understand a page](/docs/understand/): go from something you see to the component behind it, and follow the data.
- [Explain a change](/docs/explain-a-change/): show the structure of your change in a pull request.
- [Read generated code](/docs/generated-code/): look at what an AI agent actually rendered before you take ownership of it.

For details on the controls, see [Layers, focus, and controls](/docs/explore/) and [Props inspector](/docs/props/).

## How it works

The extension reads the running app’s React Fiber tree and captures the visible DOM with computed styles. It builds an explorable scene from those snapshots. It does not require a package in your app, source changes, or React DevTools to be installed.

Inspection runs in your browser. The extension does not upload captures or props to a service. A rendered snapshot may still load images and fonts referenced by the inspected page.

The capture is a reconstruction, not the browser’s exact paint output. React’s private internals and production name minification also affect what can be shown. Read the [current limitations](/docs/limitations/) for the boundaries of this preview.

[Back to the website](/)
