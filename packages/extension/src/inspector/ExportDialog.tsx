import type {
  ComponentNode,
  Frame,
  ImageProps,
  ImagePropsByComponent,
  PageCall,
  PropEntry,
  PropPage,
  Result,
  SceneLayer,
  Snapshot,
} from './types.ts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Scene } from './SceneStage.tsx';
import { fitScene } from './scene.ts';
import { placeTags, type PlacedTag, type TagRequest } from './export-layout.ts';
import {
  assetBudget,
  collectImageUrls,
  embedFonts,
  loadImages,
  rasterize,
} from './export-image.ts';
import { propertyPath, reviewRows, sameRows, type LoadedPage } from './image-props.ts';
import { Glyph } from './Glyph.tsx';

// Sized for a pull request: GitHub shows images up to about the width of its
// description column, so a narrower image keeps its text readable there.
// Props cards sit below the scene. The stage height follows the panel's
// proportions within limits.
const STAGE_WIDTH = 960;
const MAX_TAGS = 24;
const MAX_LINES = 40;
// Distinct from each other and readable on the always-light image.
const COLORS = ['#1a73e8', '#9334e6', '#e8710a', '#188038', '#d93025', '#007b83'];

/** The view being exported, as the Viewer currently shows it. */
export interface ExportView {
  snapshot: Snapshot;
  planes: SceneLayer[];
  textures: Record<string, string>;
  frame: Frame;
  /** The live stage, whose proportions the image keeps. */
  size: { width: number; height: number };
  zoom: number;
  rotation: { x: number; y: number };
  explode: number;
  distance: number;
  maxScale: number;
  labels: boolean;
  selectedPlane: string | null | undefined;
  byId: Record<string, ComponentNode>;
  /** The plane that paints a component, which may belong to an ancestor. */
  planeOf: (id: string) => string | null | undefined;
}

interface Callout {
  id: string;
  name: string;
  key: string | null;
  props: ImageProps;
  number: number;
  color: string;
  plane: string | null;
}

// Everything the image shows is decided once, when the dialog opens.
function planImage(view: ExportView, imageProps: ImagePropsByComponent) {
  const height = (STAGE_WIDTH * view.size.height) / Math.max(1, view.size.width);
  const stage = { width: STAGE_WIDTH, height: Math.round(Math.min(720, Math.max(480, height))) };
  // The live view caps how far it enlarges a small subtree. Widen that cap with
  // the image, so the subtree fills the image as it fills the panel.
  const scale =
    fitScene(view.planes, {
      frame: view.frame,
      size: stage,
      rotation: view.rotation,
      distance: view.distance,
      maxScale: view.maxScale * Math.max(1, STAGE_WIDTH / Math.max(1, view.size.width)),
    }) * view.zoom;
  const callouts: Callout[] = [...imageProps]
    .filter(([id, props]) => props.included && view.byId[id])
    .map(([id, props], index) => ({
      id,
      name: view.byId[id].name,
      key: view.byId[id].key,
      props,
      number: index + 1,
      color: COLORS[index % COLORS.length],
      plane: view.planeOf(id) ?? null,
    }));
  const badges = new Map<string, Callout[]>();

  for (const callout of callouts) {
    if (callout.plane) {
      badges.set(callout.plane, [...(badges.get(callout.plane) ?? []), callout]);
    }
  }

  const tints = Object.fromEntries([...badges].map(([plane, [first]]) => [plane, first.color]));
  // Called-out planes are tagged first, then the selection, then larger planes.
  // In-scene labels only appear once layers are separated; tags follow suit.
  const priority = (plane: SceneLayer) =>
    badges.get(plane.id)?.[0].number ?? (plane.id === view.selectedPlane ? 1000 : 2000);
  const named = view.labels && view.explode > 5;
  const tagged = view.planes
    .filter((plane) => badges.has(plane.id) || named)
    .sort((a, b) => priority(a) - priority(b) || b.frame.w * b.frame.h - a.frame.w * a.frame.h)
    .slice(0, Math.max(MAX_TAGS, badges.size));

  return { stage, scale, callouts, badges, tints, tagged };
}

/**
 * Reads a component's props again, as many entries as the author saw, only to
 * tell whether they changed. The image keeps drawing what the author reviewed.
 */
async function changedSinceReview(call: PageCall, id: string, image: ImageProps) {
  const result = await call({ action: 'props', id });

  if (!result?.ok) {
    return result?.message || 'Props are unavailable.';
  }

  const { token, root } = result;
  const open = new Set(image.expanded);
  const hidden = new Set(image.hidden.map((h) => h.path));
  const pages = new Map<string, LoadedPage>();

  async function load(handle: string, path: string) {
    const wanted = image.counts[path] ?? 0;
    const entries: PropEntry[] = [];
    let next: Result<PropPage>;

    do {
      next = await call({ action: 'props-read', token, handle, offset: entries.length });

      if (!next.ok) {
        throw new Error(next.message);
      }

      entries.push(...(next.entries ?? []));
    } while (next.entries && entries.length < wanted && next.nextOffset !== null);

    pages.set(path, { ...next, entries: next.entries ? entries : undefined, readAt: 0, handle });

    for (const entry of entries) {
      const child = propertyPath(path, entry);

      if (open.has(child) && !hidden.has(child) && entry.value.expandable && entry.value.handle) {
        await load(entry.value.handle, child);
      }
    }
  }

  try {
    if (root.expandable && root.handle) {
      await load(root.handle, 'props');
    }
  } catch (e) {
    return e instanceof Error && e.message ? e.message : 'Props are unavailable.';
  } finally {
    call({ action: 'props-release', token }).catch(() => {});
  }

  const live = reviewRows(pages, image);

  return live && sameRows(live.rows, image.rows) ? null : 'changed';
}

function fileName(snapshot: Snapshot) {
  const name = snapshot.scope?.path.at(-1)?.name || 'page';

  return `react-anatomy-${name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'component'}.png`;
}

function time(at: number, reference?: number) {
  const date = new Date(at);

  return reference && date.toDateString() === new Date(reference).toDateString()
    ? date.toLocaleTimeString(undefined, { timeStyle: 'short' })
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function ExportDialog({
  view: currentView,
  imageProps,
  call,
  changed: currentlyChanged,
  onClose,
}: {
  view: ExportView;
  imageProps: ImagePropsByComponent;
  call: PageCall;
  changed: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const composition = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef<Element | null>(null);
  // Follow changes can recapture while the dialog is open. The image, and what
  // the dialog says about it, describe the view as it was when export started.
  const [view] = useState(currentView);
  const [changed] = useState(currentlyChanged);
  const [plan] = useState(() => planImage(view, imageProps));
  const [tags, setTags] = useState<PlacedTag[] | null>(null);
  const [leaks, setLeaks] = useState<number[]>([]);
  const [drift, setDrift] = useState<Record<string, string>>({});
  const [image, setImage] = useState<{
    blob: Blob;
    url: string;
    width: number;
    height: number;
    cssWidth: number;
    notes: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [actualSize, setActualSize] = useState(false);
  const { snapshot } = view;
  const canCopy = typeof ClipboardItem === 'function' && !!navigator.clipboard?.write;
  const path = snapshot.scope ? snapshot.scope.path.map((n) => n.name).join(' / ') : 'Whole page';
  const reviewedAt = Math.max(0, ...plan.callouts.map((c) => c.props.reviewedAt));

  useEffect(() => {
    dialog.current?.showModal();
    initialFocus.current = document.activeElement;
  }, []);

  // Live props are read only to warn that they changed; the cards do not use them.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      for (const callout of plan.callouts) {
        const reason = await changedSinceReview(call, callout.id, callout.props).catch((e) =>
          e instanceof Error ? e.message : String(e),
        );

        if (reason && !cancelled) {
          setDrift((previous) => ({ ...previous, [callout.id]: reason }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [call, plan]);

  // Place tags once the offscreen scene is laid out: each plane carries an
  // anchor at its top corners, so the browser projects them for us.
  /* oxlint-disable react/set-state-in-effect -- Tag positions and page text depend on measured layout, which only exists after the first commit. */
  useLayoutEffect(() => {
    const stage = stageRef.current!;
    const origin = stage.getBoundingClientRect();
    const requests: TagRequest[] = [];

    for (const plane of plan.tagged) {
      const corners = stage.querySelectorAll(
        `[data-plane="${CSS.escape(plane.id)}"] > .plane-anchor`,
      );
      const [anchor, end] = Array.from(corners, (corner) => corner.getBoundingClientRect());
      const tag = stage.querySelector<HTMLElement>(`[data-tag="${CSS.escape(plane.id)}"]`);

      if (!anchor || !tag) {
        continue;
      }

      const point = { x: anchor.left - origin.left, y: anchor.top - origin.top };
      // The slant of the plane's top edge on screen, which a seated tag follows.
      const angle = end ? Math.atan2(end.top - anchor.top, end.left - anchor.left) : undefined;

      if (point.x >= 0 && point.y >= 0 && point.x <= origin.width && point.y <= origin.height) {
        requests.push({
          id: plane.id,
          anchor: point,
          width: tag.offsetWidth,
          height: tag.offsetHeight,
          angle,
          // Numbered components and the selection always keep their tag.
          required: plan.badges.has(plane.id) || plane.id === view.selectedPlane,
        });
      }
    }

    setTags(placeTags(requests, plan.stage));

    // Hiding covers the props card only. Say so when the same text is drawn
    // on a layer anyway.
    const pageText = Array.from(
      stage.querySelectorAll('.plane-content'),
      (el) => el.textContent,
    ).join('\n');

    setLeaks(
      plan.callouts
        .filter((c) => c.props.hidden.some((h) => h.text && pageText.includes(h.text)))
        .map((c) => c.number),
    );
  }, [plan, view]);
  /* oxlint-enable react/set-state-in-effect */

  useEffect(() => {
    if (!tags) {
      return;
    }

    const controller = new AbortController();
    let url: string | undefined;

    (async () => {
      try {
        const root = composition.current!;
        const budget = assetBudget(controller.signal);

        await document.fonts.ready;

        const [fonts, images] = await Promise.all([
          embedFonts(snapshot.fonts, root, budget),
          loadImages(collectImageUrls(root), call, budget),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const result = await rasterize(root, { fonts: fonts.css, images });

        if (controller.signal.aborted) {
          return;
        }

        const notes = [];

        if (result.missingImages) {
          notes.push(
            `${result.missingImages} image${result.missingImages === 1 ? '' : 's'} could not be read and ${result.missingImages === 1 ? 'is' : 'are'} left out or shown as gray boxes.`,
          );
        }

        if (fonts.missing) {
          notes.push('Some page fonts could not be loaded; their text uses a fallback font.');
        }

        url = URL.createObjectURL(result.blob);
        setImage({ ...result, url, notes });
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(
            'The image could not be rendered. ' + (e instanceof Error ? e.message : String(e)),
          );
        }
      }
    })();

    // Closing the dialog stops pending downloads.
    return () => {
      controller.abort();

      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [tags, call, snapshot.fonts]);

  // Move focus to Copy when the image is ready, unless the author moved it.
  useEffect(() => {
    if (image && document.activeElement === initialFocus.current) {
      copyButton.current?.focus();
    }
  }, [image]);

  async function copy() {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image!.blob })]);
      setStatus('Copied. Paste it into your pull request or issue.');
    } catch {
      setStatus('The browser did not allow copying. Download the image instead.');
    }
  }

  function download() {
    const name = fileName(snapshot);
    const link = Object.assign(document.createElement('a'), { href: image!.url, download: name });

    document.body.append(link);
    link.click();
    link.remove();
    setStatus(`Downloaded ${name}.`);
  }

  const placed = new Map(tags?.map((tag) => [tag.id, tag]));
  const tagged = tags ? plan.tagged.filter((plane) => placed.has(plane.id)) : plan.tagged;
  const label = (c: Callout) => `${c.number} ${c.name}`;
  const summary = plan.callouts.map((c) => {
    const hidden = c.props.rows.filter((row) => row.hidden).length;
    const masked = c.props.stale.length;

    return (
      label(c) +
      (hidden ? ` (${hidden} hidden)` : '') +
      (masked ? ` (${masked} collection${masked === 1 ? '' : 's'} masked)` : '')
    );
  });

  // The workspace becomes inert while capturing; the dialog stays usable. The
  // composition sits beside the dialog, so it has a layout before and after
  // the dialog opens.
  return createPortal(
    <>
      <dialog
        ref={dialog}
        className="export-dialog"
        aria-labelledby="export-title"
        onClose={onClose}
      >
        <div className="export-dialog-heading">
          <h2 id="export-title">Export image</h2>
          <div className="view-controls" role="group" aria-label="Preview size">
            <button
              className={actualSize ? '' : 'active'}
              aria-pressed={!actualSize}
              onClick={() => setActualSize(false)}
            >
              Fit
            </button>
            <button
              className={actualSize ? 'active' : ''}
              aria-pressed={actualSize}
              title="Show the image at the size a pull request displays it"
              onClick={() => setActualSize(true)}
            >
              100%
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Close export"
            title="Close (Escape)"
            onClick={() => dialog.current?.close()}
          >
            <Glyph type="close" size={14} />
          </button>
        </div>
        <div
          className={'export-preview' + (actualSize ? ' actual-size' : '')}
          aria-busy={!image && !error}
          // A scrollable region must be reachable by keyboard.
          tabIndex={actualSize ? 0 : undefined}
          aria-label={actualSize ? 'Image preview at 100%' : undefined}
        >
          {image ? (
            <img
              src={image.url}
              alt={`Preview: ${path}, with ${tagged.length} named layer${tagged.length === 1 ? '' : 's'}${plan.callouts.length ? ` and props for ${plan.callouts.map((c) => c.name).join(', ')}` : ''}.`}
              width={image.cssWidth}
              height={Math.round((image.height * image.cssWidth) / image.width)}
              // At 100%, the image is shown at its layout size, not its 2x pixels.
              style={actualSize ? { width: image.cssWidth } : undefined}
            />
          ) : error ? (
            <p role="alert">{error}</p>
          ) : (
            <p role="status">Rendering image…</p>
          )}
        </div>
        <div className="export-notes">
          <p>
            {plan.callouts.length
              ? `Props cards: ${summary.join(', ')}.`
              : 'No props cards. To add one, select a component and choose Include in image in its Props section.'}
          </p>
          {plan.callouts.map(
            (c) =>
              drift[c.id] && (
                <p key={c.id} className="export-warning">
                  {label(c)}:{' '}
                  {drift[c.id] === 'changed'
                    ? `props changed after you reviewed them at ${time(c.props.reviewedAt)}.`
                    : `current props could not be read (${drift[c.id]}).`}{' '}
                  The image shows what you reviewed. Select the component to review it again.
                </p>
              ),
          )}
          {plan.callouts.map(
            (c) =>
              !c.props.rows.length && (
                <p key={c.id} className="export-warning">
                  {label(c)}: its props had not loaded when you included it. Select the component to
                  review them, then export again.
                </p>
              ),
          )}
          {plan.callouts.map(
            (c) =>
              c.props.stale.length > 0 && (
                <p key={c.id} className="export-warning">
                  {label(c)}: a collection changed after you hid a value in it, so the image masks
                  it. Select the component to check its hidden values.
                </p>
              ),
          )}
          {leaks.map((number) => (
            <p key={number} className="export-warning">
              {label(plan.callouts[number - 1])}: a hidden value also appears in the page text drawn
              on a layer. Hiding applies to the props card only.
            </p>
          ))}
          {changed && (
            <p className="export-warning">
              The page changed after this capture. Capture again for layers that match the page now.
            </p>
          )}
          {image?.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <p>Check the whole image before sharing: page text in the layers is never hidden.</p>
        </div>
        <div className="export-actions">
          <span className="export-status" role="status">
            {status || (image ? `${image.width} × ${image.height} PNG` : '')}
          </span>
          {canCopy && (
            <button
              ref={copyButton}
              className="standard-button primary"
              disabled={!image}
              onClick={copy}
            >
              <Glyph type="copy" size={13} />
              Copy image
            </button>
          )}
          <button className="standard-button" disabled={!image} onClick={download}>
            <Glyph type="download" size={13} />
            Download PNG
          </button>
        </div>
      </dialog>
      {/* The composition is laid out offscreen, then drawn into the PNG. */}
      <div className="export-offscreen" aria-hidden="true" inert>
        <div ref={composition} className="export-composition" style={{ width: STAGE_WIDTH }}>
          <div
            ref={stageRef}
            className="export-stage"
            style={{ width: plan.stage.width, height: plan.stage.height }}
          >
            <Scene
              planes={view.planes}
              textures={view.textures}
              frame={view.frame}
              scale={plan.scale}
              rotation={view.rotation}
              explode={view.explode}
              distance={view.distance}
              labels={false}
              tints={plan.tints}
              anchors
            />
            {tags && (
              <svg className="export-leaders" width={plan.stage.width} height={plan.stage.height}>
                {tags
                  .filter((tag) => !tag.seated)
                  .map((tag) => {
                    const color = plan.badges.get(tag.id)?.[0].color ?? '#5f6368';

                    return (
                      <g key={tag.id}>
                        <line
                          x1={tag.leader.x}
                          y1={tag.leader.y}
                          x2={tag.anchor.x}
                          y2={tag.anchor.y}
                          stroke={color}
                          strokeWidth="1.5"
                        />
                        <circle
                          cx={tag.anchor.x}
                          cy={tag.anchor.y}
                          r="3.5"
                          fill={color}
                          stroke="#fff"
                          strokeWidth="1.5"
                        />
                      </g>
                    );
                  })}
              </svg>
            )}
            {tagged.map((plane) => {
              const tag = placed.get(plane.id);
              const badges = plan.badges.get(plane.id) ?? [];

              return (
                <div
                  key={plane.id}
                  data-tag={plane.id}
                  className={'export-tag' + (tag?.seated ? ' seated' : '')}
                  style={{
                    ...(tag ? { left: tag.x, top: tag.y } : {}),
                    // Seated tags turn about their bottom-left corner, on the plane's corner.
                    ...(tag?.seated ? { transform: `rotate(${tag.angle}rad)` } : {}),
                    ...(badges.length ? { borderColor: badges[0].color } : {}),
                  }}
                >
                  {badges.map((callout) => (
                    <span
                      key={callout.id}
                      className="export-badge"
                      style={{ background: callout.color }}
                    >
                      {callout.number}
                    </span>
                  ))}
                  {plane.name}
                  {plane.key && <em>{plane.key}</em>}
                </div>
              );
            })}
          </div>
          {plan.callouts.length > 0 && (
            <div className="export-props">
              {plan.callouts.map((callout) => {
                const { rows } = callout.props;

                return (
                  <section
                    key={callout.id}
                    className="export-card"
                    style={{ borderTopColor: callout.color }}
                  >
                    <h3>
                      <span className="export-badge" style={{ background: callout.color }}>
                        {callout.number}
                      </span>
                      {callout.name}
                      {callout.key && <em>{callout.key}</em>}
                    </h3>
                    {!callout.plane && <p className="export-card-note">Not visible in this view</p>}
                    {!rows.length ? (
                      <p className="export-card-note">Props not loaded</p>
                    ) : (
                      <ul>
                        {rows.slice(0, MAX_LINES).map((row, index) => (
                          <li key={index} style={{ marginLeft: row.depth * 14 }}>
                            {row.name && (
                              <>
                                <span className="property-name">{row.name}</span>
                                <span className="property-colon">: </span>
                              </>
                            )}
                            {row.hidden ? (
                              <span className="export-hidden">•••••• hidden</span>
                            ) : row.type === 'stale' ? (
                              <span className="export-hidden">
                                •••••• masked: changed after a value was hidden
                              </span>
                            ) : (
                              <span className={'property-value ' + row.type}>{row.preview}</span>
                            )}
                          </li>
                        ))}
                        {rows.length > MAX_LINES && (
                          <li className="export-hidden">
                            {rows.length - MAX_LINES} more lines not shown
                          </li>
                        )}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          <div className="export-footer">
            <span>{path}</span>
            <span>
              Captured {time(snapshot.capturedAt)}
              {reviewedAt > 0 && ` · Props reviewed ${time(reviewedAt, snapshot.capturedAt)}`} ·
              React Anatomy
            </span>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
