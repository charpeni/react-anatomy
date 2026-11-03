---
title: Compatibility
description: Browser and React requirements for using React Anatomy.
---

React Anatomy inspects React components running in your browser. It works with development and production builds, without adding a package to your app or installing React DevTools.

## Browsers

Use **desktop Chrome 140+** or **Firefox 140+**.

Brave and Edge can install the Chrome Web Store extension. Chrome and Firefox are the browsers we test. Safari and mobile browsers are not supported.

## React

Supported versions are **React DOM 18.2, 18.3, and 19.0–19.3**. Use the latest patch of your React release.

- **Development builds** give you the most readable component names. Production builds work too, but names may be shortened or missing.
- **Server-rendered apps**, including Next.js, need to finish hydrating before their client components can be inspected. Server-only components and their props are not visible.
- **React Native, Preact, and experimental React builds** are outside the supported scope.

For capture limits and differences between the page and its 3D view, see [Current limitations](/docs/limitations/).
