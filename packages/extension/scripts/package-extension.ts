import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync, unzipSync, type Zippable } from 'fflate';
import { extensionTarget } from './extension-target.ts';

const target = extensionTarget();
const root = target.directory;
const files: Zippable = {};

async function collect(directory = '') {
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const relative = directory ? `${directory}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await collect(relative);
    } else if (entry.isFile()) {
      files[relative] = [
        new Uint8Array(await readFile(join(root, relative))),
        { mtime: new Date('2000-01-01T00:00:00Z') },
      ];
    }
  }
}

await collect();

const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const archive = zipSync(files, { level: 9 });
const unpacked = unzipSync(archive);

for (const icon of Object.values(manifest.icons as Record<string, string>)) {
  if (!unpacked[icon]) {
    throw new Error(`Missing packaged icon: ${icon}`);
  }
}

await mkdir('artifacts', { recursive: true });

const destination = `artifacts/${target.archivePrefix}-${manifest.version}.zip`;

await writeFile(destination, archive);
console.log(`Packaged ${Object.keys(unpacked).length} files: ${destination}`);
