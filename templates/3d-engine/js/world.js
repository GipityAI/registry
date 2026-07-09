/**
 * 3D World - World Module
 * Standardized Three.js scene setup.
 *
 * Exports: scene, camera, renderer, clock
 * All games share the same lighting, fog, sky, and tone mapping.
 */
import * as THREE from 'three';

// --- Renderer ---
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// --- Scene ---
const scene = new THREE.Scene();
const SKY_COLOR = 0x87CEEB;
const GROUND_COLOR = 0x8B7355;
scene.background = new THREE.Color(SKY_COLOR);
scene.fog = new THREE.Fog(SKY_COLOR, 40, 120);

// --- Lighting ---
// Directional sun
const sunLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
sunLight.position.set(30, 50, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 150;
sunLight.shadow.camera.left = -80;
sunLight.shadow.camera.right = 80;
sunLight.shadow.camera.top = 80;
sunLight.shadow.camera.bottom = -80;
sunLight.shadow.bias = 0;
sunLight.shadow.normalBias = 0;
scene.add(sunLight);

// Hemisphere light (sky + ground bounce). Fill is deliberately generous:
// with only the directional sun, every face pointing away from it renders
// near-black (the classic "my blocks are black against a bright sky" trap).
// These defaults keep unlit faces readable; tune via world.lighting.
const hemiLight = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 0.85);
scene.add(hemiLight);

// Ambient fill
const ambientLight = new THREE.AmbientLight(0x404060, 0.55);
scene.add(ambientLight);

// --- Camera ---
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 8, 12);
camera.lookAt(0, 0, 0);

// --- Timer ---
const clock = new THREE.Timer();
clock.connect(document);

// --- Resize ---
window.addEventListener('resize', () => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

// --- Standardized Lighting (v13+) ---
// Reactive lighting object - changing properties updates the Three.js lights in real-time.
// Accessible via world.lighting from game code.

const _lightingState = {
  sunIntensity: 2.0,
  sunColor: 0xfff5e6,
  ambientIntensity: 0.55,
  hemisphereIntensity: 0.85,
  skyColor: SKY_COLOR,
  groundColor: GROUND_COLOR,
  fogEnabled: true,
  fogNear: 40,
  fogFar: 120,
  timeOfDay: 12, // 0-24 hours
};

/** Compute sun direction from time of day (0-24).
 *  0/24 = midnight (below horizon), 6 = sunrise (east), 12 = noon (overhead), 18 = sunset (west) */
function updateSunFromTime(hour) {
  const angle = ((hour - 6) / 12) * Math.PI; // 0 at 6am, PI at 6pm
  const y = Math.sin(angle);
  const xz = Math.cos(angle);
  sunLight.position.set(xz * 30, Math.max(y * 50, 2), 20);

  // Adjust sun color: warm at sunrise/sunset, white at noon
  const warmth = 1 - Math.abs(hour - 12) / 6; // 0 at 6am/6pm, 1 at noon
  const r = 1;
  const g = 0.85 + warmth * 0.15;
  const b = 0.7 + warmth * 0.3;
  sunLight.color.setRGB(r, g, b);

  // Adjust sky color: dark at night, blue during day
  const dayFactor = Math.max(0, Math.min(1, y + 0.3));
  const skyR = 0.53 * dayFactor;
  const skyG = 0.81 * dayFactor;
  const skyB = 0.92 * dayFactor;
  const skyHex = new THREE.Color(skyR, skyG, skyB);
  scene.background = skyHex;
  if (scene.fog) scene.fog.color.copy(skyHex);
  hemiLight.color.copy(skyHex);
}

const lighting = new Proxy(_lightingState, {
  set(target, prop, value) {
    target[prop] = value;
    switch (prop) {
      case 'sunIntensity':
        sunLight.intensity = value;
        break;
      case 'sunColor':
        sunLight.color.set(value);
        break;
      case 'ambientIntensity':
        ambientLight.intensity = value;
        break;
      case 'hemisphereIntensity':
        hemiLight.intensity = value;
        break;
      case 'skyColor':
        scene.background = new THREE.Color(value);
        hemiLight.color.set(value);
        if (scene.fog) scene.fog.color.set(value);
        break;
      case 'groundColor':
        hemiLight.groundColor.set(value);
        break;
      case 'fogEnabled':
        if (value) {
          scene.fog = new THREE.Fog(
            scene.background || SKY_COLOR,
            target.fogNear,
            target.fogFar,
          );
        } else {
          scene.fog = null;
        }
        break;
      case 'fogNear':
        if (scene.fog) scene.fog.near = value;
        break;
      case 'fogFar':
        if (scene.fog) scene.fog.far = value;
        break;
      case 'timeOfDay':
        updateSunFromTime(value);
        break;
    }
    return true;
  },
});

export { scene, camera, renderer, clock, THREE, lighting };
