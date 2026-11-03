import type { PageResponses, Transport } from './types.ts';
import { pageAgent } from './page-agent.ts';

// Both entry points expose the same small inspected-page interface.
export function createTransport(): Transport {
  const tab = Number(new URLSearchParams(location.search).get('tab'));

  if (chrome.devtools?.inspectedWindow && !new URLSearchParams(location.search).has('tab')) {
    const evaluate = <T>(expression: string) =>
      new Promise<T>((resolve, reject) => {
        chrome.devtools.inspectedWindow.eval(expression, (result, exception) => {
          if (exception?.isException || exception?.isError) {
            reject(
              new Error(
                exception.description || exception.value || 'The page could not be inspected.',
              ),
            );
          } else {
            resolve(result as T);
          }
        });
      });

    return {
      mode: 'devtools',
      call: (request) => evaluate(`(${pageAgent.toString()})(${JSON.stringify(request)})`),
      inspect: (id) =>
        evaluate(
          `(()=>{const element=(${pageAgent.toString()})(${JSON.stringify({ action: 'element', id })});if(!element)return {ok:false,message:'This component has no current DOM output. Capture the page again.'};inspect(element);return {ok:true};})()`,
        ),
      onNavigate: (callback: () => void) => {
        chrome.devtools.network.onNavigated.addListener(callback);

        return () => chrome.devtools.network.onNavigated.removeListener(callback);
      },
    };
  }

  return {
    mode: 'window',
    async call(request) {
      if (!Number.isInteger(tab) || tab <= 0) {
        throw new Error(
          'Open React Anatomy from the extension button on the page you want to inspect.',
        );
      }

      const response: { error?: string; result: PageResponses[typeof request.action] } =
        await chrome.runtime.sendMessage({
          type: 'strata:page',
          tabId: tab,
          request,
        });

      if (response?.error) {
        throw new Error(response.error);
      }

      return response?.result;
    },
    onNavigate: () => () => {},
  };
}
