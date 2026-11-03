import type { ComponentNode, Layer } from './types.ts';

// The React tree remains authoritative. This is only a projection for the 3D
// scene: transparent wrappers share a plane with their rendered descendant.
// Equal rectangles are not enough: two independent components can overlap.
export function makeLayerHierarchy(
  nodes: ComponentNode[],
  {
    focus = null,
    collapsed = new Set<string>(),
    showWrappers = false,
  }: { focus?: string | null; collapsed?: Set<string>; showWrappers?: boolean } = {},
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = focus
    ? [byId.get(focus)].filter((node): node is ComponentNode => !!node)
    : nodes.filter((node) => !node.parent);
  const scoped: ComponentNode[] = [];
  const included = new Set();
  const stack = [...roots].reverse();

  while (stack.length) {
    const node = stack.pop()!;

    scoped.push(node);
    included.add(node.id);

    if (!collapsed.has(node.id)) {
      for (const id of [...node.children].reverse()) {
        if (byId.has(id)) {
          stack.push(byId.get(id)!);
        }
      }
    }
  }

  const representatives = new Map<string, string | null>();

  for (const node of [...scoped].reverse()) {
    const children = node.children
      .filter((id) => included.has(id))
      .map((id) => byId.get(id)!)
      .filter((child) => child.hosts.length);
    const child = children.length === 1 ? children[0] : null;
    const hosts = new Set(node.hosts);
    const shared =
      !showWrappers &&
      node.frame &&
      child?.frame &&
      hosts.size > 0 &&
      hosts.size === child.hosts.length &&
      child.hosts.every((id) => hosts.has(id));

    representatives.set(
      node.id,
      shared ? (representatives.get(child.id) ?? null) : node.frame ? node.id : null,
    );
  }

  const layers: Layer[] = [];
  const byLayerId = new Map<string, Layer>();
  const parents = new Map<string | null, Layer | null>();

  for (const node of scoped) {
    const parent = parents.get(node.parent) || null;

    if (representatives.get(node.id) === node.id) {
      const layer: Layer = {
        ...node,
        frame: node.frame!,
        layerDepth: parent ? parent.layerDepth + 1 : 0,
        layerChildren: [],
      };

      layers.push(layer);
      byLayerId.set(node.id, layer);
      parents.set(node.id, layer);

      if (parent) {
        parent.layerChildren.push(node.id);
      }
    } else {
      parents.set(node.id, parent);
    }
  }

  const depths = new Map(
    scoped.map((node) => [
      node.id,
      byLayerId.get(representatives.get(node.id) ?? '')?.layerDepth ??
        parents.get(node.id)?.layerDepth ??
        0,
    ]),
  );
  const maxDepth = layers.reduce((max, layer) => Math.max(max, layer.layerDepth), 0);
  // Walk through any remaining single-child DOM containers to reach the first
  // visible branching point, then reveal its immediate composition.
  const branch = layers.find((layer) => layer.layerChildren.length > 1);
  const initialDepth = Math.min(maxDepth, Math.max(4, (branch?.layerDepth || 0) + 2));
  const combined = scoped.filter(
    (node) => node.frame && representatives.get(node.id) !== node.id,
  ).length;

  return { layers, representatives, depths, maxDepth, initialDepth, combined };
}
