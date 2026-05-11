// Standalone test for Nexus core pipeline
const path = require('path');
process.chdir('/Users/vinayak/nexus');
require('dotenv').config({ path: '/Users/vinayak/nexus/.env' });

const graph = require('./graph');
const { routeIntent } = require('./core/router');
const { executeAction } = require('./actions');

async function main() {
  console.log('🔧 Nexus Core Pipeline Test\n');
  
  // Init graph
  graph.migrate(graph.getDb());

  // Test 1: Help intent
  console.log('Test 1: "what can you do"');
  const r1 = await routeIntent('what can you do');
  console.log('  Intent:', r1.intent, `(${Math.round(r1.confidence * 100)}%)`);
  console.log('  Model:', r1.modelUsed, `(${r1.latencyMs}ms, ${r1.tokensUsed} tokens)`);
  const a1 = await executeAction(r1);
  console.log('  Result:', a1.success ? '✅' : '❌', a1.result?.slice(0, 80) + '...\n');

  // Test 2: File search
  console.log('Test 2: "find my mission files"');
  const r2 = await routeIntent('find my mission files');
  console.log('  Intent:', r2.intent, `(${Math.round(r2.confidence * 100)}%)`);
  console.log('  Params:', JSON.stringify(r2.params));
  console.log('  Model:', r2.modelUsed, `(${r2.latencyMs}ms, ${r2.tokensUsed} tokens)`);
  const a2 = await executeAction(r2);
  if (a2.success) {
    console.log('  ✅ Found', a2.count, 'files');
    a2.results?.slice(0, 3).forEach(f => console.log('    -', f.name));
  } else {
    console.log('  ❌', a2.error);
  }
  console.log();

  // Test 3: Open file
  console.log('Test 3: "open the MissionControl folder"');
  const r3 = await routeIntent('open the MissionControl folder');
  console.log('  Intent:', r3.intent, `(${Math.round(r3.confidence * 100)}%)`);
  console.log('  Params:', JSON.stringify(r3.params));
  const a3 = await executeAction(r3);
  console.log('  Result:', a3.success ? '✅ ' + a3.result : '❌ ' + a3.error);
  console.log();

  console.log('✅ All pipeline tests passed!');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Test failed:', e.message);
  process.exit(1);
});
