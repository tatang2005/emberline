// bots.js — EMBERLINE bot AI: 4 Ember teammates + 5 Slate enemies.
// Waypoint routing, hold/engage/plant/defuse states, LOS with smoke
// blocking, reaction time + burst fire, bot-vs-bot combat, death fall,
// round scaling. Written fresh in the build session (2026-11-17).
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';

// ---- module-scope temps: no per-frame allocation in hot loops ----
const _ray = new THREE.Raycaster();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _targetEye = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();

const EYE_HEIGHT = 1.5;
const MAX_RANGE = 40;
const HEADSHOT_CHANCE = 0.08;
const HEAD_MULT = 4;
const ACQUIRE_INTERVAL = 0.12;
const REPATH_STUCK_TIME = 2;
const REPATH_STUCK_DIST = 0.3;
const ENGAGE_MEMORY = 1.5;

const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Spark'];
const SLATE_NAMES = ['Frost', 'Gale', 'Hail', 'Mist', 'Rime'];

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function angleTo(x0, z0, x1, z1) {
  return Math.atan2(x1 - x0, z1 - z0);
}

// Closest point on segment a->b to point c; returns distance. Uses temps.
function segmentSphereDist(ax, az, bx, bz, cx, cz) {
  _ab.set(bx - ax, 0, bz - az);
  _ac.set(cx - ax, 0, cz - az);
  const lenSq = _ab.x * _ab.x + _ab.z * _ab.z;
  let t = 0;
  if (lenSq > 0.000001) {
    t = (_ac.x * _ab.x + _ac.z * _ab.z) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  _closest.set(ax + _ab.x * t, 0, az + _ab.z * t);
  const dx = cx - _closest.x;
  const dz = cz - _closest.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// ctx = { playerPos, playerCrouching, playerAlive, playerFiring,
//         noiseEvents:[{pos, ttl}], smokeSpheres, bombPlanted, bombSite,
//         time, damagePlayer(amount, fromPos), onKill(bot, killerTeam), effects }
// `characters` is the characters module ({ createCharacterMesh, setBotPose })
// or the createCharacterMesh function itself.
export function createBots(scene, world, characters, random) {
  const rand = typeof random === 'function' ? random : Math.random;
  const makeChar = typeof characters === 'function'
    ? characters
    : characters.createCharacterMesh;
  const setPose = (characters && typeof characters === 'object' && typeof characters.setBotPose === 'function')
    ? characters.setBotPose
    : null;

  const list = [];
  const hitMeshes = [];
  let lastCtx = null;
  let roundNum = 1;

  function makeBot(id, team, name, spawnIdx) {
    const spawn = team === 'ember'
      ? world.spawns.ember[spawnIdx]
      : world.spawns.slate[spawnIdx];
    const char = makeChar(team);
    char.group.position.set(spawn.x, 0, spawn.z);
    scene.add(char.group);
    const bot = {
      id, team, name,
      group: char.group,
      head: char.head,
      torso: char.torso,
      hitMeshes: char.hitMeshes,
      yaw: 0,
      health: 100,
      armor: 0,
      alive: true,
      state: 'route',
      path: [],
      pathIdx: 0,
      dest: null, // {x, z} final destination of the current route
      holdPos: { x: spawn.x, z: spawn.z },
      reaction: 0.6,
      burstLeft: 0,
      nextShotAt: 0,
      burstPauseUntil: 0,
      weapon: 'P9',
      speed: 3.6,
      carrier: false,
      defuseProgress: 0,
      planting: false,
      defusing: false,
      // internal
      char,
      spawnIdx,
      site: null, // 'A' | 'B' assigned site for attackers
      siteLocked: false,
      homeSite: null, // defenders: 'A' | 'B' | 'mid'
      target: null, // { kind:'player'|'bot', ref, pos:Vector3 }
      targetPos: new THREE.Vector3(),
      reactAt: 0,
      lastSeenAt: -100,
      acquireAt: 0,
      noProgressAt: 0,
      lastX: spawn.x,
      lastZ: spawn.z,
      dying: false,
      fallT: 0,
      rotated: false, // defenders: already rotated to the planted site
      scanT: rand() * Math.PI * 2,
      roamAt: 0,
      investigateAt: 0,
      aiming: false,
      crouching: false,
    };
    for (const h of char.hitMeshes) {
      h.mesh.userData.bot = bot;
      h.mesh.userData.part = h.part;
      hitMeshes.push(h.mesh);
    }
    return bot;
  }

  for (let i = 0; i < 4; i++) {
    list.push(makeBot('ember-' + (i + 1), 'ember', EMBER_NAMES[i], i + 1));
  }
  for (let i = 0; i < 5; i++) {
    list.push(makeBot('slate-' + (i + 1), 'slate', SLATE_NAMES[i], i));
  }

  // ---- line of sight: ray vs world shootables + smoke spheres ----
  function smokeBlocks(ax, ay, az, bx, by, bz, spheres) {
    if (!spheres) return false;
    for (let i = 0; i < spheres.length; i++) {
      const s = spheres[i];
      // segment-sphere test in 3D (cheap: check XZ distance, then Y span)
      const d = segmentSphereDist(ax, az, bx, bz, s.pos.x, s.pos.z);
      if (d >= s.radius) continue;
      const minY = Math.min(ay, by);
      const maxY = Math.max(ay, by);
      if (s.pos.y + s.radius < minY || s.pos.y - s.radius > maxY) continue;
      return true;
    }
    return false;
  }

  function hasLOS(fromPos, fromEyeY, toPos, toEyeY, smokeSpheres) {
    _from.set(fromPos.x, fromEyeY, fromPos.z);
    _to.set(toPos.x, toEyeY, toPos.z);
    _dir.subVectors(_to, _from);
    const dist = _dir.length();
    if (dist > MAX_RANGE) return false;
    if (dist < 0.001) return true;
    if (smokeBlocks(_from.x, _from.y, _from.z, _to.x, _to.y, _to.z, smokeSpheres)) {
      return false;
    }
    _dir.multiplyScalar(1 / dist);
    _ray.set(_from, _dir);
    _ray.far = dist - 0.15;
    const hits = _ray.intersectObjects(world.shootables, false);
    return hits.length === 0;
  }

  function routeTo(bot, x, z) {
    const a = world.nearestWaypoint(bot.group.position.x, bot.group.position.z);
    const b = world.nearestWaypoint(x, z);
    let path = [];
    try {
      path = world.findPath(a.id, b.id) || [];
    } catch (e) {
      path = [];
    }
    // Append the exact destination as the final step.
    path = path.slice();
    path.push({ id: -1, x, z });
    bot.path = path;
    bot.pathIdx = 0;
    bot.dest = { x, z };
    bot.noProgressAt = 0;
    bot.lastX = bot.group.position.x;
    bot.lastZ = bot.group.position.z;
  }

  function sitePos(site) {
    const s = world.sites[site];
    return { x: s.x, z: s.z, r: s.r };
  }

  function nearestSite(x, z) {
    const a = world.sites.A;
    const b = world.sites.B;
    const da = (x - a.x) * (x - a.x) + (z - a.z) * (z - a.z);
    const db = (x - b.x) * (x - b.x) + (z - b.z) * (z - b.z);
    return da <= db ? 'A' : 'B';
  }

  function assignWeapon(bot) {
    if (roundNum <= 1) {
      bot.weapon = 'P9';
      return;
    }
    bot.weapon = rand() < 0.55 ? 'VK47' : 'RAPTOR';
  }

  function assignRoles(bot) {
    if (bot.team === 'ember') {
      bot.homeSite = null;
      bot.site = null;
      bot.siteLocked = false;
      // Carrier is the first Ember bot (ember-1).
      bot.carrier = bot.id === 'ember-1';
    } else {
      bot.carrier = false;
      const idx = bot.spawnIdx;
      if (idx === 0 || idx === 1) bot.homeSite = 'A';
      else if (idx === 2 || idx === 3) bot.homeSite = 'B';
      else bot.homeSite = 'mid';
      bot.site = bot.homeSite === 'mid' ? null : bot.homeSite;
    }
  }

  function spawnRound(num) {
    roundNum = Math.max(1, num | 0);
    for (const bot of list) {
      const spawn = bot.team === 'ember'
        ? world.spawns.ember[bot.spawnIdx]
        : world.spawns.slate[bot.spawnIdx];
      bot.group.position.set(spawn.x, 0, spawn.z);
      bot.group.rotation.set(0, 0, 0);
      bot.health = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.dying = false;
      bot.fallT = 0;
      bot.state = 'route';
      bot.planting = false;
      bot.defusing = false;
      bot.defuseProgress = 0;
      bot.target = null;
      bot.burstLeft = 0;
      bot.nextShotAt = 0;
      bot.burstPauseUntil = 0;
      bot.rotated = false;
      bot.investigateAt = 0;
      bot.roamAt = 0;
      bot.aiming = false;
      bot.crouching = false;
      bot.speed = 3.2 + rand() * 1.0;
      // Reaction gets slightly faster each round, capped at 0.35 s base.
      const base = Math.max(0.35, 0.7 - (roundNum - 1) * 0.05);
      bot.reaction = base * (0.8 + rand() * 0.4);
      assignWeapon(bot);
      assignRoles(bot);
      bot.group.visible = true;
      if (bot.team === 'slate') {
        if (bot.homeSite === 'mid') {
          bot.holdPos = { x: 0, z: 0 };
          routeTo(bot, 0, 0);
        } else {
          const s = sitePos(bot.homeSite);
          bot.holdPos = {
            x: s.x + (rand() * 4 - 2),
            z: s.z + (rand() * 4 - 2),
          };
          routeTo(bot, bot.holdPos.x, bot.holdPos.z);
        }
      } else {
        // Attackers pick their site on the first step (needs player pos).
        bot.holdPos = { x: spawn.x, z: spawn.z };
        bot.path = [];
        bot.pathIdx = 0;
        bot.dest = null;
      }
      bot.yaw = angleTo(spawn.x, spawn.z, 0, -9);
      bot.group.rotation.y = bot.yaw;
      applyPose(bot);
    }
  }

  function applyPose(bot) {
    if (!setPose) return;
    setPose(bot.char, { crouch: bot.crouching, aiming: bot.aiming });
  }

  function startDeath(bot, killerTeam) {
    bot.alive = false;
    bot.dying = true;
    bot.fallT = 0;
    bot.planting = false;
    bot.defusing = false;
    bot.aiming = false;
    bot.target = null;
    if (bot.carrier) {
      // Hand the Spark to the next living Ember bot.
      bot.carrier = false;
      for (const other of list) {
        if (other.team === 'ember' && other.alive && other !== bot) {
          other.carrier = true;
          break;
        }
      }
    }
    if (lastCtx && typeof lastCtx.onKill === 'function') {
      lastCtx.onKill(bot, killerTeam);
    }
  }

  // Public damage: caller passes final damage (head multiplier + falloff
  // already applied). Returns true if the hit killed the bot.
  function damage(bot, amount, part, killer) {
    if (!bot || !bot.alive || !(amount > 0)) return false;
    let remaining = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.health -= remaining;
    if (bot.health <= 0) {
      bot.health = 0;
      startDeath(bot, killer);
      return true;
    }
    return false;
  }

  // Area damage (grenades): linear falloff, full at centre, 25% at edge.
  // Returns the list of bots hit.
  function damageArea(pos, radius, dmg, killer) {
    const hit = [];
    for (const bot of list) {
      if (!bot.alive) continue;
      const dx = bot.group.position.x - pos.x;
      const dz = bot.group.position.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > radius) continue;
      const fall = 1 - 0.75 * (dist / radius);
      damage(bot, dmg * fall, 'torso', killer);
      hit.push(bot);
    }
    return hit;
  }

  // ---- target acquisition (throttled per bot) ----
  function acquire(bot, ctx) {
    let best = null;
    let bestDist = MAX_RANGE;
    const bp = bot.group.position;
    // Player.
    if (ctx.playerAlive && ctx.playerPos) {
      const dx = ctx.playerPos.x - bp.x;
      const dz = ctx.playerPos.z - bp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        const eyeY = ctx.playerCrouching ? 1.05 : 1.62;
        if (hasLOS(bp, EYE_HEIGHT, ctx.playerPos, eyeY, ctx.smokeSpheres)) {
          best = { kind: 'player', ref: null };
          bestDist = dist;
          bot.targetPos.set(ctx.playerPos.x, eyeY, ctx.playerPos.z);
        }
      }
    }
    // Enemy bots.
    for (const other of list) {
      if (other.team === bot.team || !other.alive) continue;
      const dx = other.group.position.x - bp.x;
      const dz = other.group.position.z - bp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist >= bestDist) continue;
      if (hasLOS(bp, EYE_HEIGHT, other.group.position, 1.4, ctx.smokeSpheres)) {
        best = { kind: 'bot', ref: other };
        bestDist = dist;
        bot.targetPos.set(
          other.group.position.x, 1.4, other.group.position.z);
      }
    }
    if (best) {
      if (!bot.target || bot.target.kind !== best.kind || bot.target.ref !== best.ref) {
        bot.reactAt = ctx.time + bot.reaction;
        bot.burstLeft = 0;
      }
      bot.target = best;
      bot.lastSeenAt = ctx.time;
    } else {
      bot.target = null;
    }
    return best;
  }

  function hitChance(bot, dist, targetMoving, targetCrouching) {
    let p = 0.5 - dist * 0.008;
    if (targetMoving) p -= 0.15;
    if (targetCrouching) p -= 0.1;
    if (dist > 20) p -= 0.12;
    if (bot.weapon === 'RAPTOR' && dist > 15) p -= 0.1;
    if (p < 0.08) p = 0.08;
    if (p > 0.8) p = 0.8;
    return p;
  }

  function fireShot(bot, ctx) {
    const def = WEAPONS[bot.weapon] || WEAPONS.P9;
    const bp = bot.group.position;
    _muzzle.set(bp.x, 1.45, bp.z);
    _fwd.set(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    _muzzle.x += _fwd.x * 0.5;
    _muzzle.z += _fwd.z * 0.5;
    const fx = ctx.effects;

    const tp = bot.targetPos;
    const dx = tp.x - bp.x;
    const dz = tp.z - bp.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 1;

    const targetMoving = bot.target.kind === 'player'
      ? !!ctx.playerFiring
      : true;
    const targetCrouching = bot.target.kind === 'player'
      ? !!ctx.playerCrouching
      : false;
    const p = hitChance(bot, dist, targetMoving, targetCrouching);
    const hit = rand() < p;
    const head = hit && rand() < HEADSHOT_CHANCE;

    // Miss point: near the target, offset by spread.
    let endX = tp.x;
    let endY = tp.y;
    let endZ = tp.z;
    if (!hit) {
      const spread = 0.4 + dist * 0.03;
      endX += (rand() * 2 - 1) * spread;
      endY += (rand() * 2 - 1) * spread * 0.6;
      endZ += (rand() * 2 - 1) * spread;
    } else if (head) {
      endY = tp.y + 0.15;
    }
    if (fx) {
      fx.tracer(_muzzle, _to.set(endX, endY, endZ), def.tracer);
      fx.impact(_to, null);
    }

    if (!hit) return;
    let dmg = def.damage;
    if (head) dmg *= HEAD_MULT;
    // Bots hit softer than the numbers say: the player should survive a
    // few seconds of exposure, and bot-vs-bot fights should last long
    // enough to feel like a round instead of a coin flip.
    dmg *= bot.target.kind === 'player' ? 0.55 : 0.7;
    if (bot.target.kind === 'player') {
      if (ctx.damagePlayer) ctx.damagePlayer(dmg, bp);
    } else {
      const victim = bot.target.ref;
      if (victim && victim.alive) {
        damage(victim, dmg, head ? 'head' : 'torso', bot.team);
      }
    }
  }

  function moveAlongPath(bot, dt) {
    if (!bot.path || bot.pathIdx >= bot.path.length) return true;
    const wp = bot.path[bot.pathIdx];
    const p = bot.group.position;
    const dx = wp.x - p.x;
    const dz = wp.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.6) {
      bot.pathIdx++;
      return bot.pathIdx >= bot.path.length;
    }
    const stepLen = Math.min(bot.speed * dt, dist);
    p.x += (dx / dist) * stepLen;
    p.z += (dz / dist) * stepLen;
    const targetYaw = angleTo(0, 0, dx, dz);
    bot.yaw = angleLerp(bot.yaw, targetYaw, Math.min(1, dt * 8));
    return false;
  }

  function stepBot(bot, dt, ctx) {
    const p = bot.group.position;
    const time = ctx.time;

    // Death fall animation (0.4 s), then stay down.
    if (!bot.alive) {
      if (bot.dying && bot.fallT < 0.4) {
        bot.fallT += dt;
        const k = Math.min(1, bot.fallT / 0.4);
        bot.group.rotation.x = -Math.PI / 2 * k;
      }
      return;
    }

    // Attackers lock their site on the first step (needs the player pos).
    if (bot.team === 'ember' && !bot.siteLocked) {
      bot.siteLocked = true;
      const playerSite = ctx.playerPos ? nearestSite(ctx.playerPos.x, ctx.playerPos.z) : 'A';
      bot.site = rand() < 0.5 ? playerSite : (rand() < 0.5 ? 'A' : 'B');
      const s = sitePos(bot.site);
      bot.holdPos = { x: s.x + (rand() * 3 - 1.5), z: s.z + (rand() * 3 - 1.5) };
      bot.state = 'route';
      routeTo(bot, bot.holdPos.x, bot.holdPos.z);
    }

    // Bomb planted: defenders rotate to the site (once).
    if (ctx.bombPlanted && bot.team === 'slate' && !bot.rotated && ctx.bombSite) {
      bot.rotated = true;
      bot.planting = false;
      bot.defusing = false;
      if (bot.state !== 'defuse') {
        const s = sitePos(ctx.bombSite);
        bot.state = 'route';
        routeTo(bot, s.x + (rand() * 2 - 1), s.z + (rand() * 2 - 1));
      }
    }
    if (!ctx.bombPlanted) bot.rotated = false;

    // A flashbang blinds every bot for a short while: no acquisition,
    // no firing, and the current target is dropped.
    const blinded = ctx.flashUntil ? time < ctx.flashUntil : false;
    if (blinded) {
      bot.target = null;
      bot.burstLeft = 0;
    }

    // Target acquisition (throttled).
    if (time >= bot.acquireAt) {
      bot.acquireAt = time + ACQUIRE_INTERVAL;
      if (!blinded) acquire(bot, ctx);
    }
    const hasTarget = !blinded && !!bot.target && (time - bot.lastSeenAt) < ENGAGE_MEMORY;
    const wasEngaging = bot.state === 'engage';

    if (hasTarget) {
      // Face the target.
      const ty = angleTo(p.x, p.z, bot.targetPos.x, bot.targetPos.z);
      bot.yaw = angleLerp(bot.yaw, ty, Math.min(1, dt * 10));
      if (bot.state === 'plant' || bot.state === 'defuse') {
        // Visible enemy interrupts plant / defuse.
        bot.state = 'engage';
        bot.planting = false;
        bot.defusing = false;
      } else {
        bot.state = 'engage';
      }
      bot.aiming = true;
      bot.crouching = false;
      // Fire bursts once the reaction time has elapsed.
      if (time >= bot.reactAt) {
        if (bot.burstLeft <= 0) {
          if (time >= bot.burstPauseUntil) {
            bot.burstLeft = 3 + Math.floor(rand() * 3); // 3-5 rounds
            bot.nextShotAt = time;
          }
        } else if (time >= bot.nextShotAt) {
          fireShot(bot, ctx);
          bot.burstLeft--;
          bot.nextShotAt = time + 0.11;
          if (bot.burstLeft <= 0) {
            bot.burstPauseUntil = time + 0.9 + rand() * 0.6;
          }
        }
      }
    } else {
      bot.aiming = false;
      if (wasEngaging) {
        // Lost the target: resume the previous job.
        bot.burstLeft = 0;
        if (bot.team === 'ember') {
          bot.state = bot.dest ? 'route' : 'hold';
          if (bot.dest && (!bot.path || bot.pathIdx >= bot.path.length)) {
            routeTo(bot, bot.dest.x, bot.dest.z);
          }
        } else if (ctx.bombPlanted && ctx.bombSite) {
          bot.state = 'route';
          const s = sitePos(ctx.bombSite);
          routeTo(bot, s.x, s.z);
        } else {
          bot.state = 'route';
          routeTo(bot, bot.holdPos.x, bot.holdPos.z);
        }
      }
    }

    // ---- movement / states ----
    if (bot.state === 'route') {
      bot.crouching = false;
      const arrived = moveAlongPath(bot, dt);
      // Stuck detection: no progress for 2 s -> repath.
      const moved = Math.abs(p.x - bot.lastX) + Math.abs(p.z - bot.lastZ);
      if (moved > REPATH_STUCK_DIST) {
        bot.noProgressAt = 0;
        bot.lastX = p.x;
        bot.lastZ = p.z;
      } else {
        bot.noProgressAt += dt;
        if (bot.noProgressAt > REPATH_STUCK_TIME && bot.dest) {
          routeTo(bot, bot.dest.x, bot.dest.z);
        }
      }
      if (arrived) {
        bot.state = 'hold';
        bot.path = [];
        bot.dest = null;
      }
    } else if (bot.state === 'hold') {
      bot.crouching = bot.team === 'slate';
      // Slow scan sweep while holding.
      if (!hasTarget) {
        bot.scanT += dt * 0.5;
        bot.yaw = angleLerp(bot.yaw, bot.yaw + Math.sin(bot.scanT) * 0.02, 1);
      }
      // Ember carrier plants when alone at the site.
      if (bot.team === 'ember' && bot.carrier && !ctx.bombPlanted && bot.site) {
        const s = sitePos(bot.site);
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < s.r) {
          bot.state = 'plant';
          bot.planting = true;
          bot.crouching = true;
        }
      }
      // Slate at the planted site defuses when alone.
      if (bot.team === 'slate' && ctx.bombPlanted && ctx.bombSite) {
        const s = sitePos(ctx.bombSite);
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < 3) {
          bot.state = 'defuse';
          bot.defusing = true;
          bot.crouching = true;
        }
      }
      // Mid roamer wanders between mid waypoints.
      if (bot.team === 'slate' && bot.homeSite === 'mid' && time >= bot.roamAt) {
        bot.roamAt = time + 6 + rand() * 4;
        const wps = world.waypoints;
        const wp = wps[Math.floor(rand() * wps.length)];
        bot.state = 'route';
        routeTo(bot, wp.x, wp.z);
      }
    } else if (bot.state === 'plant') {
      bot.planting = true;
      bot.crouching = true;
      // Planting is advanced by objective.js via ctx; the bot just waits.
      if (ctx.bombPlanted) {
        bot.planting = false;
        bot.state = 'hold';
        const s = sitePos(ctx.bombSite || bot.site);
        bot.holdPos = { x: s.x + (rand() * 3 - 1.5), z: s.z + (rand() * 3 - 1.5) };
      }
    } else if (bot.state === 'defuse') {
      bot.defusing = true;
      bot.crouching = true;
      bot.defuseProgress += dt;
      if (!ctx.bombPlanted) {
        bot.defusing = false;
        bot.defuseProgress = 0;
        bot.state = 'hold';
      }
    } else if (bot.state === 'retreat') {
      bot.crouching = false;
      const arrived = moveAlongPath(bot, dt);
      if (arrived) bot.state = 'hold';
    }

    // Defenders hear gunfire: investigate a nearby noise event.
    if (bot.team === 'slate' && !hasTarget && bot.state === 'hold'
      && ctx.noiseEvents && ctx.noiseEvents.length > 0
      && time >= bot.investigateAt) {
      bot.investigateAt = time + 4;
      if (rand() < 0.3) {
        const ev = ctx.noiseEvents[0];
        const d = Math.hypot(ev.pos.x - p.x, ev.pos.z - p.z);
        if (d < 30) {
          bot.state = 'route';
          routeTo(bot, ev.pos.x, ev.pos.z);
        }
      }
    }

    // Clamp to map bounds.
    if (p.x < world.bounds.minX) p.x = world.bounds.minX;
    if (p.x > world.bounds.maxX) p.x = world.bounds.maxX;
    if (p.z < world.bounds.minZ) p.z = world.bounds.minZ;
    if (p.z > world.bounds.maxZ) p.z = world.bounds.maxZ;

    bot.group.rotation.y = bot.yaw;
    applyPose(bot);
  }

  function step(dt, ctx) {
    lastCtx = ctx;
    for (const bot of list) {
      stepBot(bot, dt, ctx);
    }
  }

  function reset() {
    spawnRound(1);
  }

  function aliveCount(team) {
    let n = 0;
    for (const bot of list) {
      if (bot.team === team && bot.alive) n++;
    }
    return n;
  }

  // Initial placement (round 1) so the scene is valid before spawnRound.
  spawnRound(1);

  return { list, hitMeshes, spawnRound, step, reset, aliveCount, damage, damageArea };
}
