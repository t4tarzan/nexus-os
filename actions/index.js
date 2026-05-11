// Nexus Actions — what the system can actually do
// Each action is an async function that takes (params, context) and returns { success, result, error }

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const graph = require('../graph');

const HOME = os.homedir();

// --- File Actions ---

async function file_search(params, ctx) {
  const searchPath = params.path || HOME;
  const query = params.fileName || params.query || '';
  if (!query) return { success: false, error: 'No search query', results: [] };

  // 1. Search the knowledge graph for indexed files
  const db = graph.getDb();
  const graphResults = db.prepare(
    `SELECT * FROM entities WHERE type IN ('file', 'folder') AND LOWER(name) LIKE ? LIMIT 20`
  ).all(`%${query.toLowerCase()}%`);
  
  const graphFiles = graphResults.map(r => ({
    path: r.path,
    name: r.name,
    dir: r.path ? path.dirname(r.path) : '',
    type: r.type || 'file',
    source: 'graph',
  }));

  // 2. Filesystem search from key directories
  return new Promise((resolve) => {
    const escapedQuery = query.replace(/"/g, '\\"').replace(/'/g, "\\'");
    const searchDirs = [
      HOME + '/Desktop',
      HOME + '/Downloads',
      HOME + '/Documents',
      searchPath,
    ].filter(d => { try { return fs.existsSync(d); } catch { return false; } });
    
    let allResults = [...graphFiles];
    let completed = 0;
    
    if (searchDirs.length === 0) {
      return resolve({ success: true, results: allResults, count: allResults.length });
    }

    searchDirs.forEach(dir => {
      const cmd = `find "${dir}" -maxdepth 4 -iname "*${escapedQuery}*" -not -path '*/\\.*' 2>/dev/null | head -20`;
      exec(cmd, { timeout: 5000 }, (err, stdout) => {
        completed++;
        if (!err && stdout) {
          const fsResults = stdout.trim().split('\n').filter(Boolean).map(p => ({
            path: p,
            name: path.basename(p),
            dir: path.dirname(p),
            type: (() => { try { return fs.statSync(p).isDirectory() ? 'folder' : 'file'; } catch { return 'unknown'; } })(),
            source: 'filesystem',
          }));
          allResults = [...allResults, ...fsResults];
        }
        
        if (completed >= searchDirs.length) {
          const seen = new Set();
          const unique = allResults.filter(r => {
            const key = r.path || r.name;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          
          for (const r of unique) {
            if (r.source === 'filesystem') {
              graph.upsertEntity(r.type || 'file', r.name, { path: r.path, metadata: r });
            }
          }

          resolve({ success: true, results: unique.slice(0, 30), count: unique.length });
        }
      });
    });
  });
}

async function file_open(params, ctx) {
  let filePath = params.path;

  // If no path but we have a fileName, resolve it from the graph + filesystem
  if (!filePath && params.fileName) {
    const wantFolder = params.type === 'folder' || params.isFolder || ctx?.rawInput?.toLowerCase().includes('folder');
    const db = graph.getDb();
    
    // Search graph entities
    const nameLower = params.fileName.toLowerCase();
    const likePattern = `%${nameLower}%`;
    const rows = db.prepare(
      `SELECT * FROM entities WHERE type IN ('file', 'folder') AND (LOWER(name) = ? OR LOWER(name) LIKE ?) AND path IS NOT NULL
       ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, LOWER(name) = ? DESC LIMIT 10`
    ).all(nameLower, likePattern, nameLower);
    
    if (rows.length > 0) {
      const exact = rows.find(r => r.name.toLowerCase() === nameLower);
      const folder = rows.find(r => r.type === 'folder');
      filePath = (wantFolder ? (folder || exact || rows[0]) : (exact || rows[0])).path;
    }

    // If still not found, try filesystem search
    if (!filePath || (wantFolder && !fs.existsSync(filePath))) {
      const searchResult = await file_search({ fileName: params.fileName, path: HOME }, ctx);
      if (searchResult.success && searchResult.results?.length > 0) {
        const pref = wantFolder
          ? searchResult.results.find(r => r.type === 'folder')
          : searchResult.results[0];
        if (pref) filePath = pref.path;
      }
    }
    
    if (filePath) console.log('[file_open] Resolved', params.fileName, '→', filePath);
  }

  if (!filePath) return { success: false, error: `Could not find "${params.fileName || params.path}"` };
  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

  return new Promise((resolve) => {
    const cmd = process.platform === 'darwin' ? `open "${filePath}"` :
                process.platform === 'win32' ? `start "" "${filePath}"` :
                `xdg-open "${filePath}"`;
    exec(cmd, (err) => {
      if (err) return resolve({ success: false, error: err.message });
      graph.upsertEntity(fs.statSync(filePath).isDirectory() ? 'folder' : 'file', path.basename(filePath), {
        path: filePath,
        metadata: { opened_at: new Date().toISOString() },
      });
      resolve({ success: true, result: `Opened ${path.basename(filePath)}` });
    });
  });
}

async function file_read(params, ctx) {
  const filePath = params.path;
  if (!filePath) return { success: false, error: 'No path provided' };
  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };

  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 100 * 1024) {
      const content = fs.readFileSync(filePath, 'utf8').slice(0, 10000);
      return {
        success: true,
        result: content,
        truncated: true,
        totalSize: stat.size,
        message: `File is ${(stat.size / 1024).toFixed(1)}KB. Showing first 10KB.`,
      };
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return { success: true, result: content, totalSize: stat.size };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function file_organize(params, ctx) {
  const filePath = params.path;
  const destination = params.destination || path.join(HOME, 'Documents', 'Organized');

  if (!fs.existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };
  
  try {
    fs.mkdirSync(destination, { recursive: true });
    const newPath = path.join(destination, path.basename(filePath));
    fs.renameSync(filePath, newPath);
    return { success: true, result: `Moved to ${newPath}`, newPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// --- App Actions ---

async function app_launch(params, ctx) {
  const appName = params.appName;
  if (!appName) return { success: false, error: 'No app name provided' };

  return new Promise((resolve) => {
    const cmd = process.platform === 'darwin'
      ? `open -a "${appName}"`
      : process.platform === 'win32'
        ? `start "" "${appName}"`
        : `which "${appName}" && "${appName}" || echo "App not found"`;

    exec(cmd, { timeout: 5000 }, (err, stdout, stderr) => {
      if (err) return resolve({ success: false, error: stderr || err.message });
      graph.upsertEntity('app', appName, {
        metadata: { launched_at: new Date().toISOString() },
      });
      resolve({ success: true, result: `Launched ${appName}` });
    });
  });
}

// --- Web Actions ---

async function web_search(params, ctx) {
  const query = params.query;
  if (!query) return { success: false, error: 'No query provided' };
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  return browser_open({ url }, ctx);
}

async function browser_open(params, ctx) {
  const url = params.url;
  if (!url) return { success: false, error: 'No URL provided' };

  return new Promise((resolve) => {
    const cmd = process.platform === 'darwin' ? `open "${url}"` :
                process.platform === 'win32' ? `start "" "${url}"` :
                `xdg-open "${url}"`;
    exec(cmd, (err) => {
      if (err) return resolve({ success: false, error: err.message });
      resolve({ success: true, result: `Opened ${url}` });
    });
  });
}

// --- System Actions ---

async function shell_run(params, ctx) {
  const command = params.command;
  if (!command) return { success: false, error: 'No command provided' };

  return new Promise((resolve) => {
    exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        success: !err,
        result: stdout || stderr,
        error: err?.message,
        exitCode: err?.code || 0,
      });
    });
  });
}

// --- Unified Search ---

async function unified_search(params, ctx) {
  const query = params.query;
  if (!query) return { success: false, error: 'No query provided' };

  const results = { files: [], entities: [], interactions: [] };

  const fileResult = await file_search({ fileName: query, path: HOME }, ctx);
  if (fileResult.success) results.files = fileResult.results;

  const db = graph.getDb();
  const entityRows = db.prepare(
    'SELECT * FROM entities WHERE LOWER(name) LIKE ? OR LOWER(type) LIKE ? LIMIT 20'
  ).all(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`);
  results.entities = entityRows.map(r => ({ ...r, metadata: JSON.parse(r.metadata || '{}') }));

  const interactionRows = db.prepare(
    'SELECT * FROM interactions WHERE LOWER(raw_input) LIKE ? ORDER BY created_at DESC LIMIT 10'
  ).all(`%${query.toLowerCase()}%`);
  results.interactions = interactionRows;

  return { success: true, result: results };
}

// --- Help ---

async function show_help(params, ctx) {
  const { INTENT_SCHEMA } = require('../core/router');
  const { getCustomIntents } = require('../core/plugins');
  
  const allIntents = { ...INTENT_SCHEMA, ...getCustomIntents() };
  const capabilities = Object.entries(allIntents)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `- **${k.replace(/_/g, ' ')}**: ${v.desc}${v.plugin ? ' _(plugin: ' + v.plugin + ')_' : ''}`)
    .join('\n');

  const pluginList = require('../core/plugins').getLoadedPlugins();
  const pluginSection = pluginList.length > 0
    ? `\n\n**Installed Plugins:**\n${pluginList.map(p => `- ${p.name} v${p.version}: ${p.description}`).join('\n')}`
    : '';

  return {
    success: true,
    result: `# Welcome to Nexus 👋\n\nI understand what you want and make it happen. Here's what I can do:\n\n${capabilities}${pluginSection}\n\nJust type or speak naturally. No special commands needed.`
  };
}

// Import new action modules
const { email_send, email_read } = require('./email');
const { calendar_query, calendar_create } = require('./calendar');
const { lookupContact, getAllContacts, syncContacts } = require('./contacts');

// Contact actions
async function contact_lookup(params, ctx) {
  const query = params.name || params.query;
  if (!query) {
    const all = getAllContacts();
    return { success: true, result: `Found ${all.length} contacts`, contacts: all.slice(0, 20) };
  }
  const results = lookupContact(query);
  if (results.length === 0) return { success: false, error: `No contact found for "${query}"` };
  return { success: true, result: results[0], contacts: results };
}

async function graph_query(params, ctx) {
  const db = graph.getDb();
  const stats = graph.getStats();
  const recent = graph.getRecentInteractions(5);
  return { success: true, result: { stats, recentInteractions: recent.map(r => r.raw_input) } };
}

// Action registry
const ACTION_MAP = {
  file_search, file_open, file_read, file_organize,
  unified_search, show_help,
  app_launch, browser_open, web_search,
  shell_run,
  email_send, email_read,
  calendar_query, calendar_create,
  contact_lookup, graph_query,
};

// Execute an action based on routing result
async function executeAction(routingResult) {
  const { intent, params } = routingResult;
  const { INTENT_SCHEMA } = require('../core/router');
  const { getCustomActions, getCustomIntents } = require('../core/plugins');
  
  // Merge built-in and plugin intents
  const allIntents = { ...INTENT_SCHEMA, ...getCustomIntents() };
  const allActions = { ...ACTION_MAP, ...getCustomActions() };
  
  const intentConfig = allIntents[intent];
  
  if (!intentConfig) {
    return { success: false, error: `Unknown intent: ${intent}`, result: "I'm not sure how to do that. Try rephrasing or ask 'help'." };
  }

  // Pick the right action based on params.action or use the first available
  let actionName = intentConfig.actions[0];
  if (params.action) {
    const actionMap = {
      'open': 'file_open',
      'find': 'file_search',
      'search': 'file_search',
      'read': 'file_read',
      'edit': 'modify_file',
      'send': 'email_send',
      'schedule': 'calendar_create',
      'lookup': 'contact_lookup',
      'compose': 'email_send',
      'create': 'calendar_create',
      'save': 'note_save',
      'recall': 'note_recall',
      'get': 'weather_get',
    };
    const mapped = actionMap[params.action.toLowerCase()];
    if (mapped && intentConfig.actions.includes(mapped)) {
      actionName = mapped;
    }
  }

  const actionFn = allActions[actionName];

  if (!actionFn) {
    return {
      success: false,
      error: `Action not implemented: ${actionName}`,
      result: `I understand you want to ${intent.replace(/_/g, ' ')}, but I haven't learned how to do that yet. Coming soon!`,
    };
  }

  try {
    const result = await actionFn(params, { intent, rawInput: routingResult.rawInput });
    return result;
  } catch (e) {
    return { success: false, error: e.message, result: `Something went wrong: ${e.message}` };
  }
}

module.exports = { executeAction, ACTION_MAP };
