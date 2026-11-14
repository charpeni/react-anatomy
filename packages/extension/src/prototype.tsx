import type { PrototypeCaption } from './prototype-types.ts';
import type { PrototypeNode } from './capture.ts';
// THROWAWAY PROTOTYPE: compare a spatial workbench, subtree lens, and depth atlas.
// Real React/Fiber capture; three variants on /prototype?variant=A|B|C.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { WorkspaceApp } from './sample.tsx';
import { captureReactRoot, captureMarkup } from './capture.ts';
import css from './style.css';

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

async function boot() {
  const source = document.createElement('div');

  source.className = 'source-app';
  source.setAttribute('aria-hidden', 'true');
  source.inert = true;
  document.body.appendChild(source);

  const sampleRoot = createRoot(source);

  flushSync(() => sampleRoot.render(<WorkspaceApp />));
  await document.fonts.ready;

  const nodes = captureReactRoot(sampleRoot, source);
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const palette = ['#9ab8d1', '#b3a1de', '#82bcae', '#d3b37d', '#dc91a7', '#85b6ce', '#bcc97f'];
  const variants = {
    A: ['Spatial workbench', 'The whole page, pulled apart.'],
    B: ['Subtree lens', 'Follow one branch of the composition.'],
    C: ['Depth atlas', 'Read the page one component level at a time.'],
  };
  const variantKeys = Object.keys(variants) as (keyof typeof variants)[];
  const initialVariant =
    (new URLSearchParams(location.search).get('variant') ?? '') in variants
      ? (new URLSearchParams(location.search).get('variant') as keyof typeof variants)
      : 'A';
  const initialFocus =
    initialVariant === 'B' ? nodes.find((n) => n.name === 'ProjectSection')!.id : null;
  const textureCache = new Map<string, string>();

  const descendants = (id: string) => {
    const ids = new Set([id]);

    for (const n of nodes) {
      if (ids.has(n.parent ?? '')) {
        ids.add(n.id);
      }
    }

    return ids;
  };

  const pathTo = (id: string) => {
    const out = [];

    for (let n = byId[id]; n; n = byId[n.parent ?? '']) {
      out.unshift(n);
    }

    return out;
  };

  const badge = (n: PrototypeNode) =>
    n.props.project?.name || n.props.label || n.props.name || null;

  function Glyph({ type = 'layers', size = 18 }) {
    const paths: Record<string, React.ReactNode> = {
      layers: (
        <>
          <path d="m12 3 9 5-9 5-9-5 9-5Z" />
          <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
        </>
      ),
      cube: (
        <>
          <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
          <path d="m3 7 9 5 9-5M12 12v10M7 4.8l9 5" />
        </>
      ),
      target: (
        <>
          <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />
          <circle cx="12" cy="12" r="3" />
        </>
      ),
      reset: (
        <>
          <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
        </>
      ),
      code: (
        <>
          <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />
        </>
      ),
      eye: (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ),
      arrow: <path d="m9 5 7 7-7 7" />,
      minus: <path d="M5 12h14" />,
      plus: <path d="M5 12h14m-7-7v14" />,
      search: (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m15 15 6 6" />
        </>
      ),
    };

    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths[type] || paths.layers}
      </svg>
    );
  }

  function Prototype() {
    const [variant, setVariant] = useState(initialVariant);
    const [selected, setSelected] = useState(initialFocus || nodes[0].id);
    const [hovered, setHovered] = useState<string | null>(null);
    const [explode, setExplode] = useState(initialFocus ? 62 : 0);
    const [depth, setDepth] = useState(maxDepth);
    const [rotation, setRotation] = useState(initialFocus ? { x: 22, y: -30 } : { x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [labels, setLabels] = useState(true);
    const [collapsed, setCollapsed] = useState(new Set<string>());
    const [focus, setFocus] = useState(initialFocus);
    const [search, setSearch] = useState('');
    const [dragging, setDragging] = useState(false);
    const [caption, setCaption] = useState<PrototypeCaption | null>(null);
    const [captureCount, setCaptureCount] = useState(1);
    const [keyMotion, setKeyMotion] = useState(false);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const drag = useRef<{
      x: number;
      y: number;
      rx: number;
      ry: number;
      id?: string;
      moved: boolean;
    } | null>(null);
    const [stageSize, setStageSize] = useState({ width: 900, height: 650 });
    const selectedNode = byId[selected];
    const focusNode = byId[focus ?? ''] || nodes[0];

    const focusIds = useMemo(
      () => (focus ? descendants(focus) : new Set(nodes.map((n) => n.id))),
      [focus],
    );

    const visible = useMemo(
      () =>
        nodes.filter(
          (n) =>
            n.depth <= depth &&
            focusIds.has(n.id) &&
            !pathTo(n.id)
              .slice(0, -1)
              .some((p) => collapsed.has(p.id)),
        ),
      [depth, focusIds, collapsed],
    );

    const visibleIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);

    const textures = useMemo(
      () =>
        Object.fromEntries(
          visible.map((n) => {
            const children = n.children.filter((id) => visibleIds.has(id)).map((id) => byId[id]);
            const key = n.id + ':' + children.map((c) => c.id).join(',') + ':' + captureCount;

            if (!textureCache.has(key)) {
              textureCache.set(key, captureMarkup(n, children));
            }

            return [n.id, textureCache.get(key)];
          }),
        ),
      [visible, visibleIds, captureCount],
    );

    useLayoutEffect(() => {
      const observer = new ResizeObserver(([entry]) =>
        setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
      );

      if (stageRef.current) {
        observer.observe(stageRef.current);
      }

      return () => observer.disconnect();
    }, [variant]);

    function switchVariant(key: keyof typeof variants) {
      setVariant(key);

      const url = new URL(location.href);

      url.searchParams.set('variant', key);
      history.replaceState(null, '', url);

      if (key === 'B') {
        const n = nodes.find((n) => n.name === 'ProjectSection');

        setFocus(n!.id);
        setSelected(n!.id);
        setExplode(62);
        setRotation({ x: 22, y: -30 });
        setZoom(1);
      } else {
        setFocus(null);
        setZoom(1);

        if (key === 'A') {
          setExplode(58);
          setRotation({ x: 22, y: -30 });
        }
      }

      setCollapsed(new Set());
      setDepth(maxDepth);
    }

    function select(id: string) {
      setSelected(id);
    }

    function isolate(id: string) {
      setFocus(id);
      setSelected(id);
      setZoom(1);
      setCollapsed(new Set());
      setDepth(maxDepth);
      setExplode(66);
      setRotation({ x: 20, y: -26 });
    }

    function reset() {
      setFocus(null);
      setSelected(nodes[0].id);
      setDepth(maxDepth);
      setCollapsed(new Set());
      setExplode(0);
      setRotation({ x: 0, y: 0 });
      setZoom(1);
    }

    function toggleNode(id: string) {
      setCollapsed((prev) => {
        const next = new Set(prev);

        next.has(id) ? next.delete(id) : next.add(id);

        return next;
      });
    }

    function reveal() {
      setExplode(explode > 0 ? 0 : 64);
      setRotation(explode > 0 ? { x: 0, y: 0 } : { x: 24, y: -32 });
    }

    /* oxlint-disable react-hooks/exhaustive-deps -- This legacy demo registers keyboard actions for the explicit navigation state below. */
    useEffect(() => {
      function keys(e: KeyboardEvent) {
        if (
          e.target instanceof Element &&
          e.target.closest('input,textarea,select,[contenteditable]')
        ) {
          return;
        }

        setKeyMotion(true);
        window.setTimeout(() => setKeyMotion(false), 50);

        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();

          const keys = Object.keys(variants) as (keyof typeof variants)[];

          switchVariant(keys[(keys.indexOf(variant) + (e.key === 'ArrowRight' ? 1 : 2)) % 3]);
        }

        if (e.key === 'Escape') {
          setFocus(null);
          setZoom(1);
        }

        if (e.key === '0') {
          reset();
        }

        if (e.key.toLowerCase() === 'f') {
          isolate(selected);
        }

        if (e.key === ' ') {
          e.preventDefault();
          reveal();
        }
      }

      window.addEventListener('keydown', keys);

      return () => window.removeEventListener('keydown', keys);
    }, [variant, selected, explode]);
    /* oxlint-enable react-hooks/exhaustive-deps */
    useEffect(() => {
      window.__anatomyPrototype = {
        nodes: nodes.map(({ hosts, ...rest }) => rest),
        state: {
          variant,
          selected,
          explode,
          depth,
          focus,
          rotation,
          visible: visible.map((n) => n.id),
        },
        setCaption,
        select,
        isolate,
        reset,
        switchVariant,
        setExplode,
        setDepth,
        setRotation,
        setLabels,
        setZoom,
      };
    }, [variant, selected, explode, depth, focus, rotation, visible]);

    const baseDepth = focusNode.depth;
    const frame = focus
      ? { x: focusNode.x, y: focusNode.y, w: focusNode.w, h: focusNode.h }
      : { x: 0, y: 0, w: 960, h: 690 };
    const distance = (explode / 100) * 160;
    const usedLevels = Math.max(1, ...visible.map((n) => n.depth - baseDepth));
    const baseScale = Math.min(
      (stageSize.width - 120) / (frame.w + usedLevels * distance * 0.45),
      (stageSize.height - 160) / (frame.h + usedLevels * distance * 0.32),
      focus ? 1.65 : 1.18,
    );
    const scale = baseScale * zoom;

    function pointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button,input,a'))) {
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

    function pointerMove(e: React.PointerEvent<HTMLDivElement>) {
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
          y: Math.max(-70, Math.min(70, drag.current.ry + dx * 0.22)),
        });
      }
    }

    function pointerUp() {
      if (drag.current?.id && !drag.current.moved) {
        select(drag.current.id);
      }

      drag.current = null;
      setDragging(false);
    }

    function Tree({ root = nodes[0], level = 0 }) {
      if (
        search &&
        ![root, ...Array.from(descendants(root.id)).map((id) => byId[id])].some((n) =>
          n.name.toLowerCase().includes(search.toLowerCase()),
        )
      ) {
        return null;
      }

      const isCollapsed = collapsed.has(root.id);
      const highlighted = selected === root.id;

      return (
        <React.Fragment key={root.id}>
          <div
            className={
              'tree-row ' +
              (highlighted ? 'selected ' : '') +
              (hovered === root.id ? 'hovered ' : '') +
              (!visibleIds.has(root.id) ? 'dimmed' : '')
            }
            style={{ paddingLeft: 14 + level * 15 }}
            onMouseEnter={() => setHovered(root.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <button
              className={'tree-toggle ' + (!root.children.length ? 'empty' : '')}
              aria-label={(isCollapsed ? 'Expand ' : 'Collapse ') + root.name}
              onClick={() => toggleNode(root.id)}
            >
              {root.children.length ? (isCollapsed ? '›' : '⌄') : '·'}
            </button>
            <button
              className="tree-select"
              data-tree={root.id}
              onClick={() => select(root.id)}
              onDoubleClick={() => isolate(root.id)}
            >
              <span
                className="node-dot"
                style={{ background: palette[root.depth % palette.length] }}
              />
              <span>{root.name}</span>
              <small>{root.children.length || ''}</small>
            </button>
          </div>
          {!isCollapsed && root.children.map((id) => Tree({ root: byId[id], level: level + 1 }))}
        </React.Fragment>
      );
    }

    function Inspector() {
      return (
        <aside className="inspector">
          <div className="panel-kicker">
            SELECTED COMPONENT <span style={{ background: palette[selectedNode.depth] }} />
          </div>
          <div className="component-symbol">
            <Glyph type="code" size={25} />
          </div>
          <h2>{selectedNode.name}</h2>
          {badge(selectedNode) && <p className="instance-name">{badge(selectedNode)}</p>}
          <div className="component-kind">
            <span className="green-dot" /> Function component
          </div>
          <button className="focus-button" onClick={() => isolate(selected)}>
            <Glyph type="target" size={15} /> Focus subtree <kbd>F</kbd>
          </button>
          <div className="inspector-section">
            <h3>COMPOSITION</h3>
            <dl>
              <dt>Depth</dt>
              <dd>
                {selectedNode.depth} <span>/ {maxDepth}</span>
              </dd>
              <dt>Direct children</dt>
              <dd>{selectedNode.children.length}</dd>
              <dt>Rendered bounds</dt>
              <dd>
                {Math.round(selectedNode.w)} × {Math.round(selectedNode.h)}
              </dd>
            </dl>
          </div>
          <div className="inspector-section">
            <h3>OWNERSHIP PATH</h3>
            <div className="ownership">
              {pathTo(selected).map((n) => (
                <button
                  key={n.id}
                  onClick={() => select(n.id)}
                  style={{ color: n.id === selected ? palette[n.depth] : undefined }}
                >
                  <span>↳</span>
                  {n.name}
                </button>
              ))}
            </div>
          </div>
          <div className="inspector-section">
            <h3>
              PROPS <span>{Object.keys(selectedNode.props).length}</span>
            </h3>
            <pre>
              {Object.keys(selectedNode.props).length
                ? JSON.stringify(selectedNode.props, null, 2)
                : 'No props'}
            </pre>
          </div>
          <div className="source-note">
            <Glyph type="code" size={14} />
            <span>
              Captured from the React tree
              <br />
              <small>sample.tsx · development build</small>
            </span>
          </div>
        </aside>
      );
    }

    function Plane({ node: n, mode = 'spatial' }: { node: PrototypeNode; mode?: string }) {
      const active = selected === n.id || hovered === n.id;
      const spatial = mode === 'spatial';
      const transform = spatial
        ? `translate3d(${n.x - frame.x}px, ${n.y - frame.y}px, ${(n.depth - baseDepth - usedLevels / 2) * distance}px)`
        : `translate(${n.x}px, ${n.y}px)`;

      return (
        <div
          key={n.id}
          className={
            'component-plane ' +
            (active ? 'active ' : '') +
            (explode > 2 || !spatial ? 'separated' : 'assembled')
          }
          data-plane={n.id}
          role="button"
          tabIndex={0}
          aria-label={`Select ${n.name}${badge(n) ? ': ' + badge(n) : ''}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              select(n.id);
            }
          }}
          onDoubleClick={() => isolate(n.id)}
          onMouseEnter={() => !drag.current && setHovered(n.id)}
          onMouseLeave={() => setHovered(null)}
          onClick={spatial ? undefined : () => select(n.id)}
          style={{
            width: n.w,
            height: n.h,
            transform,
            '--plane-color': palette[n.depth % palette.length],
          }}
        >
          <div
            className="plane-content"
            dangerouslySetInnerHTML={{ __html: textures[n.id] || '' }}
          />
          {labels && (explode > 5 || !spatial) && (
            <div className={'plane-label ' + (active ? 'active' : '')}>
              <span />
              {n.name}
              {badge(n) && <em>{badge(n)}</em>}
            </div>
          )}
          {active && (explode > 5 || !spatial) && (
            <span className="bounds-label">
              {Math.round(n.w)} × {Math.round(n.h)}
            </span>
          )}
        </div>
      );
    }

    function Atlas() {
      return (
        <div className="atlas-scroll">
          <div className="atlas-intro">
            <span className="eyebrow">READ THE COMPOSITION</span>
            <h2>One level at a time.</h2>
            <p>Each sheet holds the components at one depth, in their original page positions.</p>
          </div>
          <div className="atlas-cards">
            {Array.from({ length: depth + 1 }, (_, level) => {
              const layer = visible.filter((n) => n.depth === level);

              return (
                <section className="atlas-card" key={level}>
                  <div className="atlas-heading">
                    <span style={{ color: palette[level] }}>0{level}</span>
                    <div>
                      <h3>
                        {
                          [
                            'Application',
                            'Major regions',
                            'Sections',
                            'Collections',
                            'Components',
                            'Details',
                            'Primitives',
                          ][level]
                        }
                      </h3>
                      <small>
                        {layer.length} component{layer.length !== 1 ? 's' : ''}
                      </small>
                    </div>
                  </div>
                  <div className="atlas-sheet">
                    <div className="atlas-page">
                      {layer.map((n) => Plane({ node: n, mode: 'atlas' }))}
                    </div>
                  </div>
                  <div className="atlas-names">
                    {layer.map((n) => (
                      <button
                        key={n.id}
                        className={selected === n.id ? 'selected' : ''}
                        onClick={() => select(n.id)}
                      >
                        <i style={{ background: palette[level] }} />
                        {n.name}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div
        className={
          'prototype variant-' +
          variant +
          (dragging ? ' is-dragging' : '') +
          (keyMotion ? ' keyboard-motion' : '')
        }
      >
        <header className="app-header">
          <div className="brand">
            <span className="brand-icon">
              <Glyph size={23} />
            </span>
            <strong>React Anatomy</strong>
            <span className="prototype-badge">PROTOTYPE</span>
          </div>
          <div className="session">
            <span className="green-dot" />
            <span>Orbit workspace</span>
            <span className="session-separator">/</span>
            <span className="session-muted">React 19</span>
          </div>
          <div className="header-actions">
            <span className="snapshot-status">
              Snapshot {String(captureCount).padStart(2, '0')}
            </span>
            <button
              onClick={() => {
                textureCache.clear();
                setCaptureCount((c) => c + 1);
              }}
            >
              <Glyph type="target" size={15} /> Recapture
            </button>
          </div>
        </header>
        <div className="workspace">
          {variant === 'A' && (
            <aside className="tree-panel">
              <div className="panel-title">
                <span>Components</span>
                <span className="count">{nodes.length}</span>
              </div>
              <label className="tree-search">
                <Glyph type="search" size={14} />
                <input
                  placeholder="Find a component…"
                  aria-label="Find a component"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <kbd>⌕</kbd>
              </label>
              <div className="tree-scroll">{Tree({})}</div>
              <div className="tree-footer">
                <span className="green-dot" /> React component hierarchy
                <small>Double-click to focus a subtree</small>
              </div>
            </aside>
          )}
          <main className="main-stage">
            <div className="stage-heading">
              <div>
                <span className="section-number">
                  0{Object.keys(variants).indexOf(variant) + 1}
                </span>
                <h1>{variants[variant][0]}</h1>
                <span className="stage-subtitle">{variants[variant][1]}</span>
              </div>
              <div className="view-controls">
                {variant !== 'C' && (
                  <>
                    <button
                      className={rotation.x === 0 && rotation.y === 0 ? 'active' : ''}
                      onClick={() => setRotation({ x: 0, y: 0 })}
                    >
                      Front
                    </button>
                    <button
                      className={rotation.x !== 0 || rotation.y !== 0 ? 'active' : ''}
                      onClick={() => setRotation({ x: 24, y: -32 })}
                    >
                      <Glyph type="cube" size={14} /> 3D
                    </button>
                  </>
                )}
                <button title="Reset view" aria-label="Reset view" onClick={reset}>
                  <Glyph type="reset" size={15} />
                </button>
              </div>
            </div>
            {variant === 'B' && (
              <div className="lens-navigation">
                <span>FOCUS</span>
                {pathTo(focusNode.id).map((n, i) => (
                  <React.Fragment key={n.id}>
                    {i > 0 && <span className="crumb-separator">/</span>}
                    <button onClick={() => isolate(n.id)}>{n.name}</button>
                  </React.Fragment>
                ))}
                <button className="all-components" onClick={() => setFocus(null)}>
                  Entire page ↗
                </button>
              </div>
            )}
            <div
              className="stage"
              ref={stageRef}
              onPointerDown={variant !== 'C' ? pointerDown : undefined}
              onPointerMove={variant !== 'C' ? pointerMove : undefined}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onWheel={(e) => {
                if (variant !== 'C') {
                  setZoom((z) => Math.min(1.8, Math.max(0.45, z - e.deltaY * 0.001)));
                }
              }}
            >
              {variant === 'C' ? (
                Atlas()
              ) : (
                <>
                  <div className="stage-meta">
                    <span className="live-marker" />
                    {focus ? `ISOLATING ${focusNode.name}` : '960 × 690 · CAPTURED VIEWPORT'}
                    <span>{visible.length} visible components</span>
                  </div>
                  <div className="scene-anchor">
                    <div
                      className="scene"
                      style={{
                        width: frame.w,
                        height: frame.h,
                        transform: `translate(-50%, -50%) scale(${scale}) rotateX(${rotation.x}deg) rotateY(${rotation.y}deg)`,
                      }}
                    >
                      {visible.map((n) => Plane({ node: n }))}
                    </div>
                  </div>
                  <div className="orientation">
                    <svg width="58" height="58" viewBox="0 0 58 58">
                      <path d="M25 33 48 40" stroke="#bf8a89" />
                      <path d="M25 33 12 46" stroke="#83ac9b" />
                      <path d="M25 33 25 8" stroke="#8da9c1" />
                      <circle cx="25" cy="33" r="3" fill="#9ba7b1" />
                      <text x="49" y="45">
                        x
                      </text>
                      <text x="6" y="52">
                        y
                      </text>
                      <text x="23" y="7">
                        z
                      </text>
                    </svg>
                  </div>
                  <div className="stage-help">
                    Drag to orbit <span>·</span> Scroll to zoom <span>·</span> Click to inspect
                  </div>
                  <div className="zoom-controls">
                    <button
                      aria-label="Zoom out"
                      onClick={() => setZoom((z) => Math.max(0.45, z - 0.1))}
                    >
                      <Glyph type="minus" size={13} />
                    </button>
                    <span>{Math.round(zoom * 100)}%</span>
                    <button
                      aria-label="Zoom in"
                      onClick={() => setZoom((z) => Math.min(1.8, z + 0.1))}
                    >
                      <Glyph type="plus" size={13} />
                    </button>
                  </div>
                </>
              )}
              {caption && (
                <div className="recording-caption">
                  <span>{caption.kicker}</span>
                  <strong>{caption.title}</strong>
                  <p>{caption.text}</p>
                </div>
              )}
            </div>
            {variant === 'B' && (
              <div className="lens-children">
                <div>
                  <span className="panel-kicker">DIRECT CHILDREN</span>
                  <small>Choose a piece to go deeper</small>
                </div>
                {focusNode.children.map((id: string) => (
                  <button
                    key={id}
                    onClick={() => isolate(id)}
                    onMouseEnter={() => setHovered(id)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span className="node-dot" style={{ background: palette[byId[id].depth] }} />
                    <b>{byId[id].name}</b>
                    <small>{byId[id].children.length} children</small>
                    <Glyph type="arrow" size={13} />
                  </button>
                ))}
                {!focusNode.children.length && (
                  <span className="leaf-note">
                    You’ve reached a leaf component. Use the breadcrumbs to go back up.
                  </span>
                )}
              </div>
            )}
            <div className="control-dock">
              <div className="separation-control">
                <div className="control-label">
                  <span>Layer separation</span>
                  <output>
                    {Math.round(explode)}
                    <small>%</small>
                  </output>
                </div>
                <input
                  aria-label="Layer separation"
                  type="range"
                  min="0"
                  max="100"
                  value={explode}
                  onChange={(e) => setExplode(+e.target.value)}
                  disabled={variant === 'C'}
                />
                <div className="range-ticks">
                  <span>Assembled</span>
                  <span>Exploded</span>
                </div>
              </div>
              <div className="control-divider" />
              <div className="depth-control">
                <div className="control-label">
                  <span>Reveal depth</span>
                  <output>
                    {depth}
                    <small> / {maxDepth}</small>
                  </output>
                </div>
                <input
                  aria-label="Reveal depth"
                  type="range"
                  min={baseDepth}
                  max={maxDepth}
                  step="1"
                  value={depth}
                  onChange={(e) => setDepth(+e.target.value)}
                />
                <div className="range-ticks">
                  <span>Structure</span>
                  <span>Details</span>
                </div>
              </div>
              <div className="control-divider" />
              <label className="labels-toggle">
                <input
                  type="checkbox"
                  checked={labels}
                  onChange={(e) => setLabels(e.target.checked)}
                />
                <span className="toggle-track" />
                <span>Labels</span>
              </label>
              <button className="explode-button" onClick={reveal} disabled={variant === 'C'}>
                <Glyph type="layers" size={17} />
                {explode > 0 ? 'Assemble' : 'Explode view'}
              </button>
            </div>
            <div className="breadcrumb">
              <Glyph type="code" size={13} />
              {pathTo(hovered || selected).map((n, i) => (
                <React.Fragment key={n.id}>
                  {i > 0 && <span>›</span>}
                  <button onClick={() => select(n.id)}>{n.name}</button>
                </React.Fragment>
              ))}
              <small>
                {visible.length} / {nodes.length} visible
              </small>
            </div>
          </main>
          {variant !== 'B' && Inspector()}
        </div>
        <footer className="app-footer">
          <span>
            EXPERIENCE STUDY <span>·</span> REACT COMPOSITION
          </span>
          <div className="variant-switcher">
            <button
              aria-label="Previous prototype"
              onClick={() =>
                switchVariant(variantKeys[(Object.keys(variants).indexOf(variant) + 2) % 3])
              }
            >
              ←
            </button>
            {Object.entries(variants).map(([key, [name]]) => (
              <button
                key={key}
                data-variant={key}
                className={variant === key ? 'selected' : ''}
                onClick={() => switchVariant(key as keyof typeof variants)}
              >
                <span>{key}</span>
                {name}
              </button>
            ))}
            <button
              aria-label="Next prototype"
              onClick={() =>
                switchVariant(variantKeys[(Object.keys(variants).indexOf(variant) + 1) % 3])
              }
            >
              →
            </button>
          </div>
          <span className="footer-hint">← → switch prototypes</span>
        </footer>
      </div>
    );
  }

  createRoot(document.getElementById('root')!).render(<Prototype />);
}

boot();
