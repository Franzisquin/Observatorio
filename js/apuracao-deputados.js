/* ===========================================================================
   ElectoMaps — apuração dos deputados

   Câmara dos Deputados e Assembleias Legislativas. Duas leituras:

     país (sem `uf`)  hemiciclo com a casa inteira — a Câmara, ou as 27 casas
                      estaduais somadas —, quadro por partido e um cartão por
                      estado. Lê {ele}-{cargo}-uf.json, a camada alta.
     estado (`uf`)    hemiciclo das vagas daquela UF e as listas abertas, uma
                      coluna por partido ou federação, nome a nome. Lê
                      {ele}-{cargo}-lista-{uf}.json (coleta.py, lista_aberta).

   As cadeiras de cada bloco são as que o TSE publica (`vag`) e, enquanto ele
   não as distribui numa UF, as da conta do coletor pelas regras de 2026 (`cad`,
   APU.blocos). Quem as ocupa sai da lista do bloco (APU.marcarLista): o que o
   TSE declarou, e as vagas dele com 100% das seções totalizadas, vêm sólidos;
   o resto é projeção, tracejada, e muda a cada boletim. O
   hemiciclo enche da esquerda para a direita pela régua de
   js/espectro-partidos.js; quadro e colunas, por cadeiras e depois votos.

   O Distrito Federal não tem Assembleia: na aba estadual ele mostra a Câmara
   Legislativa, que o TSE publica como cargo 0008.
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);
  const esc = APUUI.esc;

  const UFS = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt',
    'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to'];

  /* Preposição de cada estado, para as frases que precisam dela. */
  const DO = {
    ac: 'do', al: 'de', am: 'do', ap: 'do', ba: 'da', ce: 'do', df: 'do', es: 'do',
    go: 'de', ma: 'do', mg: 'de', ms: 'de', mt: 'de', pa: 'do', pb: 'da', pe: 'de',
    pi: 'do', pr: 'do', rj: 'do', rn: 'do', ro: 'de', rr: 'de', rs: 'do', sc: 'de',
    se: 'de', sp: 'de', to: 'do'
  };

  /* Linhas do quadro antes do "mostrar todos": a cauda de partidos sem cadeira
     é longa, e o que se quer ver de relance são as bancadas. */
  const QUADRO = 12;

  const estado = {
    cargo: '0006',
    uf: '',
    /* Por chave cargo|uf: o último pacote que chegou. Boletim antigo vale mais
       que tela vazia, e trocar de estado e voltar não espera a rede. */
    dados: {},
    /* Quem estava dentro das vagas no boletim anterior, por cargo|uf: é o que
       acende quem acabou de entrar e quem acabou de sair. */
    dentroAntes: {},
    /* Os blocos das colunas na tela, por chave: o balão de cada nome lê daqui. */
    blocosDaLista: new Map(),
    /* A cláusula de desempenho de cada bloco, por chave: o balão das siglas. */
    clausula: new Map(),
    completas: false,
    quadroAberto: false,
    geracao: 0,
    timer: null
  };

  /* ------------------------------------------------------------- endereço */

  function lerEndereco() {
    const q = new URLSearchParams(location.search);
    let cargo = q.get('cargo') || '0006';
    let uf = (q.get('uf') || '').toLowerCase();
    if (cargo === '0008') { cargo = '0007'; uf = 'df'; }
    if (cargo !== '0007') cargo = '0006';
    if (!UFS.includes(uf)) uf = '';
    estado.cargo = cargo;
    estado.uf = uf;
  }

  function endereco(cargo, uf) {
    const q = new URLSearchParams(location.search);
    q.set('cargo', cargo);
    if (uf) q.set('uf', uf); else q.delete('uf');
    return 'apuracao-deputados.html?' + q.toString();
  }

  /* Para as outras páginas da apuração: leva só o que identifica a fonte. */
  function paramsDeFonte(extra) {
    const q = new URLSearchParams();
    const atual = new URLSearchParams(location.search);
    ['eleicao', 'dados'].forEach((k) => { if (atual.get(k)) q.set(k, atual.get(k)); });
    Object.entries(extra || {}).forEach(([k, v]) => q.set(k, v));
    const s = q.toString();
    return s ? '?' + s : '';
  }

  /* O DF na aba estadual é a Câmara Legislativa: outro código de cargo. */
  const cargoEfetivo = () => (estado.cargo === '0007' && estado.uf === 'df' ? '0008' : estado.cargo);
  const chave = () => cargoEfetivo() + '|' + estado.uf;

  function casa(uf) {
    if (estado.cargo === '0006') return 'Câmara dos Deputados';
    if (uf === 'df') return 'Câmara Legislativa';
    return uf ? 'Assembleia Legislativa' : 'Assembleias Legislativas';
  }

  function irPara(cargo, uf, opcoes) {
    const o = opcoes || {};
    if (cargo === estado.cargo && uf === estado.uf) return;
    estado.cargo = cargo;
    estado.uf = uf;
    estado.quadroAberto = false;
    if (o.empurrar !== false) history.pushState({ cargo, uf }, '', endereco(cargo, uf));
    if (o.subir) window.scrollTo({ top: 0, behavior: 'smooth' });
    desenhar();
    atualizar().catch((e) => console.warn('[apuracao] troca falhou', e));
  }

  /* ------------------------------------------------------------ seletores */

  /* Os cinco cargos e a barra de estados, os mesmos das outras páginas da
     apuração (APUUI). Deputado federal e estadual trocam aqui mesmo, sem
     recarregar; presidente, governador e senador levam à página deles. */
  function seletores() {
    APUUI.seletorDeCargo('seletorCargo', estado.cargo, estado.uf);
    APUUI.barraDeUFs('seletorUF', estado.cargo, estado.uf);
  }

  /* ------------------------------------------------------------- leitura */

  /* O país: as UFs do arquivo de camada alta, cada uma com os seus blocos, e a
     soma. Na aba estadual o DF entra pelo arquivo da Câmara Legislativa. */
  function lerPais() {
    const pacotes = [estado.dados[estado.cargo + '|']];
    if (estado.cargo === '0007') pacotes.push(estado.dados['0008|']);
    const entradas = {};
    const porUF = {};
    let meta = null;
    pacotes.filter(Boolean).forEach((p) => {
      meta = meta || p.meta;
      Object.entries(p.abr || {}).forEach(([uf, e]) => {
        if (uf === APU.EXTERIOR || !e) return;
        entradas[uf] = e;
        porUF[uf] = APU.blocos((p.agrem || {})[uf] || [], e);
        /* A camada alta não traz a lista: a UF com totalização final tem as
           cadeiras todas declaradas; antes disso, nenhuma. */
        if (e.tf === 's') porUF[uf].forEach((b) => { b.declaradas = b.vagas; });
      });
    });
    const ufs = Object.keys(entradas);
    if (!ufs.length) return null;

    const lista = ufs.map((u) => entradas[u]);
    const soma = APU.agregar(lista);
    /* Andamento do conjunto: encerrado só quando todas as casas encerraram. */
    const and = lista.every((e) => e.and === 'f') ? 'f'
      : (lista.some((e) => e.and === 'p' || e.and === 'f') ? 'p' : 'n');
    const recente = lista.slice().sort((a, b) => carimboOrdenavel(b) - carimboOrdenavel(a))[0];
    return {
      meta, entradas, porUF,
      blocos: APU.somarBlocos(porUF),
      total: lista.reduce((s, e) => s + (Number(e.nv) || 0), 0),
      cabecalho: { ...soma, and, dt: recente.dt, ht: recente.ht, tf: and === 'f' ? 's' : 'n' }
    };
  }

  function carimboOrdenavel(e) {
    const [d, m, a] = String(e.dt || '').split('/');
    return Number(`${a || 0}${m || 0}${d || 0}${String(e.ht || '').replace(/:/g, '')}`) || 0;
  }

  function lerUF() {
    const p = estado.dados[chave()];
    if (!p || !p.abr) return null;
    const blocos = APU.blocos(p.agrem || [], p.abr);
    return {
      meta: p.meta, entrada: p.abr, blocos,
      total: Number(p.abr.nv) || blocos.reduce((s, b) => s + b.vagas, 0),
      cabecalho: p.abr
    };
  }

  /* ------------------------------------------------------------- desenho */

  function desenhar() {
    seletores();
    const uf = estado.uf;
    const nomeUF = uf ? APU.UF_NOMES[uf] : '';
    const leitura = uf ? lerUF() : lerPais();

    $('brandScope').textContent = estado.cargo === '0006' ? 'Câmara' : 'Assembleias';
    $('titulo').textContent = uf ? nomeUF : casa('');
    document.title = (uf ? `${nomeUF} — ${casa(uf)}` : casa('')) + ' — Apuração — ElectoMaps';
    APUUI.ligarMenu(estado.cargo);
    $('voltar').href = uf ? endereco(estado.cargo, '') : 'apuracao-presidente.html' + paramsDeFonte();
    $('voltarRotulo').textContent = uf ? casa('') : 'Apuração nacional';

    if (!leitura) {
      APUUI.selo(null, null);
      APUUI.progresso(null);
      APUUI.avisos(null, 'avisos');
      $('subtitulo').textContent = uf ? casa(uf) : '';
      $('semDados').hidden = false;
      $('semDadosTitulo').textContent = uf
        ? `Sem boletim ${DO[uf]} ${nomeUF} ainda` : 'A apuração ainda não começou';
      $('semDadosTexto').textContent = uf
        ? 'A lista de cada partido aparece aqui assim que o TSE publicar o primeiro arquivo deste estado.'
        : 'Esta página se liga ao primeiro boletim assim que o TSE publicar os dados da eleição.';
      $('palco').hidden = true;
      $('listas').hidden = true;
      $('estados').hidden = true;
      $('clausula').hidden = true;
      return;
    }

    $('semDados').hidden = true;
    $('palco').hidden = false;
    /* Pré-urna não tem seção nenhuma contada: "0 de 0 seções" diria menos que
       o cabeçalho vazio. */
    const preUrna = !!(leitura.meta && leitura.meta.pre);
    APUUI.selo(leitura.meta, leitura.cabecalho);
    APUUI.progresso(preUrna ? null : leitura.cabecalho);
    APUUI.avisos(preUrna ? null : leitura.cabecalho, 'avisos');

    const distribuidas = leitura.blocos.reduce((s, b) => s + b.vagas, 0);
    if (uf) {
      const e = leitura.entrada;
      $('subtitulo').textContent = casa(uf) + ' · ' + APU.fmt.int(leitura.total) + ' vagas'
        + (e.qe ? ' · quociente eleitoral de ' + APU.fmt.int(e.qe) + ' votos' : '');
    } else {
      const n = Object.keys(leitura.entradas).length;
      $('subtitulo').textContent = estado.cargo === '0006'
        ? `${APU.fmt.int(leitura.total)} cadeiras em ${n} ${n === 1 ? 'estado' : 'estados'}`
        : `${APU.fmt.int(leitura.total)} cadeiras somadas em ${n} ${n === 1 ? 'casa' : 'casas'}`;
    }

    palco(leitura, distribuidas);
    if (uf) {
      listas(leitura);
      $('estados').hidden = true;
      $('clausula').hidden = true;
    } else {
      $('listas').hidden = true;
      estados(leitura);
      clausula(leitura);
    }
  }

  /* ------------------------------------------------ cláusula de desempenho */

  /* Quem passa e quem não passa, com o apurado até aqui: as siglas em linha,
     de cada lado. Passar por um dos dois critérios basta. Só na Câmara: a
     cláusula olha os deputados federais. */
  function clausula(leitura) {
    const secao = $('clausula');
    /* Aparece desde antes da primeira urna: sem voto e sem cadeira ninguém
       cumpre a cláusula, e todos os partidos começam do lado de quem não passa. */
    secao.hidden = estado.cargo !== '0006';
    if (secao.hidden) return;

    const lista = APU.clausulaDeDesempenho(leitura.porUF, leitura.entradas);
    const regra = APU.CLAUSULA;
    estado.clausula = new Map(lista.map((a) => [a.bloco.chave, a]));

    /* A regra por escrito, sem depender do balão, e de quando é a situação. */
    $('regraClausula').textContent = `Passa quem cumprir um dos dois mínimos: eleger `
      + `${regra.cadeiras} deputados federais em ${regra.ufsCadeira} UFs, ou ter `
      + `${APU.fmt.pct(regra.pct)} dos votos válidos do país, com ${APU.fmt.pct(regra.pctUF)} em `
      + `${regra.ufsVoto} UFs ou mais (EC 97/2017, regra de 2026). Federação conta como um `
      + `partido só. Passe o mouse ou toque numa sigla para ver as contas.`;
    const semVoto = !lista.some((a) => a.votos > 0);
    const projecao = leitura.blocos.some((b) => b.vagas > (b.declaradas || 0));
    $('notaClausula').textContent = semVoto
      ? 'Antes da primeira urna: sem voto, ninguém cumpre ainda'
      : (leitura.cabecalho.tf === 's' ? 'Com a totalização final do TSE'
        : 'Com o apurado até aqui' + (projecao ? ', e as cadeiras em projeção' : '')
          + ': muda a cada boletim');

    /* Um quadradinho por partido, com a sigla sobre a cor dele. Federação vai
       pelas siglas que a compõem. Os números dos dois critérios ficam no balão
       do site (APUUI.balaoDaClausula), que abre com mouse, Tab ou toque; o
       veredito vai por escrito para o leitor de tela. */
    const chip = (a) => {
      const b = a.bloco;
      const sigla = b.federacao ? b.siglas.join('/') : (b.siglas[0] || b.rotulo);
      return `<li class="apu-clausula-chip" tabindex="0" data-chave="${esc(b.chave)}"`
        + ` style="background:${b.cor};color:${textoSobre(b.cor)}">${esc(sigla)}`
        + `<span class="sr-only">: ${esc(APUUI.veredictoDaClausula(a))}</span></li>`;
    };

    const passam = lista.filter((a) => a.passa);
    const naoPassam = lista.filter((a) => !a.passa);
    $('nPassam').textContent = APU.fmt.int(passam.length);
    $('nNaoPassam').textContent = APU.fmt.int(naoPassam.length);
    $('clausulaPassam').innerHTML = passam.map(chip).join('')
      || '<li class="apu-clausula-vazio">Nenhum partido ainda.</li>';
    $('clausulaNaoPassam').innerHTML = naoPassam.map(chip).join('')
      || '<li class="apu-clausula-vazio">Nenhum partido.</li>';
  }

  /* ------------------------------------------------- hemiciclo e quadro */

  function palco(leitura, distribuidas) {
    const uf = estado.uf;
    const svg = $('hemiciclo');
    /* As Assembleias somadas não são uma casa: um semicírculo de 1.059
       cadeiras de 27 plenários diferentes desenharia uma maioria que não existe.
       Ali fica só o quadro de cadeiras e votos por partido. */
    const semHemiciclo = !uf && estado.cargo === '0007';
    $('palco').classList.toggle('sem-hemiciclo', semHemiciclo);
    svg.closest('figure').hidden = semHemiciclo;
    APUUI.hemiciclo(svg, leitura.blocos, leitura.total, {
      rotulo: uf ? 'VAGAS' : 'CADEIRAS',
      /* Grade de pontos só na bancada federal de um estado; a Assembleia (e a
         Câmara Legislativa do DF) é uma casa inteira, e fica no semicírculo. */
      pontos: !!uf && estado.cargo === '0006',
      aoClicar: uf ? (b) => irParaColuna(b.chave) : null
    });

    const falta = leitura.total - distribuidas;
    /* Toda cadeira que ainda não é firme é projeção, e a tela diz isso com todas
       as letras: o título, o quadro e esta legenda. Projeção do TSE (o `vag` que
       ele refaz a cada totalização) ou, onde ele ainda não distribuiu as vagas,
       do ElectoMaps (`estimadas`). Firme, só o que o TSE já distribuiu: com 100%
       das seções totalizadas, ou com o eleito declarado. */
    const estimadas = leitura.blocos.reduce((s, b) => s + (b.estimadas || 0), 0);
    const firmes = leitura.blocos.reduce((s, b) => s + Math.min(b.vagas, b.declaradas || 0), 0);
    const projetadas = distribuidas - firmes;
    const conta = estimadas >= projetadas ? 'na conta do ElectoMaps'
      : 'na conta que o TSE refaz a cada totalização'
        + (estimadas ? ' ou, onde ele ainda não distribuiu as vagas, na do ElectoMaps' : '');
    const aviso = !projetadas ? ''
      : (projetadas === distribuidas ? 'Projeção'
        : `${APU.fmt.int(projetadas)} das ${APU.fmt.int(distribuidas)} cadeiras são projeção`)
        + `: as vagas que cada partido teria se a apuração parasse neste boletim, ${conta},`
        + ' pelas regras em vigor: 10% do QE no quociente partidário, 80/20 nas sobras e 3ª fase'
        + ' aberta a todos os partidos (STF). Muda a cada boletim. Não é o resultado: quem'
        + ' distribui as vagas e declara os eleitos é o TSE, com 100% das urnas apuradas.'
        + (firmes ? ' As cadeiras sólidas são as que o TSE já distribuiu.' : '');
    $('rotuloHemi').hidden = !projetadas;
    $('rotuloHemi').textContent = estimadas >= projetadas ? 'Projeção ElectoMaps' : 'Projeção';
    $('avisoQuadro').textContent = aviso;
    $('avisoQuadro').hidden = !(semHemiciclo && aviso);
    $('hemicicloLegenda').textContent = [
      aviso,
      falta > 0
        ? (distribuidas
          ? `${APU.fmt.int(distribuidas)} de ${APU.fmt.int(leitura.total)} cadeiras distribuídas até aqui.`
          : 'As cadeiras serão preenchidas dinamicamente a cada atualização do TSE.')
        : ''
    ].filter(Boolean).join(' ');

    /* Sem voto nenhum ainda (pré-urna, primeiro boletim), todos os partidos
       entram — sem cadeira e sem voto, em ordem alfabética (APU.porCadeiras).
       Com a contagem andando, só quem tem ao menos uma cadeira. */
    const semVoto = !leitura.blocos.some((b) => b.votos > 0);
    const ordenados = leitura.blocos.slice().sort(APU.porCadeiras)
      .filter((b) => semVoto || b.vagas > 0);
    const mostrar = estado.quadroAberto ? ordenados : ordenados.slice(0, QUADRO);
    $('rotuloQuadro').textContent = projetadas ? 'Cadeiras por partido · projeção' : 'Cadeiras por partido';
    $('quadro').innerHTML = mostrar.map((b) => {
      const sub = b.federacao ? `<small>${esc(b.siglas.join(' · '))}</small>` : '';
      return `<tr class="${b.vagas || semVoto ? '' : 'is-sem'}${uf ? ' is-click' : ''}" data-chave="${esc(b.chave)}">
        <td><span class="apu-lead-cell"><span class="apu-swatch" style="background:${b.cor}"></span>
          <span class="apu-dep-tab-nome">${esc(b.rotulo)}${sub}</span></span></td>
        <td class="num apu-dep-tab-cad">${APU.fmt.int(b.vagas)}</td>
        <td class="num apu-dep-tab-votos">${APU.fmt.int(b.votos)}</td>
        <td class="num">${APU.fmt.pct(b.pct)}</td>
      </tr>`;
    }).join('');

    const botao = $('verQuadro');
    botao.hidden = ordenados.length <= QUADRO;
    botao.textContent = estado.quadroAberto
      ? 'Mostrar menos'
      : `Mostrar todos os partidos (${ordenados.length - QUADRO} a mais)`;

    $('quadro').querySelectorAll('tr[data-chave]').forEach((tr) => {
      tr.onmouseenter = () => APUUI.destacarBloco(svg, tr.dataset.chave);
      tr.onmouseleave = () => APUUI.destacarBloco(svg, null);
      if (uf) tr.onclick = () => irParaColuna(tr.dataset.chave);
    });
  }

  /* ------------------------------------------------------- listas abertas */

  /* Cor do texto sobre a cor do partido: escuro sobre cor clara (o amarelo do
     PSB, o salmão do PDT), branco sobre o resto. */
  function textoSobre(cor) {
    let r; let g; let b;
    const hex = /^#([0-9a-f]{6})$/i.exec(String(cor).trim());
    const hsl = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/i.exec(String(cor).trim());
    if (hex) {
      const n = parseInt(hex[1], 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else if (hsl) {
      const h = Number(hsl[1]) / 360; const s = Number(hsl[2]) / 100; const l = Number(hsl[3]) / 100;
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      const canal = (t) => {
        let x = t;
        if (x < 0) x += 1;
        if (x > 1) x -= 1;
        if (x < 1 / 6) return p + (q - p) * 6 * x;
        if (x < 1 / 2) return q;
        if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
        return p;
      };
      r = canal(h + 1 / 3) * 255; g = canal(h) * 255; b = canal(h - 1 / 3) * 255;
    } else {
      return '#ffffff';
    }
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return lum > 0.42 ? '#111111' : '#ffffff';
  }

  function linha(b, c, i, ocupadas, mudou) {
    const classes = ['apu-li'];
    if (c.dentro) classes.push('is-dentro', c.oficial ? 'is-oficial' : 'is-previsto');
    if (!c.dentro && i === ocupadas && ocupadas > 0) classes.push('is-corte');
    if (c.marca === 'fora') classes.push('is-fora');
    if (c.marca === 'suplente') classes.push('is-suplente');
    if (c.semVaga) classes.push('is-semvaga');
    if (mudou === 'entrou') classes.push('is-entrou');
    if (mudou === 'saiu') classes.push('is-saiu');

    const marca = c.dentro
      ? `<span class="apu-li-marca${c.oficial ? '' : ' is-previsto'}">${APUUI.icone('tique', 10)}</span>`
      : '<span class="apu-li-marca is-vazia"></span>';
    /* Nome numa linha, e embaixo, miúdos, o partido (só na federação, onde ele
       varia) e os votos: numa linha só, o nome não cabia na coluna. A situação
       (eleito por QP, por média, suplente, projeção) vem no balão do site, ao
       passar o mouse — sem `title`, que o navegador desenharia no estilo do
       sistema —, e por escrito para o leitor de tela. */
    return `<li class="${classes.join(' ')}" data-flip="r:${esc(c.sq)}" data-sq="${esc(c.sq)}">`
      + `<span class="apu-li-pos">${c.pos}.</span>`
      + '<span class="apu-li-txt">'
      + `<span class="apu-li-nome">${esc(c.urna || c.numero)}</span>`
      + '<span class="apu-li-meta">'
      + (b.federacao ? `<span class="apu-li-part">${esc(c.partido)}</span>` : '')
      + `${APU.fmt.int(c.votos)} ${c.votos === 1 ? 'voto' : 'votos'}</span>`
      + `<span class="sr-only">${esc(APUUI.situacaoDoCandidato(b, c))}</span>`
      + '</span>'
      + marca
      + '</li>';
  }

  function coluna(b, limite, antes, agora) {
    const cand = b.cand || [];
    const mostrar = estado.completas ? cand : cand.slice(0, limite);
    const ocupadas = cand.filter((c) => c.dentro).length;
    const sub = b.federacao
      ? b.siglas.join(' · ')
      : APU.nomeProprio((b.partidos[0] && b.partidos[0].nome) || '');
    const mudou = (c) => {
      if (!antes) return '';
      if (c.dentro && !antes.has(c.sq)) return 'entrou';
      if (!c.dentro && antes.has(c.sq)) return 'saiu';
      return '';
    };
    cand.forEach((c) => { if (c.dentro) agora.add(c.sq); });

    const resto = cand.length - mostrar.length;
    return `<article class="apu-col${b.vagas ? '' : ' is-sem'}" data-flip="c:${esc(b.chave)}"`
      + ` data-chave="${esc(b.chave)}" style="--cor:${b.cor};--cor-txt:${textoSobre(b.cor)}">`
      + '<header class="apu-col-topo">'
      + `<h3 class="apu-col-nome">${esc(b.rotulo)}</h3>`
      + `<p class="apu-col-sub">${esc(sub)}</p>`
      + '</header>'
      + '<div class="apu-col-placar">'
      + `<strong class="apu-col-n">${APU.fmt.int(b.vagas)}</strong>`
      + `<span class="apu-col-rot">${b.vagas === 1 ? 'cadeira' : 'cadeiras'}`
      + `${b.vagas > (b.declaradas || 0) ? ' na projeção' : ''}</span>`
      + `<span class="apu-col-votos">${APU.fmt.int(b.votos)} votos · ${APU.fmt.pct(b.pct)}</span>`
      + '</div>'
      + `<ol class="apu-col-lista">${mostrar.map((c, i) => linha(b, c, i, ocupadas, mudou(c))).join('')}</ol>`
      + (resto > 0 ? `<p class="apu-col-mais">+ ${APU.fmt.int(resto)} na lista</p>` : '')
      + '</article>';
  }

  /* Reordenação animada (FLIP): mede onde cada coluna e cada nome estava,
     redesenha, e anima do lugar antigo para o novo. A linha é medida em relação
     à própria coluna — senão, quando a coluna também anda, o nome andaria duas
     vezes. Sem animação para quem pediu menos movimento. */
  function comFlip(raiz, redesenhar) {
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calmo || typeof Element.prototype.animate !== 'function') { redesenhar(); return; }

    const medir = () => {
      const pos = new Map();
      raiz.querySelectorAll('.apu-col').forEach((col) => {
        const rc = col.getBoundingClientRect();
        pos.set(col.dataset.flip, { x: rc.left, y: rc.top });
        col.querySelectorAll('.apu-li').forEach((li) => {
          const rl = li.getBoundingClientRect();
          pos.set(col.dataset.flip + '>' + li.dataset.flip, { x: rl.left - rc.left, y: rl.top - rc.top });
        });
      });
      return pos;
    };

    const antes = medir();
    redesenhar();
    const depois = medir();
    const anima = (el, de, para) => {
      const dx = de.x - para.x;
      const dy = de.y - para.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' });
    };
    raiz.querySelectorAll('.apu-col').forEach((col) => {
      const k = col.dataset.flip;
      if (antes.has(k)) anima(col, antes.get(k), depois.get(k));
      col.querySelectorAll('.apu-li').forEach((li) => {
        const kl = k + '>' + li.dataset.flip;
        if (antes.has(kl)) anima(li, antes.get(kl), depois.get(kl));
      });
    });
  }

  function listas(leitura) {
    const secao = $('listas');
    const comLista = leitura.blocos.filter((b) => b.cand && b.cand.length);
    secao.hidden = !comLista.length;
    if (!comLista.length) return;

    const uf = estado.uf;
    const tipo = estado.cargo === '0006' ? 'federais' : (uf === 'df' ? 'distritais' : 'estaduais');
    $('tituloListas').textContent = `Bancadas ${tipo} · ${uf.toUpperCase()}`;

    /* Mesma altura de lista para todas as colunas: as vagas do maior partido e
       mais duas — a primeira suplência é a notícia de quem está para entrar. */
    const maior = comLista.reduce((m, b) => Math.max(m, b.vagas), 0);
    const limite = Math.max(5, maior + 2);
    const k = chave();
    const antes = estado.dentroAntes[k] || null;
    const agora = new Set();
    const ordenados = comLista.slice().sort(APU.porCadeiras);

    comFlip($('colunas'), () => {
      $('colunas').innerHTML = ordenados.map((b) => coluna(b, limite, antes, agora)).join('');
    });
    estado.dentroAntes[k] = agora;
    estado.blocosDaLista = new Map(ordenados.map((b) => [b.chave, b]));

    const algumOficial = ordenados.some((b) => b.cand.some((c) => c.dentro && c.oficial));
    const algumPrevisto = ordenados.some((b) => b.cand.some((c) => c.dentro && !c.oficial));
    $('legendaListas').innerHTML = [
      algumOficial ? `<span class="apu-legenda-item"><span class="apu-li-marca">${APUUI.icone('tique', 10)}</span>`
        + '<span class="apu-legenda-txt">eleito pelo TSE: declarado, ou na vaga que ele distribuiu com'
        + ' 100% das urnas apuradas</span></span>' : '',
      algumPrevisto ? `<span class="apu-legenda-item"><span class="apu-li-marca is-previsto">${APUUI.icone('tique', 10)}</span>`
        + '<span class="apu-legenda-txt">dentro das vagas na projeção deste boletim, na conta '
        + (ordenados.some((b) => b.estimadas > 0) ? 'do ElectoMaps' : 'do TSE')
        + '; muda conforme a contagem avança, e quem distribui os eleitos é o TSE, com 100% das urnas'
        + ' apuradas</span></span>' : '',
      /* Sem ninguém nas vagas (pré-urna) não há linha de corte a explicar. */
      algumOficial || algumPrevisto ? '<span class="apu-legenda-item"><span class="apu-legenda-corte"></span>'
        + '<span class="apu-legenda-txt">linha de corte: logo abaixo, quem entra se o partido ganhar mais uma vaga</span></span>' : ''
    ].filter(Boolean).join('');
    $('legendaListas').hidden = !$('legendaListas').innerHTML;

    $('verListas').innerHTML = estado.completas
      ? APUUI.icone('menos', 13) + ' Mostrar só o começo das listas'
      : APUUI.icone('mais', 13) + ' Ver listas completas';
    setas();
  }

  function irParaColuna(chaveBloco) {
    const col = $('colunas').querySelector(`.apu-col[data-chave="${CSS.escape(chaveBloco)}"]`);
    if (!col) return;
    $('listas').scrollIntoView({ behavior: 'smooth', block: 'start' });
    const trilho = $('colunas');
    trilho.scrollTo({ left: col.offsetLeft - trilho.offsetLeft - 8, behavior: 'smooth' });
    col.classList.remove('is-aceso');
    void col.offsetWidth;
    col.classList.add('is-aceso');
  }

  /* Setas do carrossel: só aparecem quando há o que rolar, e cada uma se
     apaga no fim do seu lado. */
  function setas() {
    const t = $('colunas');
    const rola = t.scrollWidth > t.clientWidth + 4;
    $('setaEsq').hidden = !rola;
    $('setaDir').hidden = !rola;
    $('setaEsq').disabled = t.scrollLeft <= 2;
    $('setaDir').disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 2;
  }

  function rolar(sentido) {
    const t = $('colunas');
    t.scrollBy({ left: sentido * Math.max(200, t.clientWidth * 0.8), behavior: 'smooth' });
  }

  /* ------------------------------------------------------- estado a estado */

  const ORDEM_BANDEIRAS = ('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi '
    + 'pr rj rn ro rr rs sc se sp to').split(' ');

  function bandeira(uf) {
    const i = ORDEM_BANDEIRAS.indexOf(uf);
    return i < 0 ? ''
      : '<span class="apu-estado-bandeira" style="--bandeira:' + i + '" aria-hidden="true"></span>';
  }

  function estados(leitura) {
    $('estados').hidden = false;
    $('tituloEstados').textContent = estado.cargo === '0006'
      ? 'Bancada de cada estado' : 'Assembleia de cada estado';
    const ufs = Object.keys(leitura.entradas)
      .sort((a, b) => (leitura.entradas[b].nv || 0) - (leitura.entradas[a].nv || 0)
        || APU.UF_NOMES[a].localeCompare(APU.UF_NOMES[b], 'pt-BR'));

    $('gradeEstados').innerHTML = ufs.map((uf) => {
      const e = leitura.entradas[uf];
      const blocos = leitura.porUF[uf] || [];
      const nv = Number(e.nv) || 0;
      const maiores = blocos.filter((b) => b.vagas > 0).sort(APU.porCadeiras).slice(0, 3);
      const pst = Number(e.pst) || 0;
      return `<a class="apu-dep-estado" data-uf="${uf}" href="${esc(endereco(estado.cargo, uf))}">`
        + '<div class="apu-estado-head">' + bandeira(uf)
        + `<span class="apu-estado-uf">${esc(APU.UF_NOMES[uf])}</span>`
        + `<span class="apu-dep-estado-nv">${APU.fmt.int(nv)}</span></div>`
        + `<div class="apu-dep-estado-mosaico">${APUUI.mosaico(blocos, nv)}</div>`
        + '<div class="apu-dep-estado-maiores">' + (maiores.length
          ? maiores.map((b) => `<span class="apu-dep-estado-maior" style="--cor-linha:${b.cor}">`
            + `<span class="apu-dep-estado-maior-nome">${esc(b.rotulo)}</span><b>${b.vagas}</b></span>`).join('')
          : '<span class="is-vazio">sem vagas distribuídas</span>') + '</div>'
        + '<div class="apu-estado-pe">'
        + `<div class="apu-mini"><span style="width:${Math.min(100, pst)}%;background:var(--ink)"></span></div>`
        + `<span class="apu-estado-apurado">${APU.fmt.pct(pst)} apurado</span>`
        + '</div></a>';
    }).join('');
    $('notaEstados').textContent = (estado.cargo === '0007' ? 'O DF elege a Câmara Legislativa. ' : '')
      + (leitura.blocos.some((b) => b.vagas > (b.declaradas || 0))
        ? 'Em tom claro, projeção; sólidas, as vagas que o TSE já distribuiu. ' : '')
      + 'Clique num estado para ver as listas, nome a nome';
  }

  /* --------------------------------------------------------------- ciclo */

  async function atualizar() {
    const geracao = ++estado.geracao;
    const uf = estado.uf;
    const cargo = cargoEfetivo();
    let pedidos;
    if (uf) {
      pedidos = [[cargo + '|' + uf, 'lista-' + uf, cargo]];
    } else {
      pedidos = [[estado.cargo + '|', 'uf', estado.cargo]];
      if (estado.cargo === '0007') pedidos.push(['0008|', 'uf', '0008']);
    }
    const respostas = await Promise.all(pedidos.map(async ([k, nome, c]) => {
      const r = await APU.snapshot(nome, c);
      /* Antes do primeiro boletim do TSE, o que está registrado no
         DivulgaCandContas (APU.preUrna): partidos e listas com 0 voto. Boletim de
         verdade, quando chega, substitui, e a página não volta atrás. */
      const vivo = estado.dados[k] && !(estado.dados[k].meta || {}).pre;
      return r || (vivo ? null : APU.preUrna(nome, c));
    }));
    /* O leitor pode ter trocado de estado enquanto a rede respondia: a resposta
       velha não pinta por cima da tela nova. */
    if (geracao !== estado.geracao) return;
    respostas.forEach((r, i) => { if (r) estado.dados[pedidos[i][0]] = r; });
    desenhar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    estado.timer = setTimeout(async () => {
      /* Uma volta que estoura não pode levar o plantão junto: sem este try, um
         snapshot malformado congelaria a página no último boletim. */
      try {
        await atualizar();
      } catch (e) {
        console.warn('[apuracao] volta falhou, seguindo para a próxima', e);
      }
      agendar();
    }, APU.intervaloDe(1));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') atualizar().catch(() => {}).then(agendar);
    else clearTimeout(estado.timer);
  });

  /* Clique comum troca sem recarregar; com Ctrl, Cmd ou botão do meio, o link
     segue para outra aba, como qualquer link. */
  function interceptar(ev, alvo) {
    if (!alvo || ev.defaultPrevented || ev.button !== 0
      || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
    ev.preventDefault();
    return true;
  }

  (async function iniciar() {
    lerEndereco();
    history.replaceState({ cargo: estado.cargo, uf: estado.uf }, '', location.href);

    $('seletorCargo').addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-pagina-cargo]');
      const cargo = a && a.dataset.paginaCargo;
      /* Só os dois de deputado ficam nesta página; os outros são links comuns. */
      if ((cargo === '0006' || cargo === '0007') && interceptar(ev, a)) irPara(cargo, estado.uf);
    });
    $('seletorUF').addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-uf]');
      if (interceptar(ev, a)) irPara(estado.cargo, a.dataset.uf);
    });
    $('gradeEstados').addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-uf]');
      if (interceptar(ev, a)) irPara(estado.cargo, a.dataset.uf, { subir: true });
    });
    $('voltar').addEventListener('click', (ev) => {
      if (estado.uf && interceptar(ev, ev.currentTarget)) irPara(estado.cargo, '', { subir: true });
    });
    $('verQuadro').onclick = () => { estado.quadroAberto = !estado.quadroAberto; desenhar(); };
    $('verListas').onclick = () => { estado.completas = !estado.completas; desenhar(); };
    $('setaEsq').onclick = () => rolar(-1);
    $('setaDir').onclick = () => rolar(1);
    $('colunas').addEventListener('scroll', setas, { passive: true });
    /* Balão de cada nome da lista: o mesmo do hemiciclo, no estilo do site. */
    const tip = APUUI.balao();
    $('colunas').addEventListener('mousemove', (ev) => {
      const li = ev.target.closest('.apu-li');
      const b = li && estado.blocosDaLista.get(li.closest('.apu-col').dataset.chave);
      const c = b && b.cand.find((x) => x.sq === li.dataset.sq);
      if (c) tip.mostrar(APUUI.balaoDoCandidato(b, c), ev);
      else tip.esconder();
    });
    $('colunas').addEventListener('mouseleave', () => tip.esconder());
    /* Balão das siglas da cláusula: segue o mouse; com Tab ou toque, abre
       embaixo da sigla. */
    const siglaDaClausula = (el) => {
      const a = el && estado.clausula.get(el.dataset.chave);
      return a ? APUUI.balaoDaClausula(a) : '';
    };
    const abrirNaSigla = (ev) => {
      const el = ev.target.closest && ev.target.closest('.apu-clausula-chip');
      const html = siglaDaClausula(el);
      if (!html) { tip.esconder(); return; }
      const r = el.getBoundingClientRect();
      tip.mostrar(html, ev.type === 'mousemove' ? ev : { clientX: r.left, clientY: r.bottom });
    };
    $('clausula').addEventListener('mousemove', abrirNaSigla);
    $('clausula').addEventListener('click', abrirNaSigla);
    $('clausula').addEventListener('focusin', abrirNaSigla);
    $('clausula').addEventListener('mouseleave', () => tip.esconder());
    $('clausula').addEventListener('focusout', () => tip.esconder());
    const info = $('infoClausula');
    const botaoInfo = info.querySelector('button');
    const abrirInfo = (sim) => {
      info.classList.toggle('is-on', sim);
      botaoInfo.setAttribute('aria-expanded', String(sim));
    };
    botaoInfo.addEventListener('click', (ev) => { ev.stopPropagation(); abrirInfo(!info.classList.contains('is-on')); });
    document.addEventListener('click', (ev) => { if (!info.contains(ev.target)) abrirInfo(false); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') abrirInfo(false); });
    window.addEventListener('resize', setas);
    window.addEventListener('popstate', () => {
      const [cargo, uf] = [estado.cargo, estado.uf];
      lerEndereco();
      const novo = [estado.cargo, estado.uf];
      [estado.cargo, estado.uf] = [cargo, uf];
      irPara(novo[0], novo[1], { empurrar: false });
    });

    desenhar();
    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
    }
    agendar();
  })();
})();
