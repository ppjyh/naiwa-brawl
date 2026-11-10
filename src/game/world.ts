import {
  ARENA,
  CONTACT_COOLDOWN,
  DAMAGE_SCALE,
  CONTACT_MIN_SPEED,
  MOVE_SPEED_MULT,
  SKILL_DAMAGE_SCALE,
  SPAWN,
  SUDDEN_DEATH_EVERY,
  SUDDEN_DEATH_START,
  WALL_BOUNCE,
  WALL_SLAM_SPEED,
} from './constants';
import { SUMMON_MOUSE, type CharDef } from './chars';
import { RNG } from '../core/rng';
import { add, angleOf, dist, fromAngle, len, mul, norm, sub } from '../core/math';
import { skillById } from './skills';
import type {
  ActiveAction,
  Beam,
  Blast,
  FloatingText,
  Frog,
  Minion,
  Particle,
  Projectile,
  Ring,
  Shockwave,
  Side,
  SkillDef,
  StinkZone,
  Trap,
  Vortex,
  Windup,
} from './types';

export interface DamageOpts {
  kb?: number;
  angle?: number;
  stun?: number;
  shieldMul?: number;
  quiet?: boolean;
  dot?: boolean;
}

const BURN_TICK = 0.5;

function makeFrog(def: CharDef, side: Side): Frog {
  return {
    side,
    def,
    origin: def,
    pos: { x: SPAWN[side].x, y: SPAWN[side].y },
    vel: { x: 0, y: 0 },
    radius: def.radius,
    mass: def.mass,
    maxHp: def.hp,
    hp: def.hp,
    baseAtk: def.atk,
    atk: def.atk,
    speed: def.speed,
    kbr: def.kbr,
    facing: side === 0 ? 0 : Math.PI,
    stun: 0,
    invuln: 0.6,
    z: 0,
    shield: 0,
    shieldT: 0,
    cds: [1.1, 2.0],
    basicCd: 0.6,
    action: null,
    windup: null,
    moveDir: { x: 0, y: 0 },
    slowT: 0,
    slowMul: 1,
    burnT: 0,
    burnDps: 0,
    burnAcc: 0,
    buffT: 0,
    buffStacks: 0,
    guard: 1,
    superArmor: false,
    cloudT: 0,
    hidden: 0,
    belly: 0,
    counterT: 0,
    dodgeT: 0,
    reviveUsed: false,
    copyUsed: false,
    splitUsed: false,
    isSummon: false,
    summonKind: null,
    clawCd: 0,
    polymorphT: 0,
    strengthT: 0,
    hasteT: 0,
    invisT: 0,
    regenT: 0,
    regenAcc: 0,
    astralT: 0,
    floatT: 0,
    immortalT: 0,
    hitFlash: 0,
    squash: 0,
    aiTimer: 0,
    aiLabel: '准备',
    driftT: 0,
    driftAngle: 0,
    walkPhase: 0,
    stats: { damage: 0, skills: 0, hits: 0 },
    trail: [],
    wallCd: 0,
    dead: false,
    rage: false,
  };
}

export type Phase = 'countdown' | 'fight' | 'ko' | 'over';

export class World {
  readonly seed: number;
  readonly rng: RNG;
  readonly frogs: [Frog, Frog];
  phase: Phase = 'countdown';
  time = 0;
  animTime = 0;
  countdown = 3.2;
  koTimer = 0;
  winner: Side | null = null;
  isDraw = false;
  hitstop = 0;
  shakePower = 0;
  boilStacks = 0;
  boilTimer = 0;
  boilFlash = 0;
  chipText = 0;
  onSound: ((name: string) => void) | null = null;

  texts: FloatingText[] = [];
  particles: Particle[] = [];
  rings: Ring[] = [];
  beams: Beam[] = [];
  waves: Shockwave[] = [];
  projectiles: Projectile[] = [];
  traps: Trap[] = [];
  vortices: Vortex[] = [];
  stinks: StinkZone[] = [];
  blasts: Blast[] = [];
  minions: Minion[] = [];
  clones: Frog[] = [];

  private contactCd = 0;

  constructor(private readonly left: CharDef, private readonly right: CharDef, seed: number) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.frogs = [makeFrog(left, 0), makeFrog(right, 1)];

    // physics-only start: both bodies get a velocity roughly toward the centre,
    // then every direction change comes from walls and body collisions.
    const cx = ARENA.x + ARENA.w / 2;
    const cy = ARENA.y + ARENA.h / 2;
    for (const f of this.frogs) {
      const a = Math.atan2(cy - f.pos.y, cx - f.pos.x) + this.rng.range(-0.55, 0.55);
      f.facing = a;
      f.vel = fromAngle(a, f.speed * MOVE_SPEED_MULT);
    }
  }

  sound(name: string): void {
    this.onSound?.(name);
  }

  update(step: number): void {
    this.animTime += step;
    this.shakePower *= Math.pow(0.08, step);
    if (this.phase === 'over') {
      this.updateFx(step);
      return;
    }

    if (this.phase === 'countdown') {
      this.countdown -= step;
      this.updateFx(step);
      for (const f of this.frogs) {
        f.facing = Math.atan2(this.foe(f).pos.y - f.pos.y, this.foe(f).pos.x - f.pos.x);
        f.squash *= Math.pow(0.02, step);
      }
      if (this.countdown <= 0) {
        this.phase = 'fight';
        this.sound('start');
        this.ring(600, ARENA.y + ARENA.h / 2, 20, 320, 0.5, '#ffe2a1', 5, false);
      }
      return;
    }

    if (this.phase === 'ko') {
      this.koTimer -= step;
      this.updateFx(step);
      if (this.koTimer <= 0) this.phase = 'over';
      return;
    }

    if (this.hitstop > 0) {
      this.hitstop -= step;
      this.updateFx(step);
      return;
    }

    this.time += step;
    this.updateBoil(step);
    // late-match chip damage: guarantees even the slipperiest matchup ends
    if (this.time > 50) {
      for (const f of this.allBodies()) {
        if (f.dead) continue;
        f.hp -= f.maxHp * 0.01 * step;
        if (f.immortalT > 0 && f.hp < 1) f.hp = 1;
      }
      this.chipText -= step;
      if (this.chipText <= 0) {
        this.chipText = 1;
        for (const f of this.allBodies()) {
          if (!f.dead) {
            this.text(
              f.pos.x + this.rng.range(-6, 6),
              f.pos.y - 34,
              `-${Math.max(1, Math.round(f.maxHp * 0.01))}`,
              '#c85a00',
              12,
            );
          }
        }
      }
    }
    this.contactCd = Math.max(0, this.contactCd - step);

    for (const f of this.frogs) this.updateFrog(f, step);
    for (const c of this.clones) this.updateSummon(c, step);
    this.resolveBodies();
    this.updateProjectiles(step);
    this.updateTraps(step);
    this.updateVortices(step);
    this.updateStinks(step);
    this.updateBlasts(step);
    this.updateMinions(step);
    this.cleanupClones();
    this.checkDeaths();
    this.updateFx(step);
  }

  private updateBoil(step: number): void {
    if (this.time < SUDDEN_DEATH_START) return;
    if (this.boilStacks === 0) {
      this.addBoilStack();
      this.boilTimer = 0;
      return;
    }
    this.boilTimer += step;
    while (this.boilTimer >= SUDDEN_DEATH_EVERY) {
      this.boilTimer -= SUDDEN_DEATH_EVERY;
      this.addBoilStack();
    }
  }

  private addBoilStack(): void {
    this.boilStacks += 1;
    this.boilFlash = 2.2;
    this.text(600, 220, `奶气沸腾 ×${this.boilStacks}`, '#c85a00', 28);
    this.ring(600, 400, 40, 520, 0.8, '#ffb347', 6, false);
    this.shake(7);
    this.sound('boil');
  }

  private updateFrog(f: Frog, step: number): void {
    const foe = this.nearestFoe(f) ?? this.foe(f);
    if (f.hidden > 0) {
      f.hidden = Math.max(0, f.hidden - step);
      f.pos.x = foe.pos.x;
      f.pos.y = foe.pos.y;
      f.vel.x = 0;
      f.vel.y = 0;
      return;
    }
    if (f.floatT > 0) {
      const prev = f.floatT;
      f.floatT = Math.max(0, f.floatT - step);
      f.z = 64 + Math.sin(this.animTime * 6) * 6;
      f.vel.x = 0;
      f.vel.y = 0;
      if (prev > 0 && f.floatT <= 0) {
        f.z = 0;
        this.damage(f, 8, this.foe(f), {
          kb: 200,
          angle: Math.atan2(f.pos.y - this.foe(f).pos.y, f.pos.x - this.foe(f).pos.x),
          stun: 0.25,
        });
        this.shake(5);
      }
      return;
    }
    f.belly = Math.max(0, f.belly - step * 0.9);
    f.hitFlash = Math.max(0, f.hitFlash - step);
    f.squash *= Math.pow(0.0005, step);
    f.invuln = Math.max(0, f.invuln - step);
    f.stun = Math.max(0, f.stun - step);
    f.wallCd = Math.max(0, f.wallCd - step);
    f.basicCd = Math.max(0, f.basicCd - step);
    f.counterT = Math.max(0, f.counterT - step);
    f.dodgeT = Math.max(0, f.dodgeT - step);
    f.polymorphT = Math.max(0, f.polymorphT - step);
    f.strengthT = Math.max(0, f.strengthT - step);
    f.hasteT = Math.max(0, f.hasteT - step);
    f.invisT = Math.max(0, f.invisT - step);
    f.astralT = Math.max(0, f.astralT - step);
    f.immortalT = Math.max(0, f.immortalT - step);
    if (f.regenT > 0) {
      f.regenT = Math.max(0, f.regenT - step);
      f.regenAcc += step;
      while (f.regenAcc >= 0.4) {
        f.regenAcc -= 0.4;
        this.heal(f, f.maxHp * 0.01875);
        this.burst(f.pos.x, f.pos.y - 20, 2, '#b9f0a0', 70, 4);
      }
    }
    if (f.astralT > 0) {
      f.invuln = Math.max(f.invuln, 0.05);
      f.regenAcc += step;
      while (f.regenAcc >= 0.4) {
        f.regenAcc -= 0.4;
        const foe = this.foe(f);
        if (
          !foe.dead &&
          foe.hidden <= 0 &&
          Math.hypot(foe.pos.x - f.pos.x, foe.pos.y - f.pos.y) < 170
        ) {
          this.damage(foe, 2.5, f, { kb: 0, stun: 0.04 });
        }
      }
    }
    f.buffT = Math.max(0, f.buffT - step);
    if (f.buffT <= 0) f.buffStacks = 0;
    f.cds[0] = Math.max(0, f.cds[0] - step);
    f.cds[1] = Math.max(0, f.cds[1] - step);
    f.slowT = Math.max(0, f.slowT - step);
    if (f.slowT <= 0) f.slowMul = 1;
    if (f.shield > 0) {
      f.shieldT = Math.max(0, f.shieldT - step);
      if (f.shieldT <= 0) f.shield = 0;
    }

    f.atk = f.baseAtk * (1 + 0.08 * f.buffStacks) * (f.rage ? 1.2 : 1);

    if (f.dead) {
      f.moveDir = { x: 0, y: 0 };
      f.z = Math.max(0, f.z - step * 60);
      return;
    }

    this.updateBurn(f, step);

    if (!f.rage && f.hp / f.maxHp < 0.2) {
      f.rage = true;
      this.text(f.pos.x, f.pos.y - 80, '狂暴！', '#c81d1d', 21);
      this.burst(f.pos.x, f.pos.y, 18, '#ff7b6b', 220, 5);
    }

    if (f.cloudT > 0) {
      f.cloudT = Math.max(0, f.cloudT - step);
      f.z = 62;
      f.invuln = Math.max(f.invuln, 0.05);
      if (f.cloudT <= 0) {
        f.z = 0;
        this.ring(f.pos.x, f.pos.y, 12, 120, 0.4, '#d6f2ff', 6, false);
        this.burst(f.pos.x, f.pos.y, 24, '#d6f2ff', 300, 5);
        this.shake(8);
        if (dist(f.pos, foe.pos) < 120 + foe.radius) {
          this.damage(foe, 10, f, { kb: 460, angle: angleOf(sub(foe.pos, f.pos)), stun: 0.2 });
        }
      }
    }

    if (f.stun > 0) {
      f.moveDir = { x: 0, y: 0 };
      f.windup = null;
      f.aiLabel = '眩晕';
    } else if (f.windup) {
      f.windup.t += step;
      f.vel.x *= Math.pow(0.02, step);
      f.vel.y *= Math.pow(0.02, step);
      f.facing = Math.atan2(foe.pos.y - f.pos.y, foe.pos.x - f.pos.x);
      f.aiLabel = '蓄力';
      if (f.windup.t >= f.windup.def.windup) {
        const w = f.windup;
        f.windup = null;
        const slot = f.def.skills.indexOf(w.def.id);
        if (slot >= 0) f.cds[slot] = w.def.cd;
        f.stats.skills += 1;
        w.def.cast(f, this, foe.dead ? null : foe);
      }
    } else if (f.action) {
      f.moveDir = { x: 0, y: 0 };
      f.action.update(f, this, f.action, step);
    } else {
      this.updateAI(f, foe, step);
    }

    this.stepPhysics(f, step);
  }

  private updateBurn(f: Frog, step: number): void {
    if (f.burnT <= 0) return;
    f.burnT = Math.max(0, f.burnT - step);
    f.burnAcc += step;
    while (f.burnAcc >= BURN_TICK) {
      f.burnAcc -= BURN_TICK;
      if (!f.dead) this.damage(f, f.burnDps * BURN_TICK, null, { dot: true });
      this.burst(f.pos.x, f.pos.y - 20, 1, '#ff9c5a', 30, 4);
    }
  }

  private stepPhysics(f: Frog, step: number): void {
    if (f.action?.data.lock) {
      return;
    }

    const speedMul = (f.cloudT > 0 ? 1.4 : 1) * (f.slowT > 0 ? f.slowMul : 1);
    const base =
      f.speed *
      MOVE_SPEED_MULT *
      speedMul *
      (f.rage ? 1.25 : 1) *
      (f.dodgeT > 0 ? 1.2 : 1) *
      (f.hasteT > 0 ? 1.8 : 1) *
      (f.astralT > 0 ? 1.25 : 1) *
      (f.polymorphT > 0 ? 0.55 : 1);

    let sp = len(f.vel);

    if (f.stun > 0 || f.windup) {
      // no thrust while stunned or charging a skill; just lose momentum
      f.vel = mul(f.vel, Math.exp(-3.2 * step));
    } else if (f.action) {
      // action-driven motion (dashes, rolls) coasts and slowly settles
      f.vel = mul(f.vel, Math.exp(-1.5 * step));
    } else {
      // frictionless puck: preserve the direction produced by collisions,
      // only restore speed toward the character's natural pace
      if (sp < 1) {
        f.vel = fromAngle(f.facing, base);
        sp = base;
      }
      const rate = sp < base ? 5.5 : 2.2;
      const next = sp + (base - sp) * (1 - Math.exp(-rate * step));
      f.vel = mul(f.vel, next / sp);
      f.walkPhase += step * (next / 30);
    }

    sp = len(f.vel);
    if (sp > base * 3) f.vel = mul(f.vel, (base * 3) / sp);

    f.pos.x += f.vel.x * step;
    f.pos.y += f.vel.y * step;
    this.clampWalls(f);

    if (len(f.vel) > 5) f.facing = Math.atan2(f.vel.y, f.vel.x);
  }

  private updateSummon(c: Frog, step: number): void {
    if (c.dead) return;
    c.hitFlash = Math.max(0, c.hitFlash - step);
    c.stun = Math.max(0, c.stun - step);
    c.invuln = Math.max(0, c.invuln - step);
    c.clawCd = Math.max(0, c.clawCd - step);
    c.wallCd = Math.max(0, c.wallCd - step);
    c.polymorphT = Math.max(0, c.polymorphT - step);
    c.squash *= Math.pow(0.02, step);
    this.updateBurn(c, step);
    this.stepPhysics(c, step);
    if (c.hp <= 0 || c.stun > 0) return;

    const target = this.nearestFoe(c);
    if (!target || target.dead) return;
    c.facing = Math.atan2(target.pos.y - c.pos.y, target.pos.x - c.pos.x);
    const reach = c.radius + target.radius + (c.summonKind === 'tiger' ? 36 : 26);
    if (dist(c.pos, target.pos) < reach && c.clawCd <= 0) {
      c.clawCd = c.summonKind === 'tiger' ? 1.0 : 1.1;
      const tiger = c.summonKind === 'tiger';
      this.damage(target, tiger ? 5 : 2, c, {
        kb: tiger ? 260 : 70,
        angle: c.facing,
        stun: 0.05,
      });
      this.burst(target.pos.x, target.pos.y, tiger ? 10 : 6, '#ffe0a3', 180, 4);
    }
  }

  private cleanupClones(): void {
    this.clones = this.clones.filter((c) => {
      if (c.hp > 0 && !c.dead) return true;
      if (!c.dead) {
        c.dead = true;
        this.burst(c.pos.x, c.pos.y, 18, '#ffe6c8', 260, 5);
        this.ring(c.pos.x, c.pos.y, 8, 70, 0.3, '#ffe6c8', 4, false);
        this.text(c.pos.x, c.pos.y - 40, '召唤物消散', '#8a6a2e', 14);
      }
      return false;
    });
  }

  private clampWalls(f: Frog): void {
    let impact = 0;
    if (f.pos.x - f.radius < ARENA.x) {
      impact = Math.max(impact, -f.vel.x);
      f.pos.x = ARENA.x + f.radius;
      f.vel.x = Math.abs(f.vel.x) * WALL_BOUNCE;
    } else if (f.pos.x + f.radius > ARENA.x + ARENA.w) {
      impact = Math.max(impact, f.vel.x);
      f.pos.x = ARENA.x + ARENA.w - f.radius;
      f.vel.x = -Math.abs(f.vel.x) * WALL_BOUNCE;
    }
    if (f.pos.y - f.radius < ARENA.y) {
      impact = Math.max(impact, -f.vel.y);
      f.pos.y = ARENA.y + f.radius;
      f.vel.y = Math.abs(f.vel.y) * WALL_BOUNCE;
    } else if (f.pos.y + f.radius > ARENA.y + ARENA.h) {
      impact = Math.max(impact, f.vel.y);
      f.pos.y = ARENA.y + ARENA.h - f.radius;
      f.vel.y = -Math.abs(f.vel.y) * WALL_BOUNCE;
    }

    if (impact > WALL_SLAM_SPEED && f.wallCd <= 0 && !f.action) {
      f.wallCd = 0.5;
      f.stun = Math.max(f.stun, 0.12);
      this.shake(6);
      this.burst(f.pos.x, f.pos.y, 8, '#d8c7a8', 130, 3);
    }
  }

  private resolveBodies(): void {
    const [a, b] = this.frogs;
    if (a.dead || b.dead || a.hidden > 0 || b.hidden > 0) return;
    const d = dist(a.pos, b.pos);
    const minD = a.radius + b.radius;
    if (d >= minD || d < 0.0001) return;

    const n = norm(sub(b.pos, a.pos));
    const overlap = minD - d;
    const invA = 1 / a.mass;
    const invB = 1 / b.mass;
    const invSum = invA + invB;

    a.pos = add(a.pos, mul(n, -overlap * (invA / invSum)));
    b.pos = add(b.pos, mul(n, overlap * (invB / invSum)));
    this.clampWalls(a);
    this.clampWalls(b);

    const rv = sub(b.vel, a.vel);
    const vn = rv.x * n.x + rv.y * n.y;
    if (vn >= 0) return;

    const e = 0.85;
    const j = (-(1 + e) * vn) / invSum;
    a.vel = add(a.vel, mul(n, -j * invA));
    b.vel = add(b.vel, mul(n, j * invB));

    const impact = -vn;
    if (impact > CONTACT_MIN_SPEED && this.contactCd <= 0) {
      this.contactCd = CONTACT_COOLDOWN;
      this.hitstop = Math.max(this.hitstop, 0.02);
      this.shake(3);
      this.burst((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, 7, '#fff1cf', 150, 3);
    }
  }

  private updateAI(f: Frog, foe: Frog, step: number): void {
    f.aiTimer -= step;
    if (f.aiTimer <= 0) {
      f.aiTimer = 0.09 + this.rng.range(0, 0.05);
      this.decide(f, this.nearestFoe(f) ?? foe);
    }
  }

  private decide(f: Frog, foe: Frog): void {
    if (f.dead) return;
    if (f.stun > 0 || f.action || f.windup || f.polymorphT > 0) return;
    if (foe.dead) return;
    if (foe.hidden > 0 || f.astralT > 0) return;

    const d = dist(f.pos, foe.pos);
    const hpRatio = f.hp / f.maxHp;

    // --- skills are the only thing that aims at the opponent ---
    const order = [0, 1].sort((i, j) => {
      const si = skillById(f.def.skills[i]);
      const sj = skillById(f.def.skills[j]);
      return sj.priority - si.priority;
    });
    for (const i of order) {
      const def: SkillDef = skillById(f.def.skills[i]);
      if (f.cds[i] > 0) continue;
      if (d < def.ai.min || d > def.ai.max) continue;
      if (def.ai.hpBelow !== undefined && hpRatio > def.ai.hpBelow) continue;
      if (!this.rng.chance(def.ai.chance)) continue;
      this.beginWindup(f, foe, def);
      return;
    }
  }

  private beginWindup(f: Frog, foe: Frog, def: SkillDef): void {
    const dir = norm(sub(foe.pos, f.pos));
    f.windup = {
      def,
      t: 0,
      dir,
      targetSide: foe.side,
      slot: def.id === 'basic' ? null : f.def.skills.indexOf(def.id),
    } satisfies Windup;
    f.vel = mul(f.vel, 0.2);
    f.facing = Math.atan2(dir.y, dir.x);
    f.aiLabel = def.id === 'basic' ? '头槌' : '施法';
    if (def.id === 'basic') f.stats.hits += 1;
  }

  // ---------- combat ----------

  damage(target: Frog, amount: number, source: Frog | null, opts: DamageOpts = {}): number {
    if (target.dead || target.invuln > 0 || target.hidden > 0 || amount <= 0) {
      if (target.invuln > 0 && !opts.dot && amount >= 5) {
        this.text(target.pos.x, target.pos.y - 54, '无敌', '#3a4a7a', 13);
      }
      return 0;
    }
    if (target.dodgeT > 0 && !opts.dot && this.rng.chance(0.38)) {
      this.text(target.pos.x, target.pos.y - 54, '闪避', '#2f7fa8', 15);
      this.burst(target.pos.x, target.pos.y, 6, '#cdefff', 130, 3);
      return 0;
    }
    let dmg = amount;
    if (!opts.dot) {
      dmg *= 1 + this.boilStacks * 0.15;
      if (source) {
        dmg *= source.atk / 10;
        dmg *= SKILL_DAMAGE_SCALE;
        if (source.strengthT > 0) dmg *= 1.2;
        if (source.invisT > 0) {
          dmg *= 2.2;
          source.invisT = 0;
          this.text(source.pos.x, source.pos.y - 62, '偷袭！', '#8a5a00', 16);
        }
      }
      dmg *= DAMAGE_SCALE;
    }
    dmg *= target.guard;
    if (target.polymorphT > 0) dmg *= 1.2;

    let crit = false;
    if (!opts.dot && this.rng.chance(0.1)) {
      dmg *= 1.5;
      crit = true;
    }

    const shieldMul = opts.shieldMul ?? 1;
    if (target.shield > 0) {
      const shieldDmg = dmg * shieldMul;
      const used = Math.min(target.shield, shieldDmg);
      target.shield -= used;
      const overflow = (shieldDmg - used) / shieldMul;
      if (used > 0) {
        this.ring(target.pos.x, target.pos.y, 16, 56, 0.22, '#9fe3ff', 4, false);
        this.text(target.pos.x, target.pos.y - 56, `护盾 -${Math.round(used)}`, '#1f6f8f', 14);
      }
      dmg = overflow;
      if (target.shield <= 0) {
        target.shield = 0;
        this.burst(target.pos.x, target.pos.y, 10, '#c9f2ff', 160, 3);
      }
    }

    if (dmg <= 0.05) {
      this.sound('shield');
      return 0;
    }

    target.hp -= dmg;
    if (target.immortalT > 0 && target.hp < 1) target.hp = 1;
    target.hitFlash = 0.14;
    target.squash = 1;
    if (source) source.stats.damage += dmg;
    if (source) source.stats.hits += 1;

    if (!opts.quiet) {
      const shown = Math.max(1, Math.round(dmg));
      this.text(
        target.pos.x + this.rng.range(-12, 12),
        target.pos.y - target.radius - 26,
        crit ? `-${shown}!` : `-${shown}`,
        opts.dot ? '#c85a00' : crit ? '#c81d1d' : '#3b2412',
        opts.dot ? 13 : crit ? 25 : 19,
      );
    }

    if (!opts.dot) {
      this.burst(target.pos.x, target.pos.y, 7, '#fff3d6', 190, 3.5);
      this.ring(target.pos.x, target.pos.y, 6, 28 + dmg * 1.2, 0.22, '#fff3d6', 3, false);
      this.hitstop = Math.max(this.hitstop, 0.05);
      this.shake(Math.min(14, 3 + dmg * 0.45));
    }

    if (!target.superArmor) {
      if (opts.stun) this.applyStun(target, opts.stun);
      if (opts.kb) {
        const angle = opts.angle ?? (source ? angleOf(sub(target.pos, source.pos)) : 0);
        const force =
          (opts.kb / target.mass) *
          (1 - target.kbr) *
          (source && source.strengthT > 0 ? 1.5 : 1);
        target.vel.x += Math.cos(angle) * force;
        target.vel.y += Math.sin(angle) * force;
      }
    }

    if (target.counterT > 0 && source && source !== target && target.hp > 0) {
      target.counterT = 0;
      this.text(target.pos.x, target.pos.y - 60, '反击！', '#c81d1d', 16);
      this.damage(source, 14, target, {
        kb: 420,
        angle: angleOf(sub(source.pos, target.pos)),
        stun: 0.2,
      });
    }

    this.sound('hit');
    return dmg;
  }

  heal(f: Frog, amount: number): void {
    if (f.dead) return;
    const scale = Math.max(0, 1 - this.boilStacks * 0.15);
    const gained = Math.min(f.maxHp - f.hp, amount * scale);
    if (gained <= 0) return;
    f.hp += gained;
    this.text(f.pos.x + this.rng.range(-8, 8), f.pos.y - 46, `+${Math.round(gained)}`, '#2f7a3f', 17);
  }

  applyStun(f: Frog, seconds: number): void {
    if (f.superArmor) return;
    f.stun = Math.max(f.stun, seconds);
    f.windup = null;
    if (f.action) this.endAction(f);
  }

  endAction(f: Frog): void {
    const a = f.action;
    if (!a) return;
    f.action = null;
    a.end?.(f, this, a);
  }

  addAction(f: Frog, a: ActiveAction): void {
    f.action = a;
  }

  // ---------- summoned things ----------

  spawnBubble(side: Side, x: number, y: number, angle: number): void {
    const speed = 235;
    this.projectiles.push({
      kind: 'bubble',
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 20,
      life: 3,
      maxLife: 3,
      owner: side,
      color: '#c9f2ff',
      damage: 7,
      kb: 120,
      bounce: 0.92,
      hitCd: [0, 0],
    });
  }

  spawnMilk(side: Side, x: number, y: number, angle: number): void {
    const speed = 330;
    this.projectiles.push({
      kind: 'milk',
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 18,
      life: 3.2,
      maxLife: 3.2,
      owner: side,
      color: '#fffaf0',
      damage: 6,
      kb: 240,
      bounce: 0.9,
      hitCd: [0, 0],
    });
  }

  spawnTrap(x: number, y: number, owner: Side, kind: 'egg' | 'banana' = 'egg'): void {
    this.traps.push({
      kind,
      x,
      y,
      owner,
      arm: kind === 'egg' ? 1.1 : 0.6,
      life: kind === 'egg' ? 8 : 5,
      maxLife: kind === 'egg' ? 8 : 5,
      radius: kind === 'egg' ? 110 : 80,
      blink: 0,
    });
  }

  spawnBlast(
    x: number,
    y: number,
    owner: Side,
    delay: number,
    radius: number,
    damage: number,
    color: string,
    knockback = 380,
    stun = 0.2,
  ): void {
    this.blasts.push({
      x,
      y,
      owner,
      delay,
      maxDelay: delay,
      radius,
      damage,
      color,
      knockback,
      stun,
    });
  }

  spawnFire(side: Side, x: number, y: number, angle: number): void {
    const speed = 290;
    this.projectiles.push({
      kind: 'fire',
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 22,
      life: 2.4,
      maxLife: 2.4,
      owner: side,
      color: '#ff9a3d',
      damage: 20,
      kb: 380,
      bounce: 0,
      hitCd: [0, 0],
    });
  }

  spawnMouseSummon(f: Frog): void {
    const c = makeFrog(SUMMON_MOUSE, f.side);
    c.isSummon = true;
    c.summonKind = 'mouse';
    c.pos = {
      x: Math.min(ARENA.x + ARENA.w - c.radius, Math.max(ARENA.x + c.radius, f.pos.x + 34)),
      y: Math.min(ARENA.y + ARENA.h - c.radius, Math.max(ARENA.y + c.radius, f.pos.y - 26)),
    };
    c.vel = fromAngle(this.rng.range(0, Math.PI * 2), c.speed * MOVE_SPEED_MULT);
    c.cds = [999, 999];
    c.clawCd = 0.4;
    c.maxHp = 14;
    c.hp = 14;
    c.stats = { damage: 0, skills: 0, hits: 0 };
    this.clones.push(c);
    this.ring(c.pos.x, c.pos.y, 8, 60, 0.3, '#ffe6a0', 4, false);
    this.text(f.pos.x, f.pos.y - 62, '吱！', '#8a5a00', 14);
  }

  splitTiger(f: Frog): boolean {
    if (f.splitUsed) return false;
    if (this.clones.some((c) => c.side === f.side && c.summonKind === 'tiger' && !c.dead)) {
      return false;
    }
    f.splitUsed = true;
    const c = makeFrog(f.def, f.side);
    c.isSummon = true;
    c.summonKind = 'tiger';
    c.splitUsed = true;
    const part = Math.max(1, Math.round(f.hp * 0.7));
    f.hp = Math.max(1, f.hp - Math.round(f.hp * 0.3));
    c.maxHp = f.maxHp;
    c.hp = part;
    const foe = this.nearestFoe(f);
    const away = foe
      ? Math.atan2(f.pos.y - foe.pos.y, f.pos.x - foe.pos.x)
      : f.facing + Math.PI;
    const side = away + (Math.PI / 2) * (this.rng.chance(0.5) ? 1 : -1);
    c.pos = {
      x: Math.min(
        ARENA.x + ARENA.w - c.radius,
        Math.max(ARENA.x + c.radius, f.pos.x + Math.cos(side) * 92),
      ),
      y: Math.min(
        ARENA.y + ARENA.h - c.radius,
        Math.max(ARENA.y + c.radius, f.pos.y + Math.sin(side) * 92),
      ),
    };
    c.vel = fromAngle(f.facing + Math.PI * 0.55, c.speed * MOVE_SPEED_MULT);
    c.cds = [999, 999];
    c.clawCd = 0.5;
    c.stats = { damage: 0, skills: 0, hits: 0 };
    this.clones.push(c);
    this.ring(f.pos.x, f.pos.y, 12, 140, 0.45, '#ffe0a3', 8, true);
    this.burst(f.pos.x, f.pos.y, 30, '#ffcf6b', 300, 6);
    this.text(f.pos.x, f.pos.y - 80, '分裂！', '#b3541e', 22);
    this.shake(10);
    return true;
  }

  spawnPoop(side: Side, x: number, y: number, angle: number): void {
    const speed = 280;
    this.projectiles.push({
      kind: 'poop',
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 17,
      life: 2.2,
      maxLife: 2.2,
      owner: side,
      color: '#a9834a',
      damage: 8,
      kb: 80,
      bounce: 0.7,
      hitCd: [0, 0],
    });
  }

  spawnVortex(x: number, y: number, owner: Side): void {
    this.vortices.push({
      x,
      y,
      owner,
      life: 1.5,
      maxLife: 1.5,
      radius: 190,
      spin: 0,
    });
  }

  spawnStink(x: number, y: number, owner: Side, radius = 150): void {
    this.stinks.push({
      x,
      y,
      owner,
      life: 3.2,
      maxLife: 3.2,
      radius,
      tick: 0,
    });
  }

  private updateProjectiles(step: number): void {
    for (const p of this.projectiles) {
      p.life -= step;
      p.hitCd[0] = Math.max(0, p.hitCd[0] - step);
      p.hitCd[1] = Math.max(0, p.hitCd[1] - step);
      p.x += p.vx * step;
      p.y += p.vy * step;

      const left = ARENA.x + p.r;
      const right = ARENA.x + ARENA.w - p.r;
      const top = ARENA.y + p.r;
      const bottom = ARENA.y + ARENA.h - p.r;
      let hitWall = false;
      if (p.x < left) {
        p.x = left;
        p.vx = Math.abs(p.vx) * p.bounce;
        hitWall = true;
      } else if (p.x > right) {
        p.x = right;
        p.vx = -Math.abs(p.vx) * p.bounce;
        hitWall = true;
      }
      if (p.y < top) {
        p.y = top;
        p.vy = Math.abs(p.vy) * p.bounce;
        hitWall = true;
      } else if (p.y > bottom) {
        p.y = bottom;
        p.vy = -Math.abs(p.vy) * p.bounce;
        hitWall = true;
      }
      if (p.kind === 'fire' && hitWall) {
        p.life = 0;
        this.explodeFire(p);
        continue;
      }

      for (const f of this.allBodies()) {
        if (f.dead || f.hidden > 0) continue;
        if (p.kind === 'bubble' && f.side === p.owner) continue;
        if (p.hitCd[f.side] > 0) continue;
        const d = Math.hypot(f.pos.x - p.x, f.pos.y - p.y);
        if (d > p.r + f.radius) continue;

        const away = Math.atan2(f.pos.y - p.y, f.pos.x - p.x);
        if (p.kind === 'fire') {
          p.life = 0;
          this.explodeFire(p);
          break;
        }
        if (p.kind === 'poop') {
          this.damage(f, p.damage, f.side === p.owner ? null : this.frogs[p.owner], {
            kb: p.kb,
            angle: away,
          });
          p.hitCd[f.side] = 0.7;
          this.burst(p.x, p.y, 6, '#b08a52', 120, 3);
          break;
        }
        if (p.kind === 'bubble') {
          f.slowT = Math.max(f.slowT, 2);
          f.slowMul = 0.7;
          this.damage(f, p.damage, this.frogs[p.owner], { kb: p.kb, angle: away });
          this.burst(p.x, p.y, 12, '#c9f2ff', 180, 4);
          this.ring(p.x, p.y, 6, 44, 0.25, '#c9f2ff', 3, false);
          p.life = 0;
          break;
        }

        const source = f.side === p.owner ? null : this.frogs[p.owner];
        this.damage(f, p.damage, source, { kb: p.kb, angle: away });
        p.hitCd[f.side] = 1.0;
        p.vx = Math.cos(away) * 320;
        p.vy = Math.sin(away) * 320;
        this.burst(p.x, p.y, 6, '#fff4dc', 130, 3);
      }
    }
    for (const p of this.projectiles) {
      if (p.kind === 'poop' && p.life <= 0) {
        this.spawnStink(p.x, p.y, p.owner);
        this.burst(p.x, p.y, 14, '#b08a52', 150, 4);
        this.ring(p.x, p.y, 6, 42, 0.25, '#b08a52', 3, true);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  }

  private explodeFire(p: Projectile): void {
    this.ring(p.x, p.y, 8, 150, 0.4, '#ff9a3d', 8, true);
    this.burst(p.x, p.y, 32, '#ffb347', 360, 7);
    this.shake(12);
    for (const f of this.allBodies()) {
      if (f.dead || f.hidden > 0) continue;
      if (Math.hypot(f.pos.x - p.x, f.pos.y - p.y) > 150 + f.radius) continue;
      const source = f.side === p.owner ? null : this.frogs[p.owner];
      this.damage(f, p.damage, source, {
        kb: p.kb,
        angle: Math.atan2(f.pos.y - p.y, f.pos.x - p.x),
        stun: 0.15,
      });
    }
  }

  private updateMinions(step: number): void {
    for (const m of this.minions) {
      m.life -= step;
      const foe = this.frogs[m.owner === 0 ? 1 : 0];
      if (!foe.dead && foe.hidden <= 0) {
        const a = Math.atan2(foe.pos.y - m.y, foe.pos.x - m.x);
        const k = 1 - Math.exp(-6 * step);
        m.vx += (Math.cos(a) * m.speed - m.vx) * k;
        m.vy += (Math.sin(a) * m.speed - m.vy) * k;
      }
      m.x += m.vx * step;
      m.y += m.vy * step;
      m.x = Math.max(ARENA.x + m.radius, Math.min(ARENA.x + ARENA.w - m.radius, m.x));
      m.y = Math.max(ARENA.y + m.radius, Math.min(ARENA.y + ARENA.h - m.radius, m.y));

      if (!foe.dead && foe.hidden <= 0) {
        const d = Math.hypot(foe.pos.x - m.x, foe.pos.y - m.y);
        if (d < m.radius + foe.radius + 2) {
          m.life = 0;
          this.damage(foe, 12, this.frogs[m.owner], {
            kb: 260,
            angle: Math.atan2(foe.pos.y - m.y, foe.pos.x - m.x),
            stun: 0.15,
          });
          this.ring(m.x, m.y, 6, 52, 0.28, '#ffe08a', 4, false);
          this.burst(m.x, m.y, 12, '#ffd166', 200, 4);
          this.shake(4);
        }
      }
    }
    this.minions = this.minions.filter((m) => m.life > 0);
  }

  private updateTraps(step: number): void {
    for (const t of this.traps) {
      t.life -= step;
      t.arm -= step;
      t.blink += step;
      if (t.arm > 0) continue;
      const foe = this.nearestFoe(this.frogs[t.owner]) ?? this.frogs[t.owner === 0 ? 1 : 0];
      if (foe.dead || foe.hidden > 0) continue;
      if (Math.hypot(foe.pos.x - t.x, foe.pos.y - t.y) > 58 + foe.radius * 0.4) continue;

      t.life = 0;
      if (t.kind === 'banana') {
        this.ring(t.x, t.y, 8, 54, 0.3, '#ffe07a', 3, false);
        this.burst(t.x, t.y, 12, '#ffe07a', 160, 4);
        this.damage(foe, 12, this.frogs[t.owner], {
          kb: 180,
          angle: Math.atan2(foe.pos.y - t.y, foe.pos.x - t.x),
          stun: 1.2,
        });
        this.text(t.x, t.y - 30, '滑倒！', '#8a5a00', 15);
        continue;
      }
      this.ring(t.x, t.y, 12, t.radius, 0.35, '#ffd166', 6, true);
      this.burst(t.x, t.y, 26, '#ffe6a0', 320, 6);
      this.shake(10);
      this.hitstop = Math.max(this.hitstop, 0.06);
      for (const f of this.allBodies()) {
        if (f.dead || f.hidden > 0) continue;
        const d = Math.hypot(f.pos.x - t.x, f.pos.y - t.y);
        if (d > t.radius + f.radius) continue;
        const source = f.side === t.owner ? null : this.frogs[t.owner];
        this.damage(f, 14, source, {
          kb: 480,
          angle: Math.atan2(f.pos.y - t.y, f.pos.x - t.x),
          stun: 0.2,
        });
      }
    }
    this.traps = this.traps.filter((t) => t.life > 0);
  }

  private updateVortices(step: number): void {
    for (const v of this.vortices) {
      v.life -= step;
      v.spin += step * 8;

      for (const f of this.allBodies()) {
        if (f.dead || f.hidden > 0) continue;
        const dx = v.x - f.pos.x;
        const dy = v.y - f.pos.y;
        const d = Math.hypot(dx, dy);
        if (d > v.radius * 1.5 || d < 1) continue;
        const nx = dx / d;
        const ny = dy / d;
        f.pos.x += (nx * 250 - ny * 110) * step;
        f.pos.y += (ny * 250 + nx * 110) * step;
        this.clampWalls(f);
      }

      if (v.life <= 0) {
        this.ring(v.x, v.y, 20, v.radius * 1.25, 0.4, '#8fdcff', 7, true);
        this.burst(v.x, v.y, 30, '#bfe9ff', 360, 5);
        this.shake(10);
        for (const f of this.allBodies()) {
          if (f.dead || f.hidden > 0 || f.side === v.owner) continue;
          const d = Math.hypot(f.pos.x - v.x, f.pos.y - v.y);
          if (d > v.radius * 1.2 + f.radius) continue;
          this.damage(f, 11, this.frogs[v.owner], {
            kb: 420,
            angle: Math.atan2(f.pos.y - v.y, f.pos.x - v.x),
            stun: 0.15,
          });
        }
      }
    }
    this.vortices = this.vortices.filter((v) => v.life > 0);
  }

  private updateStinks(step: number): void {
    for (const z of this.stinks) {
      z.life -= step;
      z.tick += step;
      const doDamage = z.tick >= 0.5;
      if (doDamage) z.tick -= 0.5;
      for (const f of this.allBodies()) {
        if (f.dead || f.hidden > 0 || f.side === z.owner) continue;
        const d = Math.hypot(f.pos.x - z.x, f.pos.y - z.y);
        if (d > z.radius + f.radius) continue;
        f.slowT = Math.max(f.slowT, 0.3);
        f.slowMul = 0.56;
        if (doDamage) this.damage(f, 5, this.frogs[z.owner], { dot: true });
      }
    }
    this.stinks = this.stinks.filter((z) => z.life > 0);
  }

  private updateBlasts(step: number): void {
    for (const b of this.blasts) {
      b.delay -= step;
      if (b.delay > 0) continue;
      b.delay = -1;
      this.ring(b.x, b.y, 10, b.radius, 0.4, b.color, 7, true);
      this.burst(b.x, b.y, 24, b.color, 300, 5);
      this.shake(8);
      for (const f of this.allBodies()) {
        if (f.dead || f.hidden > 0 || f.side === b.owner) continue;
        const d = Math.hypot(f.pos.x - b.x, f.pos.y - b.y);
        if (d > b.radius + f.radius) continue;
        this.damage(f, b.damage, this.frogs[b.owner], {
          kb: b.knockback,
          angle: Math.atan2(f.pos.y - b.y, f.pos.x - b.x),
          stun: b.stun,
        });
      }
    }
    this.blasts = this.blasts.filter((b) => b.delay > 0);
  }

  // ---------- death ----------

  private checkDeaths(): void {
    if (this.phase !== 'fight') return;
    for (const side of [0, 1] as const) {
      const f = this.frogs[side];
      if (f.dead || f.hp > 0) continue;
      const backup = this.clones.find(
        (c) => c.side === side && c.summonKind === 'tiger' && !c.dead && c.hp > 0,
      );
      if (backup) {
        // the split tiger takes over: remove the fallen body, promote the clone
        backup.isSummon = false;
        backup.summonKind = null;
        backup.cds = [1.5, 2.5];
        backup.clawCd = 0;
        this.clones = this.clones.filter((c) => c !== backup);
        this.frogs[side] = backup;
        this.burst(f.pos.x, f.pos.y, 20, '#ffe0a3', 260, 5);
        this.text(backup.pos.x, backup.pos.y - 70, '换我上！', '#b3541e', 18);
      } else {
        this.kill(f);
      }
    }

    const [a, b] = this.frogs;
    if (a.dead || b.dead) {
      this.phase = 'ko';
      this.koTimer = 1.8;
      if (a.dead && b.dead) {
        this.winner = null;
        this.isDraw = true;
      } else {
        this.winner = a.dead ? 1 : 0;
      }
      this.hitstop = 0;
      this.shake(12);
    }
  }

  private kill(f: Frog): void {
    if (f.def.id === 'naitianshi' && !f.reviveUsed) {
      f.reviveUsed = true;
      f.hp = Math.max(1, Math.round(f.maxHp * 0.35));
      f.invuln = 2;
      f.dead = false;
      f.action = null;
      f.windup = null;
      f.stun = 0;
      f.vel = { x: 0, y: 0 };
      this.ring(f.pos.x, f.pos.y, 16, 160, 0.7, '#fff3d6', 8, false);
      this.burst(f.pos.x, f.pos.y, 30, '#fff3d6', 300, 5);
      this.text(f.pos.x, f.pos.y - 80, '复活！', '#c85a00', 26);
      this.sound('revive');
      return;
    }
    f.dead = true;
    f.hp = 0;
    if (f.action) this.endAction(f);
    f.action = null;
    f.windup = null;
    f.vel = { x: 0, y: 0 };
    this.burst(f.pos.x, f.pos.y, 36, f.def.color, 320, 6);
    this.burst(f.pos.x, f.pos.y, 18, '#fff3d6', 220, 4);
    this.ring(f.pos.x, f.pos.y, 20, 180, 0.7, f.def.color, 6, false);
    this.text(f.pos.x, f.pos.y - 70, 'KO', '#ffd23f', 34);
    this.shake(14);
    this.hitstop = 0.12;
    this.sound('ko');
  }

  // ---------- fx ----------

  text(x: number, y: number, text: string, color = '#fff3d6', size = 16): void {
    this.texts.push({
      x,
      y,
      vy: -46,
      life: 0.95,
      maxLife: 0.95,
      text,
      color,
      size,
    });
  }

  burst(x: number, y: number, count: number, color: string, speed = 160, size = 4): void {
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const s = this.rng.range(speed * 0.3, speed);
      const life = this.rng.range(0.25, 0.6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 30,
        life,
        maxLife: life,
        size: this.rng.range(size * 0.5, size * 1.3),
        color,
        gravity: 240,
        drag: 2.2,
        shape: this.rng.chance(0.25) ? 'star' : 'circle',
      });
    }
  }

  ring(
    x: number,
    y: number,
    r0: number,
    r1: number,
    life: number,
    color: string,
    width = 4,
    fill = false,
  ): void {
    this.rings.push({ x, y, r0, r1, life, maxLife: life, color, width, fill });
  }

  beam(x1: number, y1: number, x2: number, y2: number, life: number, color: string, width: number): void {
    this.beams.push({ x1, y1, x2, y2, life, maxLife: life, color, width });
  }

  wave(x: number, y: number, radius: number, life: number, color: string): void {
    this.waves.push({ x, y, radius, life, maxLife: life, color });
  }

  shake(amount: number): void {
    this.shakePower = Math.min(22, Math.max(this.shakePower, amount));
  }

  private updateFx(step: number): void {
    for (const t of this.texts) {
      t.life -= step;
      t.y += t.vy * step;
      t.vy *= Math.pow(0.2, step);
    }
    this.texts = this.texts.filter((t) => t.life > 0);

    for (const p of this.particles) {
      p.life -= step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.vy += p.gravity * step;
      const d = Math.exp(-p.drag * step);
      p.vx *= d;
      p.vy *= d;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const r of this.rings) r.life -= step;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const b of this.beams) b.life -= step;
    this.beams = this.beams.filter((b) => b.life > 0);
    for (const w of this.waves) w.life -= step;
    this.waves = this.waves.filter((w) => w.life > 0);

    this.boilFlash = Math.max(0, this.boilFlash - step);
  }

  foe(f: Frog): Frog {
    return this.frogs[f.side === 0 ? 1 : 0];
  }

  allBodies(): Frog[] {
    return [...this.frogs, ...this.clones];
  }

  nearestFoe(f: Frog): Frog | null {
    let best: Frog | null = null;
    let bestD = Infinity;
    for (const b of this.allBodies()) {
      if (b.dead || b.side === f.side) continue;
      const d = dist(f.pos, b.pos);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  get playerNames(): [string, string] {
    return [this.left.name, this.right.name];
  }
}
