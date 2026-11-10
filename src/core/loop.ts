/**
 * Fixed-timestep loop: simulation always advances in STEP seconds,
 * rendering happens once per animation frame with an interpolation alpha.
 */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  private timeScale = 1;

  constructor(
    private readonly step: number,
    private readonly onStep: (dt: number) => void,
    private readonly onRender: (alpha: number, frameDt: number) => void,
    private readonly maxSteps = 6,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      const raw = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.acc += raw * this.timeScale;
      let steps = 0;
      while (this.acc >= this.step && steps < this.maxSteps) {
        this.onStep(this.step);
        this.acc -= this.step;
        steps++;
      }
      if (steps === this.maxSteps) this.acc = 0;
      this.onRender(this.acc / this.step, raw);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.max(0, scale);
  }

  get scale(): number {
    return this.timeScale;
  }
}
