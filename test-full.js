// Full Nexus pipeline test — v2 with email, calendar, contacts
const path = require('path');
process.chdir('/Users/vinayak/nexus');
require('dotenv').config({ path: '/Users/vinayak/nexus/.env' });

const graph = require('./graph');
const { routeIntent } = require('./core/router');
const { executeAction } = require('./actions');
const contacts = require('./actions/contacts');

async function main() {
  console.log('🔧 Nexus Full Pipeline Test v2\n');
  graph.migrate(graph.getDb());

  // Sync contacts first
  console.log('--- Syncing Contacts ---');
  const contactList = await contacts.syncContacts();
  console.log(`  ${contactList.length ? '✅ Synced ' + contactList.length + ' contacts' : '⚠️  No Contacts.app access (normal), using graph contacts'}\n`);

  const tests = [
    { input: 'what can you do', desc: 'Help' },
    { input: 'find my downloads', desc: 'File search' },
    { input: 'send email to vinayak about the nexus project', desc: 'Email compose' },
    { input: 'what is on my calendar today', desc: 'Calendar query' },
    { input: 'lookup contact vinayak', desc: 'Contact lookup' },
    { input: 'schedule a meeting tomorrow at 2pm for Nexus review', desc: 'Calendar create' },
  ];

  for (const { input, desc } of tests) {
    console.log(`--- ${desc}: "${input}" ---`);
    try {
      const routing = await routeIntent(input);
      console.log(`  Intent: ${routing.intent} (${Math.round(routing.confidence * 100)}%)`);
      console.log(`  Params: ${JSON.stringify(routing.params)}`);

      const result = await executeAction(routing);
      if (result.success) {
        console.log(`  ✅ ${result.result?.slice(0, 100) || 'Done'}`);
        if (result.events) console.log(`  Found ${result.count} events`);
        if (result.contacts) console.log(`  Found ${result.contacts.length} contacts`);
      } else {
        console.log(`  ⚠️  ${result.error || result.result}`);
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
    }
    console.log();
  }

  console.log('✅ All tests complete');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Fatal:', e.message);
  process.exit(1);
});
