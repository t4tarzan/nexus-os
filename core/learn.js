// Nexus Pattern Learning — detects user habits and makes proactive suggestions
// Analyzes interaction history to find patterns: recurring actions, frequent contacts,
// common file operations, time-based routines

const graph = require('../graph');
const db = graph.getDb;

// Patterns we can detect
const PATTERN_TYPES = {
  RECURRING_ACTION: 'recurring_action',     // Same action at same time/day
  FREQUENT_CONTACT: 'frequent_contact',      // Person you interact with often
  COMMON_FILE: 'common_file',               // File you access frequently
  WORK_HOURS: 'work_hours',                 // When you typically use Nexus
  ACTION_CHAIN: 'action_chain',             // Sequence: search → open → send
  TOPIC_CLUSTER: 'topic_cluster',           // Related topics you explore together
};

function analyze() {
  const database = graph.getDb();
  const patterns = [];

  // 1. Detect frequent contacts (people mentioned most)
  const frequentContacts = database.prepare(`
    SELECT 
      json_extract(params, '$.to') as person,
      COUNT(*) as count,
      MAX(created_at) as last_seen
    FROM interactions 
    WHERE classified_intent = 'send_email' 
      AND json_extract(params, '$.to') IS NOT NULL
    GROUP BY person
    HAVING count >= 2
    ORDER BY count DESC
    LIMIT 10
  `).all();

  for (const c of frequentContacts) {
    patterns.push({
      type: PATTERN_TYPES.FREQUENT_CONTACT,
      person: c.person,
      frequency: c.count,
      lastSeen: c.last_seen,
      suggestion: `Send email to ${c.person}`,
    });
  }

  // 2. Detect time-based routines (same intent at same hour)
  const timePatterns = database.prepare(`
    SELECT 
      classified_intent,
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      COUNT(*) as count
    FROM interactions
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY classified_intent, hour
    HAVING count >= 2
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const intentNames = {
    query_file: 'Search files',
    send_email: 'Send email',
    calendar_query: 'Check calendar',
    create_event: 'Schedule event',
    query_person: 'Look up contact',
    web_search: 'Search web',
    chat: 'General query',
  };

  for (const p of timePatterns) {
    const label = intentNames[p.classified_intent] || p.classified_intent;
    const hourLabel = p.hour < 12 ? `${p.hour}am` : p.hour === 12 ? '12pm' : `${p.hour - 12}pm`;
    patterns.push({
      type: PATTERN_TYPES.RECURRING_ACTION,
      intent: p.classified_intent,
      hour: p.hour,
      frequency: p.count,
      suggestion: `You often ${label.toLowerCase()} around ${hourLabel}`,
    });
  }

  // 3. Detect common files (files searched/opened most)
  const commonFiles = database.prepare(`
    SELECT 
      json_extract(params, '$.fileName') as file_query,
      COUNT(*) as count,
      MAX(created_at) as last_seen
    FROM interactions
    WHERE classified_intent = 'query_file'
      AND json_extract(params, '$.fileName') IS NOT NULL
      AND created_at > datetime('now', '-30 days')
    GROUP BY file_query
    HAVING count >= 2
    ORDER BY count DESC
    LIMIT 10
  `).all();

  for (const f of commonFiles) {
    patterns.push({
      type: PATTERN_TYPES.COMMON_FILE,
      file: f.file_query,
      frequency: f.count,
      lastSeen: f.last_seen,
      suggestion: `Find "${f.file_query}"`,
    });
  }

  // 4. Detect work hours (when user is most active)
  const hourlyActivity = database.prepare(`
    SELECT 
      CAST(strftime('%H', created_at) AS INTEGER) as hour,
      COUNT(*) as count
    FROM interactions
    WHERE created_at > datetime('now', '-7 days')
    GROUP BY hour
    ORDER BY count DESC
  `).all();

  if (hourlyActivity.length >= 3) {
    const topHours = hourlyActivity.slice(0, 3).map(h => h.hour);
    const startHour = Math.min(...topHours);
    const endHour = Math.max(...topHours) + 1;
    
    patterns.push({
      type: PATTERN_TYPES.WORK_HOURS,
      startHour,
      endHour,
      activeHours: topHours,
      suggestion: `Your peak hours are ${startHour}:00-${endHour}:00`,
    });
  }

  // 5. Detect action chains (what follows what)
  const chains = database.prepare(`
    SELECT 
      a.classified_intent as first_action,
      b.classified_intent as second_action,
      COUNT(*) as count
    FROM interactions a
    JOIN interactions b ON b.created_at > a.created_at 
      AND b.created_at < datetime(a.created_at, '+5 minutes')
      AND a.id != b.id
    WHERE a.created_at > datetime('now', '-7 days')
    GROUP BY first_action, second_action
    HAVING count >= 2
    ORDER BY count DESC
    LIMIT 15
  `).all();

  for (const c of chains) {
    patterns.push({
      type: PATTERN_TYPES.ACTION_CHAIN,
      first: c.first_action,
      second: c.second_action,
      frequency: c.count,
      suggestion: `After "${c.first_action}" you often "${c.second_action}"`,
    });
  }

  // Store patterns in graph for later retrieval
  for (const p of patterns) {
    graph.setPreference(
      `pattern:${p.type}:${JSON.stringify(p).slice(0, 100)}`,
      JSON.stringify(p),
      0.3,
      'learned'
    );
  }

  return patterns;
}

// Get proactive suggestions based on current time and context
function getSuggestions() {
  const database = graph.getDb();
  const now = new Date();
  const currentHour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const suggestions = [];

  // Time-based: what user does at this hour
  const timeHabits = database.prepare(`
    SELECT classified_intent, COUNT(*) as count
    FROM interactions
    WHERE CAST(strftime('%H', created_at) AS INTEGER) = ?
      AND created_at > datetime('now', '-14 days')
    GROUP BY classified_intent
    ORDER BY count DESC
    LIMIT 3
  `).all(currentHour);

  const intentLabels = {
    query_file: 'Search for files',
    calendar_query: 'Check your calendar',
    send_email: 'Compose an email',
    create_event: 'Schedule something',
    web_search: 'Search the web',
    query_person: 'Look up a contact',
    unified_search: 'Search everything',
  };

  for (const h of timeHabits) {
    const label = intentLabels[h.classified_intent];
    if (label) suggestions.push({ text: label, confidence: Math.min(0.9, h.count / 5) });
  }

  // Day-of-week patterns
  if (dayOfWeek === 1) suggestions.push({ text: 'Plan your week', confidence: 0.6 }); // Monday
  if (dayOfWeek === 5) suggestions.push({ text: 'Review this week', confidence: 0.6 }); // Friday
  if (dayOfWeek === 0 || dayOfWeek === 6) suggestions.push({ text: 'Organize files', confidence: 0.4 }); // Weekend

  // Get learned patterns from preferences
  const patternPrefs = database.prepare(
    `SELECT value FROM preferences WHERE key LIKE 'pattern:%' ORDER BY confidence DESC LIMIT 5`
  ).all();

  for (const p of patternPrefs) {
    try {
      const pattern = JSON.parse(p.value);
      if (pattern.suggestion) {
        suggestions.push({ text: pattern.suggestion, confidence: 0.5, pattern: true });
      }
    } catch {}
  }

  // Deduplicate
  const seen = new Set();
  return suggestions.filter(s => {
    if (seen.has(s.text)) return false;
    seen.add(s.text);
    return true;
  }).slice(0, 8);
}

// Get a morning briefing
function getMorningBriefing() {
  const database = graph.getDb();
  
  return {
    date: new Date().toISOString().split('T')[0],
    totalInteractions: database.prepare(
      "SELECT COUNT(*) as c FROM interactions WHERE created_at > datetime('now', '-1 day')"
    ).get()?.c || 0,
    topIntents: database.prepare(`
      SELECT classified_intent, COUNT(*) as c FROM interactions 
      WHERE created_at > datetime('now', '-1 day')
      GROUP BY classified_intent ORDER BY c DESC LIMIT 5
    `).all(),
    suggestions: getSuggestions(),
    graphStats: graph.getStats(),
  };
}

// Learn from a correction — the user said "no, I meant X"
function learnFromCorrection(originalIntent, correctedIntent, correction) {
  // Boost the corrected interpretation
  graph.setPreference(
    `correction:${originalIntent}:${correctedIntent}`,
    correction,
    0.5,
    'explicit'
  );

  // Decrease confidence in the wrong classification
  const wrongPattern = graph.getPreference(`pattern:${originalIntent}`);
  if (wrongPattern) {
    graph.setPreference(
      wrongPattern.key,
      wrongPattern.value,
      Math.max(0, (wrongPattern.confidence || 0.3) - 0.1),
      'corrected'
    );
  }

  console.log('[learn] Learned correction:', originalIntent, '→', correctedIntent);
}

module.exports = { analyze, getSuggestions, getMorningBriefing, learnFromCorrection, PATTERN_TYPES };
