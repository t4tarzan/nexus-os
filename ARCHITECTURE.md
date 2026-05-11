# Nexus — The OS That Understands You

## Philosophy

Traditional OS: You learn it. Nexus: It learns you.

Every interaction builds a graph of who you are, what you care about, and how you work. The interface is a single text/voice input. No menus. No file systems. No learning curves.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   INPUT LAYER                         │
│   Voice (Whisper)  |  Text  |  @mentions  |  Drag    │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│               INTENT ROUTER (core/)                   │
│   LLM classifies intent → queries graph → picks action│
│   intent types: query, create, modify, send, schedule,│
│   search, summarize, automate, connect                │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│              KNOWLEDGE GRAPH (graph/)                 │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│   │ ENTITIES │ │RELATIONS │ │ BEHAVIOR │            │
│   │ People   │ │ owns     │ │ Patterns │            │
│   │ Files    │ │ sent_by  │ │ Prefs    │            │
│   │ Apps     │ │ tagged   │ │ History  │            │
│   │ Events   │ │ depends  │ │ Context  │            │
│   │ Topics   │ │ follows  │ │ Habits   │            │
│   └──────────┘ └──────────┘ └──────────┘            │
│                                                       │
│   Storage: SQLite + vector embeddings (LanceDB)       │
│   Indexes: filesystem watcher, calendar sync,          │
│            email parser, browser history               │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│               ACTION LAYER (actions/)                 │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ │
│   │  FILE   │ │  EMAIL  │ │ CALENDAR│ │  BROWSER │ │
│   │ops      │ │compose  │ │schedule │ │  open    │ │
│   │search   │ │read     │ │query    │ │  search  │ │
│   │organize │ │summarize│ │conflict │ │  fill    │ │
│   └─────────┘ └─────────┘ └─────────┘ └──────────┘ │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ │
│   │  NOTES  │ │  MEDIA  │ │ COMMAND │ │ AUTOMATE │ │
│   │create   │ │play     │ │run      │ │workflow  │ │
│   │link     │ │edit     │ │chain    │ │cron      │ │
│   │recall   │ │convert  │ │monitor  │ │trigger   │ │
│   └─────────┘ └─────────┘ └─────────┘ └──────────┘ │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│               SERVER (server/)                        │
│   WebSocket for real-time | HTTP for actions          │
│   PM2-managed | localhost:47900                       │
└──────────────────────┬───────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────┐
│               UI (ui/)                                │
│   Desktop shell: Electron + React                     │
│   Looks like: familiar windows/desktop metaphor       │
│   Actually: single intent bar that floats             │
│   Panels appear contextually, not by user navigation  │
└──────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Knowledge Graph is the Kernel
Not the filesystem. Everything the system knows about you is in the graph. Files are just one type of node. Relationships are first-class citizens.

### 2. Intent-First, Not Tool-First
User says "Send the contract to Sarah" — the system figures out:
- Which contract (most recent .pdf matching "contract" in the user's context)
- Which Sarah (Sarah from the Zoom call yesterday, not Sarah from marketing)
- How to send (email, because that's how the user has sent things to Sarah before)
- Draft first, confirm, send

### 3. Progressive Learning
Day 1: System is dumb but functional. Works like a search bar.
Week 1: System knows your frequent contacts, common files, work hours.
Month 1: System anticipates. "You usually send the weekly report on Friday — want me to draft it?"

### 4. Local-First, Cloud-Optional
Core runs 100% locally. LLM calls go to provider (DeepSeek, Anthropic, local Ollama). User data never leaves the machine except for LLM inference. The graph is local SQLite.

### 5. Failure is Visible
Unlike autonomous agents that silently fail, every Nexus action shows what it did and why. The user can always say "No, I meant..." and the correction updates the graph.

## Stack

| Layer | Tech | Why |
|-------|------|-----|
| Graph DB | SQLite + better-sqlite3 | Zero setup, fast, embedded |
| Vector store | LanceDB | Embedded, no server, fast ANN |
| Embeddings | all-MiniLM-L6-v2 (local) | Free, fast, good enough for intent |
| LLM Router | DeepSeek / Anthropic / Ollama | Configurable |
| Speech | Whisper (local via whisper.cpp) | No cloud dependency |
| TTS | Piper TTS (local) | Fast, natural enough |
| Server | Node.js + ws | Already in your stack |
| UI | Electron + React + Tailwind | Cross-platform, familiar |
| Process | PM2 | Already in your stack |
| Watchers | chokidar | File system monitoring |

## Development Phases

### Phase 1: Core Pipeline (This Session)
- [x] Architecture spec
- [ ] Graph schema + SQLite setup
- [ ] Intent router with LLM
- [ ] File action (search, open, organize)
- [ ] Basic WebSocket server
- [ ] Minimal Electron shell with intent bar

### Phase 2: Real World
- [ ] Email integration (local Mail.app or Gmail API)
- [ ] Calendar integration (local Calendar.app or Google)
- [ ] Contacts sync
- [ ] Browser history ingestion
- [ ] File watcher → auto-index

### Phase 3: Intelligence
- [ ] Pattern learning (you do X every Friday)
- [ ] Proactive suggestions
- [ ] Voice input/output
- [ ] Custom workflows (user teaches system)
- [ ] Cross-app context (this file → that email → that calendar event)

### Phase 4: OS
- [ ] One-click installer for macOS/Windows
- [ ] Full desktop environment (launcher, file manager substitute, settings)
- [ ] App ecosystem (plugins for Notion, Slack, etc.)
- [ ] Knowledge graph visualization
