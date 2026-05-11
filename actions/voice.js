// Nexus Voice Pipeline — record, transcribe, speak
// whisper.cpp (local GPU STT) + sox (recording) + macOS say (TTS)

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WHISPER_BIN = path.join(HOME, 'whisper.cpp', 'build', 'bin', 'whisper-cli');
const WHISPER_MODEL = path.join(HOME, 'whisper.cpp', 'models', `ggml-${process.env.NEXUS_WHISPER_MODEL || 'base.en'}.bin`);

// ─── Voice Mode State ───
let voiceModeActive = false;
let recordingProcess = null;
let voiceCallbacks = { onTranscript: null, onStateChange: null };

// ─── Recording ───

async function recordAudio(durationMs = 5000) {
  const outputFile = `/tmp/nexus-voice-${Date.now()}.wav`;
  const durationSec = (durationMs / 1000).toFixed(1);

  return new Promise((resolve, reject) => {
    const cmd = `sox -d -r 16000 -c 1 -b 16 "${outputFile}" trim 0 ${durationSec} 2>/dev/null`;
    exec(cmd, { timeout: durationMs + 5000 }, (err) => {
      if (err && !fs.existsSync(outputFile)) {
        return reject(new Error(`Recording failed: ${err.message}`));
      }
      resolve(outputFile);
    });
  });
}

// ─── Transcription ───

async function transcribe(audioPath) {
  if (!fs.existsSync(WHISPER_BIN)) {
    return { success: false, error: 'whisper.cpp not installed. Run: brew install cmake && cd ~/whisper.cpp && bash ./models/download-ggml-model.sh base.en && mkdir -p build && cd build && cmake .. && make -j4 whisper-cli' };
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    return { success: false, error: `Whisper model not found at ${WHISPER_MODEL}` };
  }
  if (!fs.existsSync(audioPath)) {
    return { success: false, error: `Audio file not found: ${audioPath}` };
  }

  return new Promise((resolve) => {
    const t0 = Date.now();
    exec(
      `"${WHISPER_BIN}" -m "${WHISPER_MODEL}" -f "${audioPath}" -nt -l en --no-prints 2>/dev/null`,
      { timeout: 30000 },
      (err, stdout) => {
        const latency = Date.now() - t0;
        try { fs.unlinkSync(audioPath); } catch {}

        if (err) {
          return resolve({ success: false, error: err.message });
        }

        // Clean whisper output: remove timestamp markers and blank lines
        let text = stdout
          .replace(/\[.*?\]/g, '')
          .replace(/^\s*$/gm, '')
          .trim();

        // If empty or just noise, retry
        if (!text || text.length < 2) {
          return resolve({ success: false, error: 'No speech detected' });
        }

        resolve({
          success: true,
          text,
          latencyMs: latency,
        });
      }
    );
  });
}

// ─── Full Voice → Intent Pipeline ───

async function voiceToIntent(routeIntentFn, executeActionFn) {
  try {
    // Step 1: Record
    const audioPath = await recordAudio(4000);
    
    // Step 2: Transcribe
    const sttResult = await transcribe(audioPath);
    if (!sttResult.success) return sttResult;
    
    // Step 3: Route the transcribed text
    const routing = await routeIntentFn(sttResult.text);
    
    // Step 4: Execute
    const actionResult = await executeActionFn(routing);

    return {
      success: true,
      transcript: sttResult.text,
      intent: routing.intent,
      confidence: routing.confidence,
      result: actionResult,
      latencyMs: sttResult.latencyMs,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ─── Text to Speech ───

async function speak(text) {
  if (!text) return false;

  // Clean text for speech
  const cleanText = text
    .replace(/[#*`~_]/g, '')        // Remove markdown
    .replace(/\[.*?\]\(.*?\)/g, '')  // Remove links
    .replace(/\n/g, ', ')            // Newlines → pauses
    .replace(/\s+/g, ' ')
    .slice(0, 500);                  // Limit length

  return new Promise((resolve) => {
    const cmd = process.platform === 'darwin'
      ? `say -v Samantha "${cleanText.replace(/"/g, '\\"').replace(/\(/g, '').replace(/\)/g, '')}"`
      : process.platform === 'linux'
        ? `espeak "${cleanText}" 2>/dev/null`
        : null;

    if (!cmd) return resolve(false);

    exec(cmd, { timeout: 15000 }, (err) => {
      resolve(!err);
    });
  });
}

// ─── Continuous Voice Mode ───

function startVoiceMode(callbacks) {
  if (voiceModeActive) return;
  voiceModeActive = true;
  voiceCallbacks = callbacks;

  if (callbacks.onStateChange) callbacks.onStateChange('listening');
  
  // Continuous recording loop
  async function listenLoop() {
    while (voiceModeActive) {
      try {
        const audioPath = await recordAudio(4000);
        const sttResult = await transcribe(audioPath);
        
        if (sttResult.success && sttResult.text) {
          if (callbacks.onTranscript) callbacks.onTranscript(sttResult.text);
          
          // Check for wake words to stop
          if (
            sttResult.text.toLowerCase().includes('stop listening') ||
            sttResult.text.toLowerCase().includes('go to sleep') ||
            sttResult.text.toLowerCase().includes('nexus stop')
          ) {
            stopVoiceMode();
            if (callbacks.onStateChange) callbacks.onStateChange('idle');
            speak('Voice mode stopped.');
            return;
          }
        }
      } catch (e) {
        // Brief pause on error, then retry
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  listenLoop();
  return true;
}

function stopVoiceMode() {
  voiceModeActive = false;
  if (recordingProcess) {
    recordingProcess.kill();
    recordingProcess = null;
  }
  if (voiceCallbacks.onStateChange) voiceCallbacks.onStateChange('idle');
}

function isVoiceModeActive() {
  return voiceModeActive;
}

// ─── Status check ───

function getVoiceStatus() {
  return {
    whisperInstalled: fs.existsSync(WHISPER_BIN),
    modelInstalled: fs.existsSync(WHISPER_MODEL),
    soxInstalled: (() => { try { exec('which sox'); return true; } catch { return false; } })(),
    voiceModeActive,
    whisperPath: WHISPER_BIN,
    modelPath: WHISPER_MODEL,
  };
}

module.exports = {
  recordAudio,
  transcribe,
  voiceToIntent,
  speak,
  startVoiceMode,
  stopVoiceMode,
  isVoiceModeActive,
  getVoiceStatus,
};
