---
title: Explain a change
description: Export an image of your change’s component structure, with the props that matter, for a pull request description.
---

A diff shows which lines changed. It doesn’t show how the change sits in the rendered page: which component now renders what, inside which parent, with which props. An exported image of the relevant part, with a few sentences next to it, gives a reviewer that picture without installing anything.

React Anatomy exports the image. You choose what it shows and write the explanation; Anatomy does not generate pull request text or compare captures.

## 1. Open the changed page

Run your branch locally and open the page in the state your change affects — for example, with a few items in the list, or with the new option enabled. Anatomy only shows what is rendered, so the state matters.

Open DevTools and choose **Anatomy**.

## 2. Frame the part you changed

1. Find the component: **Pick on page**, or press **/** and filter by name.
2. Choose **Focus subtree** (or press **F**) so the scene contains only that component and its children. A whole page also exports, but a focused subtree makes a clearer image.
3. Choose **3D** to show nesting, or **Front** if the layout itself is the point. Adjust **Separation** until the children are readable.
4. Keep **Labels** on to name layers in the image. Components you include in the next step, and the selected one, are always named; other names are left out where there is no room near their layer. With **Labels** off, only included and selected components are named.

[![A ProjectCard subtree in focus: StatusBadge, ProgressBar and AvatarStack separated in 3D, with the breadcrumbs above the scene and the card’s props at the right.](/media/docs/focus.png)](/media/docs/focus.png)

_The image uses the camera angle, separation, and layers you see in the panel._

## 3. Choose the props to show

1. Select a component whose props matter, and choose **Include in image** in its **Props** section.
2. Expand the values the reviewer needs. The image shows top-level props and the branches you expanded, as you last saw them in the inspector, up to 40 lines per component.
3. Hover a value and use its eye button, **Hide in props card**, for values the reviewer does not need, such as a token or an email address. Its name stays, and the value appears as hidden. Hiding applies to the props card only: the same text stays visible if the page draws it on a layer, and the export dialog warns you when it does.

Repeat for other components. They are numbered in the order you include them; each number appears on the component’s layer and on its props in the image. Your choices stay while you focus other parts of the page or capture again, and turning **Include in image** off and on keeps the values you hid. Reloading the page clears them, because its components are new.

The image never reads props again when you export. If you hid an entry of a list, Map, or Set, or a value inside one, and another value later takes its place, the props inspector flags the collection, and the image masks all of it until you check its hidden values and choose **Keep hidden values**.

## 4. Export the image

Choose **Export image** above the scene, or press **E**. The preview is the exact image you will share: the layers with readable component names on their edges, as in the panel, the props you chose below them, the component’s path in the page, and when the page was captured and its props reviewed. Use **100%** to proofread it at the size a pull request shows it. Exported images are sized to fit a pull request description, always use the light theme, and have twice as many pixels as their layout size for sharp text.

The dialog lists the props cards and how many values each hides. It also tells you when props changed after you reviewed them, when a hidden value also appears in page text, and when images or fonts could not be included.

- **Copy image**, then paste it into the pull request description.
- **Download PNG** to attach the file or keep it.

Before posting, look at what the image contains. Page text and props can include real data from the environment you captured — names, emails, tokens in URLs. Use local or test data when you can, and hide values you do not need. If a before-and-after comparison helps, check out the base branch, export the same view, and place the two images side by side.

## 5. Write the explanation

Describe the structure in a few sentences, in terms the reviewer can check against the image and the diff. The numbers in the image make it easy to point at components. For example, for a change to the project cards in the [Orbit sample app](https://orbit.react-anatomy.com/):

```md
### Structure

![ProjectCard subtree in React Anatomy](react-anatomy-ProjectCard.png)

`ProjectList` renders one `ProjectCard` (1) per project, keyed by `project.id`.
This change moves the progress display into a new `ProgressBar` (2) child,
which receives `project.progress` and `project.color`.
`StatusBadge` and `AvatarStack` are unchanged.
```

Useful details to mention:

- the parent that renders the changed component, and how many instances appear;
- new or moved components, and where they now sit;
- props a component now receives, or no longer receives;
- the page state the image shows, if it matters.

## What an image can’t show

The image is one capture of one state. It does not show other routes, empty or error states, or components that are imported but not rendered. It also doesn’t show source files: point reviewers to the files in the diff for that.

Props in the image are the ones you last reviewed in the inspector; exporting does not read them again. If the page changed after the capture, or props changed after you reviewed them, the export dialog says so: capture again, and select each included component to review its props.
