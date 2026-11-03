export {};

declare global {
  interface Window {
    propGetterCalls?: number;
    propCallbackCalls?: number;
    updateInspectedProps?: () => void;
    unmountInspectedProps?: () => void;
  }
}
