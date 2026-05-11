# 🧠 Nexus OS

> **The OS that understands you.**  
> Type. Speak. Share. Nexus figures out what you want and makes it happen.  
> No menus. No file systems. No learning curves.

---

## What It Does

Nexus replaces the traditional OS interface with a single intent bar. You say what you want — it routes your intent through an LLM, resolves context from a local knowledge graph, and executes the right action.

```
You:     "send the contract to Sarah"
Nexus:   Intent → send_email (to: Sarah)
         Graph → Sarah = sarah@company.com, contract = latest .pdf
         Action → Opens Mail composer, attachment ready
         Graph learns → "vinayak sends contracts to Sarah via email"
```

## Architecture

```
  🎤 Voice ──┐                    ┌── 📱 Mobile (PWA)
  ⌨️  Text ──┤                    ├── 🖥️  Desktop (Electron)
  🔌 Chrome ─┤── NEXUS SERVER ────┼── 🧩 Plugins (extensible)
             │    (WebSocket)     │
             └────────────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
  🎯 Router       📊 Graph        🎬 Actions
  (LLM powered)   (SQLite + KG)   (30+ actions)
      │               │               │
      └───────────────┼───────────────┘
                      │
      ┌───────────────┼───────────────┐
      │               │               │
  🧠 Learning      🔌 Plugins      👁️ Observer
  (anticipates)    (anyone can add) (silent graph builder)
```

## Quick Start

```bash
# Clone
git clone https://github.com/t4tarzan/nexus-os.git
cd nexus-os

# Install
npm install
cd ui && npm install && npm run build && cd ..

# Configure your LLM provider
cp .env.example .env
# Edit .env with your API key

# Launch
node server/index.js

# Open
open http://localhost:47900
```

## Features

| Capability | Status | Description |
|-----------|--------|-------------|
| **Intent Router** | ✅ | 20+ intent types, 95-100% accuracy, LLM-powered |
| **Knowledge Graph** | ✅ | SQLite graph: entities, relations, preferences, behavior |
| **File Operations** | ✅ | Search (graph + filesystem), open, organize |
| **Email** | ✅ | Compose via Mail.app or mailto: fallback |
| **Calendar** | ✅ | Query today/week events, create events |
| **Contacts** | ✅ | Sync from macOS, lookup by name/email |
| **Voice Input** | ✅ | whisper.cpp GPU STT (612ms), continuous mode |
| **Voice Output** | ✅ | macOS TTS, natural voice responses |
| **Pattern Learning** | ✅ | Detects habits, time patterns, frequent contacts, action chains |
| **Proactive Suggestions** | ✅ | Anticipates what you might want based on time/context |
| **Plugin System** | ✅ | Drop .js files in ~/.nexus/plugins/, auto-discovered |
| **Browser Extension** | ✅ | Chrome extension: context menus, keyboard shortcuts |
| **Mobile PWA** | ✅ | Installable, offline, share target, push notifications |
| **Observation Mode** | ✅ | Silent app/file tracking builds the graph automatically |
| **Electron Desktop** | ✅ | Frameless window, Alt+Space toggle, .dmg installer |
| **One-Click Install** | ✅ | `bash install.sh` — everything set up automatically |

## Included Plugins

| Plugin | Description |
|--------|-------------|
| **quick-notes** | Save and recall notes via natural language |
| **weather** | Get weather for any city (wttr.in, no API key) |

## Create Your Own Plugin

```javascript
// ~/.nexus/plugins/my-plugin.js
module.exports = {
  name: 'my-plugin',
  version: '0.1.0',
  description: 'Does something cool',

  intents: {
    my_intent: { desc: 'What this intent handles', actions: ['my_action'] },
  },

  actions: {
    async my_action(params, ctx) {
      return { success: true, result: 'Hello from my plugin!' };
    },
  },
};
```

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Node.js 20+ |
| Graph DB | SQLite (better-sqlite3) |
| LLM Router | DeepSeek / Anthropic / Ollama |
| STT | whisper.cpp (Apple Silicon GPU) |
| TTS | macOS `say` |
| Server | WebSocket (ws) + HTTP |
| Desktop | Electron + React + Tailwind |
| Mobile | PWA + Service Worker |
| Process | PM2 |

## Development

```bash
# Run tests
node test-pipeline.js      # Core pipeline
node test-voice.js          # Voice STT/TTS
node test-integration.js    # Full WebSocket system

# Run all services via PM2
npm start

# Check status
pm2 status
pm2 logs nexus-server

# Reload plugins without restart
# Send to WebSocket: { action: "reload_plugins" }
```

## License

MIT
