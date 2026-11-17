// EMBERLINE input — keyboard + mouse behind pointer lock. The game owns two key
// sets: `keys` (held right now) and `pressed` (went down since the last frame, so
// one press is never read twice). Main calls endFrame() once per frame.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, pressed, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };

  function clearTransient() {
    keys.clear();
    pressed.clear();
    state.firing = false;
    state.aiming = false;
  }

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'Space') event.preventDefault();
    keys.add(event.code);
    pressed.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', clearTransient);
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) clearTransient();
    if (typeof onLockChange === 'function') onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      const result = canvas.requestPointerLock();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    endFrame() {
      pressed.clear();
    },
  };
}
