// objective.js — EMBERLINE "Spark" bomb plant / defuse.
// Plant 3.5 s, defuse 5 s, detonate 35 s after plant. Visual: small dark
// bomb box with a blinking red light on the site ground; site rings pulse
// while a plant is possible. Written fresh in the build session (2026-11-17).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;
const DETONATE_TIME = 35;

export function createObjective(scene, world) {
  const state = {
    planted: false,
    site: null,
    plantProgress: 0,
    defuseProgress: 0,
    detonateIn: 0,
    carrier: null,
  };

  let plantSite = null;
  let defuseBy = null;
  let beepAcc = 0;

  // ---- bomb mesh: dark box + blinking red light ----
  const bombMesh = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.3),
    new THREE.MeshStandardMaterial({
      color: PALETTE.metal, roughness: 0.55, metalness: 0.6,
    }),
  );
  body.position.y = 0.11;
  const lightMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 8),
    new THREE.MeshBasicMaterial({ color: PALETTE.furnace }),
  );
  lightMesh.position.set(0.12, 0.27, 0);
  const blink = new THREE.PointLight(PALETTE.furnace, 0, 6);
  blink.position.y = 0.45;
  bombMesh.add(body);
  bombMesh.add(lightMesh);
  bombMesh.add(blink);
  bombMesh.visible = false;
  scene.add(bombMesh);

  // ---- site rings (pulse while a plant is possible) ----
  const rings = {};
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.3, s.r, 48),
      new THREE.MeshBasicMaterial({
        color: PALETTE.accent, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.05, s.z);
    scene.add(ring);
    rings[key] = ring;
  }

  const api = {
    state,
    bombMesh,
    onEvent: () => {},
    startPlant,
    cancelPlant,
    startDefuse,
    cancelDefuse,
    step,
    reset,
  };

  function startPlant(by, site) {
    if (state.planted) return;
    // Same actor continuing the same plant: keep progress (main.js calls
    // this every frame while a plant is in progress).
    if (state.carrier === by && plantSite === site) return;
    state.carrier = by || null;
    plantSite = site || null;
    state.plantProgress = 0;
  }

  function cancelPlant() {
    state.plantProgress = 0;
    state.carrier = null;
    plantSite = null;
  }

  function startDefuse(by) {
    if (defuseBy === by) return;
    defuseBy = by || null;
  }

  function cancelDefuse() {
    state.defuseProgress = 0;
    defuseBy = null;
  }

  // ctx = { planting:boolean, defusing:boolean, time }
  // main.js calls startPlant/startDefuse when a bot (or the player)
  // begins, and drives ctx.planting / ctx.defusing each frame.
  function step(dt, ctx) {
    const time = ctx.time || 0;

    // Ring pulse: bright amber while plantable, dim once planted.
    const pulse = 0.35 + 0.25 * Math.sin(time * 2.4);
    for (const key of ['A', 'B']) {
      const ring = rings[key];
      if (state.planted && state.site === key) {
        ring.material.color.set(PALETTE.furnace);
        ring.material.opacity = 0.55 + 0.3 * Math.sin(time * 6);
      } else {
        ring.material.color.set(PALETTE.accent);
        ring.material.opacity = state.planted ? 0.12 : pulse;
      }
    }

    if (!state.planted) {
      if (ctx.planting && plantSite) {
        state.plantProgress += dt / PLANT_TIME;
        if (state.plantProgress >= 1) {
          state.plantProgress = 1;
          state.planted = true;
          state.site = plantSite;
          state.detonateIn = DETONATE_TIME;
          state.defuseProgress = 0;
          const s = world.sites[plantSite];
          bombMesh.position.set(s.x, 0, s.z);
          bombMesh.visible = true;
          beepAcc = 0;
          api.onEvent({ type: 'planted', site: plantSite });
        }
      } else if (state.plantProgress > 0) {
        // Interrupted plant loses progress.
        state.plantProgress = Math.max(0, state.plantProgress - dt * 0.5);
      }
      return;
    }

    // Bomb is planted: countdown + beeps + blinking light.
    state.detonateIn -= dt;
    const urgent = state.detonateIn < 10;
    const interval = urgent ? 0.45 : 1.0;
    beepAcc += dt;
    if (beepAcc >= interval) {
      beepAcc = 0;
      api.onEvent({ type: 'beep', urgent });
    }
    const on = Math.sin(time * 10) > 0;
    blink.intensity = on ? 2.5 : 0.15;
    lightMesh.visible = on;

    if (ctx.defusing) {
      state.defuseProgress += dt / DEFUSE_TIME;
      if (state.defuseProgress >= 1) {
        state.planted = false;
        state.defuseProgress = 0;
        state.detonateIn = 0;
        bombMesh.visible = false;
        api.onEvent({ type: 'defused' });
        return;
      }
    } else if (state.defuseProgress > 0) {
      state.defuseProgress = Math.max(0, state.defuseProgress - dt * 0.4);
    }

    if (state.detonateIn <= 0) {
      state.planted = false;
      state.detonateIn = 0;
      state.defuseProgress = 0;
      bombMesh.visible = false;
      api.onEvent({ type: 'detonated' });
    }
  }

  function reset() {
    state.planted = false;
    state.site = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.detonateIn = 0;
    state.carrier = null;
    plantSite = null;
    defuseBy = null;
    beepAcc = 0;
    bombMesh.visible = false;
  }

  return api;
}
