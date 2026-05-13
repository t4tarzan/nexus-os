// Nexus Avatar — Anime-style 3D face with real-time audio-driven lip sync
// Uses Three.js for rendering, Web Audio API for frequency analysis
// Self-contained — no external APIs needed

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ─── Audio Analyzer (extracts frequencies for lip sync) ───
class LipSyncAnalyzer {
  constructor() {
    this.audioContext = null;
    this.analyser = null;
    this.dataArray = null;
    this.mouthOpen = 0;
    this.speaking = false;
    this.onSpeechEnd = null;
    this.silenceTimer = null;
  }

  async init() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.3;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  connectToAudio(audioElement) {
    if (!this.audioContext || !this.analyser) return;
    const source = this.audioContext.createMediaElementSource(audioElement);
    source.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);
  }

  // Analyze system audio output (for TTS)
  connectToStream(stream) {
    if (!this.audioContext || !this.analyser) return;
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);
  }

  getMouthOpen() {
    if (!this.analyser || !this.dataArray) return 0;
    
    this.analyser.getByteFrequencyData(this.dataArray);
    
    // Focus on speech-relevant frequencies (300Hz-3kHz in 256-FFT at 44.1kHz)
    // Bins 2-18 roughly cover speech formants
    let sum = 0;
    let count = 0;
    for (let i = 2; i < 18; i++) {
      sum += this.dataArray[i];
      count++;
    }
    
    const avg = sum / count;
    const normalized = Math.min(1, avg / 80); // Normalize to 0-1
    
    // Detect speech vs silence
    if (normalized > 0.15) {
      this.speaking = true;
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
    } else if (this.speaking) {
      if (!this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          this.speaking = false;
          this.silenceTimer = null;
          if (this.onSpeechEnd) this.onSpeechEnd();
        }, 300);
      }
    }

    return normalized;
  }

  isSpeaking() { return this.speaking; }
}

// ─── Anime Avatar 3D Model (built from Three.js primitives) ───
function createAnimeAvatar(scene) {
  const group = new THREE.Group();
  
  const skinColor = 0xffe0bd;
  const hairColor = 0x2d1b4e;
  const eyeColor = 0x4a2c8a;
  const mouthColor = 0xc46b6b;
  const blushColor = 0xffb3b3;

  // Head (slightly elongated sphere)
  const headGeo = new THREE.SphereGeometry(0.85, 32, 32);
  headGeo.scale(1, 1.15, 0.9);
  const headMesh = new THREE.Mesh(headGeo, new THREE.MeshPhongMaterial({ color: skinColor, shininess: 30 }));
  headMesh.position.y = 0.1;
  headMesh.castShadow = true;
  group.add(headMesh);

  // Hair (layered spheres for anime hair shape)
  const hairGroup = new THREE.Group();
  // Main hair dome
  const hairGeo = new THREE.SphereGeometry(0.88, 32, 32);
  hairGeo.scale(1.02, 1.03, 0.95);
  const hairMesh = new THREE.Mesh(hairGeo, new THREE.MeshPhongMaterial({ color: hairColor, shininess: 40 }));
  hairMesh.position.y = 0.25;
  hairGroup.add(hairMesh);
  
  // Hair bangs (side pieces)
  for (let side = -1; side <= 1; side += 2) {
    const bangGeo = new THREE.SphereGeometry(0.4, 16, 16);
    bangGeo.scale(0.5, 0.7, 0.5);
    const bang = new THREE.Mesh(bangGeo, new THREE.MeshPhongMaterial({ color: hairColor }));
    bang.position.set(side * 0.5, 0.65, 0.4);
    hairGroup.add(bang);
  }
  
  group.add(hairGroup);

  // Eyes
  const eyesGroup = new THREE.Group();
  for (let side = -1; side <= 1; side += 2) {
    // Eye white
    const whiteGeo = new THREE.SphereGeometry(0.14, 16, 16);
    whiteGeo.scale(1.2, 0.8, 0.3);
    const whiteMesh = new THREE.Mesh(whiteGeo, new THREE.MeshPhongMaterial({ color: 0xffffff }));
    whiteMesh.position.set(side * 0.28, 0.35, 0.72);
    whiteMesh.name = `eye-white-${side}`;
    eyesGroup.add(whiteMesh);

    // Iris
    const irisGeo = new THREE.SphereGeometry(0.09, 16, 16);
    irisGeo.scale(1, 0.9, 0.2);
    const irisMesh = new THREE.Mesh(irisGeo, new THREE.MeshPhongMaterial({ color: eyeColor, shininess: 60 }));
    irisMesh.position.set(side * 0.28, 0.35, 0.76);
    irisMesh.name = `iris-${side}`;
    eyesGroup.add(irisMesh);

    // Pupil
    const pupilGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const pupilMesh = new THREE.Mesh(pupilGeo, new THREE.MeshPhongMaterial({ color: 0x000000 }));
    pupilMesh.position.set(side * 0.28, 0.35, 0.78);
    pupilMesh.name = `pupil-${side}`;
    eyesGroup.add(pupilMesh);

    // Upper eyelid (for blinking)
    const lidGeo = new THREE.SphereGeometry(0.15, 16, 16);
    lidGeo.scale(1.3, 0.3, 0.3);
    const lidMesh = new THREE.Mesh(lidGeo, new THREE.MeshPhongMaterial({ color: skinColor }));
    lidMesh.position.set(side * 0.28, 0.45, 0.72);
    lidMesh.name = `eyelid-${side}`;
    eyesGroup.add(lidMesh);
  }
  group.add(eyesGroup);

  // Eyebrows
  for (let side = -1; side <= 1; side += 2) {
    const browGeo = new THREE.BoxGeometry(0.22, 0.03, 0.05);
    const browMesh = new THREE.Mesh(browGeo, new THREE.MeshPhongMaterial({ color: 0x3d1c5e }));
    browMesh.position.set(side * 0.28, 0.55, 0.72);
    browMesh.rotation.z = side * -0.1;
    browMesh.name = `eyebrow-${side}`;
    group.add(browMesh);
  }

  // Mouth (key for lip sync — this gets animated)
  const mouthGroup = new THREE.Group();
  mouthGroup.position.set(0, -0.15, 0.78);
  mouthGroup.name = 'mouth';
  
  // Upper lip
  const upperLipGeo = new THREE.BoxGeometry(0.25, 0.02, 0.04);
  const upperLip = new THREE.Mesh(upperLipGeo, new THREE.MeshPhongMaterial({ color: mouthColor }));
  upperLip.position.y = 0.02;
  upperLip.name = 'upperLip';
  mouthGroup.add(upperLip);
  
  // Lower lip
  const lowerLipGeo = new THREE.BoxGeometry(0.25, 0.02, 0.04);
  const lowerLip = new THREE.Mesh(lowerLipGeo, new THREE.MeshPhongMaterial({ color: mouthColor }));
  lowerLip.position.y = -0.02;
  lowerLip.name = 'lowerLip';
  mouthGroup.add(lowerLip);
  
  // Mouth interior
  const interiorGeo = new THREE.BoxGeometry(0.2, 0.01, 0.03);
  const interior = new THREE.Mesh(interiorGeo, new THREE.MeshPhongMaterial({ color: 0x330000 }));
  interior.name = 'mouthInterior';
  mouthGroup.add(interior);
  
  group.add(mouthGroup);

  // Blush
  for (let side = -1; side <= 1; side += 2) {
    const blushGeo = new THREE.CircleGeometry(0.1, 16);
    const blushMesh = new THREE.Mesh(blushGeo, new THREE.MeshPhongMaterial({ 
      color: blushColor, transparent: true, opacity: 0.3, side: THREE.DoubleSide 
    }));
    blushMesh.position.set(side * 0.42, 0.05, 0.7);
    blushMesh.name = `blush-${side}`;
    group.add(blushMesh);
  }

  // Nose (tiny dot)
  const noseGeo = new THREE.SphereGeometry(0.03, 8, 8);
  const noseMesh = new THREE.Mesh(noseGeo, new THREE.MeshPhongMaterial({ color: 0xe8c4a0 }));
  noseMesh.position.set(0, 0.05, 0.82);
  group.add(noseMesh);

  // Neck
  const neckGeo = new THREE.CylinderGeometry(0.2, 0.25, 0.4, 16);
  const neckMesh = new THREE.Mesh(neckGeo, new THREE.MeshPhongMaterial({ color: skinColor }));
  neckMesh.position.y = -0.8;
  group.add(neckMesh);

  scene.add(group);
  return {
    group,
    mouthGroup,
    eyesGroup,
    upperLip,
    lowerLip,
    interior,
    eyelids: [
      eyesGroup.getObjectByName('eyelid--1'),
      eyesGroup.getObjectByName('eyelid-1'),
    ],
    pupils: [
      eyesGroup.getObjectByName('pupil--1'),
      eyesGroup.getObjectByName('pupil-1'),
    ],
    eyebrows: [
      group.getObjectByName('eyebrow--1'),
      group.getObjectByName('eyebrow-1'),
    ],
  };
}

// ─── Animation Controller ───
class AvatarAnimator {
  constructor(parts) {
    this.parts = parts;
    this.mouthTarget = 0;
    this.mouthCurrent = 0;
    this.blinkTimer = 0;
    this.blinkDuration = 0;
    this.isBlinking = false;
    this.eyeLookX = 0;
    this.eyeLookY = 0;
    this.expression = 'neutral'; // neutral, happy, thinking, surprised
    this.expressionTimer = 0;
    this.headBob = 0;
  }

  update(delta, mouthOpen) {
    // Smooth mouth animation
    this.mouthTarget = mouthOpen;
    this.mouthCurrent += (this.mouthTarget - this.mouthCurrent) * Math.min(1, delta * 20);
    this.animateMouth(this.mouthCurrent);

    // Blinking
    this.blinkTimer += delta;
    if (!this.isBlinking && this.blinkTimer > 2.5 + Math.random() * 3) {
      this.isBlinking = true;
      this.blinkDuration = 0;
    }
    if (this.isBlinking) {
      this.blinkDuration += delta;
      const blinkProgress = Math.min(1, this.blinkDuration / 0.15);
      const blinkAmount = blinkProgress < 0.5 
        ? blinkProgress * 2 
        : (1 - blinkProgress) * 2;
      this.animateBlink(blinkAmount);
      if (this.blinkDuration > 0.15) {
        this.isBlinking = false;
        this.blinkTimer = 0;
        this.animateBlink(0);
      }
    }

    // Eye look (gentle wandering)
    this.eyeLookX += (Math.sin(Date.now() * 0.0007) * 0.05 - this.eyeLookX) * delta * 3;
    this.eyeLookY += (Math.cos(Date.now() * 0.0011) * 0.03 - this.eyeLookY) * delta * 3;
    this.animateEyes(this.eyeLookX, this.eyeLookY);

    // Head bob when speaking
    if (mouthOpen > 0.1) {
      this.headBob += delta * 8;
      const bob = Math.sin(this.headBob) * 0.03 * mouthOpen;
      this.parts.group.position.y = 0 + bob;
    } else if (this.parts.group.position.y !== 0) {
      this.parts.group.position.y += (0 - this.parts.group.position.y) * delta * 5;
    }

    // Expression timer
    this.expressionTimer -= delta;
    if (this.expressionTimer <= 0 && this.expression !== 'neutral') {
      this.setExpression('neutral');
    }
  }

  animateMouth(amount) {
    if (!this.parts.upperLip || !this.parts.lowerLip || !this.parts.interior) return;
    
    // Open mouth: move lips apart, show interior
    const openY = amount * 0.08;
    this.parts.upperLip.position.y = 0.02 + openY;
    this.parts.lowerLip.position.y = -0.02 - openY;
    
    // Scale interior to fill the gap
    const interiorScale = Math.max(0.01, amount * 0.08);
    this.parts.interior.scale.y = interiorScale;
    
    // Wider mouth when open
    const widthScale = 1 + amount * 0.3;
    this.parts.upperLip.scale.x = widthScale;
    this.parts.lowerLip.scale.x = widthScale;
    this.parts.interior.scale.x = widthScale;
  }

  animateBlink(amount) {
    if (!this.parts.eyelids) return;
    for (const lid of this.parts.eyelids) {
      if (lid) lid.position.y = 0.45 - amount * 0.22;
    }
  }

  animateEyes(x, y) {
    if (!this.parts.pupils) return;
    for (const pupil of this.parts.pupils) {
      if (pupil) {
        pupil.position.x = (pupil.position.x > 0 ? 0.28 : -0.28) + x;
        pupil.position.y = 0.35 + y;
      }
    }
  }

  setExpression(expr) {
    this.expression = expr;
    this.expressionTimer = 3;

    if (!this.parts.eyebrows) return;

    switch (expr) {
      case 'happy':
        // Raise eyebrows
        for (const brow of this.parts.eyebrows) {
          if (brow) brow.position.y = 0.6;
        }
        break;
      case 'thinking':
        // Furrow one brow
        const [left, right] = this.parts.eyebrows;
        if (left) left.position.y = 0.5;
        if (right) right.position.y = 0.58;
        break;
      case 'surprised':
        // Wide eyes, raised brows
        for (const brow of this.parts.eyebrows) {
          if (brow) brow.position.y = 0.65;
        }
        break;
      default:
        for (const brow of this.parts.eyebrows) {
          if (brow) brow.position.y = 0.55;
        }
    }
  }

  lookAt(x, y) {
    this.eyeLookX = x * 0.08;
    this.eyeLookY = y * 0.05;
  }
}

// ─── React Component ───

export default function NexusAvatar({ 
  speaking = false, 
  onReady,
  expression = 'neutral',
  size = 300,
  className = '',
}) {
  const containerRef = useRef(null);
  const avatarRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // ─── Scene Setup ───
    const width = size;
    const height = size;

    const scene = new THREE.Scene();
    scene.background = null; // transparent

    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 10);
    camera.position.set(0, 0.1, 4.5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(1, 1.5, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    fillLight.position.set(-1, 0.5, 2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
    rimLight.position.set(0, -0.5, 1);
    scene.add(rimLight);

    // Create avatar
    const parts = createAnimeAvatar(scene);
    const animator = new AvatarAnimator(parts);

    // Audio analyzer
    const analyser = new LipSyncAnalyzer();
    analyser.init().then(() => {
      analyserRef.current = analyser;
      if (onReady) onReady(analyser);
    });

    // Animation loop
    let lastTime = performance.now();
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      
      const now = performance.now();
      const delta = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      // Get mouth open from audio analyzer
      const mouthOpen = analyserRef.current ? analyserRef.current.getMouthOpen() : 0;
      
      // If we're told we're speaking but no audio detected, simulate some movement
      const effectiveMouth = speaking && mouthOpen < 0.05 ? 0.3 + Math.sin(now * 0.01) * 0.2 : mouthOpen;
      
      animator.update(delta, effectiveMouth);

      // Gentle head rotation
      const rotSpeed = 0.3;
      parts.group.rotation.y = Math.sin(now * 0.0003) * 0.15;
      parts.group.rotation.x = Math.sin(now * 0.0005) * 0.05;

      renderer.render(scene, camera);
    }
    animate();

    avatarRef.current = { animator, parts, scene, camera, renderer };

    // Cleanup
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [size]);

  // Update expression
  useEffect(() => {
    if (avatarRef.current?.animator) {
      avatarRef.current.animator.setExpression(expression);
    }
  }, [expression]);

  // Expose avatar controls
  useEffect(() => {
    if (avatarRef.current && onReady) {
      onReady({
        setExpression: (expr) => avatarRef.current.animator?.setExpression(expr),
        lookAt: (x, y) => avatarRef.current.animator?.lookAt(x, y),
        getAnalyser: () => analyserRef.current,
        getAnimator: () => avatarRef.current.animator,
      });
    }
  }, [onReady]);

  return (
    <div 
      ref={containerRef} 
      className={`avatar-container ${className}`}
      style={{ 
        width: size, 
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 40%, #1a1a2e 0%, #0a0a0f 100%)',
      }}
    />
  );
}

// Also export the raw classes for advanced use
export { LipSyncAnalyzer, AvatarAnimator, createAnimeAvatar };
