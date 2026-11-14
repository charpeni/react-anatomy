import { pageAgent } from '../src/inspector/page-agent.ts';

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) {
    return;
  }

  chrome.windows.create({
    url: chrome.runtime.getURL(`panel.html?tab=${tab.id}`),
    type: 'popup',
    width: 1500,
    height: 1000,
  });
});

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    message?.type !== 'anatomy:page' ||
    !Number.isInteger(message.tabId)
  ) {
    return;
  }

  chrome.scripting
    .executeScript({
      target: { tabId: message.tabId },
      world: 'MAIN',
      func: pageAgent,
      args: [message.request],
    })
    .then((results) => reply({ result: results[0]?.result }))
    .catch((error) => reply({ error: error.message }));

  return true;
});
