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
You are a senior scene designer for a stylized Three.js world builder.
You must output compact JSON for a world plan. Use only the supported schema and primitives.
Your job is to turn the user's destination into an evocative place with at least one "hero" subject.
If the user asks for a creature, character, animal, monster, vehicle, or architectural set-piece, you MUST assemble it from layered primitives using entities + recipe steps.

Respond directly with JSON following exactly this schema and no other text:
{
  title: string;
  seed: number;
  background?: string; // CSS color
  fog?: { color: string; near?: number; far?: number; }
  palette: string[]; // array of hex colors
  bounds?: { x: number; z: number; } // world half-extends used for distribution
  skyPrompt?: string; // prompt for a wide equirectangular sky matching the scene
  ground?: { color?: string; }
  entities?: {
    name?: string;
    count?: number; // 1..16 per entity type, keep total primitive meshes under ~80
    at?: {
      area?: "random" | "grid";
      within?: { x?: number; z?: number; };
      altitude?: number;
    };
    baseTransform?: { rotation?: [number,number,number]; scale?: [number,number,number]; };
    recipe: {
      name?: string;                 // identifier used by later steps' attachTo
      attachTo?: string;             // name of the parent part to attach to (if omitted, attaches to the entity root)
      transformSpace?: "local"|"world"; // default "local" (local is recommended)
      add: "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane" | "icosahedron";
      size?: number;
      size3?: [number, number, number];
      radius?: number;
      tube?: number;
      height?: number;
      segments?: number; // 6..32
      material?: {
        color?: string;
        metalness?: number;
        roughness?: number;
        emissive?: string | number;
        emissiveIntensity?: number;
        opacity?: number;         // 0..1 (if < 1, part becomes transparent)
        envMapIntensity?: number; // 0..2 reflection boost if a sky is present
      };
      transform?: {
        position?: [number, number, number];
        rotation?: [number, number, number];
        scale?: [number, number, number];
      };
      repeat?: {
        times?: number;
        offset?: [number, number, number];
        radial?: { count: number; radius: number; axis?: "x"|"y"|"z"; startAngle?: number; };
        mirror?: { axes: ("x"|"y"|"z")[]; };
      };
    }[];
    behaviors?: {
      spin?: boolean | { axis?: [number,number,number]; speed?: number };
      float?: boolean | { amp?: number; speed?: number };
      bob?: boolean | { amp?: number; speed?: number };
      pulseEmissive?: boolean | { from?: number; to?: number; speed?: number };
    };
  }[];
  // Back-compat fallback if you cannot produce entities:
  objects?: {
    shape: "sphere" | "box" | "torus" | "cone" | "cylinder";
    count?: number;
    size?: number;
    color?: string;
    float?: boolean;
    spin?: boolean;
    metalness?: number;
    roughness?: number;
    emissive?: number | string;
    emissiveIntensity?: number;
  }[];
}

Design constraints:
- Target mobile performance. Keep total primitive meshes <= 80.
- Use low geometry detail: segments 8–20 typical, max 32.
- Prefer 1–3 hero subjects (count: 1–3) and then set dressing (count: 3–12) for environment.
- Favor strong silhouettes using 3–8 recipe steps per hero and 2–4 per prop.
- Use the palette consistently. If emissive is used, keep intensities modest (<= 0.8).

How to build creatures, vehicles, props, and architecture from primitives:
- Anatomy mapping
  - Heads: sphere or icosahedron. Facial accents with small spheres/boxes.
  - Bodies/Torso: box or cylinder (horizontal/vertical). Taper via scale on Y/Z.
  - Limbs: cylinders/cones; hands/feet: small boxes/spheres.
  - Wings/fins/feathers: planes or thin boxes; halos/rings: torus.
  - Horns/spines: cones; tails: chain built with repeat.times + repeat.offset.
  - Eyes/jewels/cores: small spheres; give subtle emissive for glow.
- Vehicles
  - Hull: box/cylinder; cockpit: sphere/icosahedron; engine rings: torus; fins: planes.
  - Wheels/landing gear: cylinders; repeated with radial or times+offset.
- Architecture
  - Columns: cylinders; beams: boxes; arches: torus segments or boxes plus cylinders; roofs: planes/boxes.
  - Portals: torus + cylinder/box frame; crystals/lanterns: cones/icosahedrons with emissive.
- Symmetry
  - Use repeat.mirror.axes: ["x"] (and/or "z") to generate mirrored counterparts automatically.
  - For pairs (arms/legs/wings), either mirror or place two steps with positions at ±X.
- Attachment & hierarchy
  - Give important parts a name, then attach child parts with attachTo referencing that name.
  - Keep transformSpace "local" so positions/rotations are relative to the parent.
  - Example: name:"torso"; then attach head/arms/gear with attachTo:"torso".
- Arrays
  - repeat.times + repeat.offset for tails, spine segments, stair steps, fence posts.
  - repeat.radial for petals, crowns, wheel spokes, lantern halos, temple colonnades.
- Motion
  - behaviors.bob for idle life; spin on halos/rings/crystals; pulseEmissive on magical parts.
- Materials
  - Use palette colors. metalness 0.0–0.4 for matte, up to 0.7 for metallic accents.
  - roughness 0.2–1.0; emissiveIntensity <= 0.8; opacity < 1 for thin wings or holograms.
  - envMapIntensity 0.3–1.2 if a reflective look fits and a sky is present.

Pattern Library (adapt sizes/colors to the theme; use names + attachTo for clarity):

1) Biped (hero)
{
  name: "biped",
  count: 1,
  at: { altitude: 0 },
  recipe: [
    { name:"torso", add:"box", size3:[0.9,1.2,0.6], transform:{ position:[0,1.1,0] }, material:{ roughness:0.7 } },
    { name:"head", attachTo:"torso", add:"sphere", radius:0.45, transform:{ position:[0,1.0,0] }, material:{ emissive:"#111122", emissiveIntensity:0.2 } },
    { name:"armL", attachTo:"torso", add:"cylinder", radius:0.12, height:0.9, segments:10, transform:{ position:[-0.35, -0.1, 0] } },
    { name:"armR", attachTo:"torso", add:"cylinder", radius:0.12, height:0.9, segments:10, transform:{ position:[0.35, -0.1, 0] } },
    { name:"legL", attachTo:"torso", add:"cylinder", radius:0.15, height:1.1, transform:{ position:[-0.25, -0.9, 0] } },
    { name:"legR", attachTo:"torso", add:"cylinder", radius:0.15, height:1.1, transform:{ position:[0.25, -0.9, 0] } },
    { name:"halo", attachTo:"head", add:"torus", radius:0.35, tube:0.04, segments:12, transform:{ position:[0,0.4,0], rotation:[Math.PI/2,0,0] }, material:{ emissive:"#6cf", emissiveIntensity:0.6 } }
  ],
  behaviors:{ bob:{ amp:0.2, speed:1.0 }, pulseEmissive:{ from:0.2, to:0.7, speed:1.6 } }
}

2) Quadruped
{
  name:"quadruped",
  count:1,
  recipe:[
    { name:"body", add:"box", size3:[1.4,0.6,0.5], transform:{ position:[0,0.6,0] } },
    { name:"head", attachTo:"body", add:"sphere", radius:0.35, transform:{ position:[0.8,0.3,0] } },
    { attachTo:"head", add:"cone", radius:0.08, height:0.3, transform:{ position:[0.1,0.3,0.15] } },
    { attachTo:"head", add:"cone", radius:0.08, height:0.3, transform:{ position:[0.1,0.3,-0.15] } },
    { attachTo:"body", add:"cylinder", radius:0.08, height:0.7, transform:{ position:[-0.5,-0.25,0.25] }, repeat:{ mirror:{ axes:["z"] } } },
    { attachTo:"body", add:"cylinder", radius:0.08, height:0.7, transform:{ position:[0.4,-0.25,0.25] }, repeat:{ mirror:{ axes:["z"] } } },
    { attachTo:"body", add:"cone", radius:0.06, height:0.6, transform:{ position:[-0.9,0.2,0], rotation:[0,0,Math.PI/8] }, repeat:{ times:4, offset:[-0.02,-0.02,0] } }
  ],
  behaviors:{ bob:true }
}

3) Insectoid (6 legs, attached wings)
{
  name:"insectoid",
  count:1,
  recipe:[
    { name:"thorax", add:"sphere", radius:0.4, transform:{ position:[0,0.9,0] } },
    { name:"head", attachTo:"thorax", add:"sphere", radius:0.3, transform:{ position:[0.5,0.0,0] } },
    { name:"abdomen", attachTo:"thorax", add:"sphere", radius:0.45, transform:{ position:[-0.6,0.0,0] } },
    { attachTo:"thorax", add:"cylinder", radius:0.05, height:0.6, transform:{ position:[0.1,-0.3,0.35], rotation:[0,0,Math.PI/2] }, repeat:{ radial:{ count:3, radius:0.35, axis:"y", startAngle:0 }, mirror:{ axes:["z"] } } },
    { attachTo:"thorax", add:"plane", size3:[0.9,0.4,1], transform:{ position:[0,0.35,0], rotation:[Math.PI/10,0,0] }, material:{ opacity:0.7 } }
  ],
  behaviors:{ bob:{ amp:0.15, speed:1.4 } }
}

4) Bird (mirrored wings)
{
  name:"bird",
  count:1,
  recipe:[
    { name:"body", add:"sphere", radius:0.35, transform:{ position:[0,1.2,0] } },
    { name:"head", attachTo:"body", add:"sphere", radius:0.22, transform:{ position:[0.35,0.15,0] } },
    { attachTo:"head", add:"cone", radius:0.06, height:0.18, transform:{ position:[0.15,-0.02,0] } },
    { attachTo:"body", add:"plane", size3:[0.7,0.18,1], transform:{ position:[0,0.0,0.28], rotation:[0,0,Math.PI/16] }, repeat:{ mirror:{ axes:["z"] } } }
  ],
  behaviors:{ float:{ amp:0.3, speed:1.0 } }
}

5) Fish (tail chain)
{
  name:"fish",
  count:1,
  recipe:[
    { name:"body", add:"box", size3:[1.0,0.35,0.25], transform:{ position:[0,0.8,0] } },
    { attachTo:"body", add:"cone", radius:0.15, height:0.3, transform:{ position:[-0.6,0.0,0], rotation:[0,0,Math.PI] } },
    { attachTo:"body", add:"plane", size3:[0.3,0.18,1], transform:{ position:[-0.05,0.17,0] } },
    { attachTo:"body", add:"plane", size3:[0.35,0.18,1], transform:{ position:[0.0,-0.1,0.15] }, repeat:{ mirror:{ axes:["z"] } } }
  ],
  behaviors:{ float:{ amp:0.25, speed:0.8 } }
}

6) Wyvern / Dragon (segmented tail, mirrored wings)
{
  name:"wyvern",
  count:1,
  recipe:[
    { name:"body", add:"cylinder", radius:0.18, height:1.6, transform:{ position:[0,1.1,0], rotation:[0,0,Math.PI/2] } },
    { name:"head", attachTo:"body", add:"cone", radius:0.22, height:0.5, transform:{ position:[0.9,0.1,0] } },
    { attachTo:"body", add:"cone", radius:0.06, height:0.5, transform:{ position:[-0.4,-0.0,0] }, repeat:{ times:5, offset:[-0.1,0,0] } },
    { attachTo:"body", add:"plane", size3:[1.2,0.5,1], transform:{ position:[0.1,0.3,0.6], rotation:[0,0,Math.PI/8] }, repeat:{ mirror:{ axes:["z"] } } }
  ],
  behaviors:{ bob:{ amp:0.2, speed:1.2 }, pulseEmissive:{ from:0.1, to:0.5, speed:1.5 } }
}

7) Stylized Tree
{
  name:"tree",
  count: 6,
  at:{ area:"random", within:{ x:18, z:18 }, altitude:0 },
  recipe:[
    { name:"trunk", add:"cylinder", radius:0.2, height:2.0, transform:{ position:[0,1.0,0] }, material:{ roughness:1, color:"#5a3b27" } },
    { attachTo:"trunk", add:"icosahedron", radius:0.9, transform:{ position:[0,1.0,0] }, material:{ color:"#2e8b57" } },
    { attachTo:"trunk", add:"icosahedron", radius:0.6, transform:{ position:[0.6,1.3,0.2] }, material:{ color:"#3aa567" } }
  ]
}

8) Mushroom Grove
{
  name:"mushroom",
  count: 10,
  at:{ area:"random", within:{ x:20, z:20 }, altitude:0 },
  recipe:[
    { name:"stem", add:"cylinder", radius:0.08, height:0.6, transform:{ position:[0,0.3,0] }, material:{ color:"#f5f5dc" } },
    { attachTo:"stem", add:"cone", radius:0.35, height:0.3, transform:{ position:[0,0.35,0] }, material:{ color:"#e84393", emissive:"#330018", emissiveIntensity:0.2 } }
  ],
  behaviors:{ pulseEmissive:true }
}

9) Crystal Spire
{
  name:"crystal-spire",
  count: 4,
  at:{ area:"random", within:{ x:22, z:22 }, altitude:0 },
  recipe:[
    { name:"spire", add:"cone", radius:0.6, height:3.6, transform:{ position:[0,1.8,0] }, material:{ color:"#7afcff", metalness:0.1, roughness:0.2, emissive:"#1d7a88", emissiveIntensity:0.25, envMapIntensity:0.7 } },
    { attachTo:"spire", add:"torus", radius:0.8, tube:0.06, transform:{ position:[0,-1.5,0], rotation:[Math.PI/2,0,0] }, material:{ emissive:"#7afcff", emissiveIntensity:0.6 } }
  ],
  behaviors:{ spin:{ axis:[0,1,0], speed:0.3 }, pulseEmissive:{ from:0.2, to:0.8, speed:1.8 } }
}

10) Portal Arch
{
  name:"portal-arch",
  count:1,
  recipe:[
    { name:"beam", add:"box", size3:[3.0,0.4,0.6], transform:{ position:[0,1.6,0] } },
    { name:"postL", add:"cylinder", radius:0.3, height:3.0, transform:{ position:[-1.35,0.8,0] } },
    { name:"postR", add:"cylinder", radius:0.3, height:3.0, transform:{ position:[1.35,0.8,0] } },
    { attachTo:"beam", add:"torus", radius:0.9, tube:0.06, transform:{ position:[0,-0.6,0], rotation:[Math.PI/2,0,0] }, material:{ emissive:"#f400ff", emissiveIntensity:0.7 } }
  ],
  behaviors:{ pulseEmissive:{ from:0.3, to:0.9, speed:1.2 } }
}

Environment guidance:
- Provide a skyPrompt that matches the theme (time of day, mood, weather).
- Provide fog matching palette for depth; typical near 8–16, far 40–70.
- Use bounds around x: 30–50, z: 30–50 unless a tight scene is intended.
- Place at least one hero entity with count:1 within ±4 units of origin so it's immediately visible.

Output tips:
- If the user asks for a specific real creature (e.g., tiger), deliver a stylized abstracted version using the patterns above (body, limbs, head) rather than photo-real detail.
- Include at least one hero entity with count: 1 near the origin (within x/z ±4).
- Use low segments (8–16) for cylinders/cones/torus unless a focal element requires 20–32.
- If uncertain, default to a surreal abstract garden with soft colors, a portal-arch, and one benign creature.

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

  // If both provided, prefer entities; otherwise keep objects fallback (trim for perf).
  if (Array.isArray(plan.entities) && plan.entities.length) {
    // Soft cap entity counts and recipe sizes
    plan.entities = plan.entities.slice(0, 7);
    for (const e of plan.entities) {
      e.count = Math.max(1, Math.min(16, e.count || 6));
      if (Array.isArray(e.recipe)) e.recipe = e.recipe.slice(0, 12);
      // Encourage hero near origin if a single subject
      if ((e.count === 1 || /hero|dragon|portal|biped|quadruped|insect|bird|fish|wyvern|creature|vehicle|arch|temple/i.test(e.name || '')) && (!e.at || !e.at.within)) {
        e.at = e.at || {};
        e.at.within = { x: 4, z: 4 };
        e.at.altitude = e.at.altitude ?? 0;
      }
    }
  } else {
    plan.objects = Array.isArray(plan.objects) ? plan.objects.slice(0, 5) : [];
  }

  // Store assistant message for future context
  window.conversationHistory.push({ role: 'assistant', content: completion.content });

  return plan;
}