// Minimalistische HUD: kompas, gebiedsnamen, reisgegevens en besturingshints.
const $ = (id) => document.getElementById(id);
const DIRS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];

export class UI {
  constructor() {
    this.hud = $('hud');
    this.hidden = false;
    this.idle = 0;
    this.compass = $('compassStrip');
    this.buildCompass();
    this.regionEl = $('region');
    this.toastEl = $('toast');
    this.clockEl = $('clock');
    this.distEl = $('dist');
    this.speedEl = $('speed');
    this.altEl = $('alt');
    this.lastText = {};
    this.regionTimer = null;
    this.toastTimer = null;
  }

  buildCompass() {
    // drie herhalingen zodat het kompas naadloos kan schuiven
    let html = '';
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 8; i++) {
        html += `<span class="mark ${i % 2 ? 'minor' : 'major'}">${DIRS[i]}</span>`;
        html += '<span class="tick"></span><span class="tick"></span><span class="tick"></span>';
      }
    }
    this.compass.innerHTML = html;
  }

  start() {
    document.body.classList.add('started');
    this.poke();
  }

  poke() {
    this.idle = 0;
    document.body.classList.remove('idle');
  }

  toggle() {
    this.hidden = !this.hidden;
    document.body.classList.toggle('nohud', this.hidden);
  }

  region(b) {
    $('regionName').textContent = b.name;
    $('regionSub').textContent = b.sub;
    this.regionEl.classList.remove('show');
    void this.regionEl.offsetWidth;
    this.regionEl.classList.add('show');
    clearTimeout(this.regionTimer);
    this.regionTimer = setTimeout(() => this.regionEl.classList.remove('show'), 6500);
  }

  music(state) {
    const btns = document.querySelectorAll('[data-act="music"]');
    const label = { on: 'Muziek aan', off: 'Muziek uit', waiting: 'Klik voor muziek' }[state];
    btns.forEach((b) => {
      b.dataset.state = state;
      const l = b.querySelector('.lbl');
      if (l) l.textContent = label;
      b.setAttribute('aria-pressed', String(state === 'on'));
    });
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1600);
  }

  set(el, key, text) {
    if (this.lastText[key] !== text) { this.lastText[key] = text; el.textContent = text; }
  }

  update(s) {
    this.idle += 1 / 60;
    if (this.idle > 9) document.body.classList.add('idle');
    this.set(this.clockEl, 'c', s.clock);
    const km = s.distance / 1000;
    this.set(this.distEl, 'd', km < 10 ? km.toFixed(2) : km.toFixed(1));
    this.set(this.speedEl, 's', String(Math.round(s.speed * 3.6)));
    this.set(this.altEl, 'a', String(Math.round(s.altitude)));
    // kompas: heading 0 = +z. Noord = -z
    let deg = (180 - (s.heading * 180) / Math.PI) % 360;
    if (deg < 0) deg += 360;
    const unit = 64; // px per 45°
    const x = -(deg / 45) * unit - 8 * unit - 8;
    this.compass.style.transform = `translateX(${x}px)`;
  }
}
