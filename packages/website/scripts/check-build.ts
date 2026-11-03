import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

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
  'docs/faq/index.html',
  'privacy/index.html',
  'robots.txt',
  'llms.txt',
  '_headers',
  'media/react-anatomy-social.png',
  'pagefind/pagefind.js',
  'pagefind/pagefind-entry.json',
]) {
  const file = new URL(`../dist/${path}`, import.meta.url);
  const info = await stat(file).catch(() => null);

  if (!info?.isFile() || info.size === 0) {
    throw new Error(`Website build is incomplete: ${path} is missing or empty.`);
  }
}

const output = (path: string) => new URL(`../dist/${path}`, import.meta.url);
const text = (path: string) => readFile(output(path), 'utf8');
const sitemap = await text('sitemap-0.xml');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => new URL(match[1]));

assert(urls.length >= 12, 'Sitemap must include the landing page, docs, FAQ, and policy.');
assert.equal(new Set(urls.map((url) => url.href)).size, urls.length, 'Duplicate sitemap URLs');

for (const url of urls) {
  assert.equal(url.origin, 'https://react-anatomy.com');
  assert(url.pathname.endsWith('/'), 'Only canonical HTML pages belong in the sitemap.');
  assert(!url.pathname.startsWith('/interactive/'), 'The bundled example must not be indexed.');
  assert(!url.pathname.includes('404'), 'The missing-page route must not be indexed.');
  assert(
    (await text(`${url.pathname.slice(1)}index.html`)).includes('<h1'),
    'Pages need visible headings.',
  );
}

const robots = await text('robots.txt');

assert.match(robots, /User-agent: \*\nAllow: \/\n/);
assert.match(robots, /Sitemap: https:\/\/react-anatomy\.com\/sitemap-index\.xml/);
assert(!/Disallow:\s*\/\s*$/m.test(robots), 'Do not block crawlers from the public docs.');

const index = await text('llms.txt');
const headers = await text('_headers');
const documents = [...index.matchAll(/\]\((https:\/\/react-anatomy\.com\/[^)]+\.md)\)/g)];

assert.equal(
  documents.length,
  urls.length - 1,
  'Every documentation page needs a Markdown equivalent.',
);

for (const [, address] of documents) {
  const url = new URL(address);
  const markdown = await text(url.pathname.slice(1));
  const canonical = `${url.origin}${url.pathname.replace(/\.md$/, '/')}`;

  assert(markdown.startsWith('# '), `Missing title in ${address}`);
  assert(markdown.includes(`Source: ${canonical}`), `Missing citation URL in ${address}`);
  assert(
    urls.some((url) => url.href === canonical),
    'Markdown must point to a real HTML page.',
  );
  assert(markdown.length > 300, 'Markdown must contain the document, not just a summary.');
  assert(!/\]\(\//.test(markdown), 'Markdown links must work outside the website.');
  assert(headers.includes(`Link: <${canonical}>; rel="canonical"`));
}

assert(
  (await text('docs/faq.md')).includes('/docs/limitations/#capture-boundaries'),
  'Markdown must retain heading anchors.',
);
assert(headers.includes('/interactive/*\n  X-Robots-Tag: noindex'));
assert(
  headers.includes('/llms.txt\n  Content-Type: text/plain; charset=utf-8\n  X-Robots-Tag: noindex'),
);

const social = await readFile(output('media/react-anatomy-social.png'));

assert.equal(social.readUInt32BE(16), 1200);
assert.equal(social.readUInt32BE(20), 630);
console.log(
  'Verified website, search index, sitemap, crawl rules, social image, and generated Markdown.',
);
