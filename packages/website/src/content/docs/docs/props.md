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

Use **Copy component context** in the selected component’s details when you want to point someone to a specific instance. The preview includes its name, React key when available, path through the tree, and immediate rendered children. It shortens long paths and marks incomplete child lists.

1. In the [interactive example](/#demo), choose **Inspect props** to select the Design system card.
2. Open **Copy component context**. To include its progress, enter `project.progress` in **Optional prop path** and choose **Include prop**.
3. Review **Text to copy**, then choose **Copy text**. Paste it into an issue or an agent prompt alongside your question. If the browser asks you to copy manually, the preview is already selected.

With the sample card at its starting value, you’ll see this text.

```text
Component: ProjectCard [key="design-system"]
Path: WorkspaceApp → MainContent → ProjectList → ProjectCard [key="design-system"]
Rendered children: ProgressBar, StatusBadge, AvatarStack
Prop project.progress (number): 72
```

The prop line appears only when you add it. **Include prop** reads the current value at that path. Objects and collections get a short preview. **Remove prop** returns to the component structure alone.

[Watch the narrated demo (28 seconds)](/media/docs/copy-component-context.mp4).

## Props in exported images

Choose **Include in image** in the **Props** section to show a component’s props in [exported images](/docs/explain-a-change/). The image lists its top-level props and the branches you expanded, as the inspector last showed them; it does not read the page again when you export. Hover a value and use its eye button, **Hide in props card**, to hide it; its name stays. Page text on the layers is not affected.

A hidden entry of a list, Map, or Set, or a value inside one, such as an email in a list of users, is tracked by its position. If another value takes that position, the inspector flags the collection and the image masks all of it, until you check it and choose **Keep hidden values**.

Included components are numbered in the order you add them. The choice stays with the component across subtree focus and recapture, and turning **Include in image** off and on keeps its hidden values. Navigating or reloading the page clears the choices.

## Read-only inspection

The inspector does not call getters, callbacks, or `toJSON`. Accessors are shown as unevaluated getters. Circular references are marked, and values such as `undefined`, bigint, `NaN`, and symbols stay distinguishable.

React children show their type, key, and props without traversing React’s private owner graph. App-defined proxies can still execute their own traps during JavaScript reflection.

## Bounded requests

Each request returns at most 50 entries or 10,000 string characters. The inspector caps collections at 10,000 entries, strings at 1,000,000 characters, and retained value handles at 5,000 per session. It shows when these limits are reached.

Props stay in the inspected page until requested and are not uploaded to a service.
