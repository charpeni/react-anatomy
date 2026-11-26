import type { Ticket } from './data.ts';
import { QueueFooter } from './QueueFooter.tsx';
import { TicketRow } from './TicketRow.tsx';
import { formatDue } from './data.ts';

interface QueueProps {
  title: string;
  tickets: Ticket[];
  onResolve: (id: string) => void;
  density: 'comfortable' | 'compact';
  revision: number;
  auditTag: string;
}

// A relay. It uses `title` and `tickets` itself, renames `onResolve`, and only
// passes `density`, `revision`, and `auditTag` along.
export function Queue({ title, tickets, onResolve, density, revision, auditTag }: QueueProps) {
  return (
    <section className="queue" aria-label={title}>
      <QueueHeader title={title} count={tickets.length} />
      {tickets.map((ticket) => (
        <TicketRow
          key={ticket.id}
          ticket={ticket}
          onDismiss={onResolve}
          density={density}
          auditTag={auditTag}
          dueLabel={formatDue(ticket)}
          ownerName={ticket.owner.name}
        />
      ))}
      <QueueFooter density={density} revision={revision} />
    </section>
  );
}

function QueueHeader({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="queue-header">
      {title} <span>{count}</span>
    </h2>
  );
}
