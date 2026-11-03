import React from 'react';
import { createRoot } from 'react-dom/client';

function NavItem({ label }: { label: string }) {
  return <div className="nav-item">{label}</div>;
}

function Sidebar() {
  return (
    <nav>
      <h2>Workspace</h2>
      {['New chat', 'Projects', 'People', 'Library'].map((label) => (
        <NavItem key={label} label={label} />
      ))}
    </nav>
  );
}

function Header() {
  return (
    <header>
      Weekly project update <button>Share</button>
    </header>
  );
}

function MessageCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article>
      <h2>{title}</h2>
      <p>{children}</p>
    </article>
  );
}

function Composer() {
  return (
    <footer>
      <input placeholder="Write a message" />
      <button>Send</button>
    </footer>
  );
}

function Conversation() {
  return (
    <section className="conversation">
      <div className="messages">
        <MessageCard title="Weekly update">
          The application has a shallow sidebar and a much deeper main content branch.
        </MessageCard>
        <MessageCard title="Project status">
          These cards should have their own planes without adjusting a depth slider.
        </MessageCard>
        <MessageCard title="Next steps">
          Explore the main layout, then inspect individual components.
        </MessageCard>
      </div>
      <Composer />
    </section>
  );
}

// These shells own DIFFERENT DOM elements, so the exact-output wrapper merge
// must not combine them. Routers, scroll containers and UI libraries commonly
// introduce this kind of unequal depth between neighboring visual regions.
function ContentBoundary({ children }: { children: React.ReactNode }) {
  return <div className="content-boundary">{children}</div>;
}

function MainLayout() {
  let content = <Conversation />;

  for (let i = 0; i < 8; i++) {
    content = <ContentBoundary>{content}</ContentBoundary>;
  }

  return (
    <main>
      <Header />
      <div className="content">{content}</div>
    </main>
  );
}

function App() {
  return (
    <div className="app">
      <Sidebar />
      <MainLayout />
    </div>
  );
}

const style = document.createElement('style');

style.textContent =
  '*{box-sizing:border-box}body{margin:0;font:16px system-ui;color:#29313b;background:#eef1f5}.app{display:grid;grid-template-columns:220px 1fr;height:900px}nav{padding:24px;background:#e4e8ee}h2{font-size:17px;margin:0 0 18px}.nav-item{padding:14px 0}main{display:flex;flex-direction:column;min-height:0}header{display:flex;justify-content:space-between;align-items:center;background:white;border-bottom:1px solid #ccc;padding:20px}.content{flex:1;min-height:0}.content-boundary,.conversation{height:100%}.conversation{display:flex;flex-direction:column;padding:30px 60px}.messages{flex:1}article{background:white;border:1px solid #d5dbe4;border-radius:8px;padding:22px;margin-bottom:24px}footer{display:flex;gap:12px;background:white;padding:18px;border:1px solid #ccd3dc;border-radius:8px}input{flex:1;padding:12px;border:1px solid #ccd3dc}button{padding:8px 18px}';
document.head.appendChild(style);
createRoot(document.getElementById('app')!).render(<App />);
