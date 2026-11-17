// EMBERLINE player movement — acceleration, friction, gravity, crouch and jump,
// resolved as an upright box against the world's colliders one axis at a time so a
// wall can stop the player sideways without swallowing them whole.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.62;
const CROUCH_EYE = 1.05;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const JUMP_SPEED = 6.4;
const GRAVITY = 21;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const MAX_FALL = 30;
const PITCH_LIMIT = 1.45;
const LOOK_SENSITIVITY = 0.0022;

export function createPlayer(colliders, spawn) {
  const player = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  // The probe is lifted a little off the floor for the horizontal tests, so standing
  // on the ground is never read as walking into a wall.
  function hitBox(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i++) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function look(dx, dy) {
    player.yaw -= dx * LOOK_SENSITIVITY;
    player.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, player.pitch - dy * LOOK_SENSITIVITY));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(PITCH_LIMIT, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !player.crouching) {
      player.crouching = true;
      player.height = CROUCH_HEIGHT;
    } else if (!wantCrouch && player.crouching) {
      // Only stand back up when the taller box fits where the player stands.
      if (!hitBox(player.position.x, player.position.y, player.position.z, STAND_HEIGHT, 0.02)) {
        player.crouching = false;
        player.height = STAND_HEIGHT;
      }
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward !== 0 || strafe !== 0) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = player.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const blend = Math.min(1, (accel * dt) / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = JUMP_SPEED;
      player.onGround = false;
    }
    player.velocity.y -= GRAVITY * dt;
    if (player.velocity.y < -MAX_FALL) player.velocity.y = -MAX_FALL;

    const nextX = player.position.x + player.velocity.x * dt;
    if (!hitBox(nextX, player.position.y, player.position.z, player.height, 0.04)) {
      player.position.x = nextX;
    } else {
      player.velocity.x = 0;
    }
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!hitBox(player.position.x, player.position.y, nextZ, player.height, 0.04)) {
      player.position.z = nextZ;
    } else {
      player.velocity.z = 0;
    }

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = hitBox(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
  }

  return {
    state: player,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
    reset(x, z) {
      player.position.set(x, 0, z);
      player.velocity.set(0, 0, 0);
      player.yaw = 0;
      player.pitch = 0;
      player.eye = STAND_EYE;
      player.onGround = true;
      player.crouching = false;
      player.height = STAND_HEIGHT;
    },
  };
}
