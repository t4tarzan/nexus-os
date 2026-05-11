// Test script for Nexus server
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:47900');
let received = 0;
let done = false;

ws.on('open', () => {
  console.log('✅ Connected to Nexus server\n');
  ws.send(JSON.stringify({ id: '1', action: 'intent', payload: { text: 'find my mission files' } }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  received++;
  
  if (msg.type === 'connected') {
    console.log('📨 Server:', msg.message);
    console.log('   Stats:', JSON.stringify(msg.stats));
    return;
  }
  
  const preview = msg.type + (msg.intent ? ' → ' + msg.intent : '') +
    (msg.confidence ? ' (' + Math.round(msg.confidence * 100) + '%)' : '') +
    (msg.result ? ' → ' + JSON.stringify(msg.result).slice(0, 150) : '') +
    (msg.count ? ' → ' + msg.count + ' results' : '');
  
  console.log('📨 [' + received + ']', preview);

  if ((msg.type === 'result' || msg.type === 'error') && !done) {
    done = true;
    setTimeout(() => {
      // Test 2: help
      console.log('\n--- Test 2: help ---');
      ws.send(JSON.stringify({ id: '2', action: 'intent', payload: { text: 'what can you do' } }));
      done = false;
    }, 500);
    return;
  }

  if (msg.type === 'result' && msg.id === '2' && !done) {
    done = true;
    setTimeout(() => {
      console.log('\n✅ All tests passed!');
      ws.close();
    }, 500);
  }
});

ws.on('error', (e) => console.log('❌ WS Error:', e.message));
ws.on('close', (code) => {
  console.log('\nConnection closed. Received ' + received + ' messages.');
  process.exit(code);
});

setTimeout(() => { console.log('\n⏰ Timeout after 20s'); process.exit(1); }, 20000);
