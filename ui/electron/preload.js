const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  // WebSocket communication with Nexus server
  wsConnect: () => {
    const ws = new WebSocket('ws://localhost:47900');
    
    ws.onopen = () => window.dispatchEvent(new CustomEvent('nexus:connected'));
    ws.onclose = () => window.dispatchEvent(new CustomEvent('nexus:disconnected'));
    ws.onerror = (e) => window.dispatchEvent(new CustomEvent('nexus:error', { detail: e }));
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      window.dispatchEvent(new CustomEvent('nexus:message', { detail: data }));
    };

    window.__nexusWs = ws;
    return ws;
  },

  sendIntent: (text) => {
    if (window.__nexusWs && window.__nexusWs.readyState === WebSocket.OPEN) {
      window.__nexusWs.send(JSON.stringify({
        id: Date.now().toString(),
        action: 'intent',
        payload: { text },
      }));
    }
  },

  sendFeedback: (interactionId, feedback, correction) => {
    if (window.__nexusWs && window.__nexusWs.readyState === WebSocket.OPEN) {
      window.__nexusWs.send(JSON.stringify({
        id: Date.now().toString(),
        action: 'feedback',
        payload: { interactionId, feedback, correction },
      }));
    }
  },

  getStats: () => {
    if (window.__nexusWs && window.__nexusWs.readyState === WebSocket.OPEN) {
      window.__nexusWs.send(JSON.stringify({ id: Date.now().toString(), action: 'stats' }));
    }
  },

  onFocusIntentBar: (callback) => {
    ipcRenderer.on('focus-intent-bar', callback);
  },
});
