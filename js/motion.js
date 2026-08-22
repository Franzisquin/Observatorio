/* ===========================================================================
   ElectoMaps — movimento

   Duas responsabilidades:

   1. Entradas. Elementos marcados com .reveal / .stagger sobem e aparecem,
      o herói ao carregar e o resto ao entrar na viewport. Só opacity e
      transform, que o compositor resolve sem layout nem paint.

   2. Orçamento do fundo de mapa. Animar stroke-dashoffset repinta o SVG a
      cada quadro, então a animação só roda quando o mapa está visível E a
      aba está em foco. Fora disso fica pausada, custando zero.

   Sob prefers-reduced-motion nada anima: tudo nasce no estado final.
   =========================================================================== */
(function () {
  'use strict';

  var reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* navegador sem matchMedia: anima normalmente */ }

  var started = false;

  /* ------------------------------------------------------------- entradas */

  function revealNow(el) { el.classList.add('is-in'); }

  function revealEverything() {
    var all = document.querySelectorAll('.reveal, .stagger');
    for (var i = 0; i < all.length; i++) revealNow(all[i]);
  }

  function setupReveals() {
    /* O herói não espera scroll: entra assim que a página se mostra. */
    var immediate = document.querySelectorAll('[data-reveal="now"]');
    for (var i = 0; i < immediate.length; i++) revealNow(immediate[i]);

    var deferred = [];
    var candidates = document.querySelectorAll('.reveal, .stagger');
    for (var j = 0; j < candidates.length; j++) {
      if (candidates[j].getAttribute('data-reveal') !== 'now') {
        deferred.push(candidates[j]);
      }
    }

    if (!('IntersectionObserver' in window)) {
      for (var k = 0; k < deferred.length; k++) revealNow(deferred[k]);
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      for (var n = 0; n < entries.length; n++) {
        if (entries[n].isIntersecting) {
          revealNow(entries[n].target);
          io.unobserve(entries[n].target);   /* entra uma vez só */
        }
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });

    for (var m = 0; m < deferred.length; m++) io.observe(deferred[m]);
  }

  /* -------------------------------------------------- orçamento do mapa */

  function setupMapBudget() {
    var maps = document.querySelectorAll('.mapbg');
    if (!maps.length) return;

    var i;
    for (i = 0; i < maps.length; i++) maps[i].classList.add('is-ready');

    if (reduced) return;   /* sem animação para pausar */

    var visible = [];      /* espelha, por mapa, se está na viewport */
    for (i = 0; i < maps.length; i++) visible.push(true);

    function sync() {
      var awake = document.visibilityState !== 'hidden';
      for (var n = 0; n < maps.length; n++) {
        maps[n].classList.toggle('is-idle', !(awake && visible[n]));
      }
    }

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        for (var n = 0; n < entries.length; n++) {
          for (var k = 0; k < maps.length; k++) {
            if (maps[k] === entries[n].target) visible[k] = entries[n].isIntersecting;
          }
        }
        sync();
      }, { threshold: 0 });

      for (i = 0; i < maps.length; i++) io.observe(maps[i]);
    }

    document.addEventListener('visibilitychange', sync);
    sync();
  }

  /* ----------------------------------------------------------------- boot */

  function start() {
    if (started) return;
    started = true;

    if (reduced) {
      revealEverything();
      setupMapBudget();
      return;
    }

    setupReveals();
    setupMapBudget();
  }

  function whenTranslated() {
    /* js/i18n.js esconde o corpo até traduzir; animar antes disso seria
       animar no escuro. Se ele já rodou, segue direto. */
    if (window.EMI18n && window.EMI18n.get()) {
      start();
      return;
    }
    document.addEventListener('em:langchange', start, { once: true });
    window.setTimeout(start, 1600);   /* i18n ausente ou com falha */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', whenTranslated);
  } else {
    whenTranslated();
  }

  /* Rede de segurança: conteúdo nunca pode ficar invisível. */
  window.setTimeout(revealEverything, 2600);
})();
