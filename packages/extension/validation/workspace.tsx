import React, { Component, StrictMode, createContext, memo, useContext, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import './workspace.css';

const Team = createContext('Engineering');
const issue = {
  id: 42,
  title: 'Document the component layout',
  owner: { name: 'Nicolas', team: 'Engineering' },
};

class Boundary extends Component<React.PropsWithChildren> {
  render() {
    return this.props.children;
  }
}

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
      <h2>Issue details</h2>
      <p>Portal owned by the issue card.</p>
      <button data-check="close" onClick={onClose}>
        Close
      </button>
    </section>,
    document.body,
  );
}

type Issue = typeof issue;

const IssueCard = memo(function IssueCard({ issue }: { issue: Issue }) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const team = useContext(Team);

  return (
    <article data-check="issue">
      <h2>{issue.title}</h2>
      <p>
        {issue.owner.name} · {team}
      </p>
      <Counter count={count} onIncrement={() => setCount((value) => value + 1)} />
      <button data-check="open" onClick={() => setOpen(true)}>
        Details
      </button>
      {open && <Modal onClose={() => setOpen(false)} />}
    </article>
  );
});

function Board() {
  return (
    <section>
      <h1>Component review board</h1>
      <IssueCard issue={issue} />
    </section>
  );
}

function Settings() {
  return (
    <section data-check="settings">
      <h1>Workspace settings</h1>
      <p>Client-side navigation has completed.</p>
    </section>
  );
}

function Workspace() {
  return (
    <Team.Provider value="Engineering">
      <Boundary>
        <div className="workspace">
          <aside>
            <h2>Engineering</h2>
            <Link to="/" data-check="board-link">
              Board
            </Link>
            <Link to="/settings" data-check="settings-link">
              Settings
            </Link>
          </aside>
          <main>
            <Routes>
              <Route path="/" element={<Board />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </Boundary>
    </Team.Provider>
  );
}

document.documentElement.dataset.reactVersion = React.version;
createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <BrowserRouter basename={document.body.dataset.base}>
      <Workspace />
    </BrowserRouter>
  </StrictMode>,
);
