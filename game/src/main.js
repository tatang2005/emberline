// EMBERLINE — boot, fixed 60 Hz simulation, render loop and orchestration.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame, renders
// it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createWeapons, WEAPONS } from './weapons.js';
import { createGrenades } from './grenades.js';
import * as characters from './characters.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createEconomy, REWARDS } from './economy.js';
import { createObjective } from './objective.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const WIN_SCORE = 8;
const BOMB_RADIUS = 6;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const hud = createHud({ onBuy: handleBuy });
const player = createPlayer(world.colliders, world.spawns.ember[0]);
const weapons = createWeapons(camera);
const grenades = createGrenades(scene, world.colliders);
const bots = createBots(scene, world, characters, random);
const rounds = createRounds();
const economy = createEconomy();
const objective = createObjective(scene, world);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.hitMeshes);
const cameraDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const tempVec = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();

// --- match state (single place; modules own their own slices) ---------------
const match = {
  health: 100,
  playerAlive: true,
  kills: 0,
  grenade: 'smoke',
  planting: false,
  defusing: false,
  plantSite: null,
  carrier: 'player', // 'player' or a bot object
  noise: [], // {pos: Vector3, ttl}
  blindUntil: 0,
  flashUntil: 0,
  elapsed: 0,
  frozen: false,
  started: false,
  stepDistance: 0,
  lastStepAt: 0,
  roundEnding: false,
};
let accumulator = 0;
let lastTime = performance.now();

function botName(bot) {
  return bot.name || (bot.team === 'ember' ? 'Ember' : 'Slate');
}

function aliveCount(team) {
  if (team === 'ember') return (match.playerAlive ? 1 : 0) + bots.aliveCount('ember');
  return bots.aliveCount('slate');
}

// --- HUD sync ----------------------------------------------------------------
function syncHud() {
  hud.setHealth(Math.max(0, Math.ceil(match.health)), economy.armor);
  hud.setAmmo(weapons.state.slots[weapons.state.current].mag, weapons.state.slots[weapons.state.current].reserve);
  hud.setMoney(economy.money);
  hud.setScore(rounds.state.ember, rounds.state.slate, rounds.state.round);
  hud.setWeapon(weapons.currentDef().name);
  hud.setGrenades(grenades.counts());
  const timer = objective.state.planted ? objective.state.detonateIn : rounds.state.timer;
  hud.setTimer(timer, rounds.state.phase);
  hud.setBomb(objective.state.planted ? `Spark planted — ${objective.state.detonateIn.toFixed(0)}s` : '');
  hud.setCrosshairSpread(Math.round(weapons.spread(player.groundSpeed()) * 900));
  hud.updateMinimap({
    playerPos: player.state.position,
    playerYaw: player.state.yaw,
    teammates: bots.list.filter((b) => b.team === 'ember').map((b) => ({ x: b.group.position.x, z: b.group.position.z, alive: b.alive })),
    bombPlanted: objective.state.planted,
    bombSite: objective.state.site,
  });
}

// --- buy menu ----------------------------------------------------------------
function buyItems() {
  const items = [];
  let key = 1;
  for (const id of ['VK47', 'RAPTOR', 'BREACHER', 'LONGSHOT']) {
    const def = WEAPONS[id];
    items.push({ key: key++, kind: 'weapon', id, name: def.name, price: def.price, owned: weapons.state.slots[id] !== undefined, detail: `${def.mag} rounds · ${def.damage} dmg` });
  }
  for (const [id, name, price] of [['smoke', 'Smoke grenade', 300], ['flash', 'Flashbang', 200], ['he', 'HE grenade', 300]]) {
    items.push({ key: key++, kind: 'grenade', id, name, price, owned: grenades.counts()[id] > 0, detail: `${grenades.counts()[id]} carried` });
  }
  items.push({ key: key++, kind: 'armor', id: 'armor', name: 'Kevlar Vest', price: 650, owned: economy.armor > 0, detail: 'Absorbs half of incoming damage' });
  return items;
}

function openBuyMenu() {
  if (rounds.state.phase !== 'buy') return;
  hud.openBuy(buyItems(), economy.money);
}

function handleBuy(kind, id) {
  let ok = false;
  if (kind === 'weapon') {
    ok = economy.buyWeapon(id);
    if (ok) { weapons.give(id); weapons.equip(id); }
  } else if (kind === 'grenade') {
    ok = economy.buyGrenade(id);
    if (ok) grenades.give(id, 1);
  } else if (kind === 'armor') {
    ok = economy.buyArmor();
  }
  if (ok) audio.buy();
  else audio.denied();
  hud.setMoney(economy.money);
  hud.setBuyMoney(economy.money);
  if (hud.isBuyOpen()) hud.openBuy(buyItems(), economy.money);
  syncHud();
}

// --- damage ------------------------------------------------------------------
function damagePlayer(amount, fromPos) {
  if (!match.playerAlive || rounds.state.phase !== 'live') return;
  const absorbed = Math.min(economy.armor, amount * 0.5);
  economy.armor -= absorbed;
  match.health -= (amount - absorbed);
  audio.hurt();
  if (fromPos) {
    const dx = fromPos.x - player.state.position.x;
    const dz = fromPos.z - player.state.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const relative = worldAngle - player.state.yaw;
    hud.damageFrom((relative * 180) / Math.PI);
  }
  if (match.health <= 0) {
    match.health = 0;
    match.playerAlive = false;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.killfeedAdd('You were dropped', 'slate');
    if (match.carrier === 'player') {
      const living = bots.list.find((b) => b.team === 'ember' && b.alive);
      match.carrier = living ?? null;
      if (living) hud.setHint('Spark passed to ' + botName(living));
    }
    checkRoundEnd();
  }
  syncHud();
}

function damageArea(pos, radius, damage, source) {
  const hit = bots.damageArea(pos, radius, damage, source === 'player' ? 'player' : source);
  for (const bot of hit) {
    if (source === 'player' && !bot.alive) onBotDown(bot, 'player');
  }
  if (source !== 'player') {
    const dist = tempVec.copy(player.state.position).distanceTo(pos);
    if (match.playerAlive && dist < radius) {
      damagePlayer(damage * (1 - (dist / radius) * 0.75), pos);
    }
  }
}

function onBotDown(bot, killer) {
  // Killfeed is written by the bots' onKill callback; this only pays the
  // player's reward for the kill.
  if (killer !== 'player') return;
  match.kills += 1;
  economy.add(REWARDS.kill, 'kill');
  audio.kill();
  checkRoundEnd();
}

function checkRoundEnd() {
  if (rounds.state.phase !== 'live' || match.roundEnding) return;
  const slateLeft = bots.aliveCount('slate');
  const emberLeft = aliveCount('ember');
  if (slateLeft === 0) endRound('ember', 'Slate team eliminated');
  else if (emberLeft === 0 && !objective.state.planted) endRound('slate', 'Ember team eliminated');
  else if (emberLeft === 0 && objective.state.planted) {
    // No Ember left alive to stop the defuse: defenders win on defuse or
    // the round plays out to detonation; nothing to do here.
  }
}

// --- rounds ------------------------------------------------------------------
function startMatch() {
  economy.resetMatch();
  rounds.startMatch(); // also starts round 1 (buy phase)
  setupRound();
}

function setupRound() {
  match.health = 100;
  match.playerAlive = true;
  match.kills = 0;
  match.carrier = 'player';
  match.planting = false;
  match.defusing = false;
  match.roundEnding = false;
  match.noise.length = 0;
  economy.resetRound();
  weapons.refillAll();
  weapons.equip('P9');
  grenades.resetRound();
  for (const type of ['smoke', 'flash', 'he']) {
    if (grenades.counts()[type] < 1) grenades.give(type, 1);
  }
  objective.reset();
  player.reset(world.spawns.ember[0].x, world.spawns.ember[0].z);
  player.state.yaw = 0; // face north (-z), up the map toward the sites
  bots.spawnRound(rounds.state.round);
  hud.hideOverlay();
  hud.setHint('');
  openBuyMenu();
  hud.showBanner(`Round ${rounds.state.round}`, 'Buy phase — press B to shop, then take a site', 2600);
  syncHud();
}

function startRound() {
  rounds.startRound();
  setupRound();
}

function endRound(winner, reason) {
  if (rounds.state.phase !== 'live' || match.roundEnding) return;
  match.roundEnding = true;
  match.planting = false;
  match.defusing = false;
  hud.closeBuy();
  objective.cancelPlant();
  objective.cancelDefuse();
  const won = winner === 'ember';
  economy.add(won ? REWARDS.win : REWARDS.loss, won ? 'round win' : 'round loss');
  if (won) audio.roundWin();
  else audio.roundLose();
  hud.showBanner(won ? 'Round won' : 'Round lost', reason, 3200);
  rounds.endRound(winner, reason);
  syncHud();
  setTimeout(() => {
    if (rounds.state.winner) {
      rounds.state.phase = 'matchEnd';
      const winnerName = rounds.state.ember >= WIN_SCORE ? 'Ember' : 'Slate';
      hud.showOverlay('matchEnd', { ember: rounds.state.ember, slate: rounds.state.slate, winner: winnerName });
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (rounds.state.phase === 'roundEnd') startRound();
  }, 4200);
}

rounds.onEvent = (event) => {
  if (event.type === 'buyEnd') {
    // rounds.js fires this after it already flipped phase to 'live',
    // so do not re-check the phase here — just close the shop.
    hud.closeBuy();
    hud.showBanner(`Round ${rounds.state.round}`, 'Plant the Spark at Furnace or Crane Yard', 2400);
    syncHud();
  } else if (event.type === 'timeUp' && rounds.state.phase === 'live') {
    if (!objective.state.planted) endRound('slate', 'Time expired — Spark never planted');
  }
};

objective.onEvent = (event) => {
  if (event.type === 'planted') {
    economy.add(REWARDS.plant, 'plant');
    hud.showBanner('Spark planted', 'Defend it — 35 seconds to detonation', 2600);
    hud.setHint('Spark planted at ' + (event.site === 'A' ? 'Furnace' : 'Crane Yard'));
    syncHud();
  } else if (event.type === 'beep') {
    audio.plantBeep(event.urgent);
  } else if (event.type === 'detonated') {
    const site = world.sites[objective.state.site ?? 'A'];
    tempVec.set(site.x, 1.2, site.z);
    effects.explosion(tempVec);
    audio.explosion();
    endRound('ember', 'Spark detonated');
  } else if (event.type === 'defused') {
    economy.add(REWARDS.defuse, 'defuse');
    hud.showBanner('Spark defused', 'Slate holds the site', 2600);
    endRound('slate', 'Spark defused');
  }
};

// --- player shooting -----------------------------------------------------------
function falloffDamage(def, distance) {
  const f = def.falloff;
  if (!f || distance <= f.start) return def.damage;
  if (distance >= f.end) return def.damage * f.min;
  const t = (distance - f.start) / (f.end - f.start);
  return def.damage * (1 - t * (1 - f.min));
}

function shoot() {
  if (!weapons.takeRound()) {
    audio.dryFire();
    weapons.reload();
    return;
  }
  const def = weapons.currentDef();
  const spread = weapons.spread(player.groundSpeed()) * (input.state.aiming ? 0.6 : 1);
  weapons.pullTrigger();
  audio.shot(def.id);
  weapons.muzzleWorldPos(muzzlePos);
  const pellets = def.pellets || 1;
  for (let p = 0; p < pellets; p += 1) {
    camera.getWorldDirection(cameraDir);
    cameraDir.x += (random() * 2 - 1) * spread;
    cameraDir.y += (random() * 2 - 1) * spread;
    cameraDir.z += (random() * 2 - 1) * spread;
    cameraDir.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, cameraDir);
    // Skip corpses: a dead bot must not stop a bullet.
    let hit = null;
    let guard = 0;
    let origin = camera.position;
    while (guard < 4) {
      const found = raycaster.intersectObjects(shootables, false)[0];
      if (!found) break;
      const deadBody = found.object.userData.bot && !found.object.userData.bot.alive;
      if (!deadBody) {
        hit = found;
        break;
      }
      guard += 1;
      origin = found.point;
      raycaster.set(origin, cameraDir);
      raycaster.far = 90 - camera.position.distanceTo(origin);
    }
    const end = hit ? hit.point : tempVec2.copy(camera.position).addScaledVector(cameraDir, 90);
    effects.tracer(muzzlePos, end, def.tracer);
    if (!hit) continue;
    const target = hit.object.userData.bot;
    if (target && target.alive) {
      const part = hit.object.userData.part ?? 'torso';
      const mult = part === 'head' ? def.headMult : part === 'limbs' ? 0.75 : 1;
      const dmg = falloffDamage(def, hit.distance) * mult;
      const killed = bots.damage(target, dmg, part, 'player');
      effects.hitSpark(hit.point);
      hud.hitMarker(killed);
      audio.hit();
      if (killed) onBotDown(target, 'player');
    } else {
      effects.impact(hit.point, hit.face ? hit.face.normal : null);
    }
  }
  player.recoil(def.kick, (random() * 2 - 1) * def.kick * 0.4);
  match.noise.push({ pos: player.state.position.clone(), ttl: 1.2 });
  syncHud();
}

// --- grenades / plant / defuse wiring -----------------------------------------
grenades.bind({
  damageArea: (pos, radius, damage) => damageArea(pos, radius, damage, 'player'),
  onFlash: (strength) => {
    hud.flashWhite(strength);
    match.flashUntil = match.elapsed + 2.5;
  },
  onExplosion: (pos, radius) => {
    effects.explosion(pos);
    audio.explosion();
  },
});

function tryThrowGrenade() {
  const type = match.grenade;
  camera.getWorldDirection(cameraDir);
  const origin = tempVec.copy(player.state.position);
  origin.y = player.state.position.y + player.state.eye - 0.1;
  if (grenades.throw(type, origin, cameraDir, random)) {
    audio.reload();
    syncHud();
  } else {
    audio.denied();
  }
}

function nearSite() {
  const p = player.state.position;
  for (const key of ['A', 'B']) {
    const site = world.sites[key];
    const dx = p.x - site.x;
    const dz = p.z - site.z;
    if (dx * dx + dz * dz < site.r * site.r) return key;
  }
  return null;
}

function updateObjectiveIntent() {
  const site = nearSite();
  const live = rounds.state.phase === 'live' && match.playerAlive;
  const wantPlant = live && !objective.state.planted && match.carrier === 'player' && site !== null && input.state.keys.has('KeyE');
  const wantDefuse = live && objective.state.planted && site === objective.state.site && input.state.keys.has('KeyE');
  if (wantPlant && !match.planting) {
    match.plantSite = site;
    objective.startPlant('player', site);
  } else if (!wantPlant && match.planting) {
    objective.cancelPlant();
  }
  if (wantDefuse && !match.defusing) objective.startDefuse('player');
  else if (!wantDefuse && match.defusing) objective.cancelDefuse();
  match.planting = wantPlant;
  match.defusing = wantDefuse;

  // Bots plant/defuse through the same objective.
  let botPlanting = false;
  let botDefusing = false;
  for (const bot of bots.list) {
    if (!bot.alive) continue;
    if (bot.state === 'plant' && bot.planting) {
      botPlanting = true;
      if (!objective.state.planted && !match.planting) objective.startPlant(bot, bot.site ?? 'A');
    }
    if (bot.state === 'defuse' && bot.defusing) {
      botDefusing = true;
      if (objective.state.planted && !match.defusing) objective.startDefuse(bot);
    }
  }
  const planting = match.planting || botPlanting;
  const defusing = match.defusing || botDefusing;
  objective.step(FIXED_STEP, { planting, defusing, time: match.elapsed });
  if (site && !objective.state.planted && match.carrier === 'player' && live) {
    hud.setHint(`Hold E to plant the Spark at Site ${site}`);
  } else if (objective.state.planted && site === objective.state.site && live) {
    hud.setHint('Hold E to defuse the Spark');
  } else if (!match.planting && !match.defusing) {
    hud.setHint('');
  }
}

// --- per-frame input ------------------------------------------------------------
function handleKeys() {
  const keys = input.state.keys;
  if (keys.has('KeyR')) weapons.reload();
  for (const code of input.state.pressed) {
    if (code === 'KeyB') {
      if (hud.isBuyOpen()) hud.closeBuy();
      else if (rounds.state.phase === 'buy') openBuyMenu();
    } else if (code === 'KeyQ') {
      const order = ['smoke', 'flash', 'he'];
      match.grenade = order[(order.indexOf(match.grenade) + 1) % order.length];
      hud.setHint(`Grenade: ${match.grenade}`);
      setTimeout(() => hud.setHint(''), 1200);
    } else if (code === 'KeyG') {
      if (rounds.state.phase === 'live' && match.playerAlive) tryThrowGrenade();
    } else if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      const ids = ['P9', 'VK47', 'RAPTOR', 'BREACHER', 'LONGSHOT'];
      if (n >= 1 && n <= ids.length && weapons.state.slots[ids[n - 1]] !== undefined) {
        weapons.equip(ids[n - 1]);
        audio.reload();
        syncHud();
      }
    }
  }
  input.endFrame();
}

// --- simulation step -------------------------------------------------------------
function botContext() {
  return {
    playerPos: player.state.position,
    playerCrouching: player.state.crouching,
    playerAlive: match.playerAlive,
    playerFiring: input.state.firing,
    noiseEvents: match.noise,
    smokeSpheres: grenades.smokeSpheres,
    bombPlanted: objective.state.planted,
    bombSite: objective.state.site,
    flashUntil: match.flashUntil,
    time: match.elapsed,
    damagePlayer,
    onKill: (bot, killerTeam) => {
      const killer = killerTeam === 'player' ? 'You' : killerTeam === 'ember' ? 'Ember' : 'Slate';
      hud.killfeedAdd(`${killer} ▸ ${botName(bot)}`, killerTeam === 'player' ? 'you' : killerTeam);
      checkRoundEnd();
    },
    effects,
  };
}

function step(dt) {
  match.elapsed += dt;
  for (const n of match.noise) n.ttl -= dt;
  match.noise = match.noise.filter((n) => n.ttl > 0);

  if (rounds.state.phase === 'buy' || rounds.state.phase === 'live') {
    rounds.step(dt);
  }
  player.step(dt, input.state.keys);
  weapons.step(dt);
  grenades.step(dt);
  bots.step(dt, botContext());
  effects.step(dt);

  // Footsteps.
  const speed = player.groundSpeed();
  if (player.state.onGround && speed > 1) {
    match.stepDistance += speed * dt;
    if (match.stepDistance > 2.4) {
      match.stepDistance = 0;
      audio.footstep();
    }
  }

  if (rounds.state.phase === 'live') updateObjectiveIntent();

  // Camera: position + recoil + shake + ADS zoom.
  const targetFov = input.state.aiming && match.playerAlive ? 58 : 74;
  if (Math.abs(camera.fov - targetFov) > 0.1) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
    camera.updateProjectionMatrix();
  }
  syncCamera();
}

function syncCamera() {
  const shake = effects.shake;
  const sx = shake > 0 ? (random() * 2 - 1) * shake * 0.02 : 0;
  const sy = shake > 0 ? (random() * 2 - 1) * shake * 0.02 : 0;
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch + sy, player.state.yaw + sx, 0, 'YXZ');
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!match.frozen) {
    const look = input.takeLook();
    if (match.playerAlive && rounds.state.phase !== 'menu') player.look(look.x, look.y);
    handleKeys();
    if (input.state.firing && weapons.ready() && rounds.state.phase === 'live' && match.playerAlive) {
      shoot();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

// --- overlay / lock ---------------------------------------------------------------
hud.onPlay(() => {
  if (shot) return;
  audio.unlock();
  if (rounds.state.phase === 'matchEnd' || rounds.state.phase === 'menu') {
    startMatch();
  }
  input.requestLock();
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    match.started = true;
    hud.hideOverlay();
    if (rounds.state.phase === 'menu') startMatch();
  } else if (match.playerAlive && rounds.state.phase === 'live') {
    hud.showOverlay('paused', {});
  } else if (rounds.state.phase === 'menu' && !match.started) {
    hud.showOverlay('menu', {});
  }
}

// --- deterministic screenshots ------------------------------------------------------
function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const p = player.state;
  const dx = point.x - p.position.x;
  const dy = point.y - (p.position.y + p.eye);
  const dz = point.z - p.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      match.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.closeBuy();
  if (name === 'start') {
    rounds.state.phase = 'menu';
    rounds.state.timer = 100;
    player.reset(world.spawns.ember[0].x, world.spawns.ember[0].z);
    player.state.yaw = Math.PI * 0.92;
    settle(20);
    const vista = new THREE.Vector3(0, 1.6, -8);
    aimAt(vista);
    hud.showOverlay('menu', {});
  } else if (name === 'play') {
    startMatch();
    hud.closeBuy();
    hud.hideBanner();
    rounds.state.phase = 'live';
    rounds.state.timer = 87;
    player.reset(-2, 6);
    player.state.yaw = Math.PI;
    settle(30);
    // Stage one visible enemy mid-lane and aim at it, then fire once so
    // the muzzle flash, tracer and hitmarker are in the frame.
    const enemy = bots.list.find((b) => b.team === 'slate' && b.alive);
    if (enemy) {
      enemy.group.position.set(0.5, 0, -6);
      enemy.group.rotation.y = 0;
      enemy.group.updateMatrixWorld(true);
    }
    const target = new THREE.Vector3(0.5, 1.3, -6);
    aimAt(target);
    settle(2);
    weapons.give('VK47');
    weapons.equip('VK47');
    shoot();
    settle(1);
  } else if (name === 'buy') {
    startMatch();
    openBuyMenu();
    player.reset(world.spawns.ember[0].x, world.spawns.ember[0].z);
    player.state.yaw = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -8));
  } else if (name === 'end') {
    startMatch();
    hud.closeBuy();
    hud.hideBanner();
    rounds.state.phase = 'live';
    rounds.state.ember = 7;
    rounds.state.slate = 5;
    player.reset(-13, -4);
    player.state.yaw = Math.PI * 0.78;
    settle(30);
    const site = world.sites.A;
    tempVec.set(site.x, 1.4, site.z);
    effects.explosion(tempVec);
    objective.state.planted = true;
    objective.state.site = 'A';
    objective.state.detonateIn = 4;
    hud.showBanner('Spark detonated', 'Ember takes the round', 60000);
    // Face the blast: the explosion and the furnace must be in frame.
    aimAt(new THREE.Vector3(site.x, 1.4, site.z));
    settle(6);
  }
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else {
  hud.showOverlay('menu', {});
  requestAnimationFrame(frame);
}
