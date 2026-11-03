import { stat } from 'node:fs/promises';

// Pagefind's service can exit before replying if its native binary cannot run on
// the host CPU. Astro may then exit successfully with no search index. Check the
// actual output so a broken search experience cannot be packaged as a good build.
for (const path of [
  'index.html',
  'interactive/source.html',
  'interactive/source.js',
  'interactive/panel.html',
  'interactive/panel.js',
  'media/diagrams/page-composition.svg',
  'media/diagrams/page-composition.png',
  'media/diagrams/page-composition.excalidraw',
  'docs/index.html',
  'docs/understand/index.html',
  'docs/explain-a-change/index.html',
  'docs/generated-code/index.html',
  'docs/compatibility/index.html',
  'privacy/index.html',
  'pagefind/pagefind.js',
  'pagefind/pagefind-entry.json',
]) {
  const file = new URL(`../dist/${path}`, import.meta.url);
  const info = await stat(file).catch(() => null);

  if (!info?.isFile() || info.size === 0) {
    throw new Error(`Website build is incomplete: ${path} is missing or empty.`);
  }
}

console.log('Verified built landing page, documentation, and Pagefind search assets.');
