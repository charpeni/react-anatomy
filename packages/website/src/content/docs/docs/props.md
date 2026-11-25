---
title: Props inspector
description: Read the live props a component received, without changing the inspected app.
---

Props show what each component actually received: the data and callbacks its parent passed down. They are often the quickest way to explain why a part of the page looks the way it does. See [Follow the data](/docs/understand/#follow-the-data) for a walkthrough.

Select a component in the tree, the scene, or the page picker. Its **Props** section reads the current committed React props.

Expand objects, arrays, Map and Set entries, or React children. **Filter prop names** searches top-level names; **Show more** reveals additional entries or more of a long string.

[![The real props inspector for ProjectCard, with project, settings, and release expanded to show the release channel and version.](/media/docs/props.png)](/media/docs/props.png)

_Nested values are read as you expand them. Here, `project.settings.release` shows the card’s release channel and version. Open the image at full size to read the inspector._

## Live values

Props are read as you expand their branches. They are not a historical snapshot of the moment the page was captured.

Use **Refresh props** to reread values without capturing the whole page. A new capture refreshes the selection’s props and keeps expanded paths. If the props object changes or the component unmounts, the inspector asks you to refresh or recapture.

## Copy component context

When several components share a name, **Copy component context** helps you point to the one you mean. The preview includes the selected instance’s name, React key when available, path through the tree, and immediate children. Long paths are shortened and incomplete child lists are marked.

1. On your React page, open **Anatomy** in DevTools. Select a component in the tree, or choose **Pick on page** and click the part of your app you want to inspect.
2. In the component details, open **Copy component context**. To include a live value, enter its dot-separated path in **Optional prop path** and choose **Include prop**. Use **Remove prop** to leave it out.
3. Review **Text to copy**, choose **Copy text**, and paste it into an issue or an agent prompt. If your browser asks you to copy manually, the preview is already selected.

### Example from Orbit

Orbit renders three `ProjectCard` instances. Selecting the Design system card and including `project.progress` produces this text.

```text
Component: ProjectCard [key="design-system"]
Path: WorkspaceApp → MainContent → ProjectList → ProjectCard [key="design-system"]
Rendered children: ProgressBar, StatusBadge, AvatarStack
Prop project.progress (number): 72
```

The prop line shows the value at the time you choose **Include prop**. Objects and collections get a short preview. When you capture the page again, manually or with **Follow changes**, the preview drops that line and keeps the path you entered. Choose **Include prop** again to read the new value.

<video controls playsinline preload="metadata" width="1280" height="720" aria-label="Copy component context from an Orbit project card" poster="/media/docs/copy-component-context-poster.jpg" src="/media/docs/copy-component-context.mp4">
  <track kind="captions" srclang="en" label="English" src="/media/docs/copy-component-context.en.vtt" />
  <a href="/media/docs/copy-component-context.mp4">Watch the 28-second narrated demo.</a>
</video>

To try the same card in the [interactive example](/#demo), choose **Inspect props**.

## Props in exported images

Choose **Include in image** in the **Props** section to show a component’s props in [exported images](/docs/explain-a-change/). By default the card shows its top-level props and the branches you expanded, as you last reviewed them. In **Export image**, choose **Collapsed** for top-level props only, or **Show types instead of prop values** to label each visible prop with its runtime type. Hover a value in the inspector and use **Hide in props card** to hide it in either format. The card keeps the prop name. Page text and component keys remain visible. See the [prop detail demo](/docs/explain-a-change/#choose-prop-detail) for an example.

A hidden entry of a list, Map, or Set, or a value inside one, such as an email in a list of users, is tracked by its position. If another value takes that position, the inspector flags the collection and the image masks all of it, until you check it and choose **Keep hidden values**.

Included components are numbered in the order you add them. The choice stays with the component across subtree focus and recapture, and turning **Include in image** off and on keeps its hidden values. Navigating or reloading the page clears the choices.

## Read-only inspection

The inspector does not call getters, callbacks, or `toJSON`. Accessors are shown as unevaluated getters. Circular references are marked, and values such as `undefined`, bigint, `NaN`, and symbols stay distinguishable.

React children show their type, key, and props without traversing React’s private owner graph. App-defined proxies can still execute their own traps during JavaScript reflection.

## Find the same reference

Choose **Find same reference** beside a top-level object, array, or function prop to see which mounted instances hold the same value, even under a different prop name. [Follow a shared callback in Orbit](/docs/find-the-same-reference/).

## Bounded requests

Each request returns at most 50 entries or 10,000 string characters. The inspector caps collections at 10,000 entries, strings at 1,000,000 characters, and retained value handles at 5,000 per session. It shows when these limits are reached.

Props stay in the inspected page until requested and are not uploaded to a service.

## Investigate unused props

Open [Unused props](/docs/unused-props/) to check whether the code reads or forwards a prop passed to the selected instance.

## Where a prop comes from

Props show the value a component received. To see which component created it and where your code uses it, load a source analysis and use [Trace in source](/docs/trace-a-prop/).
