import { createRoot } from 'react-dom/client';
import { DeskApp } from './DeskApp.tsx';
import styles from './desk.css';

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: styles }));
createRoot(document.getElementById('app')!).render(<DeskApp />);
