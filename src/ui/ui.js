// Game shell: screens, fades, HUD, settings persistence, the scare overlay.
import { drawScareFace } from '../world/textures.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = {
  master: 80, amb: 80, sfx: 80, sens: 100, quality: 'medium'
};

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      sanityVignette: $('sanity-vignette'),
      staminaWrap: $('stamina-wrap'),
      staminaBar: $('stamina-bar'),
      prompt: $('prompt'),
      hint: $('hint'),
      fader: $('fader'),
      noclip: $('noclip-text'),
      scareOverlay: $('scare-overlay'),
      scareCanvas: $('scare-canvas'),
      title: $('title-screen'),
      settings: $('settings-screen'),
      pause: $('pause-screen'),
      death: $('death-screen'),
      win: $('win-screen'),
      deathStats: $('death-stats'),
      winStats: $('win-stats'),
      compat: $('compat-warning'),
      controlsHint: $('controls-hint')
    };
    this.screens = ['title', 'settings', 'pause', 'death', 'win'];
    this.settings = this._loadSettings();
    this.settingsReturnTo = 'title';
    this.hintTimer = null;
    this._scareRAF = 0;
  }

  // ---------- settings ----------
  _loadSettings() {
    try {
      const raw = localStorage.getItem('backrooms_settings');
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) { /* private mode etc. */ }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings() {
    try {
      localStorage.setItem('backrooms_settings', JSON.stringify(this.settings));
    } catch (e) { /* ignore */ }
  }

  bindSettings(onChange) {
    const wire = (id, key, valId) => {
      const input = $(id);
      input.value = this.settings[key];
      if (valId) $(valId).textContent = this.settings[key];
      input.addEventListener('input', () => {
        this.settings[key] = key === 'quality' ? input.value : +input.value;
        if (valId) $(valId).textContent = input.value;
        this.saveSettings();
        onChange(this.settings);
      });
    };
    wire('set-master', 'master', 'val-master');
    wire('set-amb', 'amb', 'val-amb');
    wire('set-sfx', 'sfx', 'val-sfx');
    wire('set-sens', 'sens', 'val-sens');
    wire('set-quality', 'quality', null);
    onChange(this.settings);
  }

  // ---------- screens ----------
  showScreen(name) {
    for (const s of this.screens) {
      this.el[s].classList.toggle('hidden', s !== name);
    }
    this.el.controlsHint.classList.toggle('hidden', !(name === 'title' || name === 'pause'));
  }

  hideAllScreens() {
    this.showScreen(null);
  }

  showHUD(show) {
    this.el.hud.classList.toggle('hidden', !show);
  }

  // ---------- fades ----------
  fadeToBlack(slow = false) {
    this.el.fader.classList.toggle('slow', slow);
    this.el.fader.classList.remove('clear');
  }

  fadeIn(slow = false) {
    this.el.fader.classList.toggle('slow', slow);
    // force reflow so transition restarts cleanly
    void this.el.fader.offsetWidth;
    this.el.fader.classList.add('clear');
  }

  showNoclipText(show) {
    this.el.noclip.classList.toggle('hidden', !show);
  }

  // ---------- HUD ----------
  setStamina(v, active) {
    this.el.staminaWrap.classList.toggle('visible', active && v < 0.995);
    this.el.staminaBar.style.width = (v * 100).toFixed(1) + '%';
    this.el.staminaBar.classList.toggle('low', v < 0.25);
  }

  setSanityVignette(sanity) {
    // css overlay on top of the shader vignette — cheap depth
    const t = 1 - sanity / 100;
    this.el.sanityVignette.style.opacity = (t * t * 0.85).toFixed(3);
  }

  setPrompt(text) {
    if (this.el.prompt.textContent !== text) this.el.prompt.textContent = text;
  }

  showHint(text) {
    const h = this.el.hint;
    h.textContent = text;
    h.classList.add('visible');
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => h.classList.remove('visible'), 7000);
  }

  // ---------- the scare ----------
  /** Full-screen synthesized face, jittering and zooming. Calls done() after. */
  playScare(duration, done) {
    const overlay = this.el.scareOverlay;
    const canvas = this.el.scareCanvas;
    const ctx = canvas.getContext('2d');
    overlay.classList.remove('hidden');
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) {
        cancelAnimationFrame(this._scareRAF);
        overlay.classList.add('hidden');
        if (done) done();
        return;
      }
      // redraw with a different jitter seed every few frames (kept cheap)
      if ((t * 60 | 0) % 3 === 0) drawScareFace(ctx, t);
      const zoom = 1 + t * 0.55;
      const jx = (Math.random() - 0.5) * 18;
      const jy = (Math.random() - 0.5) * 18;
      canvas.style.transform = `translate(${jx}px, ${jy}px) scale(${zoom})`;
      this._scareRAF = requestAnimationFrame(tick);
    };
    tick();
  }

  hideScare() {
    cancelAnimationFrame(this._scareRAF);
    this.el.scareOverlay.classList.add('hidden');
  }

  // ---------- stats ----------
  renderStats(el, stats) {
    const mins = Math.floor(stats.time / 60);
    const secs = Math.floor(stats.time % 60).toString().padStart(2, '0');
    el.innerHTML =
      `time survived &nbsp;<b>${mins}:${secs}</b><br>` +
      `distance walked &nbsp;<b>${Math.round(stats.distance)} m</b><br>` +
      `scares endured &nbsp;<b>${stats.scares}</b><br>` +
      `almond water found &nbsp;<b>${stats.waters}</b><br>` +
      `chunks wandered &nbsp;<b>${stats.chunks}</b>`;
  }

  compatWarning(text) {
    this.el.compat.textContent = text;
    this.el.compat.classList.remove('hidden');
  }
}
