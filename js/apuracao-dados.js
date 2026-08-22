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

  /* Mesma paleta partidária do resto do site (js/globals.js), reduzida aos
     partidos que aparecem em disputa majoritária. */
  const CORES = {
    PT: '#C0122D', PL: '#30306C', PSDB: '#0096ff', MDB: '#009959', PP: '#3672c9',
    PSD: '#ffa400', UNIÃO: '#054577', UNIAO: '#054577', PDT: '#FE8E6D',
    PSB: '#FFCC00', PSOL: '#68018D', REPUBLICANOS: '#005CA9', PODE: '#00d663',
    PSC: '#006f41', PCDOB: '#800314', PV: '#01652F', REDE: '#3ca08c',
    CIDADANIA: '#ec008c', SOLIDARIEDADE: '#f37021', AVANTE: '#2eacb2',
    NOVO: '#ec671c', PRTB: '#245ba0', PMN: '#CF7676', DC: '#c89721',
    PSTU: '#c92127', PCO: '#9F030A', UP: '#000000', PCB: '#a8231c',
    AGIR: '#316635', MOBILIZA: '#DD3333', PRD: '#007c3c', PTB: '#005533'
  };
  const CINZA = '#94a3b8';

  function cor(sigla) {
    return CORES[String(sigla || '').toUpperCase().replace(/\s+/g, '')] || CINZA;
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

  async function malha(uf) {
    const sigla = String(uf).toUpperCase();
    if (_malhas[sigla]) return _malhas[sigla];
    try {
      const r = await fetch(`resultados_geo/municipios/municipios_${sigla}.geojson`);
      if (!r.ok) return null;
      _malhas[sigla] = await r.json();
      return _malhas[sigla];
    } catch (e) {
      console.warn('[apuracao] malha indisponível', sigla, e);
      return null;
    }
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
          nome: d.nome || sq,
          urna: d.urna || d.nome || sq,
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

  /* ------------------------------------------------- projeção de geometria */

  /* Constrói paths SVG a partir de um GeoJSON, em projeção equiretangular
     corrigida pelo cosseno da latitude média — a mesma que o mapa do portal
     usa. Devolve {paths:[{chave,d}], w, h}.

     Simplificação Douglas-Peucker antes de projetar: a malha de MG tem 1,4 MB
     de coordenadas e o navegador não precisa de nada disso num mapa de 700px. */
  function projetar(geojson, chaveDe, tolerancia) {
    if (!geojson || !geojson.features) return null;
    const tol = tolerancia == null ? 0.0006 : tolerancia;

    let mnx = 180, mxx = -180, mny = 90, mxy = -90;
    const varrer = (anel) => anel.forEach(([x, y]) => {
      if (x < mnx) mnx = x; if (x > mxx) mxx = x;
      if (y < mny) mny = y; if (y > mxy) mxy = y;
    });
    const aneisDe = (g) => (g.type === 'Polygon' ? [g.coordinates]
      : g.type === 'MultiPolygon' ? g.coordinates : []);
    geojson.features.forEach((f) => aneisDe(f.geometry).forEach((p) => p.forEach(varrer)));
    if (mnx > mxx) return null;

    const k = Math.cos(((mny + mxy) / 2) * Math.PI / 180) || 1;
    const larguraGeo = (mxx - mnx) * k;
    const alturaGeo = (mxy - mny);
    const W = 1000;
    const H = Math.max(1, Math.round(W * alturaGeo / larguraGeo));
    const px = (x, y) => [((x - mnx) * k) / larguraGeo * W, (mxy - y) / alturaGeo * H];

    const dist2 = (p, a, b) => {
      let x = a[0], y = a[1];
      const dx = b[0] - x, dy = b[1] - y;
      if (dx || dy) {
        const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
      }
      return (p[0] - x) ** 2 + (p[1] - y) ** 2;
    };
    const dp = (pts, t) => {
      if (pts.length <= 3) return pts;
      let mx = 0, idx = 0; const fim = pts.length - 1;
      for (let i = 1; i < fim; i++) {
        const d = dist2(pts[i], pts[0], pts[fim]);
        if (d > mx) { idx = i; mx = d; }
      }
      if (mx > t) return dp(pts.slice(0, idx + 1), t).slice(0, -1).concat(dp(pts.slice(idx), t));
      return [pts[0], pts[fim]];
    };

    const paths = [];
    geojson.features.forEach((f) => {
      let d = '';
      aneisDe(f.geometry).forEach((poly) => poly.forEach((anel) => {
        if (anel.length < 4) return;
        const s = dp(anel, tol);
        if (s.length < 4) return;
        d += 'M' + s.map((c) => {
          const [X, Y] = px(c[0], c[1]);
          return X.toFixed(1) + ' ' + Y.toFixed(1);
        }).join(' ') + 'Z';
      }));
      if (d) paths.push({ chave: chaveDe(f), nome: f.properties && (f.properties.NM_MUN || f.properties.NM_UF), d });
    });
    return { paths, w: W, h: H };
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
      .filter(([, c]) => !alvo || String(c.uf).toUpperCase() === alvo)
      .map(([sq, c]) => ({
        chave: sq,
        nome: c.nome || c.urna,
        urna: c.urna || c.nome,
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
    cor, fmt, snapshot, malha, ranking, lider, agregar, projetar,
    candidaturas, rankingZerado, fotosDisponiveis, temFoto,
    simulado, carimbo
  };
})();
