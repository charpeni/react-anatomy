import type { ComponentNode } from '../src/inspector/types.ts';
import assert from 'node:assert/strict';
import { makeLayerHierarchy } from '../src/inspector/layers.ts';
import { makeScene } from '../src/inspector/scene.ts';

const nodes: ComponentNode[] = [];

function node(
  id: string,
  parent: string | null,
  frame: { x: number; y: number; w: number; h: number },
) {
  const owner = nodes.find((n) => n.id === parent);
  const n: ComponentNode = {
    key: null,
    bounds: frame,
    portal: false,
    id,
    parent,
    frame,
    hosts: [id],
    name: 'Unnamed',
    depth: owner ? owner.depth + 1 : 0,
    children: [],
  };

  nodes.push(n);

  if (owner) {
    owner.children.push(id);
  }

  return n;
}

node('root', null, { x: 0, y: 0, w: 1200, h: 900 });
node('sidebar', 'root', { x: 0, y: 0, w: 200, h: 900 });
node('tiny-nav', 'sidebar', { x: 20, y: 20, w: 120, h: 30 });

let parent = 'root';

for (let i = 0; i < 8; i++) {
  node('shell' + i, parent, { x: 200, y: 0, w: 1000, h: 900 });
  parent = 'shell' + i;
}

node('conversation', parent, { x: 200, y: 0, w: 1000, h: 900 });
node('message1', 'conversation', { x: 240, y: 80, w: 900, h: 200 });
node('message2', 'conversation', { x: 240, y: 300, w: 900, h: 200 });
node('composer', 'conversation', { x: 240, y: 760, w: 900, h: 100 });

const original = JSON.stringify(nodes);
const hierarchy = makeLayerHierarchy(nodes);
const automatic = makeScene(hierarchy);

assert.deepEqual(
  automatic.layers.map((n) => n.id),
  ['root', 'sidebar', 'conversation', 'message1', 'message2', 'composer'],
);
assert.equal(automatic.layers.find((n) => n.id === 'message1')!.sceneDepth, 2);
assert(automatic.layers.find((n) => n.id === 'message1')!.layerDepth > 8);
assert.deepEqual(
  automatic.layers[0].sceneChildren,
  ['sidebar', 'conversation'],
  'Skipped-shell pixels must stay with the root while shown descendants are removed from its texture',
);
assert.equal(automatic.representedBy.get('tiny-nav'), 'sidebar');
assert.equal(JSON.stringify(nodes), original, 'Overview must not change the component tree');

const manual = makeScene(hierarchy, { automatic: false, depth: 4 });

assert(!manual.layers.some((n) => n.id === 'message1'));
assert(manual.layers.some((n) => n.id === 'tiny-nav'));
assert.equal(
  makeScene(hierarchy, { automatic: false, depth: hierarchy.maxDepth }).layers.length,
  hierarchy.layers.length,
);

const selected = makeScene(hierarchy, { selected: 'tiny-nav' });

assert(
  selected.layers.some((n) => n.id === 'tiny-nav'),
  'Explicit selection must reveal small components',
);

const selectedShell = makeScene(hierarchy, { selected: 'shell4' });

assert(
  selectedShell.layers.some((n) => n.id === 'shell4'),
  'Explicit selection must reveal intermediate containers',
);

const focus = makeScene(makeLayerHierarchy(nodes, { focus: 'sidebar' }), { focused: true });

assert.deepEqual(
  focus.layers.map((n) => n.id),
  ['sidebar', 'tiny-nav'],
);

const collapsed = makeScene(makeLayerHierarchy(nodes, { collapsed: new Set(['shell0']) }));

assert(collapsed.layers.some((n) => n.id === 'shell0'));
assert(
  !collapsed.layers.some((n) => n.id === 'message1'),
  'Auto must respect a deliberately collapsed branch',
);

// Dense branches must not consume the overview before a larger sibling region.
const broad: ComponentNode[] = [
  {
    id: 'root',
    parent: null,
    name: 'Root',
    key: null,
    bounds: null,
    portal: false,
    hosts: ['r'],
    frame: { x: 0, y: 0, w: 1000, h: 1000 },
    children: [],
    depth: 0,
  },
];

for (let i = 0; i < 120; i++) {
  const id = 'tile' + i;

  broad[0].children.push(id);
  broad.push({
    id,
    parent: 'root',
    name: 'Tile',
    key: null,
    bounds: null,
    portal: false,
    hosts: [id],
    frame: { x: 0, y: 0, w: 200, h: 100 },
    children: [],
    depth: 1,
  });
}

broad[0].children.push('main');
broad.push({
  id: 'main',
  parent: 'root',
  name: 'Main',
  key: null,
  bounds: null,
  portal: false,
  hosts: ['main'],
  frame: { x: 200, y: 0, w: 800, h: 1000 },
  children: [],
  depth: 1,
});

const bounded = makeScene(makeLayerHierarchy(broad));

assert(bounded.layers.length <= 80);
assert(
  bounded.layers.some((n) => n.id === 'main'),
  'Main region must not be crowded out by earlier small siblings',
);

const empty = makeScene(makeLayerHierarchy([]));

assert.deepEqual(empty.layers, []);
console.log(
  'Passed: uneven branch depths, compact scene spacing, texture ownership, manual depth, explicit selection, focused detail, collapse, unchanged hierarchy, and bounded overview.',
);
