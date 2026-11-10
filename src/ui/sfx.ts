type Wave = OscillatorType;

/** Tiny synthesized SFX so the prototype has punch without audio assets. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastHit = 0;
  muted = false;

  enable(): void {
    if (this.muted) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.15;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    void this.ctx.resume();
  }

  toggle(): boolean {
    this.muted = !this.muted;
    if (!this.muted) this.enable();
    return this.muted;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, slideTo?: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, freq = 900, q = 1): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  play(name: string): void {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'hit': {
        const now = performance.now();
        if (now - this.lastHit < 35) return;
        this.lastHit = now;
        this.tone(190, 0.07, 'square', 0.35, 90);
        this.hiss(0.05, 0.1, 1400, 0.8);
        break;
      }
      case 'whip':
        this.tone(880, 0.1, 'sawtooth', 0.18, 260);
        break;
      case 'jump':
        this.tone(420, 0.16, 'sine', 0.22, 880);
        break;
      case 'charge':
        this.tone(120, 0.35, 'sawtooth', 0.22, 320);
        break;
      case 'gore':
        this.tone(110, 0.16, 'square', 0.26, 60);
        this.hiss(0.12, 0.12, 700, 0.7);
        break;
      case 'blink':
        this.tone(1100, 0.12, 'sine', 0.16, 1600);
        break;
      case 'steal':
        this.tone(700, 0.12, 'triangle', 0.2, 1300);
        break;
      case 'peck':
        this.tone(1400, 0.045, 'square', 0.16);
        this.tone(1800, 0.04, 'square', 0.1);
        break;
      case 'breath':
        this.hiss(0.7, 0.16, 480, 0.6);
        this.tone(140, 0.5, 'sawtooth', 0.12, 80);
        break;
      case 'cloud':
        this.tone(520, 0.4, 'sine', 0.14, 980);
        this.tone(780, 0.4, 'sine', 0.08, 1200);
        break;
      case 'roll':
        this.tone(90, 0.5, 'sawtooth', 0.2, 150);
        break;
      case 'eat':
        this.tone(300, 0.18, 'sine', 0.18, 520);
        this.tone(420, 0.16, 'sine', 0.12, 640);
        break;
      case 'shield':
        this.tone(1200, 0.06, 'sine', 0.12, 900);
        break;
      case 'swallow':
        this.tone(220, 0.22, 'sine', 0.28, 70);
        this.tone(140, 0.12, 'square', 0.1, 60);
        break;
      case 'bubble':
        this.tone(620, 0.1, 'sine', 0.14, 980);
        break;
      case 'milk':
        this.tone(380, 0.16, 'triangle', 0.2, 180);
        break;
      case 'swap':
        this.tone(760, 0.1, 'sine', 0.18, 1300);
        this.tone(1300, 0.1, 'sine', 0.1, 620);
        break;
      case 'egg':
        this.tone(880, 0.1, 'triangle', 0.16, 660);
        break;
      case 'vortex':
        this.tone(180, 0.7, 'sawtooth', 0.16, 900);
        break;
      case 'fart':
        this.tone(90, 0.32, 'sawtooth', 0.24, 55);
        this.hiss(0.25, 0.12, 260, 0.4);
        break;
      case 'roar':
        this.tone(120, 0.45, 'sawtooth', 0.28, 70);
        this.hiss(0.35, 0.14, 400, 0.6);
        break;
      case 'coil':
        this.tone(300, 0.3, 'triangle', 0.16, 180);
        break;
      case 'venom':
        this.tone(520, 0.12, 'sawtooth', 0.16, 260);
        this.hiss(0.15, 0.08, 900, 1);
        break;
      case 'gallop':
        this.tone(150, 0.4, 'sawtooth', 0.16, 260);
        break;
      case 'shell':
        this.tone(700, 0.1, 'triangle', 0.16, 420);
        break;
      case 'hatch':
        this.tone(600, 0.2, 'sine', 0.18, 1000);
        this.tone(900, 0.25, 'triangle', 0.12, 1400);
        break;
      case 'delivery':
        this.tone(420, 0.12, 'square', 0.16, 260);
        break;
      case 'poop':
        this.tone(160, 0.16, 'sawtooth', 0.16, 80);
        break;
      case 'smite':
        this.tone(1200, 0.3, 'sine', 0.14, 600);
        this.tone(500, 0.25, 'triangle', 0.12, 900);
        break;
      case 'revive':
        this.tone(440, 0.5, 'sine', 0.2, 880);
        this.tone(660, 0.6, 'sine', 0.12, 1320);
        break;
      case 'rat':
        this.tone(900, 0.1, 'triangle', 0.14, 1200);
        this.tone(700, 0.1, 'triangle', 0.1, 500);
        break;
      case 'strength':
        this.tone(90, 0.35, 'sawtooth', 0.26, 160);
        break;
      case 'balance':
        this.tone(520, 0.3, 'sine', 0.16, 780);
        this.tone(780, 0.3, 'sine', 0.12, 520);
        break;
      case 'haste':
        this.tone(500, 0.18, 'triangle', 0.16, 1100);
        break;
      case 'fire':
        this.hiss(0.3, 0.14, 700, 0.7);
        this.tone(180, 0.2, 'sawtooth', 0.14, 90);
        break;
      case 'invis':
        this.tone(1200, 0.18, 'sine', 0.12, 500);
        break;
      case 'heal':
        this.tone(520, 0.25, 'sine', 0.14, 780);
        break;
      case 'astral':
        this.tone(880, 0.35, 'sine', 0.12, 1500);
        break;
      case 'levitate':
        this.tone(400, 0.35, 'sine', 0.14, 900);
        break;
      case 'immortal':
        this.tone(240, 0.4, 'square', 0.16, 480);
        this.tone(480, 0.4, 'sine', 0.1, 960);
        break;
      case 'laser':
        this.tone(1600, 0.12, 'sawtooth', 0.16, 500);
        break;
      case 'laugh':
        this.tone(520, 0.09, 'triangle', 0.14, 700);
        this.tone(660, 0.11, 'triangle', 0.12, 840);
        this.tone(820, 0.13, 'triangle', 0.1, 980);
        break;
      case 'ko':
        this.tone(220, 0.7, 'sawtooth', 0.3, 55);
        this.hiss(0.5, 0.16, 500, 0.5);
        break;
      case 'start':
        this.tone(330, 0.16, 'triangle', 0.18, 660);
        break;
      case 'boil':
        this.tone(70, 0.6, 'sine', 0.35, 40);
        this.hiss(0.4, 0.1, 300, 0.4);
        break;
      default:
        break;
    }
  }
}
