import { createRoot } from 'react-dom/client';
import { BillingApp } from './BillingApp.tsx';
import styles from './billing.css';

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: styles }));
createRoot(document.getElementById('app')!).render(<BillingApp />);
