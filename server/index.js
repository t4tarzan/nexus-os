// Nexus Server — WebSocket-based command center
// Connects the UI to the router + actions + graph

// ─── Crash Protection ───
process.on('uncaughtException', (err) => {
  console.error('[server] UNCAUGHT:', err.message);
  // Don't crash — log and continue
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] UNHANDLED REJECTION:', reason?.message || reason);
});

const { WebSocketServer } = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const graph = require('../graph');
const { routeIntent, quickClassify } = require('../core/router');
const { executeAction } = require('../actions');
const { getSuggestions, getMorningBriefing, learnFromCorrection } = require('../core/learn');
const voice = require('../actions/voice');
const InteractiveVoice = require('../actions/interactive-voice');
const { loadPlugins, getCustomIntents, getCustomActions, getLoadedPlugins, reloadPlugins } = require('../core/plugins');

const PORT = process.env.NEXUS_PORT || 47900;

// Initialize the graph database
graph.migrate(graph.getDb());
console.log('[server] Nexus server starting...');

// Load plugins
const pluginInfo = loadPlugins();
console.log(`[server] Plugins: ${pluginInfo.plugins.map(p => p.name).join(', ') || 'none'}`);

// Create HTTP server (for health checks and static serving)
const server = http.createServer((req, res) => {
  // CORS headers for browser
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  }

  // REST API for browser extension & external apps
  if (req.url === '/api/send' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { text } = JSON.parse(body);
        if (!text) throw new Error('No text provided');

        const routing = await routeIntent(text);
        const result = await executeAction(routing);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: result.success, result: result.result, intent: routing.intent, error: result.error }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // Graph stats endpoint
  if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(graph.getStats()));
  }

  // Recent interactions
  if (req.url === '/history') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(graph.getRecentInteractions(50)));
  }

  // Serve static UI files
  const uiPath = path.join(__dirname, '..', 'ui', 'dist');
  if (fs.existsSync(uiPath)) {
    const filePath = req.url === '/' ? path.join(uiPath, 'index.html') : path.join(uiPath, req.url);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return res.end(fs.readFileSync(filePath));
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[server] Client connected');
  
  // Send welcome message with current state + proactive suggestions
  const stats = graph.getStats();
  const suggestions = getSuggestions();
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Welcome to Nexus',
    stats,
    suggestions,
  }));

  ws.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      return;
    }

    const { id, action, payload } = msg;

    switch (action) {
      case 'intent': {
        try {
          // User sent a text/voice input — route it
          const rawInput = payload.text;
          if (!rawInput) {
            ws.send(JSON.stringify({ id, type: 'error', message: 'No text provided' }));
            return;
          }

          // Send thinking state
          ws.send(JSON.stringify({ id, type: 'thinking', message: 'Understanding...' }));

          // Try quick classification first (no LLM call)
          let routing = quickClassify(rawInput);
          
          if (!routing) {
            // Need LLM for classification
            routing = await routeIntent(rawInput);
          }

          // If there are ambiguities, ask for clarification
          if (routing.ambiguities && routing.ambiguities.length > 0 && routing.confidence < 0.7) {
            ws.send(JSON.stringify({
              id,
              type: 'clarify',
              intent: routing.intent,
              ambiguities: routing.ambiguities,
              message: `I'm not sure about: ${routing.ambiguities.join('; ')}`,
            }));
            return;
          }

          // Send routing result
          ws.send(JSON.stringify({
            id,
            type: 'routed',
            intent: routing.intent,
            confidence: routing.confidence,
            params: routing.params,
            reasoning: routing.reasoning,
          }));

          // Execute the action
          ws.send(JSON.stringify({ id, type: 'executing', message: `Running ${routing.intent}...` }));
          
          const result = await executeAction(routing);

          // Send result
          ws.send(JSON.stringify({
            id,
            type: 'result',
            success: result.success,
            intent: routing.intent,
            result: result.result,
            count: result.count,
            results: result.results?.slice(0, 10),
            error: result.error,
            truncated: result.truncated,
            message: result.message,
          }));
        } catch (err) {
          console.error('[server] Intent error:', err.message);
          ws.send(JSON.stringify({
            id,
            type: 'error',
            message: `Something went wrong: ${err.message}`,
          }));
        }
        break;
      }

      case 'feedback': {
        // User corrected something or gave feedback
        const { interactionId, feedback, correction } = payload;
        graph.logInteraction({
          rawInput: '(feedback)',
          intent: 'feedback',
          params: {},
          action: 'learn_from_feedback',
          feedback: feedback || 'corrected',
          correction: correction || '',
        });
        
        // Learn from correction
        if (correction && feedback === 'corrected') {
          learnFromCorrection(payload.originalIntent || '', payload.correctedIntent || '', correction);
        }

        ws.send(JSON.stringify({
          id,
          type: 'feedback_received',
          message: 'Got it. I\'ll learn from that.',
        }));
        break;
      }

      case 'stats': {
        ws.send(JSON.stringify({
          id,
          type: 'stats',
          stats: graph.getStats(),
        }));
        break;
      }

      case 'history': {
        ws.send(JSON.stringify({
          id,
          type: 'history',
          interactions: graph.getRecentInteractions(payload.limit || 20),
        }));
        break;
      }

      case 'search': {
        // Direct unified search
        const searchResult = await executeAction({
          intent: 'search_everything',
          params: { query: payload.query },
          rawInput: payload.query,
        });
        ws.send(JSON.stringify({
          id,
          type: 'result',
          success: searchResult.success,
          result: searchResult.result,
        }));
        break;
      }

      case 'graph_query': {
        // Query the knowledge graph directly
        if (payload.entityId) {
          const entity = graph.getEntity(payload.entityId);
          const related = graph.getRelated(payload.entityId, payload.relationType);
          ws.send(JSON.stringify({
            id,
            type: 'graph_result',
            entity,
            related,
          }));
        }
        break;
      }

      case 'suggestions': {
        const suggestions = getSuggestions();
        ws.send(JSON.stringify({ id, type: 'suggestions', suggestions }));
        break;
      }

      case 'briefing': {
        const briefing = getMorningBriefing();
        ws.send(JSON.stringify({ id, type: 'briefing', briefing }));
        break;
      }

      case 'voice': {
        // Full voice pipeline: record → transcribe → intent → execute
        ws.send(JSON.stringify({ id, type: 'status', message: '🎤 Listening...' }));
        try {
          const voiceResult = await voice.voiceToIntent(
            (text) => routeIntent(text),
            (routing) => executeAction(routing)
          );
          
          if (voiceResult.success) {
            ws.send(JSON.stringify({
              id,
              type: 'voice_result',
              transcript: voiceResult.transcript,
              intent: voiceResult.intent,
              confidence: voiceResult.confidence,
              result: voiceResult.result,
              latencyMs: voiceResult.latencyMs,
            }));
          } else {
            ws.send(JSON.stringify({ id, type: 'error', message: voiceResult.error }));
          }
        } catch (e) {
          ws.send(JSON.stringify({ id, type: 'error', message: 'Voice pipeline error: ' + e.message }));
        }
        break;
      }

      case 'voice_mode': {
        // Toggle interactive voice chat mode
        const iv = new InteractiveVoice();
        
        if (payload.enable) {
          if (!iv.isActive) {
            await iv.start(
              (text) => routeIntent(text),
              (routing) => executeAction(routing),
              (text) => voice.speak(text)
            );
            
            // Forward events to WebSocket
            iv.on('state', (state) => {
              ws.send(JSON.stringify({ id: 'iv-' + Date.now(), type: 'voice_state', state }));
            });
            iv.on('transcript', (text) => {
              ws.send(JSON.stringify({ id: 'iv-' + Date.now(), type: 'voice_heard', text }));
            });
            iv.on('response', (data) => {
              ws.send(JSON.stringify({
                id: 'iv-' + Date.now(),
                type: 'voice_response',
                transcript: data.transcript,
                intent: data.intent,
                result: data.result,
              }));
            });
            
            ws.send(JSON.stringify({ id, type: 'voice_state', state: 'listening' }));
          }
        } else {
          iv.stop();
          ws.send(JSON.stringify({ id, type: 'voice_state', state: 'idle' }));
        }
        break;
      }

      case 'speak': {
        // Text to speech
        const spoken = await voice.speak(payload.text);
        ws.send(JSON.stringify({ id, type: 'spoken', success: spoken }));
        break;
      }

      case 'voice_status': {
        ws.send(JSON.stringify({ id, type: 'voice_status', status: voice.getVoiceStatus() }));
        break;
      }

      case 'install_whisper': {
        ws.send(JSON.stringify({ id, type: 'status', message: 'whisper.cpp already installed', installed: true }));
        break;
      }

      case 'learn': {
        // Manual learning: user teaches a pattern
        learnFromCorrection(
          payload.original || '',
          payload.corrected || '',
          payload.correction || ''
        );
        ws.send(JSON.stringify({ id, type: 'learned', message: 'Pattern learned' }));
        break;
      }

      case 'plugins': {
        ws.send(JSON.stringify({
          id,
          type: 'plugins',
          plugins: getLoadedPlugins(),
          intents: Object.keys(getCustomIntents()),
          actions: Object.keys(getCustomActions()),
        }));
        break;
      }

      case 'reload_plugins': {
        const info = reloadPlugins();
        ws.send(JSON.stringify({
          id,
          type: 'plugins_reloaded',
          plugins: info.plugins,
          intents: Object.keys(info.intents),
          actions: Object.keys(info.actions),
        }));
        break;
      }

      case 'observer': {
        // Start/stop observation mode
        const observer = require('../core/observer');
        if (payload.start) {
          observer.start();
          ws.send(JSON.stringify({ id, type: 'observer_status', status: observer.getStatus() }));
        } else if (payload.stop) {
          observer.stop();
          ws.send(JSON.stringify({ id, type: 'observer_status', status: observer.getStatus() }));
        } else {
          ws.send(JSON.stringify({ id, type: 'observer_status', status: observer.getStatus() }));
        }
        break;
      }

      default: {
        ws.send(JSON.stringify({ id, type: 'error', message: `Unknown action: ${action}` }));
      }
    }
  });

  ws.on('close', () => {
    console.log('[server] Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('[server] WebSocket error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`[server] Nexus running on http://localhost:${PORT}`);
  console.log(`[server] WebSocket on ws://localhost:${PORT}`);
  console.log(`[server] Graph at ${path.join(require('os').homedir(), '.nexus', 'graph.db')}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});
