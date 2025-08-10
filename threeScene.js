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

    // Objects
    const group = new THREE.Group();
    const rng = mulberry32(plan.seed || 1234);

    for (const obj of (plan.objects || [])) {
      const count = Math.min(100, Math.max(1, obj.count || 8));
      for (let i = 0; i < count; i++) {
        let mesh;
        const mat = new THREE.MeshStandardMaterial({
          color: obj.color || pickColor(plan.palette, rng),
          metalness: obj.metalness ?? 0.1,
          roughness: obj.roughness ?? 0.8,
          emissive: obj.emissive || 0x000000,
          emissiveIntensity: obj.emissive ? (obj.emissiveIntensity ?? 0.3) : 0,
        });

        const s = (obj.size || 1) * (0.5 + rng());
        switch ((obj.shape || 'sphere').toLowerCase()) {
          case 'box':
            mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
            break;
          case 'torus':
            mesh = new THREE.Mesh(new THREE.TorusGeometry(s * 0.7, s * 0.25, 16, 64), mat);
            break;
          case 'cone':
            mesh = new THREE.Mesh(new THREE.ConeGeometry(s * 0.7, s * 1.4, 24), mat);
            break;
          case 'cylinder':
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.6, s * 0.6, s * 1.2, 24), mat);
            break;
          default:
            mesh = new THREE.Mesh(new THREE.SphereGeometry(s * 0.7, 32, 32), mat);
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

