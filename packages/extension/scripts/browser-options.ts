import { chromium } from 'playwright';

// Normal installs use Playwright's full Chromium browser (extensions require it).
// Hosts with a separate browser or shared-library sysroot can opt in explicitly.
export function browserOptions() {
  const sysroot = process.env.CHROME_SYSROOT;

  return {
    executablePath: process.env.CHROME_PATH || chromium.executablePath(),
    env: {
      ...process.env,
      ...(sysroot
        ? {
            LD_LIBRARY_PATH: `${sysroot}/usr/lib/x86_64-linux-gnu:${sysroot}/lib/x86_64-linux-gnu${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`,
            FONTCONFIG_PATH: `${sysroot}/etc/fonts`,
            XDG_DATA_DIRS: `${sysroot}/usr/share${process.env.XDG_DATA_DIRS ? `:${process.env.XDG_DATA_DIRS}` : ''}`,
          }
        : {}),
    },
  };
}
