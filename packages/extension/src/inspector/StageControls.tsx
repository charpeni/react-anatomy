import { Glyph } from './Glyph.tsx';

// The bar above the scene: tree and details toggles, and the camera presets.
export function StageHeading({
  title,
  treeHidden,
  showWrappers,
  flat,
  details,
  onToggleTree,
  onToggleWrappers,
  onRotate,
  onReset,
  onToggleDetails,
}: {
  title: string;
  treeHidden: boolean;
  showWrappers: boolean;
  flat: boolean;
  details: boolean;
  onToggleTree: () => void;
  onToggleWrappers: () => void;
  onRotate: (rotation: { x: number; y: number }) => void;
  onReset: () => void;
  onToggleDetails: () => void;
}) {
  return (
    <div className="stage-heading">
      <button
        className="icon-button"
        aria-label="Toggle component tree"
        aria-pressed={!treeHidden}
        title="Toggle component tree"
        onClick={onToggleTree}
      >
        <Glyph type="sidebar" size={15} />
      </button>
      <span className="stage-title">{title}</span>
      <div className="view-controls" aria-label="View orientation">
        <button
          className={showWrappers ? 'active' : ''}
          aria-label="Show wrapper layers"
          aria-pressed={showWrappers}
          title="Give wrappers that share the same DOM output their own planes. All components remain in the tree."
          onClick={onToggleWrappers}
        >
          Wrappers
        </button>
        <span className="toolbar-separator" />
        <button
          className={flat ? 'active' : ''}
          aria-pressed={flat}
          onClick={() => onRotate({ x: 0, y: 0 })}
        >
          Front
        </button>
        <button
          className={flat ? '' : 'active'}
          aria-pressed={!flat}
          onClick={() => onRotate({ x: 24, y: -32 })}
        >
          3D
        </button>
        <span className="toolbar-separator" />
        <button
          className="icon-button"
          aria-label="Reset view"
          title="Reset view (0)"
          onClick={onReset}
        >
          <Glyph type="reset" size={14} />
        </button>
        <button
          className="icon-button details-button"
          aria-label="Toggle component details"
          aria-pressed={details}
          title="Toggle component details"
          onClick={onToggleDetails}
        >
          <Glyph type="sidebarRight" size={15} />
        </button>
      </div>
    </div>
  );
}

// The dock below the scene: how far apart the layers sit and how many are shown.
export function LayerControls({
  separation,
  automaticDepth,
  depth,
  maxDepth,
  revealDepth,
  labels,
  onReveal,
  onSeparation,
  onToggleAutomaticDepth,
  onDepth,
  onLabels,
}: {
  /** Layer separation as a 0–100 percentage. */
  separation: number;
  automaticDepth: boolean;
  depth: number;
  maxDepth: number;
  revealDepth: number;
  labels: boolean;
  onReveal: () => void;
  onSeparation: (separation: number) => void;
  onToggleAutomaticDepth: () => void;
  onDepth: (depth: number) => void;
  onLabels: (labels: boolean) => void;
}) {
  return (
    <div className="control-dock" aria-label="Layer controls">
      <button
        className={'icon-button explode-button ' + (separation ? 'active' : '')}
        aria-label={separation ? 'Assemble' : 'Explode view'}
        aria-pressed={!!separation}
        title={separation ? 'Assemble layers' : 'Explode layers'}
        onClick={onReveal}
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
          value={separation}
          onChange={(e) => onSeparation(+e.target.value)}
        />
        <output>{separation}%</output>
      </label>
      <span className="toolbar-separator" />
      <div className="depth-control">
        <span>Layer depth</span>
        <button
          className={'auto-depth ' + (automaticDepth ? 'active' : '')}
          aria-label="Automatic layer depth"
          aria-pressed={automaticDepth}
          title="Auto explores each visible region. Move the slider to apply one manual depth cutoff across all branches."
          onClick={onToggleAutomaticDepth}
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
          min={0}
          max={maxDepth}
          value={automaticDepth ? revealDepth : Math.min(depth, maxDepth)}
          onChange={(e) => onDepth(+e.target.value)}
        />
        <output>{automaticDepth ? 'Auto' : `${Math.min(depth, maxDepth)}/${maxDepth}`}</output>
      </div>
      <label className="labels-toggle">
        <input type="checkbox" checked={labels} onChange={(e) => onLabels(e.target.checked)} />
        Labels
      </label>
    </div>
  );
}
