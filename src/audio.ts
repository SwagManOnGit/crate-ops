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
  private tone(freq: number, dur: number, type: OscType, vol: number, o: Voice & { to?: number; attack?: number; lp?: number } = {}): void {
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
    if (o.lp) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.lp;
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    this.out(g, o.wet);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** Brass-like voice: two detuned saws and a sub, rounded off by a low-pass. */
  private brass(freq: number, dur: number, vol: number, o: Voice = {}): void {
    const lp = Math.min(5200, freq * 5);
    this.tone(freq, dur, 'sawtooth', vol, { ...o, attack: 0.04, lp });
    this.tone(freq * 1.005, dur, 'sawtooth', vol * 0.8, { ...o, attack: 0.05, lp });
    this.tone(freq / 2, dur, 'square', vol * 0.35, { ...o, attack: 0.05, lp: 900 });
  }

  /** Lead-in shared by the reveal stings: air rushing in, then a hit. `weight` 0..1 scales it. */
  private impact(weight: number, at = 0.16): void {
    this.noise(at + 0.05, 0.1 + weight * 0.12, 2600, { q: 0.8, to: 500, attack: at * 0.9, wet: 0.2 });
    this.tone(84 - weight * 20, 0.35 + weight * 0.6, 'sine', 0.28 + weight * 0.34, { at, to: 34 });
    this.noise(0.09, 0.2 + weight * 0.2, 900, { type: 'lowpass', at });
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

  /**
   * Reveal sting. Every rarity has its own sound, so the ear knows what dropped before the eye does:
   * 0 Surplus    a dull clunk
   * 1 Service    a soft two-note chime
   * 2 Tactical   crisp radio blips up to a clean bell
   * 3 Elite      a minor-ninth bell arpeggio over a pad
   * 4 Prototype  a charged riser snapping into a bright synth stab
   * 5 Apex       a deep hit and a brass call that swells into a held chord
   * 6 Exotic     the jackpot: harp run, full chord, brass pad and a long glitter tail
   */
  reveal(tier: number): void {
    switch (Math.min(6, Math.max(0, Math.round(tier)))) {
      case 0:
        this.noise(0.12, 0.4, 650, { type: 'lowpass' });
        this.tone(150, 0.2, 'sine', 0.36, { to: 70 });
        this.tone(196, 0.3, 'triangle', 0.1, { at: 0.03 });
        break;
      case 1:
        this.impact(0.1);
        this.bell(392, 0.55, 0.14, { at: 0.17, wet: 0.25 });
        this.bell(493.9, 0.7, 0.13, { at: 0.27, wet: 0.3 });
        break;
      case 2:
        this.impact(0.25);
        [523.3, 659.3, 784].forEach((f, i) => this.tone(f, 0.075, 'square', 0.06, { at: 0.17 + i * 0.075, lp: 2600 }));
        this.bell(1046.5, 0.9, 0.15, { at: 0.4, wet: 0.35 });
        this.bell(784, 0.9, 0.08, { at: 0.4, wet: 0.35 });
        break;
      case 3:
        this.impact(0.4);
        [440, 523.3, 659.3, 987.8].forEach((f, i) => this.bell(f, 1.3, 0.15 - i * 0.01, { at: 0.17 + i * 0.07, wet: 0.5 }));
        for (const f of [220, 329.6]) this.tone(f, 1.6, 'sawtooth', 0.03, { at: 0.17, attack: 0.3, lp: 1400, wet: 0.5 });
        break;
      case 4:
        this.tone(180, 0.3, 'sawtooth', 0.07, { to: 720, attack: 0.2, lp: 3000 });
        this.impact(0.6, 0.3);
        for (const f of [329.6, 415.3, 493.9, 659.3]) {
          this.tone(f, 0.9, 'sawtooth', 0.045, { at: 0.3, attack: 0.01, lp: 3800, wet: 0.5 });
          this.tone(f * 1.006, 0.9, 'sawtooth', 0.045, { at: 0.3, attack: 0.01, lp: 3800 });
        }
        this.bell(1318.5, 1.2, 0.1, { at: 0.3, wet: 0.6 });
        this.noise(1.3, 0.05, 7000, { type: 'highpass', at: 0.3, attack: 0.05, wet: 0.6 });
        [1975.5, 2637].forEach((f, i) => this.bell(f, 0.6, 0.05, { at: 0.62 + i * 0.14, wet: 0.7 }));
        break;
      case 5:
        this.impact(0.9, 0.28);
        [293.7, 440, 587.3].forEach((f, i) => this.brass(f, 0.26, 0.11, { at: 0.3 + i * 0.17, wet: 0.45 }));
        for (const f of [293.7, 370, 440, 587.3, 740]) this.brass(f, 1.8, 0.06, { at: 0.82, wet: 0.6 });
        this.noise(1.8, 0.09, 6000, { type: 'highpass', at: 0.82, attack: 0.5, wet: 0.7 });
        for (let i = 0; i < 6; i++) this.bell([1174.7, 1480, 1760, 2349.3][i % 4], 0.5, 0.04, { at: 1.0 + i * 0.11, wet: 0.7 });
        break;
      default: {
        this.impact(1, 0.36);
        const run = [523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760, 2093, 2349.3, 2637];
        run.forEach((f, i) => this.bell(f, 0.9, 0.085, { at: 0.38 + i * 0.042, wet: 0.6 }));
        const t = 0.38 + run.length * 0.042 + 0.02;
        for (const f of [261.6, 329.6, 392, 523.3, 659.3, 784]) this.bell(f, 2.6, 0.12, { at: t, wet: 0.7 });
        for (const f of [130.8, 196, 261.6, 392]) this.brass(f, 2.4, 0.045, { at: t, wet: 0.7 });
        this.tone(65.4, 1.4, 'sine', 0.4, { at: t, to: 40 });
        this.noise(2.6, 0.08, 7500, { type: 'highpass', at: t, attack: 0.4, wet: 0.8 });
        for (let i = 0; i < 16; i++) {
          this.bell([2093, 2637, 3136, 3951, 4186][Math.floor(Math.random() * 5)], 0.45, 0.035, { at: t + 0.15 + i * 0.1 + Math.random() * 0.05, wet: 0.8 });
        }
      }
    }
  }

  /** Short rarity cue for quick reveals (crate battles): the opening beat of each sting. */
  cue(tier: number): void {
    switch (Math.min(6, Math.max(0, Math.round(tier)))) {
      case 0:
        this.tone(180, 0.09, 'triangle', 0.12, { to: 120 });
        break;
      case 1:
        this.bell(392, 0.3, 0.1, { wet: 0.15 });
        break;
      case 2:
        [523.3, 784].forEach((f, i) => this.tone(f, 0.07, 'square', 0.055, { at: i * 0.07, lp: 2600 }));
        break;
      case 3:
        [440, 659.3].forEach((f, i) => this.bell(f, 0.5, 0.11, { at: i * 0.07, wet: 0.35 }));
        break;
      case 4:
        for (const f of [329.6, 493.9, 659.3]) this.tone(f, 0.4, 'sawtooth', 0.045, { attack: 0.01, lp: 3800, wet: 0.4 });
        this.bell(1318.5, 0.6, 0.08, { wet: 0.5 });
        break;
      case 5:
        this.tone(70, 0.4, 'sine', 0.4, { to: 36 });
        [293.7, 440, 587.3].forEach((f, i) => this.brass(f, 0.2 + (i === 2 ? 0.5 : 0), 0.09, { at: i * 0.11, wet: 0.5 }));
        break;
      default:
        this.tone(65.4, 0.6, 'sine', 0.4, { to: 40 });
        [523.3, 659.3, 784, 1046.5, 1318.5, 1568].forEach((f, i) => this.bell(f, 0.8, 0.08, { at: i * 0.045, wet: 0.6 }));
        for (const f of [261.6, 392, 523.3]) this.bell(f, 1.4, 0.1, { at: 0.3, wet: 0.7 });
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
