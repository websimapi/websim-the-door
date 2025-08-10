import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { gsap } from 'gsap';

export class GeneratedWorld {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000);
    this.camera.position.set(0, 3, 8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enabled = false;

    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  async buildFromPlan(plan, assets) {
    const scene = this.scene;

    // Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 8, 5);
    scene.add(dir);

    // Fog and background
    if (plan.fog) {
      const fogColor = new THREE.Color(plan.fog.color || '#101018');
      scene.fog = new THREE.Fog(fogColor, plan.fog.near ?? 8, plan.fog.far ?? 60);
      this.renderer.setClearColor(fogColor);
    }

    if (assets.skyUrl) {
      // Equirectangular sky
      const loader = new THREE.TextureLoader();
      const skyTex = await new Promise(resolve => {
        loader.load(assets.skyUrl, resolve, undefined, () => resolve(null));
      });
      if (skyTex) {
        skyTex.mapping = THREE.EquirectangularReflectionMapping;
        skyTex.colorSpace = THREE.SRGBColorSpace;
        scene.background = skyTex;
        scene.environment = skyTex;
      }
    } else {
      scene.background = new THREE.Color(plan.background || '#000010');
    }

    // Ground
    const groundGeo = new THREE.PlaneGeometry(400, 400, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({
      color: plan.ground?.color || '#111115',
      metalness: 0.0,
      roughness: 1.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    scene.add(ground);

    // Build content: prefer entities (layered), fallback to objects
    const rng = mulberry32(plan.seed || 1234);
    if (Array.isArray(plan.entities) && plan.entities.length) {
      const worldGroup = new THREE.Group();
      const worldBounds = { x: plan.bounds?.x ?? 40, z: plan.bounds?.z ?? 40 };
      for (const ent of plan.entities) {
        const count = Math.max(1, Math.min(64, ent.count || 4));
        const area = ent.at?.area || 'random';
        const within = {
          x: ent.at?.within?.x ?? worldBounds.x,
          z: ent.at?.within?.z ?? worldBounds.z
        };
        const altitude = ent.at?.altitude ?? 0;

        // Prebuild a template entity group from recipe for cloning
        const template = buildRecipeGroup(ent.recipe || [], plan.palette, rng);
        if (ent.baseTransform?.rotation) applyEuler(template.rotation, ent.baseTransform.rotation);
        if (ent.baseTransform?.scale) applyScale(template.scale, ent.baseTransform.scale);

        // Distribution
        if (area === 'grid') {
          const gridCount = Math.ceil(Math.sqrt(count));
          const stepX = (within.x * 2) / Math.max(1, gridCount - 1);
          const stepZ = (within.z * 2) / Math.max(1, gridCount - 1);
          let placed = 0;
          for (let gx = 0; gx < gridCount && placed < count; gx++) {
            for (let gz = 0; gz < gridCount && placed < count; gz++) {
              const g = template.clone(true);
              g.position.set(-within.x + gx * stepX, altitude, -within.z + gz * stepZ);
              worldGroup.add(g);
              attachBehaviors(g, ent.behaviors, rng);
              placed++;
            }
          }
        } else {
          // random
          for (let i = 0; i < count; i++) {
            const g = template.clone(true);
            g.position.set(
              (rng() - 0.5) * 2 * within.x,
              altitude,
              (rng() - 0.5) * 2 * within.z
            );
            // small random yaw variation
            g.rotation.y += (rng() - 0.5) * 0.6;
            worldGroup.add(g);
            attachBehaviors(g, ent.behaviors, rng);
          }
        }
      }
      scene.add(worldGroup);
    } else {
      // Fallback to simple scattered objects
      const group = new THREE.Group();
      for (const obj of (plan.objects || [])) {
        const count = Math.min(100, Math.max(1, obj.count || 8));
        for (let i = 0; i < count; i++) {
          let mesh;
          const mat = new THREE.MeshStandardMaterial({
            color: obj.color || pickColor(plan.palette, rng),
            metalness: obj.metalness ?? 0.1,
            roughness: obj.roughness ?? 0.8,
            emissive: toColor(obj.emissive) ?? 0x000000,
            emissiveIntensity: obj.emissive ? (obj.emissiveIntensity ?? 0.3) : 0,
          });

          const s = (obj.size || 1) * (0.5 + rng());
          switch ((obj.shape || 'sphere').toLowerCase()) {
            case 'box':
              mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
              break;
            case 'torus':
              mesh = new THREE.Mesh(new THREE.TorusGeometry(s * 0.7, s * 0.25, 12, 32), mat);
              break;
            case 'cone':
              mesh = new THREE.Mesh(new THREE.ConeGeometry(s * 0.7, s * 1.4, 16), mat);
              break;
            case 'cylinder':
              mesh = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.6, s * 0.6, s * 1.2, 16), mat);
              break;
            default:
              mesh = new THREE.Mesh(new THREE.SphereGeometry(s * 0.7, 20, 20), mat);
          }
          mesh.position.set(
            (rng() - 0.5) * (plan.bounds?.x ?? 40),
            obj.float ? 1 + rng() * 4 : 0.5 * s,
            (rng() - 0.5) * (plan.bounds?.z ?? 40)
          );
          mesh.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
          mesh.castShadow = true;
          group.add(mesh);

          if (obj.spin) {
            gsap.to(mesh.rotation, {
              y: mesh.rotation.y + (rng() > 0.5 ? 2 : -2) * Math.PI,
              duration: 20 + rng() * 20,
              ease: 'none',
              repeat: -1
            });
          }
          if (obj.float) {
            gsap.to(mesh.position, {
              y: mesh.position.y + (rng() > 0.5 ? 1 : -1) * 0.5,
              duration: 3 + rng() * 3,
              yoyo: true,
              repeat: -1,
              ease: 'sine.inOut'
            });
          }
        }
      }
      scene.add(group);
    }

    // Camera entry animation (sink in)
    const startY = 5;
    const startZ = 10;
    this.camera.position.set(0, startY, startZ);
    this.controls.enabled = false;

    await new Promise(res => setTimeout(res, 50));
    await new Promise((resolve) => {
      gsap.timeline({ onComplete: resolve })
        .to(this.camera.position, { z: 2.5, duration: 2.0, ease: 'power2.in' })
        .to(this.camera.position, { y: 2.2, duration: 1.6, ease: 'sine.out' }, '<0.4');
    });

    this.controls.enabled = true;
  }

  start() {
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

// Build a layered entity from a recipe (array of steps)
function buildRecipeGroup(recipe, palette, rng) {
  const group = new THREE.Group();
  const steps = Array.isArray(recipe) ? recipe : [];
  const parts = new Map(); // name -> Object3D

  for (let idx = 0; idx < steps.length; idx++) {
    const step = steps[idx];
    const created = instantiatePartWithContext(step, palette, rng, parts);
    // Parent new parts either to an attach target or to root
    let parent = group;
    if (step && typeof step.attachTo === 'string' && parts.has(step.attachTo)) {
      parent = parts.get(step.attachTo);
    }
    for (const obj of created) parent.add(obj);
    // Register named parts
    if (step && step.name) {
      if (created.length === 1) {
        parts.set(step.name, created[0]);
      } else {
        // If multiple, store the first instance under the given name, and also suffix-index keys
        parts.set(step.name, created[0]);
        created.forEach((o, i) => parts.set(`${step.name}[${i}]`, o));
      }
    }
  }
  return group;
}

// Create one or more meshes for a single step, with hierarchy awareness
function instantiatePartWithContext(step, palette, rng, partsMap) {
  const {
    add = 'box',
    size,
    size3,
    radius,
    tube,
    height,
    segments = 12,
    material = {},
    transform = {},
    repeat
  } = step || {};

  const mat = new THREE.MeshStandardMaterial({
    color: toColor(material.color) ?? pickColor(palette, rng),
    metalness: clamp01(material.metalness ?? 0.1),
    roughness: clamp01(material.roughness ?? 0.85),
    emissive: toColor(material.emissive) ?? 0x000000,
    emissiveIntensity: material.emissive ? (material.emissiveIntensity ?? 0.4) : 0
  });
  if (typeof material.opacity === 'number' && material.opacity < 1) {
    mat.transparent = true;
    mat.opacity = Math.max(0.02, material.opacity);
    mat.depthWrite = mat.opacity >= 0.5; // simple heuristic
  }
  if (typeof material.envMapIntensity === 'number') {
    mat.envMapIntensity = material.envMapIntensity;
  }

  const baseGeom = makeGeometry(add.toLowerCase(), {
    size: size ?? 1,
    size3,
    radius: radius ?? (size ?? 0.6),
    tube: tube ?? Math.max(0.05, (size ?? 1) * 0.2),
    height: height ?? (size ?? 1.2),
    segments: Math.max(6, Math.min(32, segments)),
  });

  const makeMesh = () => {
    const mesh = new THREE.Mesh(baseGeom, mat);
    // Base local transform
    const pos = transform.position || [0,0,0];
    const rot = transform.rotation || [0,0,0];
    const scl = transform.scale || [1,1,1];
    applyVec3(mesh.position, pos);
    applyEuler(mesh.rotation, rot);
    applyScale(mesh.scale, scl);
    mesh.castShadow = true;
    return mesh;
  };

  // Instances from repeat settings
  const instances = [];

  const addInstanceAt = (pos = [0,0,0], rot = [0,0,0], scl = [1,1,1]) => {
    const m = new THREE.Mesh(baseGeom, mat);
    applyVec3(m.position, pos);
    applyEuler(m.rotation, rot);
    applyScale(m.scale, scl);
    m.castShadow = true;
    instances.push(m);
  };

  const basePos = transform.position || [0,0,0];
  const baseRot = transform.rotation || [0,0,0];
  const baseScl = transform.scale || [1,1,1];

  if (repeat?.radial) {
    const count = Math.max(1, Math.min(64, repeat.radial.count || 6));
    const radiusR = repeat.radial.radius || 1.5;
    const axis = (repeat.radial.axis || 'y').toLowerCase();
    const startAngle = repeat.radial.startAngle ?? 0;
    for (let i = 0; i < count; i++) {
      const a = startAngle + (i / count) * Math.PI * 2;
      let pos = [...basePos];
      if (axis === 'y') {
        pos[0] += Math.cos(a) * radiusR;
        pos[2] += Math.sin(a) * radiusR;
      } else if (axis === 'x') {
        pos[1] += Math.cos(a) * radiusR;
        pos[2] += Math.sin(a) * radiusR;
      } else {
        pos[0] += Math.cos(a) * radiusR;
        pos[1] += Math.sin(a) * radiusR;
      }
      addInstanceAt(pos, baseRot, baseScl);
    }
  } else if (repeat?.times && repeat.times > 1) {
    const times = Math.min(128, Math.max(1, repeat.times));
    const offset = repeat.offset || [0,0,0];
    for (let i = 0; i < times; i++) {
      const pos = [
        basePos[0] + offset[0] * i,
        basePos[1] + offset[1] * i,
        basePos[2] + offset[2] * i
      ];
      addInstanceAt(pos, baseRot, baseScl);
    }
  } else {
    instances.push(makeMesh());
  }

  // Mirror symmetry (adds mirrored counterparts)
  if (repeat?.mirror && Array.isArray(repeat.mirror.axes) && repeat.mirror.axes.length) {
    const axes = repeat.mirror.axes;
    const mirrored = [];
    for (const inst of instances) {
      const m = inst.clone();
      if (axes.includes('x')) {
        m.position.x = -m.position.x;
        m.rotation.y = -m.rotation.y;
        m.rotation.z = -m.rotation.z;
      }
      if (axes.includes('y')) {
        m.position.y = -m.position.y;
        m.rotation.x = -m.rotation.x;
        m.rotation.z = -m.rotation.z;
      }
      if (axes.includes('z')) {
        m.position.z = -m.position.z;
        m.rotation.x = -m.rotation.x;
        m.rotation.y = -m.rotation.y;
      }
      mirrored.push(m);
    }
    instances.push(...mirrored);
  }

  return instances;
}

// Geometry factory for supported primitives
function makeGeometry(kind, opts) {
  const s = opts.size ?? 1;
  const seg = opts.segments ?? 12;
  switch (kind) {
    case 'box': {
      const v = opts.size3 || [s, s, s];
      return new THREE.BoxGeometry(v[0], v[1], v[2], 1, 1, 1);
    }
    case 'sphere':
      return new THREE.SphereGeometry(opts.radius ?? s * 0.6, seg, seg);
    case 'cylinder':
      return new THREE.CylinderGeometry(opts.radius ?? s * 0.5, opts.radius ?? s * 0.5, opts.height ?? s, Math.max(6, Math.floor(seg)));
    case 'cone':
      return new THREE.ConeGeometry(opts.radius ?? s * 0.5, opts.height ?? s * 1.2, Math.max(6, Math.floor(seg)));
    case 'torus':
      return new THREE.TorusGeometry(opts.radius ?? s * 0.7, opts.tube ?? s * 0.2, Math.max(6, Math.floor(seg)), Math.max(12, Math.floor(seg * 2)));
    case 'plane': {
      const v = opts.size3 || [s, s, 1];
      return new THREE.PlaneGeometry(v[0], v[1], 1, 1);
    }
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(opts.radius ?? s * 0.6, 0);
    default:
      return new THREE.SphereGeometry(opts.radius ?? s * 0.6, seg, seg);
  }
}

// Animate a group with behaviors
function attachBehaviors(group, behaviors, rng) {
  if (!behaviors) return;

  // spin
  let spinCfg = behaviors.spin;
  if (spinCfg) {
    const axis = Array.isArray(spinCfg.axis) ? spinCfg.axis : [0, 1, 0];
    const speed = typeof spinCfg === 'object' && typeof spinCfg.speed === 'number' ? spinCfg.speed : (0.2 + rng() * 0.3);
    const rotTarget = { t: 0 };
    gsap.to(rotTarget, {
      t: Math.PI * 2,
      duration: Math.max(2, 8 / speed),
      ease: 'none',
      repeat: -1,
      onUpdate: () => {
        group.rotation.x += axis[0] * 0.002 * speed;
        group.rotation.y += axis[1] * 0.002 * speed;
        group.rotation.z += axis[2] * 0.002 * speed;
      }
    });
  }

  // float/bob (vertical oscillation)
  const bobCfg = behaviors.bob || behaviors.float;
  if (bobCfg) {
    const amp = typeof bobCfg === 'object' && typeof bobCfg.amp === 'number' ? bobCfg.amp : 0.4;
    const speed = typeof bobCfg === 'object' && typeof bobCfg.speed === 'number' ? bobCfg.speed : 1.2 + rng();
    const baseY = group.position.y;
    gsap.to(group.position, {
      y: baseY + amp,
      duration: 1.5 / speed,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut'
    });
  }

  // pulse emissive across child meshes
  const pulse = behaviors.pulseEmissive;
  if (pulse) {
    const from = typeof pulse === 'object' && typeof pulse.from === 'number' ? pulse.from : 0.1;
    const to = typeof pulse === 'object' && typeof pulse.to === 'number' ? pulse.to : 0.6;
    const speed = typeof pulse === 'object' && typeof pulse.speed === 'number' ? pulse.speed : 2.0;
    const targets = [];
    group.traverse((o) => {
      if (o.isMesh && o.material && 'emissiveIntensity' in o.material) {
        if (o.material.emissive && o.material.emissive.getHex() !== 0x000000) {
          targets.push(o.material);
        }
      }
    });
    if (targets.length) {
      targets.forEach((mat, idx) => {
        gsap.to(mat, {
          emissiveIntensity: to,
          duration: 0.8 / speed,
          yoyo: true,
          repeat: -1,
          ease: 'sine.inOut',
          delay: (idx % 5) * 0.1
        });
        // Ensure starting value
        mat.emissiveIntensity = from;
      });
    }
  }
}

// Helpers
function mulberry32(a) {
  return function() {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickColor(palette, rng) {
  if (!palette || palette.length === 0) return new THREE.Color().setHSL(rng(), 0.6, 0.6);
  const c = palette[Math.floor(rng() * palette.length)];
  return new THREE.Color(c);
}

function toColor(value) {
  if (value == null) return null;
  try {
    return new THREE.Color(value);
  } catch {
    return null;
  }
}

function applyVec3(target, arr = [0,0,0]) {
  target.set(arr[0] || 0, arr[1] || 0, arr[2] || 0);
}
function applyEuler(target, arr = [0,0,0]) {
  target.set(arr[0] || 0, arr[1] || 0, arr[2] || 0);
}
function applyScale(target, arr = [1,1,1]) {
  target.set(arr[0] || 1, arr[1] || 1, arr[2] || 1);
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }