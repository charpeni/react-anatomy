'use client';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';

function Counter({ count, onIncrement }: { count: number; onIncrement: () => void }) {
  return (
    <button data-check="counter" onClick={onIncrement}>
      Reviewed {count} times
    </button>
  );
}
function Modal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <section role="dialog" aria-label="Issue details">
      <p>Client portal</p>
      <button data-check="close" onClick={onClose}>
        Close
      </button>
    </section>,
    document.body,
  );
}
export default function Review({
  issue,
}: {
  issue: { id: number; title: string; owner: { name: string; team: string } };
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  return (
    <article data-check="issue" data-react-version={React.version}>
      <h2>{issue.title}</h2>
      <p>
        {issue.owner.name} · {issue.owner.team}
      </p>
      <Counter count={count} onIncrement={() => setCount((value) => value + 1)} />
      <button data-check="open" onClick={() => setOpen(true)}>
        Details
      </button>
      {open && <Modal onClose={() => setOpen(false)} />}
    </article>
  );
}
