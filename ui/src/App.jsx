import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, Mic, Sparkles, Settings, Minimize2, Maximize2, X,
  Clock, FileText, Users, Calendar, Globe, Terminal,
  ChevronRight, Check, X as XIcon, ThumbsUp, ThumbsDown,
  Loader2, Send, MicOff, Brain, BarChart3, Lightbulb,
  RefreshCw, Volume2, Zap
} from 'lucide-react';

// ─── Title Bar ───
function TitleBar({ status }) {
  return (
    <div className="fixed top-0 left-0 right-0 h-10 flex items-center justify-between px-3 z-50"
         style={{ WebkitAppRegion: 'drag' }}>
      <div className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-nexus-accent" />
        <span className="text-sm font-medium text-nexus-muted">Nexus</span>
        <div className={`w-2 h-2 rounded-full ${
          status === 'connected' ? 'bg-nexus-success' :
          status === 'connecting' ? 'bg-nexus-warning animate-pulse' :
          'bg-nexus-error'
        }`} />
      </div>
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' }}>
        <button className="p-1.5 rounded hover:bg-nexus-border/50 text-nexus-muted">
          <Minimize2 className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 rounded hover:bg-nexus-border/50 text-nexus-muted">
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <button className="p-1.5 rounded hover:bg-red-500/80 text-nexus-muted hover:text-white">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Proactive Suggestions ───
function SuggestionsPanel({ suggestions, onSelect, onRefresh }) {
  if (!suggestions || suggestions.length === 0) return null;
  
  return (
    <div className="flex items-center gap-2 mb-3 animate-fade-in">
      <Lightbulb className="w-3.5 h-3.5 text-nexus-warning shrink-0" />
      <div className="flex gap-1.5 flex-wrap">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSelect(s.text)}
            className="text-xs px-2.5 py-1 rounded-full border border-nexus-border/50 
                       hover:bg-nexus-accent/10 hover:border-nexus-accent/30 
                       text-nexus-muted hover:text-nexus-text
                       transition-all duration-200 whitespace-nowrap"
            title={`Confidence: ${Math.round(s.confidence * 100)}%`}
          >
            {s.text}
          </button>
        ))}
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded-full text-nexus-muted hover:text-nexus-text"
          title="Refresh suggestions"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Result Card ───
function ResultCard({ message, type = 'info', children }) {
  const colors = {
    thinking: 'border-l-nexus-accent bg-nexus-accent/5',
    routed: 'border-l-nexus-accent-glow bg-nexus-accent/5',
    executing: 'border-l-nexus-warning bg-nexus-warning/5',
    result: 'border-l-nexus-success bg-nexus-success/5',
    error: 'border-l-nexus-error bg-nexus-error/5',
    clarify: 'border-l-nexus-warning bg-nexus-warning/5',
    user: 'border-l-nexus-accent bg-nexus-accent/10',
    briefing: 'border-l-nexus-accent-glow bg-nexus-surface',
    info: 'border-l-nexus-border bg-nexus-surface',
  };

  return (
    <div className={`result-card border-l-2 ${colors[type] || colors.info}`}>
      <div className="flex items-start gap-3">
        {type === 'thinking' && <Loader2 className="w-4 h-4 text-nexus-accent animate-spin mt-0.5" />}
        {type === 'executing' && <Zap className="w-4 h-4 text-nexus-warning mt-0.5" />}
        {type === 'result' && <Check className="w-4 h-4 text-nexus-success mt-0.5" />}
        {type === 'error' && <XIcon className="w-4 h-4 text-nexus-error mt-0.5" />}
        {type === 'clarify' && <Search className="w-4 h-4 text-nexus-warning mt-0.5" />}
        {type === 'briefing' && <BarChart3 className="w-4 h-4 text-nexus-accent mt-0.5" />}
        {type === 'user' && <ChevronRight className="w-4 h-4 text-nexus-accent mt-0.5" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm whitespace-pre-wrap break-words">
            {typeof message === 'string' ? message : JSON.stringify(message, null, 2)}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── Stats Bar ───
function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="flex gap-4 text-xs text-nexus-muted">
      <span title="Entities in knowledge graph">📁 {stats.entities}</span>
      <span title="Relationships learned">🔗 {stats.relations}</span>
      <span title="Total interactions">💬 {stats.interactions}</span>
      <span title="Today's activity">📅 {stats.recentInteractions}</span>
    </div>
  );
}

// ─── Voice Button ───
function VoiceButton({ onTranscript, disabled }) {
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        // In a full Electron app, save blob and send to server
        // For now, use Web Speech API as fallback
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        if (recognition) {
          recognition.onresult = (e) => {
            const text = e.results[0][0].transcript;
            onTranscript(text);
          };
          recognition.onerror = () => {
            // Silently fail — user can type instead
          };
          recognition.start();
        }
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.current.start();
      setRecording(true);
      setTimeout(() => {
        if (mediaRecorder.current?.state === 'recording') {
          mediaRecorder.current.stop();
          setRecording(false);
        }
      }, 5000);
    } catch {
      // Fallback to Web Speech
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      if (recognition) {
        recognition.onresult = (e) => {
          onTranscript(e.results[0][0].transcript);
        };
        recognition.start();
        setRecording(true);
        setTimeout(() => setRecording(false), 5000);
      }
    }
  };

  return (
    <button
      onClick={startRecording}
      disabled={disabled || recording}
      className={`p-1.5 rounded-lg transition-all duration-200 ${
        recording 
          ? 'bg-red-500/20 text-red-400 animate-pulse' 
          : 'bg-nexus-border/30 hover:bg-nexus-accent/20 text-nexus-muted hover:text-nexus-accent'
      }`}
      title="Voice input"
    >
      {recording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </button>
  );
}

// ─── Main App ───
export default function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [stats, setStats] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const wsRef = useRef(null);
  const inputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Connect to Nexus server
  const connect = useCallback(() => {
    const ws = new WebSocket('ws://localhost:47900');
    
    ws.onopen = () => {
      setStatus('connected');
      wsRef.current = ws;
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      setTimeout(connect, 2000);
    };

    ws.onerror = () => setStatus('error');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'connected') {
        setStats(data.stats);
        if (data.suggestions?.length > 0) {
          setSuggestions(data.suggestions);
        }
        return;
      }

      if (data.type === 'suggestions') {
        setSuggestions(data.suggestions || []);
        return;
      }

      if (data.type === 'briefing') {
        setMessages(prev => [...prev, { type: 'briefing', message: formatBriefing(data.briefing), id: 'briefing-' + Date.now() }]);
        return;
      }

      if (data.type === 'stats') {
        setStats(data.stats);
        return;
      }

      // Route events to the message timeline
      if (['thinking', 'routed', 'executing', 'result', 'error', 'clarify'].includes(data.type)) {
        setMessages(prev => {
          // Replace thinking/routed/executing with final result for cleaner UI
          if (data.type === 'result' || data.type === 'error') {
            const filtered = prev.filter(m => !['thinking', 'routed', 'executing'].includes(m.type) || m.id !== data.id);
            return [...filtered, { ...data, id: data.id || Date.now().toString() }];
          }
          return [...prev, { ...data, id: data.id || Date.now().toString() }];
        });
        if (data.type === 'result' || data.type === 'error') {
          setIsProcessing(false);
        }
      }

      if (data.type === 'transcript') {
        setInput(data.text);
        inputRef.current?.focus();
      }
    };
  }, []);

  useEffect(() => { connect(); return () => wsRef.current?.close(); }, [connect]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const sendIntent = useCallback((text) => {
    if (!text.trim() || isProcessing) return;

    setMessages(prev => [...prev, {
      type: 'user',
      message: text,
      id: 'user-' + Date.now(),
    }]);

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setIsProcessing(true);
      wsRef.current.send(JSON.stringify({
        id: Date.now().toString(),
        action: 'intent',
        payload: { text },
      }));
    } else {
      setMessages(prev => [...prev, {
        type: 'error',
        message: 'Not connected. Make sure Nexus server is running.',
        id: 'err-' + Date.now(),
      }]);
    }

    setInput('');
    inputRef.current?.focus();
  }, [isProcessing]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendIntent(input);
    }
  };

  const refreshSuggestions = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ id: 'sug-' + Date.now(), action: 'suggestions' }));
    }
  };

  const sendFeedback = (messageId, feedback, correction) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        id: 'fb-' + Date.now(),
        action: 'feedback',
        payload: { interactionId: messageId, feedback, correction },
      }));
    }
  };

  const handleVoiceTranscript = (text) => {
    if (text) {
      setInput(text);
      setTimeout(() => sendIntent(text), 300);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-nexus-bg">
      <TitleBar status={status} />

      {/* Main content */}
      <div className="flex-1 flex flex-col pt-10 overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-nexus-accent/10 flex items-center justify-center animate-pulse-glow">
                <Brain className="w-10 h-10 text-nexus-accent" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-nexus-text mb-2">Nexus understands you</h1>
                <p className="text-nexus-muted max-w-md">
                  Just type or speak naturally. No menus. No file systems. No learning curves.
                </p>
              </div>

              {/* Suggestions */}
              <SuggestionsPanel 
                suggestions={suggestions} 
                onSelect={sendIntent}
                onRefresh={refreshSuggestions}
              />

              {/* Quick Actions */}
              <div className="flex gap-2 flex-wrap justify-center">
                {[
                  { icon: FileText, label: 'Find files', query: 'find my recent documents' },
                  { icon: Users, label: 'Contacts', query: 'show my contacts' },
                  { icon: Calendar, label: 'Schedule', query: 'schedule a meeting tomorrow' },
                  { icon: Globe, label: 'Search web', query: 'search the web for ' },
                ].map(({ icon: Icon, label, query }) => (
                  <button
                    key={label}
                    onClick={() => sendIntent(query)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-nexus-border/50 
                               hover:bg-nexus-border/30 hover:border-nexus-accent/30 transition-all
                               text-sm text-nexus-muted hover:text-nexus-text"
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {stats && (
                <div className="mt-2">
                  <StatsBar stats={stats} />
                </div>
              )}
            </div>
          )}

          {/* Suggestions at top when messages exist */}
          {messages.length > 0 && suggestions.length > 0 && (
            <SuggestionsPanel 
              suggestions={suggestions} 
              onSelect={sendIntent}
              onRefresh={refreshSuggestions}
            />
          )}

          {/* Message timeline */}
          {messages.map((msg, i) => {
            if (msg.type === 'user') {
              return (
                <div key={msg.id} className="flex justify-end animate-fade-in">
                  <div className="glass rounded-2xl rounded-br-md px-4 py-3 max-w-lg">
                    <p className="text-sm">{msg.message}</p>
                  </div>
                </div>
              );
            }

            if (msg.type === 'briefing') {
              return (
                <ResultCard key={msg.id} message={''} type="briefing">
                  <div className="text-sm whitespace-pre-wrap">{msg.message}</div>
                </ResultCard>
              );
            }

            const labels = {
              thinking: 'Thinking...',
              routed: `Intent: ${msg.intent?.replace(/_/g, ' ') || '...'}`,
              executing: msg.message || 'Working...',
              result: msg.message || (msg.success ? 'Done!' : 'Something went wrong'),
              error: msg.message || 'Error',
              clarify: msg.message || 'Can you clarify?',
            };

            return (
              <div key={msg.id} className="animate-fade-in">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-3 h-3 text-nexus-accent" />
                  <span className="text-xs text-nexus-muted">
                    {labels[msg.type]}
                    {msg.confidence && ` (${Math.round(msg.confidence * 100)}%)`}
                  </span>
                </div>
                <ResultCard message={msg.result || msg.message || ''} type={msg.type}>
                  {/* Feedback buttons on results */}
                  {msg.type === 'result' && (
                    <div className="flex gap-2 mt-3 pt-2 border-t border-nexus-border/30">
                      <button
                        onClick={() => sendFeedback(msg.id, 'accepted')}
                        className="text-xs flex items-center gap-1 text-nexus-muted hover:text-nexus-success transition-colors"
                      >
                        <ThumbsUp className="w-3 h-3" /> Helpful
                      </button>
                      <button
                        onClick={() => {
                          const correction = prompt('What did you mean instead?');
                          if (correction) sendFeedback(msg.id, 'corrected', correction);
                        }}
                        className="text-xs flex items-center gap-1 text-nexus-muted hover:text-nexus-warning transition-colors"
                      >
                        <ThumbsDown className="w-3 h-3" /> Not what I meant
                      </button>
                    </div>
                  )}
                </ResultCard>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Intent input bar */}
        <div className="px-6 pb-6 pt-2">
          <div className="max-w-2xl mx-auto">
            <div className="relative">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <Search className="w-5 h-5 text-nexus-muted" />
              </div>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isProcessing ? 'Working...' : 'What would you like to do?'}
                className="intent-bar pl-14 pr-24"
                disabled={isProcessing}
                autoFocus
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <VoiceButton 
                  onTranscript={handleVoiceTranscript} 
                  disabled={isProcessing}
                />
                <button
                  onClick={() => sendIntent(input)}
                  disabled={!input.trim() || isProcessing}
                  className="p-1.5 rounded-lg bg-nexus-accent/20 hover:bg-nexus-accent/40 
                             text-nexus-accent disabled:opacity-30 disabled:cursor-not-allowed
                             transition-all duration-200"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 px-1">
              <StatsBar stats={stats} />
              <span className="text-xs text-nexus-muted">
                {status === 'connected' ? '🟢 Connected' : status === 'connecting' ? '🟡 Connecting...' : '🔴 Offline'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Format briefing data for display
function formatBriefing(briefing) {
  if (!briefing) return 'No briefing data available.';
  
  const lines = [
    `📅 **${briefing.date}** — Here's your briefing:`,
    '',
    `💬 **${briefing.totalInteractions}** interactions today`,
    '',
  ];

  if (briefing.topIntents?.length > 0) {
    lines.push('**Top activities:**');
    briefing.topIntents.forEach(i => {
      lines.push(`  • ${i.classified_intent.replace(/_/g, ' ')} (${i.c} times)`);
    });
  }

  if (briefing.suggestions?.length > 0) {
    lines.push('');
    lines.push('**Suggestions:**');
    briefing.suggestions.slice(0, 3).forEach(s => {
      lines.push(`  💡 ${s.text}`);
    });
  }

  return lines.join('\n');
}
