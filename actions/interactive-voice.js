// Nexus Interactive Voice — continuous two-way voice conversation
// Records in short chunks, detects speech via energy threshold,
// transcribes with whisper.cpp, routes to LLM, speaks response, loops

const { exec, spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const WHISPER_BIN = path.join(HOME, 'whisper.cpp', 'build', 'bin', 'whisper-cli');
const WHISPER_MODEL = path.join(HOME, 'whisper.cpp', 'models', 'ggml-base.en.bin');

class InteractiveVoice extends EventEmitter {
  constructor() {
    super();
    this.isActive = false;
    this.isSpeaking = false;
    this.recordingProcess = null;
    this.silenceTimer = null;
    this.audioChunks = [];
    
    // VAD settings
    this.SPEECH_THRESHOLD = 0.02;   // Energy threshold for speech detection
    this.SILENCE_TIMEOUT = 1500;     // ms of silence before processing
    this.MAX_RECORDING = 10000;      // max recording time before auto-process
    this.CHUNK_DURATION = 500;       // ms per recording chunk
  }

  // ─── Start interactive voice mode ───
  async start(routeIntent, executeAction, speak) {
    if (this.isActive) return;
    this.isActive = true;
    this.routeIntent = routeIntent;
    this.executeAction = executeAction;
    this.speak = speak;
    
    this.emit('state', 'listening');
    console.log('[voice] Interactive mode started');
    
    await speak('I\'m listening.');
    this.listenLoop();
  }

  stop() {
    this.isActive = false;
    this.isSpeaking = false;
    if (this.recordingProcess) {
      this.recordingProcess.kill();
      this.recordingProcess = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.audioChunks = [];
    this.emit('state', 'idle');
    console.log('[voice] Interactive mode stopped');
  }

  // ─── Continuous recording loop with VAD ───
  async listenLoop() {
    while (this.isActive) {
      try {
        const chunkFile = `/tmp/nexus-chunk-${Date.now()}.wav`;
        
        // Record a short chunk
        await this.recordChunk(chunkFile, this.CHUNK_DURATION);
        
        // Check if this chunk contains speech
        const hasSpeech = await this.detectSpeech(chunkFile);
        
        if (hasSpeech) {
          // Speech detected — accumulate and keep listening
          this.audioChunks.push(chunkFile);
          
          // Reset silence timer
          if (this.silenceTimer) clearTimeout(this.silenceTimer);
          this.silenceTimer = setTimeout(() => this.processSpeech(), this.SILENCE_TIMEOUT);
          
          // Auto-process if recording too long
          const totalDuration = this.audioChunks.length * this.CHUNK_DURATION;
          if (totalDuration >= this.MAX_RECORDING) {
            if (this.silenceTimer) clearTimeout(this.silenceTimer);
            await this.processSpeech();
          }
        } else if (this.audioChunks.length > 0) {
          // No speech in this chunk, but we have accumulated speech
          // The silence timer will trigger processing
          this.audioChunks.push(chunkFile);
        } else {
          // No speech and nothing accumulated — ignore
          try { fs.unlinkSync(chunkFile); } catch {}
        }
      } catch (e) {
        console.error('[voice] Listen error:', e.message);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // ─── Record a short audio chunk ───
  recordChunk(outputFile, durationMs) {
    return new Promise((resolve, reject) => {
      const durationSec = (durationMs / 1000).toFixed(1);
      const cmd = `sox -d -r 16000 -c 1 -b 16 "${outputFile}" trim 0 ${durationSec} 2>/dev/null`;
      
      exec(cmd, { timeout: durationMs + 3000 }, (err) => {
        if (err && !fs.existsSync(outputFile)) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  // ─── Detect if audio chunk contains speech ───
  detectSpeech(audioFile) {
    return new Promise((resolve) => {
      if (!fs.existsSync(audioFile)) return resolve(false);
      
      // Use sox stat to get RMS amplitude
      exec(`sox "${audioFile}" -n stats 2>&1 | grep "RMS amplitude" | awk '{print $3}'`, 
        { timeout: 3000 }, (err, stdout) => {
          if (err) return resolve(false);
          
          const rms = parseFloat(stdout.trim());
          const hasSpeech = !isNaN(rms) && rms > this.SPEECH_THRESHOLD;
          resolve(hasSpeech);
        });
    });
  }

  // ─── Process accumulated speech ───
  async processSpeech() {
    if (!this.isActive || this.audioChunks.length === 0) return;
    
    this.silenceTimer = null;
    this.emit('state', 'transcribing');
    
    // Merge all chunks into one file
    const mergedFile = `/tmp/nexus-speech-${Date.now()}.wav`;
    await this.mergeChunks(this.audioChunks, mergedFile);
    
    // Clean up chunk files
    for (const chunk of this.audioChunks) {
      try { fs.unlinkSync(chunk); } catch {}
    }
    this.audioChunks = [];
    
    // Transcribe
    const transcript = await this.transcribe(mergedFile);
    try { fs.unlinkSync(mergedFile); } catch {}
    
    if (!transcript || transcript.length < 2) {
      this.emit('state', 'listening');
      return;
    }
    
    this.emit('transcript', transcript);
    console.log('[voice] Heard:', transcript);
    
    // Check for stop commands
    if (/stop listening|go to sleep|goodbye nexus|nexus stop/i.test(transcript)) {
      await this.speak('Goodbye!');
      this.stop();
      return;
    }
    
    // Route to LLM
    this.emit('state', 'thinking');
    try {
      const routing = await this.routeIntent(transcript);
      const result = await this.executeAction(routing);
      
      this.emit('response', { transcript, intent: routing.intent, result });
      
      // Speak the response
      if (result?.result) {
        this.isSpeaking = true;
        this.emit('state', 'speaking');
        
        // Speak — if user interrupts, stop TTS
        const speakText = typeof result.result === 'string' 
          ? result.result.slice(0, 500) 
          : 'Done.';
        
        await this.speak(speakText);
        this.isSpeaking = false;
      }
    } catch (e) {
      console.error('[voice] LLM error:', e.message);
      await this.speak('Sorry, I had trouble with that.');
    }
    
    this.emit('state', 'listening');
  }

  // ─── Merge audio chunks ───
  mergeChunks(chunkFiles, outputFile) {
    return new Promise((resolve, reject) => {
      if (chunkFiles.length === 0) return reject(new Error('No chunks'));
      if (chunkFiles.length === 1) {
        fs.copyFileSync(chunkFiles[0], outputFile);
        return resolve();
      }
      
      const files = chunkFiles.map(f => `"${f}"`).join(' ');
      const cmd = `sox ${files} "${outputFile}" 2>/dev/null`;
      exec(cmd, { timeout: 10000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  // ─── Transcribe with whisper.cpp ───
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
          const latency = Date.now() - t0;
          if (err) return resolve('');
          
          const text = stdout
            .replace(/\[.*?\]/g, '')
            .replace(/^\s*$/gm, '')
            .trim();
          
          console.log(`[voice] Transcribed in ${latency}ms: "${text}"`);
          resolve(text || '');
        }
      );
    });
  }
}

module.exports = InteractiveVoice;
