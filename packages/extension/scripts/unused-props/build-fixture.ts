import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { analyzeSources } from '../source-trace/analyze.ts';
import { anatomySourcePlugin } from '../source-trace/esbuild-plugin.ts';

// Builds the "Unused props" fixture the way a developer would: the app is
// bundled with the optional call-site metadata, and the analysis comes from
// running the analyzer over the same files. No audit result is written by hand.

export const UNUSED_PROPS_ROOT = 'scripts/fixtures/unused-props';
// vendor/Tooltip.tsx is bundled but not analyzed, as a package would be.
export const UNUSED_PROPS_FILES = [
  'main.tsx',
  'BillingApp.tsx',
  'PlanCard.tsx',
  'Toolbar.tsx',
  'Forms.tsx',
  'Feedback.tsx',
  'Edges.tsx',
  'data.ts',
];

export function analyzeUnusedPropsFixture(root = UNUSED_PROPS_ROOT) {
  return analyzeSources({
    root,
    files: UNUSED_PROPS_FILES.map((file) => `${root}/${file}`),
    label: 'billing fixture',
  });
}

async function page(title: string, instrumented: boolean) {
  const bundle = await build({
    entryPoints: [`${UNUSED_PROPS_ROOT}/main.tsx`],
    bundle: true,
    write: false,
    format: 'iife',
    keepNames: true,
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'text' },
    plugins: instrumented ? [anatomySourcePlugin({ root: UNUSED_PROPS_ROOT })] : [],
  });

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><div id="app"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export async function buildUnusedPropsFixture() {
  await mkdir('dist', { recursive: true });
  await writeFile('dist/unused-props-app.html', await page('Billing — with source metadata', true));
  // The same app without the plugin: no instance can be matched to an element.
  await writeFile(
    'dist/unused-props-plain.html',
    await page('Billing — no source metadata', false),
  );
  await writeFile(
    'dist/unused-props-report.json',
    JSON.stringify(analyzeUnusedPropsFixture()) + '\n',
  );
  console.log('Built dist/unused-props-app.html and its source analysis');
}

if (import.meta.main) {
  await buildUnusedPropsFixture();
}
