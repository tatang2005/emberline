// EMBERLINE weapons — five buyable guns, each with its own box-built view model on
// the camera, its own magazine + reserve, and its own recoil, spread and reload.
// Main owns the ray and the damage; this module owns the numbers and the feel.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  P9: {
    id: 'P9', name: 'P9 Sidearm', price: 0, mag: 12, reserve: 36,
    damage: 26, headMult: 4, fireGap: 0.14, reloadTime: 1.4,
    spreadStill: 0.003, spreadMove: 0.02, auto: false, pellets: 1,
    falloff: { start: 15, end: 45, min: 0.6 }, kick: 0.02, tracer: PALETTE.accent,
  },
  VK47: {
    id: 'VK47', name: 'VK-47 Carbine', price: 800, mag: 30, reserve: 90,
    damage: 30, headMult: 4, fireGap: 0.096, reloadTime: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, auto: true, pellets: 1,
    falloff: { start: 20, end: 60, min: 0.7 }, kick: 0.035, tracer: PALETTE.accent,
  },
  RAPTOR: {
    id: 'RAPTOR', name: 'Raptor-9 SMG', price: 1200, mag: 32, reserve: 96,
    damage: 22, headMult: 4, fireGap: 0.07, reloadTime: 1.7,
    spreadStill: 0.004, spreadMove: 0.038, auto: true, pellets: 1,
    falloff: { start: 10, end: 35, min: 0.45 }, kick: 0.022, tracer: PALETTE.ember,
  },
  LONGSHOT: {
    id: 'LONGSHOT', name: 'Longshot Sniper', price: 2500, mag: 5, reserve: 15,
    damage: 110, headMult: 4, fireGap: 1.1, reloadTime: 2.6,
    spreadStill: 0.0008, spreadMove: 0.05, auto: false, pellets: 1,
    falloff: { start: 30, end: 120, min: 0.9 }, kick: 0.09, tracer: PALETTE.slate,
  },
  BREACHER: {
    id: 'BREACHER', name: 'Breacher Shotgun', price: 900, mag: 6, reserve: 24,
    damage: 12, headMult: 4, fireGap: 0.85, reloadTime: 2.4,
    spreadStill: 0.012, spreadMove: 0.03, auto: false, pellets: 8,
    falloff: { start: 6, end: 20, min: 0.3 }, kick: 0.07, tracer: PALETTE.hazard,
  },
};

const MUZZLE_TIME = 0.06;
const MOVE_REFERENCE = 5.4;
const MODEL_POS = { x: 0.24, y: -0.2, z: -0.42 };
const _muzzleWorld = new THREE.Vector3();

function box(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

export function createWeapons(camera) {
  const gunMetal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.metal), roughness: 0.45, metalness: 0.6 });
  const gunDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.25 });
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.crate), roughness: 0.8, metalness: 0.1 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const scopeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.slateDark), roughness: 0.35, metalness: 0.7 });

  // Each model is built from boxes around a muzzle anchor at the barrel tip, so the
  // flash and the tracer start exactly where the barrel ends.
  function buildP9() {
    const g = new THREE.Group();
    g.add(box(0.05, 0.07, 0.2, gunMetal, 0, 0.02, -0.05));
    g.add(box(0.04, 0.04, 0.12, gunDark, 0, 0.03, -0.2));
    const grip = box(0.045, 0.14, 0.06, gripMat, 0, -0.06, 0.04);
    grip.rotation.x = 0.3;
    g.add(grip);
    g.add(box(0.012, 0.02, 0.012, accentMat, 0, 0.065, -0.24));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.03, -0.27);
    g.add(muzzle);
    return { group: g, muzzle };
  }

  function buildVK47() {
    const g = new THREE.Group();
    g.add(box(0.09, 0.1, 0.42, gunMetal, 0, 0, 0));
    g.add(box(0.045, 0.045, 0.42, gunDark, 0, 0.025, -0.4));
    g.add(box(0.075, 0.08, 0.24, gripMat, 0, -0.02, 0.3));
    const mag = box(0.05, 0.16, 0.08, gunDark, 0, -0.11, -0.05);
    mag.rotation.x = 0.25;
    g.add(mag);
    g.add(box(0.02, 0.06, 0.02, accentMat, 0, 0.08, -0.55));
    g.add(box(0.06, 0.03, 0.1, gunDark, 0, 0.06, 0.05));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.025, -0.63);
    g.add(muzzle);
    return { group: g, muzzle };
  }

  function buildRaptor() {
    const g = new THREE.Group();
    g.add(box(0.08, 0.09, 0.3, gunMetal, 0, 0, 0));
    g.add(box(0.05, 0.05, 0.18, gunDark, 0, 0.02, -0.22));
    g.add(box(0.055, 0.055, 0.16, scopeMat, 0, 0.01, -0.3));
    const grip = box(0.04, 0.11, 0.05, gripMat, 0, -0.09, -0.14);
    grip.rotation.x = 0.15;
    g.add(grip);
    g.add(box(0.05, 0.18, 0.06, gunDark, 0, -0.12, 0.02));
    g.add(box(0.07, 0.07, 0.16, gripMat, 0, -0.015, 0.22));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, -0.4);
    g.add(muzzle);
    return { group: g, muzzle };
  }

  function buildLongshot() {
    const g = new THREE.Group();
    g.add(box(0.07, 0.08, 0.5, gunMetal, 0, 0, -0.05));
    g.add(box(0.03, 0.03, 0.55, gunDark, 0, 0.02, -0.55));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 12), scopeMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, -0.05);
    g.add(scope);
    g.add(box(0.03, 0.05, 0.03, gunDark, 0, 0.045, -0.05));
    g.add(box(0.06, 0.09, 0.3, gripMat, 0, -0.01, 0.32));
    g.add(box(0.05, 0.07, 0.06, gunDark, 0, -0.07, 0.02));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.02, -0.85);
    g.add(muzzle);
    return { group: g, muzzle };
  }

  function buildBreacher() {
    const g = new THREE.Group();
    g.add(box(0.1, 0.09, 0.46, gunMetal, 0, 0.01, -0.02));
    g.add(box(0.07, 0.06, 0.4, gunDark, 0, -0.045, -0.1));
    g.add(box(0.075, 0.05, 0.18, gripMat, 0, -0.045, -0.28));
    g.add(box(0.08, 0.09, 0.22, gripMat, 0, -0.02, 0.32));
    g.add(box(0.05, 0.03, 0.06, accentMat, 0, 0.065, -0.2));
    const muzzle = new THREE.Object3D();
    muzzle.position.set(0, 0.01, -0.48);
    g.add(muzzle);
    return { group: g, muzzle };
  }

  const builders = { P9: buildP9, VK47: buildVK47, RAPTOR: buildRaptor, LONGSHOT: buildLongshot, BREACHER: buildBreacher };
  const models = {};
  for (const id of Object.keys(builders)) {
    const built = builders[id]();
    built.group.position.set(MODEL_POS.x, MODEL_POS.y, MODEL_POS.z);
    built.group.visible = false;
    camera.add(built.group);
    models[id] = built;
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.17, 0.17),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  camera.add(flashLight);

  const state = {
    current: 'P9',
    slots: { P9: { mag: WEAPONS.P9.mag, reserve: WEAPONS.P9.reserve } },
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };
  models.P9.group.visible = true;

  function currentDef() {
    return WEAPONS[state.current];
  }

  function equip(id) {
    if (!WEAPONS[id] || !state.slots[id] || state.current === id) return false;
    models[state.current].group.visible = false;
    state.current = id;
    models[id].group.visible = true;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    return true;
  }

  function give(id) {
    if (!WEAPONS[id]) return false;
    state.slots[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    equip(id);
    return true;
  }

  function step(dt) {
    const def = currentDef();
    const model = models[state.current].group;
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);

    let dip = 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const progress = 1 - state.reloadLeft / def.reloadTime;
      dip = Math.sin(Math.min(1, progress) * Math.PI);
      if (state.reloadLeft === 0) {
        const slot = state.slots[state.current];
        const need = def.mag - slot.mag;
        const take = Math.min(need, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }

    model.position.z = MODEL_POS.z + state.kick;
    model.position.y = MODEL_POS.y - dip * 0.09;
    model.rotation.x = state.kick * 2.2 - dip * 0.55;

    const muzzle = models[state.current].muzzle;
    flash.position.set(
      MODEL_POS.x + muzzle.position.x,
      MODEL_POS.y + muzzle.position.y,
      MODEL_POS.z + muzzle.position.z,
    );
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.rotation.z = state.flash * 30;
    flashLight.position.set(flash.position.x, flash.position.y, flash.position.z + 0.3);
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    defs: WEAPONS,
    state,
    equip,
    give,
    step,
    ready() {
      const slot = state.slots[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      const slot = state.slots[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    pullTrigger() {
      state.cooldown = currentDef().fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = currentDef().kick;
    },
    reload() {
      const def = currentDef();
      const slot = state.slots[state.current];
      if (state.reloadLeft > 0 || slot.mag === def.mag || slot.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      const def = currentDef();
      return def.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * def.spreadMove;
    },
    currentDef,
    refillAll() {
      for (const id of Object.keys(state.slots)) {
        state.slots[id].mag = WEAPONS[id].mag;
        state.slots[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    muzzleWorldPos(out) {
      models[state.current].muzzle.getWorldPosition(out || _muzzleWorld);
      return out || _muzzleWorld;
    },
  };
}
