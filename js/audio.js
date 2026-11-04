// Generatieve ambient-muziek met de Web Audio API: zachte akkoordvlakken, een diepe grondtoon,
// losse belletjes met echo en een vleugje wind. Alles wordt live opgebouwd, dus de muziek is
// net zo eindeloos als de wereld. Overdag klinkt ze in D-groot, 's nachts in D-dorisch.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const MOODS = {
  day: {
    chords: [
      { bass: 38, pad: [57, 61, 64, 66] }, // Dmaj9
      { bass: 43, pad: [55, 59, 62, 66] }, // Gmaj7
      { bass: 35, pad: [54, 57, 61, 64] }, // Bm11
      { bass: 45, pad: [57, 59, 64, 66] }, // Asus2
    ],
    scale: [62, 64, 66, 69, 71, 74, 76, 78, 81, 83],
    density: 1,
  },
  night: {
    chords: [
      { bass: 38, pad: [53, 57, 60, 64] }, // Dm9
      { bass: 34, pad: [53, 57, 58, 62] }, // Bbmaj7
      { bass: 41, pad: [55, 57, 60, 64] }, // Fmaj9
      { bass: 45, pad: [55, 60, 62, 64] }, // Am11
    ],
    scale: [62, 65, 67, 69, 72, 74, 77, 79, 81, 84],
    density: 0.6,
  },
};

// klankkleur van de belletjes per bioom: [octaafverschuiving, boventoon, uitklinktijd]
const BIOME_TONE = [
  [0, 3.0, 2.2],   // woestijn: houtachtig, kort (kalimba)
  [0, 2.0, 3.2],   // weiden
  [12, 2.0, 3.6],  // bloesem: hoog en helder
  [0, 2.76, 3.0],  // herfst: warm, iets metaalachtig
  [12, 4.2, 4.5],  // kristal: glazig, lang
];

function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b = 0;
  for (let i = 0; i < len; i++) {
    b = 0.985 * b + 0.15 * (Math.random() * 2 - 1); // bruinachtige ruis
    d[i] = b;
  }
  return buf;
}

export class MusicEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.mood = { night: 0, biome: 1, paused: false };
    this.moodName = 'day';
    this.step = 0;
    this.nextChord = 0;
    this.nextPluck = 0;
    this.lastPluck = 74;
    this.build();
  }

  build() {
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.05;
    comp.release.value = 0.6;
    this.out.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx, 6, 2.6);
    const revGain = ctx.createGain();
    revGain.gain.value = 0.9;
    this.reverb.connect(revGain).connect(this.out);

    // akkoordvlakken: één gedeeld laagdoorlaatfilter dat langzaam ademt
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 260;
    lfo.connect(lfoAmt).connect(this.padFilter.frequency);
    lfo.start();
    this.padBus.connect(this.padFilter);
    const padDry = ctx.createGain();
    padDry.gain.value = 0.55;
    const padWet = ctx.createGain();
    padWet.gain.value = 0.6;
    this.padFilter.connect(padDry).connect(this.out);
    this.padFilter.connect(padWet).connect(this.reverb);

    // belletjes: echo + veel galm
    this.pluckBus = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.72;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dFilter = ctx.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.frequency.value = 2400;
    this.pluckBus.connect(delay);
    delay.connect(dFilter).connect(fb).connect(delay);
    const dOut = ctx.createGain();
    dOut.gain.value = 0.45;
    dFilter.connect(dOut);
    dOut.connect(this.out);
    dOut.connect(this.reverb);
    const pDry = ctx.createGain();
    pDry.gain.value = 0.6;
    this.pluckBus.connect(pDry).connect(this.out);
    const pWet = ctx.createGain();
    pWet.gain.value = 0.8;
    this.pluckBus.connect(pWet).connect(this.reverb);

    // wind
    const noise = ctx.createBufferSource();
    noise.buffer = makeNoise(ctx, 8);
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.7;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.07;
    const wlfoAmt = ctx.createGain();
    wlfoAmt.gain.value = 220;
    wlfo.connect(wlfoAmt).connect(this.windFilter.frequency);
    wlfo.start();
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.05;
    noise.connect(this.windFilter).connect(this.wind).connect(this.out);
    noise.start();
  }

  setMood(m) {
    Object.assign(this.mood, m);
  }

  // ---------- klanken ----------
  pad(chord, t, dur) {
    const ctx = this.ctx;
    const attack = 4.5, release = 7;
    const notes = chord.pad;
    for (let i = 0; i < notes.length; i++) {
      const f = mtof(notes[i]);
      const g = ctx.createGain();
      const peak = 0.05 / notes.length * 4 * (i === 0 ? 1 : 0.85);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + release);
      g.connect(this.padBus);
      for (const [type, det, lvl] of [['sawtooth', -7, 0.5], ['triangle', 5, 1]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = det + (Math.random() - 0.5) * 4;
        const og = ctx.createGain();
        og.gain.value = lvl;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + dur + release + 0.2);
      }
    }
    // grondtoon
    const b = ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = mtof(chord.bass);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.11, t + attack + 1);
    bg.gain.setValueAtTime(0.11, t + dur);
    bg.gain.linearRampToValueAtTime(0, t + dur + release);
    b.connect(bg).connect(this.out);
    b.start(t);
    b.stop(t + dur + release + 0.2);
  }

  pluck(midi, t, vel) {
    const ctx = this.ctx;
    const [oct, ratio, decay] = BIOME_TONE[this.mood.biome] || BIOME_TONE[1];
    const f = mtof(midi + oct);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(this.pluckBus);
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = f;
    o1.connect(g);
    // boventoon die sneller wegsterft
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * ratio;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.035 * vel, t + 0.008);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.35);
    o2.connect(g2).connect(this.pluckBus);
    for (const o of [o1, o2]) { o.start(t); o.stop(t + decay + 0.1); }
  }

  // ---------- planning ----------
  scheduleUntil(until) {
    const night = this.mood.night;
    while (this.nextChord < until) {
      const want = night > 0.5 ? 'night' : 'day';
      if (want !== this.moodName) { this.moodName = want; this.step = 0; }
      const M = MOODS[this.moodName];
      const chord = M.chords[this.step % M.chords.length];
      const dur = 13 + Math.random() * 5;
      this.pad(chord, this.nextChord, dur);
      this.chord = chord;
      this.step++;
      this.nextChord += dur;
    }
    while (this.nextPluck < until) {
      const M = MOODS[this.moodName];
      const scale = M.scale;
      const t = this.nextPluck;
      // kleine melodische zinnetjes: stapjes door de toonladder
      const phrase = Math.random() < 0.35 ? 2 + Math.floor(Math.random() * 3) : 1;
      let idx = scale.indexOf(this.lastPluck);
      if (idx < 0) idx = Math.floor(scale.length / 2);
      for (let k = 0; k < phrase; k++) {
        idx = Math.max(0, Math.min(scale.length - 1, idx + Math.floor(Math.random() * 5) - 2));
        const note = scale[idx];
        this.pluck(note, t + k * 0.42 + Math.random() * 0.05, 0.55 + Math.random() * 0.45);
        this.lastPluck = note;
      }
      const gap = (1.8 + Math.random() * 4.5) / M.density;
      this.nextPluck = t + phrase * 0.42 + gap;
    }
  }

  start(at) {
    this.nextChord = at;
    this.nextPluck = at + 3;
  }
}

// ---------- bediening in de browser ----------
const PREF = 'oneindig-muziek';
const readPref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
const writePref = (v) => { try { localStorage.setItem(PREF, v); } catch { /* geen opslag */ } };

export class Music {
  constructor(onChange) {
    this.onChange = onChange || (() => {});
    this.wanted = readPref() !== 'off';
    this.ctx = null;
    this.engine = null;
    this.playing = false;
    this.timer = null;
    this.volume = 0.5;
    this.hidden = false;
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.apply();
    });
  }

  get state() {
    if (!this.wanted) return 'off';
    return this.playing ? 'on' : 'waiting';
  }

  // aanroepen bij elke gebruikersactie: browsers staan geluid pas toe na interactie
  unlock() {
    if (this.wanted && !this.playing) this.begin();
  }

  toggle() {
    // staat de muziek nog te wachten op een klik, dan start de knop (of M) haar juist
    if (this.wanted && !this.playing && !this.ctx) { this.begin(); return; }
    this.wanted = !this.wanted;
    writePref(this.wanted ? 'on' : 'off');
    if (this.wanted) this.begin();
    else this.apply();
    this.onChange(this.state);
  }

  begin() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC();
      this.engine = new MusicEngine(this.ctx);
      this.engine.start(this.ctx.currentTime + 0.2);
    }
    this.ctx.resume().then(() => {
      this.playing = true;
      this.apply();
      this.onChange(this.state);
    }).catch(() => {});
    if (!this.timer) this.timer = setInterval(() => this.tick(), 250);
  }

  apply() {
    if (!this.ctx) return;
    const g = this.engine.out.gain;
    const now = this.ctx.currentTime;
    const on = this.wanted && !this.hidden;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (on) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      g.linearRampToValueAtTime(this.volume, now + (this.faded ? 2 : 8));
      this.faded = true;
    } else {
      g.linearRampToValueAtTime(0, now + 1.5);
      clearTimeout(this.suspendT);
      this.suspendT = setTimeout(() => {
        if (!(this.wanted && !this.hidden) && this.ctx.state === 'running') {
          this.ctx.suspend();
          this.playing = this.wanted;
        }
      }, 1700);
    }
  }

  setMood(m) {
    if (this.engine) this.engine.setMood(m);
  }

  tick() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const e = this.engine;
    const now = this.ctx.currentTime;
    // na een pauze niet alle gemiste noten tegelijk inhalen
    if (e.nextChord < now - 1) e.nextChord = now + 0.1;
    if (e.nextPluck < now - 1) e.nextPluck = now + 0.5;
    e.scheduleUntil(now + 1.5);
    // wind: harder bij snelheid en hoogte
    const m = e.mood;
    const target = 0.025 + Math.min(m.wind || 0, 1) * 0.07;
    e.wind.gain.setTargetAtTime(target, now, 1.5);
    const bright = [1100, 900, 1250, 800, 1400][m.biome] || 900;
    e.padFilter.frequency.setTargetAtTime(bright * (1 - m.night * 0.3), now, 3);
  }
}
