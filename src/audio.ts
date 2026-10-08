/**
 * Ambient sea sounds synthesised with WebAudio. No asset files; off by default.
 * The context is only created after the user presses the sound toggle.
 */
export class SeaAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private on = false;

  get enabled(): boolean {
    return this.on;
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.noise = this.makeBrownNoise(ctx, 5);
    this.buildAmbience(ctx, this.master);
    return ctx;
  }

  private makeBrownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }
    // Crossfade the seam so the loop is click-free.
    const fade = Math.floor(ctx.sampleRate * 0.15);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = data[i]! * k + data[len - fade + i]! * (1 - k);
    }
    return buf;
  }

  private layer(ctx: AudioContext, out: AudioNode, opts: { type: BiquadFilterType; freq: number; q: number; gain: number; lfoHz: number; lfoDepth: number; gainLfoHz: number }): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.loopStart = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.value = opts.freq;
    filter.Q.value = opts.q;
    const gain = ctx.createGain();
    gain.gain.value = opts.gain;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = opts.lfoHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = opts.freq * opts.lfoDepth;
    lfo.connect(lfoGain).connect(filter.frequency);

    const swell = ctx.createOscillator();
    swell.frequency.value = opts.gainLfoHz;
    const swellGain = ctx.createGain();
    swellGain.gain.value = opts.gain * 0.55;
    swell.connect(swellGain).connect(gain.gain);

    src.connect(filter).connect(gain).connect(out);
    for (const s of [src, lfo, swell]) {
      s.start();
      this.sources.push(s);
    }
  }

  private buildAmbience(ctx: AudioContext, out: AudioNode): void {
    this.layer(ctx, out, { type: 'lowpass', freq: 420, q: 0.6, gain: 0.55, lfoHz: 0.07, lfoDepth: 0.35, gainLfoHz: 0.09 });
    this.layer(ctx, out, { type: 'bandpass', freq: 1100, q: 0.45, gain: 0.07, lfoHz: 0.11, lfoDepth: 0.4, gainLfoHz: 0.13 });
  }

  async setEnabled(enable: boolean): Promise<boolean> {
    if (enable) {
      const ctx = this.ensure();
      if (!ctx || !this.master) return false;
      if (ctx.state === 'suspended') await ctx.resume();
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.6);
      this.on = true;
    } else if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      this.on = false;
      const ctx = this.ctx;
      window.setTimeout(() => {
        if (!this.on) void ctx.suspend();
      }, 1200);
    }
    return this.on;
  }

  private burst(opts: { duration: number; type: BiquadFilterType; from: number; to: number; gain: number; q?: number }): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || !this.master || !this.noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.Q.value = opts.q ?? 0.8;
    f.frequency.setValueAtTime(opts.from, now);
    f.frequency.exponentialRampToValueAtTime(opts.to, now + opts.duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(opts.gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + opts.duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 3);
    src.stop(now + opts.duration + 0.05);
  }

  splash(strength = 1): void {
    this.burst({ duration: 0.9, type: 'bandpass', from: 2400, to: 500, gain: 0.5 * Math.min(1, strength + 0.2), q: 0.7 });
    this.burst({ duration: 1.3, type: 'lowpass', from: 700, to: 160, gain: 0.7 * Math.min(1, strength + 0.2) });
  }

  cork(): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || !this.master) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.5, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.2);
    this.burst({ duration: 0.08, type: 'highpass', from: 1800, to: 1800, gain: 0.25 });
  }

  rustle(): void {
    this.burst({ duration: 0.7, type: 'bandpass', from: 3200, to: 4600, gain: 0.18, q: 1.1 });
  }

  chime(): void {
    const ctx = this.ctx;
    if (!this.on || !ctx || !this.master) return;
    const now = ctx.currentTime;
    [523.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      const t = now + i * 0.14;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      osc.connect(g).connect(this.master!);
      osc.start(t);
      osc.stop(t + 1.7);
    });
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.on = false;
  }
}
