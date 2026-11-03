import type { PageResponses } from '@react-anatomy/extension/inspector/types.ts';
import '@react-anatomy/extension/demo/app.tsx';
import { pageAgent } from '@react-anatomy/extension/inspector/page-agent.ts';

// This bridge lives in the sample's own document. It cannot inspect the visitor's
// other tabs or any arbitrary URL, and does not require extension permissions.
window.anatomyExample = {
  async call(request) {
    return pageAgent(request) as PageResponses[typeof request.action];
  },
};

document.addEventListener(
  'keydown',
  (event) => {
    if (event.key === 'Escape') {
      queueMicrotask(() => window.parent.dispatchEvent(new Event('anatomy-example-cancel-pick')));
    }
  },
  true,
);
