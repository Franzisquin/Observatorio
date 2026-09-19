/* ===========================================================================
   ElectoMaps — internacionalização (pt / en)

   Resolução do idioma, em ordem de precedência:
     1. ?lang=pt|en na URL          (e passa a valer como escolha manual)
     2. escolha manual já salva     (localStorage)
     3. geografia: fuso horário brasileiro -> pt, qualquer outro -> en
     4. fallback, se o fuso não for legível: navigator.language

   O passo 3 é o que atende "inglês automático para acessos fora do Brasil".
   O fuso é usado como proxy de localização por ser a única pista geográfica
   disponível no cliente sem depender de rede nem de serviço de terceiros.

   Marcação no HTML:
     <h1 data-i18n="home.title">                      -> textContent
     <a  data-i18n-attr="title:nav.homeTitle">        -> atributo
     <p  data-i18n-html="home.lede">                  -> innerHTML (permite <br>, <strong>)
   =========================================================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'em_lang';
  var SUPPORTED = ['pt', 'en'];
  var DEFAULT = 'en';

  /* Fusos IANA do território brasileiro, incluindo os aliases legados que
     alguns navegadores ainda reportam. */
  var BR_ZONES = {
    'America/Sao_Paulo': 1, 'America/Bahia': 1, 'America/Fortaleza': 1,
    'America/Recife': 1, 'America/Maceio': 1, 'America/Belem': 1,
    'America/Santarem': 1, 'America/Araguaina': 1, 'America/Manaus': 1,
    'America/Boa_Vista': 1, 'America/Porto_Velho': 1, 'America/Rio_Branco': 1,
    'America/Eirunepe': 1, 'America/Cuiaba': 1, 'America/Campo_Grande': 1,
    'America/Noronha': 1, 'America/Bahia_Banderas': 0,
    'Brazil/East': 1, 'Brazil/West': 1, 'Brazil/Acre': 1, 'Brazil/DeNoronha': 1
  };

  /* ---------------------------------------------------------------- dicionário */

  var DICT = {
    pt: {
      'meta.home.title': 'ElectoMaps',
      'meta.home.desc': 'ElectoMaps reúne portais nacionais de dados eleitorais: resultados históricos mapeados, simulação de cenários e análise demográfica do eleitorado.',
      'meta.br.title': 'Brasil — ElectoMaps',
      'meta.br.desc': 'Portal brasileiro do ElectoMaps: resultados eleitorais de 1989 a 2024 mapeados até o local de votação, com camadas demográficas do Censo.',

      'lang.label': 'Idioma',
      'lang.pt': 'Português',
      'lang.en': 'Inglês',

      'nav.portals': 'Portais',
      'nav.about': 'Sobre',

      'legal.terms': 'Termos de Uso',
      'legal.privacy': 'Política de Privacidade',
      'legal.manage': 'Gerenciar cookies',
      'nav.brazil': 'Brasil',
      'nav.portugal': 'Portugal',
      'nav.tools': 'Ferramentas',
      'nav.coverage': 'Cobertura',

      'home.motto': 'Eleições detalhadas como você nunca viu.',
      'home.cta': 'Ver portais',

      'home.s1.title': 'Portais nacionais',
      'home.br.name': 'Brasil',
      'home.br.desc': 'Resultados de eleições gerais e municipais mapeados do país inteiro até a urna, com camadas demográficas do Censo.',
      'home.br.cta': 'Abrir portal',
      'home.pt.name': 'Portugal',
      'home.pt.desc': "Legislativas, presidenciais, europeias e autárquicas desde 1975, mapeadas do país inteiro até a freguesia, com mandatos por método d'Hondt.",
      'home.pt.cta': 'Abrir portal',
      'home.soon.title': 'Novos portais',
      'home.soon.desc': 'Outros portais nacionais estão em desenvolvimento. A estrutura do ElectoMaps é a mesma para qualquer país: fonte oficial, reprocessamento e leitura geográfica fina.',



      'br.back': 'Portais',
      'br.title': 'Brasil',
      'br.lede': 'Resultados eleitorais brasileiros de 1989 a 2024, mapeados do país inteiro até o local de votação, com camadas demográficas do Censo.',
      'br.s1.title': 'Ferramentas',
      'br.t1.title': 'Mapa Eleitoral',
      'br.t1.desc': 'Resultados de 1989 a 2024 em mapas interativos, por local de votação, município, bairro e região, com comparação entre eleições.',
      'br.t2.title': 'Simulador Eleitoral',
      'br.t2.desc': 'Crie as suas próprias disputas presidenciais e estaduais sobre o eleitorado do TSE: edite o perfil demográfico de cada recorte, ajuste como cada grupo vota e simule o segundo turno.',
      'br.open': 'Acessar',

      'br.s2.title': 'Cobertura',
      'br.cov1.title': 'Eleições gerais',
      'br.cov1.years': '1989 · 1994 · 1998 · 2002 · 2006 · 2010 · 2014 · 2018 · 2022',
      'br.cov1.offices': 'Presidente, Governador, Senador, Deputado Federal e Deputado Estadual',
      'br.cov2.title': 'Eleições municipais',
      'br.cov2.years': '2000 · 2004 · 2008 · 2012 · 2016 · 2020 · 2024',
      'br.cov2.offices': 'Prefeito e Vereador',
      'br.cov3.title': 'Camadas demográficas',
      'br.cov3.offices': 'Renda, cor/raça, idade, escolaridade e saneamento',

      'meta.sobre.title': 'Sobre — ElectoMaps',
      'meta.sobre.desc': 'O ElectoMaps é uma organização de mídia política apartidária dedicada a resultados eleitorais, opinião pública agregada e análise de dados.',
      'meta.pt.title': 'Portugal — ElectoMaps',
      'meta.pt.desc': 'Portal português do ElectoMaps: resultados eleitorais de 1975 a 2026 mapeados até à freguesia, com camadas demográficas dos Censos.',
      'pt.back': 'Portais',
      'pt.title': 'Portugal',
      'pt.lede': 'Resultados eleitorais portugueses de 1975 a 2026, mapeados do país inteiro até à freguesia, com camadas demográficas dos Censos.',
      'pt.s1.title': 'Ferramentas',
      'pt.t1.title': 'Mapa Eleitoral',
      'pt.t1.desc': 'Legislativas, presidenciais, europeias e autárquicas em mapas interativos, do país inteiro ao concelho e à freguesia, com comparação entre eleições.',
      'pt.open': 'Aceder',
      'pt.s2.title': 'Cobertura',
      'pt.cov1.title': 'Legislativas',
      'pt.cov1.years': '1975 · 1976 · 1979 · 1980 · 1983 · 1985 · 1987 · 1991 · 1995 · 1999 · 2002 · 2005 · 2009 · 2011 · 2015 · 2019 · 2022 · 2024 · 2025',
      'pt.cov1.offices': 'Assembleia da República',
      'pt.cov2.title': 'Presidenciais',
      'pt.cov2.years': '1976 · 1980 · 1986 · 1991 · 1996 · 2001 · 2006 · 2011 · 2016 · 2021 · 2026',
      'pt.cov2.offices': 'Presidente da República, com as segundas voltas de 1986 e 2026',
      'pt.cov3.title': 'Europeias',
      'pt.cov3.years': '1987 · 1989 · 1994 · 1999 · 2004 · 2009 · 2014 · 2019 · 2024',
      'pt.cov3.offices': 'Parlamento Europeu',
      'pt.cov4.title': 'Autárquicas',
      'pt.cov4.years': '1976 · 1979 · 1982 · 1985 · 1989 · 1993 · 1997 · 2001 · 2005 · 2009 · 2013 · 2017 · 2021 · 2025',
      'pt.cov4.offices': 'Câmara Municipal, Assembleia Municipal e Assembleia de Freguesia',
      'pt.cov5.title': 'Camadas demográficas',
      'pt.cov5.years': 'Censos 2001 · 2011 · 2021',
      'pt.cov5.offices': 'População, idade, escolaridade, habitação e rendimento',
      'meta.404.title': 'Página não encontrada — ElectoMaps',
      'meta.404.desc': 'A página que você procurou não existe neste endereço.',
      'e404.code': 'Erro 404',
      'e404.title': 'Esta página não existe.',
      'e404.lead': 'O endereço pode ter mudado, ou o link que trouxe você até aqui está errado. O ElectoMaps continua no ar — comece pelo portal.',
      'e404.portal': 'Ir para o portal Brasil',
      'e404.home': 'Voltar à home',

      'sobre.title': 'Sobre',
      'sobre.lede': 'O ElectoMaps é uma organização de mídia política apartidária. Nasceu da vontade de um grupo de jovens fascinados por política e eleições, com a missão de trazer e popularizar no Brasil um nível a mais de sofisticação analítica no tratamento de resultados eleitorais, opinião pública agregada e análise de dados.',

      'sobre.team.title': 'Equipe',
      'sobre.p1.name': 'Luiz Daniel Medeiros',
      'sobre.p1.role': 'Fundador',
      'sobre.p1.bio': 'Estudante de Direito baseado em Manaus. É um dos fundadores do projeto, responsável pela elaboração inicial e pelo processamento e curadoria dos dados e resultados eleitorais, além de ser o desenvolvedor-chave do ElectoMaps.',
      'sobre.p2.name': 'Francisco Coelho',
      'sobre.p2.role': 'Fundador',
      'sobre.p2.bio': 'Estudante de Administração baseado em Florianópolis. É responsável pelos modelos de nowcast, pela agregação de pesquisas e pelos simuladores interativos, além de todo o polimento e o web design do projeto.',

      'foot.project': 'Projeto',
      'foot.support': 'Apoiar o projeto',
      'foot.tagline': 'Cartografia eleitoral independente',
      'foot.portals': 'Portais',
      'foot.contact': 'Contato',
      'foot.email': 'E-mail',
      'foot.rights': '© 2026 ElectoMaps. Todos os direitos reservados.',
      'foot.sources': 'Fontes oficiais, análise independente.'
    },

    en: {
      'meta.home.title': 'ElectoMaps',
      'meta.home.desc': 'ElectoMaps brings together national portals of electoral data: mapped historical results, scenario simulation and demographic analysis of the electorate.',
      'meta.br.title': 'Brazil — ElectoMaps',
      'meta.br.desc': 'The Brazilian portal of ElectoMaps: election results from 1989 to 2024 mapped down to the polling place, with demographic layers from the Census.',

      'lang.label': 'Language',
      'lang.pt': 'Portuguese',
      'lang.en': 'English',

      'nav.portals': 'Portals',
      'nav.about': 'About',

      'legal.terms': 'Terms of Use',
      'legal.privacy': 'Privacy Policy',
      'legal.manage': 'Manage cookies',
      'nav.brazil': 'Brazil',
      'nav.portugal': 'Portugal',
      'nav.tools': 'Tools',
      'nav.coverage': 'Coverage',

      'home.motto': 'Elections in detail like you have never seen.',
      'home.cta': 'See portals',

      'home.s1.title': 'National portals',
      'home.br.name': 'Brazil',
      'home.br.desc': 'General and municipal election results mapped from the whole country down to the ballot box, with demographic layers from the Census.',
      'home.br.cta': 'Open portal',
      'home.pt.name': 'Portugal',
      'home.pt.desc': "Legislative, presidential, European and local elections since 1975, mapped from the whole country down to the parish, with seats by the d'Hondt method.",
      'home.pt.cta': 'Open portal',
      'home.soon.title': 'New portals',
      'home.soon.desc': 'Further national portals are in development. The structure of ElectoMaps is the same for any country: official source, reprocessing, and fine geographic reading.',



      'br.back': 'Portals',
      'br.title': 'Brazil',
      'br.lede': 'Brazilian election results from 1989 to 2024, mapped from the whole country down to the polling place, with demographic layers from the Census.',
      'br.s1.title': 'Tools',
      'br.t1.title': 'Electoral Map',
      'br.t1.desc': 'Results from 1989 to 2024 on interactive maps, by polling place, municipality, neighbourhood and region, with comparison between elections.',
      'br.t2.title': 'Election Simulator',
      'br.t2.desc': 'Create your own presidential and state races on top of the TSE electorate: edit the demographic profile of each segment, adjust how each group votes, and simulate the runoff.',
      'br.open': 'Open',

      'br.s2.title': 'Coverage',
      'br.cov1.title': 'General elections',
      'br.cov1.years': '1989 · 1994 · 1998 · 2002 · 2006 · 2010 · 2014 · 2018 · 2022',
      'br.cov1.offices': 'President, Governor, Senator, Federal Deputy and State Deputy',
      'br.cov2.title': 'Municipal elections',
      'br.cov2.years': '2000 · 2004 · 2008 · 2012 · 2016 · 2020 · 2024',
      'br.cov2.offices': 'Mayor and City Councillor',
      'br.cov3.title': 'Demographic layers',
      'br.cov3.offices': 'Income, race, age, education and sanitation',

      'meta.sobre.title': 'About — ElectoMaps',
      'meta.sobre.desc': 'ElectoMaps is a non-partisan political media organisation devoted to election results, aggregated public opinion and data analysis.',
      'meta.pt.title': 'Portugal — ElectoMaps',
      'meta.pt.desc': 'The Portuguese portal of ElectoMaps: election results from 1975 to 2026 mapped down to the parish, with demographic layers from the Census.',
      'pt.back': 'Portals',
      'pt.title': 'Portugal',
      'pt.lede': 'Portuguese election results from 1975 to 2026, mapped from the whole country down to the parish, with demographic layers from the Census.',
      'pt.s1.title': 'Tools',
      'pt.t1.title': 'Electoral Map',
      'pt.t1.desc': 'Legislative, presidential, European and local elections in interactive maps, from the whole country down to the municipality and the parish, with comparison between elections.',
      'pt.open': 'Open',
      'pt.s2.title': 'Coverage',
      'pt.cov1.title': 'Legislative',
      'pt.cov1.years': '1975 · 1976 · 1979 · 1980 · 1983 · 1985 · 1987 · 1991 · 1995 · 1999 · 2002 · 2005 · 2009 · 2011 · 2015 · 2019 · 2022 · 2024 · 2025',
      'pt.cov1.offices': 'Assembly of the Republic',
      'pt.cov2.title': 'Presidential',
      'pt.cov2.years': '1976 · 1980 · 1986 · 1991 · 1996 · 2001 · 2006 · 2011 · 2016 · 2021 · 2026',
      'pt.cov2.offices': 'President of the Republic, including the 1986 and 2026 run-offs',
      'pt.cov3.title': 'European',
      'pt.cov3.years': '1987 · 1989 · 1994 · 1999 · 2004 · 2009 · 2014 · 2019 · 2024',
      'pt.cov3.offices': 'European Parliament',
      'pt.cov4.title': 'Local',
      'pt.cov4.years': '1976 · 1979 · 1982 · 1985 · 1989 · 1993 · 1997 · 2001 · 2005 · 2009 · 2013 · 2017 · 2021 · 2025',
      'pt.cov4.offices': 'Municipal Chamber, Municipal Assembly and Parish Assembly',
      'pt.cov5.title': 'Demographic layers',
      'pt.cov5.years': 'Censos 2001 · 2011 · 2021',
      'pt.cov5.offices': 'Population, age, education, housing and income',
      'meta.404.title': 'Page not found — ElectoMaps',
      'meta.404.desc': 'The page you were looking for does not exist at this address.',
      'e404.code': 'Error 404',
      'e404.title': 'This page does not exist.',
      'e404.lead': 'The address may have changed, or the link that brought you here is wrong. ElectoMaps is still up — start from the portal.',
      'e404.portal': 'Go to the Brazil portal',
      'e404.home': 'Back to the home page',

      'sobre.title': 'About',
      'sobre.lede': 'ElectoMaps is a non-partisan political media organisation. It grew out of a group of young people fascinated by politics and elections, with the mission of bringing to Brazil — and making widely available there — a further degree of analytical sophistication in how election results, aggregated public opinion and data are treated.',

      'sobre.team.title': 'Team',
      'sobre.p1.name': 'Luiz Daniel Medeiros',
      'sobre.p1.role': 'Co-founder',
      'sobre.p1.bio': 'Law student based in Manaus. Co-founder of the project, responsible for its initial design and for the processing and curation of the electoral data and results, and the key developer of ElectoMaps.',
      'sobre.p2.name': 'Francisco Coelho',
      'sobre.p2.role': 'Co-founder',
      'sobre.p2.bio': 'Business Administration student based in Florianópolis. Responsible for the nowcast models, the poll aggregation and the interactive simulators, as well as all the polish and web design of the project.',

      'foot.project': 'Project',
      'foot.support': 'Support the project',
      'foot.tagline': 'Independent electoral cartography',
      'foot.portals': 'Portals',
      'foot.contact': 'Contact',
      'foot.email': 'Email',
      'foot.rights': '© 2026 ElectoMaps. All rights reserved.',
      'foot.sources': 'Official sources, independent analysis.'
    }
  };

  /* ---------------------------------------------------------------- detecção */

  function normalize(lang) {
    if (!lang) return null;
    var base = String(lang).toLowerCase().split('-')[0];
    return SUPPORTED.indexOf(base) !== -1 ? base : null;
  }

  function fromQuery() {
    var m = /[?&]lang=([a-zA-Z-]+)/.exec(window.location.search);
    return m ? normalize(m[1]) : null;
  }

  function fromStorage() {
    try {
      return normalize(window.localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;   // modo privado / storage bloqueado
    }
  }

  function persist(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) { /* segue sem persistir */ }
  }

  /* null quando o fuso não pode ser lido — aí o chamador cai no navigator */
  function isInBrazil() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!tz) return null;
      return BR_ZONES[tz] === 1;
    } catch (e) {
      return null;
    }
  }

  function detect() {
    var q = fromQuery();
    if (q) { persist(q); return q; }

    var saved = fromStorage();
    if (saved) return saved;

    var brazil = isInBrazil();
    if (brazil === true) return 'pt';
    if (brazil === false) return 'en';

    var navLang = normalize(navigator.language ||
      (navigator.languages && navigator.languages[0]));
    return navLang || DEFAULT;
  }

  /* ---------------------------------------------------------------- aplicação */

  var current = null;

  function translate(key, lang) {
    var table = DICT[lang] || DICT[DEFAULT];
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    var fb = DICT[DEFAULT];
    return Object.prototype.hasOwnProperty.call(fb, key) ? fb[key] : key;
  }

  function apply(lang) {
    current = lang;
    document.documentElement.setAttribute('lang', lang === 'pt' ? 'pt-BR' : 'en');

    var i, el, nodes;

    nodes = document.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      el.textContent = translate(el.getAttribute('data-i18n'), lang);
    }

    nodes = document.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      el.innerHTML = translate(el.getAttribute('data-i18n-html'), lang);
    }

    /* data-i18n-attr="title:chave" ou "title:a;aria-label:b" */
    nodes = document.querySelectorAll('[data-i18n-attr]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      var pairs = el.getAttribute('data-i18n-attr').split(';');
      for (var j = 0; j < pairs.length; j++) {
        var parts = pairs[j].split(':');
        if (parts.length === 2) {
          el.setAttribute(parts[0].trim(), translate(parts[1].trim(), lang));
        }
      }
    }

    /* título e descrição da página, declarados no <body data-i18n-page="home"> */
    var page = document.body.getAttribute('data-i18n-page');
    if (page) {
      document.title = translate('meta.' + page + '.title', lang);
      var desc = document.querySelector('meta[name="description"]');
      if (desc) desc.setAttribute('content', translate('meta.' + page + '.desc', lang));
    }

    /* estado dos botões do seletor */
    nodes = document.querySelectorAll('[data-lang]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      var on = el.getAttribute('data-lang') === lang;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.classList.toggle('is-active', on);
    }

    document.documentElement.classList.remove('i18n-boot');
    document.dispatchEvent(new CustomEvent('em:langchange', { detail: { lang: lang } }));
  }

  function setLang(lang) {
    var norm = normalize(lang);
    if (!norm || norm === current) return;
    persist(norm);
    apply(norm);
  }

  function wire() {
    document.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('[data-lang]');
      if (!btn) return;
      ev.preventDefault();
      setLang(btn.getAttribute('data-lang'));
    });
  }

  /* Páginas com muito texto (termos, privacidade) trazem o seu próprio bloco
     de dicionário em js/i18n-legal.js, para não inchar este arquivo. Ele só
     precisa estar carregado antes do DOMContentLoaded. */
  function merge() {
    var extra = window.EM_I18N_EXTRA;
    if (!extra) return;
    for (var i = 0; i < SUPPORTED.length; i++) {
      var lang = SUPPORTED[i];
      if (!extra[lang]) continue;
      for (var k in extra[lang]) {
        if (Object.prototype.hasOwnProperty.call(extra[lang], k)) {
          DICT[lang][k] = extra[lang][k];
        }
      }
    }
  }

  function boot() {
    merge();
    apply(detect());
    wire();
  }

  window.EMI18n = {
    get: function () { return current; },
    set: setLang,
    t: function (key) { return translate(key, current || DEFAULT); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Rede de segurança: se algo acima falhar, a página não pode ficar oculta. */
  window.setTimeout(function () {
    document.documentElement.classList.remove('i18n-boot');
  }, 1500);
})();
