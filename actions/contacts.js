// Nexus Contacts — reads macOS Contacts app via AppleScript
// Falls back to graph-stored contacts if Contacts.app isn't available

const { exec } = require('child_process');
const graph = require('../graph');

const HOME = require('os').homedir();

// Sync contacts from macOS Contacts.app into the graph
async function syncContacts() {
  return new Promise((resolve) => {
    const script = `
      tell application "Contacts"
        set results to {}
        repeat with p in every person
          set personData to {}
          set personData to personData & "NAME:" & (name of p as string)
          
          -- Emails
          repeat with e in every email of p
            set personData to personData & "|EMAIL:" & (value of e as string) & ":" & (label of e as string)
          end repeat
          
          -- Phones
          repeat with ph in every phone of p
            set personData to personData & "|PHONE:" & (value of ph as string) & ":" & (label of ph as string)
          end repeat
          
          -- Organization
          try
            set orgName to organization of p as string
            if orgName is not "" then
              set personData to personData & "|ORG:" & orgName
            end if
          end try
          
          set results to results & (personData as string) & "\\n"
        end repeat
        return results as string
      end tell
    `;

    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 15000 }, (err, stdout) => {
      if (err) {
        console.log('[contacts] Contacts.app not available, using graph contacts');
        return resolve([]);
      }

      const contacts = [];
      for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('|');
        const name = parts[0]?.replace('NAME:', '');
        const emails = parts.filter(p => p.startsWith('EMAIL:')).map(p => {
          const [, addr, label] = p.split(':');
          return { address: addr, label };
        });
        const phones = parts.filter(p => p.startsWith('PHONE:')).map(p => {
          const [, num, label] = p.split(':');
          return { number: num, label };
        });
        const org = parts.find(p => p.startsWith('ORG:'))?.replace('ORG:', '');

        if (name) {
          contacts.push({ name, emails, phones, organization: org });
          
          // Register in graph
          const entityId = graph.upsertEntity('person', name, {
            metadata: { emails, phones, organization: org },
          });

          // Link people from same org
          if (org) {
            const orgId = graph.upsertEntity('topic', org, { metadata: { type: 'organization' } });
            graph.addRelation(entityId, orgId, 'works_at');
          }
        }
      }

      console.log(`[contacts] Synced ${contacts.length} contacts`);
      resolve(contacts);
    });
  });
}

// Look up a contact by name
function lookupContact(query) {
  const db = graph.getDb();
  
  // Search by name (exact then fuzzy)
  let rows = db.prepare(
    `SELECT * FROM entities WHERE type = 'person' AND LOWER(name) = ? LIMIT 1`
  ).all(query.toLowerCase());
  
  if (rows.length === 0) {
    rows = db.prepare(
      `SELECT * FROM entities WHERE type = 'person' AND LOWER(name) LIKE ? LIMIT 5`
    ).all(`%${query.toLowerCase()}%`);
  }

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    ...JSON.parse(r.metadata || '{}'),
  }));
}

// Get all contacts
function getAllContacts() {
  const db = graph.getDb();
  return db.prepare(`SELECT * FROM entities WHERE type = 'person' ORDER BY name LIMIT 100`).all()
    .map(r => ({ id: r.id, name: r.name, ...JSON.parse(r.metadata || '{}') }));
}

// Find contact by email
function findByEmail(email) {
  const db = graph.getDb();
  const rows = db.prepare(`SELECT * FROM entities WHERE type = 'person'`).all();
  return rows.find(r => {
    const meta = JSON.parse(r.metadata || '{}');
    return meta.emails?.some(e => e.address?.toLowerCase() === email.toLowerCase());
  });
}

module.exports = { syncContacts, lookupContact, getAllContacts, findByEmail };
