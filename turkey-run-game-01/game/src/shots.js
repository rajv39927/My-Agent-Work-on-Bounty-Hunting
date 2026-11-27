// The screenshot scenes behind ?shot=start|play|hide|end. Each one plays the
// real rules forward from a fresh world for a fixed stretch, steered by a
// simple autopilot, so the frame is what a short game really looks like and
// the same seed always gives the same frame. The play pilot runs and ducks
// under knives; the hide pilot creeps until the farmer closes in, then dives
// behind the nearest hay bale; the end pilot plays the whole run to the woods.
import { FIELD, OVEN, STEP, TURKEY } from './config.js';
import { EVENT_OVER } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 5;
const PLAY_CHASE_SECONDS = 60;
const HIDE_LIMIT_SECONDS = 150;
const END_LIMIT_SECONDS = 400;
const SAMPLE = 1 / 30;

/** The autopilot's look-ahead: how far it plans its ducks and jumps. */
const HORIZON_PLAY = 0.7;
const HORIZON_END = 1.2;

function nearestHideAhead(state, x, maxGap) {
  let best = null;
  for (const h of state.hides) {
    const gap = h.x - x;
    if (gap > -40 && gap < maxGap && (best === null || gap < best.x - x)) best = h;
  }
  return best;
}

function lowKnifeNear(world, x, tight) {
  const state = world.state;
  const reach = tight ? 60 : 90;
  const low = tight ? FIELD.groundY - 90 : FIELD.groundY - 75;
  for (const k of state.knives) {
    const tip = world.knifeTip(k);
    if (Math.abs(tip.x - x) < reach && tip.y > low) return true;
  }
  return false;
}

function ovenAhead(state, x, maxGap) {
  for (const o of state.ovens) {
    const gap = o.x - x;
    if (gap > -20 && gap < maxGap) return o;
  }
  return null;
}

/**
 * The run-right pilot, with a memory: a creep clock for inching toward an
 * oven while its blast is on, so the turkey never stands still for the
 * farmer. Rules in order: stay hidden while the farmer is near; when he is
 * running at the turkey, make for the nearest hide; never stop for an oven
 * while chased (a hit costs a life, being caught costs a life and the run);
 * duck under a low blade; time the ovens; otherwise sprint right.
 */
function makeRunPilot() {
  const creep = { clock: 0 };
  return function runPilot(world, horizon) {
    const state = world.state;
    const tk = state.turkey;
    const centre = tk.x + tk.width / 2;
    const farmerGap = tk.x - state.farmer.x;
    const chased = state.farmer.mode === 'chase';

    if (world.hiddenNow() && (state.farmer.mode === 'chase' || farmerGap < 250)) {
      return { dir: 0, duck: true, jump: false };
    }
    if (chased) {
      const hide = nearestHideAhead(state, tk.x, 700);
      if (hide !== null && farmerGap < 500) {
        if (tk.x + tk.width > hide.x + 14 && tk.x < hide.x + hide.width - 14) {
          return { dir: 0, duck: true, jump: false };
        }
        return { dir: 1, duck: false, jump: false };
      }
      if (lowKnifeNear(world, centre, true)) return { dir: 0, duck: true, jump: false };
      const oven = ovenAhead(state, tk.x, 190);
      if (oven !== null && oven.x - tk.x < 110 && !oven.blasting) {
        return { dir: 1, duck: false, jump: true };
      }
      return { dir: 1, duck: false, jump: false };
    }
    if (lowKnifeNear(world, centre, false)) return { dir: 0, duck: true, jump: false };
    const oven = ovenAhead(state, tk.x, 190);
    if (oven !== null) {
      if (oven.blasting || oven.warning) {
        if (farmerGap > 600) return { dir: 0, duck: false, jump: false };
        // Creep: short bursts, so the feet stay slow and the farmer gains
        // little while the blast passes.
        creep.clock += STEP;
        return { dir: creep.clock % 0.6 < 0.3 ? 1 : 0, duck: false, jump: false };
      }
      if (oven.x - tk.x < 110) return { dir: 1, duck: false, jump: true };
    }
    return { dir: 1, duck: false, jump: false };
  };
}

/**
 * The hide pilot: make noise in short sprints so the farmer closes in and
 * notices the turkey, then dive behind the nearest hide spot and stay low.
 * It ducks under low blades just like the run pilot: walking into a knife
 * while creeping would end the scene early.
 */
function hidePilot(world, creeping) {
  const state = world.state;
  const tk = state.turkey;
  const centre = tk.x + tk.width / 2;
  if (lowKnifeNear(world, centre, false)) return { dir: 0, duck: true, jump: false };
  const farmerGap = tk.x - state.farmer.x;
  if (creeping.phase === 0) {
    // Noisy bursts: sprint, pause, sprint — the feet are loud enough for
    // the farmer to notice, and slow enough for him to close the gap.
    creeping.clock += STEP;
    const moving = creeping.clock % 0.9 < 0.55;
    if (farmerGap < 420 || state.farmer.mode === 'chase') creeping.phase = 1;
    return { dir: moving ? 1 : 0, duck: false, jump: false };
  }
  const hide = nearestHideAhead(state, tk.x, 340);
  if (hide === null) return { dir: 1, duck: false, jump: false };
  const inside = tk.x + tk.width > hide.x + 14 && tk.x < hide.x + hide.width - 14;
  if (inside) {
    creeping.phase = 2;
    return { dir: 0, duck: true, jump: false };
  }
  return { dir: 1, duck: false, jump: false };
}

function drive(world, seconds, pilot) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const move = pilot(world);
    const events = world.step(STEP, move, false);
    if (events & EVENT_OVER) return true;
    if (world.state.escaped) return true;
  }
  return false;
}

/**
 * Set `world` to the named scene (start, play, hide or end; any other name
 * is start) and return the screen to draw over it, the best score to show,
 * and whether the frame is the hidden-turkey moment.
 */
export function stageShot(name, world) {
  world.reset();
  if (name !== 'play' && name !== 'hide' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, { dir: 0, duck: false, jump: false }, true);
    return { screen: SCREEN_TITLE, best: 0, hideFocus: false };
  }
  if (name === 'play') {
    // A run in play is best shown with the farmer in frame behind the
    // turkey: drive until he is close enough to see, or the cap runs out.
    const pilot = makeRunPilot();
    const steps = Math.floor(PLAY_CHASE_SECONDS / STEP);
    for (let i = 0; i < steps; i += 1) {
      const events = world.step(STEP, pilot(world, HORIZON_PLAY), false);
      const gap = world.state.turkey.x - world.state.farmer.x;
      if (world.state.elapsed > 5 && gap < 320) break;
      if (events & EVENT_OVER) break;
    }
    const over = world.state.lives === 0;
    return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score, hideFocus: false };
  }
  if (name === 'hide') {
    const creeping = { phase: 0, clock: 0 };
    const steps = Math.floor(HIDE_LIMIT_SECONDS / STEP);
    for (let i = 0; i < steps; i += 1) {
      const move = hidePilot(world, creeping);
      world.step(STEP, move, false);
      const st = world.state;
      // The moment: the turkey is ducked in a hide and the farmer is close
      // enough to be in the frame, still looking for it.
      if (creeping.phase === 2 && world.hiddenNow() && st.turkey.x - st.farmer.x < 320) {
        return { screen: SCREEN_PLAY, best: st.score, hideFocus: true };
      }
      if (st.over) break;
    }
    return { screen: SCREEN_PLAY, best: world.state.score, hideFocus: true };
  }
  drive(world, END_LIMIT_SECONDS, makeRunPilot());
  return { screen: SCREEN_OVER, best: world.state.score, hideFocus: false };
}
