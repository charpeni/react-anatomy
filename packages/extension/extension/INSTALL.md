# React Anatomy — extension preview

1. Extract this archive to a folder you will keep.
2. Open chrome://extensions or edge://extensions and enable Developer mode.
3. Choose **Load unpacked** and select this folder (the one with manifest.json).
4. Open your React app. Open DevTools and choose the **Anatomy** tab, possibly under the » menu. Reopen DevTools if it was already open during installation.

React Anatomy captures automatically. Use **Explode view**, **Pick on page**, **Follow changes**, and **Focus subtree** to explore the app. Drag the dividers to resize the tree and details panes. Arrow keys navigate the tree; F focuses a component. Props and detail sections are collapsible. The panel follows the DevTools color theme.

Undock DevTools for a larger 3D view. Clicking the extension's toolbar button opens an inspector window instead.

Select a component to read its **Props**. Expand objects, arrays, and React children; filter by prop name or use **Refresh props** to read current values without recapturing the page. Props are read-only, and getters and callbacks are not invoked.

Wrappers that return exactly the same DOM output share a plane by default, so deep provider chains do not hide individual UI components. All React components remain in the tree with their own props. Use **Wrappers** in the view toolbar to show those layers separately. **Layer depth** counts the displayed layers; the inspector's **Depth** still reports the original React hierarchy. A banner identifies partial captures when a component or nesting limit is reached. Production builds can still have shortened or anonymous names.

**Layer depth** starts in **Auto**, which explores visible regions independently so deeper main content is not hidden behind a shallower sidebar. Extra containers and small details stay painted within their shown parent; every captured component remains in the tree. Selecting a component reveals its plane. Move the slider left to group more output into parents, or right to give deeper components separate planes. Click **Auto** to restore the overview. **Focus subtree** gives you an overview of just that component, including smaller local details. **Separation** changes spacing, not which components appear. Enabling **Wrappers** switches to manual depth and makes shared-output wrappers available as separate layers.

A capture starts with a limit of 2,000 components and 300 nested levels. If a limit is reached, the banner shows which one and offers **Capture more**. Component limits increase to 5,000, then 10,000; nesting can increase up to 1,000 levels. Manual capture and Follow changes keep the larger budget for that page. Navigation resets it. Captures that reach the maximum remain clearly marked as partial.

No changes to your React app are required. This preview has been tested with React 19 in Chromium. It uses private React internals and a computed-style DOM snapshot, so compatibility and visual fidelity can vary. Capture covers the top document's current viewport; iframe and shadow-root contents are not included. No data is uploaded to a service.

Fonts and their license texts are included in the licenses folder.
