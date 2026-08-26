/* ===========================================================================
   ElectoMaps — apuração: camada de dados

   Compartilhada pela página nacional e pelas páginas estaduais. Lê os mesmos
   snapshots que scripts/apuracao/coleta.py publica, sem recalcular nada: o TSE
   já divulga voto, percentual e seções totalizadas, e alterar qualquer um deles
   esbarraria no art. 267 §4 da Resolução 23.751/2026.

   Contrato dos snapshots (ver coleta.py):
     {ele}-{cargo}-br.json   {meta, abr:{br:{...}}, cand:{sq:{nome,urna,numero,partido}}}
     {ele}-{cargo}-uf.json   {meta, abr:{uf:{...}}, cand:{...}}
     {ele}-{cargo}-{uf}.json {meta, abr:{cdTse:{...}}, mun:{cdTse:{nm,ibge}}, cand:{...}}

   Cada entrada de `abr`: st/ts/pst (seções), te/comp/abst (eleitorado),
   tv/vv/vb/vn (votos), cand:{sq:votos}. Proporcional troca `cand` por `part`.
   =========================================================================== */
'use strict';

const APU = (function () {

  const PUBLICADO = 'https://raw.githubusercontent.com/Franzisquin/Observatorio/apuracao-data/';
  const P = new URLSearchParams(location.search);

  const cfg = {
    base: P.get('dados') || PUBLICADO,
    eleicao: P.get('eleicao') || '',
    cargo: P.get('cargo') || '0001',
    uf: (P.get('uf') || '').toLowerCase(),
    /* Cadência da recarga. O plantão publica a camada alta a cada ~45s. */
    intervalo: Math.max(15, Number(P.get('intervalo') || 45)) * 1000
  };

  const CARGOS = {
    '0001': 'Presidente', '0003': 'Governador', '0005': 'Senador',
    '0006': 'Deputado Federal', '0007': 'Deputado Estadual',
    '0008': 'Deputado Distrital'
  };

  const PROPORCIONAIS = new Set(['0006', '0007', '0008', '0013']);

  const UF_NOMES = {
    ac: 'Acre', al: 'Alagoas', am: 'Amazonas', ap: 'Amapá', ba: 'Bahia',
    ce: 'Ceará', df: 'Distrito Federal', es: 'Espírito Santo', go: 'Goiás',
    ma: 'Maranhão', mg: 'Minas Gerais', ms: 'Mato Grosso do Sul',
    mt: 'Mato Grosso', pa: 'Pará', pb: 'Paraíba', pe: 'Pernambuco',
    pi: 'Piauí', pr: 'Paraná', rj: 'Rio de Janeiro', rn: 'Rio Grande do Norte',
    ro: 'Rondônia', rr: 'Roraima', rs: 'Rio Grande do Sul',
    sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins'
  };

  /* Paleta partidária do site, derivada de PARTY_COLOR_OVERRIDES (js/globals.js)
     — a predefinição que o visualizador pinta no mapa e que simulador.js
     espelha —, completada com PARTY_COLORS para as siglas que a override não
     cobre. Chaves já normalizadas: maiúsculas, sem acento, sem "FEDERAÇÃO ".

     DEMOCRATA usa a cor do PMB: é o mesmo partido, renomeado. */
  const CORES = {
    'AGIR': '#254d88', 'ARENA': '#4034b2', 'AVANTE': '#36aeba', 'CIDADANIA': '#ec5fa6',
    'DC': '#809eff', 'DEM': '#6dbf36', 'DEMOCRATA': '#384ba8', 'MDB': '#16a250',
    'MISSAO': '#fdbe21', 'MOBILIZA': '#dd3333', 'NOVO': '#ff6600', 'OUTROS': '#7a8699',
    'PAN': '#ffff00', 'PASART': '#0000ff', 'PATRI': '#5fa72f', 'PATRIOTA': '#5fa72f',
    'PC DO B': '#b4251d', 'PCB': '#c40823', 'PCDOB': '#b4251d', 'PCO': '#8e3d10',
    'PDS': '#6391d4', 'PDT': '#ffad99', 'PEN': '#4aa561', 'PFL': '#6dbf36',
    'PGT': '#006600', 'PH': '#ff8511', 'PHS': '#e25850', 'PJ': '#01369e', 'PL': '#304091',
    'PMB': '#384ba8', 'PMDB': '#16a250', 'PMN': '#ff3333', 'PN': '#008000',
    'PODE': '#23a840', 'PODEMOS': '#23a840', 'PP': '#6391d4', 'PPB': '#6391d4',
    'PPL': '#c6a815', 'PPR': '#6391d4', 'PPS': '#ec5fa6', 'PR': '#304091', 'PRB': '#45bdc9',
    'PRD': '#007c3c', 'PRN': '#009966', 'PRONA': '#0f6c36', 'PROS': '#e6661e',
    'PRP': '#ffe099', 'PRTB': '#1a7e2f', 'PSB': '#edd355', 'PSC': '#2f8e4f',
    'PSD': '#eb8100', 'PSDB': '#0097fd', 'PSDC': '#809eff', 'PSL': '#5dca53',
    'PSOL': '#e95dd2', 'PSP46': '#533e40', 'PST': '#9370db', 'PSTU': '#620411',
    'PT': '#ff3859', 'PT DO B': '#2eacb2', 'PTB': '#71def4', 'PTC': '#37c884',
    'PTN': '#23a840', 'PTR': '#1a7e2f', 'PTRB': '#245ba0', 'PV': '#1f9439',
    'REDE': '#7dd1d9', 'REPUBLICANOS': '#1f646b', 'SD': '#ff633d',
    'SOLIDARIEDADE': '#ff633d', 'TOSSUP': '#cbd5e1', 'UNIAO': '#2eccff',
    'UNIAO BRASIL': '#2eccff', 'UP': '#5e5e5e'
  };

  /* Mesmas equivalências de getNormalizedPartyColorKey() no visualizador. */
  const APELIDOS = {
    PATRI: 'PATRIOTA', PODE: 'PODEMOS', SD: 'SOLIDARIEDADE',
    'PC DO B': 'PCDOB', DEMOCRATA: 'PMB'
  };

  const CINZA = '#94a3b8';

  function cor(sigla) {
    let k = String(sigla || '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').replace(/^FEDERACAO /, '');
    if (APELIDOS[k]) k = APELIDOS[k];
    return CORES[k] || CORES[k.replace(/\s+/g, '')] || CINZA;
  }

  /* ------------------------------------------------------------------ nomes */

  /* O TSE devolve tudo em caixa alta. Baixar sem critério estragaria sigla e
     inicial: JHC vira Jhc, ACM vira Acm. Palavra sem vogal fica como está. */
  const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU',
    'DEL', 'DELLA', 'VAN', 'VON', 'Y', 'LA', 'LE', 'DOS', 'D']);

  function capitalizar(palavra) {
    if (!palavra) return palavra;
    const nu = palavra.normalize('NFD').replace(/[̀-ͯ]/g, '');
    /* Sigla ou inicial: sem vogal, ou pontuada no meio (A.C.M.). */
    if (!/[AEIOU]/i.test(nu) || /\w\.\w/.test(palavra)) return palavra;
    /* Maiuscula tambem depois de apostrofo: D'Avila, Sant'Anna, O'Brien. */
    return (palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase())
      .replace(/(['’])(\p{L})/gu, (_, ap, letra) => ap + letra.toUpperCase());
  }

  function nomeProprio(bruto) {
    const texto = String(bruto || '').trim();
    if (!texto) return '';
    /* Só mexe se veio em caixa alta; nome já composto passa intacto. */
    if (texto !== texto.toUpperCase()) return texto;

    return texto.split(/(\s+|-)/).map((parte, i) => {
      if (/^(\s+|-)$/.test(parte)) return parte;
      const limpa = parte.replace(/[^\wÀ-ÿ]/g, '').toUpperCase();
      if (i > 0 && PARTICULAS.has(limpa)) return parte.toLowerCase();
      return capitalizar(parte);
    }).join('');
  }

  /* ------------------------------------------------------------- formatação */

  const nf = new Intl.NumberFormat('pt-BR');
  const pf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmt = {
    int: (v) => nf.format(Math.round(Number(v) || 0)),
    pct: (v) => pf.format(Number(v) || 0) + '%',
    /* Percentual de uma parte sobre um total, defendido de divisão por zero. */
    parte: (parte, total) => (total > 0 ? (Number(parte) / Number(total)) * 100 : 0)
  };

  /* ------------------------------------------------------------------ rede */

  /* O snapshot muda a cada volta do plantão; sem burlar o cache, o
     raw.githubusercontent devolve a versão anterior por minutos. */
  function comBust(url) {
    return url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
  }

  async function snapshot(sufixo) {
    if (!cfg.eleicao) return null;
    const url = `${cfg.base}${cfg.eleicao}-${cfg.cargo}-${sufixo}.json`;
    try {
      const r = await fetch(comBust(url), { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      console.warn('[apuracao] snapshot indisponível', sufixo, e);
      return null;
    }
  }

  const _malhas = {};

  /* Malha já projetada em paths SVG por scripts/gerar_malhas_apuracao.py:
     {w, h, p:[[chave, nome, d], ...]}. `nivel` escolhe a camada — 'municipios'
     (padrão), 'rgint' ou 'rgi'; nas regionais cada item traz um quarto campo
     com os municípios que a compõem, que é o que a página soma para pintar.

     Vem da malha de alta definição do IBGE e é simplificada uma vez só, na
     geração. A página fazia isso no navegador, a partir da malha simplificada,
     e o resultado era ao mesmo tempo mais pesado e mais grosseiro. Todas as
     camadas de uma UF saem no mesmo viewBox, então trocar de camada não move
     o desenho. */
  async function malha(uf, nivel) {
    const sigla = String(uf).toUpperCase();
    const n = nivel || 'municipios';
    const chave = `${n}_${sigla}`;
    if (_malhas[chave] !== undefined) return _malhas[chave];
    const url = n === 'municipios'
      ? `resultados_geo/municipios_svg/municipios_${sigla}.json`
      : `resultados_geo/regioes_svg/${n}_${sigla}.json`;
    try {
      const r = await fetch(url);
      _malhas[chave] = r.ok ? await r.json() : null;
    } catch (e) {
      console.warn('[apuracao] malha indisponível', chave, e);
      _malhas[chave] = null;
    }
    return _malhas[chave];
  }

  /* ---------------------------------------------------------------- leitura */

  /* Candidatos ordenados por voto. O percentual é sobre válidos, a mesma base
     do pvap do TSE. */
  function ranking(entrada, dicionario) {
    if (!entrada) return [];
    const validos = entrada.vv || 0;

    if (PROPORCIONAIS.has(cfg.cargo)) {
      return Object.entries(entrada.part || {})
        .map(([sigla, votos]) => ({
          chave: sigla, nome: sigla, urna: sigla, partido: sigla,
          numero: '', votos, pct: fmt.parte(votos, validos)
        }))
        .sort((a, b) => b.votos - a.votos);
    }

    return Object.entries(entrada.cand || {})
      .map(([sq, votos]) => {
        const d = (dicionario || {})[sq] || {};
        return {
          chave: sq,
          nome: nomeProprio(d.nome) || sq,
          urna: nomeProprio(d.urna || d.nome) || sq,
          numero: d.numero || '',
          partido: d.partido || '',
          votos,
          pct: fmt.parte(votos, validos)
        };
      })
      .sort((a, b) => b.votos - a.votos);
  }

  function lider(entrada, dicionario) {
    return ranking(entrada, dicionario)[0] || null;
  }

  /* Soma um conjunto de entradas numa só. Serve para compor o total de uma UF
     a partir dos municípios quando o arquivo de UF ainda não chegou. */
  function agregar(entradas) {
    const total = { cand: {}, part: {} };
    ['st', 'ts', 'te', 'comp', 'abst', 'tv', 'vv', 'vb', 'vn'].forEach((c) => (total[c] = 0));
    entradas.forEach((e) => {
      if (!e) return;
      ['st', 'ts', 'te', 'comp', 'abst', 'tv', 'vv', 'vb', 'vn'].forEach((c) => {
        total[c] += Number(e[c]) || 0;
      });
      Object.entries(e.cand || {}).forEach(([k, v]) => (total.cand[k] = (total.cand[k] || 0) + v));
      Object.entries(e.part || {}).forEach(([k, v]) => (total.part[k] = (total.part[k] || 0) + v));
    });
    total.pst = fmt.parte(total.st, total.ts);
    return total;
  }

  /* ------------------------------------------------- candidaturas (pré-urna) */

  /* Lista registrada no DivulgaCandContas, escrita por
     scripts/apuracao/candidatos.py. Serve para a página existir antes da
     primeira urna: os nomes aparecem com zero voto e vão sendo preenchidos
     conforme o boletim chega. */
  var _cands = {};

  async function candidaturas(cargo) {
    var c = cargo || cfg.cargo;
    if (_cands[c] !== undefined) return _cands[c];
    try {
      var r = await fetch(`resultados_geo/candidatos_2026/cargo-${c}.json`);
      _cands[c] = r.ok ? await r.json() : null;
    } catch (e) {
      _cands[c] = null;
    }
    return _cands[c];
  }

  /* Manifesto das fotos existentes. Sem ele, a página não pede foto nenhuma —
     tentar e cair no onerror enchia o console de 404 e gastava uma requisição
     por candidato. O importador escreve este arquivo junto com as imagens. */
  var _fotos = null;

  async function fotosDisponiveis() {
    if (_fotos !== null) return _fotos;
    try {
      var r = await fetch('resultados_geo/candidatos_2026/fotos.json');
      var lista = r.ok ? await r.json() : [];
      _fotos = new Set(Array.isArray(lista) ? lista.map(String) : Object.keys(lista));
    } catch (e) {
      _fotos = new Set();
    }
    return _fotos;
  }

  function temFoto(sq) {
    return !!(_fotos && _fotos.has(String(sq)));
  }

  /* Ranking de partida: todo mundo em zero. A ordem é alfabética porque, sem
     voto, qualquer outra ordenação sugeriria uma disputa que ainda não houve. */
  function rankingZerado(dicionario, uf) {
    if (!dicionario) return [];
    var alvo = (uf || '').toUpperCase();
    return Object.entries(dicionario)
      /* Quem renunciou saiu da disputa: não é candidatura em zero, é ausência. */
      .filter(([, c]) => (!alvo || String(c.uf).toUpperCase() === alvo)
        && !/^Ren[úu]ncia/i.test(String(c.situacao || '')))
      .map(([sq, c]) => ({
        chave: sq,
        nome: nomeProprio(c.nome || c.urna),
        urna: nomeProprio(c.urna || c.nome),
        numero: c.numero || '',
        partido: c.partido || '',
        coligacao: c.coligacao || '',
        situacao: c.situacao || '',
        votos: 0,
        pct: 0,
        zerado: true
      }))
      .sort((a, b) => a.urna.localeCompare(b.urna, 'pt-BR'));
  }

  /* ------------------------------------------------------------------ selo */

  /* "s" = simulado. Carregar essa marca até a tela é o que impede publicar
     número de ensaio como se fosse resultado. */
  function simulado(meta) {
    return !!meta && meta.f === 's';
  }

  function carimbo(entrada) {
    if (!entrada || !entrada.dt) return '';
    return `${entrada.dt} ${entrada.ht || ''}`.trim();
  }

  return {
    cfg, CARGOS, PROPORCIONAIS, UF_NOMES,
    cor, fmt, nomeProprio, snapshot, malha, ranking, lider, agregar,
    candidaturas, rankingZerado, fotosDisponiveis, temFoto,
    simulado, carimbo
  };
})();
