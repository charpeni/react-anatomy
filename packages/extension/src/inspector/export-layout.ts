// Name tags for exported images. Like the panel's labels, a tag sits on its
// plane's top edge and follows that edge's slant, but stays at a readable size
// and carries its number. Where planes crowd, a tag that cannot sit on its
// edge moves aside, flat, with a leader line back to the plane's corner.

// Steeper edges would turn the text too far to read comfortably.
const MAX_TILT = (30 * Math.PI) / 180;

export interface Point {
  x: number;
  y: number;
}

export interface TagRequest {
  id: string;
  /** The plane's top-left corner, projected into the exported stage. */
  anchor: Point;
  width: number;
  height: number;
  /** Required tags are always placed. Others are left out rather than drift far from their plane. */
  required?: boolean;
  /** The on-screen angle of the plane's top edge, in radians. */
  angle?: number;
}

export interface PlacedTag extends TagRequest, Point {
  /** Seated on the plane's top edge: bottom-left corner on the anchor, turned by `angle`. */
  seated: boolean;
  /** The tag's rotation about its bottom-left corner; 0 unless seated. */
  angle: number;
  /** Where the leader line leaves a moved tag, on the edge facing its anchor. */
  leader: Point;
}

interface Box extends Point {
  width: number;
  height: number;
}

function overlap(a: Box, b: Box, gap: number) {
  const x = Math.min(a.x + a.width + gap, b.x + b.width) - Math.max(a.x, b.x - gap);
  const y = Math.min(a.y + a.height + gap, b.y + b.height) - Math.max(a.y, b.y - gap);

  return x > 0 && y > 0 ? x * y : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, Math.max(min, max)));
}

// The screen area a seated tag covers, as an axis-aligned box.
function seatedBox({ anchor, width, height, angle = 0 }: TagRequest): Box {
  const along = { x: Math.cos(angle) * width, y: Math.sin(angle) * width };
  const up = { x: Math.sin(angle) * height, y: -Math.cos(angle) * height };
  const xs = [anchor.x, anchor.x + along.x, anchor.x + along.x + up.x, anchor.x + up.x];
  const ys = [anchor.y, anchor.y + along.y, anchor.y + along.y + up.y, anchor.y + up.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);

  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function leader(tag: Box, anchor: Point): Point {
  const x = clamp(anchor.x, tag.x + 8, tag.x + tag.width - 8);

  if (tag.y + tag.height <= anchor.y) {
    return { x, y: tag.y + tag.height };
  }

  if (tag.y >= anchor.y) {
    return { x, y: tag.y };
  }

  return { x: anchor.x < tag.x ? tag.x : tag.x + tag.width, y: tag.y + tag.height / 2 };
}

/**
 * Places tags in the order given, so callers list the most important first.
 * Each tag first tries to sit on its plane's top edge. When that space is
 * taken, the edge is too steep, or the tag would leave the image, it sits
 * flat just above its anchor instead, moving up or down in tag-sized steps,
 * nearest first.
 *
 * An optional tag moves at most a few steps and never overlaps another; when
 * there is no room near its plane it is left out, since a distant tag with a
 * long leader explains less than none. A required tag goes further, and takes
 * the position with the least overlap when nothing is free.
 */
export function placeTags(
  tags: TagRequest[],
  bounds: { width: number; height: number },
  { gap = 6, margin = 8 }: { gap?: number; margin?: number } = {},
): PlacedTag[] {
  const placed: Box[] = [];
  const result: PlacedTag[] = [];

  for (const tag of tags) {
    if (tag.angle !== undefined && Math.abs(tag.angle) <= MAX_TILT) {
      const seat = seatedBox(tag);
      const inside =
        seat.x >= margin &&
        seat.y >= margin &&
        seat.x + seat.width <= bounds.width - margin &&
        seat.y + seat.height <= bounds.height - margin;

      if (inside && placed.every((other) => !overlap(seat, other, gap))) {
        placed.push(seat);
        result.push({
          ...tag,
          x: tag.anchor.x,
          y: tag.anchor.y - tag.height,
          seated: true,
          angle: tag.angle,
          leader: tag.anchor,
        });
        continue;
      }
    }

    const preferred = { x: tag.anchor.x - 4, y: tag.anchor.y - tag.height - 10 };
    const step = tag.height + gap;
    const candidates = [preferred];

    for (let k = 1; k <= (tag.required ? 12 : 3); k++) {
      candidates.push(
        { x: preferred.x, y: preferred.y - k * step },
        { x: preferred.x, y: preferred.y + k * step },
      );
    }

    let best: Box | undefined;
    let bestOverlap = Infinity;

    for (const candidate of candidates) {
      const box = {
        x: clamp(candidate.x, margin, bounds.width - tag.width - margin),
        y: clamp(candidate.y, margin, bounds.height - tag.height - margin),
        width: tag.width,
        height: tag.height,
      };
      const total = placed.reduce((sum, other) => sum + overlap(box, other, gap), 0);

      if (total < bestOverlap) {
        best = box;
        bestOverlap = total;
      }

      if (!total) {
        break;
      }
    }

    if (bestOverlap && !tag.required) {
      continue;
    }

    placed.push(best!);
    result.push({
      ...tag,
      x: best!.x,
      y: best!.y,
      seated: false,
      angle: 0,
      leader: leader(best!, tag.anchor),
    });
  }

  return result;
}
