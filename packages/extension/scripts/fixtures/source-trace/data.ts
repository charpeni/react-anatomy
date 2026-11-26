export interface Ticket {
  id: string;
  subject: string;
  priority: 'low' | 'normal' | 'urgent';
  owner: { name: string; team: string };
  dueInHours: number;
  updated: string;
  resolved: boolean;
}

export const initialTickets: Ticket[] = [
  {
    id: 'T-1042',
    subject: 'Export to CSV drops the last row',
    priority: 'urgent',
    owner: { name: 'Mina Okafor', team: 'Data' },
    dueInHours: 3,
    updated: '09:12',
    resolved: false,
  },
  {
    id: 'T-1047',
    subject: 'Invoice email uses the old logo',
    priority: 'normal',
    owner: { name: 'Jonas Weber', team: 'Billing' },
    dueInHours: 26,
    updated: '08:40',
    resolved: false,
  },
  {
    id: 'T-1051',
    subject: 'Keyboard focus is lost after closing a dialog',
    priority: 'low',
    owner: { name: 'Priya Raman', team: 'Web' },
    dueInHours: 70,
    updated: 'Yesterday',
    resolved: false,
  },
];

export function formatDue(ticket: Ticket) {
  if (ticket.resolved) {
    return 'Resolved';
  }

  return ticket.dueInHours < 24
    ? `Due in ${ticket.dueInHours} h`
    : `Due in ${Math.round(ticket.dueInHours / 24)} d`;
}

export function chipOptions(ticket: Ticket) {
  return ticket.priority === 'urgent' ? { tone: 'alert', title: 'On call' } : { tone: 'calm' };
}
