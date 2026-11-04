// HUD voor de ruimte: gebiedsnamen, meldingen en reisgegevens (zelfde stijl als op aarde).
const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.hidden = false;
    this.idle = 0;
    this.last = {};
    this.regionEl = $('region');
    this.toastEl = $('toast');
  }
  start() { document.body.classList.add('started'); this.poke(); }
  poke() { this.idle = 0; document.body.classList.remove('idle'); }
  toggle() { this.hidden = !this.hidden; document.body.classList.toggle('nohud', this.hidden); }

  region(name, sub) {
    $('regionName').textContent = name;
    $('regionSub').textContent = sub;
    this.regionEl.classList.remove('show');
    void this.regionEl.offsetWidth;
    this.regionEl.classList.add('show');
    clearTimeout(this.rt);
    this.rt = setTimeout(() => this.regionEl.classList.remove('show'), 6500);
  }

  toast(text, ms = 1800) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.tt);
    this.tt = setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  music(state) {
    const label = { on: 'Muziek aan', off: 'Muziek uit', waiting: 'Klik voor muziek' }[state];
    document.querySelectorAll('[data-act="music"]').forEach((b) => {
      b.dataset.state = state;
      const l = b.querySelector('.lbl');
      if (l) l.textContent = label;
      b.setAttribute('aria-pressed', String(state === 'on'));
    });
  }

  set(id, text) {
    if (this.last[id] !== text) { this.last[id] = text; $(id).textContent = text; }
  }

  update(dt, s) {
    this.idle += dt;
    if (this.idle > 9) document.body.classList.add('idle');
    // fictieve maar consistente eenheden: 1 eenheid ≈ 0,0004 lichtjaar
    const ly = s.distance * 0.0004;
    this.set('sDist', ly < 10 ? ly.toFixed(2) : ly.toFixed(1));
    this.set('sSpeed', (s.speed * 0.02).toFixed(s.speed * 0.02 < 10 ? 1 : 0));
    this.set('sNear', s.near ? s.near.name : '—');
    this.set('sNearD', s.near ? Math.max(0, s.near.dist * 0.5).toLocaleString('nl-NL', { maximumFractionDigits: 0 }) : '—');
  }
}
