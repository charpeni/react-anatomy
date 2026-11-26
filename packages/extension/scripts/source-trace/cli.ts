import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { analyzeSources } from './analyze.ts';
import { isSourcePath, projectPath } from './shared.ts';

const usage = `Usage: node scripts/source-trace/cli.ts [options] <file or directory>...

Analyzes React components in the given TypeScript and JavaScript files and
writes a source analysis for the React Anatomy inspector.
The analysis is written to a local file. Nothing is uploaded.

Options:
  --root <dir>   Directory that file paths are reported relative to (default: .)
  --out <file>   Where to write the analysis (default: react-anatomy-trace.json)
  --label <text> A name for the project, shown in the inspector
  --tsconfig <file>   TypeScript config for import aliases (default: nearest to --root)
  --help         Show this message

Imports that resolve outside the listed files are reported as unknown.`;

async function collect(path: string, found: string[]) {
  const info = await stat(path);

  if (info.isFile()) {
    if (isSourcePath(path)) {
      found.push(path);
    }

    return;
  }

  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }

    const child = join(path, entry.name);

    if (entry.isDirectory()) {
      await collect(child, found);
    } else if (isSourcePath(child) && !/\.(test|spec|stories)\.[^.]+$/.test(entry.name)) {
      found.push(child);
    }
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    root: { type: 'string', default: '.' },
    out: { type: 'string', default: 'react-anatomy-trace.json' },
    label: { type: 'string' },
    tsconfig: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || !positionals.length) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}

const root = resolve(values.root);
const files: string[] = [];

for (const input of positionals) {
  await collect(resolve(input), files);
}

files.sort();

const outside = files.filter((file) => projectPath(root, file).startsWith('..'));

if (outside.length) {
  console.error(`These files are outside --root ${root}:\n  ${outside.join('\n  ')}`);
  process.exit(1);
}

if (!files.length) {
  console.error('No TypeScript or JavaScript source files were found.');
  process.exit(1);
}

const report = analyzeSources({ root, files, label: values.label, tsconfig: values.tsconfig });
const unresolved = report.sites.filter(
  (site) => !site.target && site.unresolved?.reason !== 'react-builtin',
).length;

await writeFile(values.out, JSON.stringify(report) + '\n');
console.log(
  `Analyzed ${report.files.length} files: ${report.components.length} components, ${report.sites.length} component elements (${unresolved} unresolved).`,
);

for (const note of report.notes) {
  console.log(`Note: ${note}`);
}

console.log(
  `Wrote ${values.out}. In React Anatomy, select a component, then choose "Load source analysis…" to open this file.`,
);
