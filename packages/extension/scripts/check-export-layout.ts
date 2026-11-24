import type { PlacedTag, TagRequest } from '../src/inspector/export-layout.ts';
import assert from 'node:assert/strict';
import { placeTags } from '../src/inspector/export-layout.ts';

const bounds = { width: 1000, height: 600 };

function tag(id: string, x: number, y: number, width = 120, height = 24): TagRequest {
  return { id, anchor: { x, y }, width, height, required: true };
}

function overlaps(a: PlacedTag, b: PlacedTag) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertSeparate(tags: PlacedTag[]) {
  for (const [i, a] of tags.entries()) {
    for (const b of tags.slice(i + 1)) {
      assert(!overlaps(a, b), `${a.id} overlaps ${b.id}`);
    }
  }
}

function assertInside(tags: PlacedTag[], margin = 8) {
  for (const t of tags) {
    assert(t.x >= margin && t.y >= margin, `${t.id} leaves the top-left margin`);
    assert(t.x + t.width <= bounds.width - margin, `${t.id} leaves the right margin`);
    assert(t.y + t.height <= bounds.height - margin, `${t.id} leaves the bottom margin`);
  }
}

// A lone tag sits just above and left of its plane's corner, with its leader
// leaving the bottom edge, straight toward the anchor.
{
  const [placed] = placeTags([tag('card', 400, 300)], bounds);

  assert.deepEqual({ x: placed.x, y: placed.y }, { x: 396, y: 266 });
  assert.deepEqual(placed.leader, { x: 404, y: 290 });
}

// Planes that share a corner (wrappers, stacked layers) get separate tags, and
// the tag listed first keeps the preferred position.
{
  const placed = placeTags(
    [tag('first', 300, 300), tag('second', 300, 300), tag('third', 300, 300)],
    bounds,
  );

  assert.deepEqual({ x: placed[0].x, y: placed[0].y }, { x: 296, y: 266 });
  assertSeparate(placed);
  assertInside(placed);
}

// Tags near an edge stay inside the image, and the leader still reaches the
// edge facing the anchor.
{
  const placed = placeTags([tag('top', 20, 4), tag('right', 990, 300)], bounds);

  assertInside(placed);
  assert(placed[0].y >= 8);
  assert.equal(placed[0].leader.y, placed[0].y, 'A tag below its anchor leads from its top edge');
  assert(placed[1].x + placed[1].width <= bounds.width - 8);
}

// A crowded column of corners, as in a list of cards, still separates.
{
  const placed = placeTags(
    Array.from({ length: 12 }, (_, i) => tag('row' + i, 200 + (i % 2) * 30, 120 + i * 12)),
    bounds,
  );

  assertSeparate(placed);
  assertInside(placed);
}

// An optional tag that cannot sit near its plane is left out, rather than
// drifting away with a long leader line. Required tags around it are kept.
{
  const crowded = Array.from({ length: 10 }, (_, i) => ({
    ...tag('optional' + i, 300, 300),
    required: i === 0,
  }));
  const placed = placeTags(crowded, bounds);

  assert(
    placed.some((t) => t.id === 'optional0'),
    'A required tag was dropped',
  );
  assert(placed.length < crowded.length, 'Distant optional tags were kept');

  for (const t of placed) {
    assert(Math.abs(t.y - 266) <= 3 * 30, `${t.id} drifted from its plane`);
  }

  assertSeparate(placed);
}

// When there is no free space at all, every required tag is still placed.
{
  const tiny = { width: 160, height: 60 };
  const placed = placeTags([tag('a', 50, 30), tag('b', 50, 30), tag('c', 50, 30)], tiny);

  assert.equal(placed.length, 3);
}

// Like the panel's labels, a tag sits on its plane's corner and follows the
// top edge, as long as there is room and the edge is not too steep.
{
  const edge = -0.25;
  const [seated] = placeTags([{ ...tag('card', 400, 300), angle: edge }], bounds);

  assert.equal(seated.seated, true);
  assert.equal(seated.angle, edge);
  assert.deepEqual({ x: seated.x, y: seated.y }, { x: 400, y: 276 }, 'Not on the corner');

  const [steep] = placeTags([{ ...tag('card', 400, 300), angle: -1 }], bounds);

  assert.equal(steep.seated, false, 'A steep edge would turn the text too far');
  assert.equal(steep.angle, 0);

  // Two planes share a corner: the second tag moves aside, flat, clear of the first.
  const pair = placeTags(
    [
      { ...tag('outer', 300, 300), angle: edge },
      { ...tag('inner', 300, 300), angle: edge },
    ],
    bounds,
  );

  assert.deepEqual(
    pair.map((t) => t.seated),
    [true, false],
  );

  const turned = {
    x: 300 + Math.sin(edge) * 24,
    y: 300 + Math.sin(edge) * 120 - Math.cos(edge) * 24,
    right: 300 + Math.cos(edge) * 120,
    bottom: 300,
  };
  const other = pair[1];

  assert(
    other.x >= turned.right ||
      other.x + other.width <= turned.x ||
      other.y >= turned.bottom ||
      other.y + other.height <= turned.y,
    'The moved tag overlaps the seated one',
  );

  // A seated tag that would leave the image moves inside it instead.
  const [edgeOfImage] = placeTags([{ ...tag('top', 20, 10), angle: edge }], bounds);

  assert.equal(edgeOfImage.seated, false);
  assertInside([edgeOfImage]);
}

console.log(
  'Export tags sit on their planes, stay legible and separate, and stay inside the image.',
);
