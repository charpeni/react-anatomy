import type { Dispatch, SetStateAction } from 'react';
import type { PrototypeNode } from './capture.ts';

export interface PrototypeCaption {
  kicker: string;
  title: string;
  text: string;
}

export interface PrototypeController {
  switchVariant: (variant: 'A' | 'B' | 'C') => void;
  select: (id: string) => void;
  setExplode: Dispatch<SetStateAction<number>>;
  setDepth: Dispatch<SetStateAction<number>>;
  setRotation: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setZoom: Dispatch<SetStateAction<number>>;
  setLabels: Dispatch<SetStateAction<boolean>>;
  setCaption: Dispatch<SetStateAction<PrototypeCaption | null>>;
  isolate: (id: string) => void;
  reset: () => void;
  nodes: Omit<PrototypeNode, 'hosts'>[];
  state: {
    variant: string;
    selected: string;
    explode: number;
    depth: number;
    focus: string | null;
    visible: string[];
    rotation: { x: number; y: number };
  };
}

declare global {
  interface Window {
    __strata: PrototypeController;
  }
}
