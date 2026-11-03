---
title: Common questions
description: How React Anatomy compares with React DevTools, works on production pages, inspects props, and keeps inspection data local.
---

## What is React Anatomy?

React Anatomy is an open-source browser extension that adds an **Anatomy** panel to DevTools. It connects the rendered React component tree to the visible page, separates the layout into 3D layers, and lets you inspect a selected component’s live props.

Use it to understand an unfamiliar layout, learn React composition, investigate unexpected output, or explain a change in a pull request. The [interactive example](/#demo) runs on a bundled sample page without installing the extension.

## How is it different from React DevTools?

React Anatomy focuses on where components appear on the page and how their rendered output fits together. Its component tree, 3D scene, and props inspector share the same selection. You can pick a region on the page and focus the component subtree behind it.

[React Developer Tools](https://react.dev/learn/react-developer-tools) also lets you inspect components and props, and provides editing and profiling tools. React Anatomy does not replace those tools or require them to be installed. See [Understand a page](/docs/understand/) for the spatial inspection workflow.

## Does it work on production React pages?

Yes, for the [supported React DOM versions and browsers](/docs/compatibility/). It reads the running app’s React Fiber tree, so you do not need to add a package or change the app’s source.

Production builds may shorten component names or remove them. React Anatomy cannot recover names removed by the build. Development builds give a more readable tree.

## Which browsers and React versions does it support?

Use desktop **Chrome 140+** or **Firefox 140+**, with **React DOM 18.2, 18.3, or 19.0–19.3**. Use the latest patch of your React release. Brave and Edge can install Chrome Web Store extensions, but they are not part of the current browser validation.

Next.js and other server-rendered apps must finish hydrating before their client components can be inspected. Server-only components and their props are not visible. React Native and Preact are outside the supported scope. The [compatibility guide](/docs/compatibility/) is the reference for these requirements.

## Is this the DOM tree or the component tree?

The tree lists the React components that rendered for the current page state, including repeated instances with their own props. DOM elements provide the visible output for the 3D layers; they are not rows in the component tree.

The view is not a file, import, or package-dependency graph. Components that are imported but not rendered do not appear. See the [overview](/docs/) for the distinction.

## Why do some components share a layer?

Wrappers can render exactly the same DOM output as their child. React Anatomy groups that shared output into one plane to keep the page readable, while retaining the components in the tree. Enable **Wrappers** to separate them, or select a component and use **Focus subtree**.

**Layer depth** controls the view of the existing capture. If the hierarchy is marked partial, use **Capture more** to increase the capture budget. Read [Layers, focus, and controls](/docs/explore/) and [Capture boundaries](/docs/limitations/#capture-boundaries).

## Are props a snapshot, and can I edit them?

Props are read from the current committed React component when you inspect it or expand a value. They are not a historical snapshot from the moment the page was captured. **Refresh props** reads them again without capturing the whole page.

The inspector reads props; it does not edit them or invoke their functions or getters. See [Props inspector](/docs/props/) for nested values, paging, and component updates.

## Does React Anatomy upload page data?

No. The extension does not upload captures or component props to a service and has no analytics or remote error reporting. Inspection runs locally in your browser.

Reconstructed page images and fonts can still load from the original page’s asset URLs. Sensitive values can be visible in the props inspector and in screenshots you take. The [privacy policy](/privacy/) explains what the extension accesses and how inspection sessions work.

## Can I export a diagram for a pull request?

There is no built-in diagram export or capture comparison. Focus the relevant subtree, take a screenshot with your operating system’s capture tool, and add it beside your explanation. [Explain a change](/docs/explain-a-change/) walks through that workflow.

## Who maintains React Anatomy?

[Nicolas Charpentier](https://github.com/charpeni) develops React Anatomy. The [source code](https://github.com/charpeni/react-anatomy) is available under the [MIT license](https://github.com/charpeni/react-anatomy/blob/main/LICENSE). See [Local development](/docs/development/) to build the extension and website.
