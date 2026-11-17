// EMBERLINE grenades — smoke, flash and HE on one ballistic throw: gravity, a
// bounce off walls and the floor, then a fuse. Smoke leaves a sphere behind that
// bots test against their line of sight; HE and flash call back into main through
// the bound ctx, so this module never touches players or bots directly.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const GRAVITY = 12;
const THROW_SPEED = 13;
const THROW_UP = 4.5;
const GRENADE_RADIUS = 0.09;
const BOUNCE_KEEP = 0.45;
const SLIDE_KEEP = 0.7;
const FUSES = { he: 1.6, flash: 1.4, smoke: 1.2 };
const SMOKE_RADIUS = 4;
const SMOKE_LIFE = 12;
const SMOKE_GROW_TIME = 0.8;
const HE_RADIUS = 6;
const HE_DAMAGE = 90;

export function createGrenades(scene, colliders) {
  const state = { smoke: 1, flash: 1, he: 1 };
  const active = [];
  const smokeSpheres = [];
  let ctx = null;

  const shellMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6, metalness: 0.5 });
  const shellGeo = new THREE.SphereGeometry(GRENADE_RADIUS, 10, 8);
  const smokeGeo = new THREE.SphereGeometry(1, 20, 14);
  const smokeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.smoke), roughness: 1, metalness: 0,
    transparent: true, opacity: 0.55, depthWrite: false,
  });

  function bind(nextCtx) {
    ctx = nextCtx;
  }

  function counts() {
    return { smoke: state.smoke, flash: state.flash, he: state.he };
  }

  function give(type, n) {
    if (!(type in state)) return false;
    state[type] += n;
    return true;
  }

  function resetRound() {
    // Counts persist across rounds (bought grenades are kept); only the
    // live grenades and smoke are cleared. main.js tops each type up to 1.
    for (let i = active.length - 1; i >= 0; i--) scene.remove(active[i].mesh);
    active.length = 0;
    for (let i = smokeSpheres.length - 1; i >= 0; i--) scene.remove(smokeSpheres[i].mesh);
    smokeSpheres.length = 0;
  }

  // Bounce a point against the colliders by hand (no Box3 allocation): find the
  // shallowest penetration axis, push the point out along it and reflect that
  // velocity component, damped. Returns true when a wall was hit.
  function bounceOffWalls(p, vel) {
    const r = GRENADE_RADIUS;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (p.x <= c.min.x - r || p.x >= c.max.x + r) continue;
      if (p.y <= c.min.y - r || p.y >= c.max.y + r) continue;
      if (p.z <= c.min.z - r || p.z >= c.max.z + r) continue;
      const dxMin = p.x - (c.min.x - r);
      const dxMax = (c.max.x + r) - p.x;
      const dyMin = p.y - (c.min.y - r);
      const dyMax = (c.max.y + r) - p.y;
      const dzMin = p.z - (c.min.z - r);
      const dzMax = (c.max.z + r) - p.z;
      let depth = dxMin;
      let axis = 0;
      let side = -1;
      if (dxMax < depth) { depth = dxMax; axis = 0; side = 1; }
      if (dyMin < depth) { depth = dyMin; axis = 1; side = -1; }
      if (dyMax < depth) { depth = dyMax; axis = 1; side = 1; }
      if (dzMin < depth) { depth = dzMin; axis = 2; side = -1; }
      if (dzMax < depth) { depth = dzMax; axis = 2; side = 1; }
      if (axis === 0) {
        p.x += side * depth;
        vel.x = -vel.x * BOUNCE_KEEP;
        vel.y *= SLIDE_KEEP;
        vel.z *= SLIDE_KEEP;
      } else if (axis === 1) {
        p.y += side * depth;
        vel.y = -vel.y * BOUNCE_KEEP;
        vel.x *= SLIDE_KEEP;
        vel.z *= SLIDE_KEEP;
      } else {
        p.z += side * depth;
        vel.z = -vel.z * BOUNCE_KEEP;
        vel.x *= SLIDE_KEEP;
        vel.y *= SLIDE_KEEP;
      }
      return true;
    }
    return false;
  }

  function detonate(g) {
    const p = g.mesh.position;
    if (g.type === 'he') {
      if (ctx) {
        if (typeof ctx.onExplosion === 'function') ctx.onExplosion(p, HE_RADIUS);
        if (typeof ctx.damageArea === 'function') ctx.damageArea(p, HE_RADIUS, HE_DAMAGE, 'player');
      }
    } else if (g.type === 'flash') {
      if (ctx && typeof ctx.onFlash === 'function') ctx.onFlash(1);
    } else if (g.type === 'smoke') {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat.clone());
      mesh.position.copy(p);
      mesh.scale.setScalar(0.5);
      scene.add(mesh);
      smokeSpheres.push({ pos: p.clone(), radius: 0.5, ttl: SMOKE_LIFE, mesh });
    }
  }

  function throwGrenade(type, origin, dir, random) {
    if (!(type in state) || state[type] <= 0) return false;
    state[type] -= 1;
    const mesh = new THREE.Mesh(shellGeo, shellMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    const vel = new THREE.Vector3();
    vel.copy(dir).normalize().multiplyScalar(THROW_SPEED);
    vel.y += THROW_UP;
    if (typeof random === 'function') {
      vel.x += (random() - 0.5) * 0.6;
      vel.z += (random() - 0.5) * 0.6;
    }
    active.push({ mesh, vel, fuse: FUSES[type], type });
    return true;
  }

  function step(dt) {
    for (let i = active.length - 1; i >= 0; i--) {
      const g = active[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const p = g.mesh.position;
      p.x += g.vel.x * dt;
      p.y += g.vel.y * dt;
      p.z += g.vel.z * dt;
      if (p.y < GRENADE_RADIUS) {
        p.y = GRENADE_RADIUS;
        if (g.vel.y < 0) g.vel.y = -g.vel.y * BOUNCE_KEEP;
        g.vel.x *= SLIDE_KEEP;
        g.vel.z *= SLIDE_KEEP;
      }
      bounceOffWalls(p, g.vel);
      if (g.fuse <= 0) {
        detonate(g);
        scene.remove(g.mesh);
        active.splice(i, 1);
      }
    }
    for (let i = smokeSpheres.length - 1; i >= 0; i--) {
      const s = smokeSpheres[i];
      s.ttl -= dt;
      if (s.radius < SMOKE_RADIUS) {
        s.radius = Math.min(SMOKE_RADIUS, s.radius + (SMOKE_RADIUS / SMOKE_GROW_TIME) * dt);
        s.mesh.scale.setScalar(s.radius);
      }
      if (s.ttl < 2) s.mesh.material.opacity = Math.max(0, 0.55 * (s.ttl / 2));
      if (s.ttl <= 0) {
        scene.remove(s.mesh);
        s.mesh.material.dispose();
        smokeSpheres.splice(i, 1);
      }
    }
  }

  return {
    state,
    smokeSpheres,
    counts,
    give,
    resetRound,
    throw: throwGrenade,
    step,
    bind,
  };
}
