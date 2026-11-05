import React from 'react';
import { createRoot } from 'react-dom/client';

function recordConstructor() {
  const count = Number(document.documentElement.dataset.constructors || 0);
  document.documentElement.dataset.constructors = String(count + 1);
}

customElements.define(
  'fixture-time',
  class extends HTMLElement {
    constructor() {
      super();
      recordConstructor();
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = 'span{color:rgb(145,152,161);font-weight:500}';
      const text = document.createElement('span');
      text.textContent = '2 days ago';
      shadow.append(style, text);
    }
  },
);

customElements.define(
  'fixture-search',
  class extends HTMLInputElement {
    constructor() {
      super();
      recordConstructor();
    }
  },
  { extends: 'input' },
);

customElements.define(
  'fixture-label',
  class extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      const slot = document.createElement('slot');
      slot.name = 'label';
      shadow.appendChild(slot);
    }
  },
);

const style = document.createElement('style');
style.textContent = `
  *{box-sizing:border-box}body{margin:24px;background:#0d1117;color:#f0f6fc;font:16px Arial,sans-serif}
  main{width:900px}input{width:400px;height:36px;padding:6px 12px;margin-bottom:16px;background:#0d1117;color:#f0f6fc;border:1px solid #3d444d}
  table{width:900px;border-collapse:collapse;table-layout:fixed}td{padding:10px 16px;border-bottom:1px solid #3d444d;height:42px}
  td:first-child{width:240px}td:nth-child(2){width:480px}td:last-child{width:180px;text-align:right}
  p{margin:0}fixture-time{display:inline}fixture-label{display:inline-block;margin-bottom:12px}
`;
document.head.appendChild(style);

function Timestamp() {
  return React.createElement('fixture-time', { dateTime: '2026-11-03' }, 'Nov 3, 2026');
}

function DateCell() {
  return (
    <td>
      <p>
        <Timestamp />
      </p>
    </td>
  );
}

function Row({ name }: { name: string }) {
  return (
    <tr>
      <td>{name}</td>
      <td>Initial commit</td>
      <DateCell />
    </tr>
  );
}

function Files() {
  return (
    <table>
      <tbody>
        <Row name="README.md" />
        <Row name="package.json" />
      </tbody>
    </table>
  );
}

function Search() {
  return <input is="fixture-search" placeholder="Go to file" aria-label="Go to file" />;
}

function App() {
  return (
    <main>
      {React.createElement(
        'fixture-label',
        {},
        <span slot="label">Visible branch</span>,
        <span>Unassigned hidden text</span>,
      )}
      <div>
        <Search />
      </div>
      <Files />
    </main>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
