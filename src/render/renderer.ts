import { ARENA, SUDDEN_DEATH_START, VIEW_H, VIEW_W } from '../game/constants';
import { skillById } from '../game/skills';
import type { Frog, SkillDef } from '../game/types';
import type { World } from '../game/world';
import type { CharArt } from './assets';
import { clamp, TAU } from '../core/math';

const FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif';

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(VIEW_W * this.dpr);
    this.canvas.height = Math.round(VIEW_H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  draw(world: World, arts: Record<string, CharArt>, hud = true): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    if (world.shakePower > 0.2) {
      ctx.translate(
        (Math.random() - 0.5) * world.shakePower,
        (Math.random() - 0.5) * world.shakePower,
      );
    }

    this.drawBackdrop();
    this.drawArena(world);

    // keep sprites inside the bowl: the rim occludes anyone hugging the wall
    ctx.save();
    roundRectPath(ctx, ARENA.x + 4, ARENA.y + 4, ARENA.w - 8, ARENA.h - 8, 34);
    ctx.clip();

    this.drawTelegraphs(world);
    this.drawTraps(world);
    this.drawStinks(world);
    this.drawVortices(world);
    this.drawBlasts(world);
    this.drawMinions(world, arts);
    this.drawRings(world, true);
    this.drawFrogs(world, arts);
    this.drawProjectiles(world);
    this.drawParticles(world);
    this.drawBeams(world);
    this.drawRings(world, false);
    this.drawTexts(world);
    ctx.restore();
    ctx.restore();

    if (hud) {
      this.drawHud(world);
      this.drawOverlays(world);
    }
  }

  // ---------------------------------------------------------------- backdrop

  private drawBackdrop(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(600, 380, 80, 600, 380, 720);
    g.addColorStop(0, 'rgba(255, 205, 120, 0.13)');
    g.addColorStop(0.5, 'rgba(255, 160, 110, 0.05)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private drawArena(world: World): void {
    const ctx = this.ctx;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 24;
    roundRectPath(ctx, ARENA.x, ARENA.y, ARENA.w, ARENA.h, 40);
    ctx.fillStyle = '#2a2033';
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(ARENA.x, ARENA.y, ARENA.x, ARENA.y + ARENA.h);
    g.addColorStop(0, '#fffaf0');
    g.addColorStop(0.55, '#fff1d6');
    g.addColorStop(1, '#ffe7bd');
    roundRectPath(ctx, ARENA.x, ARENA.y, ARENA.w, ARENA.h, 40);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, ARENA.x, ARENA.y, ARENA.w, ARENA.h, 40);
    ctx.clip();

    // floor dots
    ctx.fillStyle = 'rgba(196, 150, 86, 0.13)';
    for (let y = ARENA.y + 34; y < ARENA.y + ARENA.h; y += 46) {
      for (let x = ARENA.x + 34; x < ARENA.x + ARENA.w; x += 46) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, TAU);
        ctx.fill();
      }
    }

    // court markings
    const cx = ARENA.x + ARENA.w / 2;
    const cy = ARENA.y + ARENA.h / 2;
    ctx.strokeStyle = 'rgba(196, 150, 86, 0.28)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    ctx.moveTo(cx, ARENA.y + 12);
    ctx.lineTo(cx, ARENA.y + ARENA.h - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(cx, cy, 80, 0, TAU);
    ctx.strokeStyle = 'rgba(196, 150, 86, 0.3)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, TAU);
    ctx.fillStyle = 'rgba(196, 150, 86, 0.28)';
    ctx.fill();

    // spawn markers
    for (const side of [0, 1] as const) {
      const fx = world.frogs[side];
      ctx.beginPath();
      ctx.ellipse(fx.pos.x, fx.pos.y + fx.radius * 0.9, fx.radius * 1.5, fx.radius * 0.6, 0, 0, TAU);
      ctx.fillStyle = side === 0 ? 'rgba(111, 208, 255, 0.1)' : 'rgba(255, 143, 163, 0.1)';
      ctx.fill();
    }

    // inner rim shadow: makes the bowl feel deep and hides sprite overhang
    const topShade = ctx.createLinearGradient(0, ARENA.y, 0, ARENA.y + 60);
    topShade.addColorStop(0, 'rgba(126, 82, 34, 0.22)');
    topShade.addColorStop(1, 'rgba(126, 82, 34, 0)');
    ctx.fillStyle = topShade;
    ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, 60);

    const bottomShade = ctx.createLinearGradient(0, ARENA.y + ARENA.h - 46, 0, ARENA.y + ARENA.h);
    bottomShade.addColorStop(0, 'rgba(126, 82, 34, 0)');
    bottomShade.addColorStop(1, 'rgba(126, 82, 34, 0.14)');
    ctx.fillStyle = bottomShade;
    ctx.fillRect(ARENA.x, ARENA.y + ARENA.h - 46, ARENA.w, 46);

    for (const side of [0, 1] as const) {
      const gx =
        side === 0
          ? ctx.createLinearGradient(ARENA.x, 0, ARENA.x + 40, 0)
          : ctx.createLinearGradient(ARENA.x + ARENA.w, 0, ARENA.x + ARENA.w - 40, 0);
      gx.addColorStop(0, 'rgba(126, 82, 34, 0.14)');
      gx.addColorStop(1, 'rgba(126, 82, 34, 0)');
      ctx.fillStyle = gx;
      ctx.fillRect(
        side === 0 ? ARENA.x : ARENA.x + ARENA.w - 40,
        ARENA.y,
        40,
        ARENA.h,
      );
    }

    // watermark
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(196, 150, 86, 0.07)';
    ctx.font = `900 96px ${FONT}`;
    ctx.fillText('奶', cx, cy + 6);
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = 'rgba(196, 150, 86, 0.18)';
    ctx.fillText('N A I W A   B R A W L', cx, cy + 68);
    ctx.restore();

    // border
    roundRectPath(ctx, ARENA.x, ARENA.y, ARENA.w, ARENA.h, 40);
    ctx.strokeStyle = '#e2b268';
    ctx.lineWidth = 9;
    ctx.stroke();
    roundRectPath(ctx, ARENA.x + 6, ARENA.y + 6, ARENA.w - 12, ARENA.h - 12, 35);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // corner screws
    for (const [sx, sy] of [
      [ARENA.x + 30, ARENA.y + 30],
      [ARENA.x + ARENA.w - 30, ARENA.y + 30],
      [ARENA.x + 30, ARENA.y + ARENA.h - 30],
      [ARENA.x + ARENA.w - 30, ARENA.y + ARENA.h - 30],
    ]) {
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, TAU);
      ctx.fillStyle = 'rgba(180, 128, 62, 0.5)';
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- telegraph

  private drawTelegraphs(world: World): void {
    const ctx = this.ctx;
    for (const f of world.frogs) {
      if (!f.windup || f.dead) continue;
      const def = f.windup.def;
      const p = clamp(f.windup.t / Math.max(0.001, def.windup), 0, 1);
      const pulse = 0.55 + 0.45 * Math.sin(world.animTime * 22);
      ctx.save();
      ctx.translate(f.pos.x, f.pos.y);
      ctx.rotate(f.facing);

      const color = def.color;
      ctx.globalAlpha = 0.16 + p * 0.22 + pulse * 0.06;

      if (def.id === 'charge') {
        ctx.fillStyle = color;
        ctx.fillRect(0, -30, 300, 60);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash([14, 12]);
        ctx.strokeRect(0, -30, 300, 60);
        ctx.setLineDash([]);
        // arrow
        ctx.beginPath();
        ctx.moveTo(250, -16);
        ctx.lineTo(300, 0);
        ctx.lineTo(250, 16);
        ctx.closePath();
        ctx.fill();
      } else if (def.id === 'gore') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 108, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else if (def.id === 'breath') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 190, -0.6, 0.6);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (def.id === 'leap' || def.id === 'flypeck' || def.id === 'roll') {
        const len = def.id === 'roll' ? 320 : def.id === 'leap' ? 200 : 220;
        ctx.fillStyle = color;
        ctx.fillRect(0, -f.radius * 0.9, len, f.radius * 1.8);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 10]);
        ctx.strokeRect(0, -f.radius * 0.9, len, f.radius * 1.8);
        ctx.setLineDash([]);
      } else if (def.id === 'tongue') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 12;
        ctx.globalAlpha = 0.32;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(196, 0);
        ctx.stroke();
      } else if (def.id === 'basic' || def.id === 'peck') {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, 80, -0.95, 0.95);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 66, 0, TAU);
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();

      // progress arc above the frog
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y - f.radius * 2.6, 13, -Math.PI / 2, -Math.PI / 2 + TAU * p);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- frogs

  private drawFrogs(world: World, arts: Record<string, CharArt>): void {
    const sorted = [...world.frogs, ...world.clones].sort((a, b) => a.pos.y - b.pos.y);
    for (const f of sorted) this.drawFrog(world, f, arts);
  }

  private drawFrog(world: World, f: Frog, arts: Record<string, CharArt>): void {
    if (f.hidden > 0) return;
    const ctx = this.ctx;
    const art = arts[f.def.id];
    if (!art) return;

    const bodyH = f.radius * 3.8 * (f.polymorphT > 0 ? 0.62 : 1);
    let h = bodyH;
    let w = h * art.aspect;
    const maxW = f.radius * 6;
    if (w > maxW) {
      const k = maxW / w;
      w *= k;
      h *= k;
    }

    const groundY = f.pos.y + f.radius * 0.96;
    const bob = f.dead ? 0 : Math.sin(world.animTime * 3.1 + f.side * 1.7) * 1.6;
    const moving = Math.hypot(f.vel.x, f.vel.y) > 40 && !f.windup;
    const tilt = moving ? Math.sin(f.walkPhase) * 0.035 : 0;

    // shadow
    const zt = clamp(1 - f.z / 140, 0.45, 1);
    ctx.save();
    ctx.globalAlpha = 0.24 * zt;
    ctx.fillStyle = '#3a2712';
    ctx.beginPath();
    ctx.ellipse(f.pos.x, groundY + 2, f.radius * 1.02 * zt, f.radius * 0.34 * zt, 0, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (f.cloudT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#f4fbff';
      for (let i = 0; i < 4; i++) {
        const a = world.animTime * 1.4 + (i / 4) * TAU;
        ctx.beginPath();
        ctx.ellipse(
          f.pos.x + Math.cos(a) * 40,
          groundY - 4 + Math.sin(a) * 12,
          26,
          13,
          0,
          0,
          TAU,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    // shield bubble
    if (f.shield > 0) {
      const r = Math.max(w, h) * 0.48;
      ctx.save();
      ctx.globalAlpha = 0.45;
      const sg = ctx.createRadialGradient(f.pos.x, f.pos.y, r * 0.3, f.pos.x, f.pos.y, r);
      sg.addColorStop(0, 'rgba(150, 230, 255, 0.05)');
      sg.addColorStop(1, 'rgba(120, 215, 255, 0.55)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#bdefff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    // rage aura
    if (f.rage && !f.dead) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(world.animTime * 10);
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, f.radius * 1.5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (f.counterT > 0 && !f.dead) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(world.animTime * 12);
      ctx.strokeStyle = '#e0a35a';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, f.radius * 1.45, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (f.strengthT > 0 && !f.dead) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.15 * Math.sin(world.animTime * 9);
      ctx.strokeStyle = '#ffb347';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, f.radius * 1.5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (f.immortalT > 0 && !f.dead) {
      ctx.save();
      ctx.globalAlpha = 0.4 + 0.2 * Math.sin(world.animTime * 7);
      ctx.strokeStyle = '#ffe6a0';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(f.pos.x, f.pos.y, f.radius * 1.55, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    if (f.dodgeT > 0 && !f.dead) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#a8d8f0';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = world.animTime * 4 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(
          f.pos.x + Math.cos(a) * f.radius * 1.3,
          f.pos.y + Math.sin(a) * f.radius * 1.1,
          2.5,
          0,
          TAU,
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    let alpha = 1;
    if (f.dead) alpha = 0.55;
    else if (f.astralT > 0) alpha = 0.4;
    else if (f.invisT > 0) alpha = 0.12;
    else if (f.invuln > 0 && f.cloudT <= 0) alpha = 0.62;
    ctx.globalAlpha = alpha;
    ctx.translate(f.pos.x, groundY + bob - f.z);
    ctx.rotate(tilt);

    const sq = f.squash;
    ctx.scale(1 + 0.14 * sq, 1 - 0.14 * sq);
    if (f.belly > 0) ctx.scale(1 + 0.22 * f.belly, 1 + 0.12 * f.belly);

    // spin / fall around the body centre, never around the feet:
    // otherwise the sprite swings far outside the arena.
    const pivot = -h * 0.5;
    if (f.dead) {
      ctx.translate(0, pivot);
      ctx.rotate((f.side === 0 ? -1 : 1) * Math.PI * 0.42);
      ctx.scale(1, 0.72);
      ctx.translate(0, -pivot);
    }
    if (Math.cos(f.facing) < 0) ctx.scale(-1, 1);

    if (f.hitFlash > 0) ctx.filter = 'brightness(1.28) saturate(0.5)';
    ctx.drawImage(art.sprite, -w / 2, -h, w, h);
    ctx.filter = 'none';
    ctx.restore();

    // burn embers
    if (f.burnT > 0) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = '#ff9c5a';
      for (let i = 0; i < 3; i++) {
        const t = world.animTime * 2.4 + i * 2.1;
        ctx.beginPath();
        ctx.arc(
          f.pos.x + Math.sin(t) * 16,
          f.pos.y - 20 - ((t * 14) % 46),
          3,
          0,
          TAU,
        );
        ctx.fill();
      }
      ctx.restore();
    }

    if (f.dead) return;

    // mini hp bar
    const bw = f.isSummon ? 44 : 62;
    const bx = f.pos.x - bw / 2;
    const by = Math.max(ARENA.y + 6, groundY - h - 16);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(30, 22, 16, 0.55)';
    roundRectPath(ctx, bx - 2, by - 2, bw + 4, 9, 5);
    ctx.fill();
    ctx.fillStyle = f.side === 0 ? '#7bd0ff' : '#ff9fb2';
    roundRectPath(ctx, bx, by, bw * clamp(f.hp / f.maxHp, 0, 1), 5, 3);
    ctx.fill();
    ctx.restore();

    // stun stars
    if (f.stun > 0) {
      ctx.save();
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = world.animTime * 6 + (i / 3) * TAU;
        ctx.beginPath();
        ctx.arc(
          f.pos.x + Math.cos(a) * 26,
          by - 12 + Math.sin(a) * 7,
          3.4,
          0,
          TAU,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- fx

  private drawRings(world: World, under: boolean): void {
    const ctx = this.ctx;
    for (const r of world.rings) {
      const p = 1 - r.life / r.maxLife;
      if (under === r.fill) continue;
      const radius = r.r0 + (r.r1 - r.r0) * p;
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, TAU);
      ctx.stroke();
      if (r.fill) {
        ctx.globalAlpha = (1 - p) * 0.18;
        ctx.fillStyle = r.color;
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawBlasts(world: World): void {
    const ctx = this.ctx;
    for (const b of world.blasts) {
      const p = clamp(1 - b.delay / b.maxDelay, 0, 1);
      ctx.save();
      ctx.globalAlpha = 0.35 + p * 0.5;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 2 + p * 3;
      ctx.setLineDash([9, 8]);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.radius, b.radius * 0.42, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.globalAlpha = 0.18 + p * 0.35;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.radius * (1 - p * 0.25), b.radius * 0.42 * (1 - p * 0.25), 0, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = 0.2 + p * 0.6;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(b.x - 8, b.y);
      ctx.lineTo(b.x + 8, b.y);
      ctx.lineTo(b.x, b.y - 260 - p * 20);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTraps(world: World): void {
    const ctx = this.ctx;
    for (const t of world.traps) {
      const armed = t.arm <= 0;
      ctx.save();
      ctx.translate(t.x, t.y + Math.sin(world.animTime * 4 + t.x) * 2);

      if (t.kind === 'banana') {
        if (armed) {
          ctx.globalAlpha = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(world.animTime * 8));
          ctx.strokeStyle = '#ffb347';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(0, 0, 30, 11, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = armed ? 1 : 0.7;
        ctx.fillStyle = '#f7d34a';
        ctx.beginPath();
        ctx.ellipse(0, -4, 20, 8, -0.35, 0, TAU);
        ctx.ellipse(6, 2, 18, 7, 0.5, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#b98a1f';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#6b4a12';
        ctx.beginPath();
        ctx.arc(-14, -8, 2.6, 0, TAU);
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (armed) {
        const pulse = 0.5 + 0.5 * Math.sin(world.animTime * 10);
        ctx.globalAlpha = 0.25 + pulse * 0.35;
        ctx.strokeStyle = '#ff9d4d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, 34 + pulse * 8, 12 + pulse * 3, 0, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.globalAlpha = armed ? 0.5 : 0.35;
      ctx.fillStyle = '#3a2712';
      ctx.beginPath();
      ctx.ellipse(0, 4, 18, 6, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = armed ? 1 : 0.75;

      ctx.beginPath();
      ctx.ellipse(0, -16, 17, 23, 0, 0, TAU);
      const g = ctx.createLinearGradient(0, -38, 0, 6);
      g.addColorStop(0, '#fffdf5');
      g.addColorStop(1, '#ffe6b8');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = '#e2b06a';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#ffb3a7';
      ctx.beginPath();
      ctx.ellipse(-8, -13, 3.5, 2.2, 0, 0, TAU);
      ctx.ellipse(8, -13, 3.5, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#3a2412';
      ctx.beginPath();
      ctx.arc(-6, -20, 2.4, 0, TAU);
      ctx.arc(6, -20, 2.4, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawStinks(world: World): void {
    const ctx = this.ctx;
    for (const z of world.stinks) {
      const t = z.life / z.maxLife;
      const fade = Math.min(1, (1 - t) * 3) * Math.min(1, t * 3);
      ctx.save();
      const g = ctx.createRadialGradient(z.x, z.y, 8, z.x, z.y, z.radius);
      g.addColorStop(0, `rgba(150, 210, 120, ${0.34 * fade})`);
      g.addColorStop(0.6, `rgba(130, 190, 100, ${0.2 * fade})`);
      g.addColorStop(1, 'rgba(120, 180, 90, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, TAU);
      ctx.fill();

      for (let i = 0; i < 5; i++) {
        const a = world.animTime * 0.6 + (i / 5) * TAU;
        const d = z.radius * (0.25 + 0.3 * ((i * 7) % 5) / 5);
        ctx.globalAlpha = 0.18 * fade;
        ctx.fillStyle = '#b9e79a';
        ctx.beginPath();
        ctx.arc(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * 0.7, 16 + (i % 3) * 7, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawVortices(world: World): void {
    const ctx = this.ctx;
    for (const v of world.vortices) {
      const t = v.life / v.maxLife;
      const fade = Math.min(1, (1 - t) * 4) * Math.min(1, t * 5);
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.spin);
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = fade * (0.55 - i * 0.08);
        ctx.strokeStyle = i % 2 === 0 ? '#bfe9ff' : '#79c9ee';
        ctx.lineWidth = 5 - i;
        ctx.beginPath();
        ctx.arc(0, 0, 26 + i * 26, i * 1.7, i * 1.7 + 2.3);
        ctx.stroke();
      }
      ctx.globalAlpha = fade * 0.5;
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 30);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, 'rgba(140, 220, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawMinions(world: World, arts: Record<string, CharArt>): void {
    const ctx = this.ctx;
    const art = arts['naishu'];
    for (const m of world.minions) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, m.life * 3);
      ctx.fillStyle = 'rgba(40, 26, 10, 0.22)';
      ctx.beginPath();
      ctx.ellipse(m.x, m.y + 6, 16, 6, 0, 0, TAU);
      ctx.fill();
      if (art) {
        const h = 44;
        const w = h * art.aspect;
        ctx.drawImage(art.sprite, m.x - w / 2, m.y - h + 8, w, h);
      } else {
        ctx.fillStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(m.x, m.y, 14, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawProjectiles(world: World): void {
    const ctx = this.ctx;
    for (const p of world.projectiles) {
      const fade = Math.min(1, p.life * 4);
      ctx.save();
      ctx.globalAlpha = fade;
      if (p.kind === 'fire') {
        const g = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, p.r * 1.8);
        g.addColorStop(0, '#fff6c0');
        g.addColorStop(0.35, '#ffb347');
        g.addColorStop(0.75, 'rgba(255, 90, 50, 0.55)');
        g.addColorStop(1, 'rgba(255, 70, 40, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 1.8, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#fff3c0';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.55, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'bubble') {
        const g = ctx.createRadialGradient(p.x - 6, p.y - 8, 2, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.35, 'rgba(190, 240, 255, 0.18)');
        g.addColorStop(0.85, 'rgba(150, 220, 250, 0.3)');
        g.addColorStop(1, 'rgba(190, 245, 255, 0.75)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = 'rgba(220, 250, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x - 6, p.y - 7, 4, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fill();
      } else if (p.kind === 'poop') {
        ctx.fillStyle = 'rgba(40, 26, 10, 0.25)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + p.r * 0.9, p.r * 0.9, p.r * 0.35, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        const g = ctx.createRadialGradient(p.x - 5, p.y - 6, 3, p.x, p.y, p.r);
        g.addColorStop(0, '#c9a56a');
        g.addColorStop(1, '#8f6a35');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = '#6b4a12';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#5a3c14';
        ctx.beginPath();
        ctx.arc(p.x - 5, p.y - 4, 3, 0, TAU);
        ctx.arc(p.x + 5, p.y + 4, 2.4, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(40, 26, 10, 0.25)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + p.r * 0.9, p.r * 0.9, p.r * 0.35, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        const g = ctx.createRadialGradient(p.x - 5, p.y - 6, 3, p.x, p.y, p.r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#fff0c9');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = '#e8c79a';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#8a5a33';
        for (const [ox, oy, rr] of [
          [-7, -4, 4],
          [5, 3, 3.4],
          [-2, 7, 2.6],
        ]) {
          ctx.beginPath();
          ctx.arc(p.x + ox, p.y + oy, rr, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private drawParticles(world: World): void {
    const ctx = this.ctx;
    for (const p of world.particles) {
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = clamp(t * 1.2, 0, 1);
      ctx.fillStyle = p.color;
      if (p.shape === 'star') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 8);
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU;
          const r = p.size * (i % 2 === 0 ? 1.5 : 0.7);
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawBeams(world: World): void {
    const ctx = this.ctx;
    for (const b of world.beams) {
      const t = b.life / b.maxLife;
      ctx.save();
      ctx.globalAlpha = clamp(t, 0, 1);
      ctx.strokeStyle = b.color;
      ctx.lineCap = 'round';
      ctx.lineWidth = b.width * t;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();
      ctx.globalAlpha = t * 0.35;
      ctx.lineWidth = b.width * 2 * t;
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawTexts(world: World): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of world.texts) {
      const p = 1 - t.life / t.maxLife;
      const alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;
      const pop = p < 0.14 ? 0.7 + (p / 0.14) * 0.45 : 1.07 - p * 0.07;
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.font = `900 ${t.size * pop}px ${FONT}`;
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = 'rgba(255, 248, 232, 0.94)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- hud

  private drawHud(world: World): void {
    const ctx = this.ctx;
    const [a, b] = world.frogs;
    this.drawSideHud(world, a, 'left');
    this.drawSideHud(world, b, 'right');

    // center
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const centerX = 600;
    ctx.font = `900 30px ${FONT}`;
    ctx.fillStyle = '#fff3d6';
    ctx.fillText(formatTime(world.time), centerX, 52);
    ctx.font = `700 10px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 246, 227, 0.42)';
    ctx.fillText(world.phase === 'countdown' ? '准备' : '对局时长', centerX, 74);

    if (world.boilStacks > 0) {
      ctx.font = `900 13px ${FONT}`;
      ctx.fillStyle = '#ffb347';
      ctx.fillText(`奶气沸腾 ×${world.boilStacks}`, centerX, 92);
    } else if (world.time > SUDDEN_DEATH_START - 12) {
      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = 'rgba(255, 179, 71, 0.7)';
      ctx.fillText(
        `距离沸腾 ${Math.max(0, Math.ceil(SUDDEN_DEATH_START - world.time))}s`,
        centerX,
        92,
      );
    }
    ctx.restore();

    if (world.boilStacks > 0) {
      const a2 = clamp(world.boilStacks * 0.05 + world.boilFlash * 0.08, 0, 0.34);
      const vg = ctx.createRadialGradient(600, 400, 280, 600, 400, 720);
      vg.addColorStop(0, 'rgba(255, 140, 60, 0)');
      vg.addColorStop(1, `rgba(255, 120, 40, ${a2})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  private drawSideHud(world: World, f: Frog, align: 'left' | 'right'): void {
    const ctx = this.ctx;
    const left = align === 'left';
    const barW = 360;
    const barH = 20;
    const x = left ? 70 : VIEW_W - 70 - barW;
    const y = 44;
    const nameX = left ? 70 : VIEW_W - 70;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = left ? 'left' : 'right';
    ctx.font = `900 21px ${FONT}`;
    ctx.fillStyle = '#fff6e3';
    ctx.fillText(f.origin.name, nameX, 27);

    ctx.font = `700 10px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 246, 227, 0.42)';
    const roleX = left ? nameX + 82 : nameX - 82;
    ctx.textAlign = 'center';
    ctx.fillText(f.def.role, roleX, 28);

    // hp track
    ctx.textAlign = 'left';
    roundRectPath(ctx, x, y, barW, barH, 10);
    ctx.fillStyle = 'rgba(17, 13, 24, 0.62)';
    ctx.fill();

    const ratio = clamp(f.hp / f.maxHp, 0, 1);
    if (ratio > 0) {
      const hpGrad = ctx.createLinearGradient(x, 0, x + barW, 0);
      if (left) {
        hpGrad.addColorStop(0, '#7bd0ff');
        hpGrad.addColorStop(1, '#c4f0ff');
      } else {
        hpGrad.addColorStop(0, '#ff9fb2');
        hpGrad.addColorStop(1, '#ffc6d2');
      }
      roundRectPath(ctx, x, y, Math.max(6, barW * ratio), barH, 10);
      ctx.fillStyle = hpGrad;
      ctx.fill();
    }

    // shield
    if (f.shield > 0) {
      const sr = clamp(f.shield / f.maxHp, 0, 1);
      roundRectPath(ctx, x, y - 8, Math.max(4, barW * sr), 6, 3);
      ctx.fillStyle = 'rgba(140, 228, 255, 0.9)';
      ctx.fill();
    }

    // tick marks
    for (let i = 1; i < 4; i++) {
      const tx = x + (barW * i) / 4;
      ctx.fillStyle = 'rgba(20, 14, 10, 0.18)';
      ctx.fillRect(tx - 1, y + 2, 2, barH - 4);
    }

    roundRectPath(ctx, x, y, barW, barH, 10);
    ctx.strokeStyle = 'rgba(255, 246, 227, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // hp number, outside the bar so it never sits on the fill
    ctx.font = `800 11px ${FONT}`;
    ctx.fillStyle = 'rgba(255, 246, 227, 0.66)';
    ctx.textAlign = left ? 'left' : 'right';
    ctx.fillText(
      `${Math.ceil(f.hp)} / ${f.maxHp}`,
      left ? x + barW + 10 : x - 10,
      y + barH / 2 + 1,
    );

    // skill chips
    const chipW = 112;
    const chipH = 24;
    for (let i = 0; i < 2; i++) {
      const def: SkillDef = skillById(f.def.skills[i]);
      const cx = left ? x + i * (chipW + 8) : x + barW - chipW - i * (chipW + 8);
      const cy = y + barH + 8;
      ctx.save();
      roundRectPath(ctx, cx, cy, chipW, chipH, 8);
      ctx.fillStyle = 'rgba(17, 13, 24, 0.46)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 246, 227, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const iconX = left ? cx + 14 : cx + chipW - 14;
      ctx.textAlign = 'center';
      ctx.font = `900 12px ${FONT}`;
      ctx.fillStyle = f.cds[i] <= 0 ? def.color : 'rgba(255, 246, 227, 0.38)';
      ctx.fillText(def.icon, iconX, cy + chipH / 2 + 1);

      ctx.font = `700 9.5px ${FONT}`;
      ctx.fillStyle = f.cds[i] <= 0 ? 'rgba(255, 246, 227, 0.88)' : 'rgba(255, 246, 227, 0.4)';
      ctx.textAlign = 'left';
      ctx.fillText(def.name, cx + 24, cy + chipH / 2 + 1);

      if (f.cds[i] > 0) {
        const p = clamp(f.cds[i] / def.cd, 0, 1);
        roundRectPath(ctx, cx, cy, chipW * p, chipH, 8);
        ctx.fillStyle = 'rgba(8, 8, 14, 0.52)';
        ctx.fill();
        ctx.textAlign = 'right';
        ctx.font = `800 10px ${FONT}`;
        ctx.fillStyle = 'rgba(255, 246, 227, 0.75)';
        ctx.fillText(f.cds[i].toFixed(1), cx + chipW - 6, cy + chipH / 2 + 1);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawOverlays(world: World): void {
    const ctx = this.ctx;
    if (world.phase === 'countdown') {
      const n = Math.ceil(world.countdown - 0.2);
      const label = n > 0 ? String(n) : '开战';
      const frac = 1 - (world.countdown - Math.floor(world.countdown));
      const scale = 1 + (1 - frac) * 0.18;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.92;
      ctx.translate(600, 392);
      ctx.scale(scale, scale);
      ctx.font = `900 132px ${FONT}`;
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(60, 40, 16, 0.35)';
      ctx.strokeText(label, 0, 0);
      const g = ctx.createLinearGradient(0, -70, 0, 70);
      g.addColorStop(0, '#fff7dc');
      g.addColorStop(1, '#ffc23f');
      ctx.fillStyle = g;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }

    if (world.phase === 'ko') {
      const t = clamp((1.8 - world.koTimer) / 0.5, 0, 1);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = t;
      ctx.translate(600, 372);
      const s = 0.7 + t * 0.35;
      ctx.scale(s, s);
      ctx.rotate(-0.04);
      ctx.font = `900 96px ${FONT}`;
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(60, 30, 10, 0.75)';
      ctx.strokeText('KO!', 0, 0);
      const g = ctx.createLinearGradient(0, -60, 0, 60);
      g.addColorStop(0, '#fff2b8');
      g.addColorStop(0.55, '#ffc93d');
      g.addColorStop(1, '#ff8a3d');
      ctx.fillStyle = g;
      ctx.fillText('KO!', 0, 0);
      ctx.restore();
    }

    if (world.phase === 'fight' && world.time < 1.4) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.globalAlpha = clamp(1.4 - world.time, 0, 1);
      ctx.font = `900 26px ${FONT}`;
      ctx.fillStyle = '#ffcf7a';
      ctx.fillText('开打！', 600, 210);
      ctx.restore();
    }
  }
}
