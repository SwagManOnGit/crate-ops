// Synthesised sound effects (no audio files). Follows the YouTube Playables audio
// rules: the SDK decides whether audio is enabled; there is no in-game mute button.
//
// The crate sounds are built to feel like a classic case opening: a key-and-latch
// unlock with a lid whoosh, a dry plastic "tk" for every item that passes the marker,
// a heavy stop, then a reveal sting that grows with rarity and rings out in a reverb.

type OscType = OscillatorType;

interface Voice {
  /** seconds from now */
  at?: number;
  /** send level into the reverb, 0..1 */
  wet?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: GainNode | null = null;
  private enabled = true;
  private paused = false;
  private noiseBuf: AudioBuffer | null = null;
  private lastTick = 0;

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on && !this.paused ? 0.55 : 0;
  }

  setPaused(p: boolean): void {
    this.paused = p;
    if (this.master) this.master.gain.value = this.enabled && !p ? 0.55 : 0;
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
      const c = new AC();
      this.ctx = c;
      this.master = c.createGain();
      this.master.gain.value = this.enabled && !this.paused ? 0.55 : 0;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 5;
      this.master.connect(comp);
      comp.connect(c.destination);

      const len = Math.floor(c.sampleRate * 1.0);
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // small-hall impulse response: decaying noise that darkens over time
      const irLen = Math.floor(c.sampleRate * 2.2);
      const ir = c.createBuffer(2, irLen, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const out = ir.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < irLen; i++) {
          const t = i / irLen;
          const k = 0.55 - 0.45 * t;
          lp += (Math.random() * 2 - 1 - lp) * k;
          out[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
        }
      }
      const conv = c.createConvolver();
      conv.buffer = ir;
      this.reverb = c.createGain();
      this.reverb.gain.value = 0.9;
      this.reverb.connect(conv);
      conv.connect(this.master);
    } catch {
      this.ctx = null;
    }
  }

  private out(node: AudioNode, wet = 0): void {
    node.connect(this.master!);
    if (wet > 0 && this.reverb) {
      const send = this.ctx!.createGain();
      send.gain.value = wet;
      node.connect(send);
      send.connect(this.reverb);
    }
  }

  private live(): AudioContext | null {
    return this.ctx && this.master && this.enabled && !this.paused ? this.ctx : null;
  }

  /** Oscillator with a percussive envelope; optional pitch glide. */
  private tone(freq: number, dur: number, type: OscType, vol: number, o: Voice & { to?: number; attack?: number } = {}): void {
    const c = this.live();
    if (!c) return;
    const t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this.out(g, o.wet);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** Filtered noise burst; the filter can sweep. */
  private noise(dur: number, vol: number, freq: number, o: Voice & { q?: number; type?: BiquadFilterType; to?: number; attack?: number } = {}): void {
    const c = this.live();
    if (!c || !this.noiseBuf) return;
    const t = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.002));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    this.out(g, o.wet);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  /** Struck-metal voice: a fundamental with slightly inharmonic overtones that die away faster. */
  private bell(freq: number, dur: number, vol: number, o: Voice = {}): void {
    const partials: [number, number, number][] = [[1, 1, 1], [2.01, 0.42, 0.7], [3.02, 0.2, 0.5], [4.2, 0.1, 0.34], [5.43, 0.05, 0.25]];
    for (const [ratio, gain, life] of partials) {
      if (freq * ratio > 9000) continue;
      this.tone(freq * ratio, dur * life, 'sine', vol * gain, o);
    }
  }

  click(): void {
    this.noise(0.018, 0.1, 4200, { q: 1.5, type: 'highpass' });
    this.tone(1250, 0.03, 'sine', 0.05);
  }

  /** Key in, latch thrown, lid lifts: played as the roulette starts. */
  crateOpen(): void {
    // key and tumblers
    this.noise(0.022, 0.3, 3400, { q: 7 });
    this.noise(0.02, 0.24, 2500, { q: 7, at: 0.07 });
    this.tone(2640, 0.06, 'sine', 0.035, { at: 0.07 });
    // latch
    this.noise(0.07, 0.5, 1500, { type: 'lowpass', at: 0.15 });
    this.tone(150, 0.14, 'sine', 0.5, { at: 0.15, to: 62 });
    this.tone(1890, 0.2, 'sine', 0.03, { at: 0.15, wet: 0.3 });
    // lid whoosh
    this.noise(0.5, 0.2, 380, { q: 0.9, to: 2600, at: 0.2, attack: 0.22, wet: 0.25 });
  }

  /**
   * One item passing the marker: a dry, hollow plastic tick.
   * `pitch` lets several reels sound distinct; ticks are rate-limited so a fast spin purrs instead of buzzing.
   */
  tick(pitch = 1): void {
    const now = performance.now();
    if (now - this.lastTick < 24) return;
    this.lastTick = now;
    const p = pitch * (0.97 + Math.random() * 0.06);
    this.noise(0.009, 0.3, 5200, { type: 'highpass', q: 0.7 });
    this.tone(1180 * p, 0.034, 'sine', 0.24);
    this.tone(2360 * p, 0.018, 'sine', 0.09);
    this.tone(330 * p, 0.03, 'triangle', 0.13);
  }

  /** The reel settles on the drop. */
  stop(): void {
    this.noise(0.1, 0.55, 1100, { type: 'lowpass' });
    this.tone(118, 0.22, 'sine', 0.55, { to: 52 });
    this.tone(700, 0.05, 'sine', 0.2);
    this.noise(0.03, 0.25, 4800, { type: 'highpass', at: 0.004 });
  }

  /** Generic mechanical latch (vault, selections). */
  latch(): void {
    this.noise(0.06, 0.4, 1300, { type: 'lowpass' });
    this.tone(130, 0.12, 'sine', 0.35, { to: 60 });
    this.noise(0.02, 0.22, 4200, { q: 3, at: 0.06 });
  }

  /** Reveal sting: every tier adds weight, notes and tail. */
  reveal(tier: number): void {
    tier = Math.min(6, Math.max(0, tier));
    const root = [196, 220, 233.1, 261.6, 293.7, 329.6, 392][tier];
    // air rushing in, then the hit
    this.noise(0.22, 0.14 + tier * 0.02, 2600, { q: 0.8, to: 500, attack: 0.16, wet: 0.2 });
    this.tone(78, 0.5 + tier * 0.06, 'sine', 0.34 + tier * 0.05, { at: 0.16, to: 36 });
    this.noise(0.09, 0.3, 900, { type: 'lowpass', at: 0.16 });
    const wet = 0.25 + tier * 0.09;
    const chords: number[][] = [
      [1],
      [1, 1.5],
      [1, 1.25, 1.5],
      [1, 1.25, 1.5, 2],
      [1, 1.26, 1.5, 2, 2.52],
      [1, 1.26, 1.5, 1.89, 2, 2.52, 3],
      [1, 1.26, 1.5, 1.89, 2.25, 2.52, 3, 3.78, 4],
    ];
    const notes = chords[tier];
    const gap = tier >= 5 ? 0.07 : 0.05;
    notes.forEach((m, i) => this.bell(root * m, 0.9 + tier * 0.28, 0.17 - i * 0.008, { at: 0.17 + i * gap, wet }));
    if (tier >= 3) {
      // a held pad under the bells
      for (const m of [0.5, 1, 1.5]) this.tone(root * m, 1.1 + tier * 0.25, 'sawtooth', 0.022, { at: 0.17, attack: 0.25, wet: 0.5 });
    }
    if (tier >= 4) this.noise(1.3 + tier * 0.2, 0.05, 7000, { type: 'highpass', at: 0.2, attack: 0.3, wet: 0.6 });
    if (tier >= 5) {
      // glitter: quick high bells scattered over the tail
      for (let i = 0; i < 6 + (tier - 5) * 6; i++) {
        this.bell(root * [4, 5.04, 6, 7.56, 8][i % 5], 0.5, 0.035, { at: 0.5 + i * 0.09 + Math.random() * 0.04, wet: 0.7 });
      }
      this.tone(root / 2, 2.0, 'sawtooth', 0.05, { at: 0.17, attack: 0.5, wet: 0.5 });
    }
  }

  sell(): void {
    this.bell(1568, 0.22, 0.09, { wet: 0.15 });
    this.bell(2093, 0.3, 0.08, { at: 0.07, wet: 0.2 });
    this.noise(0.04, 0.07, 7000, { q: 3, at: 0.02 });
  }

  buy(): void {
    this.tone(520, 0.09, 'triangle', 0.15);
    this.tone(780, 0.16, 'triangle', 0.13, { at: 0.07, wet: 0.15 });
  }

  error(): void {
    this.tone(150, 0.16, 'sawtooth', 0.09);
    this.tone(112, 0.2, 'sawtooth', 0.09, { at: 0.09 });
  }

  upgrade(): void {
    [440, 554, 659, 880].forEach((f, i) => this.bell(f, 0.4, 0.1, { at: i * 0.055, wet: 0.2 }));
  }

  rank(): void {
    [392, 523, 659, 784, 1047].forEach((f, i) => this.bell(f, 0.8, 0.13, { at: i * 0.09, wet: 0.4 }));
    this.noise(0.8, 0.05, 6000, { type: 'highpass', at: 0.3, attack: 0.2, wet: 0.5 });
  }

  win(): void {
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.bell(f, 0.7, 0.12, { at: i * 0.08, wet: 0.4 }));
    this.tone(65, 0.5, 'sine', 0.4, { to: 40 });
  }

  lose(): void {
    this.tone(330, 0.35, 'sawtooth', 0.09, { to: 110, wet: 0.2 });
    this.noise(0.4, 0.2, 300, { type: 'lowpass', at: 0.05 });
  }

  smash(): void {
    this.noise(0.5, 0.5, 500, { type: 'lowpass', wet: 0.3 });
    this.noise(0.25, 0.3, 3000, { q: 1.5 });
    this.tone(90, 0.45, 'sawtooth', 0.2, { to: 38 });
    for (let i = 0; i < 5; i++) this.noise(0.05, 0.15, 2500 + Math.random() * 3000, { q: 6, at: 0.08 + i * 0.06 + Math.random() * 0.03 });
  }

  /** Rising whirr while the trade-up needle spins. */
  whirr(dur: number): void {
    this.tone(110, dur, 'sawtooth', 0.045, { to: 520, attack: 0.3 });
    this.noise(dur, 0.05, 900, { q: 1, to: 3200, attack: 0.4 });
  }

  claim(): void {
    this.bell(784, 0.3, 0.12, { wet: 0.2 });
    this.bell(1175, 0.45, 0.12, { at: 0.08, wet: 0.3 });
  }
}
