import type { NextConfig } from 'next';

export default {
  distDir:
    process.env.ANATOMY_NEXT_DEV === '1'
      ? `.next-dev-${process.env.ANATOMY_VALIDATION_ID || 'local'}`
      : '.next',
  experimental: { cpus: 2 },
  devIndicators: false,
} satisfies NextConfig;
