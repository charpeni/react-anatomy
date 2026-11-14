import type { ComponentNode, PageCall, Snapshot } from './types.ts';
import React, {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { makeSnapshotRenderer } from './snapshot.ts';
import { makeLayerHierarchy } from './layers.ts';
import { makeScene, fitScene } from './scene.ts';
import { Glyph } from './Glyph.tsx';
import { ComponentTree } from './ComponentTree.tsx';
import { ComponentDetails } from './ComponentDetails.tsx';
import { SceneStage } from './SceneStage.tsx';
import { LayerControls, StageHeading } from './StageControls.tsx';
import { Splitter } from './Splitter.tsx';

// Keep slider percentages independent from the scene's spacing units.
const SEPARATION_SCALE = 1.5;
const DEFAULT_SEPARATION = 55;

function ancestry(node: ComponentNode, byId: Record<string, ComponentNode>) {
  const path = [];

  for (let n: ComponentNode | undefined = node; n; n = n.parent ? byId[n.parent] : undefined) {
    path.unshift(n);
  }

  return path;
}

// One capture, explored. This component owns what is selected, collapsed and
// shown, and derives the layers and scene from that. The tree, stage, controls
// and details panes render it and report what the user did.
export function Viewer({
  snapshot,
  picked,
  call,
  canInspect,
  onAction,
  onCapture,
  onPick,
  onScope,
  busy,
  initialSelection,
}: {
  snapshot: Snapshot;
  picked: { id: string; time: number } | null;
  call: PageCall;
  canInspect: boolean;
  onAction: (action: 'inspect' | 'highlight' | 'clear', id?: string) => Promise<void>;
  onCapture: () => void;
  onPick: () => void;
  onScope: (id: string | null) => void;
  busy: boolean;
  initialSelection?: string;
}) {
  const nodes = snapshot.nodes;

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const roots = useMemo(() => nodes.filter((n) => !n.parent), [nodes]);

  const [selected, setSelected] = useState(
    initialSelection && byId[initialSelection] ? initialSelection : (nodes[0]?.id ?? ''),
  );
  const [hovered, setHovered] = useState<string | null>(null);
  const focus = snapshot.scope?.id || null;
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [dragging, setDragging] = useState(false);
  const [showWrappers, setShowWrappers] = useState(false);

  const hierarchy = useMemo(
    () => makeLayerHierarchy(nodes, { focus, collapsed, showWrappers }),
    [nodes, focus, collapsed, showWrappers],
  );

  const maxDepth = hierarchy.maxDepth;
  const [explode, setExplode] = useState(focus ? DEFAULT_SEPARATION * SEPARATION_SCALE : 0);
  const [depth, setDepth] = useState(() => hierarchy.initialDepth);
  const [automaticDepth, setAutomaticDepth] = useState(true);
  const [rotation, setRotation] = useState(focus ? { x: 22, y: -30 } : { x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [labels, setLabels] = useState(true);
  const [instant, setInstant] = useState(false);
  const [details, setDetails] = useState(false);
  const [treeWidth, setTreeWidth] = useState(252);
  const [inspectorWidth, setInspectorWidth] = useState(264);
  const [treeHidden, setTreeHidden] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [size, setSize] = useState({ width: 900, height: 600 });
  const selectedNode = byId[selected] || nodes[0];
  const focusNode = focus ? byId[focus] : undefined;

  const render = useMemo(() => makeSnapshotRenderer(snapshot), [snapshot]);

  const previousSnapshot = useRef(snapshot);

  /* oxlint-disable react-hooks/exhaustive-deps, react/set-state-in-effect -- Reconcile local selection only when a new external capture arrives, preserving user navigation between captures. */
  useEffect(() => {
    if (!byId[selected]) {
      setSelected(nodes[0]?.id);
    }

    const expanded =
      previousSnapshot.current.truncated &&
      snapshot.nodes.length > previousSnapshot.current.nodes.length;

    setDepth((d) => Math.min(maxDepth, expanded ? Math.max(d, hierarchy.initialDepth) : d));
    previousSnapshot.current = snapshot;
  }, [snapshot]);
  /* oxlint-enable react-hooks/exhaustive-deps, react/set-state-in-effect */

  // A page-pick event applies once; local selection changes must not replay it.
  const applyPick = useEffectEvent((id: string) => {
    if (byId[id]) {
      select(id);
    }
  });

  useEffect(() => {
    if (picked) {
      applyPick(picked.id);
    }
  }, [picked]);

  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );

    if (stageRef.current) {
      observer.observe(stageRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const paths = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.id, ancestry(n, byId)])),
    [nodes, byId],
  );

  const scene = useMemo(
    () => makeScene(hierarchy, { automatic: automaticDepth, depth, selected, focused: !!focus }),
    [hierarchy, automaticDepth, depth, selected, focus],
  );

  const planes = scene.layers;

  const ids = useMemo(() => new Set(planes.map((n) => n.id)), [planes]);

  const textures = useMemo(() => {
    const children = new Set(planes.flatMap((plane) => plane.sceneChildren));
    return Object.fromEntries(
      planes.map((n) => [
        n.id,
        render(
          n,
          n.sceneChildren.map((id) => byId[id]),
          !children.has(n.id),
        ),
      ]),
    );
  }, [planes, render, byId]);

  const frame = useMemo(
    () =>
      focusNode?.frame || {
        x: 0,
        y: 0,
        w: snapshot.viewport.width,
        h: snapshot.viewport.height,
      },
    [focusNode, snapshot.viewport.width, snapshot.viewport.height],
  );

  const distance = explode * 1.6;

  const fit = useMemo(
    () => fitScene(planes, { frame, size, rotation, distance, maxScale: focusNode ? 1.8 : 1.2 }),
    [planes, frame, size, rotation, distance, focusNode],
  );

  // The plane that currently paints a component, which may belong to an ancestor.
  const planeOf = (id: string | null) =>
    scene.representedBy.get(hierarchy.representatives.get(id ?? '') ?? '');

  function select(id: string) {
    if (!byId[id]) {
      return;
    }

    const next = new Set(collapsed);

    for (const p of paths[id].slice(0, -1)) {
      next.delete(p.id);
    }

    const nextHierarchy = makeLayerHierarchy(nodes, { focus, collapsed: next, showWrappers });

    setSelected(id);
    setCollapsed(next);
    setDepth(Math.min(nextHierarchy.maxDepth, Math.max(depth, nextHierarchy.depths.get(id) || 0)));

    if (matchMedia('(max-width: 900px)').matches) {
      setDetails(true);
    }
  }

  function isolate(id: string) {
    if (!busy) {
      onScope(id);
    }
  }

  function wholePage() {
    if (!busy && focus) {
      onScope(null);
    }
  }

  function reset() {
    setExplode(0);
    setRotation({ x: 0, y: 0 });
    setZoom(1);
    setAutomaticDepth(!showWrappers);
    setDepth(makeLayerHierarchy(nodes, { showWrappers }).initialDepth);
    setCollapsed(new Set());
  }

  function toggleWrappers() {
    const next = makeLayerHierarchy(nodes, { focus, collapsed, showWrappers: !showWrappers });

    setShowWrappers((v) => !v);
    setAutomaticDepth(showWrappers);
    setDepth(Math.max(next.initialDepth, next.depths.get(selected) || 0));
  }

  function toggleAutomaticDepth() {
    if (automaticDepth) {
      setDepth(scene.revealDepth);
      setAutomaticDepth(false);
    } else {
      setShowWrappers(false);
      setAutomaticDepth(true);
    }
  }

  function reveal() {
    setExplode(explode ? 0 : DEFAULT_SEPARATION * SEPARATION_SCALE);
    setRotation(explode ? { x: 0, y: 0 } : { x: 24, y: -32 });
  }

  function toggleBranch(id: string) {
    if (!collapsed.has(id) && selected !== id && paths[selected]?.some((n) => n.id === id)) {
      setSelected(id);
    }

    setCollapsed((previous) => {
      const next = new Set(previous);

      next.has(id) ? next.delete(id) : next.add(id);

      return next;
    });
  }

  // Shortcuts act on the view as it is when the key is pressed, so the listener
  // is registered once and reads the latest state through an Effect Event.
  const shortcut = useEffectEvent((e: KeyboardEvent) => {
    if (
      (e.target instanceof Element && e.target.closest('input,textarea,[contenteditable]')) ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    ) {
      return;
    }

    setInstant(true);
    setTimeout(() => setInstant(false), 40);

    if (e.key === 'Escape') {
      wholePage();
    }

    if (e.key.toLowerCase() === 'f') {
      isolate(selectedNode.id);
    }

    if (e.key.toLowerCase() === 'r') {
      onCapture();
    }

    if (e.key.toLowerCase() === 'c') {
      onPick();
    }

    if (e.key === '0') {
      reset();
    }

    if (e.key === '/') {
      e.preventDefault();
      searchRef.current?.focus();
    }

    if (e.key === ' ' && e.target === document.body) {
      e.preventDefault();
      reveal();
    }
  });

  useEffect(() => {
    const keys = (e: KeyboardEvent) => shortcut(e);

    window.addEventListener('keydown', keys);

    return () => window.removeEventListener('keydown', keys);
  }, []);

  return (
    <div
      inert={busy}
      className={
        'workspace inspector-workspace ' +
        (dragging ? 'is-dragging ' : '') +
        (instant ? 'keyboard-motion ' : '') +
        (details ? 'show-details ' : '') +
        (treeHidden ? 'hide-tree' : '')
      }
      style={{ '--tree-width': treeWidth + 'px', '--inspector-width': inspectorWidth + 'px' }}
    >
      <ComponentTree
        nodes={nodes}
        byId={byId}
        roots={roots}
        collapsed={collapsed}
        selectedId={selectedNode.id}
        hovered={hovered}
        picked={picked}
        scopeId={focus}
        scopeName={focusNode?.name}
        searchRef={searchRef}
        call={call}
        isShown={(id) => ids.has(hierarchy.representatives.get(id) ?? '')}
        onSelect={select}
        onFocus={isolate}
        onToggle={toggleBranch}
        onHover={setHovered}
        onCollapseAll={() => {
          setSelected(roots[0].id);
          setCollapsed(new Set(nodes.filter((n) => n.children.length).map((n) => n.id)));
        }}
      />
      {!treeHidden && (
        <Splitter
          label="Component tree width"
          value={treeWidth}
          onChange={setTreeWidth}
          max={Math.min(440, size.width + treeWidth - 220)}
        />
      )}
      <main className="main-stage">
        <StageHeading
          title={focusNode ? focusNode.name : '3D view'}
          treeHidden={treeHidden}
          showWrappers={showWrappers}
          flat={!rotation.x && !rotation.y}
          details={details}
          onToggleTree={() => setTreeHidden((v) => !v)}
          onToggleWrappers={toggleWrappers}
          onRotate={setRotation}
          onReset={reset}
          onToggleDetails={() => setDetails((v) => !v)}
        />
        {focusNode && (
          <div className="focus-navigation">
            <button onClick={wholePage}>
              <Glyph type="back" size={12} />
              Whole page
            </button>
            <span>/</span>
            {(snapshot.scope?.path || paths[focusNode.id]).map((n) => (
              <button key={n.id} onClick={() => isolate(n.id)}>
                {n.name}
              </button>
            ))}
          </div>
        )}
        <SceneStage
          stageRef={stageRef}
          viewport={snapshot.viewport}
          planes={planes}
          textures={textures}
          frame={frame}
          fit={fit}
          zoom={zoom}
          rotation={rotation}
          explode={explode}
          distance={distance}
          labels={labels}
          limited={scene.limited}
          combined={hierarchy.combined}
          selectedPlane={planeOf(selectedNode.id)}
          hoveredPlane={planeOf(hovered)}
          onSelect={select}
          onFocus={isolate}
          onHover={setHovered}
          onRotate={setRotation}
          onZoom={setZoom}
          onDragging={setDragging}
        />
        <LayerControls
          separation={Math.round(explode / SEPARATION_SCALE)}
          automaticDepth={automaticDepth}
          depth={depth}
          maxDepth={maxDepth}
          revealDepth={scene.revealDepth}
          labels={labels}
          onReveal={reveal}
          onSeparation={(separation) => setExplode(separation * SEPARATION_SCALE)}
          onToggleAutomaticDepth={toggleAutomaticDepth}
          onDepth={(value) => {
            setAutomaticDepth(false);
            setDepth(value);
          }}
          onLabels={setLabels}
        />
        <div className="breadcrumb" aria-label="Component path">
          {(paths[hovered ?? ''] || paths[selectedNode.id]).map((n, i) => (
            <React.Fragment key={n.id}>
              {i > 0 && <Glyph type="chevron" size={10} />}
              <button onClick={() => select(n.id)}>{n.name}</button>
            </React.Fragment>
          ))}
        </div>
      </main>
      <div className="inspector-splitter">
        <Splitter
          label="Component details width"
          value={inspectorWidth}
          onChange={setInspectorWidth}
          reverse
          min={210}
          max={Math.min(440, size.width + inspectorWidth - 220)}
        />
      </div>
      <ComponentDetails
        node={selectedNode}
        path={paths[selectedNode.id]}
        capturedAt={snapshot.capturedAt}
        warnings={snapshot.warnings ?? []}
        call={call}
        canInspect={canInspect}
        onFocus={isolate}
        onAction={onAction}
        onSelect={select}
        onClose={() => setDetails(false)}
      />
    </div>
  );
}
