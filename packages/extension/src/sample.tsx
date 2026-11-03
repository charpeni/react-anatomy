import React from 'react';

const projects = [
  {
    name: 'Orbit design system',
    short: 'Or',
    color: '#8d79d7',
    description: 'A shared language for everything we build.',
    progress: 72,
    count: '18 / 25',
    people: ['JS', 'AK', 'ML'],
    tag: 'Design',
  },
  {
    name: 'Customer portal',
    short: 'Cp',
    color: '#ca8f59',
    description: 'Make every customer feel at home.',
    progress: 46,
    count: '11 / 24',
    people: ['RP', 'JS'],
    tag: 'Product',
  },
  {
    name: 'Mobile experience',
    short: 'Mx',
    color: '#639f8e',
    description: 'Your workspace, wherever you are.',
    progress: 88,
    count: '22 / 25',
    people: ['ML', 'AK', 'RP'],
    tag: 'Engineering',
  },
];

export function WorkspaceApp() {
  return (
    <div className="sample-app">
      <Sidebar />
      <MainContent />
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sample-sidebar">
      <WorkspaceSwitcher />
      <Navigation />
      <div className="side-bottom">
        <span className="tiny-square">?</span> Help & getting started
      </div>
      <UserProfile />
    </aside>
  );
}

function WorkspaceSwitcher() {
  return (
    <div className="workspace-switcher">
      <span className="orbit-logo">o</span>
      <b>Orbit Studio</b>
      <span className="dim">⌄</span>
    </div>
  );
}

function Navigation() {
  return (
    <nav className="sample-nav">
      <p>WORKSPACE</p>
      <div>
        <span>◫</span> Overview
      </div>
      <div className="active">
        <span>▧</span> Projects <small>6</small>
      </div>
      <div>
        <span>☷</span> My tasks <small>12</small>
      </div>
      <div>
        <span>◷</span> Activity
      </div>
      <div>
        <span>♧</span> Team
      </div>
      <p className="second-label">
        FAVORITES <span>+</span>
      </p>
      <div>
        <i style={{ background: '#9c8acb' }} /> Design system
      </div>
      <div>
        <i style={{ background: '#b98d64' }} /> Customer portal
      </div>
      <div>
        <i style={{ background: '#73a292' }} /> Mobile experience
      </div>
    </nav>
  );
}

function UserProfile() {
  return (
    <div className="user-profile">
      <span className="avatar lavender">JS</span>
      <div>
        <b>Jamie Sullivan</b>
        <small>Personal account</small>
      </div>
      <span className="dim">⌄</span>
    </div>
  );
}

function MainContent() {
  return (
    <main className="sample-main">
      <TopBar />
      <div className="main-body">
        <PageHeader />
        <StatsOverview />
        <ProjectSection />
        <ActivityFeed />
      </div>
    </main>
  );
}

function TopBar() {
  return (
    <div className="sample-topbar">
      <span>
        Workspace <i>/</i> <b>Projects</b>
      </span>
      <div>
        <span className="search-hint">
          ⌕ &nbsp; Search anything… <kbd>⌘ K</kbd>
        </span>
        <span className="notification">♧</span>
        <span className="avatar mini">JS</span>
      </div>
    </div>
  );
}

function PageHeader() {
  return (
    <header className="sample-pageheader">
      <div>
        <span className="eyebrow">A LITTLE FOCUS GOES A LONG WAY</span>
        <h1>
          Good morning, Jamie <span>✳</span>
        </h1>
        <p>Here’s what’s happening with your projects today.</p>
      </div>
      <button className="new-project">+ &nbsp; New project</button>
    </header>
  );
}

function StatsOverview() {
  return (
    <section className="stats-overview">
      <StatCard label="Active projects" value="6" detail="2 launching this month" symbol="▧" />
      <StatCard label="Tasks completed" value="51" detail="↑ 12% from last week" symbol="✓" />
      <StatCard label="Team members" value="8" detail="Across 3 time zones" symbol="♧" />
    </section>
  );
}

function StatCard({
  label,
  value,
  detail,
  symbol,
}: {
  label: string;
  value: string;
  detail: string;
  symbol: string;
}) {
  return (
    <div className="stat-card">
      <div>
        {label}
        <span>{symbol}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ProjectSection() {
  return (
    <section className="project-section">
      <div className="section-title">
        <h2>
          Your projects <span>6</span>
        </h2>
        <div>
          All projects <span>↗</span>
        </div>
      </div>
      <ProjectGrid />
    </section>
  );
}

function ProjectGrid() {
  return (
    <div className="project-grid">
      {projects.map((p) => (
        <ProjectCard key={p.name} project={p} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: (typeof projects)[number] }) {
  return (
    <article className="project-card">
      <div
        className="project-icon"
        style={{ background: project.color + '20', color: project.color }}
      >
        {project.short}
        <span>···</span>
      </div>
      <h3>{project.name}</h3>
      <p>{project.description}</p>
      <span className="project-tag">{project.tag}</span>
      <ProgressBar progress={project.progress} count={project.count} color={project.color} />
      <div className="project-footer">
        <AvatarStack people={project.people} />
        <span>Due Nov 14</span>
      </div>
    </article>
  );
}

function ProgressBar({
  progress,
  count,
  color,
}: {
  progress: number;
  count: string;
  color: string;
}) {
  return (
    <div className="progress-bar">
      <div>
        <span>Progress</span>
        <b>{count}</b>
      </div>
      <div className="progress-track">
        <i style={{ width: progress + '%', background: color }} />
      </div>
    </div>
  );
}

function AvatarStack({ people }: { people: string[] }) {
  return (
    <div className="avatar-stack">
      {people.map((p, i) => (
        <span key={p} className={'avatar mini tone-' + i}>
          {p}
        </span>
      ))}
    </div>
  );
}

function ActivityFeed() {
  return (
    <section className="activity-feed">
      <div className="section-title">
        <h2>Recent activity</h2>
        <span>View all ↗</span>
      </div>
      <ActivityItem
        initials="AK"
        name="Alex Kim"
        action="updated"
        subject="Button components"
        time="12 min ago"
      />
      <ActivityItem
        initials="ML"
        name="Morgan Lee"
        action="completed"
        subject="Onboarding flow"
        time="38 min ago"
      />
    </section>
  );
}

function ActivityItem({
  initials,
  name,
  action,
  subject,
  time,
}: {
  initials: string;
  name: string;
  action: string;
  subject: string;
  time: string;
}) {
  return (
    <div className="activity-item">
      <span className="avatar mini">{initials}</span>
      <span>
        <b>{name}</b> {action} <b>{subject}</b>
      </span>
      <small>{time}</small>
    </div>
  );
}
