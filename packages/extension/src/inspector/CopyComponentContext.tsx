import React, { useLayoutEffect, useRef, useState } from 'react';
import type { ComponentNode, PageCall } from './types.ts';

interface ContextProps {
  id: string;
  documentId?: string;
  capturedAt: number;
  path: Pick<ComponentNode, 'name' | 'key'>[];
  childrenNames: string[];
  partial: boolean;
  call: PageCall;
}

function instanceLabel(node: ContextProps['path'][number]) {
  return node.key == null ? node.name : node.name + ' [key=' + JSON.stringify(node.key) + ']';
}

export function CopyComponentContext({
  id,
  documentId,
  capturedAt,
  path,
  childrenNames,
  partial,
  call,
}: ContextProps) {
  const [open, setOpen] = useState(false);
  const [propPath, setPropPath] = useState('');
  // A null line is a pending read. A missing read means no prop was requested.
  const [read, setRead] = useState<{ capturedAt: number; line: string | null } | null>(null);
  const [feedback, setFeedback] = useState<{ capturedAt: number; text: string } | null>(null);
  const preview = useRef<HTMLTextAreaElement>(null);
  const revision = useRef(0);

  useLayoutEffect(() => {
    // Discard any pending read or clipboard response from the previous capture.
    revision.current++;
  }, [capturedAt]);

  const stale = read !== null && read.capturedAt !== capturedAt;
  const prop = stale ? null : read?.line;
  const reading = !stale && read?.line === null;
  const message =
    feedback?.capturedAt === capturedAt
      ? feedback.text
      : stale
        ? 'Page recaptured. Choose Include prop to refresh its value.'
        : '';

  function setMessage(text: string) {
    setFeedback({ capturedAt, text });
  }

  const lines = [
    'Component: ' + instanceLabel(path[path.length - 1]),
    'Path: ' + (path.length > 12 ? '… → ' : '') + path.slice(-12).map(instanceLabel).join(' → '),
    'Rendered children: ' +
      (childrenNames.slice(0, 8).join(', ') || (partial ? 'none captured' : 'none')),
  ];
  if (partial || childrenNames.length > 8) {
    lines.push('Child list may be incomplete.');
  }
  if (prop) {
    lines.push(prop);
  }
  const text = lines.join('\n');

  function changePath(next: string) {
    revision.current++;
    setPropPath(next);
    setRead(null);
    setFeedback(null);
  }

  async function includeProp(event: React.FormEvent) {
    event.preventDefault();
    const name = propPath.trim();
    if (!name || reading) {
      return;
    }
    const request = ++revision.current;
    setRead({ capturedAt, line: null });
    setFeedback(null);
    try {
      const result = await call({
        action: 'prop-preview',
        id,
        document: documentId,
        path: name.split('.'),
      });
      if (request !== revision.current) {
        return;
      }
      if (!result.ok) {
        throw new Error(result.message);
      }
      setRead({ capturedAt, line: 'Prop ' + name + ' (' + result.type + '): ' + result.preview });
    } catch (error) {
      if (request === revision.current) {
        setRead(null);
        setMessage(error instanceof Error ? error.message : 'Could not read this prop.');
      }
    }
  }

  async function copy() {
    const field = preview.current;
    if (!field) {
      return;
    }
    const copiedRevision = revision.current;

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        if (copiedRevision !== revision.current) {
          return;
        }
      } else {
        // HTTP previews on a local network lack the asynchronous Clipboard API.
        field.focus();
        field.select();
        if (!document.execCommand('copy')) {
          setMessage('Preview selected. Press Ctrl+C or ⌘C to copy.');
          return;
        }
      }
      setMessage('Copied component context.');
    } catch {
      if (copiedRevision !== revision.current) {
        return;
      }
      field.focus();
      field.select();
      setMessage('Preview selected. Press Ctrl+C or ⌘C to copy.');
    }
  }

  return (
    <section className="component-context">
      <button className="standard-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        Copy component context
      </button>
      {open && (
        <div className="component-context-form">
          <form onSubmit={includeProp}>
            <label>
              Optional prop path
              <input
                value={propPath}
                placeholder="e.g. project.progress"
                onChange={(e) => changePath(e.target.value)}
              />
            </label>
            <button className="standard-button" disabled={!propPath.trim() || reading}>
              {reading ? 'Reading…' : 'Include prop'}
            </button>
          </form>
          <label>
            Text to copy
            <textarea ref={preview} readOnly rows={6} value={text} />
          </label>
          <div className="component-context-actions">
            <button className="standard-button" disabled={reading} onClick={copy}>
              Copy text
            </button>
            {prop && <button onClick={() => changePath('')}>Remove prop</button>}
          </div>
          <span role="status">{message}</span>
        </div>
      )}
    </section>
  );
}
