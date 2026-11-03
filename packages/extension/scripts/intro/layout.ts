// Shared geometry (CSS pixels) for the composed "desktop": a browser window that fills the
// 1280 × 720 frame, and an undocked DevTools window floating above it.
export const DESKTOP = { w: 1280, h: 720 };
export const CHROME_HEIGHT = 68;
export const TITLE_HEIGHT = 26;
export const WINDOW = { x: 36, y: 90, w: 1208, h: 620 };
export const DEVTOOLS = { w: WINDOW.w, h: WINDOW.h - TITLE_HEIGHT };
// Screen space kept clear at the top of the frame for subtitles.
export const SUBTITLE_BAND = 92;
