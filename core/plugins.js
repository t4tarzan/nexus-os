// Nexus Plugin System — load custom actions from ~/.nexus/plugins/
// Each plugin is a .js file that exports: { name, intents, actions }
// Plugins can add new intent types and action handlers

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_DIRS = [
  path.join(os.homedir(), '.nexus', 'plugins'),          // User plugins
  path.join(__dirname, '..', 'plugins'),                  // Project plugins
];

let loadedPlugins = [];
let customIntents = {};
let customActions = {};

function loadPlugins() {
  loadedPlugins = [];
  customIntents = {};
  customActions = {};

  for (const dir of PLUGIN_DIRS) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
    
    for (const file of files) {
      const pluginPath = path.join(dir, file);
      try {
        // Clear require cache for hot-reload
        delete require.cache[require.resolve(pluginPath)];
        
        const plugin = require(pluginPath);
        
        if (!plugin.name) {
          console.log(`[plugins] ⚠️  ${file}: missing "name" export, skipping`);
          continue;
        }

        // Register plugin
        const pluginMeta = {
          name: plugin.name,
          version: plugin.version || '0.1.0',
          description: plugin.description || '',
          file,
          path: pluginPath,
        };

        // Register intents
        if (plugin.intents && typeof plugin.intents === 'object') {
          for (const [intentName, intentConfig] of Object.entries(plugin.intents)) {
            if (customIntents[intentName]) {
              console.log(`[plugins] ⚠️  Intent "${intentName}" already registered by another plugin`);
              continue;
            }
            customIntents[intentName] = {
              ...intentConfig,
              plugin: pluginMeta.name,
            };
          }
        }

        // Register actions
        if (plugin.actions && typeof plugin.actions === 'object') {
          for (const [actionName, actionFn] of Object.entries(plugin.actions)) {
            if (typeof actionFn !== 'function') {
              console.log(`[plugins] ⚠️  ${plugin.name}: action "${actionName}" is not a function`);
              continue;
            }
            if (customActions[actionName]) {
              console.log(`[plugins] ⚠️  Action "${actionName}" already registered`);
              continue;
            }
            customActions[actionName] = actionFn;
          }
        }

        // Lifecycle hooks
        if (typeof plugin.onLoad === 'function') {
          plugin.onLoad({ pluginDir: dir });
        }

        loadedPlugins.push(pluginMeta);
        console.log(`[plugins] ✅ Loaded: ${plugin.name} v${pluginMeta.version} — ${plugin.description || 'No description'}`);

      } catch (e) {
        console.log(`[plugins] ❌ Failed to load ${file}:`, e.message);
      }
    }
  }

  console.log(`[plugins] ${loadedPlugins.length} plugin(s) loaded, ${Object.keys(customIntents).length} intents, ${Object.keys(customActions).length} actions`);
  
  return {
    plugins: loadedPlugins,
    intents: customIntents,
    actions: customActions,
  };
}

function getCustomIntents() {
  return customIntents;
}

function getCustomActions() {
  return customActions;
}

function getLoadedPlugins() {
  return loadedPlugins;
}

// Hot reload all plugins
function reloadPlugins() {
  return loadPlugins();
}

module.exports = { loadPlugins, getCustomIntents, getCustomActions, getLoadedPlugins, reloadPlugins };
