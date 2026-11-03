import type { ComponentNode, Frame } from '../src/inspector/types.ts';
import assert from 'node:assert/strict';
import { makeLayerHierarchy } from '../src/inspector/layers.ts';

function node(
  id: string,
  parent: string | null,
  hosts = ['dom'],
  frame: Frame | null = { x: 0, y: 0, w: 100, h: 100 },
): ComponentNode {
  return {
    id,
    parent,
    hosts,
    frame,
    bounds: frame,
    key: null,
    portal: false,
    children: [],
    depth: 0,
    name: id,
  };
}

function tree(...nodes: ComponentNode[]) {
  for (const n of nodes) {
    const p = nodes.find((p) => p.id === n.parent);

    if (p) {
      p.children.push(n.id);
      n.depth = p.depth + 1;
    }
  }

  return nodes;
}

const wrapped = tree(
  node('outer', null),
  node('inner', 'outer'),
  node('ui', 'inner'),
  node('nothing', 'outer', [], null),
  node('badge', 'ui', ['badge']),
);
const pristine = JSON.stringify(wrapped);
const compact = makeLayerHierarchy(wrapped);

assert.deepEqual(
  compact.layers.map((n) => [n.id, n.layerDepth, n.layerChildren]),
  [
    ['ui', 0, ['badge']],
    ['badge', 1, []],
  ],
);
assert.equal(compact.representatives.get('outer'), 'ui');
assert.equal(compact.representatives.get('inner'), 'ui');
assert.equal(compact.combined, 2);
assert.equal(JSON.stringify(wrapped), pristine, 'Scene projection must not alter the React tree');

const expanded = makeLayerHierarchy(wrapped, { showWrappers: true });

assert.deepEqual(
  expanded.layers.map((n) => n.id),
  ['outer', 'inner', 'ui', 'badge'],
);

const collapsed = makeLayerHierarchy(wrapped, { collapsed: new Set(['inner']) });

assert.deepEqual(
  collapsed.layers.map((n) => n.id),
  ['inner'],
);
assert.equal(collapsed.representatives.get('outer'), 'inner');

const focused = makeLayerHierarchy(wrapped, { focus: 'inner' });

assert.deepEqual(
  focused.layers.map((n) => [n.id, n.layerDepth]),
  [
    ['ui', 0],
    ['badge', 1],
  ],
);
assert(!focused.representatives.has('outer'));

// Equal-sized DOM containers are distinct; geometry alone must never merge them.
const separate = makeLayerHierarchy(
  tree(node('container', null, ['a']), node('content', 'container', ['b'])),
);

assert.equal(separate.layers.length, 2);

// A fragment's host order can differ, but its complete set must match.
const fragment = makeLayerHierarchy(
  tree(node('fragment', null, ['a', 'b']), node('child', 'fragment', ['b', 'a'])),
);

assert.equal(fragment.layers.length, 1);

const branch = makeLayerHierarchy(
  tree(
    node('parent', null, ['a', 'b']),
    node('left', 'parent', ['a']),
    node('right', 'parent', ['b']),
  ),
);

assert.equal(branch.layers.length, 3);

// Independent roots are never merged, even if their bounds coincide.
const roots = makeLayerHierarchy(tree(node('one', null, ['a']), node('two', null, ['b'])));

assert.equal(roots.layers.length, 2);
assert(roots.layers.every((n) => n.layerDepth === 0));

// A portal contributes extra hosts and must not be absorbed into a sibling.
const portal = makeLayerHierarchy(
  tree(
    node('parent', null, ['page', 'portal']),
    node('page', 'parent', ['page']),
    node('portal', 'parent', ['portal']),
  ),
);

assert.equal(portal.layers.length, 3);

const offscreen = makeLayerHierarchy(
  tree(node('offscreen', null, ['a'], null), node('none', 'offscreen', [], null)),
);

assert.equal(offscreen.layers.length, 0);
assert.equal(offscreen.initialDepth, 0);
console.log(
  'Passed: exact shared-output grouping, original tree preservation, focus, collapse, opt-out, equal bounds, fragments, branches, multiple roots, portals, no visible output.',
);
