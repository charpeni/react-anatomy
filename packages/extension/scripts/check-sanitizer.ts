import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Page markup is filtered twice: by the page agent as it serializes a snapshot,
// and again by the viewer before that markup enters the extension's document.
// The agent is serialized into the inspected page and cannot import anything,
// so each side writes its lists out by hand. This check fails when they drift.

const read = (file: string) =>
  readFile(new URL(`../src/inspector/${file}`, import.meta.url), 'utf8');

function literalSet(source: string, file: string, name: string) {
  const declarations = [
    ...source.matchAll(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`, 'g')),
  ];

  assert.equal(
    declarations.length,
    1,
    `${file} must declare \`${name}\` exactly once, as a Set of string literals.`,
  );

  const values = [...declarations[0][1].matchAll(/'([^']*)'/g)].map((match) => match[1]);

  assert(values.length, `${file}: \`${name}\` is empty.`);
  assert.equal(new Set(values).size, values.length, `${file}: \`${name}\` repeats a value.`);

  return new Set(values);
}

const sorted = (values: Iterable<string>) => [...values].sort();
const agent = await read('page-agent.ts');
const viewer = await read('snapshot.ts');

// Both sides compare against `tagName.toUpperCase()`.
const agentTags = literalSet(agent, 'page-agent.ts', 'forbidden');
const viewerTags = literalSet(viewer, 'snapshot.ts', 'forbidden');

assert.deepEqual(
  sorted(agentTags),
  sorted(viewerTags),
  'page-agent.ts and snapshot.ts must refuse the same elements.',
);

for (const tag of agentTags) {
  assert.equal(tag, tag.toUpperCase(), `Forbidden element ${tag} must be upper case.`);
}

// What a snapshot can carry: attributes copied from the page, attributes the
// agent sets on its copies and placeholders, and the computed inline style.
const copied = literalSet(agent, 'page-agent.ts', 'safeAttributes');
const written = new Set(
  [...agent.matchAll(/\b(?:copy|placeholder)\.setAttribute\(\s*'([^']+)'/g)].map(
    (match) => match[1],
  ),
);

assert(written.size, 'page-agent.ts no longer sets attributes on its snapshot copies.');
assert.match(
  agent,
  /\bcopy\.style\.cssText = /,
  'page-agent.ts no longer serializes computed styles inline.',
);

const emitted = new Set([...copied, ...written, 'style']);
const allowed = literalSet(viewer, 'snapshot.ts', 'attributes');

assert.deepEqual(
  sorted(emitted).filter((name) => !allowed.has(name)),
  [],
  'snapshot.ts would strip attributes that page-agent.ts captures.',
);
assert.deepEqual(
  sorted(allowed).filter((name) => !emitted.has(name)),
  [],
  'snapshot.ts allows attributes that page-agent.ts never emits.',
);

console.log(
  `Passed: page agent and viewer refuse the same ${agentTags.size} elements and agree on ${allowed.size} snapshot attributes.`,
);
