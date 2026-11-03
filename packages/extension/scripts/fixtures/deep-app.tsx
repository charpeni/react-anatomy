import React from 'react';
import { createRoot } from 'react-dom/client';

// Deliberately minified production app, without a React DevTools hook. Each
// wrapper has its own Fiber, but contributes no additional DOM to the page.
const parameters = new URLSearchParams(location.search);
const wrapperCount = Number(parameters.get('wrappers')) || 65;
const wrappers = Array.from(
  { length: Math.max(65, wrapperCount) },
  () =>
    function ({ children }: { children: React.ReactNode }) {
      return children;
    },
);

function wrap(content: React.ReactNode, count = wrapperCount) {
  return wrappers
    .slice(0, count)
    .reduceRight<React.ReactNode>((child, Wrapper) => <Wrapper>{child}</Wrapper>, content);
}

function Sidebar() {
  return (
    <nav data-region="sidebar">
      <h2>Workspace</h2>
      <p>Projects</p>
      <p>People</p>
    </nav>
  );
}

function Badge({ status }: { status: string }) {
  return <span data-region="badge">{status}</span>;
}

function Card({ title }: { title: string }) {
  return (
    <article data-region="card">
      <h3>{title}</h3>
      <p>A distinct React component</p>
      {wrap(<Badge status="In progress" />, 8)}
    </article>
  );
}

const projectCount = parameters.has('large') ? 160 : Number(parameters.get('projects'));
const titles = projectCount
  ? Array.from({ length: projectCount }, (_, i) => `Project ${i}`)
  : ['Website', 'Mobile app', 'Design system'];

function List() {
  return (
    <section data-region="list">
      <h2>Projects</h2>
      {titles.map((title) => wrap(<Card key={title} title={title} />, 8))}
    </section>
  );
}

function Details() {
  return (
    <aside data-region="details">
      <h2>Activity</h2>
      <p>Three projects updated</p>
    </aside>
  );
}

function App() {
  return (
    <main data-region="app">
      {wrap(<Sidebar />, 12)}
      {wrap(<List />, 12)}
      {wrap(<Details />, 12)}
    </main>
  );
}

const style = document.createElement('style');

style.textContent =
  '*{box-sizing:border-box}body{margin:0;font:16px system-ui;color:#202124;background:#f5f6f8}main{display:grid;grid-template-columns:220px 1fr 260px;gap:24px;padding:24px;min-height:650px}nav,aside{background:#e9edf3;padding:20px}section{padding:0 20px}article{padding:16px;margin:14px 0;background:white;border:1px solid #ccd3de;border-radius:8px}h2,h3{margin:0 0 16px}span{display:inline-block;color:#176347;background:#e4f5ec;padding:4px 8px;border-radius:4px}';
document.head.appendChild(style);
createRoot(document.getElementById('app')!).render(wrap(<App />));
