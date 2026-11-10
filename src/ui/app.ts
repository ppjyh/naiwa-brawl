import { CHARS, charById } from '../game/chars';
import { skillById } from '../game/skills';
import { World } from '../game/world';
import type { Side } from '../game/types';
import { FixedLoop } from '../core/loop';
import { randomSeed } from '../core/rng';
import { loadAllArts, type CharArt } from '../render/assets';
import { Renderer } from '../render/renderer';
import { Sfx } from './sfx';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class App {
  private readonly canvas = $('game') as HTMLCanvasElement;
  private readonly menu = $('menu');
  private readonly result = $('result');
  private readonly controls = $('hud-controls');
  private readonly topbar = $('topbar');
  private readonly loading = $('loading');
  private readonly renderer = new Renderer(this.canvas);
  private readonly sfx = new Sfx();
  private readonly loop: FixedLoop;
  private readonly rosterHost = $('cards-roster');
  private readonly slotEls: [HTMLElement, HTMLElement] = [$('slot-left'), $('slot-right')];
  private activeSide: Side = 0;
  private readonly pauseBtn = $('pause');
  private readonly speedBtn = $('speed');

  private arts: Record<string, CharArt> = {};
  private world: World | null = null;
  private selection: [string, string] = ['naiwa', 'nainiu'];
  private preview = true;
  private paused = false;
  private speed = 1;
  private resultShown = false;
  private warp = 0;
  private debug = false;
  private fixedSeed: number | null = null;

  constructor() {
    this.loop = new FixedLoop(
      1 / 60,
      (dt) => {
        if (!this.world) return;
        if (this.preview) {
          this.world.animTime += dt * 0.6;
          return;
        }
        this.world.update(dt);
      },
      () => {
        if (this.world) this.renderer.draw(this.world, this.arts, !this.preview);
        if (this.debug && this.world) {
          document.title = JSON.stringify({
            t: +this.world.time.toFixed(1),
            f: this.world.frogs.map((f) => ({
              id: f.def.id,
              x: +f.pos.x.toFixed(1),
              y: +f.pos.y.toFixed(1),
              z: +f.z.toFixed(1),
              r: f.radius,
              hp: Math.round(f.hp),
              a: f.action?.id ?? null,
              st: +f.stun.toFixed(2),
            })),
          });
        }
        this.checkResult();
      },
    );
  }

  async init(): Promise<void> {
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const arts = await loadAllArts(CHARS);
    this.arts = arts;
    this.loading.classList.add('hidden');

    this.buildRoster();
    this.bindTabs();
    this.refreshSelection();
    this.makePreview();

    this.bindUi();
    this.loop.start();

    const params = new URLSearchParams(location.search);
    this.debug = params.get('debug') === '1';
    if (params.get('auto')) {
      const l = params.get('l');
      const r = params.get('r');
      if (l && charById(l).id === l) this.selection[0] = l;
      if (r && charById(r).id === r) this.selection[1] = r;
      this.speed = params.get('speed') === '2' ? 2 : 1;
      this.speedBtn.textContent = `${this.speed}×`;
      const warp = Number(params.get('warp') ?? '0');
      this.warp = Number.isFinite(warp) ? Math.max(0, warp) : 0;
      const seed = Number(params.get('seed') ?? '');
      if (Number.isFinite(seed) && seed > 0) this.fixedSeed = seed >>> 0;
      this.startMatch();
    }
  }

  private bindUi(): void {
    $('start').addEventListener('click', () => {
      this.sfx.enable();
      this.startMatch();
    });
    $('random').addEventListener('click', () => {
      const a = CHARS[Math.floor(Math.random() * CHARS.length)].id;
      let b = CHARS[Math.floor(Math.random() * CHARS.length)].id;
      if (CHARS.length > 1) {
        while (b === a) b = CHARS[Math.floor(Math.random() * CHARS.length)].id;
      }
      this.selection = [a, b];
      this.refreshSelection();
      this.makePreview();
      this.sfx.enable();
      this.startMatch();
    });
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.speedBtn.addEventListener('click', () => this.toggleSpeed());
    $('restart').addEventListener('click', () => this.restart());
    $('back').addEventListener('click', () => this.showMenu());
    for (const id of ['sound', 'sound2']) {
      $(id).addEventListener('click', () => {
        const muted = this.sfx.toggle();
        for (const other of ['sound', 'sound2']) $(other).textContent = muted ? '🔇' : '🔊';
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.preview) this.togglePause();
      }
      if (e.code === 'KeyR' && !this.preview) this.restart();
    });
  }

  private resize(): void {
    this.renderer.resize();
    const pad = 24;
    const scale = Math.min(
      (window.innerWidth - pad) / 1200,
      (window.innerHeight - pad) / 760,
    );
    const w = Math.max(320, 1200 * scale);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${w * (760 / 1200)}px`;
  }

  private buildRoster(): void {
    this.rosterHost.innerHTML = '';
    for (const def of CHARS) {
      const art = this.arts[def.id];
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.dataset.id = def.id;
      btn.type = 'button';
      btn.title = `${def.name}：${def.desc}`;
      btn.innerHTML = `
        <div class="ava" style="background-image:url('${art?.portrait ?? ''}')"></div>
        <div class="info">
          <div class="name-row"><b>${def.name}</b><span class="role">${def.role}</span></div>
          <div class="statline">HP ${def.hp} · 速度 ${def.speed} · 攻击 ${def.atk}</div>
          <div class="skills">
            <span class="chip">${skillById(def.skills[0]).name}</span>
            <span class="chip">${skillById(def.skills[1]).name}</span>
          </div>
        </div>
        <div class="pick-mark"></div>
      `;
      btn.addEventListener('click', () => {
        this.selection[this.activeSide] = def.id;
        this.activeSide = this.activeSide === 0 ? 1 : 0;
        this.refreshSelection();
        this.makePreview();
      });
      this.rosterHost.appendChild(btn);
    }
  }

  private bindTabs(): void {
    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('.tab'))) {
      tab.addEventListener('click', () => {
        this.activeSide = Number(tab.dataset.pick) === 1 ? 1 : 0;
        this.refreshSelection();
      });
    }
  }

  private refreshSelection(): void {
    const [left, right] = this.selection;
    for (const el of Array.from(this.rosterHost.querySelectorAll<HTMLElement>('.card'))) {
      const id = el.dataset.id;
      const isLeft = id === left;
      const isRight = id === right;
      el.classList.toggle('sel', isLeft || isRight);
      el.classList.toggle('sel-left', isLeft);
      el.classList.toggle('sel-right', isRight);
      const mark = el.querySelector<HTMLElement>('.pick-mark');
      if (mark) mark.textContent = isLeft && isRight ? '双' : isLeft ? '左' : isRight ? '右' : '';
    }

    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('.tab'))) {
      tab.classList.toggle('active', Number(tab.dataset.pick) === this.activeSide);
    }

    for (const side of [0, 1] as const) {
      const def = charById(this.selection[side]);
      const art = this.arts[def.id];
      const slot = this.slotEls[side];
      const ava = slot.querySelector<HTMLElement>('.slot-ava');
      const name = slot.querySelector<HTMLElement>('.slot-name');
      const role = slot.querySelector<HTMLElement>('.slot-role');
      const skills = slot.querySelector<HTMLElement>('.slot-skills');
      if (ava) ava.style.backgroundImage = `url('${art?.portrait ?? ''}')`;
      if (name) name.textContent = def.name;
      if (role) role.textContent = def.role;
      if (skills) {
        skills.innerHTML = def.skills
          .map((id) => `<span class="chip">${skillById(id).name}</span>`)
          .join('');
      }
      slot.classList.toggle('active', this.activeSide === side);
    }
  }

  private makePreview(): void {
    if (!this.preview) return;
    const w = new World(charById(this.selection[0]), charById(this.selection[1]), 1);
    w.phase = 'fight';
    w.time = 0;
    w.countdown = 0;
    this.world = w;
  }

  private startMatch(): void {
    this.sfx.enable();
    const seed = this.fixedSeed ?? randomSeed();
    this.fixedSeed = null;
    const world = new World(charById(this.selection[0]), charById(this.selection[1]), seed);
    world.onSound = (name) => this.sfx.play(name);
    if (this.warp > 0) {
      const steps = Math.round(this.warp * 60);
      for (let i = 0; i < steps && world.phase !== 'over'; i++) world.update(1 / 60);
      this.warp = 0;
    }
    this.world = world;
    this.preview = false;
    this.resultShown = false;
    this.paused = false;
    this.speedBtn.textContent = `${this.speed}×`;
    this.pauseBtn.textContent = '暂停';
    this.loop.setTimeScale(this.speed);
    this.menu.classList.add('hidden');
    this.result.classList.add('hidden');
    this.controls.classList.remove('hidden');
    this.topbar.classList.add('hidden');
    document.body.dataset.mode = 'battle';
  }

  private checkResult(): void {
    if (this.preview || this.resultShown) return;
    const w = this.world;
    if (!w || w.phase !== 'over') return;
    this.resultShown = true;
    this.showResult(w);
  }

  private showResult(w: World): void {
    const draw = w.winner === null;
    const winner = draw ? null : w.frogs[w.winner as Side];
    const portrait = winner ? this.arts[winner.def.id]?.portrait : this.arts[w.frogs[0].def.id]?.portrait;

    const totalSkills = w.frogs[0].stats.skills + w.frogs[1].stats.skills;
    const totalDamage = Math.round(w.frogs[0].stats.damage + w.frogs[1].stats.damage);
    const boil = w.boilStacks > 0 ? ` · 沸腾 ×${w.boilStacks}` : '';

    this.result.innerHTML = `
      <div class="result-card">
        <div class="win-label">${draw ? 'D R A W' : 'W I N N E R'}</div>
        <div class="result-ava" style="background-image:url('${portrait ?? ''}')"></div>
        <div class="result-name">${draw ? '同归于尽' : `${winner!.def.name} 获胜`}</div>
        <div class="result-sub">用时 ${fmtTime(w.time)} · 剩余 ${draw ? '—' : Math.ceil(winner!.hp)} HP${boil}</div>
        <div class="result-stats">
          <div class="cell"><b>${totalDamage}</b><span>总伤害</span></div>
          <div class="cell"><b>${totalSkills}</b><span>技能释放</span></div>
          <div class="cell"><b>${w.boilStacks}</b><span>沸腾层数</span></div>
        </div>
        <div class="result-actions">
          <button class="ghost-btn" id="again">再来一局</button>
          <button class="primary-btn" id="change">换角色</button>
        </div>
      </div>
    `;
    this.result.classList.remove('hidden');
    this.controls.classList.add('hidden');

    $('again').addEventListener('click', () => this.startMatch());
    $('change').addEventListener('click', () => this.showMenu());
  }

  private showMenu(): void {
    this.preview = true;
    this.resultShown = false;
    this.result.classList.add('hidden');
    this.controls.classList.add('hidden');
    this.topbar.classList.remove('hidden');
    this.menu.classList.remove('hidden');
    this.loop.setTimeScale(1);
    this.makePreview();
    document.body.dataset.mode = 'menu';
  }

  private togglePause(): void {
    if (!this.world || this.world.phase !== 'fight') return;
    this.paused = !this.paused;
    this.pauseBtn.textContent = this.paused ? '继续' : '暂停';
    this.loop.setTimeScale(this.paused ? 0 : this.speed);
  }

  private toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
    this.speedBtn.textContent = `${this.speed}×`;
    if (!this.paused) this.loop.setTimeScale(this.speed);
  }

  private restart(): void {
    if (this.preview) return;
    this.startMatch();
  }
}
