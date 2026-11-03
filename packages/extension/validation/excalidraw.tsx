declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string;
  }
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
document.documentElement.dataset.reactVersion = React.version;
document.body.style.margin = '0';

function Editor() {
  return (
    <div style={{ height: '100vh' }}>
      <Excalidraw
        initialData={{
          elements: convertToExcalidrawElements([
            {
              type: 'rectangle',
              x: 240,
              y: 180,
              width: 240,
              height: 140,
              label: { text: 'Component layout' },
            },
          ]),
          appState: { viewBackgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        }}
      />
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<Editor />);
