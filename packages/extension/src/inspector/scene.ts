import type { Frame, SceneLayer, Layer } from './types.ts';
import type { makeLayerHierarchy } from './layers.ts';

const area = (frame: Frame) => Math.max(0, frame.w) * Math.max(0, frame.h);

function sameRegion(a: Frame, b: Frame) {
  const intersection =
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

  return intersection / Math.max(1, area(a) + area(b) - intersection) >= 0.9;
}

// This is a view selection, not a rewrite of React ownership or the layer
// hierarchy. Omitted containers keep their pixels on the nearest shown parent.
// Manual depth can always display the original layers, including equal bounds.
export function makeScene(
  hierarchy: ReturnType<typeof makeLayerHierarchy>,
  {
    automatic = true,
    depth = 0,
    selected = null,
    focused = false,
  }: { automatic?: boolean; depth?: number; selected?: string | null; focused?: boolean } = {},
) {
  const byId = new Map(hierarchy.layers.map((layer) => [layer.id, layer]));
  const parents = new Map<string, string>();

  for (const layer of hierarchy.layers) {
    for (const child of layer.layerChildren) {
      parents.set(child, layer.id);
    }
  }

  const chosen = new Set();
  const rootAreas = new Map<string, number>();
  const candidates: Layer[] = [];

  for (const layer of hierarchy.layers) {
    const parent = parents.get(layer.id);
    const rootArea = parent ? rootAreas.get(parent)! : area(layer.frame);

    rootAreas.set(layer.id, rootArea);

    if (!automatic) {
      if (layer.layerDepth <= depth) {
        chosen.add(layer.id);
      }

      continue;
    }

    if (!parent) {
      chosen.add(layer.id);
      continue;
    }

    const minimum = rootArea * (focused ? 0.005 : 0.01);
    const children = layer.layerChildren.map((id) => byId.get(id)!);
    // Tiny adornments must not turn an otherwise single-region container into
    // a meaningful layout split. Portals in distinct regions remain separate.
    const majorChildren = children.filter(
      (child) => area(child.frame) >= Math.max(minimum, area(layer.frame) * 0.15),
    );
    const container = majorChildren.length === 1 && sameRegion(layer.frame, majorChildren[0].frame);

    if (area(layer.frame) >= minimum && !container) {
      candidates.push(layer);
    }
  }

  if (automatic) {
    // Bound the overview without letting a long, shallow sidebar consume all
    // available planes before the main content. Rank by visible area, not DFS.
    candidates.sort(
      (a, b) =>
        area(b.frame) / rootAreas.get(b.id)! - area(a.frame) / rootAreas.get(a.id)! ||
        a.layerDepth - b.layerDepth,
    );

    for (const layer of candidates.slice(0, Math.max(0, 80 - chosen.size))) {
      chosen.add(layer.id);
    }

    const selectedLayer = selected ? hierarchy.representatives.get(selected) : null;

    if (selectedLayer) {
      chosen.add(selectedLayer);
    }
  }

  const limited =
    chosen.size > 80 ||
    (automatic &&
      candidates.length > 80 - hierarchy.layers.filter((layer) => !parents.has(layer.id)).length);
  if (chosen.size > 80) {
    const selectedLayer = selected ? hierarchy.representatives.get(selected) : null;
    const keep = [
      ...new Set([
        ...(selectedLayer && chosen.has(selectedLayer) ? [selectedLayer] : []),
        ...chosen,
      ]),
    ].slice(0, 80);
    chosen.clear();
    for (const id of keep) {
      chosen.add(id);
    }
  }

  const layers: SceneLayer[] = [];
  const nearest = new Map<string, SceneLayer | null>();
  const representedBy = new Map<string, string | null>();

  for (const layer of hierarchy.layers) {
    const parent = nearest.get(layer.id) || null;
    let displayed: SceneLayer | null = parent ?? null;

    if (chosen.has(layer.id)) {
      displayed = {
        ...layer,
        sceneDepth: automatic ? (parent ? parent.sceneDepth + 1 : 0) : layer.layerDepth,
        sceneChildren: [],
      };
      layers.push(displayed);

      if (parent) {
        parent.sceneChildren.push(layer.id);
      }
    }

    representedBy.set(layer.id, displayed?.id || null);

    for (const child of layer.layerChildren) {
      nearest.set(child, displayed);
    }
  }

  return {
    limited,
    layers,
    representedBy,
    revealDepth: layers.reduce((max, layer) => Math.max(max, layer.layerDepth), 0),
  };
}

// Match the CSS camera (1900px perspective, origin 50% 45%, scene at 50% 48%).
// Scale all three axes: scaling only X/Y leaves full-size Z coordinates, which
// can magnify a tilted page beyond the canvas even when its flat bounds fit.
export function fitScene(
  layers: SceneLayer[],
  {
    frame,
    size,
    rotation,
    distance,
    maxScale = 1.2,
  }: {
    frame: Frame;
    size: { width: number; height: number };
    rotation: { x: number; y: number };
    distance: number;
    maxScale?: number;
  },
) {
  if (!size.width || !size.height) {
    return 0.1;
  }

  const levels = Math.max(1, ...layers.map((layer) => layer.sceneDepth));
  const x = (rotation.x * Math.PI) / 180;
  const y = (rotation.y * Math.PI) / 180;
  const corners: number[][] = [];

  for (const layer of layers) {
    const z = (layer.sceneDepth - levels / 2) * distance;

    for (const px of [layer.frame.x, layer.frame.x + layer.frame.w]) {
      for (const py of [layer.frame.y, layer.frame.y + layer.frame.h]) {
        const dx = px - frame.x - frame.w / 2;
        const dy = py - frame.y - frame.h / 2;
        const rx = Math.cos(y) * dx + Math.sin(y) * z;
        const rz = -Math.sin(y) * dx + Math.cos(y) * z;

        corners.push([
          rx,
          Math.cos(x) * dy - Math.sin(x) * rz,
          Math.sin(x) * dy + Math.cos(x) * rz,
        ]);
      }
    }
  }

  const marginX = Math.min(44, size.width * 0.1);
  const marginY = Math.min(44, size.height * 0.1);

  function fits(scale: number) {
    return corners.every(([x, y, z]) => {
      const denominator = 1 - (z * scale) / 1900;

      if (denominator <= 0.05) {
        return false;
      }

      const px = size.width * 0.5 + (x * scale) / denominator;
      const py = size.height * 0.45 + (y * scale + size.height * 0.03) / denominator;

      return (
        px >= marginX && px <= size.width - marginX && py >= marginY && py <= size.height - marginY
      );
    });
  }

  let low = 0;
  let high = maxScale;

  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;

    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }

  return low;
}
