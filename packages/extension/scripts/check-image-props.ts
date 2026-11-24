import type { HiddenValue, PropEntry, PropValue } from '../src/inspector/types.ts';
import assert from 'node:assert/strict';
import {
  changeHidden,
  confirmHidden,
  hiddenText,
  reviewRows,
  staleContainers,
  type LoadedPage,
} from '../src/inspector/image-props.ts';

// Props cards draw what the author reviewed, never a later read, and a hidden
// value must stay hidden when the collection around it changes.

function text(value: string): PropValue {
  return { type: 'string', preview: JSON.stringify(value) };
}

function object(identity: string, preview = 'Object'): PropValue {
  return { type: 'object', preview, handle: 'h' + identity, expandable: true, identity };
}

function page(values: [string, PropValue][], total = values.length, readAt = 1): LoadedPage {
  const entries: PropEntry[] = values.map(([name, value], i) => ({ key: String(i), name, value }));

  return {
    entries,
    total,
    nextOffset: total > entries.length ? entries.length : null,
    limited: false,
    readAt,
  };
}

const users = (...ids: string[]) => page(ids.map((id, i) => [String(i), object(id)]));
const root = page([
  ['title', text('Quarterly report')],
  ['token', text('sk-live-1234567890')],
  [
    'users',
    { type: 'array', preview: 'Array(2)', handle: 'hu', expandable: true, identity: 'arr' },
  ],
]);

// Top-level props, an expanded branch, and a hidden value without its value.
{
  const pages = new Map([
    ['props', root],
    ['props.users', users('alice', 'bob')],
  ]);
  const hidden = changeHidden([], pages, {
    path: 'props.token',
    container: 'props',
    value: text('sk-live-1234567890'),
    hide: true,
  });
  const review = reviewRows(pages, { expanded: ['props.users'], hidden })!;

  assert.deepEqual(review.rows, [
    { depth: 0, name: 'title', type: 'string', preview: '"Quarterly report"' },
    { depth: 0, name: 'token', type: 'string', hidden: true },
    { depth: 0, name: 'users', type: 'array', preview: 'Array(2)' },
    { depth: 1, name: '0', type: 'object', preview: 'Object' },
    { depth: 1, name: '1', type: 'object', preview: 'Object' },
  ]);
  assert(!JSON.stringify(review.rows).includes('sk-live'), 'A hidden value was stored');
  assert.deepEqual(review.counts, { props: 3, 'props.users': 2 });
  assert.equal(hidden[0].text, 'sk-live-1234567890', 'Hidden text is kept to warn about page text');
}

// A hidden array entry fails closed when another value takes its position.
{
  const before = new Map([
    ['props', root],
    ['props.users', users('alice', 'bob')],
  ]);
  const hidden = changeHidden([], before, {
    path: 'props.users[0]',
    container: 'props.users',
    value: object('alice'),
    hide: true,
  });
  const image = { expanded: ['props.users'], hidden };

  assert.deepEqual(reviewRows(before, image)!.stale, []);

  // Someone was inserted before alice: same length check fails too, but even a
  // same-length reorder is caught by identity, though both preview as Object.
  for (const after of [users('carol', 'alice', 'bob'), users('bob', 'alice')]) {
    const pages = new Map([
      ['props', root],
      ['props.users', after],
    ]);
    const review = reviewRows(pages, image)!;

    assert.deepEqual(review.stale, ['props.users']);
    assert.deepEqual(review.rows.at(-1), { depth: 1, name: '', type: 'stale' });
    assert(
      !review.rows.some((row) => row.depth === 1 && row.preview),
      'A masked collection leaked',
    );

    // Confirming matches the hidden entry to what is there now.
    const confirmed = confirmHidden(hidden, pages, review.stale);

    assert.deepEqual(staleContainers(confirmed, pages), []);
  }

  // A collapsed collection is not drawn, so there is nothing to mask.
  const collapsed = reviewRows(new Map([['props', root]]), { expanded: [], hidden })!;

  assert.deepEqual(collapsed.stale, []);
  assert.equal(collapsed.rows.length, 3);
}

// A value hidden inside a list item fails closed too: its path ends in a
// name, but the item around it is tracked by position.
{
  const user = (name: string) =>
    page([
      ['name', text(name)],
      ['email', text(`${name}@example.com`)],
    ]);
  const before = new Map([
    ['props', root],
    ['props.users', users('alice', 'bob')],
    ['props.users[0]', user('alice')],
    ['props.users[1]', user('bob')],
  ]);
  const hidden = changeHidden([], before, {
    path: 'props.users[0].email',
    container: 'props.users[0]',
    value: text('alice@example.com'),
    hide: true,
  });
  const image = { expanded: ['props.users', 'props.users[0]', 'props.users[1]'], hidden };

  assert.deepEqual(reviewRows(before, image)!.stale, []);

  // Carol is inserted first: alice moves to [1], with her email unhidden there.
  const after = new Map([
    ['props', root],
    ['props.users', users('carol', 'alice', 'bob')],
    ['props.users[0]', user('carol')],
    ['props.users[1]', user('alice')],
    ['props.users[2]', user('bob')],
  ]);
  const review = reviewRows(after, image)!;

  assert.deepEqual(review.stale, ['props.users']);
  assert(!JSON.stringify(review.rows).includes('alice@'), 'A hidden email was drawn');

  // Confirming re-records the item around it, as well as the value.
  assert.deepEqual(staleContainers(confirmHidden(hidden, after, review.stale), after), []);
}

// A hidden named prop stays hidden whatever its value becomes: names, unlike
// positions, keep meaning the same thing.
{
  const pages = new Map([['props', root]]);
  const hidden = changeHidden([], pages, {
    path: 'props.token',
    container: 'props',
    value: text('sk-live-1234567890'),
    hide: true,
  });
  const rotated = page([
    ['title', text('Quarterly report')],
    ['token', text('sk-live-0000000000')],
  ]);
  const review = reviewRows(new Map([['props', rotated]]), { expanded: [], hidden })!;

  assert.deepEqual(review.stale, []);
  assert.deepEqual(review.rows[1], { depth: 0, name: 'token', type: 'string', hidden: true });
}

// Hiding or showing a value in a collection confirms the rest of it.
{
  const before = new Map([['props.users', users('alice', 'bob')]]);
  const hidden: HiddenValue[] = changeHidden([], before, {
    path: 'props.users[1]',
    container: 'props.users',
    value: object('bob'),
    hide: true,
  });
  const after = new Map([['props.users', users('carol', 'alice', 'bob')]]);

  assert.deepEqual(staleContainers(hidden, after), ['props.users']);

  const next = changeHidden(hidden, after, {
    path: 'props.users[2]',
    container: 'props.users',
    value: object('bob'),
    hide: true,
  });

  assert.deepEqual(staleContainers(next, after), []);
  assert.deepEqual(
    next.map((h) => h.path),
    ['props.users[1]', 'props.users[2]'],
  );
}

// Long and short text values.
{
  assert.equal(hiddenText(text('abc')), undefined, 'Short values match too much page text');
  assert.equal(hiddenText({ type: 'number', preview: '12345' }), undefined);
  assert.equal(
    hiddenText({ type: 'string', preview: '"' + 'x'.repeat(180) + '"… (500 characters)' }),
    'x'.repeat(180),
  );
}

// Nothing is drawn until the top level has loaded, and a card is not replaced
// by a partial view while an expanded branch is read again.
assert.equal(reviewRows(new Map(), { expanded: [], hidden: [] }), null);
assert.equal(
  reviewRows(new Map([['props', root]]), { expanded: ['props.users'], hidden: [] }),
  null,
);

// A reference back to an enclosing value is never expanded, so it is not awaited.
{
  const self = page([
    ['self', { type: 'object', preview: 'Object', handle: 'h0', expandable: true }],
  ]);
  const review = reviewRows(new Map([['props', { ...self, handle: 'h0' }]]), {
    expanded: ['props.self'],
    hidden: [],
  });

  assert.deepEqual(review?.rows, [{ depth: 0, name: 'self', type: 'object', preview: 'Object' }]);
}

console.log(
  'Props cards draw reviewed rows, and hidden values stay hidden when collections change.',
);
