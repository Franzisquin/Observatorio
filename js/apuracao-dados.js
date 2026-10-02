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
     status.json                saúde do plantão, escrita por plantao.py (para quem
                                opera; nenhuma página pública a lê)
   =========================================================================== */
'use strict';

const APU = (function () {

  /* Os snapshots vêm do próprio domínio: o plantão grava no Worker do site
     (worker/apuracao.js), que os guarda no R2 e serve com cache de borda curto. */
  const PUBLICADO = '/dados/';
  const P = new URLSearchParams(location.search);

  /* `?dados=` existe para desenvolvimento, e só aceita caminho relativo, dentro
     da própria origem. Aceitar URL arbitrária fazia a página buscar os snapshots
     de onde o link mandasse: `?dados=https://terceiro/` renderiza números de
     outra pessoa com a marca, o layout e o domínio do site. Numa noite de
     apuração isso é resultado forjado publicado como se fosse nosso — não é
     leitura indevida, é falsificação, e some da barra de endereços. */
  function baseSegura(bruta) {
    if (!bruta) return PUBLICADO;
    /* Recusa "//host" (protocol-relative, que sai do site) e qualquer coisa com
       esquema. */
    if (/^[\w.-]+(\/[\w.-]+)*\/$/.test(bruta) && !bruta.startsWith('//')) return bruta;
    console.warn('[apuracao] origem de dados recusada, usando a publicada:', bruta);
    return PUBLICADO;
  }

  const cfg = {
    base: baseSegura(P.get('dados')),
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
    sc: 'Santa Catarina', se: 'Sergipe', sp: 'São Paulo', to: 'Tocantins',
    /* Nome, e não sigla: o TSE identifica o exterior por `zz`, e sem entrada
       aqui toda tabela caía no `cd.toUpperCase()` e mostrava "ZZ". Isto é só o
       rótulo — quem decide se ele conta como unidade é EXTERIOR, abaixo. */
    zz: 'Exterior'
  };

  /* O exterior é uma abrangência do TSE como qualquer UF — o EA12 o lista junto
     e os votos dele entram no total do país —, mas não é unidade da Federação.
     Onde a tela conta *unidades*, ele fica de fora; onde soma *votos*, entra. */
  const EXTERIOR = 'zz';

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
    /* `**` à direita é como o TSE marca partido inapto: a sigla é a mesma. */
    let k = String(sigla || '').trim().replace(/\*+$/, '').trim().toUpperCase()
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
    /* Maiuscula na primeira letra, mesmo depois de pontuacao no inicio
       ("(GÊMEOS)" -> "(Gêmeos)"), e depois de apostrofo: D'Avila, O'Brien. */
    return palavra.toLowerCase()
      .replace(/^([^\p{L}]*)(\p{L})/u, (_, antes, letra) => antes + letra.toUpperCase())
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

  /* O snapshot muda a cada volta do plantão: nenhum cache do caminho pode
     devolver a versão anterior. O Worker ignora este parâmetro na chave do seu
     cache de borda, que dura poucos segundos. */
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

  /* Quem lidera, ou null enquanto não há voto. Sem esta guarda, município
     ainda sem urna apurada mostrava como "líder" o primeiro de uma lista toda
     em zero — um candidato qualquer, com 0,00%. */
  function lider(entrada, dicionario) {
    if (!entrada || !(entrada.vv > 0)) return null;
    const l = ranking(entrada, dicionario)[0];
    return l && l.votos > 0 ? l : null;
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
    const garantidos = eleitosPelaConta(lista, e, cargo || cfg.cargo, vagas);

    lista.forEach((c, i) => {
      c.oficial = false;
      c.matematico = false;
      if (c.situacao) {
        c.marca = /^eleit/i.test(c.situacao) ? 'eleito'
          : /turno/i.test(c.situacao) ? 'segundo'
            : /suplente/i.test(c.situacao) ? 'suplente' : '';
        c.oficial = !!c.marca;
      } else if (c.eleito) {
        c.marca = segundoTurno ? 'segundo' : 'eleito';
        c.oficial = true;
      } else if (segundoTurno) {
        /* md='s' é o TSE dizendo que o 2º turno está definido: certo, e não
           leitura — a marca sai firme, como a de eleito. */
        c.marca = i < 2 ? 'segundo' : '';
        c.matematico = i < 2;
      } else if (definido) {
        c.marca = i < 1 ? 'eleito' : '';
        c.matematico = i < 1;
      } else if (i < garantidos) {
        c.marca = 'eleito';
        c.matematico = true;
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

  /* Quantos dos primeiros já estão matematicamente eleitos, pela conta: nem
     que todo o eleitorado das seções que faltam totalizar (`esnt`) votasse
     contra, o resultado mudaria. É aritmética sobre o que o TSE publicou, não
     projeção — e cobre o que o `md` do TSE não cobre: o Senado, e o intervalo
     entre a conta fechar e o arquivo trazer o `md`.

     Presidente e governador: maioria absoluta dos válidos. O líder está eleito
     quando já tem mais da metade dos válidos que existiriam se todo o eleitorado
     restante votasse em outro. Senado: maioria simples, por vaga — quem está
     dentro está eleito quando passa o primeiro de fora mais o eleitorado
     restante. Só vale com `esnt`, que só a camada alta traz. */
  function eleitosPelaConta(lista, e, cargo, vagas) {
    if (e.esnt == null || !(e.vv > 0) || !lista.length) return 0;
    const resta = Math.max(0, Number(e.esnt) || 0);
    if (cargo === '0005') {
      const primeiroFora = lista[vagas] ? lista[vagas].votos : 0;
      let n = 0;
      while (n < vagas && n < lista.length && lista[n].votos > primeiroFora + resta) n += 1;
      return n;
    }
    return 2 * lista[0].votos > e.vv + resta ? 1 : 0;
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

  /* --------------------------------------------- comparação com 2022 */

  /* Cada candidatura de 2026 contra a de 2022 com o mesmo número de urna — Lula
     (13) com Lula, Flávio Bolsonaro (22) com Jair. `linha` é a base de
     scripts/apuracao/comparacao_2022.py: [válidos, votos do 1º número, do 2º].
     O percentual de 2026 é o do placar (APU.ranking, sobre `vvc`); o de 2022,
     sobre os válidos, que lá coincidiam. `desvio` é quanto a diferença entre os
     dois andou, em pontos: positivo a favor do 2º número, negativo do 1º. */
  function comparar(entrada, dic, linha, numeros) {
    if (!linha || !(linha[0] > 0)) return null;
    const agora = entrada && entrada.vv ? ranking(entrada, dic) : [];
    const pares = numeros.map((n, i) => {
      const c = agora.find((x) => String(x.numero) === n) || null;
      return { numero: n, c, antes: fmt.parte(linha[i + 1], linha[0]), agora: c ? c.pct : null };
    });
    const [a, b] = pares;
    const desvio = a.agora === null || b.agora === null ? null
      : (b.agora - a.agora) - (b.antes - a.antes);
    return { pares, desvio };
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

  /* Deputados antes do primeiro boletim: os blocos e as listas registrados,
     com 0 voto, no mesmo desenho dos snapshots do coletor (candidatos.py,
     preurna). `nome` é o sufixo do snapshot: 'uf' ou 'lista-sp'. */
  var _preUrna = {};

  async function preUrna(nome, cargo) {
    var k = cargo + '-' + nome;
    if (_preUrna[k] !== undefined) return _preUrna[k];
    try {
      var r = await fetch(`resultados_geo/candidatos_2026/deputados/${k}.json`);
      _preUrna[k] = r.ok ? await r.json() : null;
    } catch (e) {
      _preUrna[k] = null;
    }
    return _preUrna[k];
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

  /* Quem saiu da disputa antes da primeira urna, e por isso não entra na lista
     em zero: não é candidatura sem voto, é ausência.

     Renúncia, cancelamento e falecimento são os casos claros. "Indeferido" e
     "Pedido não conhecido" sozinhos são o registro negado com a decisão já
     firme. O que NÃO entra aqui é "Indeferido em prazo recursal ou com recurso"
     (e o pedido não conhecido sob recurso): esse concorre sub judice, aparece
     na urna e pode receber voto — tirá-lo da tela esconderia candidato que o
     eleitor vai encontrar na hora de votar. Daí a âncora no fim da expressão. */
  var FORA_DA_DISPUTA = /^(Ren[úu]ncia|Indeferido|Cancelado|Falecimento|Pedido n[ãa]o conhecido)\s*$/i;

  /* Ranking de partida: todo mundo em zero. A ordem é alfabética porque, sem
     voto, qualquer outra ordenação sugeriria uma disputa que ainda não houve. */
  function rankingZerado(dicionario, uf) {
    if (!dicionario) return [];
    semearCores(Object.values(dicionario).map((c) => c.partido));
    var alvo = (uf || '').toUpperCase();
    return Object.entries(dicionario)
      .filter(([, c]) => (!alvo || String(c.uf).toUpperCase() === alvo)
        && !FORA_DA_DISPUTA.test(String(c.situacao || '')))
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

  /* ------------------------------------------- deputados: blocos e listas */

  /* Na disputa proporcional a cadeira é do bloco — federação ou partido
     isolado —, e o TSE publica quantas cada um tem (`vag`), recalculadas a cada
     totalização. Quem ocupa essas cadeiras sai da lista aberta do bloco: os mais
     votados dele, de qualquer partido da federação. Isto aqui só lê: o quociente
     e as sobras são do TSE e, enquanto o TSE não distribui as vagas de uma UF,
     da conta do coletor (`cad`, scripts/apuracao/cadeiras.py). */

  const semAsterisco = (s) => String(s || '').replace(/\*+$/, '').trim();

  /* Siglas do bloco, na ordem da composição do TSE ("PT/PC do B/PV"). A
     primeira é a cabeça da federação: é dela a cor e o lugar no espectro. */
  function siglasDoBloco(a) {
    const daComposicao = String(a.com || '').split('/').map(semAsterisco).filter(Boolean);
    const dosPartidos = (a.par || []).map((p) => semAsterisco(p.sg)).filter(Boolean);
    if (a.tp === 'f') {
      /* Composição que não casa com as siglas dos partidos vale menos que a
         lista de partidos: o simulado chegou a mandar o nome da federação ali. */
      const casa = daComposicao.length > 0 && dosPartidos.length > 0
        && daComposicao.every((s) => dosPartidos.includes(s));
      return casa ? daComposicao : (dosPartidos.length ? dosPartidos : daComposicao);
    }
    return dosPartidos.length ? dosPartidos.slice(0, 1) : daComposicao.slice(0, 1);
  }

  /* Federação e partido isolado ficam com a mesma chave em todas as UFs — a
     federação é nacional por lei —, e é ela que soma as bancadas no país. */
  function chaveDoBloco(a, siglas) {
    if (a.tp === 'f') return 'F:' + (a.fed || a.nm || siglas.join('/'));
    return 'P:' + (siglas[0] || a.nm || '');
  }

  /* "Federação Brasil da Esperança - FE BRASIL" -> "BRASIL DA ESPERANÇA": sem o
     "Federação", sem a sigla do fim e em maiúsculas. Nome do qual não sobra
     nada além de número (o simulado manda "FEDERAÇÃO 9995") cai na sigla. */
  function nomeDoBloco(a, siglas) {
    if (a.tp !== 'f') return siglas[0] || a.nm || '';
    /* A composição entre parênteses no fim, como o DivulgaCandContas escreve
       ("FEDERAÇÃO UNIÃO PROGRESSISTA(44-UNIÃO/11-PP)"), sai junto. */
    let nm = String(a.nm || '').trim()
      .replace(/\s*\([^()]*\)\s*$/, '')
      .replace(/\s+-\s+[^-]+$/, '')
      .replace(/^federa[çc][ãa]o\s+/i, '')
      .trim();
    if (!nm || /^\d+$/.test(nm)) return a.fed || siglas.join('/');
    /* Em maiúsculas, como a sigla dos partidos isolados (PL, UNIÃO,
       REPUBLICANOS): numa lista de blocos lado a lado, federação e partido
       se leem no mesmo registro. */
    return nm.toLocaleUpperCase('pt-BR');
  }

  /* Lugar do bloco na régua esquerda -> direita (js/espectro-partidos.js, a
     mesma do visualizador). A cabeça da federação decide; se ela não está na
     régua, vale o primeiro partido do bloco que esteja. */
  function espectroDoBloco(a, siglas) {
    const regua = typeof getPartySpectrumRank === 'function' ? getPartySpectrumRank : null;
    if (!regua) return 999;
    for (const s of siglas) {
      const r = regua(s, 2026);
      if (r < 999) return r;
    }
    return regua(a.fed || a.nm || '', 2026);
  }

  /* O voto que não elege o próprio candidato: anulado, sub judice, ou válido
     só para a legenda. O coletor omite `dvt` quando o voto é simplesmente
     válido, que é o caso de quase todos. */
  const disputaVaga = (c) => !c.dvt || /^v[áa]lido$/i.test(String(c.dvt).trim());

  /* Quem está dentro das vagas do bloco, e com que autoridade.

     OFICIAL — `st` (Eleito por QP, Eleito por média, Suplente, Não eleito) só
     chega na totalização final, e então manda sozinho. `e = 's'` sem `st` é o
     TSE dizendo que o candidato está eleito: também conta como declarado.

     LEITURA — enquanto a contagem corre, as cadeiras do bloco que o TSE ainda
     não atribuiu a ninguém vão, em ordem, aos mais votados que disputam vaga. É
     a regra da lei aplicada ao boletim do momento: muda a cada totalização, e
     por isso a tela a desenha tracejada.

     COMPLETA — com 100% das seções totalizadas, as vagas do TSE (`vag`) já são
     a distribuição dele com todo o voto contado: a leitura delas vem firme,
     mesmo antes da totalização final. Quem chama decide (APU.blocos). */
  function marcarLista(candidatos, vagas, completa) {
    const lista = (candidatos || []).map((c) => ({
      sq: String(c.sq || ''), numero: c.n || '', urna: nomeProprio(c.urna || ''),
      partido: semAsterisco(c.partido), votos: Number(c.v) || 0, seq: Number(c.seq) || 0,
      situacao: c.st || '', declarado: c.e === 's', destino: c.dvt || '',
      semVaga: !disputaVaga(c), marca: '', oficial: false
    })).sort((a, b) => b.votos - a.votos
      || (a.seq || 1e9) - (b.seq || 1e9)
      || a.urna.localeCompare(b.urna, 'pt-BR'));

    const final = lista.some((c) => c.situacao);
    let ocupadas = 0;
    lista.forEach((c) => {
      if (c.situacao) {
        c.marca = /^eleit/i.test(c.situacao) ? 'eleito'
          : /suplente/i.test(c.situacao) ? 'suplente' : 'fora';
        c.oficial = true;
      } else if (c.declarado) {
        c.marca = 'eleito';
        c.oficial = true;
      }
      if (c.marca === 'eleito') ocupadas += 1;
    });

    if (!final) {
      let livres = Math.max(0, (Number(vagas) || 0) - ocupadas);
      lista.forEach((c) => {
        if (c.marca || livres <= 0 || c.semVaga || c.votos <= 0) return;
        c.marca = 'eleito';
        c.oficial = !!completa;
        livres -= 1;
      });
    }
    lista.forEach((c, i) => { c.pos = i + 1; c.dentro = c.marca === 'eleito'; });
    return lista;
  }

  /* Os blocos de uma UF, prontos para a tela. `vv` é a base do percentual:
     votos válidos, nominais mais legenda. */
  function blocos(agrem, entrada) {
    const lista = agrem || [];
    const vv = (entrada && entrada.vv) || lista.reduce((s, a) => s + (Number(a.v) || 0), 0);
    /* Sem vaga nenhuma do TSE na UF, valem as do coletor: a lei aplicada ao
       boletim do momento — 10% do QE no quociente, 80/20 nas sobras, 3ª fase
       aberta a todos pelo STF. Conta do ElectoMaps, e a tela diz isso
       (`estimadas`). */
    const doTSE = lista.some((a) => Number(a.vag) > 0);
    const vagasDe = (a) => Number(doTSE ? a.vag : a.cad) || 0;
    /* 100% das seções totalizadas: as vagas do TSE ficam firmes. As do coletor,
       nunca — eleito, quem distribui é o TSE. */
    const e = entrada || {};
    const completa = doTSE && Number(e.ts) > 0 && Number(e.st) >= Number(e.ts);
    const prontos = lista.map((a) => {
      const siglas = siglasDoBloco(a);
      return {
        chave: chaveDoBloco(a, siglas),
        rotulo: nomeDoBloco(a, siglas),
        federacao: a.tp === 'f',
        siglas,
        partidos: (a.par || []).map((p) => ({
          sigla: semAsterisco(p.sg), nome: p.nm || '',
          votos: (Number(p.vtn) || 0) + (Number(p.vtl) || 0),
          inapto: /\*+$/.test(String(p.sg || ''))
        })),
        espectro: espectroDoBloco(a, siglas),
        vagas: vagasDe(a),
        estimadas: doTSE ? 0 : vagasDe(a),
        votos: Number(a.v) || 0,
        legenda: Number(a.vtl) || 0,
        pct: fmt.parte(Number(a.v) || 0, vv),
        cand: a.cand ? marcarLista(a.cand, vagasDe(a), completa) : null
      };
    });
    /* Cadeiras firmes: os candidatos do bloco com situação oficial ou, sem a
       lista (camada alta), todas as da UF com 100% totalizado. A totalização
       final quem marca é quem chama. */
    prontos.forEach((b) => {
      b.declaradas = b.cand ? b.cand.filter((c) => c.dentro && c.oficial).length
        : (completa ? b.vagas : 0);
    });
    /* Cor reservada em ordem alfabética, pelo mesmo motivo do placar: a paleta
       de sigla nova não pode se remexer quando o ranking vira. */
    semearCores(prontos.map((b) => b.siglas[0]));
    prontos.forEach((b) => { b.cor = cor(b.siglas[0] || b.rotulo); });
    return prontos;
  }

  /* Soma os blocos de várias UFs pela chave: a Câmara inteira, ou as
     Assembleias somadas. `porUF` guarda de onde veio cada cadeira. */
  function somarBlocos(porUF) {
    const soma = new Map();
    Object.entries(porUF || {}).forEach(([uf, lista]) => {
      (lista || []).forEach((b) => {
        const atual = soma.get(b.chave)
          || { ...b, vagas: 0, declaradas: 0, estimadas: 0, votos: 0, legenda: 0, cand: null, porUF: [] };
        atual.vagas += b.vagas;
        atual.declaradas += b.declaradas || 0;
        atual.estimadas += b.estimadas || 0;
        atual.votos += b.votos;
        atual.legenda += b.legenda;
        if (b.vagas || b.votos) atual.porUF.push({ uf, vagas: b.vagas, votos: b.votos });
        soma.set(b.chave, atual);
      });
    });
    const total = Array.from(soma.values()).reduce((s, b) => s + b.votos, 0);
    return Array.from(soma.values()).map((b) => ({ ...b, pct: fmt.parte(b.votos, total) }));
  }

  /* Cláusula de desempenho (EC 97/2017, art. 3º, na regra que vale a partir
     de 2026). Passa quem cumprir um dos dois:
       - eleger ao menos 13 deputados federais, em ao menos 9 UFs (um terço);
       - ou ter ao menos 2,5% dos votos válidos do país para a Câmara, com ao
         menos 1,5% dos válidos em cada uma de 9 UFs ou mais.
     A federação conta como um partido só (Lei 14.208/2021), então a conta é
     por bloco. Sai do que já foi apurado: até a totalização final, é a
     situação do momento, e não o resultado. */
  const CLAUSULA = { cadeiras: 13, ufsCadeira: 9, pct: 2.5, pctUF: 1.5, ufsVoto: 9 };

  function clausulaDeDesempenho(porUF, entradas) {
    const vvPais = Object.values(entradas || {}).reduce((s, e) => s + (Number(e && e.vv) || 0), 0);
    const por = new Map();
    Object.entries(porUF || {}).forEach(([uf, lista]) => {
      const vvUF = Number((entradas[uf] || {}).vv) || 0;
      (lista || []).forEach((b) => {
        const a = por.get(b.chave) || { bloco: b, cadeiras: 0, ufsCadeira: 0, votos: 0, ufsVoto: 0 };
        a.cadeiras += b.vagas;
        if (b.vagas > 0) a.ufsCadeira += 1;
        a.votos += b.votos;
        if (vvUF > 0 && (100 * b.votos) / vvUF >= CLAUSULA.pctUF) a.ufsVoto += 1;
        por.set(b.chave, a);
      });
    });
    return Array.from(por.values()).map((a) => {
      const pct = vvPais ? (100 * a.votos) / vvPais : 0;
      const porCadeiras = a.cadeiras >= CLAUSULA.cadeiras && a.ufsCadeira >= CLAUSULA.ufsCadeira;
      const porVotos = pct >= CLAUSULA.pct && a.ufsVoto >= CLAUSULA.ufsVoto;
      return { ...a, pct, porCadeiras, porVotos, passa: porCadeiras || porVotos };
    }).sort((x, y) => y.votos - x.votos
      || String(x.bloco.rotulo).localeCompare(String(y.bloco.rotulo), 'pt-BR'));
  }

  /* As duas ordens que a tela usa. Listas e quadro: mais cadeiras primeiro,
     voto desempata. Hemiciclo: da esquerda para a direita. */
  const porCadeiras = (a, b) => b.vagas - a.vagas || b.votos - a.votos
    || String(a.rotulo).localeCompare(String(b.rotulo), 'pt-BR');
  const porEspectro = (a, b) => a.espectro - b.espectro || porCadeiras(a, b);

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

  /* ----------------------------------------- cabeçalho de várias UFs */

  /* O cabeçalho do país num cargo estadual (governador, senador, deputado):
     a soma das UFs de `abr`, sem o exterior. Encerrado só quando todas
     encerraram; o carimbo é o da UF totalizada por último. */
  const carimboOrdenavel = (e) => {
    const [d, m, a] = String(e.dt || '').split('/');
    return Number(`${a || 0}${m || 0}${d || 0}${String(e.ht || '').replace(/:/g, '')}`) || 0;
  };

  function cabecalhoDe(abr) {
    const lista = Object.entries(abr || {})
      .filter(([uf, e]) => uf !== EXTERIOR && e).map(([, e]) => e);
    if (!lista.length) return null;
    const soma = agregar(lista);
    const and = lista.every((e) => e.and === 'f') ? 'f'
      : (lista.some((e) => e.and === 'p' || e.and === 'f') ? 'p' : 'n');
    const recente = lista.slice().sort((a, b) => carimboOrdenavel(b) - carimboOrdenavel(a))[0];
    return { ...soma, and, dt: recente.dt, ht: recente.ht, tf: and === 'f' ? 's' : 'n' };
  }

  /* ------------------------------------------------------- governadores */

  /* O retrato dos governos estaduais a partir da camada alta de governador
     ({ele}-0003-uf.json). Por UF, um de quatro estados:
       eleito   o primeiro está eleito com certeza — declarado pelo TSE, ou
                matematicamente (APU.marcar): é o check verde da tela;
       segundo  o 2º turno está definido, pelo TSE (md = 's') ou pela situação;
       lidera   há voto, e ainda não há decisão;
       vazio    nenhum voto apurado.
     Só `eleito` entra na contagem por partido: a eleição declarada. */
  function governos(pacote) {
    const abr = (pacote && pacote.abr) || {};
    const dic = (pacote && pacote.cand) || {};
    const porUF = {};
    const porPartido = new Map();
    Object.keys(UF_NOMES).filter((uf) => uf !== EXTERIOR).forEach((uf) => {
      const e = abr[uf];
      if (!e || !(e.vv > 0)) { porUF[uf] = { estado: 'vazio', entrada: e || null }; return; }
      const lista = marcar(ranking(e, dic), e, '0003');
      const [p, s] = lista;
      const certo = (c) => !!c && !!(c.oficial || c.matematico);
      let situacao = 'lidera';
      if (p && p.marca === 'eleito' && certo(p)) situacao = 'eleito';
      else if (p && s && p.marca === 'segundo' && s.marca === 'segundo' && certo(p) && certo(s)) situacao = 'segundo';
      porUF[uf] = { estado: situacao, entrada: e, lider: p || null, vice: s || null };
      if (situacao === 'eleito') {
        const k = chaveDeCor(p.partido);
        const atual = porPartido.get(k) || { chave: k, sigla: p.partido, cor: cor(p.partido),
          espectro: typeof getPartySpectrumRank === 'function' ? getPartySpectrumRank(p.partido, 2026) : 999,
          eleitos: 0, ufs: [] };
        atual.eleitos += 1;
        atual.ufs.push(uf);
        porPartido.set(k, atual);
      }
    });
    const conta = (s) => Object.values(porUF).filter((u) => u.estado === s).length;
    return {
      porUF,
      porPartido: Array.from(porPartido.values())
        .sort((a, b) => b.eleitos - a.eleitos || a.espectro - b.espectro || a.sigla.localeCompare(b.sigla, 'pt-BR')),
      eleitos: conta('eleito'), segundo: conta('segundo'), lidera: conta('lidera'), vazio: conta('vazio')
    };
  }

  /* ------------------------------------------------------------ Senado */

  /* As 81 cadeiras do Senado em 2026. O terço que não está em disputa são os 27
     eleitos em 2022 (mandato até 2031), com o partido de hoje e, onde o eleito
     saiu, o suplente em exercício (resultados_geo/senado_em_exercicio.json,
     scripts/apuracao/senado_em_exercicio.py). As outras 54 — duas por UF — vão,
     em cada estado onde já há voto, aos dois mais votados do momento; onde não
     há voto, ficam vazias. Firmes só quando o TSE declara o eleito.

     Devolve os blocos do miolo (mantidos) e da periferia (em disputa), no
     formato que APUUI.hemiciclo enche, e o quadro de cadeiras por partido. */
  const SENADO = { total: 81, mantidas: 27, porUF: 2 };

  function senado(emExercicio, pacote, chapa) {
    const regua = typeof getPartySpectrumRank === 'function' ? getPartySpectrumRank : () => 999;
    const blocosDe = () => new Map();
    const miolo = blocosDe();
    const disputa = blocosDe();
    const nomes = new Map();

    /* Sem partido é um senador sem bloco: cinza, e no meio do semicírculo, que
       é onde fica quem não está em nenhum dos lados da régua. */
    const semPartido = (s) => !s || /^s\/?\s*partido$/i.test(String(s).trim()) || /^sem partido$/i.test(s);
    const bloco = (mapa, sigla) => {
      const s = semAsterisco(sigla);
      const sem = semPartido(s);
      const k = sem ? 'SEM PARTIDO' : chaveDeCor(s);
      if (!nomes.has(k)) nomes.set(k, sem ? 'SEM PARTIDO' : s.toUpperCase());
      if (!mapa.has(k)) {
        mapa.set(k, { chave: 'P:' + k, rotulo: nomes.get(k), siglas: [nomes.get(k)], federacao: false,
          cor: sem ? CINZA : cor(s), espectro: sem ? 17.5 : regua(s, 2026),
          vagas: 0, declaradas: 0, votos: null, cand: [] });
      }
      return mapa.get(k);
    };

    ((emExercicio && emExercicio.senadores) || []).forEach((sen) => {
      const b = bloco(miolo, sen.partido);
      b.vagas += 1;
      b.declaradas += 1;
      b.cand.push({ dentro: true, oficial: true, mantido: true, urna: sen.nome, partido: b.rotulo,
        uf: sen.uf, participacao: sen.participacao, ate: sen.ate });
    });

    const abr = (pacote && pacote.abr) || {};
    const dic = (pacote && pacote.cand) || {};
    let ufsComVoto = 0;
    Object.keys(UF_NOMES).filter((uf) => uf !== EXTERIOR).forEach((uf) => {
      const e = abr[uf];
      if (!e || !(e.vv > 0)) return;
      ufsComVoto += 1;
      const lista = marcar(ranking(e, dic), e, '0005');
      lista.slice(0, SENADO.porUF).forEach((c, i) => {
        const b = bloco(disputa, c.partido);
        const oficial = !!c.oficial && c.marca === 'eleito';
        b.vagas += 1;
        if (oficial) b.declaradas += 1;
        b.cand.push({ dentro: true, oficial, urna: c.urna || c.nome, partido: c.partido, uf,
          votos: c.votos, pct: c.pct, pos: i + 1, marca: c.marca, matematico: !!c.matematico });
      });
    });
    /* Dentro do bloco, cadeira firme primeiro e, entre iguais, mais voto. */
    disputa.forEach((b) => b.cand.sort((x, y) => (y.oficial - x.oficial) || (y.votos - x.votos)));
    miolo.forEach((b) => b.cand.sort((x, y) => x.uf.localeCompare(y.uf)));

    /* Quadro: o total de cada partido, mantidas mais em disputa. Antes da
       primeira urna entra também quem só tem candidatura, com zero. */
    const quadro = new Map();
    const somar = (b, campo) => {
      const k = b.chave;
      const q = quadro.get(k) || { chave: k, rotulo: b.rotulo, cor: b.cor, espectro: b.espectro,
        cadeiras: 0, mantidas: 0, disputa: 0 };
      q[campo] += b.vagas;
      q.cadeiras += b.vagas;
      quadro.set(k, q);
    };
    miolo.forEach((b) => somar(b, 'mantidas'));
    disputa.forEach((b) => somar(b, 'disputa'));
    if (!ufsComVoto) {
      Object.values(chapa || {}).forEach((c) => {
        if (/^(Ren[úu]ncia|Indeferido)\s*$/i.test(String(c.situacao || ''))) return;
        const b = bloco(blocosDe(), c.partido);
        if (!quadro.has(b.chave)) {
          quadro.set(b.chave, { chave: b.chave, rotulo: b.rotulo, cor: b.cor, espectro: b.espectro,
            cadeiras: 0, mantidas: 0, disputa: 0 });
        }
      });
    }

    return {
      miolo: Array.from(miolo.values()),
      disputa: Array.from(disputa.values()),
      quadro: Array.from(quadro.values())
        .sort((a, b) => b.cadeiras - a.cadeiras || a.rotulo.localeCompare(b.rotulo, 'pt-BR')),
      ufsComVoto
    };
  }

  return {
    cfg, CARGOS, PROPORCIONAIS, UF_NOMES, ESTAGIOS, EXTERIOR,
    cor, fmt, nomeProprio, snapshot, malha, ranking, lider, agregar,
    candidaturas, preUrna, rankingZerado, fotosDisponiveis, temFoto,
    simulado, carimbo, arquivo, acompanhamento, eleitos,
    bloqueado, definicao, indice, eleicaoDe, segundoTurnoDe,
    marcar, ROTULO_MARCA,
    blocos, somarBlocos, marcarLista, porCadeiras, porEspectro, clausulaDeDesempenho, CLAUSULA,
    comparar, governos, senado, SENADO, cabecalhoDe
  };
})();
