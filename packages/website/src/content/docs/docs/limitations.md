---
title: Current limitations
description: What React Anatomy can capture and where the reconstruction can differ.
---

For supported browser and React versions, see [Compatibility](/docs/compatibility/).

A separate Edge store release is deferred. Safari is outside the current release plan.

## Other Chromium browsers

[Brave](https://support.brave.app/hc/en-us/articles/360017909112-How-can-I-add-extensions-to-Brave) and [Edge](https://support.microsoft.com/en-gb/edge/add-turn-off-or-remove-extensions-in-microsoft-edge) support installing extensions from the Chrome Web Store. Use [React Anatomy’s Chrome listing](https://chromewebstore.google.com/detail/react-anatomy/cllgnlljmehhoemdlfngkkpienkglkml) in those browsers too; a separate Brave or Edge release is not required.

React Anatomy has not yet been validated in Brave or Edge. Sharing Chromium and supporting Chrome extensions does not establish that every DevTools feature behaves the same. We will list browser-specific test results as they become available.

## React internals and production builds

The extension reads private React Fiber data. React updates can change those internals. Production apps can expose their hierarchy without React DevTools being installed, but minification can shorten component names or leave them anonymous. Anatomy cannot recover original source names that the build removed.

Components with no visible output can appear in the tree without having a useful plane in the scene. Wrappers with identical output share a plane unless **Wrappers** is enabled.

## Capture boundaries

Captures cover the **top document’s current viewport**. The 3D view includes the rendered content of open shadow roots, such as web components. Iframe contents and closed shadow roots are not captured.

The 3D view reconstructs DOM output using computed styles. It is not an exact browser paint capture. Canvas, video, complex effects, external assets, and unusual positioning can look different from the source page.

## Partial hierarchy

A capture starts with a budget of **2,000 components** and **300 nested levels**. When a limit is reached, the panel marks the hierarchy as partial and identifies the reason in Capture notes.

**Capture more** raises the limit that was reached: the component budget to 5,000, and the nesting budget to 600 and then 1,000. The larger budget persists across manual capture and Follow changes on the same page. Navigation resets it. Captures that reach the maximum remain marked as partial.

Increasing Layer depth does not capture missing components. Depth changes how an existing capture is displayed; **Capture more** changes the traversal budget.

## Exported images

**Export image** draws the current view inside the panel. An image cannot load anything by itself, so page images and fonts are embedded first:

- Images the page has loaded and can read, from its own origin or from servers that allow cross-origin access, are included. Others appear as gray boxes, and the export dialog says how many.
- CSS background images are included only from servers that allow cross-origin access.
- Page fonts are included when the panel can load them, only for the characters the image shows. Otherwise, their text uses a fallback font, as it does in the panel.
- Embedded images and fonts are limited to 16 MB in total, and are loaded for up to 15 seconds. Closing the dialog stops loading.

Name tags sit on their layer’s top edge. Where layers crowd, a tag moves aside with a line back to its layer, and tags without room near their layer are left out, except for included and selected components. Props cards show up to 40 lines each.

In Firefox, text that exactly fits its box on the page can wrap differently in the image.

## Privacy

No capture or props data is uploaded to a service by the extension. Exported images are created in the panel and leave your browser only when you paste or attach them. The reconstructed page can load images and fonts from the original page’s asset URLs. Sensitive values can be visible in the inspector, just as they can in other local debugging tools.
