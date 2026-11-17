// Synthesised sound effects (no audio files). Follows the YouTube Playables audio
// rules: the SDK decides whether audio is enabled; there is no in-game mute button.

type OscType = OscillatorType;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private paused = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastTick = 0;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on && !this.paused ? 0.5 : 0;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (this.master) this.master.gain.value = this.enabled && !p ? 0.5 : 0;
    if (this.ctx) {
      if (p) void this.ctx.suspend().catch(() => undefined);
      else void this.ctx.resume().catch(() => undefined);
    }
  }

  /** Browsers only allow audio after a gesture; call this from the first tap. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume().catch(() => undefined);
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled && !this.paused ? 0.5 : 0;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscType, vol: number, delay = 0, slideTo = 0): void {
    const c = this.ctx;
    if (!c || !this.master || !this.enabled || this.paused) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noiseBuf || !this.enabled || this.paused) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.2, dur + 0.02);
  }

  click(): void {
    this.tone(880, 0.045, 'square', 0.05);
    this.noise(0.03, 0.06, 3200, 2);
  }

  /** Roulette / reel tick: a short mechanical clack, rate-limited. */
  tick(pitch = 1): void {
    const now = performance.now();
    if (now - this.lastTick < 28) return;
    this.lastTick = now;
    this.noise(0.035, 0.22, 2400 * pitch, 3);
    this.tone(190 * pitch, 0.03, 'square', 0.05);
  }

  latch(): void {
    this.noise(0.09, 0.35, 900, 1.2);
    this.tone(120, 0.12, 'triangle', 0.25, 0, 60);
    this.noise(0.05, 0.25, 4200, 2, 0.07);
  }

  /** Reveal sting: taller and brighter for rarer drops. */
  reveal(tier: number): void {
    const base = [196, 220, 262, 294, 330, 392, 440][Math.min(6, Math.max(0, tier))];
    const steps = tier >= 5 ? [1, 1.25, 1.5, 2, 2.5, 3] : tier >= 3 ? [1, 1.25, 1.5, 2] : tier >= 1 ? [1, 1.5] : [1];
    steps.forEach((m, i) => {
      this.tone(base * m, 0.5 + tier * 0.08, 'triangle', 0.16, i * 0.075);
      this.tone(base * m * 2, 0.3, 'sine', 0.05, i * 0.075);
    });
    if (tier >= 4) this.noise(0.9, 0.12, 6000, 0.6, 0, 'highpass');
    if (tier >= 5) this.tone(base / 2, 1.2, 'sawtooth', 0.09, 0, base / 2);
  }

  sell(): void {
    this.tone(1320, 0.07, 'square', 0.06);
    this.tone(1760, 0.12, 'square', 0.06, 0.06);
    this.noise(0.05, 0.08, 7000, 3, 0.02);
  }

  buy(): void {
    this.tone(520, 0.08, 'triangle', 0.14);
    this.tone(780, 0.14, 'triangle', 0.12, 0.07);
  }

  error(): void {
    this.tone(150, 0.16, 'sawtooth', 0.09);
    this.tone(112, 0.2, 'sawtooth', 0.09, 0.09);
  }

  upgrade(): void {
    [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.13, i * 0.055));
  }

  rank(): void {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.34, 'triangle', 0.15, i * 0.09));
    this.noise(0.6, 0.06, 5000, 0.7, 0.3, 'highpass');
  }

  win(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'square', 0.07, i * 0.08));
  }

  lose(): void {
    this.tone(330, 0.3, 'sawtooth', 0.09, 0, 110);
    this.noise(0.4, 0.2, 300, 0.8, 0.05, 'lowpass');
  }

  smash(): void {
    this.noise(0.5, 0.5, 500, 0.7, 0, 'lowpass');
    this.noise(0.25, 0.3, 3000, 1.5);
    this.tone(90, 0.4, 'sawtooth', 0.2, 0, 40);
  }

  /** Rising whirr while the trade-up needle spins. */
  whirr(dur: number): void {
    this.tone(120, dur, 'sawtooth', 0.05, 0, 520);
    this.noise(dur, 0.05, 1800, 1);
  }

  claim(): void {
    this.tone(660, 0.09, 'triangle', 0.14);
    this.tone(990, 0.2, 'triangle', 0.14, 0.08);
  }
}
