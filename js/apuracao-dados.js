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
   tv/vvc/vv/vb/vn (votos), cand:{sq:votos}. Proporcional troca `cand` por `part`.

   A camada alta (br e uf) vem completa: as três hierarquias do EA20 inteiras —
   seções (ts = st + snt; st = si + sni; si = sa + sna), eleitorado (te = est +
   esnt; est = esi + esni) e votos (tv = vvc + vb + tvn + vscv; vvc = vv + van +
   vansj; vv = vnom + vl; tvn = vn + vnt). Na camada municipal só o essencial:
   por município, o detalhe multiplicaria por 5.569 o arquivo que o navegador
   recarrega. Campo ausente é campo desconhecido — a tela esconde a célula em vez
   de mostrar zero.

   Dois arquivos avulsos, fora do eixo eleição/cargo:
     {ele}-ab.json              EA14 — andamento por UF e estágio dos municípios
     {ele}-{cargo}-eleitos.json EA10 — quem venceu, após a totalização final
     status.json                saúde do plantão, escrita por plantao.py
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
    /* Cadência da recarga. Medido na janela de simulado de 15/09: a camada alta
       do plantão custa 138 requisições e 3 segundos por volta, então ela roda a
       cada 20s; a página acompanha no mesmo passo. O piso de 10s existe para que
       um `?intervalo=` na URL não vire uma enxurrada contra o próprio servidor
       que publica os snapshots. */
    intervalo: Math.max(10, Number(P.get('intervalo') || 20)) * 1000
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

  /* ---------------------------------------------------- cor de sigla nova */

  /* A paleta acima cobre os partidos que existiram. O que ela não cobre —
     federação recém-registrada, partido novo, e as siglas "P 9998" dos dados
     simulados — caía todo no mesmo cinza, e um placar de treze candidaturas
     ficava indistinguível.

     A cor derivada não sai de um hash da sigla: testado contra as 31 siglas do
     simulado de setembro, o hash deixou 23 pares a menos de 15° de matiz e dois
     no mesmo tom. Em vez disso, cada sigla nova recebe o matiz mais distante dos
     já entregues — uma escolha gulosa que mantém a roda de cor bem dividida por
     construção.

     Uma vez atribuída, a cor nunca muda: a atribuição é feita em ordem
     alfabética, e não na ordem do ranking, que se reordena a cada boletim. */
  const _derivadas = new Map();
  const _matizes = [];

  function matizMaisDistante() {
    if (!_matizes.length) return 210;
    let melhor = 0;
    let maiorFolga = -1;
    for (let h = 0; h < 360; h += 2) {
      let folga = 360;
      for (const usado of _matizes) {
        const d = Math.abs(h - usado);
        folga = Math.min(folga, Math.min(d, 360 - d));
      }
      if (folga > maiorFolga) { maiorFolga = folga; melhor = h; }
    }
    return melhor;
  }

  function corDerivada(chave) {
    if (_derivadas.has(chave)) return _derivadas.get(chave);
    const matiz = matizMaisDistante();
    _matizes.push(matiz);
    /* Saturação e luminosidade fixas: a distinção fica por conta do matiz, e o
       contraste continua o mesmo no tema claro e no escuro. Amarelo e verde
       puros ficariam claros demais no claro, então a luminosidade é média. */
    const cor = `hsl(${matiz} 58% 56%)`;
    _derivadas.set(chave, cor);
    return cor;
  }

  function chaveDeCor(sigla) {
    let k = String(sigla || '').trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').replace(/^FEDERACAO /, '');
    return APELIDOS[k] || k;
  }

  function cor(sigla) {
    const k = chaveDeCor(sigla);
    if (!k) return CINZA;
    return CORES[k] || CORES[k.replace(/\s+/g, '')] || corDerivada(k);
  }

  /* Reserva a cor das siglas de um lote, em ordem alfabética. Chamado antes de
     montar qualquer ranking: sem isso a primeira cor sairia para quem estivesse
     na frente naquele boletim, e a paleta inteira se remexeria a cada virada. */
  function semearCores(siglas) {
    Array.from(new Set(siglas.filter(Boolean))).sort().forEach(cor);
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

  /* Qual eleição responde por cada cargo. Em 2026 a eleição geral vem partida
     em duas — uma federal, com presidente e deputado federal, e uma estadual,
     com governador, senador e as assembleias —, e cada uma tem o seu código.
     Uma página que mostra os três cargos ao mesmo tempo não pode depender de um
     código só, então o coletor publica o mapa cargo → eleição em indice.json e
     aqui só se lê. `eleicao=` na URL continua valendo como reserva e como
     override manual. */
  let _indice;

  async function indice() {
    if (_indice !== undefined) return _indice;
    _indice = (await arquivo('indice.json')) || null;
    return _indice;
  }

  function eleicaoDe(cargo) {
    const i = _indice;
    return (i && i.cargos && i.cargos[cargo || cfg.cargo]) || cfg.eleicao || '';
  }

  /* Código do segundo turno da eleição daquele cargo, direto do `cdt2` do TSE. */
  function segundoTurnoDe(cargo) {
    const i = _indice;
    const e = i && i.eleicoes && i.eleicoes[eleicaoDe(cargo)];
    return (e && e.t2) || '';
  }

  async function snapshot(sufixo, cargo) {
    await indice();
    const c = cargo || cfg.cargo;
    const eleicao = eleicaoDe(c);
    if (!eleicao) return null;
    const url = `${cfg.base}${eleicao}-${c}-${sufixo}.json`;
    try {
      const r = await fetch(comBust(url), { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      console.warn('[apuracao] snapshot indisponível', sufixo, e);
      return null;
    }
  }

  /* Snapshot que não segue o padrão eleição-cargo-abrangência: o EA14 de
     acompanhamento, o EA10 de eleitos e o status.json do plantão. */
  async function arquivo(nome) {
    try {
      const r = await fetch(comBust(cfg.base + nome), { cache: 'no-store' });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function acompanhamento(cargo) {
    await indice();
    const e = eleicaoDe(cargo);
    return e ? arquivo(e + '-ab.json') : null;
  }

  async function eleitos(cargo) {
    await indice();
    const c = cargo || cfg.cargo;
    const e = eleicaoDe(c);
    return e ? arquivo(e + '-' + c + '-eleitos.json') : null;
  }

  const saude = () => arquivo('status.json');

  /* ----------------------------------------------- leituras do EA20 */

  /* dv = n: o TSE publica o arquivo presidencial com a votação zerada até a
     liberação das 17h de Brasília (art. 265 §1 da Res. 23.751/2026, para todas
     as unidades e o exterior). Sem nomear a espera, a tela mostra 0,00% e todo
     leitor entende como defeito. */
  const bloqueado = (entrada) => !!entrada && entrada.dv === 'n';

  /* md só existe enquanto não há totalização final, e só para presidente,
     governador e prefeito: 'e' eleito, 's' segundo turno. É o próprio TSE
     dizendo que a conta fechou — não é projeção do site. */
  function definicao(entrada) {
    if (!entrada || entrada.tf === 's') return '';
    return entrada.md === 'e' ? 'e' : (entrada.md === 's' ? 's' : '');
  }

  /* Eleitorado das seções que ainda não foram totalizadas. Comparado à diferença
     entre primeiro e segundo colocado, responde "ainda dá?" com dado do TSE. */
  function faltam(entrada, lista) {
    if (!entrada || entrada.esnt == null) return null;
    const dois = (lista || []).slice(0, 2);
    const diferenca = dois.length > 1 ? dois[0].votos - dois[1].votos : null;
    return { eleitorado: entrada.esnt, secoes: entrada.snt || 0, diferenca,
             alcancavel: diferenca != null && entrada.esnt > diferenca };
  }

  const ESTAGIOS = { n: 'não iniciada', p: 'em andamento', f: 'finalizada' };

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

    /* Proporcional: `part` soma os votos válidos do partido (nominais + legenda),
       então a base é a dos válidos. */
    if (PROPORCIONAIS.has(cfg.cargo)) {
      const validos = entrada.vv || 0;
      semearCores(Object.keys(entrada.part || {}));
      return Object.entries(entrada.part || {})
        .map(([sigla, votos]) => ({
          chave: sigla, nome: sigla, urna: sigla, partido: sigla,
          numero: '', votos, pct: fmt.parte(votos, validos)
        }))
        .sort((a, b) => b.votos - a.votos);
    }

    /* Majoritário: `vap` é voto computado, e a base do pvap que o TSE publica é
       `vvc` — votos a votáveis concorrentes —, não os válidos. As duas coincidem
       enquanto não há voto anulado; quando há, divergem muito. Na suplementar de
       governador de Roraima em 2024, com 160.004 votos anulados sub judice,
       dividir pelos válidos dava 155,58% ao primeiro colocado, contra os 60,87%
       que o TSE divulgou. `vv` fica como reserva para snapshot antigo, sem vvc. */
    const base = entrada.vvc || entrada.vv || 0;
    semearCores(Object.values(dicionario || {}).map((d) => d.partido));

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
          pct: fmt.parte(votos, base),
          /* dvt do TSE: Válido, Válido (legenda), Anulado, Anulado sub judice. O
             art. 265 §2 manda informar a situação do voto, não só o número. */
          destino: d.destino || '',
          eleito: d.eleito === 's',
          situacao: d.situacao || '',
          coligacao: d.coligacao || '',
          federacao: d.federacao || '',
          vice: d.vice || [],
          subs: d.subs || []
        };
      })
      .sort((a, b) => b.votos - a.votos);
  }

  function lider(entrada, dicionario) {
    return ranking(entrada, dicionario)[0] || null;
  }

  /* ------------------------------------------------- eleito e segundo turno */

  /* Quem está eleito, e quem vai ao segundo turno. Duas origens, e a diferença
     entre elas fica visível na tela:

     OFICIAL — o TSE declarou. `st` (situação da totalização) só é preenchido
     quando há totalização final, e `e` marca eleito ou classificado ao segundo
     turno. Enquanto a apuração corre, os dois vêm vazios: medido no simulado de
     15/09, com `md` já em 's', todos os candidatos ainda estavam com `e='n'`.

     DEDUZIDO — a leitura aritmética dos campos que o TSE publica:
       `md='s'`  o próprio tribunal diz que a eleição está matematicamente
                 definida em segundo turno; os dois primeiros são quem vai.
       `md='e'`  definida no primeiro turno; o primeiro está eleito.
       `nv`      vagas do cargo na abrangência. No Senado de 2026 são duas, e com
                 a apuração encerrada elas são dos dois primeiros.

     Deduzir não é alterar o dado — nenhum número publicado muda. Mas a tela
     precisa dizer qual é qual, e por isso `oficial` acompanha a marca. */
  function marcar(lista, entrada, cargo) {
    const e = entrada || {};
    if (PROPORCIONAIS.has(cargo || cfg.cargo)) return lista;

    const vagas = Number(e.nv) || 1;
    const segundoTurno = e.md === 's';
    const definido = e.md === 'e';
    /* snt é o que ainda falta totalizar; pst arredonda para 100,00 antes do fim,
       então quem manda é a contagem de seções, não o percentual. */
    const acabou = e.snt === 0 || e.and === 'f' || e.tf === 's';

    lista.forEach((c, i) => {
      c.oficial = false;
      if (c.situacao) {
        c.marca = /^eleit/i.test(c.situacao) ? 'eleito'
          : /turno/i.test(c.situacao) ? 'segundo'
            : /suplente/i.test(c.situacao) ? 'suplente' : '';
        c.oficial = !!c.marca;
      } else if (c.eleito) {
        c.marca = segundoTurno ? 'segundo' : 'eleito';
        c.oficial = true;
      } else if (segundoTurno) {
        c.marca = i < 2 ? 'segundo' : '';
      } else if (definido) {
        c.marca = i < 1 ? 'eleito' : '';
      } else if (vagas > 1 && acabou) {
        /* Só o Senado cai aqui. Para cargo de vaga única sem `md`, declarar
           vencedor por estar na frente seria projeção — e o TSE ainda não disse. */
        c.marca = i < vagas ? 'eleito' : '';
      } else {
        c.marca = '';
      }
    });
    return lista;
  }

  const ROTULO_MARCA = { eleito: 'Eleito', segundo: '2º turno', suplente: 'Suplente' };

  /* Soma um conjunto de entradas numa só. Serve para compor o total de uma UF
     a partir dos municípios quando o arquivo de UF ainda não chegou. */
  /* Só os campos que a camada municipal também traz. Os da anatomia completa
     ficam de fora de propósito: somar campo ausente daria zero, e zero aqui
     significaria "não houve voto anulado" quando o certo é "não sei". */
  const SOMAVEIS = ['st', 'ts', 'te', 'comp', 'abst', 'tv', 'vvc', 'vv', 'vb', 'vn'];

  function agregar(entradas) {
    const total = { cand: {}, part: {} };
    SOMAVEIS.forEach((c) => (total[c] = 0));
    entradas.forEach((e) => {
      if (!e) return;
      SOMAVEIS.forEach((c) => {
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
    semearCores(Object.values(dicionario).map((c) => c.partido));
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
    cfg, CARGOS, PROPORCIONAIS, UF_NOMES, ESTAGIOS,
    cor, fmt, nomeProprio, snapshot, malha, ranking, lider, agregar,
    candidaturas, rankingZerado, fotosDisponiveis, temFoto,
    simulado, carimbo, arquivo, acompanhamento, eleitos, saude,
    bloqueado, definicao, faltam, indice, eleicaoDe, segundoTurnoDe,
    marcar, ROTULO_MARCA
  };
})();
