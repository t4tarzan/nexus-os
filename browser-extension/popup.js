// Nexus Browser Extension — Popup Script

const NEXUS_URL = 'http://localhost:47900';
let selectedAction = 'summarize';

// Get selected text from the active tab
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'get-selection' }, (response) => {
      if (response?.text) {
        document.getElementById('text').value = response.text;
      }
    });
  }
});

// Action buttons
document.querySelectorAll('.action-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.action-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedAction = btn.dataset.action;
  });
});

// Set default active
document.querySelector('[data-action="summarize"]').classList.add('active');

// Send button
document.getElementById('send').addEventListener('click', async () => {
  const text = document.getElementById('text').value.trim();
  if (!text) return;

  const status = document.getElementById('status');
  const button = document.getElementById('send');
  
  button.disabled = true;
  status.textContent = 'Sending...';
  status.className = '';

  let prompt = text;
  switch (selectedAction) {
    case 'summarize': prompt = `Summarize this:\n\n${text}`; break;
    case 'explain':   prompt = `Explain this in simple terms:\n\n${text}`; break;
    case 'save':      prompt = `Save note: ${text}`; break;
    case 'ask':       prompt = `Answer questions about this text. ${text}`; break;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'send-to-nexus',
      text: prompt,
      intent: selectedAction === 'save' ? 'save_note' : undefined,
    });

    if (response?.success) {
      status.textContent = '✅ Sent to Nexus';
      status.className = 'success';
    } else {
      status.textContent = '⚠️ ' + (response?.error || 'Check Nexus server');
      status.className = 'error';
    }
  } catch (e) {
    status.textContent = '❌ Cannot connect to Nexus server';
    status.className = 'error';
  }

  button.disabled = false;
  setTimeout(() => { status.textContent = ''; status.className = ''; }, 3000);
});

// Auto-send on Enter
document.getElementById('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.metaKey) {
    document.getElementById('send').click();
  }
});
