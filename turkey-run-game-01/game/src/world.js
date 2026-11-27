// Dinner Is Cancelled — the game's rules and state, with no drawing and no
// browser in it: the turkey, the farmer's suspicion, hide spots, swinging
// knives, ovens, corn and the chef hat, the three acts, score and lives.
// step() advances one fixed step and returns what happened as bit flags, so
// the caller can react without the world knowing about screens or sound.
// Nothing here allocates after createWorld returns.
import {
  ACTS, CORN, ESCAPE_AT, FARMER, FIELD, HAT, HIDE, KNIFE, LIVES, NOISE,
  OVEN, SCORE, STEP, SUSPICION, TURKEY,
} from './config.js';

export const KIND_HAY = 0;
export const KIND_CRATE = 1;
export const KIND_TABLE = 2;

export const EVENT_HIT = 1;
export const EVENT_CORN = 2;
export const EVENT_OVER = 4;
export const EVENT_SPOTTED = 8;
export const EVENT_HIDDEN = 16;
export const EVENT_CAUGHT = 32;
export const EVENT_ESCAPED = 64;
export const EVENT_STAGE = 128;
export const EVENT_HAT = 256;

const AHEAD = 1700;
const BEHIND = 900;

function boxHits(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function circleHitsBox(cx, cy, r, b) {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.width));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.height));
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

export function createWorld(random) {
  const turkey = {
    x: 60, y: FIELD.groundY - TURKEY.height, vy: 0,
    width: TURKEY.width, height: TURKEY.height,
    onGround: true, ducked: false, hold: 0, invulnerable: 0, disguised: 0,
  };
  const farmer = {
    x: turkey.x - FARMER.startBehind, mode: 'patrol', hesitate: 0,
    lastSeen: turkey.x, searchWait: 0, facing: 1,
  };
  const hides = [];
  const knives = [];
  const ovens = [];
  const corn = [];
  const hat = { x: HAT.atMetre * FIELD.pxPerMetre, taken: false };
  const state = {
    turkey, farmer, hides, knives, ovens, corn, hat,
    suspicion: 0, noise: 0, score: 0, bonus: 0,
    lives: LIVES, act: 0, elapsed: 0, escaped: false, over: false,
    frontier: 0, wasHidden: false, wasSpotted: false,
  };

  function actAt(metres) {
    let act = 0;
    for (let i = 0; i < ACTS.length; i += 1) if (metres >= ACTS[i].at) act = i;
    return act;
  }

  function metres() {
    return turkey.x / FIELD.pxPerMetre;
  }

  function reset() {
    turkey.x = 60;
    turkey.y = FIELD.groundY - TURKEY.height;
    turkey.vy = 0;
    turkey.onGround = true;
    turkey.ducked = false;
    turkey.hold = 0;
    turkey.invulnerable = 0;
    turkey.disguised = 0;
    farmer.x = turkey.x - FARMER.startBehind;
    farmer.mode = 'patrol';
    farmer.hesitate = 0;
    farmer.lastSeen = turkey.x;
    farmer.searchWait = 0;
    farmer.facing = 1;
    hides.length = 0;
    knives.length = 0;
    ovens.length = 0;
    corn.length = 0;
    hat.taken = false;
    state.suspicion = 0;
    state.noise = 0;
    state.bonus = 0;
    state.score = 0;
    state.lives = LIVES;
    state.act = 0;
    state.elapsed = 0;
    state.escaped = false;
    state.over = false;
    state.frontier = 0;
    state.wasHidden = false;
    state.wasSpotted = false;
    seedAhead();
  }

  function seedAhead() {
    // Lay the first stretch of the farmyard before the turkey starts running.
    let x = 500;
    while (x < turkey.x + AHEAD) {
      placeHide(x);
      x += HIDE.spacing + random() * HIDE.spacingJitter;
    }
    x = 700;
    while (x < turkey.x + AHEAD) {
      knives.push({ x, phase: random() * Math.PI * 2 });
      x += KNIFE.spacing + random() * KNIFE.spacingJitter;
    }
    x = 420;
    while (x < turkey.x + AHEAD) {
      corn.push({ x, y: FIELD.groundY - 24, golden: random() < CORN.goldenChance, active: true });
      x += CORN.spacing + random() * CORN.spacingJitter;
    }
    state.frontier = turkey.x + AHEAD;
  }

  function placeHide(x) {
    hides.push({ x, width: HIDE.width, kind: actAt(x / FIELD.pxPerMetre) });
  }

  function extend() {
    const edge = turkey.x + AHEAD;
    while (state.frontier < edge) {
      const x = state.frontier + 120 + random() * 200;
      const roll = random();
      if (roll < 0.4) placeHide(x);
      else if (roll < 0.7) knives.push({ x, phase: random() * Math.PI * 2 });
      else corn.push({ x, y: FIELD.groundY - 24, golden: random() < CORN.goldenChance, active: true });
      if (actAt(x / FIELD.pxPerMetre) === 2 && random() < 0.5) {
        ovens.push({ x: x + 200, timer: random() * OVEN.cycle, blasting: false, warning: false });
      }
      state.frontier = x + 100;
    }
    const cut = turkey.x - BEHIND;
    for (const list of [hides, knives, ovens, corn]) {
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].x < cut) list.splice(i, 1);
    }
  }

  function turkeyBox() {
    if (turkey.ducked) {
      // Ducked, the turkey sits low on the ground: its top is the ground
      // minus its ducked height, not the standing top.
      return { x: turkey.x, y: FIELD.groundY - TURKEY.duckHeight, width: turkey.width, height: TURKEY.duckHeight };
    }
    return {
      x: turkey.x, y: turkey.y,
      width: turkey.width, height: TURKEY.height,
    };
  }

  function hiddenNow() {
    if (!turkey.ducked) return false;
    const box = turkeyBox();
    for (const h of hides) {
      if (box.x + box.width > h.x + 14 && box.x < h.x + h.width - 14) return true;
    }
    return false;
  }

  function knifeTip(k) {
    const angle = Math.sin(state.elapsed * KNIFE.swingSpeed + k.phase) * KNIFE.swing;
    const pivotY = FIELD.groundY - 240;
    return {
      x: k.x + Math.sin(angle) * 195,
      y: pivotY + Math.cos(angle) * 195,
      angle,
    };
  }

  function hurt(events) {
    if (turkey.invulnerable > 0) return events;
    state.lives -= 1;
    turkey.invulnerable = TURKEY.grace;
    events |= EVENT_HIT;
    if (state.lives <= 0) {
      state.over = true;
      events |= EVENT_OVER;
    }
    return events;
  }

  function respawn() {
    const start = ACTS[state.act].at * FIELD.pxPerMetre + 50;
    turkey.x = Math.max(60, start);
    turkey.y = FIELD.groundY - TURKEY.height;
    turkey.vy = 0;
    turkey.onGround = true;
    turkey.ducked = false;
    turkey.invulnerable = TURKEY.grace;
    farmer.x = turkey.x - FARMER.startBehind;
    farmer.mode = 'patrol';
    farmer.hesitate = 0;
    state.suspicion = 20;
  }

  /**
   * One fixed step. `move` is { dir: -1|0|1, duck: bool, jump: bool }.
   * With `harmless` set (the title screen's backdrop) things move but nothing
   * touches the turkey and nothing scores.
   */
  function step(dt, move, harmless) {
    let events = 0;
    if (state.over) return events;
    state.elapsed += dt;

    // The turkey: hold a direction to build from a walk to a sprint; a duck
    // stops it dead; a jump leaves the ground only from the ground.
    const dir = move.dir || 0;
    turkey.hold = dir !== 0 ? turkey.hold + dt : 0;
    const ramp = Math.min(1, turkey.hold / TURKEY.sprintRamp);
    const speed = TURKEY.walkSpeed + (TURKEY.sprintSpeed - TURKEY.walkSpeed) * ramp;
    turkey.ducked = !!move.duck && turkey.onGround;
    if (!turkey.ducked) turkey.x = Math.max(0, turkey.x + dir * speed * dt);
    if (move.jump && turkey.onGround && !turkey.ducked) {
      turkey.vy = -TURKEY.jumpSpeed;
      turkey.onGround = false;
    }
    if (!turkey.onGround) {
      turkey.vy += TURKEY.gravity * dt;
      turkey.y += turkey.vy * dt;
      if (turkey.y >= FIELD.groundY - TURKEY.height) {
        turkey.y = FIELD.groundY - TURKEY.height;
        turkey.vy = 0;
        turkey.onGround = true;
        state.noise = Math.min(1, state.noise + NOISE.landingThump);
      }
    }
    if (turkey.invulnerable > 0) turkey.invulnerable = Math.max(0, turkey.invulnerable - dt);
    if (turkey.disguised > 0) turkey.disguised = Math.max(0, turkey.disguised - dt);

    // Noise follows the feet: sprinting is loud, creeping is quiet.
    const target = turkey.ducked ? 0 : (speed / TURKEY.sprintSpeed) * (dir !== 0 ? 1 : 0);
    state.noise += (target - state.noise) * Math.min(1, dt * 2);
    if (!harmless) state.noise = Math.max(0, state.noise - NOISE.decay * dt * 0.2);

    const hidden = hiddenNow();
    const gap = turkey.x - farmer.x;
    const seen = !hidden && gap > -40 && gap < 600;
    if (!harmless) {
      if (seen) {
        const rate = dir !== 0 && ramp > 0.6 ? SUSPICION.seenRunning : dir !== 0 ? SUSPICION.seenWalking : SUSPICION.seenStill;
        // A far-off turkey is a shape in the distance: suspicion climbs
        // slowly, and only up close does he see it clearly.
        const near = gap < 300 ? 1 : 0.5;
        state.suspicion = Math.min(100, state.suspicion + rate * near * dt);
        farmer.lastSeen = turkey.x;
      } else if (hidden) {
        state.suspicion = Math.max(0, state.suspicion - SUSPICION.hiddenFall * dt);
      } else {
        state.suspicion = Math.max(0, state.suspicion - SUSPICION.farFall * dt);
      }
    }

    // The farmer: hesitates at a chef hat, chases when sure, searches when
    // the trail goes cold, otherwise patrols toward the turkey.
    if (farmer.hesitate > 0) {
      farmer.hesitate = Math.max(0, farmer.hesitate - dt);
      farmer.mode = 'hesitate';
    } else if (state.suspicion >= FARMER.chaseAt) {
      farmer.mode = 'chase';
    } else if (state.suspicion >= FARMER.noticeAt) {
      farmer.mode = 'patrol';
    } else if (farmer.mode === 'chase' || farmer.mode === 'search') {
      farmer.mode = 'search';
    } else {
      farmer.mode = 'patrol';
    }
    if (farmer.mode === 'chase') {
      farmer.x += FARMER.chaseSpeed * dt;
      farmer.facing = 1;
    } else if (farmer.mode === 'patrol') {
      // On the trail: while the turkey is far ahead the farmer runs to
      // close the distance, then settles to a patrol. He is always a
      // presence behind the turkey, never a speck left miles back.
      const closing = gap > 800 ? 300 : FARMER.patrolSpeed;
      farmer.x += closing * dt;
      farmer.facing = 1;
    } else if (farmer.mode === 'search') {
      const d = farmer.lastSeen - farmer.x;
      if (Math.abs(d) > 30) {
        farmer.x += Math.sign(d) * FARMER.searchSpeed * dt;
        farmer.facing = Math.sign(d);
      } else {
        farmer.searchWait += dt;
        if (farmer.searchWait > 1.5) {
          farmer.searchWait = 0;
          farmer.lastSeen = farmer.x + (random() < 0.5 ? -260 : 260);
        }
      }
    }
    if (farmer.x > turkey.x + 40) farmer.x = turkey.x + 40;

    // Spotted and hidden are moments, not states: flag the crossing.
    const spotted = state.suspicion >= FARMER.chaseAt;
    if (spotted && !state.wasSpotted) events |= EVENT_SPOTTED;
    state.wasSpotted = spotted;
    if (hidden && !state.wasHidden) events |= EVENT_HIDDEN;
    state.wasHidden = hidden;

    // Caught: the farmer closes the gap while the turkey is in the open.
    if (!harmless && !hidden && gap < FARMER.catchGap && gap > -FARMER.catchGap && turkey.invulnerable === 0) {
      state.lives -= 1;
      events |= EVENT_CAUGHT;
      if (state.lives <= 0) {
        state.over = true;
        events |= EVENT_OVER;
        return events;
      }
      respawn();
    }

    // Swinging knives: the blade tip is the danger; a ducked turkey is low
    // enough to pass under the bottom of the arc.
    if (!harmless) {
      const box = turkeyBox();
      for (const k of knives) {
        const tip = knifeTip(k);
        if (circleHitsBox(tip.x, tip.y, 14, box)) {
          events = hurt(events);
          if (state.over) return events;
          break;
        }
      }
    }

    // Ovens (kitchen act): a glowing warning, then a column of heat. The
    // oven is solid on the ground; time the jump between blasts.
    const box = turkeyBox();
    for (const o of ovens) {
      o.timer += dt;
      const phase = o.timer % OVEN.cycle;
      o.warning = phase < OVEN.warn;
      o.blasting = phase >= OVEN.warn && phase < OVEN.warn + OVEN.blast;
      if (harmless) continue;
      const overlapsOven = box.x + box.width > o.x && box.x < o.x + OVEN.width;
      if (overlapsOven && box.y + box.height > FIELD.groundY - OVEN.height) {
        // Standing on the oven's ground: it blocks the way, so shove back.
        if (turkey.onGround && box.y + box.height >= FIELD.groundY - 2) {
          turkey.x = Math.min(turkey.x, o.x - box.width);
        }
      }
      if (o.blasting && overlapsOven) {
        events = hurt(events);
        if (state.over) return events;
      }
    }

    // Corn and the chef hat.
    if (!harmless) {
      for (const c of corn) {
        if (!c.active) continue;
        if (boxHits(box, { x: c.x - 12, y: c.y - 12, width: 24, height: 24 })) {
          c.active = false;
          state.bonus += c.golden ? CORN.goldenPoints : CORN.points;
          events |= EVENT_CORN;
        }
      }
      if (!hat.taken && boxHits(box, { x: hat.x - 14, y: FIELD.groundY - 44, width: 28, height: 44 })) {
        hat.taken = true;
        turkey.disguised = HAT.disguiseSeconds;
        farmer.hesitate = FARMER.hesitate;
        state.bonus += SCORE.hatBonus;
        events |= EVENT_HAT;
      }
    }

    // Acts and the escape.
    const now = actAt(metres());
    if (now !== state.act) {
      state.act = now;
      if (!harmless) {
        state.bonus += SCORE.stageBonus;
        events |= EVENT_STAGE;
      }
    }
    state.score = Math.floor(metres()) * SCORE.perMetre + state.bonus;
    if (!harmless && metres() >= ESCAPE_AT) {
      state.escaped = true;
      state.over = true;
      events |= EVENT_ESCAPED | EVENT_OVER;
      return events;
    }

    extend();
    return events;
  }

  reset();
  return { state, reset, step, metres, hiddenNow, knifeTip };
}
