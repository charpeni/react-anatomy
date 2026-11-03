import type { PageCall } from '@react-anatomy/extension/inspector/types.ts';

declare global {
  interface Window {
    anatomyExample?: { call: PageCall };
  }
}
