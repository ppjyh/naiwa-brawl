export const VIEW_W = 1200;
export const VIEW_H = 760;

/** Playfield. Everything lives in this rect; the HUD occupies the band above it. */
export const ARENA = { x: 330, y: 190, w: 540, h: 540 };

export const SPAWN: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: ARENA.x + ARENA.w * 0.22, y: ARENA.y + ARENA.h * 0.5 },
  { x: ARENA.x + ARENA.w * 0.78, y: ARENA.y + ARENA.h * 0.5 },
];

/** Random drift is a bit faster than the raw Speed stat so collisions stay frequent. */
export const MOVE_SPEED_MULT = 1.45;

/** Global damage knob so 18-character random brawls don't drag. */
export const DAMAGE_SCALE = 1.18;

/** Skills are now the only damage source, so they hit much harder. */
export const SKILL_DAMAGE_SCALE = 1.75;

export const WALL_BOUNCE = 0.98;
export const WALL_SLAM_SPEED = 460;
export const CONTACT_MIN_SPEED = 90;
export const CONTACT_COOLDOWN = 0.25;

export const SUDDEN_DEATH_START = 40;
export const SUDDEN_DEATH_EVERY = 10;
