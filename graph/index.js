// Nexus Graph — the kernel of the OS
// SQLite schema for entities, relations, and behavior tracking

const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.NEXUS_DB_PATH || path.join(require('os').homedir(), '.nexus', 'graph.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db) {
  db.exec(`
    -- Core entity table: anything the system knows about
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,        -- person, file, app, event, topic, note, email, url, routine
      name TEXT NOT NULL,
      path TEXT,                  -- filesystem path (for files/apps)
      metadata TEXT DEFAULT '{}', -- JSON blob for type-specific data
      embedding BLOB,             -- vector embedding for semantic search
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_accessed TEXT
    );

    -- Relationships between entities (the graph edges)
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL, -- owns, contains, sent_by, mentions, depends_on, tagged, scheduled_with, etc.
      weight REAL DEFAULT 1.0,     -- strength of relationship (increases with repeated interactions)
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    -- Every user interaction is logged for pattern learning
    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      raw_input TEXT NOT NULL,          -- what the user said/typed
      classified_intent TEXT NOT NULL,   -- what the LLM classified it as
      params TEXT DEFAULT '{}',          -- extracted parameters
      action_taken TEXT,                 -- which action was executed
      result_summary TEXT,               -- what happened
      user_feedback TEXT,                -- null, 'accepted', 'corrected', 'rejected'
      correction TEXT,                   -- if user corrected, what they said
      context_snapshot TEXT DEFAULT '{}',-- what was in the graph at the time
      latency_ms INTEGER,
      model_used TEXT,
      tokens_used INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- User preferences learned over time
    CREATE TABLE IF NOT EXISTS preferences (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,       -- 0.0–1.0, increases with confirmation
      source TEXT DEFAULT 'inferred',    -- 'explicit', 'inferred', 'learned'
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Indexes for fast lookups
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
    CREATE INDEX IF NOT EXISTS idx_interactions_intent ON interactions(classified_intent);
    CREATE INDEX IF NOT EXISTS idx_interactions_created ON interactions(created_at);
    CREATE INDEX IF NOT EXISTS idx_preferences_key ON preferences(key);
  `);
  console.log('[graph] Database ready at', DB_PATH);
}

// --- Entity CRUD ---

function upsertEntity(type, name, extra = {}) {
  const existing = getDb().prepare('SELECT id FROM entities WHERE type = ? AND name = ? AND path = ?')
    .get(type, name, extra.path || null);
  
  if (existing) {
    getDb().prepare(`UPDATE entities SET metadata = ?, updated_at = datetime('now'), last_accessed = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(extra.metadata || {}), existing.id);
    return existing.id;
  }
  
  const id = uuidv4();
  getDb().prepare(`INSERT INTO entities (id, type, name, path, metadata) VALUES (?, ?, ?, ?, ?)`)
    .run(id, type, name, extra.path || null, JSON.stringify(extra.metadata || {}));
  return id;
}

function getEntity(id) {
  const row = getDb().prepare('SELECT * FROM entities WHERE id = ?').get(id);
  if (row) row.metadata = JSON.parse(row.metadata);
  return row;
}

function findEntities(type, query = {}) {
  let sql = 'SELECT * FROM entities WHERE type = ?';
  const params = [type];
  if (query.name) { sql += ' AND name LIKE ?'; params.push(`%${query.name}%`); }
  if (query.path) { sql += ' AND path LIKE ?'; params.push(`%${query.path}%`); }
  sql += ' ORDER BY last_accessed DESC LIMIT 50';
  const rows = getDb().prepare(sql).all(...params);
  return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

// --- Relations ---

function addRelation(sourceId, targetId, relationType, weight = 1.0, metadata = {}) {
  // Upsert: increase weight if exists
  const existing = getDb().prepare(
    'SELECT id, weight FROM relations WHERE source_id = ? AND target_id = ? AND relation_type = ?'
  ).get(sourceId, targetId, relationType);
  
  if (existing) {
    getDb().prepare('UPDATE relations SET weight = weight + ?, metadata = ? WHERE id = ?')
      .run(weight, JSON.stringify(metadata), existing.id);
    return existing.id;
  }
  
  const id = uuidv4();
  getDb().prepare('INSERT INTO relations (id, source_id, target_id, relation_type, weight, metadata) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, sourceId, targetId, relationType, weight, JSON.stringify(metadata));
  return id;
}

function getRelated(sourceId, relationType = null, depth = 1) {
  let sql = `SELECT e.*, r.relation_type, r.weight as relation_weight FROM relations r 
             JOIN entities e ON r.target_id = e.id 
             WHERE r.source_id = ?`;
  const params = [sourceId];
  if (relationType) { sql += ' AND r.relation_type = ?'; params.push(relationType); }
  sql += ' ORDER BY r.weight DESC LIMIT 100';
  const rows = getDb().prepare(sql).all(...params);
  return rows.map(r => ({ ...r, metadata: JSON.parse(r.metadata) }));
}

function findPath(fromId, toId, maxDepth = 4) {
  // BFS through the graph to find shortest path
  const visited = new Set([fromId]);
  const queue = [[fromId, []]];
  
  while (queue.length > 0) {
    const [currentId, pathSoFar] = queue.shift();
    if (pathSoFar.length >= maxDepth) continue;
    
    const relations = getDb().prepare(
      'SELECT target_id, relation_type FROM relations WHERE source_id = ?'
    ).all(currentId);
    
    for (const rel of relations) {
      if (rel.target_id === toId) {
        return [...pathSoFar, { from: currentId, to: toId, via: rel.relation_type }];
      }
      if (!visited.has(rel.target_id)) {
        visited.add(rel.target_id);
        queue.push([rel.target_id, [...pathSoFar, { from: currentId, to: rel.target_id, via: rel.relation_type }]]);
      }
    }
  }
  return null; // no path found
}

// --- Interactions ---

function logInteraction(data) {
  const id = uuidv4();
  getDb().prepare(`INSERT INTO interactions (id, raw_input, classified_intent, params, action_taken, result_summary, user_feedback, correction, context_snapshot, latency_ms, model_used, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, data.rawInput, data.intent, JSON.stringify(data.params || {}), 
      data.action, data.result || null, data.feedback || null, data.correction || null,
      JSON.stringify(data.context || {}), data.latencyMs || null, data.modelUsed || null, data.tokensUsed || null);
  return id;
}

function getRecentInteractions(limit = 20) {
  return getDb().prepare('SELECT * FROM interactions ORDER BY created_at DESC LIMIT ?').all(limit);
}

// --- Preferences ---

function setPreference(key, value, confidence = 0.5, source = 'inferred') {
  const existing = getDb().prepare('SELECT id, confidence FROM preferences WHERE key = ?').get(key);
  if (existing) {
    const newConfidence = Math.min(1.0, existing.confidence + confidence * 0.2);
    getDb().prepare('UPDATE preferences SET value = ?, confidence = ?, source = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(value, newConfidence, source, existing.id);
  } else {
    getDb().prepare('INSERT INTO preferences (id, key, value, confidence, source) VALUES (?, ?, ?, ?, ?)')
      .run(uuidv4(), key, value, confidence, source);
  }
}

function getPreference(key) {
  return getDb().prepare('SELECT * FROM preferences WHERE key = ?').get(key);
}

function getAllPreferences() {
  return getDb().prepare('SELECT * FROM preferences ORDER BY confidence DESC').all();
}

// --- Graph Stats ---

function getStats() {
  const db = getDb();
  return {
    entities: db.prepare('SELECT COUNT(*) as count FROM entities').get().count,
    relations: db.prepare('SELECT COUNT(*) as count FROM relations').get().count,
    interactions: db.prepare('SELECT COUNT(*) as count FROM interactions').get().count,
    entityTypes: db.prepare('SELECT type, COUNT(*) as count FROM entities GROUP BY type').all(),
    recentInteractions: db.prepare('SELECT COUNT(*) as count FROM interactions WHERE created_at > datetime(\'now\', \'-1 day\')').get().count,
  };
}

// --- Context for LLM ---

function getContextForIntent(rawInput) {
  // Build a context object the LLM can use to resolve ambiguity
  const recent = getRecentInteractions(5);
  const prefs = getAllPreferences();
  const stats = getStats();
  
  // Try to find relevant entities by name matching
  const words = rawInput.toLowerCase().split(/\s+/);
  const relevantEntities = [];
  for (const word of words) {
    if (word.length > 2) {
      const matches = getDb().prepare(
        'SELECT * FROM entities WHERE LOWER(name) LIKE ? LIMIT 5'
      ).all(`%${word}%`);
      relevantEntities.push(...matches.map(r => ({ ...r, metadata: JSON.parse(r.metadata) })));
    }
  }
  
  return {
    recentInteractions: recent.map(i => i.raw_input),
    preferences: prefs,
    relevantEntities: [...new Map(relevantEntities.map(e => [e.id, e])).values()].slice(0, 20),
    stats,
  };
}

module.exports = {
  getDb,
  migrate,
  upsertEntity,
  getEntity,
  findEntities,
  addRelation,
  getRelated,
  findPath,
  logInteraction,
  getRecentInteractions,
  setPreference,
  getPreference,
  getAllPreferences,
  getStats,
  getContextForIntent,
};
