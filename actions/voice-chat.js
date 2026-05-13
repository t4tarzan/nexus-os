// Nexus Voice Chat — simple, robust interactive voice conversation
// Records 4-second clips → checks for speech → transcribes → responds → loops

const { exec } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WHISPER_BIN = path.join(HOME, 'whisper.cpp', 'build', 'bin', 'whisper-cli');
const WHISPER_MODEL = path.join(HOME, 'whisper.cpp', 'models', 'ggml-base.en.bin');

class VoiceChat extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.routeIntent = null;
    this.executeAction = null;
    this.speak = null;
  }

  async start(routeIntent, executeAction, speak) {
    this.active = true;
    this.routeIntent = routeIntent;
    this.executeAction = executeAction;
    this.speak = speak;

    this.emit('state', 'listening');
    console.log('[voice] Voice chat active — speak now');
    await speak('Voice chat started. How can I help?');
    
    this.loop();
  }

  stop() {
    this.active = false;
    this.emit('state', 'idle');
    console.log('[voice] Voice chat stopped');
  }

  async loop() {
    while (this.active) {
      try {
        this.emit('state', 'listening');
        
        // Record a 4-second clip
        const clipFile = `/tmp/nexus-loop-${Date.now()}.wav`;
        const recorded = await this.record(clipFile, 4000);
        
        if (!recorded || !this.active) continue;
        
        // Check if there's speech in the clip
        const rmsDb = await this.getRMS(clipFile);
        
        if (rmsDb > -40) {
          // Speech detected
          console.log(`[voice] Speech: ${rmsDb.toFixed(1)} dB`);
          this.emit('state', 'transcribing');
          
          // Transcribe
          const text = await this.transcribe(clipFile);
          try { fs.unlinkSync(clipFile); } catch {}
          
          if (!text || text.length < 2) continue;
          
          this.emit('transcript', text);
          console.log('[voice] Heard:', text);
          
          // Check for stop commands
          if (/stop listening|go to sleep|goodbye nexus|nexus stop|quit voice/i.test(text)) {
            await speak('Goodbye!');
            this.stop();
            return;
          }
          
          // Route to LLM
          this.emit('state', 'thinking');
          const routing = await this.routeIntent(text);
          const result = await this.executeAction(routing);
          
          this.emit('response', { transcript: text, intent: routing.intent, result });
          
          // Speak response
          if (result?.result) {
            this.emit('state', 'speaking');
            const responseText = typeof result.result === 'string'
              ? result.result.replace(/[#*_`~\[\]\(\)]/g, '').slice(0, 400)
              : 'Done.';
            await this.speak(responseText);
          }
        } else {
          // No speech — brief pause then record again
          try { fs.unlinkSync(clipFile); } catch {}
          this.emit('state', 'listening');
          if (rmsDb < -60) {
            console.log(`[voice] Quiet (${rmsDb.toFixed(0)}dB) — waiting for speech...`);
          }
          await this.sleep(300);
        }
      } catch (e) {
        console.error('[voice] Loop error:', e.message);
        await this.sleep(1000);
      }
    }
  }

  record(outputFile, durationMs) {
    return new Promise((resolve) => {
      const secs = (durationMs / 1000).toFixed(1);
      exec(
        `sox -d -r 16000 -c 1 -b 16 "${outputFile}" trim 0 ${secs} 2>/dev/null`,
        { timeout: durationMs + 5000 },
        (err) => {
          if (err && !fs.existsSync(outputFile)) return resolve(false);
          resolve(fs.existsSync(outputFile));
        }
      );
    });
  }

  getRMS(audioFile) {
    return new Promise((resolve) => {
      exec(
        `sox "${audioFile}" -n stats 2>&1 | grep "RMS lev dB" | awk '{print $4}'`,
        { timeout: 3000 },
        (err, stdout) => {
          if (err || !stdout.trim()) return resolve(-100);
          resolve(parseFloat(stdout.trim()) || -100);
        }
      );
    });
  }

  transcribe(audioFile) {
    return new Promise((resolve) => {
      if (!fs.existsSync(WHISPER_BIN) || !fs.existsSync(WHISPER_MODEL)) {
        return resolve('');
      }
      const t0 = Date.now();
      exec(
        `"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${audioFile}" -nt -l en --no-prints 2>/dev/null`,
        { timeout: 15000 },
        (err, stdout) => {
          if (err) return resolve('');
          const text = stdout.replace(/\[.*?\]/g, '').replace(/^\s*$/gm, '').trim();
          console.log(`[voice] Transcribed in ${Date.now() - t0}ms`);
          resolve(text || '');
        }
      );
    });
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

module.exports = VoiceChat;
