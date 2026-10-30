// ==UserScript==
// @name         Whatnot Dark Mode
// @namespace    https://github.com/FlerkenMind
// @version      1.0.0
// @description  Dark mode pour Whatnot : texte clair, chat des lives lisible, photos et vidéos intactes. Alt+Maj+D pour activer / désactiver, Alt+Maj+H pour changer le mode de couleurs.
// @author       FlerkenMind
// @license      MIT
// @homepageURL  https://github.com/FlerkenMind/vinted-dark-mode
// @supportURL   https://github.com/FlerkenMind/vinted-dark-mode/issues
// @match        https://www.whatnot.com/*
// @match        https://whatnot.com/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = true; // mettre false pour masquer les messages de la console (F12)
  const STORAGE_KEY = 'whatnotDarkEnabled';
  const HUE_KEY = 'whatnotDarkKeepHue';
  const PAUSE = 'wdm-pause';          // classe sur <html> : on laisse le site tel quel
  const KEEP = 'data-wdm-keep';       // zone déjà sombre (lecteur vidéo, chat sombre…) : conservée telle quelle
  const LIFT = 'data-wdm-lift';       // élément remonté au-dessus des photos (flèches, boutons…)
  const log = (...a) => { if (DEBUG) console.log('[Whatnot Dark Mode]', ...a); };

  /*
   * Principe : on inverse la page entière (blanc ↔ noir, donc texte sombre → texte clair), avec une rotation
   * de teinte pour garder les couleurs reconnaissables, puis on RE-inverse ce qui doit rester naturel :
   *  - photos, vidéos, avatars ;
   *  - les zones DÉJÀ sombres (fond du lecteur vidéo d'un live, éventuel chat sombre…), détectées automatiquement.
   */
  const buildCSS = () => `
    @media not print {
      html {
        background: #fff !important;
        filter: ${filterValue()} !important;
      }
      img, video, canvas, embed, object,
      [style*="background-image"], [style*="background: url"], [style*="background:url"] {
        filter: ${filterValue()} !important;
      }
      [style*="background-image"] :is(img, video, canvas),
      [style*="background: url"] :is(img, video, canvas),
      [style*="background:url"] :is(img, video, canvas) {
        filter: none !important;
      }

      /* Zones déjà sombres : double inversion = apparence d'origine */
      [${KEEP}] {
        filter: ${filterValue()} !important;
      }
      [${KEEP}] :is(img, video, canvas, embed, object,
        [style*="background-image"], [style*="background: url"], [style*="background:url"]) {
        filter: none !important;
      }

      /* Un filtre crée une « couche » qui recouvre les éléments positionnés placés avant elle :
         on remonte ces éléments (flèches de galerie, boutons sur la vidéo…). */
      [${LIFT}] {
        z-index: 1 !important;
      }

      /* Pause : site déjà sombre, ou visionneuse de photos ouverte */
      html.${PAUSE} {
        filter: none !important;
      }
      html.${PAUSE} :is(img, video, canvas, embed, object, [${KEEP}],
        [style*="background-image"], [style*="background: url"], [style*="background:url"]) {
        filter: none !important;
      }
    }
  `;

  let enabled = true;
  try { enabled = GM_getValue(STORAGE_KEY, true); } catch (e) {}

  /*
   * Deux modes de couleurs (Alt+Maj+H, ou menu du gestionnaire de scripts) :
   *  - photos fidèles (par défaut) : inversion simple. Photos et vidéos retrouvent EXACTEMENT leurs couleurs ;
   *    les teintes de l'interface deviennent complémentaires (un badge rouge devient vert, par exemple).
   *  - teintes conservées : l'interface garde ses couleurs (rouge reste rouge) mais les photos très saturées
   *    sont un peu délavées (jaune → beige, par exemple).
   */
  let keepHue = false;
  try { keepHue = GM_getValue(HUE_KEY, false); } catch (e) {}
  const filterValue = () => (keepHue ? 'invert(1) hue-rotate(180deg)' : 'invert(1)');

  /* ───────── Injection du style ───────── */
  let styleEl = null;
  let sheet = null;

  function inject() {
    if (typeof GM_addStyle === 'function') {
      try {
        const el = GM_addStyle(buildCSS());
        if (el) { styleEl = el; return; }
      } catch (e) {}
    }
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(buildCSS());
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch (e) {}
    styleEl = document.createElement('style');
    styleEl.textContent = buildCSS();
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function remove() {
    if (styleEl) { styleEl.remove(); styleEl = null; }
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      sheet = null;
    }
  }

  /* ───────── Outils couleur ───────── */
  function parseColor(c) {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const luminance = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  const isDarkBg = (el, minAlpha) => {
    const c = parseColor(getComputedStyle(el).backgroundColor);
    return !!c && c.a >= minAlpha && luminance(c) < 0.3;
  };

  /* ───────── 1. Site déjà sombre ? (thème natif activé, par exemple) ───────── */
  function pageIsDark() {
    const body = document.body;
    if (!body) return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    // du plus interne au plus externe : le premier fond opaque qui couvre la fenêtre décide
    const chain = [];
    let el = body;
    for (let i = 0; i < 3 && el; i++) { chain.unshift(el); el = el.firstElementChild; }
    chain.push(document.documentElement);
    for (const n of chain) {
      if (n !== document.documentElement) {
        const r = n.getBoundingClientRect();
        if (r.width < vw * 0.95 || r.height < vh * 0.5) continue;
      }
      const c = parseColor(getComputedStyle(n).backgroundColor);
      if (c && c.a >= 0.9) return luminance(c) < 0.3;
    }
    return false;
  }

  /* ───────── 2. Visionneuse de photos ouverte ? ───────── */
  function viewerOpen() {
    if (!document.body) return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    let layer = false, photo = false;
    for (const el of document.elementsFromPoint(vw / 2, vh / 2).slice(0, 20)) {
      if (el === document.documentElement || el === document.body) continue;
      const r = el.getBoundingClientRect();
      if (!layer && r.width >= vw * 0.9 && r.height >= vh * 0.9) {
        const cs = getComputedStyle(el);
        const z = parseInt(cs.zIndex, 10);
        if (cs.position === 'fixed' && Number.isFinite(z) && z > 0) layer = true;
      }
      if (!photo && /^(IMG|VIDEO|CANVAS)$/.test(el.tagName) && r.width >= vw * 0.3 && r.height >= vh * 0.3) photo = true;
    }
    return layer && photo;
  }

  function checkPause() {
    const root = document.documentElement;
    if (!root) return;
    let pause = false;
    try { pause = enabled && (pageIsDark() || viewerOpen()); } catch (e) {}
    if (root.classList.contains(PAUSE) !== pause) log(pause ? 'pause (site déjà sombre ou visionneuse)' : 'reprise');
    root.classList.toggle(PAUSE, pause);
  }

  /* ───────── 3. Zones déjà sombres (lecteur vidéo du live, chat sombre…) ───────── */
  const PANEL_SEL = 'div, section, aside, header, footer, nav, ul, article, main';

  function scanDark(root) {
    if (!root || root.nodeType !== 1) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const minArea = vw * vh * 0.06;
    const area = (r) => r.width * r.height;
    const rr = root.getBoundingClientRect();
    if (area(rr) < minArea * 0.5) return; // petit élément (message de chat, bouton…) : rien à faire

    const list = root.matches(PANEL_SEL) ? [root] : [];
    let n = 0;
    for (const el of root.querySelectorAll(PANEL_SEL)) { list.push(el); if (++n > 4000) break; }

    for (const el of list) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.hasAttribute(KEEP) || el.closest(`[${KEEP}]`)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 100 || area(r) < minArea) continue;
      if (r.width >= vw * 0.98 && r.height >= vh * 0.9) continue; // enveloppe de page : jamais
      if (!isDarkBg(el, 0.5)) continue;
      el.querySelectorAll(`[${KEEP}]`).forEach((x) => x.removeAttribute(KEEP)); // pas de double inversion
      el.setAttribute(KEEP, '');
      log('zone déjà sombre conservée :', el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        Math.round((area(r) / (vw * vh)) * 100) + ' % de l’écran');
    }
  }

  /* ───────── 4. Éléments recouverts par les photos / vidéos ───────── */
  const lifted = new WeakMap(); // média -> nombre d'enfants du parent au moment du traitement

  function lift(el, depth) {
    if (depth === 0) {
      const media = el.matches('img, video, canvas') ? el : el.querySelector('img, video, canvas');
      if (media) {
        const r = media.getBoundingClientRect();
        if (r.width >= 80 && r.height >= 80) return; // autre carte / diapositive, pas un contrôle
      }
    }
    const cs = getComputedStyle(el);
    if (cs.position !== 'static' && cs.zIndex === 'auto') el.setAttribute(LIFT, '');
    if (depth >= 3) return;
    let n = 0;
    for (const c of el.children) { if (n++ >= 12) break; lift(c, depth + 1); }
  }

  function liftControls() {
    if (!enabled || !document.body) return;
    for (const m of document.querySelectorAll(`img, video, canvas, [${KEEP}]`)) {
      const count = m.parentElement ? m.parentElement.childElementCount : 0;
      if (lifted.get(m) === count) continue;
      lifted.set(m, count);
      let node = m;
      for (let d = 0; d < 3 && node.parentElement && node !== document.body; d++) {
        let k = 0;
        for (let s = node.previousElementSibling; s && k < 8; s = s.previousElementSibling, k++) lift(s, 0);
        node = node.parentElement;
      }
    }
  }

  /* ───────── Orchestration ───────── */
  const pending = new Set();
  let timer = 0;

  function flush() {
    checkPause();
    if (!enabled) { pending.clear(); return; }
    const nodes = [...pending].slice(0, 80);
    pending.clear();
    for (const n of nodes) if (n.isConnected) { try { scanDark(n); } catch (e) {} }
    try { liftControls(); } catch (e) {}
  }

  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(flush, ms); };
  const rescanAll = () => { if (document.body) pending.add(document.body); schedule(50); };

  function apply() {
    remove();
    if (enabled) { inject(); rescanAll(); }
    else document.documentElement && document.documentElement.classList.remove(PAUSE);
    checkPause();
  }

  function toggle() {
    enabled = !enabled;
    try { GM_setValue(STORAGE_KEY, enabled); } catch (e) {}
    apply();
  }

  function toggleHue() {
    keepHue = !keepHue;
    try { GM_setValue(HUE_KEY, keepHue); } catch (e) {}
    log(keepHue ? 'mode : teintes conservées' : 'mode : photos fidèles');
    apply();
  }

  apply();
  log('chargé, actif :', enabled);

  new MutationObserver((records) => {
    if (enabled && styleEl && !styleEl.isConnected) apply(); // le site a retiré notre style
    for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) pending.add(n);
    schedule(250);
  }).observe(document, { childList: true, subtree: true });

  // Le site est une application : on rescanne après le chargement et l'hydratation
  document.addEventListener('DOMContentLoaded', () => { rescanAll(); setTimeout(rescanAll, 1500); setTimeout(rescanAll, 4000); });
  window.addEventListener('load', () => setTimeout(rescanAll, 300));
  window.addEventListener('resize', () => { clearTimeout(window.__wdmResize); window.__wdmResize = setTimeout(rescanAll, 300); }, { passive: true });
  document.addEventListener('click', () => { setTimeout(checkPause, 150); setTimeout(checkPause, 600); }, true);
  document.addEventListener('keyup', () => setTimeout(checkPause, 150), true);

  try {
    GM_registerMenuCommand('Activer / désactiver le Dark Mode', toggle);
    GM_registerMenuCommand('Couleurs : photos fidèles ↔ teintes conservées', toggleHue);
  } catch (e) {}

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      toggle();
    } else if (e.altKey && e.shiftKey && e.code === 'KeyH') {
      e.preventDefault();
      toggleHue();
    }
  });
})();
