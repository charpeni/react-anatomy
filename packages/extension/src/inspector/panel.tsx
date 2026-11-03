import type { CaptureBudget, ComponentNode, Snapshot } from './types.ts';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createTransport } from './transport.ts';
import { makeSnapshotRenderer, fontFacesOnly } from './snapshot.ts';
import { makeLayerHierarchy } from './layers.ts';
import { makeScene, fitScene } from './scene.ts';
import { nextCaptureBudget, captureLimitMessage } from './capture-budget.ts';
import { Glyph } from './Glyph.tsx';
import { PropsInspector } from './PropsInspector.tsx';
import inspectorStyles from './panel.css';

document.head.appendChild(
  Object.assign(document.createElement('style'), { textContent: inspectorStyles }),
);

const transport = createTransport();

function applyTheme() {
  const theme = globalThis.chrome?.devtools?.panels?.themeName;

  document.documentElement.dataset.theme = theme
    ? theme === 'dark'
      ? 'dark'
      : 'light'
    : matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
}

applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

const panels = globalThis.chrome?.devtools?.panels as
  | (typeof chrome.devtools.panels & {
      onThemeChanged?: { addListener: (callback: () => void) => void };
    })
  | undefined;

panels?.onThemeChanged?.addListener(applyTheme);

function ancestry(node: ComponentNode, byId: Record<string, ComponentNode>) {
  const path = [];

  for (let n: ComponentNode | undefined = node; n; n = n.parent ? byId[n.parent] : undefined) {
    path.unshift(n);
  }

  return path;
}

function friendlyError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);

  if (/Cannot access|permission|cannot be scripted|chrome:\/\//i.test(text)) {
    return 'Open React Anatomy from the extension button on the React page, or use its DevTools panel. Browser settings pages cannot be inspected.';
  }

  if (/No tab|No frame|closed|receiving end/i.test(text)) {
    return 'The inspected tab has closed or navigated away. Open React Anatomy again from the page you want to inspect.';
  }

  return text;
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [changed, setChanged] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ id: string; time: number } | null>(null);
  const [count, setCount] = useState(0);
  const current = useRef<Snapshot | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const seenPick = useRef<string | null>(null);
  const generation = useRef(0);
  const captureBudget = useRef<CaptureBudget>({});

  const capture = useCallback(async (options: { limits?: CaptureBudget; quiet?: boolean } = {}) => {
    if (inFlight.current) {
      return;
    }

    const startedGeneration = generation.current;

    inFlight.current = true;
    setBusy(true);
    setError(null);

    try {
      const result = await transport.call({
        action: 'capture',
        ...(options.limits || captureBudget.current),
      });

      if (!result || result.version !== 1 || !Array.isArray(result.nodes)) {
        throw new Error('The page returned an unsupported snapshot.');
      }

      if (alive.current && startedGeneration === generation.current) {
        if (result.limits) {
          captureBudget.current = {
            maxComponents: result.limits.components,
            maxDepth: result.limits.depth,
          };
        }

        current.current = result;
        setSnapshot(result);
        setChanged(false);
        setPicking(false);
        setCount((n) => n + 1);

        return true;
      }
    } catch (e) {
      if (alive.current && startedGeneration === generation.current && !options.quiet) {
        setError(friendlyError(e));
      }

      return false;
    } finally {
      inFlight.current = false;

      if (alive.current) {
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    capture();

    let navigationTimer: ReturnType<typeof setTimeout> | undefined;
    const off = transport.onNavigate(() => {
      const nextGeneration = ++generation.current;

      current.current = null;
      captureBudget.current = {};
      setSnapshot(null);
      setPicking(false);
      setPicked(null);
      setError(null);
      clearTimeout(navigationTimer);

      let attempts = 0;

      const reconnect = async () => {
        if (!alive.current || nextGeneration !== generation.current) {
          return;
        }

        if (inFlight.current) {
          navigationTimer = setTimeout(reconnect, 100);

          return;
        }

        const ready = await capture({ quiet: attempts < 4 });

        if (!ready && attempts++ < 4) {
          navigationTimer = setTimeout(reconnect, 250 * attempts);
        }
      };

      // Chrome announces navigation before the new execution context is ready.
      navigationTimer = setTimeout(reconnect, 100);
    });

    const cleanup = () => {
      transport.call({ action: 'dispose' }).catch(() => {});
    };

    window.addEventListener('pagehide', cleanup);

    return () => {
      alive.current = false;
      clearTimeout(navigationTimer);
      off();
      window.removeEventListener('pagehide', cleanup);
      cleanup();
    };
  }, [capture]);
  useEffect(() => {
    let polling = false;
    let cancelled = false;
    const timer = setInterval(
      async () => {
        if (
          polling ||
          inFlight.current ||
          document.visibilityState === 'hidden' ||
          !current.current
        ) {
          return;
        }

        polling = true;

        try {
          const status = await transport.call({ action: 'status' });

          if (cancelled || !status || !current.current) {
            return;
          }

          setPicking(status.picking);

          if (status.picked && status.picked !== seenPick.current) {
            seenPick.current = status.picked;
            setPicked({ id: status.picked, time: Date.now() });
          }

          const newPage = status.url !== current.current.url;
          const dirty =
            newPage ||
            (status.expired && current.current.status === 'ready') ||
            status.revision !== current.current.revision;

          setChanged(dirty);

          const newlyMounted =
            current.current.status !== 'ready' && status.revision !== current.current.revision;

          if (dirty && (follow || newPage || newlyMounted)) {
            if (newPage) {
              current.current = null;
              captureBudget.current = {};
              setSnapshot(null);
            }

            await capture();
          }
        } catch (e) {
          if (!cancelled) {
            setError(friendlyError(e));
            setFollow(false);
            setPicking(false);
          }
        } finally {
          polling = false;
        }
      },
      picking ? 300 : follow ? 900 : 1800,
    );

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [follow, picking, capture]);
  useEffect(() => {
    const style = document.createElement('style');

    style.textContent = fontFacesOnly(snapshot?.fonts);
    document.head.appendChild(style);

    return () => style.remove();
  }, [snapshot]);

  async function pick() {
    try {
      if (picking) {
        await transport.call({ action: 'clear' });
        setPicking(false);
      } else {
        seenPick.current = null;
        await transport.call({ action: 'pick' });
        setPicking(true);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  async function onAction(action: 'inspect' | 'highlight' | 'clear', id = '') {
    try {
      const result =
        action === 'inspect' ? await transport.inspect?.(id) : await transport.call({ action, id });

      if (result?.ok === false) {
        setError(result.message);
      }
    } catch (e) {
      setError(friendlyError(e));
    }
  }

  const ready = snapshot?.status === 'ready';
  const nextBudget = ready && snapshot.truncated ? nextCaptureBudget(snapshot.limits) : null;

  return (
    <div className="extension-app">
      <header className="app-header" aria-label="Inspection toolbar">
        <button
          className={'icon-button ' + (picking ? 'picking active' : '')}
          disabled={!ready || busy}
          aria-label={picking ? 'Cancel picker' : 'Pick on page'}
          aria-pressed={picking}
          onClick={pick}
          title="Select a component in the page (C)"
        >
          <Glyph type="pick" size={16} />
        </button>
        <button
          className="icon-button capture-button"
          aria-label="Capture"
          disabled={busy}
          onClick={() => capture()}
          title="Capture the current page (R)"
        >
          <Glyph type="reset" size={15} />
        </button>
        <span className="toolbar-separator" />
        <label className="follow-control">
          <input
            type="checkbox"
            checked={follow}
            disabled={!ready}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow changes
        </label>
        <span className="toolbar-separator" />
        <div className="session" title={snapshot?.url}>
          {snapshot?.url || 'Connecting to inspected page…'}
        </div>
        <span className="toolbar-context">
          {transport.mode === 'devtools' ? 'top' : 'React Anatomy'}
        </span>
      </header>
      {picking && (
        <div className="connection-banner picker-banner" role="status">
          Click a component in the inspected page. Press Escape there to cancel.
        </div>
      )}
      {error && (
        <div className="connection-banner error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {ready && snapshot.truncated && (
        <div className="connection-banner capture-limit-banner" role="status">
          <span>
            {captureLimitMessage(snapshot)}
            {!nextBudget && ' Maximum capture size reached; this hierarchy remains partial.'}
          </span>
          {nextBudget && (
            <button
              className="standard-button"
              aria-label="Capture more"
              disabled={busy}
              title={`Capture up to ${nextBudget.maxComponents.toLocaleString('en-US')} components and ${nextBudget.maxDepth.toLocaleString('en-US')} nested levels`}
              onClick={() => capture({ limits: nextBudget })}
            >
              {busy ? 'Capturing…' : 'Capture more'}
            </button>
          )}
        </div>
      )}
      {ready ? (
        <Viewer
          snapshot={snapshot}
          picked={picked}
          onAction={onAction}
          onCapture={capture}
          onPick={pick}
        />
      ) : (
        <div className="empty-state">
          <h1>{busy ? 'Reading React components…' : 'No React components to inspect'}</h1>
          <p>
            {snapshot?.message ||
              error ||
              'Open a page with a mounted React app to inspect its component hierarchy.'}
          </p>
          <button className="standard-button" disabled={busy} onClick={() => capture()}>
            {busy ? 'Connecting…' : 'Capture page'}
          </button>
          <p className="setup-hint">Development builds provide the clearest component names.</p>
        </div>
      )}
      <footer className="extension-footer">
        <span className={changed ? 'changed' : ''}>
          {busy
            ? 'Capturing…'
            : changed
              ? 'Page changed since capture'
              : ready
                ? 'Snapshot'
                : 'Waiting for React'}
        </span>
        {changed && !busy && <button onClick={() => capture()}>Update snapshot</button>}
        <span className="footer-meta">
          {ready
            ? `${snapshot.nodes.length} components · ${snapshot.rootCount} root${snapshot.rootCount === 1 ? '' : 's'} · ${snapshot.captureMs} ms`
            : ''}
        </span>
        <span className="footer-count">{count ? `Capture ${count}` : ''}</span>
      </footer>
    </div>
  );
}

function Splitter({
  label,
  value,
  onChange,
  min = 170,
  max = 440,
  reverse = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  reverse?: boolean;
}) {
  const start = useRef<{ x: number; value: number } | null>(null);

  const resize = (value: number) => onChange(Math.max(min, Math.min(max, value)));

  return (
    <div
      className="splitter"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) {
          return;
        }

        start.current = { x: e.clientX, value };
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (start.current) {
          resize(start.current.value + (e.clientX - start.current.x) * (reverse ? -1 : 1));
        }
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          resize(value + (e.key === 'ArrowRight' ? 10 : -10) * (reverse ? -1 : 1));
        }
      }}
    />
  );
}

function Viewer({
  snapshot,
  picked,
  onAction,
  onCapture,
  onPick,
}: {
  snapshot: Snapshot;
  picked: { id: string; time: number } | null;
  onAction: (action: 'inspect' | 'highlight' | 'clear', id?: string) => Promise<void>;
  onCapture: () => void;
  onPick: () => void;
}) {
  const nodes = snapshot.nodes;

  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);

  const roots = useMemo(() => nodes.filter((n) => !n.parent), [nodes]);

  const [selected, setSelected] = useState(nodes[0]?.id ?? '');
  const [hovered, setHovered] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [search, setSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const [showWrappers, setShowWrappers] = useState(false);

  const hierarchy = useMemo(
    () => makeLayerHierarchy(nodes, { focus, collapsed, showWrappers }),
    [nodes, focus, collapsed, showWrappers],
  );

  const maxDepth = hierarchy.maxDepth;
  const [explode, setExplode] = useState(0);
  const [depth, setDepth] = useState(() => hierarchy.initialDepth);
  const [automaticDepth, setAutomaticDepth] = useState(true);
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [labels, setLabels] = useState(true);
  const [instant, setInstant] = useState(false);
  const [details, setDetails] = useState(false);
  const [treeWidth, setTreeWidth] = useState(252);
  const [inspectorWidth, setInspectorWidth] = useState(264);
  const [treeHidden, setTreeHidden] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    rx: number;
    ry: number;
    id?: string;
    moved: boolean;
  } | null>(null);
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

    if (focus && !byId[focus]) {
      setFocus(null);
    }

    const expanded =
      previousSnapshot.current.truncated &&
      snapshot.nodes.length > previousSnapshot.current.nodes.length;

    setDepth((d) => Math.min(maxDepth, expanded ? Math.max(d, hierarchy.initialDepth) : d));
    previousSnapshot.current = snapshot;
  }, [snapshot]);
  /* oxlint-enable react-hooks/exhaustive-deps, react/set-state-in-effect */
  /* oxlint-disable react-hooks/exhaustive-deps -- A page-pick event applies once; local selection changes must not replay it. */
  useEffect(() => {
    if (picked && byId[picked.id]) {
      select(picked.id, true);
    }
  }, [picked]);
  /* oxlint-enable react-hooks/exhaustive-deps */
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

  const textures = useMemo(
    () =>
      Object.fromEntries(
        planes.map((n) => [
          n.id,
          render(
            n,
            n.sceneChildren.map((id) => byId[id]),
          ),
        ]),
      ),
    [planes, render, byId],
  );

  const searchIds = useMemo(() => {
    if (!search) {
      return null;
    }

    const out = new Set();

    for (const n of nodes) {
      if (`${n.name} ${n.key || ''}`.toLowerCase().includes(search.toLowerCase())) {
        for (const p of paths[n.id]) {
          out.add(p.id);
        }
      }
    }

    return out;
  }, [search, nodes, paths]);

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

  const baseDepth = 0;
  const levels = Math.max(1, ...planes.map((n) => n.sceneDepth));
  const distance = explode * 1.6;

  const fit = useMemo(
    () => fitScene(planes, { frame, size, rotation, distance, maxScale: focusNode ? 1.8 : 1.2 }),
    [planes, frame, size, rotation, distance, focusNode],
  );

  function select(id: string, wholePage = false) {
    if (!byId[id]) {
      return;
    }

    const next = new Set(collapsed);

    for (const p of paths[id].slice(0, -1)) {
      next.delete(p.id);
    }

    const nextFocus = !wholePage && focus && paths[id].some((n) => n.id === focus) ? focus : null;
    const nextHierarchy = makeLayerHierarchy(nodes, {
      focus: nextFocus,
      collapsed: next,
      showWrappers,
    });

    setSelected(id);
    setFocus(nextFocus);
    setCollapsed(next);
    setDepth(
      Math.min(
        nextHierarchy.maxDepth,
        Math.max(
          nextFocus === focus ? depth : nextHierarchy.initialDepth,
          nextHierarchy.depths.get(id) || 0,
        ),
      ),
    );

    if (matchMedia('(max-width: 900px)').matches) {
      setDetails(true);
    }
  }

  function isolate(id: string) {
    if (!byId[id]) {
      return;
    }

    const next = new Set(collapsed);

    next.delete(id);
    setSelected(id);
    setFocus(id);
    setCollapsed(next);
    setAutomaticDepth(!showWrappers);
    setDepth(makeLayerHierarchy(nodes, { focus: id, collapsed: next, showWrappers }).initialDepth);
    setZoom(1);
    setExplode(60);
    setRotation({ x: 22, y: -30 });
  }

  function wholePage() {
    setFocus(null);
    setZoom(1);
    setAutomaticDepth(!showWrappers);
    setDepth(makeLayerHierarchy(nodes, { collapsed, showWrappers }).initialDepth);
  }

  function reset() {
    setFocus(null);
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
    setExplode(explode ? 0 : 65);
    setRotation(explode ? { x: 0, y: 0 } : { x: 24, y: -32 });
  }

  /* oxlint-disable react-hooks/exhaustive-deps -- These commands close over the explicit navigation state below; preserve the existing keyboard lifecycle during the workspace migration. */
  useEffect(() => {
    function keys(e: KeyboardEvent) {
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
    }

    window.addEventListener('keydown', keys);

    return () => window.removeEventListener('keydown', keys);
  }, [selectedNode, depth, explode, onCapture, onPick, nodes, collapsed, focus, showWrappers]);

  /* oxlint-enable react-hooks/exhaustive-deps */
  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button,input'))) {
      return;
    }

    drag.current = {
      x: e.clientX,
      y: e.clientY,
      rx: rotation.x,
      ry: rotation.y,
      id:
        e.target instanceof Element
          ? e.target.closest<HTMLElement>('[data-plane]')?.dataset.plane
          : undefined,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current) {
      return;
    }

    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;

    if (Math.abs(dx) + Math.abs(dy) > 4) {
      drag.current.moved = true;
      setDragging(true);
      setRotation({
        x: Math.max(-65, Math.min(65, drag.current.rx - dy * 0.22)),
        y: Math.max(-75, Math.min(75, drag.current.ry + dx * 0.22)),
      });
    }
  }

  function up() {
    if (drag.current?.id && !drag.current.moved) {
      select(drag.current.id);
    }

    drag.current = null;
    setDragging(false);
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

  function treeKey(e: React.KeyboardEvent<HTMLButtonElement>, node: ComponentNode) {
    const rows = Array.from(
      e.currentTarget.closest('[role=tree]')!.querySelectorAll<HTMLButtonElement>('[data-tree]'),
    );
    const index = rows.indexOf(e.currentTarget);
    let next;

    if (e.key === 'ArrowDown') {
      next = rows[Math.min(rows.length - 1, index + 1)];
    }

    if (e.key === 'ArrowUp') {
      next = rows[Math.max(0, index - 1)];
    }

    if (e.key === 'Home') {
      next = rows[0];
    }

    if (e.key === 'End') {
      next = rows.at(-1);
    }

    if (e.key === 'ArrowRight' && node.children.length) {
      if (collapsed.has(node.id)) {
        toggleBranch(node.id);
      } else {
        next = rows[index + 1];
      }
    }

    if (e.key === 'ArrowLeft') {
      if (node.children.length && !collapsed.has(node.id)) {
        toggleBranch(node.id);
      } else {
        next = rows.find((row) => row.dataset.tree === node.parent);
      }
    }

    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();

      if (next) {
        if (next.dataset.tree) {
          select(next.dataset.tree);
        }

        next.focus();
      }
    }
  }

  useEffect(() => {
    document
      .querySelector('.tree-row.selected .tree-select')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected, picked]);

  function tree(node: ComponentNode, level = 0): React.ReactNode {
    if (searchIds && !searchIds.has(node.id)) {
      return null;
    }

    const closed = collapsed.has(node.id) && !searchIds;

    return (
      <React.Fragment key={node.id}>
        <div
          className={`tree-row ${selectedNode.id === node.id ? 'selected ' : ''}${hovered === node.id ? 'hovered ' : ''}${!ids.has(hierarchy.representatives.get(node.id) ?? '') ? 'dimmed' : ''}`}
          style={{ paddingLeft: 4 + level * 14 }}
          onMouseEnter={() => setHovered(node.id)}
          onMouseLeave={() => setHovered(null)}
        >
          <button
            tabIndex={-1}
            className={'tree-toggle ' + (!node.children.length ? 'empty' : '')}
            aria-label={(closed ? 'Expand ' : 'Collapse ') + node.name}
            disabled={!node.children.length}
            onClick={() => toggleBranch(node.id)}
          >
            {node.children.length && <Glyph type={closed ? 'chevron' : 'chevronDown'} size={12} />}
          </button>
          <button
            role="treeitem"
            aria-level={level + 1}
            aria-selected={selectedNode.id === node.id}
            aria-expanded={node.children.length ? !closed : undefined}
            tabIndex={selectedNode.id === node.id ? 0 : -1}
            className="tree-select"
            data-tree={node.id}
            title={`${node.name}${node.key ? ` key="${node.key}"` : ''}${!node.frame ? ' · No output in the current viewport' : ''}`}
            onKeyDown={(e) => treeKey(e, node)}
            onClick={() => select(node.id)}
            onDoubleClick={() => isolate(node.id)}
          >
            <span className="node-icon">
              <Glyph type="component" size={12} />
            </span>
            <span className="node-name">{node.name}</span>
            {node.key && <small className="tree-key">key="{node.key}"</small>}
            {!node.frame && (
              <small
                title={node.bounds ? 'Outside the captured viewport' : 'No visible DOM output'}
              >
                ○
              </small>
            )}
          </button>
        </div>
        {!closed && node.children.map((id) => byId[id] && tree(byId[id], level + 1))}
      </React.Fragment>
    );
  }

  return (
    <div
      className={
        'workspace inspector-workspace ' +
        (dragging ? 'is-dragging ' : '') +
        (instant ? 'keyboard-motion ' : '') +
        (details ? 'show-details ' : '') +
        (treeHidden ? 'hide-tree' : '')
      }
      style={{ '--tree-width': treeWidth + 'px', '--inspector-width': inspectorWidth + 'px' }}
    >
      <aside className="tree-panel" aria-label="Component hierarchy">
        <div className="panel-title">
          <span>Components</span>
          <span className="count">{nodes.length}</span>
          <button
            className="icon-button"
            aria-label="Collapse all components"
            title="Collapse all components"
            onClick={() => {
              setSelected(roots[0].id);
              setCollapsed(new Set(nodes.filter((n) => n.children.length).map((n) => n.id)));
            }}
          >
            <Glyph type="collapse" size={14} />
          </button>
        </div>
        <label className="tree-search">
          <Glyph type="search" size={13} />
          <input
            ref={searchRef}
            aria-label="Find a component"
            placeholder="Filter components"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search ? (
            <button aria-label="Clear filter" onClick={() => setSearch('')}>
              <Glyph type="close" size={12} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </label>
        <div className="tree-scroll" role="tree" aria-label="React components">
          {roots.map((n) => tree(n))}
          {searchIds && !searchIds.size && <p className="search-empty">No matching components.</p>}
        </div>
        <div className="tree-footer">
          Double-click to focus <kbd>F</kbd>
        </div>
      </aside>
      {!treeHidden && (
        <Splitter
          label="Component tree width"
          value={treeWidth}
          onChange={setTreeWidth}
          max={Math.min(440, size.width + treeWidth - 220)}
        />
      )}
      <main className="main-stage">
        <div className="stage-heading">
          <button
            className="icon-button"
            aria-label="Toggle component tree"
            aria-pressed={!treeHidden}
            title="Toggle component tree"
            onClick={() => setTreeHidden((v) => !v)}
          >
            <Glyph type="sidebar" size={15} />
          </button>
          <span className="stage-title">{focusNode ? focusNode.name : '3D view'}</span>
          <div className="view-controls" aria-label="View orientation">
            <button
              className={showWrappers ? 'active' : ''}
              aria-label="Show wrapper layers"
              aria-pressed={showWrappers}
              title="Give wrappers that share the same DOM output their own planes. All components remain in the tree."
              onClick={toggleWrappers}
            >
              Wrappers
            </button>
            <span className="toolbar-separator" />
            <button
              className={!rotation.x && !rotation.y ? 'active' : ''}
              aria-pressed={!rotation.x && !rotation.y}
              onClick={() => setRotation({ x: 0, y: 0 })}
            >
              Front
            </button>
            <button
              className={rotation.x || rotation.y ? 'active' : ''}
              aria-pressed={!!(rotation.x || rotation.y)}
              onClick={() => setRotation({ x: 24, y: -32 })}
            >
              3D
            </button>
            <span className="toolbar-separator" />
            <button
              className="icon-button"
              aria-label="Reset view"
              title="Reset view (0)"
              onClick={reset}
            >
              <Glyph type="reset" size={14} />
            </button>
            <button
              className="icon-button details-button"
              aria-label="Toggle component details"
              aria-pressed={details}
              title="Toggle component details"
              onClick={() => setDetails((v) => !v)}
            >
              <Glyph type="sidebarRight" size={15} />
            </button>
          </div>
        </div>
        {focusNode && (
          <div className="focus-navigation">
            <button onClick={wholePage}>
              <Glyph type="back" size={12} />
              Whole page
            </button>
            <span>/</span>
            {paths[focusNode.id].map((n) => (
              <button key={n.id} onClick={() => isolate(n.id)}>
                {n.name}
              </button>
            ))}
          </div>
        )}
        <div
          className="stage"
          ref={stageRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onWheel={(e) => setZoom((z) => Math.max(0.4, Math.min(2.5, z - e.deltaY * 0.001)))}
        >
          <div className="stage-meta">
            {snapshot.viewport.width} × {snapshot.viewport.height}
            <span>{planes.length} planes</span>
            {hierarchy.combined > 0 && <span>{hierarchy.combined} wrappers combined</span>}
          </div>
          <div className="scene-anchor">
            <div
              className="scene"
              style={{
                width: frame.w,
                height: frame.h,
                transform: `translate(-50%,-50%) scale3d(${fit * zoom},${fit * zoom},${fit * zoom}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
                // Labels annotate the scene: when the camera backs away they stay near their screen size instead of shrinking with the page.
                '--label-scale': Math.min(2.2, Math.max(1, 0.9 / (fit * zoom))).toFixed(3),
              }}
            >
              {planes.map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  data-plane={n.id}
                  data-layer-depth={n.layerDepth}
                  data-scene-depth={n.sceneDepth}
                  aria-label={'Select ' + n.name}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      select(n.id);
                    }
                  }}
                  onDoubleClick={() => isolate(n.id)}
                  onMouseEnter={() => !drag.current && setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={`component-plane ${explode > 2 ? 'separated' : 'assembled'} ${scene.representedBy.get(hierarchy.representatives.get(selectedNode.id) ?? '') === n.id || scene.representedBy.get(hierarchy.representatives.get(hovered ?? '') ?? '') === n.id ? 'active' : ''}`}
                  style={{
                    width: n.frame.w,
                    height: n.frame.h,
                    transform: `translate3d(${n.frame.x - frame.x}px,${n.frame.y - frame.y}px,${(n.sceneDepth - levels / 2) * distance}px)`,
                  }}
                >
                  <div
                    className="plane-content"
                    inert
                    dangerouslySetInnerHTML={{ __html: textures[n.id] }}
                  />
                  {labels && explode > 5 && (
                    <div className="plane-label">
                      {n.name}
                      {n.key && <em>{n.key}</em>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          {!planes.length && (
            <div className="no-plane-message">
              No visible output in the captured viewport.
              <br />
              Select a parent or scroll the page and capture again.
            </div>
          )}
          <div className="stage-help">Drag to rotate · Scroll to zoom · Double-click to focus</div>
          <div className="zoom-controls">
            <button
              className="icon-button"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
            >
              <Glyph type="minus" size={13} />
            </button>
            <button
              className="zoom-value"
              aria-label="Reset zoom"
              title="Reset zoom"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="icon-button"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
            >
              <Glyph type="plus" size={13} />
            </button>
          </div>
        </div>
        <div className="control-dock" aria-label="Layer controls">
          <button
            className={'icon-button explode-button ' + (explode ? 'active' : '')}
            aria-label={explode ? 'Assemble' : 'Explode view'}
            aria-pressed={!!explode}
            title={explode ? 'Assemble layers' : 'Explode layers'}
            onClick={reveal}
          >
            <Glyph type="layers" size={16} />
          </button>
          <label className="separation-control">
            <span>Separation</span>
            <input
              aria-label="Layer separation"
              type="range"
              min="0"
              max="100"
              value={explode}
              onChange={(e) => setExplode(+e.target.value)}
            />
            <output>{Math.round(explode)}%</output>
          </label>
          <span className="toolbar-separator" />
          <div className="depth-control">
            <span>Layer depth</span>
            <button
              className={'auto-depth ' + (automaticDepth ? 'active' : '')}
              aria-label="Automatic layer depth"
              aria-pressed={automaticDepth}
              title="Auto explores each visible region. Move the slider to apply one manual depth cutoff across all branches."
              onClick={toggleAutomaticDepth}
            >
              Auto
            </button>
            <input
              aria-label="Reveal depth"
              aria-valuetext={
                automaticDepth
                  ? 'Automatic layout overview'
                  : `${Math.min(depth, maxDepth)} of ${maxDepth}`
              }
              title="Move left to group descendants into their parents; move right to reveal deeper component layers."
              type="range"
              min={baseDepth}
              max={maxDepth}
              value={automaticDepth ? scene.revealDepth : Math.min(depth, maxDepth)}
              onChange={(e) => {
                setAutomaticDepth(false);
                setDepth(+e.target.value);
              }}
            />
            <output>{automaticDepth ? 'Auto' : `${Math.min(depth, maxDepth)}/${maxDepth}`}</output>
          </div>
          <label className="labels-toggle">
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
            Labels
          </label>
        </div>
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
      <aside className="inspector" aria-label="Component details">
        <div className="inspector-heading">
          <Glyph type="component" size={14} />
          <h2>{selectedNode.name}</h2>
          <button
            className="icon-button close-details"
            aria-label="Close component details"
            onClick={() => setDetails(false)}
          >
            <Glyph type="close" size={14} />
          </button>
        </div>
        <div className="inspector-actions">
          <button
            className="focus-button"
            aria-label="Focus subtree"
            title="Focus this component and its children (F)"
            onClick={() => isolate(selectedNode.id)}
          >
            <Glyph type="target" size={13} />
            Focus subtree
          </button>
          <span className="toolbar-separator" />
          <button
            className="icon-button"
            aria-label="Highlight on page"
            title="Highlight on page"
            onClick={() => onAction('highlight', selectedNode.id)}
            disabled={!selectedNode.hosts.length}
          >
            <Glyph type="eye" size={14} />
          </button>
          {transport.inspect && (
            <button
              className="icon-button"
              aria-label="Reveal in Elements"
              title="Reveal in Elements"
              onClick={() => onAction('inspect', selectedNode.id)}
              disabled={!selectedNode.hosts.length}
            >
              <Glyph type="code" size={15} />
            </button>
          )}
        </div>
        <div className="inspector-scroll">
          <PropsInspector
            key={selectedNode.id}
            componentId={selectedNode.id}
            capturedAt={snapshot.capturedAt}
            call={transport.call}
          />
          <details className="inspector-section" open>
            <summary>Layout</summary>
            <div className="section-body">
              <dl>
                <dt>Width × height</dt>
                <dd>
                  {selectedNode.bounds
                    ? `${Math.round(selectedNode.bounds.w)} × ${Math.round(selectedNode.bounds.h)}`
                    : '—'}
                </dd>
                <dt>Depth</dt>
                <dd>{selectedNode.depth}</dd>
                <dt>Children</dt>
                <dd>{selectedNode.children.length}</dd>
                <dt>DOM roots</dt>
                <dd>{selectedNode.hosts.length}</dd>
                {selectedNode.key && (
                  <>
                    <dt>Key</dt>
                    <dd className="instance-name">{selectedNode.key}</dd>
                  </>
                )}
              </dl>
              <div className="component-kind">
                {selectedNode.hosts.length > 1
                  ? 'Multiple DOM roots'
                  : selectedNode.hosts.length
                    ? 'React component'
                    : 'No DOM output'}
                {selectedNode.portal ? ' · portal' : ''}
              </div>
            </div>
          </details>
          <details className="inspector-section" open>
            <summary>Component stack</summary>
            <div className="ownership">
              {paths[selectedNode.id]
                .slice()
                .reverse()
                .map((n, i) => (
                  <button
                    key={n.id}
                    className={n.id === selectedNode.id ? 'current' : ''}
                    onClick={() => select(n.id)}
                  >
                    <Glyph type={i ? 'chevron' : 'component'} size={11} />
                    {n.name}
                  </button>
                ))}
            </div>
          </details>
          {!!(snapshot.warnings ?? []).length && (
            <details className="inspector-section capture-notes">
              <summary>Capture notes ({(snapshot.warnings ?? []).length})</summary>
              <ul>
                {(snapshot.warnings ?? []).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
