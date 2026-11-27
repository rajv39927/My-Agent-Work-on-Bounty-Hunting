// Keyboard and pointer input. Held keys steer; one-shot presses (jump,
// start or restart, pause) are queued as bit flags and taken once by the
// loop, so a press between two frames is never lost and never counted twice.
// Ducking is a held key, not a flag: the turkey stays low while it is held.
export const ACT_JUMP = 1;
export const ACT_CONFIRM = 2;
export const ACT_PAUSE = 4;
export const ACT_MUTE = 8;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const DUCK = new Set(['ArrowDown', 'KeyS']);
const JUMP = new Set(['Space', 'ArrowUp', 'KeyW']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);

export function createInput(target) {
  let left = false;
  let right = false;
  let duck = false;
  let acts = 0;

  function releaseAll() {
    left = false;
    right = false;
    duck = false;
  }

  window.addEventListener('keydown', (event) => {
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (DUCK.has(event.code)) duck = true;
    else if (JUMP.has(event.code)) {
      if (!event.repeat) acts |= ACT_JUMP | ACT_CONFIRM;
    } else if (CONFIRM.has(event.code)) {
      if (!event.repeat) acts |= ACT_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) acts |= ACT_PAUSE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) acts |= ACT_MUTE;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (DUCK.has(event.code)) duck = false;
  });
  // A key released while the tab is hidden never sends keyup.
  window.addEventListener('blur', releaseAll);
  target.addEventListener('pointerdown', () => {
    acts |= ACT_CONFIRM;
  });

  return {
    /** -1 for left, 1 for right, 0 for neither or both. */
    direction() {
      return (right ? 1 : 0) - (left ? 1 : 0);
    },
    ducking() {
      return duck;
    },
    /** The one-shot presses since the last call, as ACT_* flags. */
    takeActs() {
      const taken = acts;
      acts = 0;
      return taken;
    },
  };
}
