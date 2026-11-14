import type { Frame, SceneLayer, Snapshot } from './types.ts';
import React, { useRef } from 'react';
import { Glyph } from './Glyph.tsx';

// The CSS 3D scene: one plane per displayed layer, orbit by dragging, zoom by
// scrolling. Which layers are displayed is decided by the caller.
export function SceneStage({
  stageRef,
  viewport,
  planes,
  textures,
  frame,
  fit,
  zoom,
  rotation,
  explode,
  distance,
  labels,
  limited,
  combined,
  selectedPlane,
  hoveredPlane,
  onSelect,
  onFocus,
  onHover,
  onRotate,
  onZoom,
  onDragging,
}: {
  stageRef: React.RefObject<HTMLDivElement | null>;
  viewport: Snapshot['viewport'];
  planes: SceneLayer[];
  textures: Record<string, string>;
  frame: Frame;
  fit: number;
  zoom: number;
  rotation: { x: number; y: number };
  explode: number;
  distance: number;
  labels: boolean;
  limited: boolean;
  combined: number;
  selectedPlane: string | null | undefined;
  hoveredPlane: string | null | undefined;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
  onHover: (id: string | null) => void;
  onRotate: (rotation: { x: number; y: number }) => void;
  onZoom: React.Dispatch<React.SetStateAction<number>>;
  onDragging: (dragging: boolean) => void;
}) {
  const drag = useRef<{
    x: number;
    y: number;
    rx: number;
    ry: number;
    id?: string;
    moved: boolean;
  } | null>(null);
  const levels = Math.max(1, ...planes.map((n) => n.sceneDepth));

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
      onDragging(true);
      onRotate({
        x: Math.max(-65, Math.min(65, drag.current.rx - dy * 0.22)),
        y: Math.max(-75, Math.min(75, drag.current.ry + dx * 0.22)),
      });
    }
  }

  function up() {
    if (drag.current?.id && !drag.current.moved) {
      onSelect(drag.current.id);
    }

    drag.current = null;
    onDragging(false);
  }

  return (
    <div
      className="stage"
      ref={stageRef}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={(e) => onZoom((z) => Math.max(0.4, Math.min(2.5, z - e.deltaY * 0.001)))}
    >
      <div className="stage-meta">
        {viewport.width} × {viewport.height}
        <span>
          {planes.length} planes{limited ? ' · Focus for detail' : ''}
        </span>
        {combined > 0 && <span>{combined} wrappers combined</span>}
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
                  onSelect(n.id);
                }
              }}
              onDoubleClick={() => onFocus(n.id)}
              onMouseEnter={() => !drag.current && onHover(n.id)}
              onMouseLeave={() => onHover(null)}
              className={`component-plane ${explode > 2 ? 'separated' : 'assembled'} ${selectedPlane === n.id || hoveredPlane === n.id ? 'active' : ''}`}
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
          onClick={() => onZoom((z) => Math.max(0.4, z - 0.1))}
        >
          <Glyph type="minus" size={13} />
        </button>
        <button
          className="zoom-value"
          aria-label="Reset zoom"
          title="Reset zoom"
          onClick={() => onZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          className="icon-button"
          aria-label="Zoom in"
          onClick={() => onZoom((z) => Math.min(2.5, z + 0.1))}
        >
          <Glyph type="plus" size={13} />
        </button>
      </div>
    </div>
  );
}
