// Dinner Is Cancelled — every tuning number in one place.
// The world is a fixed 1280x720 logical stage; the renderer scales it to the
// window, so no rule below depends on the screen size. One metre is 10 px of
// world: 2400 m of running stands between the turkey and the woods.
export const FIELD = { width: 1280, height: 720, groundY: 620, pxPerMetre: 10 };

/** The simulation's fixed step, in seconds. */
export const STEP = 1 / 60;

/** Distance in metres where each act begins; the last is the escape. */
export const ACTS = [
  { at: 0, name: 'FARMYARD', hide: 'hay' },
  { at: 800, name: 'BARN', hide: 'crate' },
  { at: 1600, name: 'KITCHEN', hide: 'table' },
];
export const ESCAPE_AT = 2400;

export const TURKEY = {
  width: 64,
  height: 46,
  duckHeight: 26,
  walkSpeed: 180,
  sprintSpeed: 340,
  /** Seconds of holding a direction before the turkey is at full sprint. */
  sprintRamp: 1.0,
  jumpSpeed: 620,
  gravity: 1700,
  /** Seconds of grace after a hit during which nothing else can hurt it. */
  grace: 1.5,
};

export const LIVES = 3;

/** The farmer: patrol, chase and search speeds, and the suspicion ladder. */
export const FARMER = {
  startBehind: 520,
  patrolSpeed: 200,
  chaseSpeed: 320,
  searchSpeed: 60,
  /** Suspicion above this: the farmer walks toward the turkey. */
  noticeAt: 35,
  /** Suspicion above this: the farmer runs. */
  chaseAt: 70,
  /** Suspicion below this, while the turkey is hidden: the farmer gives up and searches. */
  giveUpAt: 25,
  /** How close the farmer must get to catch the turkey. */
  catchGap: 54,
  /** Seconds the farmer stands blinking when the turkey wears the chef hat. */
  hesitate: 4,
};

/** Suspicion moves per second. */
export const SUSPICION = {
  seenRunning: 26,
  seenWalking: 14,
  seenStill: 8,
  hiddenFall: 26,
  farFall: 12,
};

/** Noise is 0..1 and follows speed; loud feet bring the farmer. */
export const NOISE = { landingThump: 0.25, decay: 0.5 };

export const KNIFE = {
  /** Knives hang every so many px of world, swinging on a pendulum. */
  spacing: 420,
  spacingJitter: 140,
  /** Blade length and the swing's reach in radians. */
  length: 150,
  swing: 0.85,
  swingSpeed: 2.2,
  swingSpeedPerAct: 0.25,
  bladeWidth: 14,
};

export const OVEN = {
  /** Ovens only appear in the kitchen act, every so many px. */
  spacing: 750,
  width: 110,
  height: 74,
  /** Seconds of glowing warning before the blast, then the blast itself. */
  warn: 0.6,
  blast: 0.8,
  cycle: 3.0,
};

export const CORN = {
  spacing: 260,
  spacingJitter: 160,
  points: 10,
  goldenPoints: 25,
  /** Chance a corn is golden. */
  goldenChance: 0.15,
};

export const HAT = {
  /** Roughly one chef hat per run, early in the kitchen act. */
  atMetre: 1750,
  disguiseSeconds: 4,
};

export const HIDE = {
  /** Hide spots every so many px; a ducked turkey inside one cannot be seen. */
  spacing: 420,
  spacingJitter: 180,
  width: 130,
};

export const SCORE = { perMetre: 1, stageBonus: 500, hatBonus: 25 };

export const PALETTE = {
  backdrop: '#2b1d12',
  farmSkyTop: '#f6b73c',
  farmSkyBottom: '#fbe3a1',
  barnSkyTop: '#c96f2e',
  barnSkyBottom: '#f2c184',
  kitchenSkyTop: '#e8b04b',
  kitchenSkyBottom: '#f7e3bd',
  groundFarm: '#a4713a',
  groundBarn: '#7d5230',
  groundKitchen: '#b98d5f',
  turkeyBody: '#7a4a22',
  turkeyWing: '#5e3618',
  tail: ['#b4551f', '#d2691e', '#e8a33c', '#8a3b12'],
  head: '#d9c7a7',
  wattle: '#d63d2f',
  beak: '#e8a33c',
  farmerShirt: '#3f6fb5',
  farmerOveralls: '#2f4d7d',
  farmerHat: '#e8cf8a',
  farmerSkin: '#e8b98a',
  knifeBlade: '#d7dde6',
  knifeHandle: '#5a3a22',
  ovenBody: '#8d9299',
  ovenGlow: '#ff7a1a',
  corn: '#f2c94c',
  cornHusk: '#5e8a3c',
  hatWhite: '#f5f2ea',
  hudPanel: 'rgba(43, 29, 18, 0.72)',
  hudText: '#fdf3d8',
  hudMuted: '#d9b98a',
  alert: '#d63d2f',
  quiet: '#7fb069',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'dinner-is-cancelled.best';
