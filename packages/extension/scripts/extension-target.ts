// Keep Chrome's existing output path stable for local installs and recordings.
const targets = {
  chrome: {
    browser: 'chrome',
    directory: 'dist/extension',
    installNotes: 'extension/INSTALL.md',
    archivePrefix: 'react-anatomy-extension',
  },
  firefox: {
    browser: 'firefox',
    directory: 'dist/firefox',
    installNotes: 'extension/INSTALL.firefox.md',
    archivePrefix: 'react-anatomy-firefox',
  },
};

export function extensionTarget(args = process.argv.slice(2)) {
  const browser = args.length === 0 ? 'chrome' : args[0].replace(/^--browser=/, '');

  if (
    args.length > 1 ||
    (args.length && args[0] !== `--browser=${browser}`) ||
    !Object.hasOwn(targets, browser)
  ) {
    throw new Error('Use --browser=chrome or --browser=firefox.');
  }

  return targets[browser as keyof typeof targets];
}
