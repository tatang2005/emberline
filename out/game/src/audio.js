// audio.js — fully procedural WebAudio for EMBERLINE.
// No external files: one shared noise buffer, oscillators + gain envelopes,
// a master gain (~0.5). Every method is a safe no-op until unlock() has
// created/resumed the AudioContext on a user gesture.

export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let muted = false;
  let lastFootstepAt = 0;

  // --- helpers -----------------------------------------------------------

  function ensure() {
    if (!ctx) return false;
    if (ctx.state === 'suspended') void ctx.resume();
    return true;
  }

  function makeNoiseBuffer() {
    const len = Math.floor(ctx.sampleRate * 1.0);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Short burst of filtered noise. opts: { dur, type, freq, q, gain, attack,
  // decay, sweepTo } — sweepTo ramps the filter frequency down/up.
  function noiseHit(opts) {
    const o = opts || {};
    const t0 = ctx.currentTime;
    const dur = o.dur || 0.12;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type || 'bandpass';
    filt.frequency.setValueAtTime(o.freq || 1800, t0);
    if (o.sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), t0 + dur);
    filt.Q.value = o.q || 0.9;
    const g = ctx.createGain();
    const peak = o.gain || 0.5;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(master);
    src.start(t0, Math.random() * 0.4);
    src.stop(t0 + dur + 0.05);
  }

  // A single oscillator tone with an exponential decay envelope.
  // opts: { freq, freqEnd, type, dur, gain, attack, delay }
  function tone(opts) {
    const o = opts || {};
    const t0 = ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.12;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq || 440, t0);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + dur);
    const g = ctx.createGain();
    const peak = o.gain || 0.25;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // Two-tone click (mechanical): a high blip + a low tick.
  function click(freq, gain, dur) {
    tone({ freq: freq || 2400, type: 'square', dur: dur || 0.03, gain: gain || 0.12 });
    tone({ freq: (freq || 2400) * 0.45, type: 'triangle', dur: (dur || 0.03) * 1.6, gain: (gain || 0.12) * 0.7 });
  }

  // --- weapon shot recipes ----------------------------------------------
  // Each shot: a noise crack (band-passed, swept down) + a low sine thump.
  // Per-weapon character comes from filter freq, duration and thump depth.
  const SHOT_RECIPES = {
    P9:       { freq: 2400, sweepTo: 500, dur: 0.11, gain: 0.5,  thump: 140, thumpGain: 0.35, rate: 1.3 },
    VK47:     { freq: 1600, sweepTo: 260, dur: 0.16, gain: 0.62, thump: 110, thumpGain: 0.5,  rate: 1.0 },
    RAPTOR:   { freq: 2800, sweepTo: 700, dur: 0.09, gain: 0.45, thump: 150, thumpGain: 0.3,  rate: 1.5 },
    LONGSHOT: { freq: 1100, sweepTo: 140, dur: 0.34, gain: 0.85, thump: 70,  thumpGain: 0.7,  rate: 0.7 },
    BREACHER: { freq: 900,  sweepTo: 120, dur: 0.26, gain: 0.8,  thump: 65,  thumpGain: 0.65, rate: 0.8 },
  };

  // --- public API ---------------------------------------------------------

  return {
    // Create/resume the AudioContext. Call from a user gesture (click/key).
    // Safe to call repeatedly.
    unlock() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.5;
        master.connect(ctx.destination);
        noiseBuf = makeNoiseBuffer();
      }
      if (ctx.state === 'suspended') void ctx.resume();
    },

    setMuted(b) {
      muted = !!b;
      if (master) master.gain.value = muted ? 0 : 0.5;
    },

    // Gunshot for weapon id ('P9' | 'VK47' | 'RAPTOR' | 'LONGSHOT' | 'BREACHER').
    // Unknown ids fall back to the P9 recipe.
    shot(id) {
      if (!ensure()) return;
      const r = SHOT_RECIPES[id] || SHOT_RECIPES.P9;
      noiseHit({ freq: r.freq, sweepTo: r.sweepTo, dur: r.dur, gain: r.gain, rate: r.rate });
      tone({ freq: r.thump, freqEnd: 45, type: 'sine', dur: r.dur * 1.1, gain: r.thumpGain });
    },

    dryFire() {
      if (!ensure()) return;
      click(1900, 0.14, 0.025);
    },

    reload() {
      if (!ensure()) return;
      // mag out, mag in, slide rack — three staged clicks.
      click(1500, 0.14, 0.03);
      setTimeout(() => { if (ensure()) click(1100, 0.16, 0.035); }, 160);
      setTimeout(() => { if (ensure()) { click(2100, 0.18, 0.03); tone({ freq: 320, freqEnd: 180, type: 'triangle', dur: 0.06, gain: 0.1 }); } }, 340);
    },

    footstep() {
      if (!ensure()) return;
      // Throttle: never more often than every 140 ms (callers may spam).
      const now = ctx.currentTime;
      if (now - lastFootstepAt < 0.14) return;
      lastFootstepAt = now;
      noiseHit({ type: 'lowpass', freq: 320 + Math.random() * 120, dur: 0.07, gain: 0.1, q: 0.6 });
    },

    // Short bright tick: a hit landed.
    hit() {
      if (!ensure()) return;
      tone({ freq: 1250, type: 'square', dur: 0.045, gain: 0.16 });
    },

    // Two-note confirm: a kill.
    kill() {
      if (!ensure()) return;
      tone({ freq: 880, type: 'square', dur: 0.06, gain: 0.18 });
      tone({ freq: 1320, type: 'square', dur: 0.09, gain: 0.18, delay: 0.06 });
    },

    // Low thud + descending tone: the player took damage.
    hurt() {
      if (!ensure()) return;
      tone({ freq: 180, freqEnd: 70, type: 'sawtooth', dur: 0.16, gain: 0.28 });
      noiseHit({ type: 'lowpass', freq: 500, dur: 0.12, gain: 0.2, q: 0.5 });
    },

    // Round-win stinger: rising major triad.
    roundWin() {
      if (!ensure()) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) {
        tone({ freq: notes[i], type: 'triangle', dur: 0.28, gain: 0.2, delay: i * 0.11 });
      }
    },

    // Round-loss stinger: falling minor pair.
    roundLose() {
      if (!ensure()) return;
      const notes = [392, 311.13, 233.08];
      for (let i = 0; i < notes.length; i++) {
        tone({ freq: notes[i], type: 'triangle', dur: 0.34, gain: 0.2, delay: i * 0.14 });
      }
    },

    // Bomb plant beep. urgent=true (last 10 s) => faster, higher, louder.
    plantBeep(urgent) {
      if (!ensure()) return;
      if (urgent) {
        tone({ freq: 1560, type: 'square', dur: 0.05, gain: 0.2 });
        tone({ freq: 1560, type: 'square', dur: 0.05, gain: 0.2, delay: 0.09 });
      } else {
        tone({ freq: 1040, type: 'square', dur: 0.07, gain: 0.14 });
      }
    },

    // Big explosion: sub thump + long noise wash swept down.
    explosion() {
      if (!ensure()) return;
      tone({ freq: 90, freqEnd: 28, type: 'sine', dur: 0.9, gain: 0.85 });
      noiseHit({ type: 'lowpass', freq: 2400, sweepTo: 90, dur: 0.85, gain: 0.7, q: 0.4 });
      noiseHit({ type: 'bandpass', freq: 300, dur: 0.4, gain: 0.4, q: 0.7 });
    },

    // Buy-menu confirm: two soft blips, ascending.
    buy() {
      if (!ensure()) return;
      tone({ freq: 740, type: 'sine', dur: 0.06, gain: 0.16 });
      tone({ freq: 1108, type: 'sine', dur: 0.09, gain: 0.16, delay: 0.06 });
    },

    // Defuse progress tick.
    defuseTick() {
      if (!ensure()) return;
      tone({ freq: 1568, type: 'square', dur: 0.035, gain: 0.12 });
    },

    // Denied / cannot afford: dull low buzz.
    denied() {
      if (!ensure()) return;
      tone({ freq: 140, type: 'sawtooth', dur: 0.14, gain: 0.18 });
      tone({ freq: 110, type: 'sawtooth', dur: 0.16, gain: 0.14, delay: 0.05 });
    },
  };
}
