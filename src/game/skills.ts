import { ARENA } from './constants';
import { CHARS } from './chars';
import type { ActiveAction, Frog, SkillDef } from './types';
import type { World } from './world';
import {
  add,
  angleDiff,
  angleOf,
  clamp,
  dist,
  easeOutCubic,
  fromAngle,
  mul,
  norm,
  sub,
} from '../core/math';

type DamageOpts = {
  kb?: number;
  angle?: number;
  stun?: number;
  shieldMul?: number;
  quiet?: boolean;
};

function makeAction(
  p: Pick<ActiveAction, 'id' | 'name' | 'color' | 'dur' | 'update'> & Partial<ActiveAction>,
): ActiveAction {
  return {
    t: 0,
    dir: { x: 0, y: 0 },
    hit: false,
    data: {},
    ...p,
  };
}

function enemyOf(f: Frog, w: World): Frog {
  return w.nearestFoe(f) ?? w.frogs[f.side === 0 ? 1 : 0];
}

function withinCone(f: Frog, t: Frog, range: number, halfAngle: number): boolean {
  if (t.dead) return false;
  const d = dist(f.pos, t.pos);
  if (d > range + t.radius) return false;
  const ang = Math.atan2(t.pos.y - f.pos.y, t.pos.x - f.pos.x);
  return Math.abs(angleDiff(ang, f.facing)) <= halfAngle;
}

function clampPos(p: { x: number; y: number }, r: number): void {
  p.x = clamp(p.x, ARENA.x + r, ARENA.x + ARENA.w - r);
  p.y = clamp(p.y, ARENA.y + r, ARENA.y + ARENA.h - r);
}

function maybeHit(
  f: Frog,
  w: World,
  dmg: number,
  kb: number,
  range: number,
  opts: DamageOpts = {},
): void {
  const t = enemyOf(f, w);
  if (!t || t.dead) return;
  if (dist(f.pos, t.pos) > range + t.radius) return;
  const ang = angleOf(sub(t.pos, f.pos));
  w.damage(t, dmg, f, { kb, angle: ang, ...opts });
}

const tongue: SkillDef = {
  id: 'tongue',
  name: '舌鞭',
  icon: '舌',
  desc: '甩出舌头，造成 12 伤害并把对手拽到面前。',
  cd: 4,
  windup: 0.25,
  color: '#9ad96d',
  priority: 2,
  ai: { min: 28, max: 195, chance: 0.92 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const startX = f.pos.x;
    const startY = f.pos.y;
    w.sound('whip');
    f.action = makeAction({
      id: 'tongue',
      name: '舌鞭',
      color: '#9ad96d',
      dur: 0.36,
      update(f, w, a, dt) {
        a.t += dt;
        if (!a.hit) {
          a.hit = true;
          if (target && !target.dead && dist(f.pos, target.pos) < 205) {
            const ang = angleOf(sub(target.pos, f.pos));
            if (Math.abs(angleDiff(ang, f.facing)) < 0.6) {
              w.beam(startX, startY, target.pos.x, target.pos.y, 0.2, '#b6f08a', 9);
              w.damage(target, 12, f, { kb: 0, angle: ang, stun: 0.12 });
              const pullDir = norm(sub(f.pos, target.pos));
              target.pos = add(f.pos, mul(pullDir, f.radius + target.radius + 22));
              clampPos(target.pos, target.radius);
              target.vel = mul(pullDir, -70);
              w.burst(target.pos.x, target.pos.y, 8, '#c8f7a0', 120, 3);
            }
          }
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const leap: SkillDef = {
  id: 'leap',
  name: '蛙跳',
  icon: '跳',
  desc: '向前蛙跳 200 距离，空中无敌，落地震出 9 伤害并击退。',
  cd: 7,
  windup: 0.14,
  color: '#7bd88f',
  priority: 1,
  ai: { min: 86, max: 270, chance: 0.7 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    const sx = f.pos.x;
    const sy = f.pos.y;
    const distance = 200;
    w.sound('jump');
    f.action = makeAction({
      id: 'leap',
      name: '蛙跳',
      color: '#7bd88f',
      dur: 0.46,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        const p = clamp(a.t / a.dur, 0, 1);
        const e = easeOutCubic(p);
        f.pos.x = sx + dir.x * distance * e;
        f.pos.y = sy + dir.y * distance * e;
        clampPos(f.pos, f.radius);
        f.z = Math.sin(Math.PI * p) * 74;
        f.invuln = Math.max(f.invuln, 0.06);
        f.vel.x = 0;
        f.vel.y = 0;
        if (p >= 1) {
          f.z = 0;
          w.ring(f.pos.x, f.pos.y, 14, 84, 0.32, '#9cf0a8', 5, false);
          w.burst(f.pos.x, f.pos.y, 14, '#a9f5b3', 220, 4);
          w.shake(4);
          maybeHit(f, w, 9, 280, 84, { stun: 0.1 });
          w.endAction(f);
        }
      },
    });
  },
};

const charge: SkillDef = {
  id: 'charge',
  name: '蛮牛冲撞',
  icon: '撞',
  desc: '锁定方向直线冲锋，命中 13 伤害并击飞；撞墙会自己晕 0.8 秒。',
  cd: 6,
  windup: 0.45,
  color: '#f0b35a',
  priority: 3,
  ai: { min: 132, max: 260, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    w.sound('charge');
    f.action = makeAction({
      id: 'charge',
      name: '蛮牛冲撞',
      color: '#f0b35a',
      dur: 0.56,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.vel.x = a.dir.x * 700;
        f.vel.y = a.dir.y * 700;
        f.pos.x += f.vel.x * dt;
        f.pos.y += f.vel.y * dt;
        if (w.rng.chance(0.6)) {
          w.burst(f.pos.x, f.pos.y, 1, '#ffd68f', 40, 5);
        }
        const hitWall =
          f.pos.x - f.radius <= ARENA.x ||
          f.pos.x + f.radius >= ARENA.x + ARENA.w ||
          f.pos.y - f.radius <= ARENA.y ||
          f.pos.y + f.radius >= ARENA.y + ARENA.h;

        if (hitWall) {
          clampPos(f.pos, f.radius);
          w.endAction(f);
          w.shake(10);
          w.hitstop = Math.max(w.hitstop, 0.1);
          w.burst(f.pos.x, f.pos.y, 18, '#ffcf7a', 260, 5);
          w.ring(f.pos.x, f.pos.y, 10, 90, 0.4, '#ffcf7a', 5, false);
          const self = f;
          w.damage(self, 6, null, { kb: 0, stun: 0.8 });
          w.text(f.pos.x, f.pos.y - 40, '撞墙了！', '#b3541e', 17);
          w.shake(8);
          return;
        }

        const target2 = enemyOf(f, w);
        if (!a.hit && target2 && !target2.dead && dist(f.pos, target2.pos) < f.radius + target2.radius + 8) {
          a.hit = true;
          w.damage(target2, 13, f, { kb: 640, angle: angleOf(a.dir), stun: 0.25 });
          w.shake(12);
          w.hitstop = Math.max(w.hitstop, 0.09);
          w.burst(target2.pos.x, target2.pos.y, 22, '#ffd68f', 320, 6);
          w.endAction(f);
          return;
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const gore: SkillDef = {
  id: 'gore',
  name: '牛角挑飞',
  icon: '角',
  desc: '近身扇形挑飞，11 伤害、眩晕 0.55 秒，对护盾造成双倍消耗。',
  cd: 8,
  windup: 0.35,
  color: '#ffcf7a',
  priority: 3,
  ai: { min: 0, max: 98, chance: 0.9 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    w.sound('gore');
    if (target && withinCone(f, target, 100, Math.PI * 0.55)) {
      w.damage(target, 11, f, {
        kb: 560,
        angle: f.facing,
        stun: 0.55,
        shieldMul: 2.2,
      });
      w.ring(f.pos.x, f.pos.y, 20, 108, 0.34, '#ffe0a3', 6, true);
      w.burst(target.pos.x, target.pos.y, 18, '#ffe0a3', 280, 5);
      w.shake(9);
      w.hitstop = Math.max(w.hitstop, 0.07);
    } else {
      w.ring(f.pos.x, f.pos.y, 20, 96, 0.3, '#e0a35a', 3, false);
    }
    f.action = makeAction({
      id: 'gore',
      name: '牛角挑飞',
      color: '#ffcf7a',
      dur: 0.34,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.vel.x *= 0.86;
        f.vel.y *= 0.86;
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const blink: SkillDef = {
  id: 'blink',
  name: '缩地',
  icon: '闪',
  desc: '瞬间位移 165 距离并无敌 0.32 秒，现身时对身边敌人造成 13 伤害。',
  cd: 3,
  windup: 0.15,
  color: '#ffd166',
  priority: 2,
  ai: { min: 0, max: 130, chance: 0.55 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const escaping = !!target && dist(f.pos, target.pos) < 84;
    const dir = target
      ? escaping
        ? norm(sub(f.pos, target.pos))
        : norm(sub(target.pos, f.pos))
      : fromAngle(f.facing);
    const from = { x: f.pos.x, y: f.pos.y };
    f.pos = add(f.pos, mul(dir, 165));
    clampPos(f.pos, f.radius);
    f.invuln = Math.max(f.invuln, 0.34);
    f.z = 0;
    w.sound('blink');
    w.ring(from.x, from.y, 10, 46, 0.3, '#ffe49a', 4, false);
    w.ring(f.pos.x, f.pos.y, 8, 40, 0.28, '#ffe49a', 4, false);
    w.burst(from.x, from.y, 12, '#ffe49a', 160, 4);
    w.burst(f.pos.x, f.pos.y, 10, '#fff3c9', 120, 3);
    if (target && !target.dead && dist(f.pos, target.pos) < f.radius + target.radius + 26) {
      w.damage(target, 13, f, { kb: 150, angle: angleOf(sub(target.pos, f.pos)) });
    }
  },
};

const steal: SkillDef = {
  id: 'steal',
  name: '偷奶酪',
  icon: '偷',
  desc: '偷走对手 8% 攻击力（最多 4 层，持续 16 秒），并造成 14 伤害。',
  cd: 7,
  windup: 0.3,
  color: '#ffd166',
  priority: 2,
  ai: { min: 0, max: 100, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < f.radius + target.radius + 40) {
      f.buffStacks = Math.min(4, f.buffStacks + 1);
      f.buffT = 16;
      w.damage(target, 14, f, { kb: 180, angle: angleOf(sub(target.pos, f.pos)) });
      w.text(f.pos.x, f.pos.y - 70, `攻击 +${f.buffStacks * 8}%`, '#8a5a00', 16);
      w.burst(f.pos.x, f.pos.y, 10, '#ffe07a', 120, 4);
      w.sound('steal');
    } else {
      w.ring(f.pos.x, f.pos.y, 10, 50, 0.25, '#ffd166', 3, false);
    }
  },
};

const peck: SkillDef = {
  id: 'peck',
  name: '连环啄',
  icon: '啄',
  desc: '快速啄击 3 次，每次 5 伤害，最后一击 7 伤害并击退。',
  cd: 3.6,
  windup: 0.15,
  color: '#ff8a78',
  priority: 3,
  ai: { min: 0, max: 130, chance: 0.95 },
  cast(f, w) {
    const times = [0.03, 0.2, 0.37];
    w.sound('peck');
    f.action = makeAction({
      id: 'peck',
      name: '连环啄',
      color: '#ff8a78',
      dur: 0.56,
      data: { i: 0 },
      update(f, w, a, dt) {
        a.t += dt;
        while (a.data.i < 3 && a.t >= times[a.data.i]) {
          const i = a.data.i;
          a.data.i += 1;
          const t = enemyOf(f, w);
          if (t && !t.dead && dist(f.pos, t.pos) < 170 + t.radius) {
            f.facing = Math.atan2(t.pos.y - f.pos.y, t.pos.x - f.pos.x);
            const last = i === 2;
            w.damage(t, last ? 7 : 5, f, {
              kb: last ? 220 : 0,
              angle: f.facing,
            });
            if (last) w.shake(5);
            f.pos.x += Math.cos(f.facing) * 12;
            f.pos.y += Math.sin(f.facing) * 12;
            clampPos(f.pos, f.radius);
          }
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const flypeck: SkillDef = {
  id: 'flypeck',
  name: '飞鸡扑食',
  icon: '飞',
  desc: '飞扑 220 距离，空中免疫地面技能，落地 10 伤害并击退。',
  cd: 8,
  windup: 0.3,
  color: '#ff9f8a',
  priority: 2,
  ai: { min: 88, max: 270, chance: 0.75 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    const sx = f.pos.x;
    const sy = f.pos.y;
    w.sound('jump');
    f.action = makeAction({
      id: 'flypeck',
      name: '飞鸡扑食',
      color: '#ff9f8a',
      dur: 0.44,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        const p = clamp(a.t / a.dur, 0, 1);
        const e = easeOutCubic(p);
        f.pos.x = sx + dir.x * 220 * e;
        f.pos.y = sy + dir.y * 220 * e;
        clampPos(f.pos, f.radius);
        f.z = Math.sin(Math.PI * p) * 96;
        f.invuln = Math.max(f.invuln, 0.06);
        f.vel.x = 0;
        f.vel.y = 0;
        if (p >= 1) {
          f.z = 0;
          w.ring(f.pos.x, f.pos.y, 12, 86, 0.3, '#ffb4a4', 5, false);
          w.burst(f.pos.x, f.pos.y, 16, '#ffb4a4', 240, 4);
          maybeHit(f, w, 10, 480, 86, { stun: 0.12 });
          w.shake(6);
          w.endAction(f);
        }
      },
    });
  },
};

const breath: SkillDef = {
  id: 'breath',
  name: '龙息',
  icon: '焰',
  desc: '持续吐息 0.85 秒，每 0.2 秒 5 伤害并附加 4/s 灼烧。',
  cd: 6,
  windup: 0.5,
  color: '#83cdf0',
  priority: 3,
  ai: { min: 50, max: 168, chance: 0.7 },
  cast(f, w) {
    w.sound('breath');
    f.action = makeAction({
      id: 'breath',
      name: '龙息',
      color: '#83cdf0',
      dur: 0.85,
      data: { lock: 1, acc: 0 },
      update(f, w, a, dt) {
        a.t += dt;
        a.data.acc += dt;
        f.vel.x *= 0.8;
        f.vel.y *= 0.8;
        if (a.data.acc >= 0.2) {
          a.data.acc -= 0.2;
          const t = enemyOf(f, w);
          if (t && !t.dead && withinCone(f, t, 190, 0.6)) {
            w.damage(t, 6, f, { kb: 36, angle: f.facing });
            t.burnT = 3;
            t.burnDps = 4;
          }
        }
        if (w.rng.chance(0.8)) {
          const spread = w.rng.range(-0.3, 0.3);
          const ang = f.facing + spread;
          const d = 60 + w.rng.next() * 120;
          w.burst(
            f.pos.x + Math.cos(f.facing) * 30 + Math.cos(ang) * d,
            f.pos.y + Math.sin(f.facing) * 30 + Math.sin(ang) * d,
            1,
            w.rng.chance(0.4) ? '#d8f5ff' : '#6fc3ea',
            30,
            6,
          );
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const cloud: SkillDef = {
  id: 'cloud',
  name: '腾云驾雾',
  icon: '云',
  desc: '升空 1.8 秒，免疫伤害且移速 +40%，落地砸出 10 伤害。',
  cd: 11,
  windup: 0.3,
  color: '#bfe9ff',
  priority: 3,
  ai: { min: 0, max: 999, hpBelow: 0.68, chance: 0.6 },
  cast(f, w) {
    f.cloudT = 1.8;
    f.invuln = Math.max(f.invuln, 1.85);
    w.sound('cloud');
    w.ring(f.pos.x, f.pos.y, 12, 76, 0.45, '#d6f2ff', 4, false);
    w.burst(f.pos.x, f.pos.y, 16, '#e8f9ff', 110, 4);
    w.text(f.pos.x, f.pos.y - 90, '腾云！', '#2f7fa8', 16);
  },
};

const roll: SkillDef = {
  id: 'roll',
  name: '肉弹滚撞',
  icon: '滚',
  desc: '团身滚动 0.9 秒，霸体，撞到人 10 伤害并击退，撞墙会反弹。',
  cd: 5.5,
  windup: 0.3,
  color: '#ffa7c4',
  priority: 3,
  ai: { min: 72, max: 320, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    w.sound('roll');
    f.action = makeAction({
      id: 'roll',
      name: '肉弹滚撞',
      color: '#ffa7c4',
      dur: 0.92,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.superArmor = true;
        f.vel.x = a.dir.x * 500;
        f.vel.y = a.dir.y * 500;
        f.pos.x += f.vel.x * dt;
        f.pos.y += f.vel.y * dt;

        let bounced = false;
        if (f.pos.x - f.radius < ARENA.x) {
          f.pos.x = ARENA.x + f.radius;
          a.dir = { x: Math.abs(a.dir.x), y: a.dir.y };
          bounced = true;
        } else if (f.pos.x + f.radius > ARENA.x + ARENA.w) {
          f.pos.x = ARENA.x + ARENA.w - f.radius;
          a.dir = { x: -Math.abs(a.dir.x), y: a.dir.y };
          bounced = true;
        }
        if (f.pos.y - f.radius < ARENA.y) {
          f.pos.y = ARENA.y + f.radius;
          a.dir = { x: a.dir.x, y: Math.abs(a.dir.y) };
          bounced = true;
        } else if (f.pos.y + f.radius > ARENA.y + ARENA.h) {
          f.pos.y = ARENA.y + ARENA.h - f.radius;
          a.dir = { x: a.dir.x, y: -Math.abs(a.dir.y) };
          bounced = true;
        }
        if (bounced) {
          f.facing = angleOf(a.dir);
          w.shake(4);
          w.burst(f.pos.x, f.pos.y, 8, '#ffc2d6', 140, 4);
        }

        const target2 = enemyOf(f, w);
        if (!a.hit && target2 && !target2.dead && dist(f.pos, target2.pos) < f.radius + target2.radius + 6) {
          a.hit = true;
          w.damage(target2, 10, f, { kb: 520, angle: angleOf(a.dir), stun: 0.15 });
          w.shake(8);
          w.hitstop = Math.max(w.hitstop, 0.07);
          w.burst(target2.pos.x, target2.pos.y, 16, '#ffc2d6', 260, 5);
        }

        if (w.rng.chance(0.55)) {
          w.burst(
            f.pos.x - a.dir.x * 24 + w.rng.range(-8, 8),
            f.pos.y + f.radius * 0.55,
            1,
            '#ffe6c8',
            50,
            3.5,
          );
        }

        if (a.t >= a.dur) {
          f.superArmor = false;
          w.endAction(f);
        }
      },
      end() {
        f.superArmor = false;
      },
    });
  },
};

const feast: SkillDef = {
  id: 'feast',
  name: '吃饱饱',
  icon: '吃',
  desc: '读条 1 秒回复 18% 最大生命，期间减伤 30%，被打断就没了。',
  cd: 14,
  windup: 0.5,
  color: '#b6e8a0',
  priority: 4,
  ai: { min: 0, max: 999, hpBelow: 0.64, chance: 0.9 },
  cast(f, w) {
    w.sound('eat');
    f.action = makeAction({
      id: 'feast',
      name: '吃饱饱',
      color: '#b6e8a0',
      dur: 1.0,
      data: { lock: 1, tick: 0 },
      update(f, w, a, dt) {
        a.t += dt;
        f.guard = 0.7;
        f.vel.x *= 0.9;
        f.vel.y *= 0.9;
        const ticks = 5;
        const want = Math.floor((a.t / a.dur) * ticks);
        while (a.data.tick < want) {
          a.data.tick += 1;
          w.heal(f, f.maxHp * 0.036);
          if (Math.random() < 0.6) {
            w.burst(f.pos.x, f.pos.y - 20, 2, '#c8ffb0', 60, 5);
          }
        }
        if (a.t >= a.dur) {
          f.guard = 1;
          w.text(f.pos.x, f.pos.y - 76, '吃饱了', '#2f7a3f', 16);
          w.endAction(f);
        }
      },
      end() {
        f.guard = 1;
      },
    });
  },
};

export const BASIC_ATTACK: SkillDef = {
  id: 'basic',
  name: '头槌',
  icon: '槌',
  desc: '贴身头槌，7 伤害。',
  cd: 1.1,
  windup: 0.16,
  color: '#f5e6c8',
  priority: 0,
  ai: { min: 0, max: 999, chance: 1 },
  cast(f, w) {
    f.action = makeAction({
      id: 'basic',
      name: '头槌',
      color: '#f5e6c8',
      dur: 0.24,
      update(f, w, a, dt) {
        a.t += dt;
        if (!a.hit) {
          a.hit = true;
          const t = enemyOf(f, w);
          if (t && !t.dead && withinCone(f, t, 66, 1.0)) {
            w.damage(t, 7, f, { kb: 190, angle: f.facing });
            w.burst(t.pos.x, t.pos.y, 6, '#fff0c9', 120, 3);
          }
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

// ---------------------------------------------------------------- 全角色技能

const pounce: SkillDef = {
  id: 'pounce',
  name: '猛虎扑食',
  icon: '扑',
  desc: '扑出去 240 距离，落地 10 伤害并眩晕 0.2 秒。',
  cd: 7,
  windup: 0.28,
  color: '#ffcf6b',
  priority: 3,
  ai: { min: 90, max: 280, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    const sx = f.pos.x;
    const sy = f.pos.y;
    w.sound('jump');
    f.action = makeAction({
      id: 'pounce',
      name: '猛虎扑食',
      color: '#ffcf6b',
      dur: 0.45,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        const p = clamp(a.t / a.dur, 0, 1);
        const e = easeOutCubic(p);
        f.pos.x = sx + dir.x * 240 * e;
        f.pos.y = sy + dir.y * 240 * e;
        clampPos(f.pos, f.radius);
        f.z = Math.sin(Math.PI * p) * 82;
        f.invuln = Math.max(f.invuln, 0.06);
        f.vel.x = 0;
        f.vel.y = 0;
        if (p >= 1) {
          f.z = 0;
          w.ring(f.pos.x, f.pos.y, 12, 90, 0.3, '#ffd68f', 5, false);
          w.burst(f.pos.x, f.pos.y, 16, '#ffd68f', 240, 5);
          maybeHit(f, w, 10, 360, 90, { stun: 0.2 });
          w.shake(7);
          w.endAction(f);
        }
      },
    });
  },
};

const roar: SkillDef = {
  id: 'roar',
  name: '虎啸',
  icon: '吼',
  desc: '朝四周吼一声，8 伤害并把对手吼飞。',
  cd: 9,
  windup: 0.45,
  color: '#ffb347',
  priority: 2,
  ai: { min: 0, max: 160, chance: 0.85 },
  cast(f, w) {
    w.sound('roar');
    w.ring(f.pos.x, f.pos.y, 16, 170, 0.4, '#ffcf6b', 6, true);
    w.text(f.pos.x, f.pos.y - 80, '吼！', '#b3541e', 22);
    w.shake(8);
    maybeHit(f, w, 8, 520, 170, { stun: 0.25 });
  },
};

const flurry: SkillDef = {
  id: 'flurry',
  name: '连环蹬',
  icon: '蹬',
  desc: '连续蹬三下，每下 6 伤害，最后一击 8 伤害并击退。',
  cd: 3.8,
  windup: 0.14,
  color: '#ffd9e0',
  priority: 3,
  ai: { min: 0, max: 140, chance: 0.95 },
  cast(f, w) {
    const times = [0.03, 0.18, 0.33];
    w.sound('peck');
    f.action = makeAction({
      id: 'flurry',
      name: '连环蹬',
      color: '#ffd9e0',
      dur: 0.5,
      data: { i: 0 },
      update(f, w, a, dt) {
        a.t += dt;
        while (a.data.i < 3 && a.t >= times[a.data.i]) {
          const i = a.data.i;
          a.data.i += 1;
          const t = enemyOf(f, w);
          if (t && !t.dead && dist(f.pos, t.pos) < 185 + t.radius) {
            f.facing = Math.atan2(t.pos.y - f.pos.y, t.pos.x - f.pos.x);
            const last = i === 2;
            w.damage(t, last ? 8 : 6, f, {
              kb: last ? 260 : 0,
              angle: f.facing,
            });
            if (last) w.shake(5);
          }
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const backflip: SkillDef = {
  id: 'backflip',
  name: '兔子蹬鹰',
  icon: '翻',
  desc: '先踹身边的对手一脚，再后空翻拉开 190 距离。',
  cd: 8,
  windup: 0.2,
  color: '#ffb3c4',
  priority: 2,
  ai: { min: 0, max: 120, chance: 0.7 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 110) {
      w.damage(target, 9, f, {
        kb: 280,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.12,
      });
    }
    const dir = target ? norm(sub(f.pos, target.pos)) : fromAngle(f.facing + Math.PI);
    const sx = f.pos.x;
    const sy = f.pos.y;
    f.facing = angleOf(dir);
    w.sound('jump');
    f.action = makeAction({
      id: 'backflip',
      name: '兔子蹬鹰',
      color: '#ffb3c4',
      dur: 0.4,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        const p = clamp(a.t / a.dur, 0, 1);
        const e = easeOutCubic(p);
        f.pos.x = sx + dir.x * 190 * e;
        f.pos.y = sy + dir.y * 190 * e;
        clampPos(f.pos, f.radius);
        f.z = Math.sin(Math.PI * p) * 58;
        f.invuln = Math.max(f.invuln, 0.06);
        f.vel.x = 0;
        f.vel.y = 0;
        if (p >= 1) {
          f.z = 0;
          w.burst(f.pos.x, f.pos.y, 10, '#ffd9e0', 170, 4);
          w.endAction(f);
        }
      },
    });
  },
};

const coil: SkillDef = {
  id: 'coil',
  name: '缠绕',
  icon: '缠',
  desc: '缠住对手 1.2 秒，期间双方都动不了，每 0.4 秒掉 3 血。',
  cd: 8,
  windup: 0.3,
  color: '#b9e08a',
  priority: 3,
  ai: { min: 0, max: 110, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (!target || target.dead || dist(f.pos, target.pos) > 160) {
      w.ring(f.pos.x, f.pos.y, 14, 70, 0.25, '#b9e08a', 3, false);
      return;
    }
    target.stun = Math.max(target.stun, 1.2);
    target.vel = { x: 0, y: 0 };
    w.sound('coil');
    f.action = makeAction({
      id: 'coil',
      name: '缠绕',
      color: '#b9e08a',
      dur: 1.2,
      data: { lock: 1, acc: 0 },
      update(f, w, a, dt) {
        a.t += dt;
        f.vel.x = 0;
        f.vel.y = 0;
        a.data.acc += dt;
        while (a.data.acc >= 0.4) {
          a.data.acc -= 0.4;
          if (!target.dead && target.hidden <= 0) {
            w.damage(target, 3, f, { kb: 0, stun: 0.1 });
            w.burst(target.pos.x, target.pos.y, 4, '#c8f0a0', 80, 3);
          }
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const venom: SkillDef = {
  id: 'venom',
  name: '毒牙突袭',
  icon: '毒',
  desc: '瞬间突进 150 距离，咬中 10 伤害并附加 5 秒蛇毒。',
  cd: 5,
  windup: 0.2,
  color: '#a8d86a',
  priority: 3,
  ai: { min: 0, max: 170, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.pos.x += dir.x * 150;
    f.pos.y += dir.y * 150;
    clampPos(f.pos, f.radius);
    f.invuln = Math.max(f.invuln, 0.15);
    w.sound('venom');
    w.burst(f.pos.x, f.pos.y, 12, '#b9e08a', 170, 4);
    if (target && !target.dead && dist(f.pos, target.pos) < f.radius + target.radius + 30) {
      w.damage(target, 14, f, { kb: 140, angle: angleOf(dir) });
      target.burnT = 5;
      target.burnDps = 2;
    }
  },
};

const gallop: SkillDef = {
  id: 'gallop',
  name: '千里奔袭',
  icon: '奔',
  desc: '直线狂奔 0.9 秒，撞到人 13 伤害并击退，可以穿过对手。',
  cd: 7,
  windup: 0.2,
  color: '#e8c07a',
  priority: 3,
  ai: { min: 100, max: 340, chance: 0.75 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    w.sound('gallop');
    f.action = makeAction({
      id: 'gallop',
      name: '千里奔袭',
      color: '#e8c07a',
      dur: 0.9,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.pos.x += a.dir.x * 540 * dt;
        f.pos.y += a.dir.y * 540 * dt;
        const hitWall =
          f.pos.x - f.radius <= ARENA.x ||
          f.pos.x + f.radius >= ARENA.x + ARENA.w ||
          f.pos.y - f.radius <= ARENA.y ||
          f.pos.y + f.radius >= ARENA.y + ARENA.h;
        clampPos(f.pos, f.radius);
        const t = enemyOf(f, w);
        if (!a.hit && t && !t.dead && dist(f.pos, t.pos) < f.radius + t.radius + 6) {
          a.hit = true;
          w.damage(t, 13, f, { kb: 340, angle: angleOf(a.dir), stun: 0.1 });
          w.burst(t.pos.x, t.pos.y, 10, '#ffe0a3', 200, 4);
        }
        if (hitWall || a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

const spinKick: SkillDef = {
  id: 'spinKick',
  name: '回旋踢',
  icon: '旋',
  desc: '原地扫一圈，16 伤害并击退身边的对手。',
  cd: 6,
  windup: 0.3,
  color: '#ffe0a3',
  priority: 2,
  ai: { min: 0, max: 100, chance: 0.9 },
  cast(f, w) {
    w.sound('gore');
    w.ring(f.pos.x, f.pos.y, 16, 100, 0.32, '#ffe0a3', 6, true);
    w.burst(f.pos.x, f.pos.y, 14, '#ffe0a3', 200, 4);
    maybeHit(f, w, 16, 420, 110, { stun: 0.15 });
  },
};

const wool: SkillDef = {
  id: 'wool',
  name: '羊毛护体',
  icon: '毛',
  desc: '给自己套 32 点护盾，同时对 180 范围造成 10 伤害。',
  cd: 10,
  windup: 0.2,
  color: '#f7f0dd',
  priority: 4,
  ai: { min: 0, max: 190, hpBelow: 0.85, chance: 0.6 },
  cast(f, w) {
    f.shield = Math.max(f.shield, 32);
    f.shieldT = 4;
    f.slowT = Math.max(f.slowT, 4);
    f.slowMul = 0.9;
    w.sound('shield');
    w.ring(f.pos.x, f.pos.y, 14, 180, 0.45, '#f7f0dd', 7, true);
    w.text(f.pos.x, f.pos.y - 70, '羊毛护体', '#8a6a2e', 15);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 180) {
      w.damage(target, 10, f, {
        kb: 320,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.15,
      });
    }
  },
};

const ram: SkillDef = {
  id: 'ram',
  name: '头槌',
  icon: '槌',
  desc: '近身一记头槌，10 伤害并击退；有护盾时额外 +5 伤害。',
  cd: 5,
  windup: 0.25,
  color: '#e8d9b8',
  priority: 2,
  ai: { min: 0, max: 110, chance: 0.9 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (target && withinCone(f, target, 150, Math.PI * 0.55)) {
      const bonus = f.shield > 0 ? 5 : 0;
      w.damage(target, 10 + bonus, f, {
        kb: 520,
        angle: f.facing,
        stun: 0.35,
      });
      w.ring(f.pos.x, f.pos.y, 14, 100, 0.3, '#ffe6b0', 5, false);
      w.shake(6);
    }
  },
};

const somersault: SkillDef = {
  id: 'somersault',
  name: '筋斗云',
  icon: '云',
  desc: '翻出去 300 距离，空中无敌，落地 8 伤害。',
  cd: 6,
  windup: 0.18,
  color: '#ffe0a3',
  priority: 2,
  ai: { min: 0, max: 300, chance: 0.65 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    const sx = f.pos.x;
    const sy = f.pos.y;
    w.sound('cloud');
    f.action = makeAction({
      id: 'somersault',
      name: '筋斗云',
      color: '#ffe0a3',
      dur: 0.5,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        const p = clamp(a.t / a.dur, 0, 1);
        const e = easeOutCubic(p);
        f.pos.x = sx + dir.x * 300 * e;
        f.pos.y = sy + dir.y * 300 * e;
        clampPos(f.pos, f.radius);
        f.z = Math.sin(Math.PI * p) * 110;
        f.invuln = Math.max(f.invuln, 0.06);
        f.vel.x = 0;
        f.vel.y = 0;
        if (p >= 1) {
          f.z = 0;
          w.ring(f.pos.x, f.pos.y, 10, 78, 0.3, '#ffe0a3', 4, false);
          w.burst(f.pos.x, f.pos.y, 12, '#ffe0a3', 200, 4);
          maybeHit(f, w, 10, 300, 78, { stun: 0.1 });
          w.endAction(f);
        }
      },
    });
  },
};

const banana: SkillDef = {
  id: 'banana',
  name: '香蕉皮',
  icon: '蕉',
  desc: '朝对手方向丢一块香蕉皮，落地后永久留在场上且没有数量上限；踩中滑倒 1 秒并受 6 伤害。',
  cd: 4,
  windup: 0.2,
  color: '#ffe07a',
  priority: 2,
  ai: { min: 0, max: 999, chance: 0.55 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const angle = target && !target.dead ? angleOf(sub(target.pos, f.pos)) : f.facing;
    const throwDist = 120;
    const x = clamp(f.pos.x + Math.cos(angle) * throwDist, ARENA.x + 24, ARENA.x + ARENA.w - 24);
    const y = clamp(f.pos.y + Math.sin(angle) * throwDist, ARENA.y + 24, ARENA.y + ARENA.h - 24);
    w.sound('egg');
    w.spawnTrap(x, y, f.side, 'banana');
    w.ring(x, y, 8, 38, 0.25, '#ffe07a', 3, false);
    w.burst(x, y, 8, '#ffe07a', 120, 3);
  },
};

const bite: SkillDef = {
  id: 'bite',
  name: '锁喉咬',
  icon: '咬',
  desc: '咬住对手 0.9 秒，11 伤害并定身。',
  cd: 6,
  windup: 0.25,
  color: '#e8c9a0',
  priority: 3,
  ai: { min: 0, max: 100, chance: 0.9 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (target && withinCone(f, target, 140, 0.9)) {
      w.damage(target, 12, f, { kb: 60, angle: f.facing, stun: 0.9 });
      w.text(target.pos.x, target.pos.y - 50, '咬住！', '#8a5a00', 15);
      w.shake(5);
    }
  },
};

const guardDog: SkillDef = {
  id: 'guardDog',
  name: '看门狗',
  icon: '守',
  desc: '3 秒内被打就自动反咬一口：14 伤害并击退。',
  cd: 9,
  windup: 0.2,
  color: '#d8b27a',
  priority: 4,
  ai: { min: 0, max: 999, hpBelow: 0.8, chance: 0.5 },
  cast(f, w) {
    f.counterT = 3;
    f.shield = Math.max(f.shield, 0);
    w.sound('shield');
    w.ring(f.pos.x, f.pos.y, 12, 72, 0.35, '#d8b27a', 4, false);
    w.text(f.pos.x, f.pos.y - 70, '看门狗', '#8a5a00', 15);
  },
};

const shell: SkillDef = {
  id: 'shell',
  name: '硬壳',
  icon: '壳',
  desc: '缩壳 2 秒，受伤 -75%，结束时炸壳 15 伤害。',
  cd: 8,
  windup: 0.1,
  color: '#f2e2bd',
  priority: 4,
  ai: { min: 0, max: 999, hpBelow: 0.7, chance: 0.7 },
  cast(f, w) {
    w.sound('shell');
    f.action = makeAction({
      id: 'shell',
      name: '硬壳',
      color: '#f2e2bd',
      dur: 2,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.guard = 0.25;
        f.vel.x = 0;
        f.vel.y = 0;
        if (a.t >= a.dur) {
          f.guard = 1;
          w.ring(f.pos.x, f.pos.y, 12, 110, 0.35, '#ffd166', 6, true);
          w.burst(f.pos.x, f.pos.y, 20, '#ffe6a0', 280, 5);
          w.shake(8);
          maybeHit(f, w, 26, 420, 110, { stun: 0.15 });
          w.endAction(f);
        }
      },
      end() {
        f.guard = 1;
      },
    });
  },
};

const hatch: SkillDef = {
  id: 'hatch',
  name: '孵化',
  icon: '孵',
  desc: '破壳变成随机一只奶蛙，按新形态 60% 血量继续打。',
  cd: 999,
  windup: 0.8,
  color: '#fff3d6',
  priority: 5,
  ai: { min: 0, max: 999, hpBelow: 0.6, chance: 1 },
  cast(f, w) {
    const pool = CHARS.filter((c) => c.id !== 'naidan');
    const def = pool[w.rng.int(0, pool.length - 1)];
    f.def = def;
    f.maxHp = def.hp;
    f.hp = Math.max(1, Math.round(def.hp * 0.8));
    f.radius = def.radius;
    f.mass = def.mass;
    f.speed = def.speed;
    f.baseAtk = def.atk;
    f.atk = def.atk;
    f.kbr = def.kbr;
    f.cds = [1.5, 2.5];
    f.buffStacks = 0;
    w.sound('hatch');
    w.ring(f.pos.x, f.pos.y, 16, 120, 0.5, '#fff3d6', 6, false);
    w.burst(f.pos.x, f.pos.y, 26, '#fff3d6', 260, 5);
    w.text(f.pos.x, f.pos.y - 70, `孵出 ${def.name}！`, '#c85a00', 18);
    w.shake(6);
  },
};

const lieFlat: SkillDef = {
  id: 'lieFlat',
  name: '躺平',
  icon: '躺',
  desc: '躺 2 秒，每秒回 3% 血，受伤 -45%，但不能动。',
  cd: 12,
  windup: 0.2,
  color: '#f0c98a',
  priority: 4,
  ai: { min: 0, max: 999, hpBelow: 0.7, chance: 0.8 },
  cast(f, w) {
    w.sound('eat');
    f.action = makeAction({
      id: 'lieFlat',
      name: '躺平',
      color: '#f0c98a',
      dur: 2,
      data: { lock: 1, acc: 0 },
      update(f, w, a, dt) {
        a.t += dt;
        f.guard = 0.55;
        f.vel.x = 0;
        f.vel.y = 0;
        a.data.acc += dt;
        while (a.data.acc >= 0.4) {
          a.data.acc -= 0.4;
          w.heal(f, f.maxHp * 0.04);
        }
        if (a.t >= a.dur) {
          f.guard = 1;
          w.endAction(f);
        }
      },
      end() {
        f.guard = 1;
      },
    });
  },
};

const delivery: SkillDef = {
  id: 'delivery',
  name: '外卖到了',
  icon: '饭',
  desc: '0.7 秒后一份外卖砸在对手头上：18 伤害 + 眩晕。',
  cd: 9,
  windup: 0.4,
  color: '#ffb347',
  priority: 3,
  ai: { min: 0, max: 260, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const x = target ? target.pos.x : f.pos.x;
    const y = target ? target.pos.y : f.pos.y;
    w.sound('delivery');
    w.spawnBlast(x, y, f.side, 0.7, 120, 18, '#ffb347', 420, 0.25);
  },
};

const stinkSelf: SkillDef = {
  id: 'stinkSelf',
  name: '臭气熏天',
  icon: '臭',
  desc: '在脚下放一团 3.2 秒的臭云，减速并持续掉血。',
  cd: 5.5,
  windup: 0.25,
  color: '#b9e79a',
  priority: 2,
  ai: { min: 0, max: 999, chance: 0.5 },
  cast(f, w) {
    w.sound('fart');
    w.spawnStink(f.pos.x, f.pos.y, f.side, 180);
    w.ring(f.pos.x, f.pos.y, 8, 70, 0.3, '#b9e79a', 4, false);
  },
};

const poopBomb: SkillDef = {
  id: 'poopBomb',
  name: '甩屎',
  icon: '屎',
  desc: '扔出一团会弹的便便，落地留一团臭云，砸中 4 伤害。',
  cd: 5,
  windup: 0.2,
  color: '#a9834a',
  priority: 3,
  ai: { min: 60, max: 300, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    w.sound('poop');
    w.spawnPoop(
      f.side,
      f.pos.x + dir.x * (f.radius + 22),
      f.pos.y + dir.y * (f.radius + 22),
      angleOf(dir),
    );
  },
};

const abyss: SkillDef = {
  id: 'abyss',
  name: '鱼符·深渊',
  icon: '渊',
  desc: '在对手脚下开一个深渊漩涡：落地 4 伤，持续 1.5 秒把人往中心拽，最后炸开 11 伤害。',
  cd: 10,
  windup: 0.35,
  color: '#6fd3ff',
  priority: 4,
  ai: { min: 0, max: 420, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (!target || target.dead) return;
    const x = Math.max(ARENA.x + 24, Math.min(ARENA.x + ARENA.w - 24, target.pos.x));
    const y = Math.max(ARENA.y + 24, Math.min(ARENA.y + ARENA.h - 24, target.pos.y));
    w.sound('vortex');
    w.spawnVortex(x, y, f.side);
    w.damage(target, 4, f, {
      kb: 100,
      angle: angleOf(sub(target.pos, f.pos)),
      stun: 0.1,
    });
    w.ring(x, y, 12, 72, 0.35, '#8fdcff', 6, true);
    w.text(x, y - 46, '深渊！', '#2f6f8f', 16);
  },
};

const fishBubbles: SkillDef = {
  id: 'fishBubbles',
  name: '泡泡弹幕',
  icon: '泡',
  desc: '吐 3 个弹墙泡泡，命中 7 伤害并减速。',
  cd: 4.5,
  windup: 0.25,
  color: '#bfe9ff',
  priority: 2,
  ai: { min: 40, max: 260, chance: 0.9 },
  cast(f, w) {
    w.sound('bubble');
    for (const off of [-0.32, 0, 0.32]) {
      const a = f.facing + off;
      w.spawnBubble(
        f.side,
        f.pos.x + Math.cos(a) * (f.radius + 12),
        f.pos.y + Math.sin(a) * (f.radius + 12),
        a,
      );
    }
  },
};

const slippery: SkillDef = {
  id: 'slippery',
  name: '滑不溜秋',
  icon: '滑',
  desc: '3 秒内 38% 概率闪掉伤害，移速 +20%，起手回 6% 血并用水花震退 160 范围内对手 8 伤。',
  cd: 8,
  windup: 0.15,
  color: '#a8d8f0',
  priority: 4,
  ai: { min: 0, max: 999, chance: 0.75 },
  cast(f, w) {
    f.dodgeT = 3;
    w.heal(f, f.maxHp * 0.06);
    w.sound('blink');
    w.ring(f.pos.x, f.pos.y, 10, 160, 0.4, '#a8d8f0', 6, true);
    w.text(f.pos.x, f.pos.y - 68, '滑溜！', '#2f7fa8', 15);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 160) {
      w.damage(target, 8, f, {
        kb: 220,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.1,
      });
    }
  },
};

const smite: SkillDef = {
  id: 'smite',
  name: '圣光审判',
  icon: '光',
  desc: '0.6 秒后一道光柱落下：22 伤害并净化自身负面。',
  cd: 9,
  windup: 0.5,
  color: '#fff3d6',
  priority: 3,
  ai: { min: 0, max: 260, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const x = target ? target.pos.x : f.pos.x;
    const y = target ? target.pos.y : f.pos.y;
    f.burnT = 0;
    f.slowT = 0;
    w.sound('smite');
    w.spawnBlast(x, y, f.side, 0.6, 130, 22, '#fff3d6', 380, 0.25);
  },
};

const revive: SkillDef = {
  id: 'revive',
  name: '复活',
  icon: '活',
  desc: '被动：死亡时以 35% 血原地复活一次，并获得 2 秒无敌。',
  cd: 999,
  windup: 0.1,
  color: '#fff3d6',
  priority: 0,
  ai: { min: 0, max: 0, chance: 0 },
  cast() {
    // passive, triggered in World.kill
  },
};

// ---------------------------------------------------------------- 新活儿

const swallow: SkillDef = {
  id: 'swallow',
  name: '吞天',
  icon: '吞',
  desc: '把对手吞进肚子 1.1 秒再吐出来，造成 14 伤害并击退。',
  cd: 9,
  windup: 0.35,
  color: '#9ad96d',
  priority: 3,
  ai: { min: 0, max: 100, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const reach = f.radius + (target?.radius ?? 30) + 72;
    if (!target || target.dead || dist(f.pos, target.pos) > reach) {
      w.ring(f.pos.x, f.pos.y, 16, 76, 0.3, '#9ad96d', 3, false);
      return;
    }

    w.sound('swallow');
    if (target.action) w.endAction(target);
    target.windup = null;
    target.hidden = 1.1;
    target.stun = 1.1;
    target.burnT = 0;
    target.vel = { x: 0, y: 0 };
    f.belly = 1;
    w.ring(f.pos.x, f.pos.y, 20, 90, 0.35, '#c8f7a0', 5, false);

    const release = (deal: boolean): void => {
      if (target.hidden <= 0) return;
      const dir = fromAngle(f.facing);
      target.hidden = 0;
      target.invuln = 0;
      target.stun = 0.22;
      target.pos = add(f.pos, mul(dir, f.radius + target.radius + 20));
      clampPos(target.pos, target.radius);
      w.burst(target.pos.x, target.pos.y, 10, '#d7ffc0', 180, 4);
      w.ring(target.pos.x, target.pos.y, 8, 50, 0.25, '#d7ffc0', 4, false);
      if (deal) {
        w.damage(target, 14, f, { kb: 420, angle: f.facing, stun: 0.25 });
        w.shake(7);
      }
    };

    f.action = makeAction({
      id: 'swallow',
      name: '吞天',
      color: '#9ad96d',
      dur: 1.1,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.vel.x = 0;
        f.vel.y = 0;
        if (a.t >= a.dur) {
          release(true);
          w.endAction(f);
        }
      },
      end() {
        release(false);
      },
    });
  },
};

const bubbles: SkillDef = {
  id: 'bubbles',
  name: '泡泡浴',
  icon: '泡',
  desc: '吹出 3 个会在墙上弹跳的泡泡，命中造成 7 伤害并减速。',
  cd: 5,
  windup: 0.25,
  color: '#bfe9ff',
  priority: 2,
  ai: { min: 40, max: 240, chance: 0.85 },
  cast(f, w) {
    w.sound('bubble');
    for (const off of [-0.3, 0, 0.3]) {
      const a = f.facing + off;
      w.spawnBubble(
        f.side,
        f.pos.x + Math.cos(a) * (f.radius + 12),
        f.pos.y + Math.sin(a) * (f.radius + 12),
        a,
      );
    }
  },
};

const milkball: SkillDef = {
  id: 'milkball',
  name: '反刍奶球',
  icon: '球',
  desc: '吐出一颗满场弹跳的奶球，命中 6 伤害，连自己也会被砸。',
  cd: 7,
  windup: 0.4,
  color: '#fff3d0',
  priority: 3,
  ai: { min: 70, max: 360, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir =
      target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    w.sound('milk');
    w.spawnMilk(
      f.side,
      f.pos.x + dir.x * (f.radius + 28),
      f.pos.y + dir.y * (f.radius + 28),
      angleOf(dir),
    );
  },
};

const swap: SkillDef = {
  id: 'swap',
  name: '偷天换日',
  icon: '换',
  desc: '和对手瞬间交换位置，对手落地挨 10 伤害，双方短暂无敌。',
  cd: 8,
  windup: 0.25,
  color: '#ffd166',
  priority: 3,
  ai: { min: 60, max: 999, chance: 0.55 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (!target || target.dead || target.hidden > 0) return;
    const a = { x: f.pos.x, y: f.pos.y };
    const b = { x: target.pos.x, y: target.pos.y };
    f.pos = { x: b.x, y: b.y };
    target.pos = { x: a.x, y: a.y };
    clampPos(f.pos, f.radius);
    clampPos(target.pos, target.radius);
    f.vel = mul(f.vel, 0.2);
    target.vel = mul(target.vel, 0.2);

    w.sound('swap');
    w.ring(a.x, a.y, 10, 70, 0.3, '#ffe49a', 5, false);
    w.ring(b.x, b.y, 10, 70, 0.3, '#ffe49a', 5, false);
    w.burst(a.x, a.y, 12, '#ffe49a', 160, 4);
    w.burst(b.x, b.y, 12, '#ffe49a', 160, 4);

    w.damage(target, 10, f, { kb: 0, stun: 0.35 });
    target.invuln = Math.max(target.invuln, 0.35);
    f.invuln = Math.max(f.invuln, 0.35);
    f.stun = Math.max(f.stun, 0.15);
  },
};

const egg: SkillDef = {
  id: 'egg',
  name: '下蛋',
  icon: '蛋',
  desc: '在脚下下一颗蛋，1.1 秒后武装，敌人靠近就炸：14 伤害，自己也会被炸。',
  cd: 6,
  windup: 0.3,
  color: '#ffd166',
  priority: 2,
  ai: { min: 0, max: 999, chance: 0.4 },
  cast(f, w) {
    w.sound('egg');
    w.spawnTrap(f.pos.x, f.pos.y + f.radius * 0.5, f.side);
    w.ring(f.pos.x, f.pos.y, 8, 42, 0.25, '#ffe49a', 3, false);
  },
};

const vortex: SkillDef = {
  id: 'vortex',
  name: '龙吸水',
  icon: '吸',
  desc: '在对手脚下召出水旋涡，1.5 秒内把双方往里吸，最后炸出 11 伤害。',
  cd: 10,
  windup: 0.45,
  color: '#8fdcff',
  priority: 3,
  ai: { min: 60, max: 260, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    let x = target && !target.dead ? target.pos.x : f.pos.x + Math.cos(f.facing) * 120;
    let y = target && !target.dead ? target.pos.y : f.pos.y + Math.sin(f.facing) * 120;
    x = Math.max(ARENA.x + 70, Math.min(ARENA.x + ARENA.w - 70, x));
    y = Math.max(ARENA.y + 70, Math.min(ARENA.y + ARENA.h - 70, y));
    w.sound('vortex');
    w.spawnVortex(x, y, f.side);
    w.ring(x, y, 8, 110, 0.35, '#8fdcff', 4, false);
  },
};

const fart: SkillDef = {
  id: 'fart',
  name: '屁动力',
  icon: '屁',
  desc: '朝对手放一个响屁把自己崩出去，撞到人 8 伤害，原地留一团臭云。',
  cd: 8,
  windup: 0.2,
  color: '#b6e8a0',
  priority: 2,
  ai: { min: 0, max: 999, chance: 0.6 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir =
      target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    w.sound('fart');
    w.spawnStink(f.pos.x - dir.x * 8, f.pos.y - dir.y * 8, f.side);
    w.ring(f.pos.x, f.pos.y, 8, 54, 0.3, '#c8f0b0', 4, false);
    f.action = makeAction({
      id: 'fart',
      name: '屁动力',
      color: '#b6e8a0',
      dur: 0.3,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.pos.x += a.dir.x * 520 * dt;
        f.pos.y += a.dir.y * 520 * dt;
        clampPos(f.pos, f.radius);
        const foe = enemyOf(f, w);
        if (
          !a.hit &&
          foe &&
          !foe.dead &&
          dist(f.pos, foe.pos) < f.radius + foe.radius + 6
        ) {
          a.hit = true;
          w.damage(foe, 8, f, { kb: 320, angle: angleOf(a.dir), stun: 0.1 });
          w.burst(foe.pos.x, foe.pos.y, 10, '#c8f0b0', 170, 4);
        }
        if (a.t >= a.dur) w.endAction(f);
      },
    });
  },
};

// ---------------------------------------------------------------- 十二符咒

const ratAnimate: SkillDef = {
  id: 'ratAnimate',
  name: '鼠符·活物',
  icon: '鼠',
  desc: '召唤一只有 14 点独立血量的活老鼠，它会追着对手咬，被打完才消失；没有数量上限。',
  cd: 7,
  windup: 0.3,
  color: '#d9c27a',
  priority: 3,
  ai: { min: 0, max: 999, chance: 0.7 },
  cast(f, w) {
    w.sound('rat');
    w.spawnMouseSummon(f);
    w.ring(f.pos.x, f.pos.y, 8, 54, 0.3, '#ffe08a', 4, false);
    w.text(f.pos.x, f.pos.y - 72, '活过来！', '#8a5a00', 15);
  },
};

const oxStrength: SkillDef = {
  id: 'oxStrength',
  name: '牛符·神力',
  icon: '力',
  desc: '7 秒内伤害 +30%，击退更猛。',
  cd: 10,
  windup: 0.2,
  color: '#ffb347',
  priority: 4,
  ai: { min: 0, max: 170, chance: 0.6 },
  cast(f, w) {
    f.strengthT = 7;
    w.sound('strength');
    w.ring(f.pos.x, f.pos.y, 12, 160, 0.45, '#ffcf6b', 7, true);
    w.text(f.pos.x, f.pos.y - 74, '神力！', '#b3541e', 17);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 160) {
      w.damage(target, 5, f, {
        kb: 380,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.15,
      });
    }
  },
};

const tigerSplit: SkillDef = {
  id: 'tigerSplit',
  name: '虎符·分裂',
  icon: '分',
  desc: '分裂出另一只奶虎；两只奶虎各自独立血量，一只倒下另一只还能打。',
  cd: 16,
  windup: 0.45,
  color: '#ffe6a0',
  priority: 4,
  ai: { min: 0, max: 999, hpBelow: 0.95, chance: 0.9 },
  cast(f, w) {
    if (!w.splitTiger(f)) {
      w.text(f.pos.x, f.pos.y - 70, '已经分裂过了', '#8a5a00', 14);
      return;
    }
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 160) {
      w.damage(target, 12, f, {
        kb: 300,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.15,
      });
    }
    w.sound('strength');
    w.text(f.pos.x, f.pos.y - 70, '一分为二！', '#b3541e', 18);
  },
};

const rabbitHaste: SkillDef = {
  id: 'rabbitHaste',
  name: '兔符·疾速',
  icon: '速',
  desc: '3.5 秒内移速 ×1.8，起手震退 130 范围内对手 6 伤。',
  cd: 9,
  windup: 0.15,
  color: '#ffd9e0',
  priority: 4,
  ai: { min: 0, max: 140, chance: 0.65 },
  cast(f, w) {
    f.hasteT = 3.5;
    w.sound('haste');
    w.ring(f.pos.x, f.pos.y, 10, 130, 0.4, '#ffb3c4', 6, true);
    w.text(f.pos.x, f.pos.y - 72, '疾速！', '#b23a58', 16);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 130) {
      w.damage(target, 6, f, {
        kb: 260,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.1,
      });
    }
  },
};

const dragonFire: SkillDef = {
  id: 'dragonFire',
  name: '龙符·烈焰',
  icon: '焰',
  desc: '吐出一颗火球，命中或撞墙后爆炸，范围 16 伤害。',
  cd: 6,
  windup: 0.35,
  color: '#ff9a3d',
  priority: 3,
  ai: { min: 60, max: 340, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir =
      target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    w.sound('fire');
    w.spawnFire(
      f.side,
      f.pos.x + dir.x * (f.radius + 26),
      f.pos.y + dir.y * (f.radius + 26),
      angleOf(dir),
    );
  },
};

const snakeInvis: SkillDef = {
  id: 'snakeInvis',
  name: '蛇符·隐身',
  icon: '隐',
  desc: '隐身 2.8 秒，下一次命中额外 +80% 伤害。',
  cd: 9,
  windup: 0.2,
  color: '#b9e08a',
  priority: 4,
  ai: { min: 0, max: 999, chance: 0.65 },
  cast(f, w) {
    f.invisT = 2.8;
    w.sound('invis');
    w.ring(f.pos.x, f.pos.y, 10, 70, 0.4, '#b9e08a', 4, false);
    w.burst(f.pos.x, f.pos.y, 16, '#c8f0a0', 120, 5);
  },
};

const horseHeal: SkillDef = {
  id: 'horseHeal',
  name: '马符·治愈',
  icon: '愈',
  desc: '3.2 秒内持续回复共 15% 生命，并清除灼烧和减速。',
  cd: 11,
  windup: 0.2,
  color: '#b9f0a0',
  priority: 4,
  ai: { min: 0, max: 160, hpBelow: 0.8, chance: 0.8 },
  cast(f, w) {
    f.regenT = 3.2;
    f.regenAcc = 0.4;
    f.burnT = 0;
    f.slowT = 0;
    w.sound('heal');
    w.ring(f.pos.x, f.pos.y, 12, 150, 0.45, '#b9f0a0', 6, true);
    w.text(f.pos.x, f.pos.y - 74, '治愈', '#2f7a3f', 17);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 150) {
      w.damage(target, 10, f, {
        kb: 300,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.15,
      });
    }
  },
};

const sheepAstral: SkillDef = {
  id: 'sheepAstral',
  name: '羊符·出窍',
  icon: '魂',
  desc: '灵魂出窍 2 秒：无敌、移速 +25%，出窍瞬间对 200 范围造成 11 伤害。',
  cd: 11,
  windup: 0.2,
  color: '#d8e8ff',
  priority: 4,
  ai: { min: 0, max: 210, hpBelow: 0.85, chance: 0.7 },
  cast(f, w) {
    f.astralT = 2;
    f.invuln = Math.max(f.invuln, 2.1);
    w.sound('astral');
    w.ring(f.pos.x, f.pos.y, 12, 200, 0.5, '#d8e8ff', 7, true);
    w.text(f.pos.x, f.pos.y - 76, '灵魂出窍', '#3a4a7a', 16);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 200) {
      w.damage(target, 11, f, {
        kb: 320,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.2,
      });
    }
  },
};

const monkeyMimic: SkillDef = {
  id: 'monkeyMimic',
  name: '猴符·模仿',
  icon: '仿',
  desc: '模仿对手最近放过的技能，立刻用同一招还回去；对手还没出招时，改扔一块香蕉皮。',
  cd: 12,
  windup: 0.25,
  color: '#ffe0a3',
  priority: 4,
  ai: { min: 0, max: 999, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const id = target?.lastSkillId ?? null;
    const banned = new Set(['monkeyMimic', 'monkeyHex', 'monkeyCopy', 'hatch', 'tigerSplit', 'revive']);
    if (id && !banned.has(id)) {
      const def = skillById(id);
      w.sound('steal');
      w.ring(f.pos.x, f.pos.y, 12, 120, 0.4, '#ffe0a3', 6, true);
      w.text(f.pos.x, f.pos.y - 72, `模仿·${def.name}`, '#8a5a00', 16);
      def.cast(f, w, target);
    } else {
      w.text(f.pos.x, f.pos.y - 72, '没招可抄，扔香蕉', '#8a5a00', 14);
      banana.cast(f, w, target);
    }
  },
};

const roosterLevitate: SkillDef = {
  id: 'roosterLevitate',
  name: '鸡符·漂浮',
  icon: '浮',
  desc: '把对手飘到半空 1 秒，落地再摔 8 伤害。',
  cd: 11,
  windup: 0.4,
  color: '#ffe6a0',
  priority: 4,
  ai: { min: 0, max: 300, chance: 0.85 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    if (!target || target.dead || dist(f.pos, target.pos) > 320) return;
    target.floatT = 1.0;
    target.stun = Math.max(target.stun, 0.2);
    target.vel = { x: 0, y: 0 };
    w.sound('levitate');
    w.ring(target.pos.x, target.pos.y, 10, 70, 0.4, '#ffe6a0', 4, false);
    w.text(target.pos.x, target.pos.y - 50, '飘起来了！', '#8a5a00', 15);
  },
};

const dogImmortal: SkillDef = {
  id: 'dogImmortal',
  name: '狗符·不死',
  icon: '生',
  desc: '2.5 秒内血量不会低于 1，并立刻回复 12% 生命。',
  cd: 12,
  windup: 0.2,
  color: '#ffe6a0',
  priority: 5,
  ai: { min: 0, max: 180, hpBelow: 0.55, chance: 0.9 },
  cast(f, w) {
    f.immortalT = 2.5;
    w.heal(f, f.maxHp * 0.08);
    w.sound('immortal');
    w.ring(f.pos.x, f.pos.y, 14, 170, 0.5, '#ffe6a0', 8, true);
    w.text(f.pos.x, f.pos.y - 76, '不死之身！', '#8a5a00', 17);
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 170) {
      w.damage(target, 7, f, {
        kb: 360,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.2,
      });
    }
  },
};

const pigLaser: SkillDef = {
  id: 'pigLaser',
  name: '猪符·激光',
  icon: '光',
  desc: '双眼射出 420 距离的激光，命中 9 伤害并灼烧。',
  cd: 7,
  windup: 0.3,
  color: '#ff5a4d',
  priority: 3,
  ai: { min: 60, max: 420, chance: 0.9 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir =
      target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    const len = 420;
    const x2 = f.pos.x + dir.x * len;
    const y2 = f.pos.y + dir.y * len;
    const ox = -dir.y * 11;
    const oy = dir.x * 11;
    w.sound('laser');
    w.beam(f.pos.x + ox, f.pos.y + oy, x2 + ox, y2 + oy, 0.28, '#ff8a6a', 7);
    w.beam(f.pos.x - ox, f.pos.y - oy, x2 - ox, y2 - oy, 0.28, '#ff8a6a', 7);
    w.shake(6);
    if (target && !target.dead && withinCone(f, target, len, 0.24)) {
      w.damage(target, 9, f, { kb: 200, angle: angleOf(dir) });
      target.burnT = 2.5;
      target.burnDps = 2;
      w.burst(target.pos.x, target.pos.y, 12, '#ff8a6a', 220, 4);
    }
  },
};

const laugh: SkillDef = {
  id: 'laugh',
  name: '大笑',
  icon: '笑',
  desc: '仰天大笑，回复 8% 生命，把 235 范围内的人震退 10 伤。',
  cd: 7.5,
  windup: 0.35,
  color: '#ffd166',
  priority: 3,
  ai: { min: 0, max: 155, chance: 0.8 },
  cast(f, w) {
    w.sound('laugh');
    w.heal(f, f.maxHp * 0.08);
    w.ring(f.pos.x, f.pos.y, 16, 235, 0.5, '#ffd166', 8, true);
    w.ring(f.pos.x, f.pos.y, 8, 90, 0.3, '#ffe6a0', 3, false);
    w.text(f.pos.x, f.pos.y - 84, '哈哈哈哈哈', '#b3541e', 20);
    w.shake(6);
    for (let i = 0; i < 8; i++) {
      const a = w.rng.range(0, Math.PI * 2);
      w.burst(f.pos.x + Math.cos(a) * 30, f.pos.y + Math.sin(a) * 20, 1, '#ffe08a', 90, 4);
    }
    const target = enemyOf(f, w);
    if (target && !target.dead && dist(f.pos, target.pos) < 235) {
      w.damage(target, 10, f, {
        kb: 420,
        angle: angleOf(sub(target.pos, f.pos)),
        stun: 0.25,
      });
    }
  },
};

const laughRoll: SkillDef = {
  id: 'laughRoll',
  name: '笑到打滚',
  icon: '滚',
  desc: '笑得在地上打滚，撞到人 8 伤并击退，滚动时霸体。',
  cd: 8.5,
  windup: 0.25,
  color: '#ffcf6b',
  priority: 3,
  ai: { min: 70, max: 320, chance: 0.8 },
  cast(f, w, t) {
    const target = t ?? enemyOf(f, w);
    const dir = target && !target.dead ? norm(sub(target.pos, f.pos)) : fromAngle(f.facing);
    f.facing = angleOf(dir);
    w.sound('roll');
    f.action = makeAction({
      id: 'laughRoll',
      name: '笑到打滚',
      color: '#ffcf6b',
      dur: 0.75,
      dir,
      data: { lock: 1 },
      update(f, w, a, dt) {
        a.t += dt;
        f.superArmor = true;
        f.pos.x += a.dir.x * 520 * dt;
        f.pos.y += a.dir.y * 520 * dt;
        const hitWall =
          f.pos.x - f.radius <= ARENA.x ||
          f.pos.x + f.radius >= ARENA.x + ARENA.w ||
          f.pos.y - f.radius <= ARENA.y ||
          f.pos.y + f.radius >= ARENA.y + ARENA.h;
        clampPos(f.pos, f.radius);
        if (w.rng.chance(0.5)) {
          w.burst(f.pos.x - a.dir.x * 18, f.pos.y + f.radius * 0.5, 1, '#ffe6c8', 50, 3);
        }
        const t2 = enemyOf(f, w);
        if (!a.hit && t2 && !t2.dead && dist(f.pos, t2.pos) < f.radius + t2.radius + 6) {
          a.hit = true;
          w.damage(t2, 10, f, { kb: 480, angle: angleOf(a.dir), stun: 0.15 });
          w.burst(t2.pos.x, t2.pos.y, 14, '#ffe0a3', 240, 5);
          w.shake(6);
        }
        if (a.t >= a.dur || hitWall) {
          f.superArmor = false;
          w.ring(f.pos.x, f.pos.y, 8, 50, 0.25, '#ffe0a3', 3, false);
          w.endAction(f);
        }
      },
      end() {
        f.superArmor = false;
      },
    });
  },
};

export const SKILLS: Record<string, SkillDef> = {
  tongue,
  leap,
  charge,
  gore,
  blink,
  steal,
  peck,
  flypeck,
  breath,
  cloud,
  roll,
  feast,
  swallow,
  bubbles,
  milkball,
  swap,
  egg,
  vortex,
  fart,
  pounce,
  roar,
  flurry,
  backflip,
  coil,
  venom,
  gallop,
  spinKick,
  wool,
  ram,
  somersault,
  banana,
  bite,
  guardDog,
  shell,
  hatch,
  lieFlat,
  delivery,
  stinkSelf,
  poopBomb,
  abyss,
  fishBubbles,
  slippery,
  smite,
  revive,
  ratAnimate,
  oxStrength,
  tigerSplit,
  rabbitHaste,
  dragonFire,
  snakeInvis,
  horseHeal,
  sheepAstral,
  monkeyMimic,
  roosterLevitate,
  dogImmortal,
  pigLaser,
  laugh,
  laughRoll,
};

export function skillById(id: string): SkillDef {
  return SKILLS[id] ?? tongue;
}

export function skillOf(f: Frog, index: 0 | 1): SkillDef {
  return skillById(f.def.skills[index]);
}
