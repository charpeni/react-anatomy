import type { ComponentNode, ImageProps, PageCall } from './types.ts';
import { Glyph } from './Glyph.tsx';
import { CopyComponentContext } from './CopyComponentContext.tsx';
import { PropsInspector } from './PropsInspector.tsx';

// The details pane for the selected component: actions on the page, live
// props, measured layout, and the chain of components above it.
export function ComponentDetails({
  node,
  path,
  contextPrefix,
  childNames,
  documentId,
  capturedAt,
  warnings,
  call,
  canInspect,
  image,
  onImage,
  onFocus,
  onAction,
  onSelect,
  onClose,
}: {
  node: ComponentNode;
  path: ComponentNode[];
  contextPrefix?: Pick<ComponentNode, 'name' | 'key'>[];
  childNames: string[];
  documentId?: string;
  capturedAt: number;
  warnings: string[];
  call: PageCall;
  canInspect: boolean;
  image?: ImageProps;
  onImage: (image: ImageProps) => void;
  onFocus: (id: string) => void;
  onAction: (action: 'inspect' | 'highlight', id: string) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <aside className="inspector" aria-label="Component details">
      <div className="inspector-heading">
        <Glyph type="component" size={14} />
        <h2>{node.name}</h2>
        <button
          className="icon-button close-details"
          aria-label="Close component details"
          onClick={onClose}
        >
          <Glyph type="close" size={14} />
        </button>
      </div>
      <div className="inspector-actions">
        <button
          className="focus-button"
          aria-label="Focus subtree"
          title="Focus this component and its children (F)"
          onClick={() => onFocus(node.id)}
        >
          <Glyph type="target" size={13} />
          Focus subtree
        </button>
        <span className="toolbar-separator" />
        <button
          className="icon-button"
          aria-label="Highlight on page"
          title="Highlight on page"
          onClick={() => onAction('highlight', node.id)}
          disabled={!node.hosts.length}
        >
          <Glyph type="eye" size={14} />
        </button>
        {canInspect && (
          <button
            className="icon-button"
            aria-label="Reveal in Elements"
            title="Reveal in Elements"
            onClick={() => onAction('inspect', node.id)}
            disabled={!node.hosts.length}
          >
            <Glyph type="code" size={15} />
          </button>
        )}
      </div>
      <div className="inspector-scroll">
        <CopyComponentContext
          key={(documentId ?? capturedAt) + ':' + node.id}
          id={node.id}
          documentId={documentId}
          path={[...(contextPrefix ?? []), ...path]}
          childrenNames={childNames}
          partial={!!node.hasMore}
          call={call}
        />
        <PropsInspector
          key={node.id}
          componentId={node.id}
          capturedAt={capturedAt}
          call={call}
          image={image}
          onImage={onImage}
        />
        <details className="inspector-section" open>
          <summary>Layout</summary>
          <div className="section-body">
            <dl>
              <dt>Width × height</dt>
              <dd>
                {node.bounds ? `${Math.round(node.bounds.w)} × ${Math.round(node.bounds.h)}` : '—'}
              </dd>
              <dt>Depth</dt>
              <dd>{node.depth}</dd>
              <dt>Children</dt>
              <dd>{node.children.length}</dd>
              <dt>DOM roots</dt>
              <dd>{node.hosts.length}</dd>
              {node.key && (
                <>
                  <dt>Key</dt>
                  <dd className="instance-name">{node.key}</dd>
                </>
              )}
            </dl>
            <div className="component-kind">
              {node.hosts.length > 1
                ? 'Multiple DOM roots'
                : node.hosts.length
                  ? 'React component'
                  : 'No DOM output'}
              {node.portal ? ' · portal' : ''}
            </div>
          </div>
        </details>
        <details className="inspector-section" open>
          <summary>Component stack</summary>
          <div className="ownership">
            {path
              .slice()
              .reverse()
              .map((n, i) => (
                <button
                  key={n.id}
                  className={n.id === node.id ? 'current' : ''}
                  onClick={() => onSelect(n.id)}
                >
                  <Glyph type={i ? 'chevron' : 'component'} size={11} />
                  {n.name}
                </button>
              ))}
          </div>
        </details>
        {!!warnings.length && (
          <details className="inspector-section capture-notes">
            <summary>Capture notes ({warnings.length})</summary>
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </aside>
  );
}
