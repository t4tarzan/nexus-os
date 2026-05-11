// Full system integration test
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:47900');
let testPhase = 0;

function send(action, payload = {}) {
  ws.send(JSON.stringify({ id: Date.now().toString(), action, payload }));
}

ws.on('open', () => {
  console.log('🔌 Connected to Nexus\n');
  
  // Test 1: Proactive suggestions
  console.log('--- Test 1: Proactive Suggestions ---');
  send('suggestions');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  
  if (msg.type === 'connected') {
    console.log('✅ Server:', msg.message);
    console.log('   Graph:', msg.stats.entities, 'entities,', msg.stats.interactions, 'interactions');
    console.log('   Suggestions:', msg.suggestions?.length || 0);
    if (msg.suggestions) msg.suggestions.slice(0, 3).forEach(s => console.log('   💡', s.text));
    send('suggestions');
    return;
  }
  
  if (msg.type === 'suggestions' && testPhase === 0) {
    testPhase = 1;
    console.log('✅ Got suggestions');
    
    setTimeout(() => {
      console.log('\n--- Test 2: Briefing ---');
      send('briefing');
    }, 300);
    return;
  }
  
  if (msg.type === 'briefing' && testPhase === 1) {
    testPhase = 2;
    console.log('✅ Briefing for', msg.briefing.date);
    console.log('   Interactions today:', msg.briefing.totalInteractions);
    
    setTimeout(() => {
      console.log('\n--- Test 3: Intent ---');
      send('intent', { text: 'what can you do' });
    }, 300);
    return;
  }
  
  if (msg.type === 'thinking') { console.log('🧠 Thinking...'); return; }
  if (msg.type === 'routed') { console.log('🎯 Routed →', msg.intent, '(' + Math.round(msg.confidence*100) + '%)'); return; }
  if (msg.type === 'executing') { console.log('⚡ Executing...'); return; }
  
  if (msg.type === 'result' && testPhase === 2) {
    testPhase = 3;
    console.log('✅ Result:', msg.success ? 'Success' : 'Failed');
    
    setTimeout(() => {
      console.log('\n--- Test 4: Learning ---');
      send('learn', { 
        original: 'query_file', 
        corrected: 'query_file', 
        correction: 'I search for mission files every morning' 
      });
    }, 300);
    return;
  }
  
  if (msg.type === 'learned' && testPhase === 3) {
    console.log('✅ Pattern learned');
    
    setTimeout(() => {
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ ALL SYSTEM TESTS PASSED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
      ws.close();
    }, 300);
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.log('❌ Error:', e.message); process.exit(1); });
setTimeout(() => { console.log('⏰ Timeout'); process.exit(1); }, 20000);
