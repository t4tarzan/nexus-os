// Nexus Browser Extension — Background Service Worker
// Handles context menu clicks, keyboard shortcuts, and communication with Nexus server

const NEXUS_URL = 'http://localhost:47900';

// ─── Context Menu ───

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'nexus-summarize',
    title: 'Summarize with Nexus',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'nexus-explain',
    title: 'Explain this with Nexus',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'nexus-save',
    title: 'Save to Nexus Notes',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'nexus-send-page',
    title: 'Send page to Nexus',
    contexts: ['page'],
  });
});

// ─── Context Menu Handler ───

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = info.selectionText;
  const url = tab?.url;

  switch (info.menuItemId) {
    case 'nexus-summarize':
      await sendToNexus(`Summarize this text:\n\n${text}`);
      break;
    case 'nexus-explain':
      await sendToNexus(`Explain this in simple terms:\n\n${text}`);
      break;
    case 'nexus-save':
      await sendToNexus(`Save this note: ${text}`, 'save_note');
      break;
    case 'nexus-send-page':
      await sendToNexus(`Analyze this page: ${url}`);
      break;
  }
});

// ─── Keyboard Shortcut ───

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'send-to-nexus') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'get-selection' }, async (response) => {
        const text = response?.text || '';
        if (text) {
          await sendToNexus(text);
        }
      });
    }
  }
});

// ─── Message from Popup ───

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'send-to-nexus') {
    sendToNexus(message.text, message.intent)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }
});

// ─── Send to Nexus Server ───

async function sendToNexus(text, overrideIntent = null) {
  try {
    // Try WebSocket first (real-time)
    const wsResult = await tryWebSocket(text, overrideIntent);
    if (wsResult) return wsResult;

    // Fall back to fetch
    const response = await fetch(`${NEXUS_URL}/api/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, intent: overrideIntent }),
    });
    
    return await response.json();
  } catch (e) {
    console.error('[nexus-extension] Failed to send:', e.message);
    throw e;
  }
}

function tryWebSocket(text, overrideIntent) {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(`ws://localhost:47900`);
      const timeout = setTimeout(() => {
        ws.close();
        resolve(null);
      }, 3000);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 'ext-' + Date.now(),
          action: 'intent',
          payload: { text },
        }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'result' || msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          resolve({ success: msg.success, result: msg.result, error: msg.error });
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}
