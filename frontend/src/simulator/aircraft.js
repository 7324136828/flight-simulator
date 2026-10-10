import * as THREE from 'three';

const PI = Math.PI;
const surface = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.22, ...extra });

export function createAircraft() {
  const model = new THREE.Group();
  const paint = surface(0xf2f0e7);
  const accent = surface(0x245c65);
  const orange = surface(0xe97d4b);
  const metal = surface(0xaebec3, { metalness: 0.8, roughness: 0.25 });
  const rubber = surface(0x17232a, { metalness: 0.05, roughness: 0.87 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x255465, roughness: 0.08, metalness: 0.28, clearcoat: 1 });
  function add(geometry, material, position = [0, 0, 0], parent = model) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const profile = [[0.07, -5.2], [0.25, -4.6], [0.45, -3], [0.78, -1.5], [0.94, 0.2], [0.83, 2.4], [0.72, 3.5], [0.42, 4.25], [0.08, 4.6]];
  const hull = add(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 40), paint);
  hull.rotation.x = PI / 2;
  const cowling = add(new THREE.SphereGeometry(0.77, 32, 20), orange, [0, 0, 3.4]);
  cowling.scale.set(1, 1, 0.8);
  const canopy = add(new THREE.SphereGeometry(1, 40, 24), glass, [0, 0.69, 0.8]);
  canopy.scale.set(0.78, 0.65, 1.65);
  const spine = add(new THREE.CapsuleGeometry(0.055, 2.8, 4, 8), paint, [0, 1.31, 0.65]);
  spine.rotation.x = PI / 2;

  function wing(span, chord, y, z, material = paint) {
    const shape = new THREE.Shape();
    shape.moveTo(-span / 2 + 0.25, -chord / 2);
    shape.lineTo(span / 2 - 0.25, -chord / 2);
    shape.quadraticCurveTo(span / 2 + 0.1, -chord / 2, span / 2, 0);
    shape.lineTo(span / 2 - 0.28, chord / 2);
    shape.lineTo(-span / 2 + 0.28, chord / 2);
    shape.quadraticCurveTo(-span / 2 - 0.1, chord / 2, -span / 2, 0);
    shape.closePath();
    const mesh = add(new THREE.ExtrudeGeometry(shape, { depth: 0.10, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.07, bevelThickness: 0.035, curveSegments: 10 }), material, [0, y, z]);
    mesh.rotation.x = -PI / 2;
    return mesh;
  }
  wing(13.5, 1.95, 0.45, 0.4);
  wing(4.4, 1.15, 0.35, -4.1);
  for (const x of [-6.3, 6.3]) {
    const tip = add(new THREE.CapsuleGeometry(0.23, 1.3, 6, 12), accent, [x, 0.47, 0.4]);
    tip.rotation.x = PI / 2;
    tip.scale.y = 1.1;
    add(new THREE.SphereGeometry(0.10, 12, 8), new THREE.MeshBasicMaterial({ color: x < 0 ? 0xff5145 : 0x77f4b8 }), [x, 0.65, 0.52]);
  }
  const finShape = new THREE.Shape();
  finShape.moveTo(-1.0, 0);
  finShape.lineTo(-0.65, 1.95);
  finShape.quadraticCurveTo(-0.45, 2.15, -0.17, 1.9);
  finShape.lineTo(0.95, 0);
  finShape.closePath();
  const fin = add(new THREE.ExtrudeGeometry(finShape, { depth: 0.10, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3 }), accent, [0, 0.5, -4.2]);
  fin.rotation.y = -PI / 2;

  const flaps = [];
  for (const x of [-3.4, 3.4]) {
    const flap = new THREE.Group();
    flap.position.set(x, 0.42, -0.58);
    add(new THREE.BoxGeometry(3.6, 0.10, 0.46), accent, [0, 0, -0.20], flap);
    model.add(flap);
    flaps.push(flap);
  }

  const gear = new THREE.Group();
  const wheels = [];
  for (const [x, z] of [[-1.9, -0.5], [1.9, -0.5], [0, 2.55]]) {
    const strut = add(new THREE.CylinderGeometry(0.07, 0.085, 1.05, 12), metal, [x, -1.05, z], gear);
    if (x) strut.rotation.z = -Math.sign(x) * 0.28;
    const wheel = add(new THREE.TorusGeometry(0.28, 0.12, 12, 24), rubber, [x, -1.60, z], gear);
    wheel.rotation.y = PI / 2;
    const hub = add(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 16), metal, [x, -1.60, z], gear);
    hub.rotation.z = PI / 2;
    wheels.push(wheel);
  }
  model.add(gear);

  const propeller = new THREE.Group();
  propeller.position.z = 4.45;
  const spinner = add(new THREE.SphereGeometry(0.3, 24, 16), metal, [0, 0, 0], propeller);
  spinner.scale.z = 1.7;
  for (const y of [-0.79, 0.79]) {
    const blade = add(new THREE.CapsuleGeometry(0.12, 1.35, 6, 12), rubber, [0, y, 0], propeller);
    blade.scale.z = 0.33;
    blade.rotation.z = 0.12;
  }
  const disc = add(new THREE.CircleGeometry(1.7, 48), new THREE.MeshBasicMaterial({ color: 0xbbc8c6, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }), [0, 0, 0], propeller);
  model.add(propeller);

  let gearExtension = 1;
  let flapAngle = 0;
  return {
    model,
    update(state, time, elapsed) {
      const blend = 1 - Math.exp(-elapsed * 5);
      gearExtension += ((state.gear ? 1 : 0) - gearExtension) * blend;
      flapAngle += ((state.flaps ? -0.35 : 0) - flapAngle) * blend;
      gear.scale.y = Math.max(0.02, gearExtension);
      gear.visible = gearExtension > 0.025;
      flaps.forEach(flap => { flap.rotation.x = flapAngle; });
      propeller.rotation.z = time * (16 + state.throttle * 95);
      disc.visible = state.throttle > 0.1;
      wheels.forEach(wheel => { wheel.rotation.x = time * state.speed / 0.4; });
    },
  };
}
