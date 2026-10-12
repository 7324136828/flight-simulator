import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { createAircraft } from './aircraft.js';
import { createScenery } from './scenery.js';
import { snapShadowTarget } from './render-stability.js';

function isSoftwareRenderer(context) {
  try {
    const info = context.getExtension('WEBGL_debug_renderer_info');
    if (!info) return false;
    const name = context.getParameter(info.UNMASKED_RENDERER_WEBGL);
    return /swiftshader|llvmpipe|softpipe|software|microsoft basic render|\bwarp\b/i.test(name);
  } catch {
    return false;
  }
}

export function createWorld(canvas, map, selected) {
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true,
  });
  const compact = window.innerWidth < 800;
  const softwareRendering = isSoftwareRenderer(renderer.getContext());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, softwareRendering ? 1 : compact ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = !softwareRendering;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ec6dd);
  scene.fog = new THREE.FogExp2(0xabc9c4, 0.00013);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 100000);

  const ambient = new THREE.HemisphereLight(0xc8e6fa, 0x73865d, 1.7);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffedd0, 2.2);
  sun.position.set(-1400, 1700, 1100);
  sun.castShadow = !softwareRendering;
  sun.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048);
  sun.shadow.camera.left = -1000;
  sun.shadow.camera.right = 1000;
  sun.shadow.camera.top = 1000;
  sun.shadow.camera.bottom = -1000;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 9000;
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  const sky = new Sky();
  sky.scale.setScalar(20000);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 5;
  uniforms.rayleigh.value = 2;
  uniforms.mieCoefficient.value = 0.004;
  uniforms.mieDirectionalG.value = 0.82;
  uniforms.cloudCoverage.value = 0.33;
  uniforms.cloudDensity.value = 0.32;
  uniforms.cloudElevation.value = 0.45;
  sky.renderOrder = -1000;
  scene.add(sky);

  let scenery;
  function setScenery(map, selected) {
    const next = createScenery(map, selected);
    if (scenery) { scene.remove(scenery.group); scenery.destroy(); }
    scenery = next;
    scene.add(scenery.group);
  }
  setScenery(map, selected);
  const aircraft = createAircraft();
  const model = aircraft.model;
  scene.add(model);

  const sunDirection = new THREE.Vector3();
  // Three r186's GGX environment filtering is costly on software GPUs.
  // Keep the sky and direct lights there without baking reflection lighting.
  const pmrem = softwareRendering ? null : new THREE.PMREMGenerator(renderer);
  const environments = new Map();
  const backgrounds = new Map();
  function setLighting(preset = 'day') {
    const sunset = preset === 'sunset';
    sunDirection.set(-0.75, sunset ? 0.12 : 0.65, 0.4).normalize();
    uniforms.sunPosition.value.copy(sunDirection).multiplyScalar(450000);
    uniforms.rayleigh.value = sunset ? 2.8 : 2;
    uniforms.turbidity.value = sunset ? 8 : 5;
    sun.color.set(sunset ? 0xffc08b : 0xfff0d5);
    sun.intensity = sunset ? 2.1 : 2.0;
    ambient.color.set(sunset ? 0xb0bce4 : 0xc8e6fa);
    ambient.intensity = sunset ? 0.8 : 0.9;
    scene.fog.color.set(sunset ? 0xbaae9c : 0xb9d0ce);
    scene.fog.density = sunset ? 0.00010 : 0.00008;
    renderer.toneMappingExposure = sunset ? 0.60 : 0.65;
    if (!backgrounds.has(preset)) {
      const environmentScene = new THREE.Scene();
      environmentScene.add(sky.clone());
      // Bake the atmospheric shader once per lighting preset. A simple skybox
      // keeps the full-screen cloud shader out of every gameplay frame.
      const background = new THREE.WebGLCubeRenderTarget(softwareRendering ? 128 : compact ? 256 : 512, {
        type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
      });
      const capture = new THREE.CubeCamera(1, 30000, background);
      capture.update(renderer, environmentScene);
      backgrounds.set(preset, background);
      if (pmrem) {
        uniforms.showSunDisc.value = false;
        const environment = pmrem.fromScene(environmentScene, 0.04, 1, 30000);
        uniforms.showSunDisc.value = true;
        environments.set(preset, environment);
      }
    }
    scene.background = backgrounds.get(preset).texture;
    scene.environment = environments.get(preset)?.texture ?? null;
    scene.environmentIntensity = sunset ? 0.45 : 0.65;
  }
  setLighting();
  scene.remove(sky);

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  const forward = new THREE.Vector3(), right = new THREE.Vector3(), levelUp = new THREE.Vector3();
  const bankedUp = new THREE.Vector3(), eye = new THREE.Vector3(), target = new THREE.Vector3();
  function update(state, { view = 'cockpit', time = 0, elapsed = 0, intro = false } = {}) {
    const heading = state.heading;
    const pitch = state.pitch;
    const roll = state.roll;
    // Mirror flight-model east into Three.js -x so north (+z) looks correct:
    // a right turn must turn toward screen-right, not screen-left.
    forward.set(-Math.sin(heading) * Math.cos(pitch),
      Math.sin(pitch), Math.cos(heading) * Math.cos(pitch));
    right.set(-Math.cos(heading), 0, -Math.sin(heading));
    levelUp.crossVectors(right, forward).normalize();
    bankedUp.copy(levelUp).multiplyScalar(Math.cos(roll))
      .addScaledVector(right, Math.sin(roll)).normalize();
    eye.set(-state.x, state.altitude + 2.8, state.z);

    model.position.set(-state.x, state.altitude + 2.05, state.z);
    model.rotation.order = 'YXZ';
    model.rotation.set(-pitch, -heading, roll);
    model.visible = intro || view !== 'cockpit';
    aircraft.update(state, time, elapsed);
    uniforms.time.value = time;

    if (intro) {
      camera.position.copy(eye).addScaledVector(forward, -25).addScaledVector(right, -17).addScaledVector(levelUp, 7);
      camera.up.set(0, 1, 0);
      camera.lookAt(target.copy(eye).addScaledVector(forward, 20).addScaledVector(right, -8));
    } else if (view === 'cockpit') {
      camera.position.copy(eye);
      camera.up.copy(bankedUp);
      camera.lookAt(target.copy(eye).addScaledVector(forward, 200));
    } else {
      camera.position.copy(eye).addScaledVector(forward, -27).addScaledVector(bankedUp, 8);
      camera.up.set(0, 1, 0);
      camera.lookAt(target.copy(eye).addScaledVector(forward, 30));
    }
    sky.position.copy(camera.position);
    sun.target.position.set(-state.x, 0, state.z);
    snapShadowTarget(sun.target.position, sunDirection,
      (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x,
      (sun.shadow.camera.top - sun.shadow.camera.bottom) / sun.shadow.mapSize.y);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, 4500);
    sun.target.updateMatrixWorld();
    renderer.render(scene, camera);
  }

  resize();
  return { renderer, scene, camera, resize, update, setLighting, setScenery,
    destroy() {
      scene.traverse((item) => {
        if (item.geometry) item.geometry.dispose();
        if (item.material) {
          const materials = Array.isArray(item.material) ? item.material : [item.material];
          for (const mat of materials) { mat.map?.dispose(); mat.dispose(); }
        }
      });
      environments.forEach(environment => environment.dispose());
      backgrounds.forEach(background => background.dispose());
      sky.geometry.dispose();
      sky.material.dispose();
      pmrem?.dispose();
      // Render targets need the renderer's WebGL properties during disposal.
      renderer.dispose();
    } };
}
