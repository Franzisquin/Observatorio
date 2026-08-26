/* ===========================================================================
   ElectoMaps — consentimento de cookies

   Regra do site: nenhum cookie de medição de audiência é criado antes de uma
   escolha explícita. A faixa aparece na primeira visita, em qualquer página, e
   só some quando a pessoa aceita ou recusa — não há "fechar sem escolher", que
   equivaleria a consentir por omissão.

   A escolha fica em localStorage, junto de uma versão. Subir CONSENT_VERSION
   invalida os consentimentos antigos e faz a faixa reaparecer — é o que se usa
   quando a finalidade da medição muda.

   Para ligar a medição de audiência, preencha carregarMedicao() lá embaixo. Ela
   só é chamada quando há consentimento válido, nunca antes.

   API pública:
     EMConsent.get()      -> 'granted' | 'denied' | null
     EMConsent.granted()  -> boolean
     EMConsent.set(v)     -> registra a escolha
     EMConsent.onGrant(f) -> roda f quando houver consentimento (ou já agora)
     EMConsent.open()     -> reabre a faixa ("Gerenciar cookies", no rodapé)
   =========================================================================== */
(function () {
  'use strict';

  var KEY = 'em_consent';
  var CONSENT_VERSION = 1;

  var TEXT = {
    pt: {
      title: 'Cookies',
      body: 'Usamos cookies de medição de audiência para entender quais páginas são usadas. Eles só são criados se você aceitar, e recusar não limita nada no site. O idioma, o tema e os cenários do simulador ficam guardados apenas no seu navegador.',
      link: 'Política de Privacidade',
      accept: 'Aceitar',
      deny: 'Recusar'
    },
    en: {
      title: 'Cookies',
      body: 'We use audience measurement cookies to understand which pages get used. They are only created if you accept, and refusing limits nothing on the site. Your language, theme and simulator scenarios stay in your browser alone.',
      link: 'Privacy Policy',
      accept: 'Accept',
      deny: 'Refuse'
    }
  };

  /* Caminho até a raiz do site. Todas as páginas hoje ficam na raiz, mas isto
     evita que um link quebre se alguma for para uma subpasta. */
  var PRIVACY = 'privacidade.html';

  /* ------------------------------------------------------------ persistência */

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || obj.v !== CONSENT_VERSION) return null;
      return obj.choice === 'granted' || obj.choice === 'denied' ? obj : null;
    } catch (e) {
      return null;   /* modo privado, storage bloqueado ou JSON corrompido */
    }
  }

  function save(choice) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify({
        v: CONSENT_VERSION,
        choice: choice,
        at: new Date().toISOString()
      }));
    } catch (e) { /* segue sem persistir: a faixa volta na próxima visita */ }
  }

  var current = read();
  var pending = [];

  /* ---------------------------------------------------- medição de audiência

     Ponto único de entrada do provedor de analytics. Enquanto estiver vazia, o
     site não carrega nenhum script de terceiros nem cria cookie algum.

     Para ligar, cole aqui o snippet do provedor escolhido (GA4, Plausible,
     Matomo…). Ao trocar de provedor ou de finalidade, suba CONSENT_VERSION
     para pedir o consentimento de novo.                                      */

  var medicaoCarregada = false;

  function carregarMedicao() {
    if (medicaoCarregada) return;
    medicaoCarregada = true;

    /* — nenhum provedor configurado — */
  }

  /* ------------------------------------------------------------------ idioma */

  function lang() {
    if (window.EMI18n && window.EMI18n.get()) return window.EMI18n.get();
    var l = (navigator.language || 'pt').toLowerCase();
    return l.indexOf('pt') === 0 ? 'pt' : 'en';
  }

  function t() { return TEXT[lang()] || TEXT.pt; }

  /* -------------------------------------------------------------------- faixa */

  var bar = null;

  function build() {
    if (bar) return bar;

    bar = document.createElement('div');
    bar.className = 'em-consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-live', 'polite');
    bar.setAttribute('aria-label', 'Cookies');

    bar.innerHTML =
      '<div class="em-consent-in">' +
        '<div class="em-consent-text">' +
          '<p class="em-consent-title"></p>' +
          '<p><span class="em-consent-body"></span> <a href="' + PRIVACY + '"></a></p>' +
        '</div>' +
        '<div class="em-consent-actions">' +
          '<button type="button" data-consent="denied"></button>' +
          '<button type="button" data-consent="granted"></button>' +
        '</div>' +
      '</div>';

    bar.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-consent]');
      if (!btn) return;
      set(btn.getAttribute('data-consent'));
    });

    document.body.appendChild(bar);
    return bar;
  }

  function paint() {
    if (!bar) return;
    var s = t();
    bar.querySelector('.em-consent-title').textContent = s.title;
    bar.querySelector('.em-consent-body').textContent = s.body;
    bar.querySelector('.em-consent-actions [data-consent="denied"]').textContent = s.deny;
    bar.querySelector('.em-consent-actions [data-consent="granted"]').textContent = s.accept;
    var a = bar.querySelector('.em-consent-text a');
    a.textContent = s.link;
  }

  function show() {
    build();
    paint();
    /* dois quadros para a transição sair do estado inicial */
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () { bar.classList.add('is-open'); });
    });
  }

  function hide() {
    if (bar) bar.classList.remove('is-open');
  }

  /* ------------------------------------------------------------------- API */

  function set(choice) {
    if (choice !== 'granted' && choice !== 'denied') return;
    current = { v: CONSENT_VERSION, choice: choice, at: new Date().toISOString() };
    save(choice);
    hide();
    if (choice === 'granted') {
      carregarMedicao();
      while (pending.length) {
        try { pending.shift()(); } catch (e) { /* um ouvinte não derruba os outros */ }
      }
    }
    document.dispatchEvent(new CustomEvent('em:consent', { detail: { choice: choice } }));
  }

  window.EMConsent = {
    get: function () { return current ? current.choice : null; },
    granted: function () { return !!current && current.choice === 'granted'; },
    set: set,
    onGrant: function (fn) {
      if (typeof fn !== 'function') return;
      if (window.EMConsent.granted()) { try { fn(); } catch (e) { /* ok */ } return; }
      pending.push(fn);
    },
    open: function () { show(); }
  };

  /* ------------------------------------------------------------------ boot */

  function boot() {
    /* "Gerenciar cookies" no rodapé de qualquer página */
    document.addEventListener('click', function (ev) {
      var el = ev.target.closest && ev.target.closest('[data-consent-open]');
      if (!el) return;
      ev.preventDefault();
      show();
    });

    if (current) {
      if (current.choice === 'granted') {
        carregarMedicao();
        while (pending.length) {
          try { pending.shift()(); } catch (e) { /* ok */ }
        }
      }
      return;   /* já escolheu: nada aparece */
    }

    show();
  }

  /* Se a página traduz, espera o idioma antes de escrever a faixa. */
  document.addEventListener('em:langchange', paint);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
