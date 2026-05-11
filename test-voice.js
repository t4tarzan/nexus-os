// Voice pipeline test
require('dotenv').config({ path: '/Users/vinayak/nexus/.env' });
const voice = require('./actions/voice');
const { routeIntent } = require('./core/router');
const { executeAction } = require('./actions');
const graph = require('./graph');

async function test() {
  graph.migrate(graph.getDb());

  const status = voice.getVoiceStatus();
  console.log('🎤 Voice Status:');
  console.log('  whisper.cpp:', status.whisperInstalled ? '✅ ' + status.whisperPath : '❌');
  console.log('  model (base.en):', status.modelInstalled ? '✅' : '❌');
  console.log('  sox (recording):', status.soxInstalled ? '✅' : '❌');
  console.log();

  // Test: record + transcribe
  console.log('🎙️  Recording 5 seconds (speak if you want)...');
  try {
    const result = await voice.voiceToIntent(
      (text) => routeIntent(text),
      (routing) => executeAction(routing)
    );
    
    if (result.success) {
      console.log('📝 Heard:', `"${result.transcript}"`);
      console.log('🎯 Intent:', result.intent, '(' + Math.round(result.confidence * 100) + '%)');
      console.log('⚡ Total latency:', result.latencyMs, 'ms');
      console.log('✅ Voice pipeline operational!');
    } else {
      console.log('ℹ️ ', result.error || 'No speech detected');
      console.log('   (This is expected in a quiet environment)');
    }
  } catch (e) {
    console.log('❌ Error:', e.message);
  }

  // Test TTS
  console.log();
  console.log('🔊 Testing speech output...');
  const spoken = await voice.speak('Nexus voice pipeline is fully operational.');
  console.log('TTS:', spoken ? '✅ Heard it' : '❌ Failed');

  console.log('\n✅ Voice test complete');
  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
