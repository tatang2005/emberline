// effects.js — pooled tracers, impact particles, explosions, smoke puffs.
// Everything is pre-allocated: 24 tracers, 64 particles, one explosion shell
// + light, 8 smoke sprites. step(dt) advances and recycles them; no
// allocations happen in the hot loop (module-scope temp vectors only).
// Colours come from palette.js only.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const PARTICLE_COUNT = 64;
const SMOKE_COUNT = 8;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _white = new THREE.Color(0xffffff);

const _hexCache = {};
function hex(color) {
  if (typeof color === 'number') return color;
  if (_hexCache[color] === undefined) _hexCache[color] = new THREE.Color(color).getHex();
  return _hexCache[color];
}

export function createEffects(scene) {
  const group = new THREE.Group();
  group.name = 'effects';
  scene.add(group);

  // --- pooled tracers: thin additive boxes, stretched between two points ---
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracerMat = new THREE.MeshBasicMaterial({
    color: hex(PALETTE.ember),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i++) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    tracers.push({ mesh, ttl: 0, life: 0 });
  }
  let tracerCursor = 0;

  // --- pooled particles: small boxes, shared geometry, per-colour materials --
  const particleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
  const particleMats = {};
  function particleMat(color) {
    const key = hex(color);
    if (!particleMats[key]) {
      particleMats[key] = new THREE.MeshBasicMaterial({
        color: key,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }
    return particleMats[key];
  }
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const mesh = new THREE.Mesh(particleGeo, particleMat(PALETTE.ember));
    mesh.visible = false;
    mesh.renderOrder = 5;
    group.add(mesh);
    particles.push({
      mesh,
      vel: new THREE.Vector3(),
      ttl: 0,
      life: 0,
      spin: 0,
      grav: 0,
    });
  }
  let particleCursor = 0;

  // --- explosion: expanding shell + point light + particle burst ------------
  const explosionShell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({
      color: hex(PALETTE.furnace),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  explosionShell.visible = false;
  explosionShell.renderOrder = 6;
  group.add(explosionShell);
  const explosionLight = new THREE.PointLight(hex(PALETTE.furnace), 0, 26, 1.6);
  explosionLight.visible = false;
  group.add(explosionLight);
  let explosionTtl = 0;
  let explosionLife = 0;

  // --- pooled smoke sprites: soft grey billboards that grow and fade -------
  const smokeTex = makeSmokeTexture();
  const smokeMat = new THREE.SpriteMaterial({
    map: smokeTex,
    color: hex(PALETTE.smoke),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const smokes = [];
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const sprite = new THREE.Sprite(smokeMat.clone());
    sprite.visible = false;
    sprite.renderOrder = 4;
    group.add(sprite);
    smokes.push({ sprite, ttl: 0, life: 0, maxScale: 1 });
  }
  let smokeCursor = 0;

  // Soft radial blob texture, computed into a DataTexture (no document access:
  // only hud.js touches the DOM, world.js owns canvas textures).
  function makeSmokeTexture() {
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - size / 2 + 0.5) / (size / 2);
        const dy = (y - size / 2 + 0.5) / (size / 2);
        const d = Math.sqrt(dx * dx + dy * dy);
        let a = 0;
        if (d < 1) {
          a = d < 0.55 ? 0.85 - d * 0.5 : 0.575 * (1 - (d - 0.55) / 0.45);
        }
        const i = (y * size + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  function spawnParticle(pos, vel, color, life, grav, scale) {
    const p = particles[particleCursor];
    particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
    p.mesh.position.copy(pos);
    p.mesh.material = particleMat(color);
    p.mesh.scale.setScalar(scale || 1);
    p.mesh.visible = true;
    p.vel.copy(vel);
    p.ttl = life;
    p.life = life;
    p.grav = grav || 0;
    p.spin = (Math.random() - 0.5) * 12;
  }

  // --- public API ---------------------------------------------------------

  const api = {
    // Camera shake amount (0..1). main reads it each frame and decays it
    // here in step().
    shake: 0,

    // A tracer line from muzzle to hit point. Reuses the next pooled tracer.
    // colour defaults to palette ember; callers may pass a weapon tracer colour.
    tracer(from, to, color) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
      _v1.subVectors(to, from);
      const len = Math.max(_v1.length(), 0.05);
      t.mesh.material.color.setHex(hex(color || PALETTE.ember));
      t.mesh.position.copy(from).addScaledVector(_v1, 0.5);
      t.mesh.scale.set(0.02, 0.02, len);
      _q.setFromUnitVectors(_v2.set(0, 0, 1), _v1.normalize());
      t.mesh.quaternion.copy(_q);
      t.mesh.visible = true;
      t.mesh.material.opacity = 0.85;
      t.ttl = 0.07;
      t.life = 0.07;
    },

    // Small burst of sparks/dust where a shot hits a surface.
    impact(point, normal, color) {
      const base = color || PALETTE.hazard;
      const n = normal || _up;
      for (let i = 0; i < 6; i++) {
        _v1.copy(n).multiplyScalar(1.5 + Math.random() * 2.5);
        _v1.x += (Math.random() - 0.5) * 3;
        _v1.y += (Math.random() - 0.5) * 3 + 1.2;
        _v1.z += (Math.random() - 0.5) * 3;
        _v2.copy(point);
        _v2.x += (Math.random() - 0.5) * 0.06;
        _v2.y += (Math.random() - 0.5) * 0.06;
        _v2.z += (Math.random() - 0.5) * 0.06;
        spawnParticle(_v2, _v1, base, 0.25 + Math.random() * 0.25, 9, 0.8 + Math.random() * 0.7);
      }
    },

    // Big explosion: shell + light + 26-particle burst + strong shake.
    explosion(point) {
      explosionShell.position.copy(point);
      explosionShell.scale.setScalar(0.4);
      explosionShell.material.opacity = 0.9;
      explosionShell.visible = true;
      explosionLight.position.copy(point);
      explosionLight.position.y += 0.6;
      explosionLight.intensity = 60;
      explosionLight.visible = true;
      explosionTtl = 0.7;
      explosionLife = 0.7;
      for (let i = 0; i < 26; i++) {
        _v1.set(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
        _v1.multiplyScalar(3 + Math.random() * 9);
        const col = i % 3 === 0 ? PALETTE.hazard : i % 3 === 1 ? PALETTE.furnace : PALETTE.ember;
        spawnParticle(point, _v1, col, 0.5 + Math.random() * 0.5, 12, 1.2 + Math.random() * 1.4);
      }
      api.shake = Math.min(1, api.shake + 0.9);
    },

    // A grey smoke puff that grows to ~2 m and fades over ~1.6 s.
    smokePuff(pos) {
      const s = smokes[smokeCursor];
      smokeCursor = (smokeCursor + 1) % SMOKE_COUNT;
      s.sprite.position.copy(pos);
      s.sprite.scale.setScalar(0.6);
      s.sprite.material.opacity = 0.55;
      s.sprite.visible = true;
      s.maxScale = 2.2;
      s.ttl = 1.6;
      s.life = 1.6;
    },

    // Tiny bright spark on a body hit (hitmarker feedback in-world).
    hitSpark(point) {
      for (let i = 0; i < 4; i++) {
        _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        _v1.multiplyScalar(1.5 + Math.random() * 2);
        spawnParticle(point, _v1, PALETTE.hazard, 0.16 + Math.random() * 0.12, 4, 1.1);
      }
    },

    // Advance all pooled effects. Call once per frame with the frame dt.
    step(dt) {
      const d = Math.min(dt, 0.05);
      for (let i = 0; i < TRACER_COUNT; i++) {
        const t = tracers[i];
        if (!t.mesh.visible) continue;
        t.ttl -= d;
        if (t.ttl <= 0) {
          t.mesh.visible = false;
        } else {
          t.mesh.material.opacity = 0.85 * (t.ttl / t.life);
        }
      }
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles[i];
        if (!p.mesh.visible) continue;
        p.ttl -= d;
        if (p.ttl <= 0) {
          p.mesh.visible = false;
          continue;
        }
        p.vel.y -= p.grav * d;
        p.mesh.position.addScaledVector(p.vel, d);
        p.mesh.rotation.x += p.spin * d;
        p.mesh.rotation.y += p.spin * 0.7 * d;
        p.mesh.material.opacity = p.ttl / p.life;
        if (p.mesh.position.y < 0.03) {
          p.mesh.position.y = 0.03;
          p.vel.y = Math.abs(p.vel.y) * 0.3;
          p.vel.x *= 0.7;
          p.vel.z *= 0.7;
        }
      }
      if (explosionShell.visible) {
        explosionTtl -= d;
        if (explosionTtl <= 0) {
          explosionShell.visible = false;
          explosionLight.visible = false;
        } else {
          const k = 1 - explosionTtl / explosionLife;
          explosionShell.scale.setScalar(0.4 + k * 7.5);
          explosionShell.material.opacity = 0.9 * (1 - k);
          explosionLight.intensity = 60 * (1 - k);
        }
      }
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const s = smokes[i];
        if (!s.sprite.visible) continue;
        s.ttl -= d;
        if (s.ttl <= 0) {
          s.sprite.visible = false;
          continue;
        }
        const k = 1 - s.ttl / s.life;
        s.sprite.scale.setScalar(0.6 + k * (s.maxScale - 0.6));
        s.sprite.material.opacity = 0.55 * (1 - k * 0.8);
      }
      if (api.shake > 0) {
        api.shake = Math.max(0, api.shake - d * 2.2);
      }
    },

    // Hide everything immediately (round reset / match end).
    clear() {
      for (let i = 0; i < TRACER_COUNT; i++) tracers[i].mesh.visible = false;
      for (let i = 0; i < PARTICLE_COUNT; i++) particles[i].mesh.visible = false;
      for (let i = 0; i < SMOKE_COUNT; i++) smokes[i].sprite.visible = false;
      explosionShell.visible = false;
      explosionLight.visible = false;
      explosionTtl = 0;
      api.shake = 0;
    },
  };

  return api;
}
