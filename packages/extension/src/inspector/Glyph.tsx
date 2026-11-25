import React from 'react';

export function Glyph({ type = 'layers', size = 18 }: { type?: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    pick: (
      <>
        <path d="M9 3H3v6m12-6h6v6M3 15v6h6" />
        <path d="m10 10 10 4-5 1-1 5-4-10Z" />
      </>
    ),
    component: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="1" />
        <path d="M8 8h8M8 12h5M8 16h8" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    collapse: (
      <>
        <path d="M8 3h13v13M3 8h13v13H3zM6 14h7" />
      </>
    ),
    sidebar: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M9 4v16" />
      </>
    ),
    sidebarRight: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <path d="M15 4v16" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    back: <path d="m10 5-7 7 7 7M3 12h18" />,
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    cube: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z" />
        <path d="m3 7 9 5 9-5M12 12v10M7 4.8l9 5" />
      </>
    ),
    target: (
      <>
        <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    reset: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" />
      </>
    ),
    code: (
      <>
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-2.9 3.7M6.6 6.6C3.8 8.3 2 12 2 12s4 7 10 7c1.8 0 3.4-.6 4.7-1.4" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <circle cx="9" cy="10" r="2" />
        <path d="m21 16-5-5-9 9" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="1" />
        <path d="M16 8V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h4" />
      </>
    ),
    download: <path d="M12 3v12m-5-5 5 5 5-5M4 21h16" />,
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </>
    ),
    arrow: <path d="m9 5 7 7-7 7" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14m-7-7v14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[type] || paths.layers}
    </svg>
  );
}
