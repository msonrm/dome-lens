// One Euro フィルタ（静止時はブレを強く抑え、速く動くときは遅れを減らす）
// Casiez et al., "1€ Filter", CHI 2012

class LowPass {
  private y: number | null = null;
  filter(x: number, a: number) { this.y = this.y === null ? x : a * x + (1 - a) * this.y; return this.y; }
  last() { return this.y; }
  reset() { this.y = null; }
}

export class OneEuro {
  private x = new LowPass(); private dx = new LowPass();
  private t: number | null = null;
  constructor(public minCutoff = 1.0, public beta = 0.02, public dCutoff = 1.0) {}
  private alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, tSec: number) {
    const dt = this.t === null ? 1 / 30 : Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const prev = this.x.last();
    const d = prev === null ? 0 : (v - prev) / dt;
    const ed = this.dx.filter(d, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(ed);
    return this.x.filter(v, this.alpha(cutoff, dt));
  }
  reset() { this.x.reset(); this.dx.reset(); this.t = null; }
}
