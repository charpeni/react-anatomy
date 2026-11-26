import { useCallback, useState } from 'react';
import { Frame } from './Frame.tsx';
import { Insights } from './Insights.tsx';
import { Queue } from './Queue.tsx';
import { initialTickets } from './data.ts';

// The origin of every prop the trace fixture follows. Nothing here receives
// props, so each trace that starts below ends in this component.
export function DeskApp() {
  const [tickets, setTickets] = useState(initialTickets);
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [revision, setRevision] = useState(1);
  const resolveTicket = useCallback((id: string) => {
    setTickets((list) =>
      list.map((ticket) => (ticket.id === id ? { ...ticket, resolved: true } : ticket)),
    );
  }, []);

  return (
    <main className="desk">
      <header className="desk-header">
        <h1>Support desk</h1>
        <button onClick={() => setRevision((value) => value + 1)}>Refresh queue</button>
        <button
          onClick={() => setDensity((value) => (value === 'compact' ? 'comfortable' : 'compact'))}
        >
          Toggle density
        </button>
      </header>
      <Queue
        title="Open tickets"
        tickets={tickets}
        onResolve={resolveTicket}
        density={density}
        revision={revision}
        auditTag="desk-2026"
      />
      <Insights tickets={tickets} revision={revision} helpUrl="https://example.test/help" />
      <Frame depth={1} label="Outer frame" />
    </main>
  );
}
