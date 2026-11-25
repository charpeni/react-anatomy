import React, { useRef, useState } from 'react';
import type { ComponentNode, PageCall } from './types.ts';

interface ContextProps {
  id: string;
  documentId?: string;
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
  path,
  childrenNames,
  partial,
  call,
}: ContextProps) {
  const [open, setOpen] = useState(false);
  const [propPath, setPropPath] = useState('');
  const [prop, setProp] = useState('');
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState('');
  const preview = useRef<HTMLTextAreaElement>(null);
  const revision = useRef(0);

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
    setProp('');
    setReading(false);
    setMessage('');
  }

  async function includeProp(event: React.FormEvent) {
    event.preventDefault();
    const name = propPath.trim();
    if (!name || reading) {
      return;
    }
    const request = ++revision.current;
    setReading(true);
    setProp('');
    setMessage('');
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
      setProp('Prop ' + name + ' (' + result.type + '): ' + result.preview);
    } catch (error) {
      if (request === revision.current) {
        setMessage(error instanceof Error ? error.message : 'Could not read this prop.');
      }
    } finally {
      if (request === revision.current) {
        setReading(false);
      }
    }
  }

  async function copy() {
    const field = preview.current;
    if (!field) {
      return;
    }

    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
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
