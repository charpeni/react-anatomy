---
title: Read generated code
description: Look at the component structure an AI agent actually rendered before you take ownership of the code.
---

When an AI agent writes or changes a page, you can end up responsible for code you didn’t compose. The diff may be large, and the structure is spread across files. Before you build on it, it helps to see what the page actually renders: which components, how they nest, and what each receives.

React Anatomy shows that structure. It doesn’t read the agent’s conversation or your source code, and it doesn’t tell you whether the code is correct, safe, or idiomatic. It gives you a clear picture so that you can make that judgment.

## Look at what rendered

Run the page and open **Anatomy**. Then work through a few questions:

**What frames the page?** Read the top levels of the tree. Do the regions match what you expected — a layout component, a header, a main area — or did the agent introduce its own containers?

**How deep is it?** Open the branches that lead to the content you care about. A long chain of wrappers before anything visible is worth a look in the source. Auto depth keeps the 3D view readable, but the tree still shows every captured level.

**What repeats?** Lists appear as repeated rows. Check that each item has a meaningful key next to its name.

**Where does this come from?** Pick any region you don’t recognize with **Pick on page**. Its name and **Component stack** tell you which component renders it and inside what.

**What goes in?** Select components and read their **Props**. Look for data shapes you didn’t expect, values passed through many levels, or callbacks you can’t place.

When something stands out, search your editor for the component’s name to find its source. **Reveal in Elements** shows the DOM it produced.

## Cover more than one state

Anatomy shows the current state only. A component that renders only when a list is empty, a request fails, or a flag is on won’t appear until the page is in that state. Exercise the states that matter and capture each one.

## Prefer a development build

Production builds can shorten or remove component names. Run the agent’s code in development mode to see the names it chose. See [current limitations](/docs/limitations/).

## Next steps

- [Understand a page](/docs/understand/) covers picking, layers, focus, and following props in more depth.
- [Explain a change](/docs/explain-a-change/) shows how to describe the structure in a pull request once you understand it.
