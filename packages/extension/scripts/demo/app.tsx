import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import styles from './app.css';

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: styles }));

const initialProjects = [
  {
    id: 'design-system',
    name: 'Design system',
    description: 'Components and foundations for the product.',
    color: '#6d5bd0',
    status: 'In progress',
    progress: 72,
    team: [
      { name: 'Alex Kim', initials: 'AK', role: 'Design' },
      { name: 'Nicolas Charpentier', initials: 'NC', role: 'Engineering' },
    ],
    settings: {
      release: { channel: 'stable', version: '2.4.0' },
      notifications: { enabled: true, channels: ['in-app', 'email'] },
    },
  },
  {
    id: 'customer-portal',
    name: 'Customer portal',
    description: 'A single place for customers to manage their account.',
    color: '#b67835',
    status: 'In review',
    progress: 46,
    team: [
      { name: 'Riley Chen', initials: 'RC', role: 'Engineering' },
      { name: 'Sam Patel', initials: 'SP', role: 'Product' },
    ],
    settings: {
      release: { channel: 'preview', version: '1.8.0' },
      notifications: { enabled: true, channels: ['in-app'] },
    },
  },
  {
    id: 'mobile-app',
    name: 'Mobile app',
    description: 'The essentials, wherever your team is working.',
    color: '#3a8a70',
    status: 'In progress',
    progress: 88,
    team: [
      { name: 'Pier-Luc Brault', initials: 'PLB', role: 'Engineering' },
      { name: 'Alex Kim', initials: 'AK', role: 'Design' },
    ],
    settings: {
      release: { channel: 'stable', version: '3.1.0' },
      notifications: { enabled: false, channels: [] },
    },
  },
];

type Project = (typeof initialProjects)[number];
type CompleteTask = (id: string) => void;

function WorkspaceApp() {
  const [projects, setProjects] = useState(initialProjects);
  const [notification, setNotification] = useState(false);

  function addProject() {
    if (projects.length === 3) {
      setProjects([
        ...projects,
        {
          ...initialProjects[0],
          id: 'documentation',
          name: 'Documentation',
          description: 'Guides and references for the team.',
          color: '#477db3',
          status: 'Planning',
          progress: 12,
        },
      ]);
    }

    setNotification(true);
  }

  function completeTask(id: string) {
    setProjects((previous) =>
      previous.map((p) => (p.id === id ? { ...p, progress: Math.min(100, p.progress + 8) } : p)),
    );
  }

  return (
    <div className="workspace">
      <Sidebar count={projects.length} />
      <MainContent projects={projects} onAddProject={addProject} onCompleteTask={completeTask} />
      {notification && (
        <Notification
          message="Documentation added to your projects."
          onClose={() => setNotification(false)}
        />
      )}
    </div>
  );
}

function Sidebar({ count }: { count: number }) {
  return (
    <aside className="sidebar">
      <WorkspaceSwitcher />
      <Navigation count={count} />
      <UserProfile />
    </aside>
  );
}

function WorkspaceSwitcher() {
  return (
    <div className="workspace-switcher">
      <span className="orbit-mark">o</span>
      <strong>Orbit</strong>
      <span className="chevron">⌄</span>
    </div>
  );
}

function Navigation({ count }: { count: number }) {
  return (
    <nav>
      <span className="nav-heading">Workspace</span>
      <div>Overview</div>
      <div className="selected">
        Projects <span>{count}</span>
      </div>
      <div>My tasks</div>
      <div>Team</div>
      <span className="nav-heading second">Favorites</span>
      <div>
        <i style={{ background: '#6d5bd0' }} />
        Design system
      </div>
      <div>
        <i style={{ background: '#b67835' }} />
        Customer portal
      </div>
    </nav>
  );
}

function UserProfile() {
  return (
    <div className="user-profile">
      <span className="avatar">NC</span>
      <div>
        <b>Nicolas Charpentier</b>
        <small>Engineering team</small>
      </div>
    </div>
  );
}

function MainContent({
  projects,
  onAddProject,
  onCompleteTask,
}: {
  projects: Project[];
  onAddProject: () => void;
  onCompleteTask: CompleteTask;
}) {
  return (
    <main>
      <TopBar />
      <div className="content">
        <PageHeader onAddProject={onAddProject} />
        <ProjectList projects={projects} onCompleteTask={onCompleteTask} />
        <ActivityFeed />
      </div>
    </main>
  );
}

function TopBar() {
  return (
    <div className="topbar">
      <span>
        Workspace <i>/</i> Projects
      </span>
      <span className="sample-note">Sample React app</span>
    </div>
  );
}

function PageHeader({ onAddProject }: { onAddProject: () => void }) {
  return (
    <header>
      <div>
        <h1>Projects</h1>
        <p>What your team is working on.</p>
      </div>
      <button className="new-project" onClick={onAddProject}>
        + New project
      </button>
    </header>
  );
}

function ProjectList({
  projects,
  onCompleteTask,
}: {
  projects: Project[];
  onCompleteTask: CompleteTask;
}) {
  return (
    <section className="project-list">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} onCompleteTask={onCompleteTask} />
      ))}
    </section>
  );
}

function ProjectCard({
  project,
  onCompleteTask,
}: {
  project: Project;
  onCompleteTask: CompleteTask;
}) {
  return (
    <article className="project-card" data-project={project.id}>
      <div className="project-top">
        <span
          className="project-mark"
          style={{ background: project.color + '18', color: project.color }}
        >
          {project.name.slice(0, 1)}
        </span>
        <StatusBadge status={project.status} />
      </div>
      <h2>{project.name}</h2>
      <p>{project.description}</p>
      <ProgressBar progress={project.progress} color={project.color} />
      <div className="project-bottom">
        <AvatarStack people={project.team} />
        <button className="complete-task" onClick={() => onCompleteTask(project.id)}>
          Complete task
        </button>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className="status-badge">{status}</span>;
}

function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <div className="progress">
      <div>
        <span>Progress</span>
        <b>{progress}%</b>
      </div>
      <div className="progress-track">
        <i style={{ width: progress + '%', background: color }} />
      </div>
    </div>
  );
}

function AvatarStack({ people }: { people: Project['team'] }) {
  return (
    <div className="avatar-stack">
      {people.map((person) => (
        <span className="avatar" key={person.name} title={person.name}>
          {person.initials}
        </span>
      ))}
    </div>
  );
}

function ActivityFeed() {
  return (
    <section className="activity">
      <h2>Recent activity</h2>
      <ActivityItem
        person="Steve Bourgoin"
        initials="SB"
        action="updated the button components"
        time="12 min ago"
      />
      <ActivityItem
        person="Pier-Luc Brault"
        initials="PLB"
        action="completed the onboarding flow"
        time="38 min ago"
      />
    </section>
  );
}

function ActivityItem({
  person,
  initials,
  action,
  time,
}: {
  person: string;
  initials: string;
  action: string;
  time: string;
}) {
  return (
    <div className="activity-item">
      <span className="avatar">{initials}</span>
      <span>
        <b>{person}</b> {action}
      </span>
      <small>{time}</small>
    </div>
  );
}

function Notification({ message, onClose }: { message: string; onClose: () => void }) {
  return createPortal(
    <div className="notification" role="status">
      <span>✓</span>
      <div>
        <b>Project created</b>
        <p>{message}</p>
      </div>
      <button onClick={onClose} aria-label="Dismiss notification">
        ×
      </button>
    </div>,
    document.getElementById('portal')!,
  );
}

createRoot(document.getElementById('app')!).render(<WorkspaceApp />);
