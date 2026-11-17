// EMBERLINE characters — box-built humanoids, ~1.75 m, one per bot/teammate.
// Team colours come from palette.js only. The head is a separate mesh with
// userData.part = 'head' so hitscan can award the headshot bonus; torso and
// limbs are separate hitboxes too. No per-frame allocation: setBotPose only
// writes positions / rotations / scales.
//
// Local forward is +Z; main/bots rotate group.rotation.y to face travel.

import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Shared materials, built once per team — characters reuse them.
const MATERIALS = {};

function teamMaterials(team) {
  if (MATERIALS[team]) return MATERIALS[team];
  const isEmber = team === 'ember';
  const mats = {
    torso: new THREE.MeshStandardMaterial({
      color: isEmber ? PALETTE.ember : PALETTE.slate, roughness: 0.75, metalness: 0.15,
    }),
    limbs: new THREE.MeshStandardMaterial({
      color: isEmber ? PALETTE.canvas : PALETTE.slateDark, roughness: 0.85, metalness: 0.1,
    }),
    head: new THREE.MeshStandardMaterial({
      color: isEmber ? PALETTE.emberDark : PALETTE.slateDark, roughness: 0.7, metalness: 0.2,
    }),
    visor: new THREE.MeshStandardMaterial({
      color: isEmber ? PALETTE.furnace : PALETTE.slate,
      emissive: isEmber ? PALETTE.furnace : PALETTE.slate,
      emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1,
    }),
    gun: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.45, metalness: 0.7 }),
    accent: new THREE.MeshStandardMaterial({
      color: isEmber ? PALETTE.accent : PALETTE.ink, roughness: 0.6, metalness: 0.2,
    }),
  };
  MATERIALS[team] = mats;
  return mats;
}

// Box geometry with its origin moved to the top face, so a mesh positioned at
// a joint (hip/shoulder) rotates and scales around that joint.
function jointBox(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, -h / 2, 0);
  return geo;
}

export function createCharacterMesh(team) {
  const mats = teamMaterials(team);
  const group = new THREE.Group();
  group.name = `character-${team}`;

  const hitMeshes = [];
  function register(mesh, part) {
    mesh.userData.part = part;
    mesh.castShadow = true;
    hitMeshes.push({ mesh, part });
    return mesh;
  }

  // Legs — hip pivots at y = 0.8, feet on the ground.
  const legGeo = jointBox(0.17, 0.8, 0.2);
  const legL = new THREE.Mesh(legGeo, mats.limbs);
  legL.position.set(-0.11, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, mats.limbs);
  legR.position.set(0.11, 0.8, 0);
  register(legL, 'limbs');
  register(legR, 'limbs');
  group.add(legL, legR);

  // Torso — 0.8 to 1.42.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.3), mats.torso);
  torso.position.set(0, 1.11, 0);
  register(torso, 'torso');
  group.add(torso);

  // Chest plate stripe (team accent, visual only — not a hitbox).
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.02), mats.accent);
  plate.position.set(0, 1.28, 0.16);
  group.add(plate);

  // Arms — shoulder pivots at y = 1.38, hanging at the sides.
  const armGeo = jointBox(0.13, 0.58, 0.15);
  const armL = new THREE.Mesh(armGeo, mats.limbs);
  armL.position.set(-0.34, 1.38, 0);
  const armR = new THREE.Mesh(armGeo, mats.limbs);
  armR.position.set(0.34, 1.38, 0);
  register(armL, 'limbs');
  register(armR, 'limbs');
  group.add(armL, armR);

  // Head — 1.43 to 1.69, plus a helmet slab taking the silhouette to 1.75.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.26, 0.27), mats.head);
  head.position.set(0, 1.56, 0);
  register(head, 'head');
  group.add(head);

  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.07, 0.31), mats.head);
  helmet.position.set(0, 1.72, 0);
  helmet.castShadow = true;
  group.add(helmet);

  // Visor strip across the front of the head (+Z face).
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.02), mats.visor);
  visor.position.set(0, 1.58, 0.145);
  group.add(visor);

  // Gun — held forward from the right shoulder, barrel along +Z.
  const gun = new THREE.Group();
  gun.name = 'gun';
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.34), mats.gun);
  receiver.castShadow = true;
  gun.add(receiver);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), mats.gun);
  barrel.position.set(0, 0.02, 0.3);
  gun.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.08), mats.gun);
  grip.position.set(0, -0.13, -0.02);
  gun.add(grip);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.16), mats.limbs);
  stock.position.set(0, 0, -0.24);
  gun.add(stock);
  gun.position.set(0.16, 1.26, 0.32);
  group.add(gun);

  // Base pose values, so setBotPose can crouch/aim without allocating.
  const c = {
    group,
    head,
    torso,
    legL,
    legR,
    armL,
    armR,
    gun,
    height: 1.75,
    hitMeshes,
    _base: {
      hipY: 0.8,
      torsoY: 1.11,
      headY: 1.56,
      helmetY: 1.72,
      visorY: 1.58,
      plateY: 1.28,
      armY: 1.38,
      gunY: 1.26,
      gunX: 0.16,
      gunZ: 0.32,
    },
    _helmet: helmet,
    _visor: visor,
    _plate: plate,
  };
  return c;
}

// Cheap pose switch: only writes positions, rotations and scales.
// crouch: hips drop 0.28 m, legs shorten to keep feet on the ground.
// aiming: gun rises toward the eyeline and both arms swing forward onto it.
export function setBotPose(c, pose) {
  const b = c._base;
  const drop = pose.crouch ? 0.28 : 0;
  const hipY = b.hipY - drop;
  const legScale = pose.crouch ? hipY / b.hipY : 1;

  c.legL.position.y = hipY;
  c.legR.position.y = hipY;
  c.legL.scale.y = legScale;
  c.legR.scale.y = legScale;

  c.torso.position.y = b.torsoY - drop;
  c.head.position.y = b.headY - drop;
  c._helmet.position.y = b.helmetY - drop;
  c._visor.position.y = b.visorY - drop;
  c._plate.position.y = b.plateY - drop;
  c.armL.position.y = b.armY - drop;
  c.armR.position.y = b.armY - drop;

  if (pose.aiming) {
    c.gun.position.set(0.1, b.gunY - drop + 0.12, b.gunZ - 0.04);
    c.gun.rotation.x = -0.05;
    c.armL.rotation.x = -1.15;
    c.armR.rotation.x = -1.15;
  } else {
    c.gun.position.set(b.gunX, b.gunY - drop, b.gunZ);
    c.gun.rotation.x = 0;
    c.armL.rotation.x = 0;
    c.armR.rotation.x = 0;
  }
}
