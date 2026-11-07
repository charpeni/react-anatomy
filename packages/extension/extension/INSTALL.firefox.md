# React Anatomy for Firefox

The published release is on Firefox Add-ons: https://addons.mozilla.org/en-US/firefox/addon/react-anatomy/

To load a build as a temporary add-on instead:

1. Extract this archive.
2. In desktop Firefox 140 or later, open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on…**, then select the extracted `manifest.json`.
4. Open a React page and open Developer Tools. Choose **Anatomy**, possibly in the overflow menu. Reopen Developer Tools if they were already open when you loaded the add-on.

Temporary add-ons are removed when Firefox restarts; use the signed release from Firefox Add-ons for a permanent installation.

Use **Explode view** to separate the page into component layers. Select a component to inspect its live props, or use **Pick on page** and **Focus subtree**. Drag to rotate, scroll to zoom, and choose **Front** for a front-facing view. Clicking the extension's toolbar button opens an inspector window instead. **Reveal in Elements** opens Firefox's Inspector.

Inspection is local and read-only. React Anatomy does not upload captures or props. Reconstructed content can request images and fonts from the inspected page's original asset URLs. Capture covers the current viewport of the top document. The rendered content of open shadow roots is included; iframe contents and closed shadow roots are not. React production builds may shorten or remove component names.

The extension uses private React internals, so compatibility and reconstruction fidelity can vary. A partial-hierarchy message explains when a capture budget is reached; **Capture more** increases it.

Font license texts are included in `licenses/`.
