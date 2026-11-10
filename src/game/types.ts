import type { Vec2 } from '../core/math';
import type { CharDef } from './chars';
import type { World } from './world';

export type Side = 0 | 1;

export interface Windup {
  def: SkillDef;
  t: number;
  dir: Vec2;
  targetSide: Side;
  slot: number | null;
}

export interface ActiveAction {
  id: string;
  name: string;
  color: string;
  t: number;
  dur: number;
  dir: Vec2;
  hit: boolean;
  data: Record<string, number>;
  update: (f: Frog, w: World, a: ActiveAction, dt: number) => void;
  end?: (f: Frog, w: World, a: ActiveAction) => void;
}

export interface SkillDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  cd: number;
  windup: number;
  color: string;
  priority: number;
  ai: { min: number; max: number; hpBelow?: number; chance: number };
  cast: (f: Frog, w: World, target: Frog | null) => void;
}

export interface Frog {
  side: Side;
  def: CharDef;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  mass: number;
  maxHp: number;
  hp: number;
  baseAtk: number;
  atk: number;
  speed: number;
  kbr: number;
  facing: number;
  stun: number;
  invuln: number;
  z: number;
  shield: number;
  shieldT: number;
  cds: number[];
  basicCd: number;
  action: ActiveAction | null;
  windup: Windup | null;
  moveDir: Vec2;
  slowT: number;
  slowMul: number;
  burnT: number;
  burnDps: number;
  burnAcc: number;
  buffT: number;
  buffStacks: number;
  guard: number;
  superArmor: boolean;
  cloudT: number;
  hidden: number;
  belly: number;
  counterT: number;
  dodgeT: number;
  reviveUsed: boolean;
  copyUsed: boolean;
  strengthT: number;
  hasteT: number;
  invisT: number;
  regenT: number;
  regenAcc: number;
  astralT: number;
  floatT: number;
  immortalT: number;
  hitFlash: number;
  squash: number;
  aiTimer: number;
  aiLabel: string;
  driftT: number;
  driftAngle: number;
  walkPhase: number;
  stats: { damage: number; skills: number; hits: number };
  trail: { x: number; y: number; life: number }[];
  wallCd: number;
  dead: boolean;
  rage: boolean;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  shape: 'circle' | 'spark' | 'star';
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
  fill: boolean;
}

export interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface Projectile {
  kind: 'bubble' | 'milk' | 'poop' | 'fire';
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  maxLife: number;
  owner: Side;
  color: string;
  damage: number;
  kb: number;
  bounce: number;
  hitCd: [number, number];
}

export interface Trap {
  kind: 'egg' | 'banana';
  x: number;
  y: number;
  owner: Side;
  arm: number;
  life: number;
  maxLife: number;
  radius: number;
  blink: number;
}

export interface Minion {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: Side;
  life: number;
  maxLife: number;
  speed: number;
  radius: number;
}

export interface Blast {
  x: number;
  y: number;
  owner: Side;
  delay: number;
  maxDelay: number;
  radius: number;
  damage: number;
  color: string;
  knockback: number;
  stun: number;
}

export interface Vortex {
  x: number;
  y: number;
  owner: Side;
  life: number;
  maxLife: number;
  radius: number;
  spin: number;
}

export interface StinkZone {
  x: number;
  y: number;
  owner: Side;
  life: number;
  maxLife: number;
  radius: number;
  tick: number;
}
