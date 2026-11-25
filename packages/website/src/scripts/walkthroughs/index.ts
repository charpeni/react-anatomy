import type { Walkthrough } from './steps.ts';
import { unusedProps } from './unused-props.ts';
import { context } from './context.ts';
import { reference } from './reference.ts';

export const walkthroughs: Record<string, Walkthrough> = {
  'docs/find-the-same-reference': reference,
  'docs/context': context,
  'docs/unused-props': unusedProps,
};
