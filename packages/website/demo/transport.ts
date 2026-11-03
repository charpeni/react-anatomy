import type { Transport } from '@react-anatomy/extension/inspector/types.ts';

const sampleUrl = 'https://orbit.example/projects';

export function createTransport(): Omit<Transport, 'mode'> & { mode: 'demo' } {
  let lastPicked: string | null = null;

  const notify = (event: string) => window.parent.dispatchEvent(new Event(event));

  return {
    mode: 'demo',
    async call(request) {
      const source = window.parent.document.querySelector<HTMLIFrameElement>('#anatomy-source');
      const agent = source?.contentWindow?.anatomyExample;

      if (!agent) {
        throw new Error(
          'The example page is not ready. Return to the page and reload the example.',
        );
      }

      const result = await agent.call(request);

      if (request.action === 'pick') {
        notify('anatomy-example-pick');
      }

      if (request.action === 'highlight') {
        notify('anatomy-example-highlight');
      }

      if (request.action === 'status' && result && 'picked' in result) {
        if (result.picked && result.picked !== lastPicked) {
          lastPicked = result.picked;
          notify('anatomy-example-picked');
        }
      }

      // Consistent display URL in capture and status; the source is a bundled fixture.
      return result && 'url' in result ? { ...result, url: sampleUrl } : result;
    },
    onNavigate: () => () => {},
  };
}
