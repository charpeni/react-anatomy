export {};

declare global {
  interface Window {
    propGetterCalls?: number;
    propCallbackCalls?: number;
    updateInspectedProps?: () => void;
    unmountInspectedProps?: () => void;
    prependInspectedItem?: () => void;
    contextFixtureRenders?: Record<string, number>;
  }
}
