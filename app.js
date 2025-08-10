import { TrippyFluid } from './shader.js';
import { GeneratedWorld } from './threeScene.js';
import { gsap } from 'gsap';

// Elements
const stage = document.getElementById('stage');
const door = document.getElementById('door');
const slit = document.getElementById('light-slit');
const hud = document.getElementById('hud');
const transcriptEl = document.getElementById('transcript');
const trippyCanvas = document.getElementById('trippy-canvas');
const statusEl = document.getElementById('status');
const worldMount = document.getElementById('world');

let trippy;
let world;

// Microphone handling via Web Speech API (with webkit prefix fallback)
let recognition;
let listening = false;
let interimTranscript = '';
let finalTranscript = '';

function showStatus(text, timeout = 1800) {
  statusEl.textContent = text;
  statusEl.classList.add('show');
  if (timeout) {
    setTimeout(() => statusEl.classList.remove('show'), timeout);
  }
}

function setHUD(active, promptText) {
  hud.classList.toggle('active', active);
  if (promptText) hud.querySelector('.prompt').textContent = promptText;
}

function ensureTrippy() {
  if (!trippy) trippy = new TrippyFluid(trippyCanvas);
}

function openDoor() {
  door.classList.add('open');
}

function hideDoor() {
  door.classList.add('hideDoor');
}

function startListening() {
  if (listening) return;
  finalTranscript = '';
  interimTranscript = '';
  setHUD(true, 'Listening… say where you want to go');
  transcriptEl.textContent = '';

  try {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += t;
          } else {
            interimTranscript += t;
          }
        }
        transcriptEl.textContent = (finalTranscript || '') + (interimTranscript ? ' ' + interimTranscript : '');
      };
      recognition.onerror = (e) => {
        console.warn('Speech error', e);
        showStatus('Microphone error. Try again.');
      };
      recognition.start();
      listening = true;
    } else {
      // Fallback prompt (no STT available)
      showStatus('Speech not supported. Type your destination.');
      const typed = prompt('Where do you want to go?');
      if (typed) {
        finalTranscript = typed;
        transcriptEl.textContent = typed;
        onSpeechComplete();
      } else {
        setHUD(false);
      }
      return;
    }
  } catch (e) {
    console.error(e);
    showStatus('Failed to access microphone.');
    setHUD(false);
  }
}

function stopListening() {
  if (!listening) return onSpeechComplete();
  try {
    recognition.onend = () => onSpeechComplete();
    recognition.stop();
  } catch {
    onSpeechComplete();
  }
  listening = false;
}

async function onSpeechComplete() {
  setHUD(false);
  const promptText = (finalTranscript || interimTranscript || '').trim();
  if (!promptText) {
    showStatus('Heard nothing. Hold the light and try again.');
    return;
  }

  // Door opens and trippy load begins
  openDoor();
  ensureTrippy();
  trippy.start();
  showStatus('Dreaming up your world…');

  // Plan the scene with an LLM
  let plan;
  try {
    plan = await getScenePlan(promptText);
  } catch (e) {
    console.error(e);
    showStatus('Could not plan the world. Try a different ask.');
    trippy.stop();
    return;
  }

  // Generate sky image if requested
  const assets = {};
  try {
    if (plan.skyPrompt) {
      const img = await websim.imageGen({
        prompt: plan.skyPrompt,
        aspect_ratio: '16:9'
      });
      assets.skyUrl = img.url;
    }
  } catch (e) {
    console.warn('Sky generation failed', e);
  }

  // Build 3D scene
  worldMount.style.display = 'block';
  world = new GeneratedWorld(worldMount);

  try {
    await world.buildFromPlan(plan, assets);
  } catch (e) {
    console.error(e);
    showStatus('Building failed. Try again.');
    worldMount.style.display = 'none';
    trippy.stop();
    return;
  }

  // Transition: sink through the door into the scene
  await dissolveDoorToWorld();

  trippy.stop();
  world.start();
  showStatus('You have arrived.', 1500);
}

async function dissolveDoorToWorld() {
  // Expand the trippy canvas brightness and then fade door away
  return new Promise((resolve) => {
    // Slight delay for dramatic effect
    gsap.timeline({ onComplete: resolve })
      .to('#trippy-canvas', { opacity: 1, duration: 0.2, ease: 'power1.out' }, 0)
      .to('.panel.left, .panel.right', { opacity: 0, duration: 0.6, ease: 'power2.in' }, 0.2)
      .to('#door', { opacity: 0, duration: 0.6, ease: 'power2.in' }, 0.2)
      .add(() => hideDoor(), '>-0.1')
      .to('#trippy-canvas', { opacity: 0, duration: 0.8, ease: 'power2.out' }, '>-0.1');
  });
}

// Input handling: tap/hold to listen
let pressTimer = null;
let didHold = false;

function onPressStart(e) {
  e.preventDefault();
  didHold = true;
  pressTimer = setTimeout(() => {
    startListening();
  }, 120); // quick response to hold
}

function onPressEnd(e) {
  e.preventDefault();
  clearTimeout(pressTimer);
  if (didHold) {
    stopListening();
    didHold = false;
  }
}

['mousedown','touchstart','pointerdown'].forEach(evt => slit.addEventListener(evt, onPressStart, { passive: false }));
['mouseup','mouseleave','touchend','touchcancel','pointerup','pointercancel'].forEach(evt => slit.addEventListener(evt, onPressEnd, { passive: false }));

// Keyboard accessibility: press/hold Enter/Space
slit.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' || e.code === 'Space') onPressStart(e);
});
slit.addEventListener('keyup', (e) => {
  if (e.code === 'Enter' || e.code === 'Space') onPressEnd(e);
});

// Initial hint
setTimeout(() => showStatus('Hold the light to speak your destination'), 600);

// LLM call to plan a scene given a user prompt
async function getScenePlan(userPrompt) {
  // Maintain very small convo for potential continuity
  if (!window.conversationHistory) window.conversationHistory = [];
  window.conversationHistory.push({ role: 'user', content: `Destination: ${userPrompt}` });
  window.conversationHistory = window.conversationHistory.slice(-10);

  const system = `
You are a scene designer that outputs compact JSON for a stylized Three.js world.
Respond directly with JSON following this schema and no other text:
{
  title: string;
  seed: number;
  background?: string; // CSS color
  fog?: { color: string; near?: number; far?: number; }
  palette: string[]; // array of hex colors
  bounds?: { x: number; z: number; }
  skyPrompt?: string; // prompt for a wide equirectangular sky matching the scene
  ground?: { color?: string; }
  objects: {
    shape: "sphere" | "box" | "torus" | "cone" | "cylinder";
    count?: number;
    size?: number; // base size
    color?: string;
    float?: boolean;
    spin?: boolean;
    metalness?: number;
    roughness?: number;
    emissive?: number | string;
    emissiveIntensity?: number;
  }[];
}
Keep counts reasonable for performance (10-60 objects total). Prefer evocative palettes and a good skyPrompt for ambience. If the user's prompt implies a theme (e.g., neon city, tranquil forest, space), reflect it.
If unsafe or impossible, default to a surreal abstract garden with soft colors.
  `.trim();

  const completion = await websim.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      ...window.conversationHistory,
    ],
    json: true,
  });

  const plan = JSON.parse(completion.content);

  // Light validation and defaults
  plan.title ||= 'Generated World';
  plan.seed ||= Math.floor(Math.random() * 1e9);
  plan.palette ||= ['#7afcff', '#feff9c', '#f400ff', '#b983ff', '#41ead4'];
  plan.bounds ||= { x: 40, z: 40 };
  plan.objects = Array.isArray(plan.objects) ? plan.objects.slice(0, 5) : [];

  // Store assistant message for future context
  window.conversationHistory.push({ role: 'assistant', content: completion.content });

  return plan;
}

