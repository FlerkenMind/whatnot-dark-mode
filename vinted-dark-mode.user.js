// ==UserScript==
// @name         Vinted Dark Mode
// @namespace    https://github.com/FlerkenMind
// @version      1.3.0
// @description  Dark mode propre pour Vinted (toutes extensions). Bascule on/off via le menu Tampermonkey ou Alt+Maj+D. Visionneuse de photos préservée, flèches des galeries visibles.
// @author       FlerkenMind
// @license      MIT
// @homepageURL  https://github.com/FlerkenMind/vinted-dark-mode
// @supportURL   https://github.com/FlerkenMind/vinted-dark-mode/issues
// @include      /^https?:\/\/([a-z0-9-]+\.)?vinted\.[a-z.]+(\/.*)?$/
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'darkModeEnabled';
  const PAUSE_CLASS = 'vdm-pause';
  const LIFT_ATTR = 'data-vdm-lift';

  const CSS = `
    @media not print {
      html {
        background: #fff !important;
        filter: invert(1) hue-rotate(180deg) !important;
      }
      img, video, canvas, iframe, embed, object,
      [style*="background-image"],
      [style*="background: url"],
      [style*="background:url"] {
        filter: invert(1) hue-rotate(180deg) !important;
      }
      [style*="background-image"] img,
      [style*="background-image"] video,
      [style*="background-image"] canvas,
      [style*="background: url"] img,
      [style*="background:url"] img {
        filter: none !important;
      }

      /* Les médias ré-inversés (filter) forment une « couche » qui peut recouvrir des éléments
         positionnés placés avant eux dans la page (flèches de galerie…). On remonte ces éléments. */
      [${LIFT_ATTR}] {
        z-index: 1 !important;
      }

      /* Pause : la visionneuse de photos est déjà sombre, on la laisse telle que Vinted l'a dessinée
         (sinon elle devient claire et les flèches blanches disparaissent). */
      html.${PAUSE_CLASS} {
        filter: none !important;
      }
      html.${PAUSE_CLASS} :is(img, video, canvas, iframe, embed, object,
        [style*="background-image"], [style*="background: url"], [style*="background:url"]) {
        filter: none !important;
      }
    }
  `;

  let enabled = true;
  try { enabled = GM_getValue(STORAGE_KEY, true); } catch (e) {}

  let styleEl = null;
  let sheet = null;

  function inject() {
    if (typeof GM_addStyle === 'function') {
      try {
        const el = GM_addStyle(CSS);
        if (el) { styleEl = el; return; }
      } catch (e) {}
    }
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch (e) {}
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function remove() {
    if (styleEl) { styleEl.remove(); styleEl = null; }
    if (sheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(s => s !== sheet);
      sheet = null;
    }
  }

  /* ───── Détection de la visionneuse de photos ─────
   * Au centre de l'écran, on regarde les éléments empilés : une couche plein écran
   * (position fixed + z-index) ET une grande photo/vidéo = visionneuse ouverte. */
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
      if (!photo && /^(IMG|VIDEO|CANVAS)$/.test(el.tagName) && r.width >= vw * 0.3 && r.height >= vh * 0.3) {
        photo = true;
      }
    }
    return layer && photo;
  }

  /* ───── Flèches de galerie recouvertes par les photos ─────
   * Un `filter` crée une couche d'empilement : la photo passe alors AU-DESSUS des éléments positionnés
   * (position: absolute/fixed/relative sans z-index) qui la précèdent dans le code de la page.
   * On marque ces éléments pour les remonter d'un cran. */
  const lifted = new WeakMap(); // média -> nombre d'enfants du parent au moment du traitement

  function lift(el, depth) {
    // Un voisin qui contient lui-même une grande photo est une autre carte / diapositive, pas un contrôle
    if (depth === 0) {
      const media = el.matches('img, video, canvas') ? el : el.querySelector('img, video, canvas');
      if (media) {
        const r = media.getBoundingClientRect();
        if (r.width >= 80 && r.height >= 80) return;
      }
    }
    const cs = getComputedStyle(el);
    if (cs.position !== 'static' && cs.zIndex === 'auto') el.setAttribute(LIFT_ATTR, '');
    if (depth >= 3) return;
    let n = 0;
    for (const c of el.children) {
      if (n++ >= 12) break;
      lift(c, depth + 1);
    }
  }

  function liftControls() {
    if (!enabled || !document.body) return;
    for (const m of document.querySelectorAll('img, video, canvas')) {
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

  function checkViewer() {
    const root = document.documentElement;
    if (!root) return;
    let open = false;
    try { open = enabled && viewerOpen(); } catch (e) {}
    root.classList.toggle(PAUSE_CLASS, open);
    try { liftControls(); } catch (e) {}
  }

  function apply() {
    remove();
    if (enabled) inject();
    checkViewer();
  }

  function toggle() {
    enabled = !enabled;
    try { GM_setValue(STORAGE_KEY, enabled); } catch (e) {}
    apply();
  }

  apply();
  console.log('[Vinted Dark Mode] chargé, actif :', enabled);

  let timer = 0;
  const later = (ms) => setTimeout(checkViewer, ms);

  new MutationObserver(() => {
    if (enabled && styleEl && !styleEl.isConnected) apply(); // le site a retiré notre style
    clearTimeout(timer);
    timer = setTimeout(checkViewer, 120);
  }).observe(document, { childList: true, subtree: true });

  // Ouverture / fermeture de la visionneuse sans ajout d'éléments : on revérifie après un clic ou une touche
  document.addEventListener('click', () => { later(150); later(600); }, true);
  document.addEventListener('keyup', () => later(150), true);
  window.addEventListener('resize', () => later(150), { passive: true });

  try { GM_registerMenuCommand('Activer / désactiver le Dark Mode', toggle); } catch (e) {}

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyD') {
      e.preventDefault();
      toggle();
    }
  });
})();
