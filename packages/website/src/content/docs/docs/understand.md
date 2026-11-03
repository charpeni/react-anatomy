---
title: Understand a page
description: Go from something you see on a React page to the component that renders it, read the layout as layers, and follow the props.
---

Use this when you open a page you don’t know well: a new codebase, someone else’s feature, or a layout you are learning from. The goal is a picture of how the page is composed that you could sketch on a whiteboard.

Open DevTools on the page and choose **Anatomy**, possibly under the `»` menu. The first capture happens automatically. Undock DevTools if you need more room.

## Start from what you see

You usually know what something looks like before you know what it is called.

1. Choose **Pick on page** (or press **C**) and click the region you are curious about in your app.
2. Anatomy selects the closest component that rendered what you clicked. Its row is selected in the tree and its plane in the 3D view.
3. Read the **Component stack** in the inspector. It lists the components above the selection, so you can see where it sits: for example a card, inside a list, inside the main content.
4. Use **Highlight on page** to confirm the region in your app, or **Reveal in Elements** to see its DOM output.

If you already know a name, press **/** and filter the tree instead.

## Read the outline

Collapse the tree to its top levels, then open one branch at a time. The first two or three levels usually describe the page’s regions — a sidebar, a header, a main area — and deeper levels describe what those regions are made of.

Keys appear next to repeated components. Three `ProjectCard` rows with keys tell you a list rendered one card per item.

## See the layers

**Explode view** separates the page into planes. Keep **Labels** on to see component names on the planes (they keep a readable size when the view zooms out), drag to orbit, and use **Front** to look straight at the page again.

**Layer depth** starts in **Auto**, which gives each visible region its own layers even when one branch is much deeper than another. Wrappers that render identical output share a plane, but they keep their own tree rows.

[![Auto depth separating a sidebar, a main layout, message cards and a composer, despite a long chain of ContentBoundary components in the tree.](/media/auto-depth.png)](/media/auto-depth.png)

_The tree shows a deep chain of containers; Auto depth still gives the visible regions their own layers. Select the image to open it at full size._

## Zoom into one part

Select a component and choose **Focus subtree**, double-click it, or press **F**. The scene shows only that component and its descendants, which makes small children — a badge, a progress bar — easy to see. The breadcrumbs above the scene show where the focused part sits; **Whole page** or **Escape** returns to the overview.

## Follow the data

Structure tells you who renders whom; props tell you what each one received.

Select a parent, then one of its children, and compare their **Props**. A list usually receives an array and hands one item to each child; a card might receive a `project` object and a callback. Expand objects and arrays to read nested values as they are right now.

[![The props inspector for a ProjectCard, with project, settings and release expanded to show the release channel and version.](/media/docs/props.png)](/media/docs/props.png)

_A card’s live props, expanded down to `project.settings.release`. Select the image to open it at full size._

Props are read-only and current: interact with the page, then choose **Refresh props** to see new values. See [Props inspector](/docs/props/) for what is and isn’t evaluated.

## Try it on the example

The [interactive example](/#demo) runs the real inspector against a small sample app. Open Anatomy, explode the page, pick a project card, and follow its props — no extension needed.
