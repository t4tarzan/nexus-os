// Nexus Intent Router
// Classifies user input → intent + params → routes to action

const graph = require('../graph');

// Intent taxonomy — what kinds of things users ask for
const INTENT_SCHEMA = {
  query_file:       { desc: 'Find/open/read a file or folder',        actions: ['file_search', 'file_open', 'file_read'] },
  query_person:     { desc: 'Find info about a person/contact',        actions: ['contact_lookup'] },
  query_event:      { desc: 'What/when is an event or meeting',        actions: ['calendar_query'] },
  query_knowledge:  { desc: 'Ask about something the system knows',    actions: ['graph_query'] },
  query_summary:    { desc: 'Summarize something (file, email, etc)',  actions: ['summarize'] },
  
  create_note:      { desc: 'Create a note or document',               actions: ['note_create'] },
  create_file:      { desc: 'Create or generate a file',               actions: ['file_create'] },
  create_event:     { desc: 'Schedule a meeting or event',             actions: ['calendar_create'] },
  
  modify_file:      { desc: 'Edit/rename/move/delete a file',          actions: ['file_edit', 'file_move', 'file_delete'] },
  modify_settings:  { desc: 'Change a system or app setting',          actions: ['settings_change'] },
  
  send_email:       { desc: 'Compose and send an email',               actions: ['email_send'] },
  send_message:     { desc: 'Send a message (SMS, Slack, etc)',        actions: ['message_send'] },
  share_file:       { desc: 'Share a file with someone',               actions: ['file_share'] },
  
  run_command:      { desc: 'Execute a system command or script',      actions: ['shell_run'] },
  open_app:         { desc: 'Launch an application',                   actions: ['app_launch'] },
  open_url:         { desc: 'Open a website or URL',                   actions: ['browser_open'] },
  
  automate:         { desc: 'Set up an automated workflow',            actions: ['workflow_create'] },
  schedule_routine: { desc: 'Schedule a recurring task',               actions: ['routine_create'] },
  
  search_web:       { desc: 'Search the web for something',            actions: ['web_search'] },
  search_everything:{ desc: 'Search across all local data',            actions: ['unified_search'] },
  
  help:             { desc: 'User asks what Nexus can do',             actions: ['show_help'] },
  chat:             { desc: 'Conversational/general query',            actions: ['conversation'] },
  feedback:         { desc: 'User correcting or giving feedback',      actions: ['learn_from_feedback'] },
};

// The system prompt that the LLM uses to classify intent
function buildClassificationPrompt(userInput, context) {
  const relevantEntities = (context.relevantEntities || [])
    .map(e => `  - [${e.type}] ${e.name}${e.path ? ` at ${e.path}` : ''} (id: ${e.id})`)
    .join('\n');
  
  const recentInteractions = (context.recentInteractions || [])
    .map(i => `  - "${i}"`)
    .join('\n');

  // Include plugin intents
  let pluginIntents = '';
  try {
    const { getCustomIntents } = require('../core/plugins');
    const custom = getCustomIntents();
    if (Object.keys(custom).length > 0) {
      pluginIntents = '\n## Plugin Capabilities\n' + Object.entries(custom)
        .map(([k, v]) => `- ${k}: ${v.desc}`)
        .join('\n');
    }
  } catch (_) {}

  return `You are Nexus, an intent router for a personal OS. Your job: classify what the user wants and extract parameters.

## Intent Types
${Object.entries(INTENT_SCHEMA).map(([k, v]) => `- ${k}: ${v.desc}`).join('\n')}${pluginIntents}

## Context from Knowledge Graph
Recent interactions:
${recentInteractions || '  (none yet)'}

Relevant known entities:
${relevantEntities || '  (none matched)'}

Known user preferences: ${JSON.stringify(context.preferences || [])}

## Current time: ${new Date().toISOString()}

## Task
Given the user input, respond with a JSON object containing:
{
  "intent": "one_of_the_intent_types_above",
  "confidence": 0.0_to_1.0,
  "params": {
    // extracted parameters relevant to this intent
    // e.g., for query_file: { "fileName": "contract", "action": "open" }
    // for send_email: { "to": "person_name", "subject": "...", "body": "...", "attachment": "file_name" }
    // for create_event: { "title": "...", "date": "...", "time": "...", "participants": ["..."] }
    // for search_everything: { "query": "..." }
  },
  "ambiguities": [
    // list any things that are ambiguous and need clarification
    // e.g., "Which Sarah? Sarah from work or Sarah your sister?"
  ],
  "reasoning": "brief explanation of classification"
}

## User Input
"${userInput}"

Respond ONLY with the JSON object, no other text.`;
}

// LLM provider interface — pluggable
async function callLLM(prompt, systemPrompt = null) {
  const provider = process.env.NEXUS_LLM_PROVIDER || 'deepseek';
  const model = process.env.NEXUS_LLM_MODEL || 'deepseek-chat';
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY || '';

  const t0 = Date.now();

  if (provider === 'deepseek') {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt || 'You are a precise intent classifier. Respond only with JSON.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.1, // low temp for classification
      }),
    });
    const json = await resp.json();
    return {
      text: json.choices[0].message.content,
      model: json.model,
      tokens: json.usage?.total_tokens,
      latencyMs: Date.now() - t0,
    };
  }

  if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt || 'You are a precise intent classifier. Respond only with JSON.',
      messages: [{ role: 'user', content: prompt }],
    });
    return {
      text: resp.content[0].text,
      model: resp.model,
      tokens: resp.usage.input_tokens + resp.usage.output_tokens,
      latencyMs: Date.now() - t0,
    };
  }

  // Local Ollama fallback
  if (provider === 'ollama') {
    const resp = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        model: model || 'llama3:8b',
        prompt: `${systemPrompt}\n\n${prompt}`,
        stream: false,
      }),
    });
    const json = await resp.json();
    return {
      text: json.response,
      model: model,
      tokens: json.eval_count + (json.prompt_eval_count || 0),
      latencyMs: Date.now() - t0,
    };
  }

  throw new Error(`Unknown LLM provider: ${provider}`);
}

// Parse the LLM's JSON response, handling common failure modes
function parseClassification(raw) {
  // Try direct parse
  try {
    return JSON.parse(raw);
  } catch (_) {}

  // Try extracting from markdown code block
  const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1]); } catch (_) {}
  }

  // Try finding any JSON object
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (_) {}
  }

  // Fallback: treat as chat
  return {
    intent: 'chat',
    confidence: 0.3,
    params: { message: raw },
    ambiguities: [],
    reasoning: 'Failed to parse classification, defaulting to chat',
  };
}

// Main routing function
async function routeIntent(rawInput) {
  const t0 = Date.now();

  // 1. Get context from the knowledge graph
  const context = graph.getContextForIntent(rawInput);

  // 2. Build classification prompt
  const prompt = buildClassificationPrompt(rawInput, context);

  // 3. Call LLM for classification
  const llmResult = await callLLM(prompt);

  // 4. Parse result
  const classification = parseClassification(llmResult.text);
  
  const routingResult = {
    rawInput,
    intent: classification.intent || 'chat',
    confidence: classification.confidence || 0.5,
    params: classification.params || {},
    ambiguities: classification.ambiguities || [],
    reasoning: classification.reasoning || '',
    modelUsed: llmResult.model,
    tokensUsed: llmResult.tokens,
    latencyMs: Date.now() - t0,
  };

  // 5. Log the interaction
  graph.logInteraction({
    rawInput,
    intent: routingResult.intent,
    params: routingResult.params,
    modelUsed: routingResult.model,
    tokensUsed: routingResult.tokens,
    latencyMs: routingResult.latencyMs,
    context,
  });

  return routingResult;
}

// Quick local classification for simple commands (no LLM needed)
function quickClassify(rawInput) {
  const input = rawInput.toLowerCase().trim();

  // Direct commands
  if (input === 'help' || input === 'what can you do') return { intent: 'help', confidence: 1.0, params: {}, ambiguities: [] };
  if (input.startsWith('open ') && !input.includes('http')) return { intent: 'open_app', confidence: 0.9, params: { appName: input.slice(5) }, ambiguities: [] };
  if (input.startsWith('http')) return { intent: 'open_url', confidence: 1.0, params: { url: input }, ambiguities: [] };
  if (input.startsWith('find ') || input.startsWith('search for ')) return { intent: 'query_file', confidence: 0.8, params: { fileName: input.replace(/^(find|search for)\s+/, '') }, ambiguities: [] };
  
  // Patterns that need LLM
  return null;
}

module.exports = { routeIntent, quickClassify, INTENT_SCHEMA, callLLM };
