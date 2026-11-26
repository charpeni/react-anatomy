import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { analyzeSources } from './analyze.ts';
import { anatomySourcePlugin } from './esbuild-plugin.ts';

// Builds the "Trace in source" fixture the way a developer would use the
// feature: the app is bundled with the optional call-site metadata, and the
// analysis is produced by running the analyzer over the same source files.
// No trace result is written by hand.

export const fixtureRoot = 'scripts/fixtures/source-trace';
// vendor/Tooltip.tsx is bundled but not analyzed: a partial input.
export const fixtureFiles = [
  'main.tsx',
  'DeskApp.tsx',
  'Frame.tsx',
  'Queue.tsx',
  'QueueFooter.tsx',
  'TicketRow.tsx',
  'Insights.tsx',
  'with-tracking.tsx',
  'data.ts',
];

async function page(title: string, instrumented: boolean) {
  const bundle = await build({
    entryPoints: [`${fixtureRoot}/main.tsx`],
    bundle: true,
    write: false,
    format: 'iife',
    keepNames: true,
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'text' },
    plugins: instrumented ? [anatomySourcePlugin({ root: fixtureRoot })] : [],
  });

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><div id="app"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}

export async function buildSourceTraceFixture() {
  await mkdir('dist', { recursive: true });
  await writeFile(
    'dist/source-trace-app.html',
    await page('Support desk — with source metadata', true),
  );
  // The same app without the plugin: there is no call-site evidence to join.
  await writeFile(
    'dist/source-trace-plain.html',
    await page('Support desk — no source metadata', false),
  );
  await writeFile(
    'dist/source-trace-report.json',
    JSON.stringify(
      analyzeSources({
        root: fixtureRoot,
        files: fixtureFiles.map((file) => `${fixtureRoot}/${file}`),
        label: 'support-desk fixture',
      }),
    ) + '\n',
  );

  // Later edits, analyzed without rebuilding the page. Loading either analysis
  // against the running build must be reported, not matched by position.
  const edit = async (name: string, file: string, change: (text: string) => string) => {
    const copy = `dist/source-trace-${name}`;

    await rm(copy, { recursive: true, force: true });
    await cp(fixtureRoot, copy, { recursive: true });
    await writeFile(`${copy}/${file}`, change(await readFile(`${fixtureRoot}/${file}`, 'utf8')));
    await writeFile(
      `dist/source-trace-report-${name}.json`,
      JSON.stringify(
        analyzeSources({
          root: copy,
          files: fixtureFiles.map((item) => `${copy}/${item}`),
          label: `support-desk fixture (${file} edited)`,
        }),
      ) + '\n',
    );
  };

  // The file that creates the ticket rows changed.
  await edit('edited', 'Queue.tsx', (text) => '// Edited after the page was built.\n' + text);
  // A leaf changed and now reads `density`. No element is written in that file,
  // so only its recorded text hash can reveal the difference.
  await edit('edited-leaf', 'QueueFooter.tsx', (text) =>
    text
      .replace('{ revision }:', '{ revision, density }:')
      .replace('Queue revision {revision}', 'Queue revision {revision} · {density}'),
  );
  console.log('Built dist/source-trace-app.html and its source analysis');
}

if (import.meta.main) {
  await buildSourceTraceFixture();
}
