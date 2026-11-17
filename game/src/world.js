// EMBERLINE world — "Emberworks" foundry, 44 x 30 m.
// Perimeter walls, three lanes, two bomb sites, cover, waypoint graph,
// procedural canvas textures, and the scene lighting. Ground level only.
//
// Returned by createWorld(scene):
//   group, colliders (Box3[]), shootables (Mesh[]),
//   spawns { ember: 5 x {x,z}, slate: 5 x {x,z} },
//   sites { A: {x,z,r,name}, B: {x,z,r,name} },
//   waypoints [{id,x,z,links}], nearestWaypoint(x,z), findPath(aId,bId),
//   bounds {minX,maxX,minZ,maxZ}, siteMarkers {A: Mesh, B: Mesh}.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

// ---------------------------------------------------------------------------
// Local deterministic random (textures + scatter), so the map looks the same
// every load. Not the injected mulberry32 — this is build-time only.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BOUNDS = { minX: -22, maxX: 22, minZ: -15, maxZ: 15 };
const WALL_H = 5;

const SITES = {
  A: { x: -16, z: -9, r: 4.5, name: 'Furnace' },
  B: { x: 16, z: -9, r: 4.5, name: 'Crane Yard' },
};

// ---------------------------------------------------------------------------
// Procedural canvas textures
// ---------------------------------------------------------------------------
function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function concreteTexture() {
  const rand = mulberry32(1337);
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.floor;
    ctx.fillRect(0, 0, s, s);
    // Speckle noise.
    for (let i = 0; i < 5200; i++) {
      const v = rand();
      ctx.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(242,232,213,0.05)';
      ctx.fillRect(rand() * s, rand() * s, 1 + rand() * 2, 1 + rand() * 2);
    }
    // Expansion-joint grid.
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * s;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(s, p); ctx.stroke();
    }
    // Faint oil stains.
    for (let i = 0; i < 7; i++) {
      const gx = rand() * s, gy = rand() * s, gr = 14 + rand() * 30;
      const g = ctx.createRadialGradient(gx, gy, 2, gx, gy, gr);
      g.addColorStop(0, 'rgba(0,0,0,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI * 2); ctx.fill();
    }
  }, 11, 8);
}

function hazardTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#1c1712';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = PALETTE.hazard;
    for (let i = -s; i < s * 2; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, s); ctx.lineTo(i + 16, 0);
      ctx.lineTo(i + 32, 0); ctx.lineTo(i + 16, s);
      ctx.closePath(); ctx.fill();
    }
  }, 4, 1);
}

function metalTexture() {
  const rand = mulberry32(777);
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.metal;
    ctx.fillRect(0, 0, s, s);
    // Panel seams.
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, s - 8, s - 8);
    ctx.beginPath(); ctx.moveTo(s / 2, 0); ctx.lineTo(s / 2, s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
    // Rivets.
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const riv = [16, s / 2, s - 16];
    for (const rx of riv) for (const ry of riv) {
      ctx.beginPath(); ctx.arc(rx, ry, 4, 0, Math.PI * 2); ctx.fill();
    }
    // Wear streaks.
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,154,46,0.04)';
      ctx.fillRect(rand() * s, rand() * s, 1 + rand() * 3, 6 + rand() * 22);
    }
  }, 1, 1);
}

function letterSpriteTexture(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = 'rgba(23,19,15,0.72)';
  ctx.beginPath(); ctx.arc(64, 64, 58, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Waypoint graph — hand-placed nodes on the three lanes, sites and spawns.
// Columns x = -18 / -9 / 0 / 9 / 18, rows z = 12 / 4 / -4, plus site rows.
// ---------------------------------------------------------------------------
const WAYPOINT_DEFS = [
  // id, x, z, links
  [0, -16, 12, [1, 5]],
  [1, -8, 12, [0, 2, 6]],
  [2, 0, 12, [1, 3, 7]],
  [3, 8, 12, [2, 4, 8]],
  [4, 16, 12, [3, 9]],
  [5, -18, 4, [0, 6, 10]],
  [6, -9, 4, [1, 5, 7, 11]],
  [7, 0, 4, [2, 6, 8, 12]],
  [8, 9, 4, [3, 7, 9, 13]],
  [9, 18, 4, [4, 8, 14]],
  [10, -18, -4, [5, 11, 15]],
  [11, -9, -4, [6, 10, 12, 16]],
  [12, 0, -4, [7, 11, 13, 19]],
  [13, 9, -4, [8, 12, 14, 17]],
  [14, 18, -4, [9, 13, 18]],
  [15, -16, -9, [10, 16, 20]], // Site A
  [16, -9, -9, [11, 15, 17, 19]],
  [17, 9, -9, [13, 16, 18, 19]],
  [18, 16, -9, [14, 17, 21]], // Site B
  [19, 0, -11, [12, 16, 17, 20, 21]],
  [20, -16, -13, [15, 19]],
  [21, 16, -13, [18, 19]],
];

// ---------------------------------------------------------------------------
// World construction
// ---------------------------------------------------------------------------
export function createWorld(scene) {
  const group = new THREE.Group();
  group.name = 'Emberworks';
  const colliders = [];
  const shootables = [];

  const concreteTex = concreteTexture();
  const metalTex = metalTexture();
  const hazardTex = hazardTexture();

  const floorMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.95, metalness: 0.05 });
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9, metalness: 0.08 });
  const metalMat = new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.55, metalness: 0.55 });
  const crateMat = new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.85, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1c1712', roughness: 0.9, metalness: 0.2 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8, metalness: 0.1 });
  const furnaceMat = new THREE.MeshStandardMaterial({
    color: '#2b1408', emissive: PALETTE.furnace, emissiveIntensity: 0.9, roughness: 0.6, metalness: 0.3,
  });
  const glowMat = new THREE.MeshStandardMaterial({
    color: PALETTE.furnace, emissive: PALETTE.furnace, emissiveIntensity: 2.4, roughness: 0.4,
  });

  // Shared geometry cache — boxes reuse one unit geometry, scaled per mesh.
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  function addBox(w, h, d, x, y, z, mat, opts = {}) {
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    if (opts.rotY) mesh.rotation.y = opts.rotY;
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = true;
    mesh.updateMatrixWorld(true);
    group.add(mesh);
    if (opts.collide !== false) {
      const box = new THREE.Box3();
      box.setFromObject(mesh);
      colliders.push(box);
    }
    if (opts.shoot !== false) shootables.push(mesh);
    return mesh;
  }

  // --- Floor ---------------------------------------------------------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 30), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  // --- Perimeter walls (h = 5) ----------------------------------------------
  // North (z = -15), south (z = +15), west (x = -22), east (x = +22).
  addBox(45, WALL_H, 1, 0, WALL_H / 2, -15.5, wallMat);
  addBox(45, WALL_H, 1, 0, WALL_H / 2, 15.5, wallMat);
  addBox(1, WALL_H, 31, -22.5, WALL_H / 2, 0, wallMat);
  addBox(1, WALL_H, 31, 22.5, WALL_H / 2, 0, wallMat);

  // Hazard skirt along the base of the north wall, between the two sites.
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(20, 0.35, 0.12), hazardMat);
  skirt.position.set(0, 0.18, -14.9);
  skirt.receiveShadow = true;
  group.add(skirt);

  // --- Site A: furnace (west-north) -----------------------------------------
  // Big furnace block against the north-west corner, mouth glowing toward mid.
  addBox(5.5, 4.2, 3.2, -19.5, 2.1, -13.2, furnaceMat);
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), glowMat);
  mouth.position.set(-16.6, 1.5, -13.2);
  mouth.rotation.y = Math.PI / 2;
  group.add(mouth);
  // Furnace chimney rising through the roof line.
  addBox(1.4, 3.4, 1.4, -20.6, 5.4, -13.8, darkMat, { collide: false, shoot: false });

  // --- Site B: crane gantry (east-north) ------------------------------------
  // Two legs + top beam spanning the site, hook block hanging mid-span.
  addBox(0.9, 5, 0.9, 13.4, 2.5, -12.4, metalMat);
  addBox(0.9, 5, 0.9, 18.6, 2.5, -12.4, metalMat);
  addBox(6.4, 0.8, 1.0, 16, 4.9, -12.4, metalMat, { collide: false });
  addBox(0.8, 0.9, 0.8, 16, 4.1, -12.4, darkMat, { collide: false });
  // Crane cable + hook, hanging above the site floor.
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), darkMat);
  cable.position.set(16, 3.3, -12.4);
  group.add(cable);
  addBox(0.5, 0.5, 0.5, 16, 2.4, -12.4, hazardMat, { collide: false });

  // --- Pillars ---------------------------------------------------------------
  const pillarSpots = [[-9, 8], [9, 8], [-9, -6.5], [9, -6.5], [-18, 8], [18, 8]];
  for (const [px, pz] of pillarSpots) {
    addBox(0.9, WALL_H, 0.9, px, WALL_H / 2, pz, metalMat);
  }

  // --- Crates (~1.1 m) — west long hall, mid, east yard ----------------------
  const crateSpots = [
    [-13.5, 8, 1.1], [-12.2, 8, 1.1], [-13.0, 8, 1.1], // west hall stack (one on top)
    [13.5, 8, 1.1], [14.8, 8, 1.1],
    [-2.2, 0.5, 1.1], [-0.9, -0.4, 1.1], [-1.6, 0.2, 1.1], // mid cluster
    [5.5, 0.8, 1.1],
    [13.8, -0.5, 1.1], [15.1, 0.4, 1.1],
    [-5.5, -6, 1.1], [5.5, -6, 1.1],
  ];
  // The third west crate sits on top of the first two (y offset handled below).
  for (let i = 0; i < crateSpots.length; i++) {
    const [cx, cz, s] = crateSpots[i];
    const y = i === 2 ? s * 1.5 : s / 2;
    addBox(s, s, s, cx, y, cz, crateMat);
  }

  // --- Containers (~2.6 m) — long cover on each side of mid ------------------
  addBox(2.4, 2.6, 4.6, -13.5, 1.3, -1.5, metalMat);
  addBox(2.4, 2.6, 4.6, 13.5, 1.3, -1.5, metalMat);
  // Container lids in hazard stripes so they read as cover at a glance.
  addBox(2.5, 0.18, 4.7, -13.5, 2.68, -1.5, hazardMat, { collide: false });
  addBox(2.5, 0.18, 4.7, 13.5, 2.68, -1.5, hazardMat, { collide: false });

  // --- Solid blocks — low mid walls + north cover -----------------------------
  addBox(6.5, 1.2, 0.8, 0, 0.6, 8.5, wallMat); // mid-south low wall
  addBox(3.2, 1.2, 0.8, -4.5, 0.6, -6, wallMat);
  addBox(3.2, 1.2, 0.8, 4.5, 0.6, -6, wallMat);
  addBox(2.0, 2.2, 1.0, -20.8, 1.1, -4, darkMat); // west mid block (clear of the x=-18 lane)
  addBox(2.0, 2.2, 1.0, 20.8, 1.1, -4, darkMat); // east mid block (clear of the x=18 lane)
  // Forge ingot stacks flanking the furnace mouth.
  addBox(1.6, 0.9, 1.6, -17.5, 0.45, -11.2, metalMat);
  addBox(1.6, 0.9, 1.6, -14.6, 0.45, -11.4, metalMat);

  // --- Roof beams (visual only, above the walls) ------------------------------
  for (const bz of [-10, 0, 10]) {
    const beam = new THREE.Mesh(unitBox, darkMat);
    beam.scale.set(44, 0.5, 0.7);
    beam.position.set(0, 5.3, bz);
    group.add(beam);
  }

  // --- Site markers: ground ring + floating letter sprite --------------------
  function makeSiteMarker(siteKey, letter, color) {
    const site = SITES[siteKey];
    const marker = new THREE.Group();
    marker.name = `site-${siteKey}`;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.9, site.r, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.05, site.z);
    marker.add(ring);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: letterSpriteTexture(letter, color), transparent: true, depthWrite: false,
    }));
    sprite.scale.set(2.2, 2.2, 1);
    sprite.position.set(site.x, 3.4, site.z);
    marker.add(sprite);
    marker.userData.ring = ring;
    marker.userData.sprite = sprite;
    group.add(marker);
    return marker;
  }
  const siteMarkers = {
    A: makeSiteMarker('A', 'A', PALETTE.ember),
    B: makeSiteMarker('B', 'B', PALETTE.slate),
  };

  // --- Lighting ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xffe0b8, 0x241a12, 0.9);
  group.add(hemi);

  const key = new THREE.DirectionalLight(0xffc07a, 2.2);
  key.position.set(14, 22, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -26;
  key.shadow.camera.right = 26;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0004;
  group.add(key);
  group.add(key.target);

  const fill = new THREE.DirectionalLight(0x7fa8c9, 0.7);
  fill.position.set(-12, 14, -8);
  group.add(fill);
  group.add(fill.target);

  const furnaceLight = new THREE.PointLight(PALETTE.furnace, 60, 22, 1.8);
  furnaceLight.position.set(-16.4, 2.2, -12.6);
  group.add(furnaceLight);

  const craneLight = new THREE.PointLight(0xbfd9ee, 14, 14, 1.6);
  craneLight.position.set(16, 4.4, -11);
  group.add(craneLight);

  scene.add(group);

  // --- Spawns ------------------------------------------------------------------
  // Ember attacks from the south (z = +13); slate defends from the north.
  const spawns = {
    ember: [
      { x: -16, z: 13 }, { x: -8, z: 13 }, { x: 0, z: 13 },
      { x: 8, z: 13 }, { x: 16, z: 13 },
    ],
    slate: [
      { x: -19, z: -10.5 }, { x: -9.5, z: -13.2 }, { x: 0, z: -13.4 },
      { x: 9.5, z: -13.2 }, { x: 19.5, z: -13.4 },
    ],
  };

  // --- Waypoint graph -----------------------------------------------------------
  const waypoints = WAYPOINT_DEFS.map(([id, x, z, links]) => ({ id, x, z, links: [...links] }));
  const byId = new Map(waypoints.map((w) => [w.id, w]));

  function nearestWaypoint(x, z) {
    let best = waypoints[0];
    let bestD = Infinity;
    for (const w of waypoints) {
      const dx = w.x - x, dz = w.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = w; }
    }
    return best;
  }

  function findPath(aId, bId) {
    if (aId === bId) {
      const w = byId.get(aId);
      return w ? [w] : [];
    }
    const prev = new Map();
    const seen = new Set([aId]);
    const queue = [aId];
    while (queue.length > 0) {
      const cur = queue.shift();
      const node = byId.get(cur);
      if (!node) continue;
      for (const next of node.links) {
        if (seen.has(next)) continue;
        seen.add(next);
        prev.set(next, cur);
        if (next === bId) {
          const path = [byId.get(bId)];
          let step = cur;
          while (step !== aId) {
            path.unshift(byId.get(step));
            step = prev.get(step);
          }
          path.unshift(byId.get(aId));
          return path;
        }
        queue.push(next);
      }
    }
    return [];
  }

  return {
    group,
    colliders,
    shootables,
    spawns,
    sites: SITES,
    waypoints,
    nearestWaypoint,
    findPath,
    bounds: BOUNDS,
    siteMarkers,
  };
}
