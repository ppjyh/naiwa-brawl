import { CHARS, type CharDef } from '../game/chars';
import { ARENA } from '../game/constants';
import { World } from '../game/world';

declare const process: { argv: string[]; exit(code?: number): void };

const arg = process.argv.slice(2).find((a) => /^\d+$/.test(a));
const PER_PAIR = arg ? Number(arg) : 10;
const CAP_SECONDS = 240;

interface Result {
  left: CharDef;
  right: CharDef;
  time: number;
  winner: number | null;
  boil: number;
  stall: boolean;
  hp: [number, number];
  dmg: [number, number];
  skills: [number, number];
  oob: number;
  worst: number;
}

function simulate(left: CharDef, right: CharDef, seed: number): Result {
  const w = new World(left, right, seed);
  let steps = 0;
  let oob = 0;
  let worst = 0;
  while (w.phase !== 'over' && steps < CAP_SECONDS * 60) {
    w.update(1 / 60);
    steps++;
    for (const f of w.frogs) {
      const over = Math.max(
        ARENA.x - f.pos.x,
        f.pos.x - (ARENA.x + ARENA.w),
        ARENA.y - f.pos.y,
        f.pos.y - (ARENA.y + ARENA.h),
      );
      if (over > 0.5) {
        oob++;
        worst = Math.max(worst, over);
        if (oob < 3) console.log('OOB', f.def.id, f.action?.id, over.toFixed(1), f.pos.x.toFixed(1), f.pos.y.toFixed(1));
      }
    }
  }
  if (w.phase !== 'over') {
    console.log(
      'STALL',
      left.id,
      right.id,
      w.phase,
      w.time.toFixed(1),
      w.boilStacks,
      w.frogs.map((f) => ({
        hp: f.hp,
        dead: f.dead,
        hidden: f.hidden,
        float: f.floatT,
        immortal: f.immortalT,
        invuln: f.invuln,
      })),
    );
  }
  return {
    left,
    right,
    time: w.time,
    winner: w.winner,
    boil: w.boilStacks,
    stall: w.phase !== 'over',
    hp: [w.frogs[0].hp, w.frogs[1].hp],
    dmg: [w.frogs[0].stats.damage, w.frogs[1].stats.damage],
    skills: [w.frogs[0].stats.skills, w.frogs[1].stats.skills],
    oob,
    worst,
  };
}

const results: Result[] = [];
let seed = 20261110;

for (let i = 0; i < CHARS.length; i++) {
  for (let j = i; j < CHARS.length; j++) {
    for (let n = 0; n < PER_PAIR; n++) {
      results.push(simulate(CHARS[i], CHARS[j], seed++));
    }
  }
}

const times = results.map((r) => r.time).sort((a, b) => a - b);
const q = (p: number): number => times[Math.min(times.length - 1, Math.floor(times.length * p))];
const avg = times.reduce((a, b) => a + b, 0) / times.length;

const stalls = results.filter((r) => r.stall).length;
const draws = results.filter((r) => r.winner === null && !r.stall).length;
const oobFrames = results.reduce((a, r) => a + r.oob, 0);
const worstOob = results.reduce((a, r) => Math.max(a, r.worst), 0);
console.log(`out-of-bounds frames: ${oobFrames}  worst: ${worstOob.toFixed(1)}px`);

console.log(`matches: ${results.length}  per pair: ${PER_PAIR}  cap: ${CAP_SECONDS}s`);
console.log(
  `time  avg ${avg.toFixed(1)}s  median ${q(0.5).toFixed(1)}s  p90 ${q(0.9).toFixed(1)}s  max ${q(0.999).toFixed(1)}s`,
);
console.log(`stalls(>${CAP_SECONDS}s): ${stalls}  draws: ${draws}`);
console.log(
  `boil avg ${(results.reduce((a, r) => a + r.boil, 0) / results.length).toFixed(2)}  matches reaching boil: ${
    results.filter((r) => r.boil > 0).length
  }`,
);

const byChar = new Map<string, { games: number; wins: number; dmg: number; skills: number }>();
for (const c of CHARS) byChar.set(c.id, { games: 0, wins: 0, dmg: 0, skills: 0 });
for (const r of results) {
  for (const side of [0, 1] as const) {
    const c = side === 0 ? r.left : r.right;
    const s = byChar.get(c.id)!;
    s.games++;
    s.dmg += r.dmg[side];
    s.skills += r.skills[side];
    if (r.winner === side) s.wins++;
  }
}

console.log('\nchar            games  win%   avgDmg  avgSkills');
for (const c of CHARS) {
  const s = byChar.get(c.id)!;
  const win = (s.wins / s.games) * 100;
  console.log(
    `${c.name.padEnd(6, '　')}  ${String(s.games).padStart(5)}  ${win.toFixed(1).padStart(5)}  ${(s.dmg / s.games)
      .toFixed(0)
      .padStart(6)}  ${(s.skills / s.games).toFixed(1).padStart(8)}`,
  );
}

console.log('\nleft-side win% matrix (rows vs cols):');
const cell = new Map<string, { w: number; n: number }>();
for (const r of results) {
  const key = `${r.left.id}|${r.right.id}`;
  const c = cell.get(key) ?? { w: 0, n: 0 };
  c.n++;
  if (r.winner === 0) c.w++;
  cell.set(key, c);

  if (r.left.id !== r.right.id) {
    const rev = `${r.right.id}|${r.left.id}`;
    const rc = cell.get(rev) ?? { w: 0, n: 0 };
    rc.n++;
    if (r.winner === 1) rc.w++;
    cell.set(rev, rc);
  }
}
let header = '          ';
for (const c of CHARS) header += c.name.padEnd(7, '　');
console.log(header);
for (const l of CHARS) {
  let row = l.name.padEnd(6, '　') + '  ';
  for (const r of CHARS) {
    const c = cell.get(`${l.id}|${r.id}`)!;
    const v = (c.w / c.n) * 100;
    row += `${v.toFixed(0).padStart(5)}  `;
  }
  console.log(row);
}

console.log('\nslowest pairups (avg seconds):');
const pairMap = new Map<string, { sum: number; n: number; stall: number }>();
for (const r of results) {
  const key = `${r.left.name} vs ${r.right.name}`;
  const p = pairMap.get(key) ?? { sum: 0, n: 0, stall: 0 };
  p.sum += r.time;
  p.n++;
  if (r.stall) p.stall++;
  pairMap.set(key, p);
}
const slow = [...pairMap.entries()].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).slice(0, 8);
for (const [key, p] of slow) {
  console.log(`  ${key.padEnd(18)} ${(p.sum / p.n).toFixed(0)}s  stalls ${p.stall}/${p.n}`);
}
