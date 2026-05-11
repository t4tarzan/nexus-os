// Nexus Observer — watches what you do and silently builds the knowledge graph
// Uses macOS accessibility + file system events to learn your patterns
// No user interaction needed — just runs in the background

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const graph = require('../graph');

const HOME = os.homedir();
const OBSERVER_INTERVAL = parseInt(process.env.NEXUS_OBSERVER_INTERVAL || '30000'); // 30s

let isRunning = false;
let intervalId = null;

// ─── Active App Detection ───

function getActiveApp() {
  return new Promise((resolve) => {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set windowTitle to ""
        try
          set windowTitle to name of front window of frontApp
        end try
        return appName & "|" & windowTitle
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve({ app: 'unknown', window: '' });
      const [app, ...windowParts] = (stdout.trim() || 'unknown|').split('|');
      resolve({ app, window: windowParts.join('|') });
    });
  });
}

// ─── Recently Opened Files ───

function getRecentFiles() {
  return new Promise((resolve) => {
    exec(`ls -lt "${HOME}/Library/Application Support/com.apple.sharedfilelist/" 2>/dev/null | head -5`, 
      { timeout: 3000 }, (err, stdout) => {
        if (err) return resolve([]);
        resolve(stdout.trim().split('\n').filter(Boolean));
      });
  });
}

// ─── Browser Tab Detection (Chrome/Safari) ───

function getBrowserTabs() {
  return new Promise((resolve) => {
    const script = `
      set results to ""
      try
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          set appName to name of frontApp
        end tell
        
        if appName contains "Chrome" or appName contains "Safari" or appName contains "Firefox" or appName contains "Brave" or appName contains "Arc" then
          tell application appName
            if appName contains "Chrome" or appName contains "Brave" or appName contains "Arc" then
              set tabTitle to title of active tab of front window
              set tabUrl to URL of active tab of front window
              return tabTitle & "|" & tabUrl
            else if appName contains "Safari" then
              set tabTitle to name of front document
              set tabUrl to URL of front document
              return tabTitle & "|" & tabUrl
            end if
          end tell
        end if
      end try
      return ""
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(null);
      const [title, url] = stdout.trim().split('|');
      resolve({ title, url });
    });
  });
}

// ─── Downloads Watcher (new files) ───

function watchDownloads(callback) {
  const downloadsPath = path.join(HOME, 'Downloads');
  const desktopPath = path.join(HOME, 'Desktop');

  try {
    fs.watch(downloadsPath, (eventType, filename) => {
      if (filename && !filename.startsWith('.')) {
        callback('download', path.join(downloadsPath, filename));
      }
    });

    fs.watch(desktopPath, (eventType, filename) => {
      if (filename && !filename.startsWith('.')) {
        callback('desktop', path.join(desktopPath, filename));
      }
    });
  } catch (e) {
    console.log('[observer] File watching unavailable:', e.message);
  }
}

// ─── Main Observation Loop ───

async function observe() {
  try {
    // 1. What app is active?
    const active = await getActiveApp();
    if (active.app && active.app !== 'unknown') {
      const appId = graph.upsertEntity('app', active.app, {
        metadata: { last_seen: new Date().toISOString(), window: active.window },
      });
    }

    // 2. What's the browser tab?
    const tab = await getBrowserTabs();
    if (tab?.url) {
      try {
        const domain = new URL(tab.url).hostname;
        graph.upsertEntity('url', domain, {
          metadata: { title: tab.title, url: tab.url, visited: new Date().toISOString() },
        });

        // Link the app (browser) to the URL
        const appId = graph.upsertEntity('app', active.app, { metadata: {} });
        const urlId = graph.upsertEntity('url', domain, { metadata: { url: tab.url } });
        graph.addRelation(appId, urlId, 'visited', 0.3);
      } catch {}
    }

    // 3. Log observation
    graph.logInteraction({
      rawInput: `[observer] ${active.app}${tab ? ' — ' + tab.title : ''}`,
      intent: 'observer_tick',
      params: { app: active.app, window: active.window, tabTitle: tab?.title, tabUrl: tab?.url },
      action: 'observe',
    });

  } catch (e) {
    // Silent failure — observer is best-effort
  }
}

// ─── Lifecycle ───

function start() {
  if (isRunning) return;
  isRunning = true;
  
  console.log(`[observer] Starting observation mode (interval: ${OBSERVER_INTERVAL}ms)`);
  
  // Initial observation
  observe();
  
  // Periodic observation
  intervalId = setInterval(observe, OBSERVER_INTERVAL);

  // Watch downloads
  watchDownloads((source, filePath) => {
    const name = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      graph.upsertEntity('file', name, {
        path: filePath,
        metadata: { source, size: stat.size, added: new Date().toISOString() },
      });
      console.log(`[observer] 📁 New ${source}: ${name}`);
    } catch {}
  });

  // Handle shutdown
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function stop() {
  isRunning = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  console.log('[observer] Stopped');
}

function getStatus() {
  return {
    running: isRunning,
    interval: OBSERVER_INTERVAL,
    stats: graph.getStats(),
  };
}

// Run standalone if called directly
if (require.main === module) {
  graph.migrate(graph.getDb());
  start();
  console.log('[observer] Running in background. Press Ctrl+C to stop.');
}

module.exports = { start, stop, getStatus, isRunning: () => isRunning };
