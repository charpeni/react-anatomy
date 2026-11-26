---
title: Privacy policy
description: How the React Anatomy extension handles inspection data and how the website measures visits.
prev: false
next: false
---

Last updated: November 24, 2026

React Anatomy is a browser extension developed by [Nicolas Charpentier](https://github.com/charpeni). It inspects React pages locally in your browser. **We do not receive your captures or component props.** The extension has no accounts, analytics, advertising, or remote error reporting.

This policy covers the browser extension and react-anatomy.com. Privacy questions can be sent to [info@react-anatomy.com](mailto:info@react-anatomy.com).

## What the extension accesses

When you open Anatomy for a page, it reads the information needed to show that page’s composition:

- The page’s URL and title.
- React component names, relationships, and the props you inspect.
- Page content and layout, including text, styles, images, canvas output, and form values.
- The context providers each component reads and, while you record renders, how often React rendered each component.

This information powers the component tree, 3D layers, props inspector, context readers, and page selection tools. Inspection can follow changes and navigation while the panel is open. The extension does not scan unrelated tabs or read your browser’s history database.

Page content and props can contain personal or confidential information. Password and file inputs are cleared in the reconstructed view, but the same information may still appear in props or elsewhere on the page. Captures are not a reliably redacted version of your app.

Measuring renders is optional. If you choose **Reload page to measure renders**, Anatomy reloads the inspected page and adds a small hook that receives React’s commit reports for that page load. Recording stops when you stop it or close the panel.

## Permissions

In DevTools, Anatomy uses the browser’s inspected-page APIs. Its toolbar entry point uses:

- **activeTab:** temporary access to the tab you choose to inspect by clicking the extension button.
- **scripting:** runs the inspection code in that tab to read components and layout and highlight selected elements.

## Storage and your controls

Captures and inspected props are held in memory during inspection. The extension does not save them to persistent extension storage, synchronize them across devices, or upload them to a service.

**Unused props** is optional. It reads a source analysis file only when you choose one. The panel keeps the file in memory until you remove it or close the panel. The file stays on your computer. To check a component, the extension reads prop names and the file positions and text hashes that an opt-in development build recorded on the page.

Close DevTools or the Anatomy window to stop inspection, then reload the inspected page to clear any remaining inspection state. Uninstalling the extension removes its ability to inspect pages. Images you export, and any screenshots or recordings you make, remain under your control. An exported image is created locally and leaves your browser only when you paste or attach it somewhere. Check its contents before sharing it.

**Copy component context** puts the previewed component names, keys, and any prop value you explicitly include on your clipboard when you choose **Copy text**. You decide where to paste it. Review the preview for private data before sharing it.

## Requests for page assets

Recreating a page can reload its images, backgrounds, and fonts from their original URLs. Exporting an image can request them again, to include them in the image. Those requests go directly to the sites or asset providers, without passing through a React Anatomy server. They can expose the requested URL, your IP address, and normal browser request headers to those providers. Browser caching and cookie rules apply, and providers may keep their own request logs.

We do not sell inspection data or use it for advertising or analytics. React Anatomy’s use of information obtained through Chrome APIs follows the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/policies#protecting-user-privacy), including the Limited Use requirements.

## Website analytics

React-anatomy.com uses Pirsch and InsightFlare to understand which pages people visit. Both services process page, referrer, browser, and device information. InsightFlare also measures visit duration and page performance. The page addresses it records can include query strings and fragments. When you follow a link to another website, InsightFlare records the page you clicked from and the full destination URL.

The website uses InsightFlare’s Weak tracking mode, which counts visits without saving a persistent visitor ID in your browser’s local storage. These tools run on the website. The extension keeps captures and inspected component props local to your browser.

## Website example

The interactive example on react-anatomy.com stores one flag in your tab’s session storage to remember that its automatic introduction has played or been dismissed. The flag is not sent to us and contains no page content or personal information. It clears when the tab session ends and is separate from the browser extension’s inspection data.

## Contacting us

If you email [info@react-anatomy.com](mailto:info@react-anatomy.com), we receive your email address and the information you choose to send. We use it to respond to your request; our email provider processes the correspondence to deliver and store it. We retain messages only as needed to handle the request and meet legal obligations. You can ask us to delete your correspondence. Please avoid sending credentials or private page data.

## Changes to this policy

Changes will be posted on this page with an updated date. If the extension’s data practices change, we will update the policy and provide any required notice or consent before those practices take effect.
