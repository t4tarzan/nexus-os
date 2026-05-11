// Nexus Graph Watcher — indexes the filesystem and keeps the graph current
// Runs as a background process, watching key directories for changes

const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const graph = require('../graph');

const HOME = require('os').homedir();
const WATCH_DIRS = [
  path.join(HOME, 'Desktop'),
  path.join(HOME, 'Documents'),
  path.join(HOME, 'Downloads'),
  path.join(HOME, 'Pictures'),
];

console.log('[watcher] Starting filesystem indexer...');

// Initial indexing — register all files
async function indexDirectory(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip hidden files/dirs
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Index top-level directories only (depth=1)
        graph.upsertEntity('folder', entry.name, {
          path: fullPath,
          metadata: { type: 'folder' },
        });
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        const ext = path.extname(entry.name).toLowerCase();
        graph.upsertEntity('file', entry.name, {
          path: fullPath,
          metadata: {
            type: 'file',
            size: stat.size,
            extension: ext,
            modified: stat.mtime.toISOString(),
            created: stat.birthtime?.toISOString(),
          },
        });
        
        // Link files to their parent folder
        const fileId = graph.upsertEntity('file', entry.name, { path: fullPath, metadata: {} });
        const folderId = graph.upsertEntity('folder', path.basename(dir), { path: dir, metadata: {} });
        graph.addRelation(folderId, fileId, 'contains');
      }
    }
    console.log(`[watcher] Indexed ${dir} — ${entries.length} entries`);
  } catch (e) {
    // Skip dirs we can't read
  }
}

// Watch for changes
function startWatching() {
  const watcher = chokidar.watch(WATCH_DIRS, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    depth: 2,
    ignoreInitial: true, // we do initial indexing separately
  });

  watcher.on('add', (filePath) => {
    const name = path.basename(filePath);
    const ext = path.extname(name).toLowerCase();
    try {
      const stat = fs.statSync(filePath);
      graph.upsertEntity('file', name, {
        path: filePath,
        metadata: { type: 'file', size: stat.size, extension: ext, added: new Date().toISOString() },
      });
      console.log(`[watcher] + ${name}`);
    } catch (_) {}
  });

  watcher.on('change', (filePath) => {
    const name = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      graph.upsertEntity('file', name, {
        path: filePath,
        metadata: { type: 'file', size: stat.size, modified: new Date().toISOString() },
      });
    } catch (_) {}
  });

  watcher.on('unlink', (filePath) => {
    console.log(`[watcher] - ${path.basename(filePath)}`);
    // Entities aren't deleted, just marked as inaccessible
  });

  console.log(`[watcher] Watching ${WATCH_DIRS.length} directories`);
  return watcher;
}

// Main
async function main() {
  // Initialize graph
  graph.migrate(graph.getDb());
  
  // Index all watch dirs
  for (const dir of WATCH_DIRS) {
    await indexDirectory(dir);
  }

  // Start watching
  const watcher = startWatching();

  // Periodic re-index (every hour)
  setInterval(async () => {
    console.log('[watcher] Periodic re-index...');
    for (const dir of WATCH_DIRS) {
      await indexDirectory(dir);
    }
  }, 60 * 60 * 1000);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('[watcher] Shutting down...');
    watcher.close();
    process.exit(0);
  });
}

main().catch(console.error);
