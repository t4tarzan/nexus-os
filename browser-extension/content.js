// Nexus Browser Extension — Content Script
// Injected into all pages to get selected text

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'get-selection') {
    const text = window.getSelection()?.toString() || '';
    sendResponse({ text });
  }
  return true;
});
