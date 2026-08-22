// ===================== APURACAO AO VIVO =====================
//
// Le os snapshots produzidos por scripts/apuracao/coleta.py e desenha o mapa
// nacional (27 UFs) com drill-down municipal, mais o painel de andamento e a
// votacao por candidato.
//
// Nao fala com o TSE diretamente: quem baixa os ~28 mil arquivos de resultado
// e o agregador, que publica um JSON por camada. O navegador faz 1 requisicao
// por camada em vez de 5.569 — e o limite de 100 req/s por IP do TSE deixa de
// ser problema de quem visita a pagina.
//
// Do sistema do site reaproveita o motor de mapa (MLCompat.GeoLayer), a paleta
// partidaria (colorForParty) e o CSS. Nao carrega o resto do visualizador: as
// rotinas de map-render.js dependem do estado do app (filtros, selecao, swing,
// modo locais) que aqui nao existe.

const PARAMS = new URLSearchParams(location.search);

// Codigos das duas eleicoes das Gerais 2026. Cada turno e uma eleicao propria no
// TSE, com codigo divulgado as vesperas — rode
// `python scripts/apuracao/coleta.py --listar` para ler do ele-c.json.
const ELEICAO_1T = '';
const ELEICAO_2T = '';

// Branch orfa que o workflow .github/workflows/apuracao.yml publica.
const PUBLICADO = 'https://raw.githubusercontent.com/Franzisquin/Observatorio/apuracao-data/';

// Enquanto nao ha eleicao de verdade, a pagina abre no ensaio de 2022
// (scripts/apuracao/simular2022.py). Os snapshots do ensaio vem marcados com
// fase "s", entao o selo fica amarelo escrito SIMULADO. Preenchido o
// ELEICAO_1T acima, o ensaio sai de cena sozinho.
const ENSAIO = { base: 'scratch/apuracao/2022/', eleicoes: { 1: '544', 2: '545' } };

const emEnsaio = !ELEICAO_1T && !PARAMS.get('eleicao');

// Eleicao por turno. Com ?eleicao= na URL manda a URL, e o seletor de turno some.
const ELEICOES = PARAMS.get('eleicao')
  ? { 1: PARAMS.get('eleicao'), 2: '' }
  : (emEnsaio ? ENSAIO.eleicoes : { 1: ELEICAO_1T, 2: ELEICAO_2T });

const FONTE = {
  // Para apontar para outra saida local:
  // ?dados=scratch/apuracao/oficial/&eleicao=619&cargo=0011&uf=mg
  base: PARAMS.get('dados') || (emEnsaio ? ENSAIO.base : PUBLICADO),
  eleicao: ELEICOES[1],
  cargo: PARAMS.get('cargo') || '0001',
  uf: (PARAMS.get('uf') || '').toLowerCase(),
  intervalo: Number(PARAMS.get('intervalo') || 45) * 1000
};

// 2026 e eleicao geral: nao ha prefeito nem vereador na cedula. O coletor
// continua sabendo ler cargo municipal — e o que permite ensaiar a pagina
// inteira contra os dados reais de 2024, que seguem no CDN do TSE.
const CARGOS_GERAIS = [
  { cd: '0001', nome: 'Presidente' },
  { cd: '0003', nome: 'Governador' },
  { cd: '0005', nome: 'Senador' },
  { cd: '0006', nome: 'Dep. Federal' },
  { cd: '0007', nome: 'Dep. Estadual' }
];
// Prefeito e vereador sao disputas municipais: somar os votos de municipios
// diferentes daria um "ranking estadual" de candidatos que nunca concorreram
// entre si. Nesses cargos so agregam secoes, eleitorado, brancos e nulos.
const CARGOS_MUNICIPAIS = new Set(['0011', '0013']);

// Deputado e vereador: o snapshot traz voto por partido, nao por candidato (ver
// scripts/apuracao/coleta.py).
const CARGOS_PROPORCIONAIS = new Set(['0006', '0007', '0008', '0013']);
const NOMES_CARGO = {
  '0001': 'Presidente', '0003': 'Governador', '0005': 'Senador', '0006': 'Dep. Federal',
  '0007': 'Dep. Estadual', '0008': 'Dep. Distrital', '0011': 'Prefeito', '0013': 'Vereador'
};

const UF_NOMES = {
  AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapá', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
  MG: 'Minas Gerais', MS: 'Mato Grosso do Sul', MT: 'Mato Grosso', PA: 'Pará',
  PB: 'Paraíba', PE: 'Pernambuco', PI: 'Piauí', PR: 'Paraná', RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte', RO: 'Rondônia', RR: 'Roraima', RS: 'Rio Grande do Sul',
  SC: 'Santa Catarina', SE: 'Sergipe', SP: 'São Paulo', TO: 'Tocantins'
};

const NACIONAL_GEOJSON = `${DATA_BASE_URL}estados_brasil.geojson`;

// `map` ja e declarado em globals.js (let map, ...): aqui so se atribui, senao
// o navegador aborta o script inteiro com "Identifier 'map' has already been declared".
let camada = null;
let timer = null;

const apu = {
  cargo: FONTE.cargo,
  turno: '1',
  escopo: 'br',        // 'br' = mapa de estados; sigla da UF = mapa de municipios
  br: null,            // snapshot Brasil
  uf: null,            // snapshot das 27 UFs
  mun: {},             // snapshot municipal por UF, sob demanda
  malhas: {},          // geojson por UF, memorizado
  selecionado: null    // codigo da abrangencia aberta no painel da direita
};

// ---------------------------------------------------------------- dados

// O CDN do GitHub entrega ate 5 minutos de atraso; a querystring por faixa de
// 30s troca a URL a cada meio minuto e forca a revalidacao sem quebrar o cache
// entre visitantes que chegam na mesma faixa.
function comCacheBust(url) {
  return `${url}?t=${Math.floor(Date.now() / 30000)}`;
}

async function baixarSnapshot(sufixo) {
  const url = comCacheBust(`${FONTE.base}${FONTE.eleicao}-${apu.cargo}-${sufixo}.json`);
  try {
    const resposta = await fetch(url, { cache: 'no-cache' });
    if (!resposta.ok) return null;
    return await resposta.json();
  } catch (erro) {
    console.warn('[apuracao] falha ao ler', url, erro);
    return null;
  }
}

async function malhaMunicipal(uf) {
  const sigla = uf.toUpperCase();
  if (apu.malhas[sigla]) return apu.malhas[sigla];
  for (const url of [`${DATA_BASE_URL}municipios_hd/municipios_${sigla}.geojson`,
                     `${DATA_BASE_URL}municipios/municipios_${sigla}.geojson`]) {
    try {
      const resposta = await fetch(url);
      if (!resposta.ok) continue;
      apu.malhas[sigla] = await resposta.json();
      return apu.malhas[sigla];
    } catch (erro) {
      console.warn('[apuracao] malha indisponivel', url, erro);
    }
  }
  return null;
}

// ---------------------------------------------------------------- leitura

// Votos por candidato ordenados. O percentual sai sobre votos validos, que e a
// mesma base do pvap do TSE — nada aqui recalcula o dado, so o apresenta.
function ranking(entrada, dicionario) {
  // Cargo proporcional nao vem por candidato (seriam 50 mil nomes por volta):
  // a disputa que o mapa e o painel mostram e a dos partidos.
  if (entrada?.part) return rankingPartidario(entrada);
  if (!entrada?.cand) return [];
  const validos = entrada.vv || 0;
  return Object.entries(entrada.cand)
    .map(([sq, votos]) => {
      const meta = dicionario?.[sq] || {};
      return {
        sq,
        votos,
        pct: validos > 0 ? (votos / validos) * 100 : 0,
        nome: meta.urna || meta.nome || `Candidato ${sq}`,
        partido: meta.partido || '',
        cor: colorForParty(meta.partido || '')
      };
    })
    .sort((a, b) => b.votos - a.votos);
}

function rankingPartidario(entrada) {
  const validos = entrada.vv || 0;
  return Object.entries(entrada.part)
    .map(([sigla, votos]) => ({
      sq: sigla,
      votos,
      pct: validos > 0 ? (votos / validos) * 100 : 0,
      nome: sigla,
      partido: '',
      cor: colorForParty(sigla)
    }))
    .sort((a, b) => b.votos - a.votos);
}

function lider(entrada, dicionario) {
  const lista = ranking(entrada, dicionario);
  if (!lista.length || !lista[0].votos) return null;
  const margem = lista.length > 1
    ? (lista[0].votos - lista[1].votos) / Math.max(entrada.vv || 1, 1) * 100
    : 100;
  return { ...lista[0], margem };
}

function dicionarioDoEscopo() {
  if (apu.escopo === 'br') return apu.br?.cand || apu.uf?.cand || {};
  // Governador/senador vem do arquivo de UF; prefeito, do pacote municipal.
  return apu.uf?.cand || apu.mun[apu.escopo]?.cand || {};
}

function entradaDoEscopo() {
  const somavel = !CARGOS_MUNICIPAIS.has(apu.cargo);
  if (apu.escopo === 'br') {
    return apu.br?.abr?.br || agregar(Object.values(apu.uf?.abr || {}), somavel);
  }
  return apu.uf?.abr?.[apu.escopo]
    || agregar(Object.values(apu.mun[apu.escopo]?.abr || {}), somavel);
}

// Soma de abrangencias filhas, para quando o nivel de cima nao tem arquivo
// proprio: prefeito nao existe em abrangencia UF nem BR, e presidente so ganha
// arquivo BR quando a divulgacao e liberada. Somar o que o TSE publicou nao e
// alterar conteudo — e a mesma agregacao que o mapa ja faz para colorir.
function agregar(entradas, somarCandidatos = true) {
  if (!entradas.length) return null;
  const total = { st: 0, ts: 0, tv: 0, vv: 0, vb: 0, vn: 0, te: 0, comp: 0, abst: 0, cand: {} };
  entradas.forEach((entrada) => {
    ['st', 'ts', 'tv', 'vv', 'vb', 'vn', 'te', 'comp', 'abst'].forEach((campo) => {
      total[campo] += entrada[campo] || 0;
    });
    // Votos de partido somam entre municipios da mesma UF (deputado estadual) e
    // entre UFs (deputado federal): e sempre o mesmo partido concorrendo.
    Object.entries(entrada.part || {}).forEach(([sigla, votos]) => {
      total.part = total.part || {};
      total.part[sigla] = (total.part[sigla] || 0) + votos;
    });
    if (!somarCandidatos) return;
    Object.entries(entrada.cand || {}).forEach(([sq, votos]) => {
      total.cand[sq] = (total.cand[sq] || 0) + votos;
    });
  });
  total.dv = entradas.every((e) => e.dv !== 'n') ? 's' : 'n';
  total.dt = entradas[0].dt;
  // O carimbo do agregado e o da totalizacao mais recente entre os filhos.
  total.ht = entradas.map((e) => e.ht).filter(Boolean).sort().pop() || '';
  return total;
}

// ---------------------------------------------------------------- painel

// Nome do TSE vem em caixa alta. O visualizador mostra em caixa de titulo; aqui
// basta a versao curta (ui-helpers.js, que tem o toTitleCase completo, instala
// um DOMContentLoaded do visualizador e nao pode ser carregado nesta pagina).
const MINUSCULAS = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'em', 'na', 'no', 'nas', 'nos']);

function titulo(texto) {
  return String(texto || '').toLowerCase().split(/\s+/)
    .map((palavra, i) => (i > 0 && MINUSCULAS.has(palavra))
      ? palavra
      : palavra.charAt(0).toUpperCase() + palavra.slice(1))
    .join(' ');
}

// Abrangencia em foco: municipio clicado > UF aberta > Brasil.
function nomeDoFoco() {
  if (apu.selecionado && apu.escopo !== 'br') {
    return apu.mun[apu.escopo]?.mun?.[apu.selecionado]?.nm
      ? titulo(apu.mun[apu.escopo].mun[apu.selecionado].nm)
      : 'Município';
  }
  if (apu.escopo !== 'br') return UF_NOMES[apu.escopo.toUpperCase()] || apu.escopo.toUpperCase();
  return 'Brasil';
}

function entradaEmFoco() {
  if (apu.selecionado && apu.escopo !== 'br') {
    return apu.mun[apu.escopo]?.abr?.[apu.selecionado] || null;
  }
  return entradaDoEscopo();
}

function dicionarioEmFoco() {
  if (apu.selecionado && apu.escopo !== 'br') {
    return apu.mun[apu.escopo]?.cand || dicionarioDoEscopo();
  }
  return dicionarioDoEscopo();
}

// Mesma tabela do visualizador (js/results-panel.js): swatch, nome em caixa de
// titulo, mini-barra, partido, votos e percentual.
function tabelaCandidatos(lista) {
  const linhas = lista.map((item) => {
    const eleito = item.pct >= 50 || item.destaque;
    const selo = eleito ? `<span class="cand-check-circle" style="background-color:${item.cor}">✔</span>` : '';
    return `
      <tr>
        <td class="color-bar-td">
          <span class="cand-color-bar" style="background-color:${item.cor}"></span>
        </td>
        <td class="align-left">
          <div class="cand-name-container">${selo}<span class="cand-name-text">${escapeHtml(titulo(item.nome))}</span></div>
          <div class="cand-mini-bar-wrap">
            <div class="cand-mini-bar" style="width:${Math.min(100, Math.max(0, item.pct))}%;background-color:${item.cor}"></div>
          </div>
          ${item.partido ? `<div class="cand-partido-text">${escapeHtml(item.partido)}</div>` : ''}
        </td>
        <td class="align-center cand-votes-text">${fmtInt(item.votos)}</td>
        <td class="align-center pct-text">${item.pct.toFixed(2).replace('.', ',')}%</td>
      </tr>`;
  }).join('');

  return `
    <table class="cand-table">
      <thead>
        <tr>
          <th class="color-bar-td"></th>
          <th class="align-left">${CARGOS_PROPORCIONAIS.has(apu.cargo) ? 'Partido' : 'Candidato'}</th>
          <th class="align-center">Votos</th>
          <th class="align-center">Pct.</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>`;
}

function pintarResultados() {
  const entrada = entradaEmFoco();
  const dicionario = dicionarioEmFoco();
  const nome = nomeDoFoco();
  const cargo = NOMES_CARGO[apu.cargo] || '';
  document.getElementById('resultsTitle').textContent = `${nome} — ${cargo}`;

  const alvo = document.getElementById('resultsContent');
  const legenda = document.getElementById('resultsSubtitle');

  if (!entrada) {
    legenda.textContent = 'sem dados publicados';
    alvo.innerHTML = CARGOS_MUNICIPAIS.has(apu.cargo) && apu.escopo !== 'br' && !apu.selecionado
      ? `<div class="apu-vazio">${cargo} é uma disputa por município: clique em um município no mapa.</div>`
      : '<div class="apu-vazio">Aguardando o início da apuração.</div>';
    return;
  }

  const apurado = entrada.ts > 0 ? (entrada.st / entrada.ts) * 100 : 0;
  const turno = apu.turno === '2' ? '2º turno' : '1º turno';
  legenda.textContent = `${turno} · ${apurado.toFixed(2).replace('.', ',')}% das seções`
    + (entrada.ht ? ` · TSE ${entrada.ht}` : '');

  const lista = ranking(entrada, dicionario);
  alvo.innerHTML = lista.length
    ? tabelaCandidatos(lista.map((item, i) => ({ ...item, destaque: i === 0 && entrada.tf === 's' })))
    : '<div class="apu-vazio">Nenhum voto totalizado ainda.</div>';
}

function pintarAndamento() {
  const entrada = entradaEmFoco();
  const barra = document.getElementById('barraApurada');
  const pct = document.getElementById('pctApurado');
  const secoes = document.getElementById('secoesApuradas');
  const aviso = document.getElementById('avisoDivulgacao');

  document.getElementById('btnScopeBack').classList.toggle('hidden', apu.escopo === 'br' && !apu.selecionado);
  document.getElementById('btnScopeBackLabel').textContent = apu.selecionado
    ? (UF_NOMES[apu.escopo.toUpperCase()] || apu.escopo.toUpperCase())
    : 'Brasil';

  if (!entrada) {
    barra.style.width = '0%';
    pct.textContent = '—';
    secoes.textContent = 'sem dados publicados';
    document.getElementById('participacao').innerHTML = '';
    document.getElementById('secaoBancada').classList.add('section-hidden');
    aviso.classList.add('hidden');
    return;
  }

  const apurado = entrada.ts > 0 ? (entrada.st / entrada.ts) * 100 : 0;
  barra.style.width = `${apurado}%`;
  pct.textContent = `${apurado.toFixed(2).replace('.', ',')}%`;
  secoes.textContent = `${fmtInt(entrada.st)} de ${fmtInt(entrada.ts)} seções`;

  // Antes das 17h de Brasilia o TSE zera a votacao de Presidente (campo dv=n).
  // Zero aqui nao e resultado, e embargo — dizer isso evita a leitura errada.
  if (entrada.dv === 'n') {
    aviso.textContent = 'Votação de Presidente sob embargo do TSE até as 17h (horário de Brasília). '
      + 'Os números só passam a ser divulgados a partir desse horário.';
    aviso.classList.remove('hidden');
  } else {
    aviso.classList.add('hidden');
  }

  pintarBancada();

  const comparecimento = entrada.te > 0 ? (entrada.comp / entrada.te) * 100 : 0;
  document.getElementById('participacao').innerHTML = `
    ${celula('Comparecimento', fmtInt(entrada.comp), `${comparecimento.toFixed(1).replace('.', ',')}%`)}
    ${celula('Abstenção', fmtInt(entrada.abst), entrada.te ? `${(100 - comparecimento).toFixed(1).replace('.', ',')}%` : '')}
    ${celula('Brancos', fmtInt(entrada.vb), pctDe(entrada.vb, entrada.tv))}
    ${celula('Nulos', fmtInt(entrada.vn), pctDe(entrada.vn, entrada.tv))}`;
}

function pintarPainelEsquerdo() {
  pintarAndamento();
  pintarResultados();
}

// Deputado federal nao tem arquivo de abrangencia Brasil no TSE — so por UF.
// A bancada nacional e a soma das 27, agrupada pela composicao (as federacoes
// sao nacionais, entao "PT/PC do B/PV" e a mesma agremiacao em toda UF).
function bancadaNacional() {
  const porUf = apu.uf?.agrem;
  if (!porUf) return null;
  const junto = {};
  Object.values(porUf).flat().forEach((a) => {
    const chave = a.com || a.nm;
    junto[chave] = junto[chave] || { nm: a.nm, com: chave, tp: a.tp, vag: 0, v: 0 };
    junto[chave].vag += a.vag || 0;
    junto[chave].v += a.v || 0;
  });
  return Object.values(junto).sort((a, b) => b.vag - a.vag || b.v - a.v);
}

// Vagas por agremiacao, como o TSE publica: numa federacao ou coligacao a
// cadeira e do bloco. Repartir entre os partidos seria conta nossa, nao dado
// do TSE — e o art. 267 par. 4 veda alterar o conteudo distribuido.
function pintarBancada() {
  const secao = document.getElementById('secaoBancada');
  const lista = apu.escopo === 'br'
    ? (apu.br?.agrem || bancadaNacional())
    : apu.uf?.agrem?.[apu.escopo];

  if (!lista?.length) {
    secao.classList.add('section-hidden');
    return;
  }
  secao.classList.remove('section-hidden');
  const totalVagas = lista.reduce((soma, a) => soma + (a.vag || 0), 0);
  document.getElementById('bancada').innerHTML = lista
    .filter((a) => a.vag > 0 || a.v > 0)
    .slice(0, 20)
    .map((a) => `
      <div class="apu-banc-linha">
        <span class="apu-banc-cor" style="background:${colorForParty(a.com.split('/')[0])}"></span>
        <span class="apu-banc-nome" title="${escapeAttribute(a.nm)}">${escapeHtml(a.com)}</span>
        <span class="apu-banc-votos">${fmtInt(a.v)}</span>
        <strong class="apu-banc-vagas">${a.vag || 0}</strong>
      </div>`).join('')
    + `<div class="apu-banc-rodape">${totalVagas} vagas atribuídas até agora</div>`;
}

function celula(rotulo, valor, nota) {
  return `<div class="apu-celula"><span class="apu-rot">${rotulo}</span>
    <strong>${valor}</strong><span class="muted">${nota || ''}</span></div>`;
}

function pctDe(parte, total) {
  if (!total) return '';
  return `${((parte / total) * 100).toFixed(2).replace('.', ',')}%`;
}

function pintarSelo() {
  const entrada = entradaDoEscopo();
  const selo = document.getElementById('selo');
  if (!entrada) { selo.textContent = 'aguardando dados'; return; }
  // Carimbo do TSE (dt/ht = hora da totalizacao), nao a hora do navegador: e o
  // que diz de quando o numero na tela realmente e.
  const cabecalho = (apu.escopo === 'br' ? (apu.br || apu.uf) : apu.mun[apu.escopo])?.meta;
  const fase = cabecalho?.f === 's' ? ' · SIMULADO' : '';
  selo.textContent = `TSE ${entrada.dt || ''} ${entrada.ht || ''}${fase}`;
  selo.classList.toggle('apu-simulado', !!fase);
}

// ---------------------------------------------------------------- mapa

function estiloDaArea(codigo, entrada, dicionario) {
  const topo = entrada ? lider(entrada, dicionario) : null;
  if (!topo) {
    return { fillColor: '#888888', fillOpacity: 0.15, color: '#ffffff', weight: 0.3, opacity: 0.5 };
  }
  // Mesma paleta do visualizador: getMarginAdjustedColor (js/utils.js) clareia a
  // cor do partido conforme a disputa aperta, em vez de mexer na opacidade.
  // Chamar a funcao do site, e nao imitar a escala, mantem os dois mapas iguais
  // quando ela for ajustada.
  return {
    fillColor: getMarginAdjustedColor(topo.cor, topo.margem, topo.pct),
    fillOpacity: 0.78,
    color: '#ffffff',
    weight: codigo === apu.selecionado ? 1.6 : 0.3,
    opacity: codigo === apu.selecionado ? 1 : 0.55
  };
}

function balao(nome, entrada, dicionario) {
  if (!entrada) return `<strong>${escapeHtml(nome)}</strong><br><span>sem dados</span>`;
  const lista = ranking(entrada, dicionario).slice(0, 3);
  const apurado = entrada.ts > 0 ? (entrada.st / entrada.ts) * 100 : 0;
  return `<strong>${escapeHtml(nome)}</strong>
    <div style="opacity:.7;margin:2px 0 4px">${apurado.toFixed(1).replace('.', ',')}% apurado</div>
    ${lista.map((c) => `<div><span style="color:${c.cor}">■</span> ${escapeHtml(c.nome)}
      <b>${c.pct.toFixed(1).replace('.', ',')}%</b></div>`).join('')}`;
}

function trocarCamada(features, opcoes) {
  if (camada) camada.remove();
  camada = new MLCompat.GeoLayer(map, { id: 'apuracao', type: 'polygon', hover: true, ...opcoes });
  camada.setFeatures(features);
  camada.addTo(map);
  return camada;
}

async function desenharBrasil() {
  const resposta = await fetch(NACIONAL_GEOJSON);
  const geo = await resposta.json();
  const dicionario = apu.uf?.cand || {};

  trocarCamada(geo.features, {
    styleFn: (f) => {
      const uf = String(f.properties?.SIGLA_UF || '').toLowerCase();
      return estiloDaArea(uf, apu.uf?.abr?.[uf], dicionario);
    },
    tooltipFn: (f) => {
      const uf = String(f.properties?.SIGLA_UF || '').toLowerCase();
      return balao(f.properties?.NM_UF || uf.toUpperCase(), apu.uf?.abr?.[uf], dicionario);
    },
    onClick: (f) => abrirUF(String(f.properties?.SIGLA_UF || '').toLowerCase())
  });
  MLCompat.fitMapToBounds(map, camada.getBounds(), { padding: [20, 20], animate: false });
}

async function desenharMunicipios(uf) {
  const [malha] = await Promise.all([malhaMunicipal(uf)]);
  if (!malha) { console.warn('[apuracao] sem malha para', uf); return; }
  const pacote = apu.mun[uf];
  const porIbge = {};
  Object.entries(pacote?.mun || {}).forEach(([cd, meta]) => {
    if (meta.ibge) porIbge[String(meta.ibge)] = cd;
  });

  const codigoDe = (f) => porIbge[String(f.properties?.CD_MUN || f.properties?.codarea || '')];

  trocarCamada(malha.features, {
    styleFn: (f) => {
      const cd = codigoDe(f);
      return estiloDaArea(cd, pacote?.abr?.[cd], pacote?.cand);
    },
    tooltipFn: (f) => {
      const cd = codigoDe(f);
      return balao(pacote?.mun?.[cd]?.nm || 'Município', pacote?.abr?.[cd], pacote?.cand);
    },
    onClick: (f) => {
      // Clicar num municipio troca o painel da direita para ele, como o
      // visualizador faz — nao abre um segundo painel.
      apu.selecionado = codigoDe(f);
      pintarPainelEsquerdo();
      pintarSelo();
      camada.refresh();
    }
  });
  MLCompat.fitMapToBounds(map, camada.getBounds(), { padding: [20, 20], animate: false });
}

// ---------------------------------------------------------------- fluxo

function carregando(texto) {
  const alvo = document.getElementById('mapLoader');
  alvo.textContent = texto || '';
  alvo.style.display = texto ? '' : 'none';
}

async function abrirUF(uf) {
  if (!uf) return;
  carregando(`Carregando municípios de ${uf.toUpperCase()}...`);
  apu.escopo = uf;
  apu.selecionado = null;
  apu.mun[uf] = await baixarSnapshot(uf) || apu.mun[uf];
  await desenharMunicipios(uf);
  pintarPainelEsquerdo();
  pintarSelo();
  carregando('');
}

// Sobe um nivel: municipio -> UF -> Brasil.
async function subirEscopo() {
  if (apu.selecionado) {
    apu.selecionado = null;
    camada?.refresh();
    pintarPainelEsquerdo();
    pintarSelo();
    return;
  }
  apu.escopo = 'br';
  carregando('Carregando mapa nacional...');
  await desenharBrasil();
  pintarPainelEsquerdo();
  pintarSelo();
  carregando('');
}

// Uma volta de atualizacao: rebaixa so o que esta na tela. Municipios de UFs
// que ninguem abriu nao precisam ser rebaixados a cada ciclo.
async function atualizar() {
  // Sem codigo de eleicao nao ha o que pedir: qualquer URL montada aqui seria
  // 404 a cada 45 segundos. Pinta o estado de espera e sai.
  if (!FONTE.eleicao) {
    pintarPainelEsquerdo();
    pintarSelo();
    return;
  }

  // Cargo municipal nao tem arquivo BR nem UF, e so Presidente tem o BR:
  // pedir os outros seria 404 na certa, a cada volta.
  if (apu.cargo === '0001') apu.br = await baixarSnapshot('br') || apu.br;
  if (!CARGOS_MUNICIPAIS.has(apu.cargo)) apu.uf = await baixarSnapshot('uf') || apu.uf;
  if (apu.escopo !== 'br') {
    apu.mun[apu.escopo] = await baixarSnapshot(apu.escopo) || apu.mun[apu.escopo];
  }
  if (camada) camada.refresh();
  pintarPainelEsquerdo();
  pintarSelo();
}

// Troca de cargo ou de turno: o que estava carregado nao serve mais.
async function trocarRecorte(mudanca) {
  Object.assign(apu, mudanca);
  apu.br = apu.uf = null;
  apu.mun = {};
  apu.selecionado = null;
  montarChips();
  carregando('Carregando...');
  await atualizar();
  await (apu.escopo === 'br' ? desenharBrasil() : desenharMunicipios(apu.escopo));
  carregando('');
}

function montarChips() {
  const cargos = document.getElementById('chipsCargo');
  cargos.innerHTML = CARGOS_GERAIS.map((c) =>
    `<button class="chip-button${c.cd === apu.cargo ? ' active' : ''}" data-cargo="${c.cd}">${c.nome}</button>`
  ).join('');
  cargos.querySelectorAll('[data-cargo]').forEach((botao) => {
    botao.addEventListener('click', () => {
      if (botao.dataset.cargo !== apu.cargo) trocarRecorte({ cargo: botao.dataset.cargo });
    });
  });

  // O 2o turno e outra eleicao no TSE, com codigo proprio. So aparece quando
  // esse codigo existe — em 4/10 nao ha segundo turno para mostrar.
  const turnos = document.getElementById('chipsTurno');
  const segundo = ELEICOES['2'];
  turnos.classList.toggle('section-hidden', !segundo);
  if (!segundo) return;
  turnos.innerHTML = [['1', '1º Turno'], ['2', '2º Turno']].map(([t, rot]) =>
    `<button class="chip-button${t === apu.turno ? ' active' : ''}" data-turno="${t}">${rot}</button>`
  ).join('');
  turnos.querySelectorAll('[data-turno]').forEach((botao) => {
    botao.addEventListener('click', () => {
      if (botao.dataset.turno === apu.turno) return;
      FONTE.eleicao = ELEICOES[botao.dataset.turno];
      trocarRecorte({ turno: botao.dataset.turno });
    });
  });
}

function alternarTema() {
  const claro = document.body.dataset.theme === 'light';
  document.body.dataset.theme = claro ? 'dark' : 'light';
  localStorage.setItem('tema', document.body.dataset.theme);
  MLCompat.setBasemapTheme(map, document.body.dataset.theme);
  MLCompat.refreshThemeColors();
}

async function iniciar() {
  document.body.dataset.theme = localStorage.getItem('tema') || 'dark';

  map = new maplibregl.Map({
    container: 'map',
    style: MLCompat.buildBasemapStyle(document.body.dataset.theme === 'light' ? 'light' : 'dark'),
    center: [-55, -15],
    zoom: 4,
    minZoom: 3,
    dragRotate: false,
    pitchWithRotate: false
  });
  MLCompat.augmentMap(map);
  MLCompat.refreshThemeColors();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  document.getElementById('themeToggle').addEventListener('click', alternarTema);
  document.getElementById('btnScopeBack').addEventListener('click', subirEscopo);
  montarChips();

  carregando('Carregando apuração...');
  await atualizar();

  // Sem arquivo de UF (eleicao municipal, por exemplo) a visao nacional nao
  // existe: abre direto a UF pedida.
  if (!apu.uf?.abr && FONTE.uf) {
    await abrirUF(FONTE.uf);
  } else {
    await desenharBrasil();
  }
  carregando('');

  timer = setInterval(atualizar, FONTE.intervalo);
  document.addEventListener('visibilitychange', () => {
    // Aba escondida nao precisa continuar puxando dado.
    clearInterval(timer);
    if (!document.hidden) {
      atualizar();
      timer = setInterval(atualizar, FONTE.intervalo);
    }
  });
}

document.addEventListener('DOMContentLoaded', iniciar);
