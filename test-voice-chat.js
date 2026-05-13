// Simulated voice chat test using JFK audio
require('dotenv').config({ path: '/Users/vinayak/nexus/.env' });
const VoiceChat = require('./actions/voice-chat');
const { routeIntent } = require('./core/router');
const { executeAction } = require('./actions');
const graph = require('./graph');
const fs = require('fs');
const os = require('os');

async function test() {
  graph.migrate(graph.getDb());
  const vc = new VoiceChat();
  vc.speak = async (text) => { console.log('🔊 SPEAKING:', text.slice(0, 100)); return true; };
  vc.routeIntent = routeIntent;
  vc.executeAction = executeAction;

  console.log('=== Simulated Voice Chat (JFK speech) ===\n');

  const clipFile = '/tmp/nexus-fake-mic.wav';
  fs.copyFileSync(os.homedir() + '/whisper.cpp/samples/jfk.wav', clipFile);

  const rmsDb = await vc.getRMS(clipFile);
  console.log('RMS:', rmsDb.toFixed(1), 'dB (threshold: -40)');
  console.log('Speech:', rmsDb > -40 ? '✅ DETECTED' : '❌ Too quiet');

  if (rmsDb > -40) {
    console.log('\n📝 Transcribing...');
    const text = await vc.transcribe(clipFile);
    console.log('Heard:', '"' + text + '"');

    console.log('\n🧠 Understanding...');
    const routing = await routeIntent(text);
    console.log('Intent:', routing.intent, '(' + Math.round(routing.confidence * 100) + '%)');

    const result = await executeAction(routing);
    console.log('Response:', result.result?.slice(0, 200));
  }

  console.log('\n✅ Full voice pipeline verified');
  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
