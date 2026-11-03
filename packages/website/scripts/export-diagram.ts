import type { AddressInfo } from 'node:net';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { browserOptions } from '../../extension/scripts/browser-options.ts';

declare global {
  interface Window {
    openDrawing: (scene: ExcalidrawInitialDataState) => Promise<void>;
    editor: ExcalidrawImperativeAPI;
    exportDrawing: () => Promise<{
      svg: string;
      png: string;
      scene: string;
      fontLoaded: boolean;
      count: number;
      reopenedSvgCount: number;
      reopenedPngCount: number;
    }>;
  }
}

// Excalidraw runs only in this local export tool. The website serves static assets.
const website = fileURLToPath(new URL('../', import.meta.url));
const work = resolve(website, 'artifacts/excalidraw');
const assets = dirname(fileURLToPath(import.meta.resolve('@excalidraw/excalidraw')));
const drawing = resolve(website, 'public/media/diagrams/page-composition');

await mkdir(work, { recursive: true });
await build({
  stdin: {
    contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import {
        Excalidraw, exportToSvg, exportToBlob, serializeAsJSON, loadFromBlob,
      } from '@excalidraw/excalidraw';
      window.openDrawing = async (scene) => {
        const api = await new Promise(resolve => {
          createRoot(document.getElementById('editor')).render(
            React.createElement(Excalidraw, {
              initialData: { ...scene, scrollToContent: true },
              excalidrawAPI: resolve,
              autoFocus: false,
            })
          );
        });
        window.editor = api;
      };
      window.exportDrawing = async () => {
        await document.fonts.ready;
        const elements = window.editor.getSceneElements();
        const appState = {
          ...window.editor.getAppState(),
          viewBackgroundColor: '#ffffff',
          exportBackground: true,
          exportWithDarkMode: false,
          exportEmbedScene: true,
        };
        const files = window.editor.getFiles();
        const options = { elements, appState, files, exportPadding: 28 };
        const svg = await exportToSvg(options);
        const png = await exportToBlob({
          ...options, mimeType: 'image/png',
          getDimensions: (width, height) => ({ width: width * 2, height: height * 2, scale: 2 }),
        });
        const pngData = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(png);
        });
        const reopenedSvg = await loadFromBlob(new Blob([svg.outerHTML], { type: 'image/svg+xml' }));
        const reopenedPng = await loadFromBlob(png);
        return {
          svg: svg.outerHTML, png: pngData,
          scene: serializeAsJSON(elements, appState, files, 'local'),
          fontLoaded: document.fonts.check('24px Excalifont'),
          count: elements.length,
          reopenedSvgCount: reopenedSvg.elements.length,
          reopenedPngCount: reopenedPng.elements.length,
        };
      };
    `,
    resolveDir: website,
    sourcefile: 'excalidraw-export.js',
  },
  bundle: true,
  format: 'esm',
  splitting: true,
  outdir: work,
  entryNames: 'editor',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
});

const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
};
const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;

  if (path === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html>
      <html><head><link rel="stylesheet" href="/vendor/index.css">
      <style>html,body,#editor{height:100%;margin:0}</style></head><body>
      <div id="editor"></div><script>window.EXCALIDRAW_ASSET_PATH='/vendor/';</script>
      <script type="module" src="/editor.js"></script></body></html>`);

    return;
  }

  const vendor = path.startsWith('/vendor/');
  const base = vendor ? assets : work;
  const file = resolve(base, '.' + (vendor ? path.slice(7) : path));

  if (!file.startsWith(base + sep)) {
    response.writeHead(403).end();

    return;
  }

  try {
    const contents = await readFile(file);

    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    response.end(contents);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));

let browser;

try {
  browser = await chromium.launch({ headless: true, ...browserOptions() });

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
  await page.waitForFunction(() => typeof window.openDrawing === 'function');

  const scene = JSON.parse(await readFile(drawing + '.excalidraw', 'utf8'));

  await page.evaluate((scene) => window.openDrawing(scene), scene);
  await page.waitForFunction(() => window.editor?.getSceneElements().length > 0);
  await page.evaluate(async () => {
    await document.fonts.load('24px Excalifont');
    await document.fonts.ready;
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });

  const exported = await page.evaluate(() => window.exportDrawing());

  assert.ok(exported.fontLoaded, 'The original Excalifont font must load before export.');
  assert.ok(exported.svg.includes('data:font/woff2;base64,'), 'SVG must embed its font.');
  assert.equal(exported.count, scene.elements.length, 'Every element must survive import.');
  assert.equal(exported.reopenedSvgCount, scene.elements.length, 'SVG must remain editable.');
  assert.equal(exported.reopenedPngCount, scene.elements.length, 'PNG must remain editable.');
  assert.deepEqual(errors, [], 'Excalidraw must render without browser errors.');
  await writeFile(drawing + '.svg', exported.svg + '\n');
  await writeFile(drawing + '.png', Buffer.from(exported.png, 'base64'));
  // Keep Excalidraw's own measured text dimensions and serialized scene format.
  await writeFile(drawing + '.excalidraw', exported.scene + '\n');
  await page.screenshot({ path: resolve(work, 'editor.png') });
  console.log(
    `Exported ${exported.count} editable elements with embedded Excalifont to SVG and 2× PNG.`,
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
