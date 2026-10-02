/* ===========================================================================
   ElectoMaps — apuração: renderização compartilhada

   O que a página nacional e a estadual desenham igual: selo de estado, barra de
   andamento, placar de candidatos, participação, legenda e balão do mapa.
   =========================================================================== */
'use strict';

const APUUI = (function () {

  const $ = (id) => document.getElementById(id);

  /* Foto oficial de urna, escrita por scripts/apuracao/candidatos.py. Quando o
     arquivo não existe (antes da importação), o <img> se remove e a linha cai
     no layout sem foto — nada de silhueta genérica ocupando espaço. */
  function foto(sq) {
    return `resultados_geo/candidatos_2026/fotos/${sq}.jpg`;
  }

  /* Duas iniciais do nome de urna, para o disco que ocupa o lugar da foto. */
  function iniciais(nome) {
    const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return '';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
  }

  /* Ícones em SVG, não em caractere. O ✓ (U+2713) cai na apresentação emoji em
     boa parte dos sistemas e sai como um quadrado verde, fora do tom do resto da
     tela; ▼, + e − sofrem do mesmo problema em menor grau, e nenhum deles
     acompanha o peso da fonte ao redor. Mesmo traçado dos ícones que já estavam
     no HTML: viewBox de 24, traço de 2, pontas arredondadas, cor herdada do
     texto por currentColor. */
  const TRACOS = {
    tique: 'M20 6 9 17l-5-5',
    mais: 'M12 5v14M5 12h14',
    menos: 'M5 12h14',
    baixo: 'M6 9l6 6 6-6'
  };

  function icone(nome, tamanho) {
    const d = TRACOS[nome];
    if (!d) return '';
    const t = tamanho || 12;
    return `<svg class="apu-icone" width="${t}" height="${t}" viewBox="0 0 24 24"`
      + ' fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"'
      + ` stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ selo */

  function selo(meta, entrada) {
    const live = $('selLive');
    const sim = $('selSimulado');
    const carimbo = $('selCarimbo');
    const definido = $('selDefinido');

    /* and: 'n' não houve totalização, 'p' em andamento, 'f' finalizada. O valor
       era comparado com 's', que não existe no leiaute — nenhuma abrangência
       jamais aparecia "ao vivo". */
    const emAndamento = !!entrada && entrada.and === 'p';
    const encerrada = !!entrada && entrada.and === 'f';

    if (live) {
      live.classList.toggle('is-off', !emAndamento);
      live.textContent = emAndamento ? 'Ao vivo' : (encerrada ? 'Encerrada' : 'Aguardando');
    }
    if (sim) sim.classList.toggle('is-on', APU.simulado(meta));

    /* Matematicamente definido: quem preenche esse campo é o TSE, no instante em
       que os votos totalizados já bastam. Some quando há totalização final, e aí
       a situação do candidato passa a dizer o mesmo com mais precisão. */
    if (definido) {
      const md = APU.definicao(entrada);
      definido.classList.toggle('is-on', !!md);
      definido.textContent = md === 'e'
        ? 'Matematicamente definido'
        : (md === 's' ? 'Segundo turno definido' : '');
    }

    if (carimbo) {
      const c = APU.carimbo(entrada);
      carimbo.textContent = c ? `Totalizado em ${c}` : '';
    }
  }

  /* ---------------------------------------------------------------- avisos */

  /* As duas coisas que uma tela de apuração precisa dizer e quase nenhuma diz:
     que a divulgação presidencial ainda está bloqueada, e que a eleição terminou
     sem eleito. Tudo num só lugar.

     O aviso de quanto eleitorado ainda falta contar saiu daqui: a linha de
     seções do cabeçalho já dá o que falta, e a projeção de virada repetia a
     cada boletim um recado que o próprio placar mostra. */
  function avisos(entrada, alvo) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    const partes = [];

    if (APU.bloqueado(entrada)) {
      partes.push('<strong>Divulgação presidencial ainda bloqueada.</strong> '
        + 'O arquivo do TSE chega com a votação zerada até as 17h de Brasília, '
        + 'para todas as unidades da Federação e o exterior (art. 265 §1 da '
        + 'Resolução TSE nº 23.751/2026). O zero abaixo é a regra, não uma falha.');
    }

    if (entrada && entrada.esae === 's') {
      const motivos = (entrada.mnae || []).map(esc).join('; ');
      partes.push('<strong>Totalização final sem atribuição de eleito.</strong>'
        + (motivos ? ' ' + motivos + '.' : ''));
    }

    el.innerHTML = partes.map((p) => `<p class="apu-aviso">${p}</p>`).join('');
    el.hidden = !partes.length;
  }

  /* ------------------------------------------------------------- andamento */

  function progresso(entrada) {
    const pct = $('pctApurado');
    const barra = $('barraApurada');
    const secoes = $('secoesApuradas');
    const p = entrada ? Number(entrada.pst) || 0 : 0;

    /* Sem boletim o percentual e 0,00%, nao um travessao: zero apurado e um
       numero, e e o mesmo que os cartoes de estado mostram. */
    if (pct) pct.textContent = APU.fmt.pct(p) + ' apurado';
    if (barra) barra.style.width = Math.max(0, Math.min(100, p)) + '%';
    if (secoes) {
      secoes.textContent = entrada
        ? `${APU.fmt.int(entrada.st)} de ${APU.fmt.int(entrada.ts)} seções`
        : 'seções totalizadas';
    }
  }

  /* Selo de eleito / segundo turno. Sólido, com o check verde, quando é certo:
     declarado pelo TSE, ou matematicamente eleito — o que falta apurar não muda
     mais o resultado (APU.marcar). Tracejado (`is-previsto`) só para a leitura
     que ainda pode mudar. */
  const TITULO_MARCA = {
    oficial: 'Declarado pelo TSE no arquivo de resultado',
    matematico: 'Matematicamente eleito: nem todo o eleitorado que falta apurar mudaria o resultado',
    previsto: 'Leitura das vagas do cargo e do campo "matematicamente definido" do TSE; '
      + 'ainda não há declaração oficial'
  };

  const firme = (c) => !!(c.oficial || c.matematico);
  const tituloDaMarca = (c) => (c.matematico && !c.oficial && c.marca === 'segundo'
    ? 'Matematicamente definido pelo TSE: vai ao 2º turno'
    : TITULO_MARCA[c.oficial ? 'oficial' : (c.matematico ? 'matematico' : 'previsto')]);

  function selosDaMarca(c) {
    if (!c.marca) return '';
    const rotulo = APU.ROTULO_MARCA[c.marca] || '';
    if (!rotulo) return '';
    return `<span class="apu-marca is-${c.marca}${firme(c) ? '' : ' is-previsto'}"`
      + ` title="${esc(tituloDaMarca(c))}">${firme(c) ? icone('tique', 11) : ''}${rotulo}</span>`;
  }

  function rotuloSituacao(c) {
    const st = String(c.situacao || '');
    /* Registro pendente é o estado normal de quase toda a lista, e "Não eleito"
       é o estado normal de quase todo candidato depois da totalização: marcar
       qualquer um dos dois em cada linha não informa nada. O que informa são as
       situações do art. 215 — eleito por quociente, eleito por média, suplente —
       e as que mudam quem está de fato na disputa. */
    const muda = st && !/^(Deferido|Aguardando|N[ãa]o eleit|Eleit|2. turno|Suplente)/i.test(st);
    const chips = [selosDaMarca(c)];
    if (muda) {
      const eSubJudice = /indeferido em prazo recursal ou com recurso/i.test(st)
        || /pendente.*julgamento/i.test(st)
        || /sub judice/i.test(st)
        || /em prazo recursal/i.test(st);
      const rotulo = eSubJudice ? 'SJ' : st;
      const titulo = eSubJudice ? `Sub judice: ${st}` : '';
      chips.push(`<span class="apu-cand-sit${eSubJudice ? ' is-sj' : ''}"${titulo ? ` title="${esc(titulo)}"` : ''}>${esc(rotulo)}</span>`);
    }
    /* dvt: a destinação do voto. Anulado e sub judice mudam a leitura do número
       que está ao lado — é o que o art. 265 §2 manda informar. */
    if (/anulado/i.test(String(c.destino || ''))) {
      chips.push(`<span class="apu-cand-sit is-anulado">${esc(c.destino)}</span>`);
    }
    return chips.filter(Boolean).join('');
  }

  /* Legenda dos selos. A diferença entre sólido e tracejado é a diferença entre
     "o TSE declarou" e "nós deduzimos", e ela não pode morar só no `title`: em
     tela de toque não existe passar o mouse. Aparece apenas quando há selo de
     cada tipo na tela, para não ocupar espaço explicando o que não está ali. */
  function legendaMarcas(lista, alvo) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }

  /* ------------------------------------------- marcas no nível da eleição */

  /* Quem está eleito ou no 2º turno, como Map chave -> {marca, oficial,
     matematico}, decidido com a `entrada` de onde a eleição se decide: o país
     (presidente) ou o estado (governador, senador). Um estado, um município ou
     uma zona na tela recebem estas marcas pelo `marcas` do placar — a conta
     feita com o voto de um pedaço daria eleito quem só ganha ali (Lula
     "eleito" no Maranhão, com 68% do estado e a apuração nacional aberta).
     Sem a entrada da eleição, nenhuma marca: melhor faltar que sobrar. */
  function marcasDaEleicao(entrada, dicionario, cargo) {
    if (!entrada || !(entrada.vv > 0)) return new Map();
    const lista = APU.marcar(APU.ranking(entrada, dicionario || {}), entrada, cargo);
    return new Map(lista.filter((c) => c.marca)
      .map((c) => [c.chave, { marca: c.marca, oficial: c.oficial, matematico: c.matematico }]));
  }

  /* O cabeçalho de um recorte (estado, município) com o "matematicamente
     definido" da eleição, e não do recorte: o selo diz o mesmo que as marcas. */
  function comDefinicaoDa(eleicao, entrada) {
    if (!entrada) return entrada;
    return { ...entrada, md: (eleicao && eleicao.md) || '', tf: eleicao ? eleicao.tf : entrada.tf };
  }

  /* ---------------------------------------------------------------- placar */

  /* Quem já pediu a lista inteira, por elemento de destino. O placar é
     redesenhado a cada boletim, e a escolha do leitor tem de sobreviver a isso. */
  const abertos = {};

  /* `eleitos` marca quem o TSE já declarou eleito; nada é inferido aqui. */
  function placar(lista, alvo, opcoes) {
    const o = opcoes || {};
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;

    if (!lista.length) {
      el.innerHTML = '<p class="apu-stat-l" style="padding:14px 0">Sem votos apurados.</p>';
      return;
    }

    /* Só os quatro primeiros — inclusive antes da primeira urna, quando a chapa
       inteira estouraria a altura do mapa. O resto entra pelo botão.

       `marcas` (Map chave -> {marca, oficial, matematico}) traz as marcas de
       fora: numa cidade ou numa zona, quem está eleito ou no 2º turno se decide
       no estado ou no país, e a conta feita com o voto de um pedaço só daria
       eleito quem lidera ali. */
    if (o.marcas) {
      lista.forEach((c) => {
        const m = o.marcas.get(c.chave);
        c.marca = m ? m.marca : '';
        c.oficial = !!(m && m.oficial);
        c.matematico = !!(m && m.matematico);
      });
    } else {
      APU.marcar(lista, o.entrada, o.cargo);
    }
    const limite = o.limite || 4;
    const chave = (typeof alvo === 'string' ? alvo : el.id) || 'placar';
    const aberto = !!abertos[chave];
    const mostrar = aberto ? lista : lista.slice(0, limite);

    el.innerHTML = mostrar.map((c, i) => {
      const cor = APU.cor(c.partido);
      /* Disputa proporcional e a linha de agregado nao tem rosto: sao partido,
         nao pessoa. */
      const semRosto = o.semFoto || !c.chave || APU.PROPORCIONAIS.has(APU.cfg.cargo);
      const rosto = semRosto ? ''
        : APU.temFoto(c.chave)
          ? `<img class="apu-face" src="${esc(foto(c.chave))}" alt="" loading="lazy"
                  onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'apu-face-ph',textContent:'${esc(iniciais(c.urna || c.nome))}',style:'background:${cor}'}))">`
          : `<span class="apu-face-ph" style="background:${cor}" aria-hidden="true">${esc(iniciais(c.urna || c.nome))}</span>`;
      return `
        <div class="apu-cand ${i === 0 && !c.zerado ? 'is-lead' : ''} ${c.zerado ? 'is-zero' : ''} ${semRosto ? 'is-photoless' : ''}">
          ${rosto}
          <div>
            <div class="apu-cand-name">${esc(c.urna || c.nome)}${rotuloSituacao(c)}</div>
            <div class="apu-cand-party">${esc(c.partido || '')}</div>
            <div class="apu-cand-bar"><span style="width:${Math.min(100, c.pct).toFixed(2)}%;background:${cor}"></span></div>
          </div>
          <div class="apu-cand-nums">
            <div class="apu-cand-pct">${APU.fmt.pct(c.pct)}</div>
            <div class="apu-cand-votes">${APU.fmt.int(c.votos)}</div>
          </div>
        </div>`;
    }).join('');

    /* O botão pode morar fora do placar. Na apuração ele abre e fecha o bloco
       inteiro — candidaturas e participação —, e um botão de "Mostrar menos" no
       meio do que ele fecha se lê como se não valesse para o que vem abaixo. */
    const casa = o.botao
      ? (typeof o.botao === 'string' ? $(o.botao) : o.botao)
      : el;
    if (!casa) return;
    if (casa !== el) casa.innerHTML = '';

    if (lista.length > limite) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'apu-more';
      botao.textContent = aberto
        ? 'Mostrar menos'
        : `Mostrar mais (${lista.length - limite})`;
      botao.onclick = () => {
        abertos[chave] = !aberto;
        placar(lista, alvo, opcoes);
        /* Fechar com a lista rolada deixaria o cartão preso no meio dela. */
        if (aberto) el.scrollTop = 0;
        if (typeof o.aoAlternar === 'function') o.aoAlternar(!aberto);
      };
      casa.appendChild(botao);
    }
  }

  /* --------------------------------------------------------- participação */

  function participacao(entrada, alvo, opcoes) {
    const o = opcoes || {};
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    /* Sem boletim nao ha participacao: esconde o titulo junto, em vez de deixar
       um rotulo sobre nada. */
    const rot = $('rotuloParticipacao');
    if (rot) rot.hidden = !entrada;
    if (!entrada) { el.innerHTML = ''; return; }

    const cel = (v, l) => `<div><div class="apu-stat-v">${v}</div><div class="apu-stat-l">${l}</div></div>`;
    const tem = (k) => entrada[k] != null;
    const pc = (parte, total) => APU.fmt.pct(APU.fmt.parte(parte, total));

    /* Cada percentual usa a base que o TSE usa para o seu: comparecimento e
       abstenção sobre o eleitorado das seções instaladas (esi), válidos e
       anulados sobre os votos a votáveis concorrentes (vvc), brancos e total de
       nulos sobre o total de votos, e nulo contra nulo técnico sobre o total de
       nulos. Assim o número da tela é o número do arquivo.

       Campo ausente é campo que aquela camada não traz: a célula não aparece, em
       vez de mostrar um zero que se leria como "não houve". */
    const baseComp = entrada.esi || entrada.te;
    const baseVot = entrada.vvc || entrada.vv;
    const celulas = [
      [true, APU.fmt.int(entrada.te), 'Eleitorado'],
      [true, APU.fmt.int(entrada.comp), `Comparecimento<br>${pc(entrada.comp, baseComp)}`],
      [true, APU.fmt.int(entrada.abst), `Abstenção<br>${pc(entrada.abst, baseComp)}`],
      [true, APU.fmt.int(entrada.vv), `Votos válidos<br>${pc(entrada.vv, baseVot)}`],
      [tem('vnom'), APU.fmt.int(entrada.vnom), `Nominais<br>${pc(entrada.vnom, entrada.vv)}`],
      [tem('vl') && entrada.vl > 0, APU.fmt.int(entrada.vl),
        `De legenda<br>${pc(entrada.vl, entrada.vv)}`],
      [true, APU.fmt.int(entrada.vb), `Brancos<br>${pc(entrada.vb, entrada.tv)}`],
      /* Nulo e nulo técnico: quase nenhum painel separa os dois, e a diferença é
         justamente a que separa protesto de falha operacional da urna. */
      [true, APU.fmt.int(entrada.vn),
        `Nulos<br>${pc(entrada.vn, entrada.tvn || entrada.tv)} dos nulos`],
      [tem('vnt') && entrada.vnt > 0, APU.fmt.int(entrada.vnt),
        `Nulos técnicos<br>${pc(entrada.vnt, entrada.tvn)} dos nulos`],
      [tem('van') && entrada.van > 0, APU.fmt.int(entrada.van),
        `Anulados<br>${pc(entrada.van, baseVot)}`],
      [tem('vansj') && entrada.vansj > 0, APU.fmt.int(entrada.vansj),
        `Anulados sub judice<br>${pc(entrada.vansj, baseVot)}`],
      [tem('vscv') && entrada.vscv > 0, APU.fmt.int(entrada.vscv), 'Sem candidato para votar'],
      [tem('vsan') && entrada.vsan > 0, APU.fmt.int(entrada.vsan), 'Votos de seções anuladas'],
      /* Urnas que não abriram, e as marcadas como não apuradas. É a estatística
         que ninguém publica e que aparece em toda contestação. */
      [tem('sni') && entrada.sni > 0, APU.fmt.int(entrada.sni),
        `Seções não instaladas<br>${APU.fmt.int(entrada.esni)} eleitores`],
      [tem('sna') && entrada.sna > 0, APU.fmt.int(entrada.sna),
        `Seções não apuradas<br>${APU.fmt.int(entrada.esna)} eleitores`]
    ];
    /* A anatomia do voto são treze células de detalhe, e ocupava mais altura do
       que o placar que a pessoa veio ver. Fica fechada — o estado sobrevive ao
       redesenho de cada boletim.

       `seguir` entrega a chave de abertura de outro bloco: com ela o painel não
       ganha botão próprio e abre junto com a lista completa de candidaturas,
       sob um botão só. O título acompanha, senão sobraria um rótulo sobre nada. */
    const visiveis = celulas.filter(([mostrar]) => mostrar);
    const chave = o.seguir || ('participacao:'
      + ((typeof alvo === 'string' ? alvo : el.id) || 'participacao'));
    const aberto = !!abertos[chave];

    if (rot) rot.hidden = !aberto;
    el.innerHTML = aberto ? visiveis.map(([, v, l]) => cel(v, l)).join('') : '';
    if (o.seguir) return;

    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'apu-more';
    botao.textContent = aberto
      ? 'Mostrar menos'
      : `Mostrar mais (${visiveis.length})`;
    botao.onclick = () => {
      abertos[chave] = !aberto;
      participacao(entrada, alvo, opcoes);
    };
    el.appendChild(botao);
  }

  /* A legenda de cores do mapa (quem lidera, e em quantas unidades) saiu: o
     mapa já é clicável e o balão diz o mesmo com mais precisão, e a lista
     logo abaixo repete nome, cor e contagem. */

  /* ---------------------------------------------------------------- balão */

  /* Balao no formato do visualizador: mesma marcacao .district-nyt-*, mesmas
     quatro linhas ordenadas por voto, mesmo rodape de votos validos. Ali o
     transporte e um Popup do MapLibre; aqui o mapa e SVG puro, entao o mesmo
     conteudo vai num elemento fixo que segue o cursor. */
  function linhasDoBalao(entrada, dicionario) {
    const lista = APU.ranking(entrada, dicionario)
      .filter((c) => c.votos > 0)
      .slice(0, 4);

    if (!lista.length) {
      return '<tr><td colspan="3" style="text-align:center;color:#777;padding:8px;">'
        + 'Sem detalhamento disponível.</td></tr>';
    }

    return lista.map((c, i) => {
      const venc = i === 0 ? ' winner' : '';
      return '<tr>'
        + '<td style="padding:0;">'
        + '<div class="district-nyt-loser-cell" style="border-left-color:' + APU.cor(c.partido) + ';">'
        + '<span style="margin-left:6px;">' + esc(c.urna || c.nome) + '</span></div></td>'
        + '<td class="votes-cell' + venc + '">' + APU.fmt.int(c.votos) + '</td>'
        + '<td class="pct-cell' + venc + '">' + c.pct.toFixed(1) + '%</td>'
        + '</tr>';
    }).join('');
  }

  function conteudoDoBalao(nome, subtitulo, entrada, dicionario) {
    const cabecalho = APU.PROPORCIONAIS.has(APU.cfg.cargo) ? 'Partido' : 'Candidato';

    if (!entrada || !entrada.vv) {
      return '<div class="nyt-tooltip-container">'
        + '<div class="district-nyt-title">' + esc(nome) + '</div>'
        + '<div class="district-nyt-sub">Sem votos apurados</div></div>';
    }

    return '<div class="nyt-tooltip-container">'
      + '<div class="district-nyt-title">' + esc(nome) + '</div>'
      + '<div class="district-nyt-sub">' + esc(subtitulo) + '</div>'
      + '<table class="district-nyt-table"><thead><tr>'
      + '<th style="text-align:left;">' + cabecalho + '</th><th>Votos</th><th>%</th>'
      + '</tr></thead><tbody>' + linhasDoBalao(entrada, dicionario) + '</tbody></table>'
      + '<div class="district-nyt-nota">Votos válidos: ' + APU.fmt.int(entrada.vv) + '</div>'
      + '</div>';
  }

  /* Segue o cursor e vira de lado ao encostar na borda, como o popup do
     MapLibre faz ao reancorar sozinho. */
  function balao() {
    const el = $('tip');
    return {
      mostrar(html, ev) {
        if (!el) return;
        el.innerHTML = html;
        el.classList.add('is-on');
        const m = 14;
        const r = el.getBoundingClientRect();
        let x = ev.clientX + m;
        let y = ev.clientY + m;
        if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - m;
        if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - m;
        el.style.left = Math.max(8, x) + 'px';
        el.style.top = Math.max(8, y) + 'px';
      },
      esconder() { if (el) el.classList.remove('is-on'); }
    };
  }

  /* ----------------------------------------------------------------- mapa */

  /* --------------------------------------------- faixas de cor do vencedor */

  /* O mapa pinta cada território com a cor do partido de quem lidera, num de
     oito tons sólidos escolhidos pelo percentual do líder ali, em faixas de 10
     pontos: abaixo de 20% o mais claro, 80% ou mais o mais escuro — o padrão dos
     mapas do NYT. Antes era a mesma cor com opacidade pela margem, que no tema
     escuro virava um tom sujo, misturado ao fundo, e não dizia quanto o líder
     tinha.

     Os tons saem da cor-base do partido: clareando em direção a um quase-branco
     nas faixas baixas, a própria cor entre 60% e 70%, e escurecendo em direção
     ao preto nas duas de cima. Sólidos, e não transparentes, para lerem igual
     nos dois temas. */
  const FAIXAS = [20, 30, 40, 50, 60, 70, 80];
  const ROTULO_FAIXAS = ['<20', '20', '30', '40', '50', '60', '70', '80+'];
  /* Fração de cor-base em cada faixa; acima de 1, quanto escurece. */
  const RAMPA = [0.2, 0.32, 0.46, 0.62, 0.8, 1, 1.18, 1.36];
  const CLARO = [244, 244, 242];

  function faixa(pct) {
    let i = 0;
    while (i < FAIXAS.length && pct >= FAIXAS[i]) i += 1;
    return i;
  }

  /* #rrggbb, #rgb, rgb() e o hsl() das cores derivadas de APU.cor. */
  function rgbDe(cor) {
    const s = String(cor || '').trim();
    let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
    if (m) {
      const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    m = /^hsl\(\s*([\d.]+)(?:deg)?[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i.exec(s);
    if (m) {
      const h = Number(m[1]) / 360; const sat = Number(m[2]) / 100; const l = Number(m[3]) / 100;
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
      const p = 2 * l - q;
      const canal = (t0) => {
        let t = t0;
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      return [canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255];
    }
    return [148, 163, 184];
  }

  function tom(cor, i) {
    const base = rgbDe(cor);
    const k = RAMPA[Math.max(0, Math.min(RAMPA.length - 1, i))];
    const rgb = k <= 1
      ? base.map((c, j) => CLARO[j] + (c - CLARO[j]) * k)
      : base.map((c) => c * (1 - (k - 1)));
    return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c)))
      .toString(16).padStart(2, '0')).join('');
  }

  /* Cor do líder no tom da faixa dele; null quando ainda não há voto. Serve ao
     SVG e ao mapa em MapLibre da presidencial, para que os dois pintem igual.
     `op` fica em 1: quem distingue as faixas é o tom, não a transparência. */
  function tinta(entrada, dicionario) {
    if (!entrada || !entrada.vv) return null;
    const l = APU.ranking(entrada, dicionario)[0];
    if (!l) return null;
    const i = faixa(l.pct);
    return { cor: tom(APU.cor(l.partido), i), op: 1, faixa: i };
  }

  /* Legenda das faixas: uma régua de oito tons por candidato que lidera em
     algum lugar do mapa, com os limites embaixo. `lideres`: [{nome, cor}]. */
  function legendaFaixas(alvo, lideres) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    el.hidden = !lideres.length;
    if (!lideres.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<p class="apu-faixas-tit">% do mais votado</p>'
      + lideres.map((c) => '<div class="apu-faixas-linha">'
        + `<span class="apu-faixas-nome">${esc(c.nome)}</span>`
        + '<span class="apu-faixas-regua">'
        + RAMPA.map((_, i) => `<span style="background:${tom(c.cor, i)}"></span>`).join('')
        + '</span></div>').join('')
      + '<div class="apu-faixas-linha"><span class="apu-faixas-nome"></span>'
      + '<span class="apu-faixas-regua is-rotulos">'
      + ROTULO_FAIXAS.map((r) => `<span>${r}</span>`).join('') + '</span></div>';
  }

  /* Pinta um <svg> já montado: cada <path data-chave> recebe a cor do líder da
     sua abrangência, e opacidade proporcional à margem — território ainda sem
     apuração fica no cinza neutro, nunca na cor de alguém. */
  function pintarMapa(svg, entradaDe, dicionario, aoClicar) {
    if (!svg) return;
    const tip = balao();

    svg.querySelectorAll('path[data-chave]').forEach((p) => {
      const chave = p.getAttribute('data-chave');
      const nome = p.getAttribute('data-nome') || chave;
      const entrada = entradaDe(chave);
      const t = tinta(entrada, dicionario);

      /* O clique não depende de já haver voto: antes do primeiro boletim o mapa
         inteiro está vazio e ainda assim precisa responder. */
      p.onclick = aoClicar ? () => { tip.esconder(); aoClicar(chave, nome); } : null;
      p.classList.toggle('is-click', !!aoClicar);

      if (!t) {
        p.classList.add('is-empty');
        p.style.fill = '';
        const vazio = conteudoDoBalao(nome, 'Sem apuração', entrada, dicionario);
        p.onmousemove = (ev) => tip.mostrar(vazio, ev);
        p.onmouseleave = () => tip.esconder();
        return;
      }

      p.classList.remove('is-empty');
      p.style.fill = t.cor;
      p.style.fillOpacity = t.op.toFixed(2);

      const sub = APU.fmt.pct(entrada.pst || 0) + ' apurado';
      const html = conteudoDoBalao(nome, sub, entrada, dicionario);
      p.onmousemove = (ev) => tip.mostrar(html, ev);
      p.onmouseleave = () => tip.esconder();
    });
  }

  /* ------------------------------------------------------------ hemiciclo */

  /* Assentos em semicírculo, na geometria de buildSemicircleSeatPaths do
     visualizador (js/national-view.js): K anéis conforme o tamanho da casa,
     cadeiras por anel proporcionais ao raio, e a ordem final por ângulo — da
     esquerda para a direita, atravessando os anéis. Quem enche essa ordem são
     os blocos já postos na régua do espectro, então a esquerda fica à esquerda.

     Lá o arco sai do d3.arc; aqui a página não carrega o d3, então o setor é
     desenhado à mão, e o canto arredondado vem de um traço da mesma cor com
     junção redonda sobre o setor recuado — o mesmo desenho, sem a biblioteca. */
  function geometriaDoHemiciclo(total) {
    if (!(total > 0)) return [];

    let K = 7;
    if (total <= 10) K = 1; else if (total <= 30) K = 2; else if (total <= 60) K = 3;
    else if (total <= 120) K = 4; else if (total <= 200) K = 5; else if (total <= 350) K = 6;

    let Rmin = 180;
    let Rmax = 260;
    if (total <= 10) { Rmin = 235; Rmax = 250; }
    else if (total <= 30) { Rmin = 212; Rmax = 250; }
    else if (total <= 60) { Rmin = 205; Rmax = 255; }
    else if (total <= 120) { Rmin = 195; Rmax = 258; }
    else if (total <= 200) { Rmin = 190; Rmax = 260; }
    else if (total <= 350) { Rmin = 185; Rmax = 260; }

    const raios = [];
    if (K === 1) raios.push((Rmin + Rmax) / 2);
    else for (let r = 0; r < K; r++) raios.push(Rmin + r * (Rmax - Rmin) / (K - 1));

    const somaRaios = raios.reduce((s, r) => s + r, 0);
    const porAnel = raios.map((r) => Math.round(total * r / somaRaios));
    let diferenca = total - porAnel.reduce((s, v) => s + v, 0);
    let i = K - 1;
    while (diferenca !== 0) {
      if (diferenca > 0) { porAnel[i] += 1; diferenca -= 1; }
      else if (porAnel[i] > 1) { porAnel[i] -= 1; diferenca += 1; }
      i = (i - 1 + K) % K;
    }

    const margem = 0.06;
    const abertura = Math.PI - 2 * margem;
    const passo = K === 1 ? (Rmax - Rmin) : (Rmax - Rmin) / (K - 1);
    const espessura = passo * 0.88;
    const canto = Math.max(1.2, Math.min(3.5, espessura * 0.2));
    const assentos = [];

    for (let anel = 0; anel < K; anel++) {
      const n = porAnel[anel];
      const raio = raios[anel];
      const entre = n > 1 ? abertura / (n - 1) : 0;
      const largura = (abertura / n) * 0.93;
      /* Recuo do canto: o traço de `2 * canto` devolve exatamente o que sai aqui. */
      const r1 = raio - espessura / 2 + canto;
      const r2 = raio + espessura / 2 - canto;
      for (let s = 0; s < n; s++) {
        const theta = n === 1 ? Math.PI / 2 : (Math.PI - margem - s * entre);
        const meia = Math.max(0.0001, largura / 2 - canto / raio);
        assentos.push({ d: setor(r1, r2, theta - meia, theta + meia), theta, canto,
          x: raio * Math.cos(theta), y: -raio * Math.sin(theta) });
      }
    }

    assentos.sort((a, b) => b.theta - a.theta);
    /* Onde o semicírculo começa e acaba, para a linha da maioria cruzá-lo. */
    assentos.limites = [Rmin - espessura / 2, Rmax + espessura / 2];
    return assentos;
  }

  /* Semicírculo com anéis dados por quem chama: [{raio, n}], de dentro para
     fora. Serve ao Senado, que precisa de anéis inteiros para o terço mantido
     (miolo) e para os dois terços em disputa (periferia) — a partilha
     proporcional de geometriaDoHemiciclo cortaria um anel ao meio. Cada
     cadeira leva o índice do seu anel. */
  function geometriaDeAneis(aneis) {
    const margem = 0.06;
    const abertura = Math.PI - 2 * margem;
    const raios = aneis.map((a) => a.raio);
    const passo = raios.length > 1 ? (raios[raios.length - 1] - raios[0]) / (raios.length - 1) : 20;
    const espessura = passo * 0.88;
    const canto = Math.max(1.2, Math.min(3.5, espessura * 0.2));
    const assentos = [];
    aneis.forEach(({ raio, n }, anel) => {
      const entre = n > 1 ? abertura / (n - 1) : 0;
      const largura = (abertura / n) * 0.93;
      const r1 = raio - espessura / 2 + canto;
      const r2 = raio + espessura / 2 - canto;
      for (let s = 0; s < n; s++) {
        const theta = n === 1 ? Math.PI / 2 : (Math.PI - margem - s * entre);
        const meia = Math.max(0.0001, largura / 2 - canto / raio);
        assentos.push({ d: setor(r1, r2, theta - meia, theta + meia), theta, canto, anel,
          x: raio * Math.cos(theta), y: -raio * Math.sin(theta) });
      }
    });
    assentos.sort((a, b) => b.theta - a.theta);
    assentos.limites = [raios[0] - espessura / 2, raios[raios.length - 1] + espessura / 2];
    return assentos;
  }

  /* Geometria do desenho de bancada: um ponto por deputado, numa grade de
     linhas e colunas. A grade se enche coluna a coluna, de cima para baixo e
     da esquerda para a direita: como cada bloco recebe uma sequência contínua
     de lugares, os deputados de um partido ficam juntos, e dentro do partido
     o mais votado fica no alto da primeira coluna dele.

     Poucas linhas e muitas colunas, para a grade ser larga como o espaço do
     semicírculo (600 x 200 do viewBox), com o ponto no maior tamanho que cabe. */
  function geometriaDeGrade(total) {
    if (!(total > 0)) return [];
    const linhas = Math.max(1, Math.min(10, Math.round(Math.sqrt(total / 2.4))));
    const colunas = Math.ceil(total / linhas);
    const passo = Math.min(46, 560 / colunas, 200 / linhas);
    const x0 = 300 - (colunas * passo) / 2;
    const base = 296;
    const topo = base - linhas * passo;
    /* Quando o total não fecha as linhas, a última coluna fica incompleta e as
       linhas de baixo saem mais curtas. Cada linha é centralizada na largura da
       grade: com meio ponto de diferença, os pontos dela caem no meio dos de
       cima, em vez de encostados à esquerda. */
    const cheias = Math.floor(total / linhas);
    const sobra = total % linhas;
    const recuo = (lin) => ((colunas - (cheias + (lin < sobra ? 1 : 0))) * passo) / 2;
    const assentos = [];
    for (let i = 0; i < total; i++) {
      const col = Math.floor(i / linhas);
      const lin = i % linhas;
      assentos.push({ x: x0 + recuo(lin) + (col + 0.5) * passo, y: topo + (lin + 0.5) * passo,
        rp: passo * 0.42, col });
    }
    assentos.grade = { linhas, colunas, passo, x0, topo, base };
    return assentos;
  }

  /* Setor anular entre os ângulos a0 < a1 (radianos, 0 à direita, pi à
     esquerda), com o centro na origem e o y da tela para baixo. */
  function setor(r1, r2, a0, a1) {
    const p = (r, a) => (r * Math.cos(a)).toFixed(2) + ' ' + (-r * Math.sin(a)).toFixed(2);
    return 'M' + p(r2, a0) + 'A' + r2.toFixed(2) + ' ' + r2.toFixed(2) + ' 0 0 0 ' + p(r2, a1)
      + 'L' + p(r1, a1) + 'A' + r1.toFixed(2) + ' ' + r1.toFixed(2) + ' 0 0 1 ' + p(r1, a0) + 'Z';
  }

  const NS = 'http://www.w3.org/2000/svg';

  function noSvg(tag, attrs, texto) {
    const el = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    if (texto != null) el.textContent = texto;
    return el;
  }

  /* Desenha (ou só repinta) o hemiciclo num <svg viewBox="0 65 600 305">.

     Dois desenhos. Na casa inteira (a Câmara, as Assembleias somadas) cada
     cadeira é um setor, como no visualizador. Na bancada de um estado
     (`pontos`), cada cadeira é um ponto numa grade de linhas, e cada ponto é um
     deputado: os partidos lado a lado, cada um inteiro, e dentro dele os mais
     votados em cima — o primeiro da lista no alto da primeira coluna.

     Cadeira que o TSE ainda não declarou sai com meia opacidade: na casa
     inteira, as `declaradas` de cada bloco (UF com totalização final); na
     bancada, o candidato com situação oficial (APU.marcarLista).

     Os elementos ficam: a cada boletim só muda a cor de cada cadeira, e a
     transição do CSS a faz mudar no lugar. Só se reconstrói quando muda o
     tamanho da casa ou o desenho. */
  function hemiciclo(svg, blocos, total, opcoes) {
    if (!svg) return;
    const o = opcoes || {};
    const pontos = !!o.pontos;

    /* Quem ocupa cada cadeira, na ordem do espectro e, dentro do bloco, do
       mais ao menos votado. Com `miolo` ({aneis, blocos}), os anéis de dentro
       são de um grupo (o terço do Senado que não está em disputa) e os de
       fora, do outro — cada grupo enche a sua parte da esquerda para a direita. */
    const donosDe = (lista, limite) => {
      const donos = [];
      (lista || []).filter((b) => b.vagas > 0).slice().sort(APU.porEspectro).forEach((b) => {
        const dentro = (b.cand || []).filter((c) => c.dentro);
        for (let i = 0; i < b.vagas && donos.length < limite; i++) {
          const cand = dentro[i] || null;
          donos.push({ b, cand, oficial: cand ? !!cand.oficial : i < (b.declaradas || 0) });
        }
      });
      return donos;
    };

    const aneis = o.aneis || null;
    const desenho = total + '|' + (pontos ? 'pontos' : 'arcos')
      + (aneis ? '|' + aneis.map((a) => a.raio + 'x' + a.n).join(',') : '');
    if (svg.dataset.desenho !== desenho) {
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      svg.dataset.desenho = desenho;
      const geometria = pontos ? geometriaDeGrade(total)
        : (aneis ? geometriaDeAneis(aneis) : geometriaDoHemiciclo(total));
      const grupo = noSvg('g', pontos ? { class: 'apu-hemi-assentos' }
        : { transform: 'translate(300,360)', class: 'apu-hemi-assentos' });
      const [dentro, fora] = geometria.limites || [180, 266];
      geometria.forEach((a, i) => {
        grupo.appendChild(pontos
          ? noSvg('circle', { cx: a.x.toFixed(2), cy: a.y.toFixed(2), r: a.rp.toFixed(2),
            class: 'apu-hemi-assento is-ponto', 'data-i': i })
          : noSvg('path', { d: a.d, class: 'apu-hemi-assento', 'data-i': i,
            'stroke-width': (a.canto * 2).toFixed(2) }));
      });
      svg.appendChild(grupo);
      svg._apuGeo = geometria;
      if (pontos) {
        /* A grade é uma bancada, não um plenário: não há maioria a marcar.
           A linha da maioria fica só no semicírculo. */
        svg.appendChild(noSvg('text', { class: 'apu-hemi-total', x: 300, y: 340, 'text-anchor': 'middle' }));
        svg.appendChild(noSvg('text', { class: 'apu-hemi-rot', x: 300, y: 362, 'text-anchor': 'middle' }));
      } else {
        /* Linha da maioria: o meio do semicírculo. Cadeiras dos dois lados dela
           somam metade da casa cada um. */
        svg.appendChild(noSvg('line', {
          class: 'apu-hemi-maioria', x1: 300, x2: 300,
          y1: (360 - fora - 7).toFixed(1), y2: (360 - dentro + 7).toFixed(1)
        }));
        svg.appendChild(noSvg('text', { class: 'apu-hemi-total', x: 300, y: 332, 'text-anchor': 'middle' }));
        svg.appendChild(noSvg('text', { class: 'apu-hemi-rot', x: 300, y: 354, 'text-anchor': 'middle' }));
        svg.appendChild(noSvg('text', {
          class: 'apu-hemi-maioria-rot', x: 306, y: (360 - fora - 10).toFixed(1)
        }));
      }
    }

    /* A geometria vem na ordem de preencher — no semicírculo, por ângulo, da
       esquerda para a direita; na grade, coluna a coluna, de cima para baixo —,
       e cada bloco fica com uma faixa contínua dela, recebendo os deputados na
       ordem de voto. */
    const geo = svg._apuGeo || [];
    const porLugar = new Array(geo.length).fill(null);
    const todos = geo.map((_, i) => i);
    const grupos = o.miolo
      ? [{ lugares: todos.filter((i) => geo[i].anel < o.miolo.aneis), blocos: o.miolo.blocos },
        { lugares: todos.filter((i) => !(geo[i].anel < o.miolo.aneis)), blocos }]
      : [{ lugares: todos, blocos }];
    grupos.forEach((g) => {
      donosDe(g.blocos, g.lugares.length).forEach((d, k) => { porLugar[g.lugares[k]] = d; });
    });

    svg.querySelectorAll('.apu-hemi-assento').forEach((el) => {
      const d = porLugar[Number(el.dataset.i)];
      el.style.fill = d ? d.b.cor : '';
      el.style.stroke = d && !pontos ? d.b.cor : '';
      el.classList.toggle('is-vazio', !d);
      el.classList.toggle('is-provisorio', !!d && !d.oficial);
      el.dataset.chave = d ? d.b.chave : '';
    });

    const maioria = Math.floor(total / 2) + 1;
    svg.querySelector('.apu-hemi-total').textContent = APU.fmt.int(total);
    svg.querySelector('.apu-hemi-rot').textContent = o.rotulo || 'CADEIRAS';
    const rotMaioria = svg.querySelector('.apu-hemi-maioria-rot');
    if (rotMaioria) rotMaioria.textContent = 'Maioria: ' + APU.fmt.int(maioria);

    /* Balão e destaque do bloco sob o cursor. Ligados por delegação, uma vez
       por <svg>: o redesenho de cada boletim não acumula ouvintes. */
    svg._apuLugares = porLugar;
    svg._apuTotal = total;
    svg._apuOpcoes = o;
    if (!svg._apuLigado) {
      svg._apuLigado = true;
      const tip = balao();
      const sob = (ev) => {
        const alvo = ev.target.closest && ev.target.closest('.apu-hemi-assento');
        return alvo ? svg._apuLugares[Number(alvo.dataset.i)] : null;
      };
      svg.addEventListener('mousemove', (ev) => {
        const d = sob(ev);
        if (!d) { destacarBloco(svg, null); tip.esconder(); return; }
        destacarBloco(svg, d.b.chave);
        tip.mostrar(d.cand ? balaoDoCandidato(d.b, d.cand) : balaoDoBloco(d.b, svg._apuTotal), ev);
      });
      svg.addEventListener('mouseleave', () => { destacarBloco(svg, null); tip.esconder(); });
      svg.addEventListener('click', (ev) => {
        const d = sob(ev);
        if (d && typeof svg._apuOpcoes.aoClicar === 'function') {
          tip.esconder();
          svg._apuOpcoes.aoClicar(d.b);
        }
      });
    }
  }

  /* O que o TSE disse — ou ainda não disse — de um candidato da bancada
     (APU.marcarLista): situação da totalização final, eleito declarado, vaga
     firme com 100% totalizado, projeção, fora das vagas ou voto que não elege. */
  function situacaoDoCandidato(b, c) {
    if (c.semVaga) return 'Voto ' + String(c.destino).toLowerCase() + ': não ocupa vaga';
    if (c.situacao) return c.situacao + (c.dentro ? ', declarado pelo TSE' : ', segundo a totalização do TSE');
    if (!c.dentro) return c.votos > 0 ? 'Fora das vagas do partido neste boletim' : 'Ainda sem voto apurado';
    if (c.declarado) return 'Eleito, declarado pelo TSE';
    if (c.oficial) return 'Eleito: vaga distribuída pelo TSE com 100% das urnas apuradas';
    return 'Dentro das vagas na projeção deste boletim, na conta ' + (b.estimadas ? 'do ElectoMaps' : 'do TSE')
      + '; quem distribui os eleitos é o TSE, com 100% das urnas apuradas';
  }

  /* Balão de um candidato da bancada, no ponto do hemiciclo e na linha da lista.
     Tudo rente à margem esquerda: o nome sozinho no título, a cor junto do
     partido, e votos e posição em duas linhas com o valor na mesma borda. */
  function balaoDoCandidato(b, c) {
    if (c.mantido || c.uf) return balaoDoSenador(b, c);
    const partido = c.partido + (b.federacao ? ' · ' + b.rotulo : '');
    return '<div class="nyt-tooltip-container">'
      + '<div class="district-nyt-title">' + esc(c.urna || c.numero) + '</div>'
      + '<div class="district-nyt-sub"><span class="apu-swatch" style="background:' + b.cor
      + ';margin-right:6px"></span>' + esc(partido) + '</div>'
      + '<table class="district-nyt-table"><tbody>'
      + '<tr><td>Votos</td><td class="votes-cell winner">' + APU.fmt.int(c.votos) + '</td></tr>'
      + '<tr><td>Posição na lista</td><td class="votes-cell winner">' + c.pos + 'º</td></tr>'
      + '</tbody></table>'
      + '<div class="district-nyt-nota">' + esc(situacaoDoCandidato(b, c)) + '</div></div>';
  }

  /* Balão de uma cadeira do Senado: o senador que fica até 2031, ou o
     candidato que ocupa uma das duas vagas do estado neste boletim. */
  function balaoDoSenador(b, c) {
    const nomeUF = APU.UF_NOMES[c.uf] || String(c.uf || '').toUpperCase();
    const cabeca = '<div class="nyt-tooltip-container">'
      + '<div class="district-nyt-title">' + esc(APU.nomeProprio(c.urna || '')) + '</div>'
      + '<div class="district-nyt-sub"><span class="apu-swatch" style="background:' + b.cor
      + ';margin-right:6px"></span>' + esc(b.rotulo) + ' · ' + esc(nomeUF) + '</div>';
    if (c.mantido) {
      const ate = String(c.ate || '').slice(0, 4);
      return cabeca + '<div class="district-nyt-nota">Fora da disputa: mandato até ' + esc(ate || '2031')
        + (c.participacao && !/^titular$/i.test(c.participacao)
          ? '. ' + esc(c.participacao) + ' em exercício, no lugar do eleito em 2022' : ', eleito em 2022')
        + '.</div></div>';
    }
    const situacao = c.oficial ? 'Eleito, declarado pelo TSE'
      : (c.matematico ? 'Matematicamente eleito; o TSE ainda não declarou'
        : `${c.pos}º entre os votos válidos de ${nomeUF} neste boletim; as duas vagas do estado vão aos dois primeiros`);
    return cabeca + '<table class="district-nyt-table"><tbody>'
      + '<tr><td>Votos</td><td class="votes-cell winner">' + APU.fmt.int(c.votos) + '</td>'
      + '<td class="pct-cell">' + APU.fmt.pct(c.pct) + '</td></tr>'
      + '</tbody></table>'
      + '<div class="district-nyt-nota">' + esc(situacao) + '</div></div>';
  }

  /* Acende as cadeiras de um bloco e apaga as outras; `null` devolve todas. */
  function destacarBloco(svg, chave) {
    if (!svg) return;
    svg.classList.toggle('is-foco', !!chave);
    svg.querySelectorAll('.apu-hemi-assento').forEach((p) => {
      p.classList.toggle('is-foco', !!chave && p.dataset.chave === chave);
    });
  }

  function balaoDoBloco(b, total) {
    const sub = b.federacao ? b.siglas.join(' · ') : '';
    return '<div class="nyt-tooltip-container">'
      + '<div class="district-nyt-title"><span class="apu-swatch" style="background:' + b.cor
      + ';margin-right:7px"></span>' + esc(b.rotulo) + '</div>'
      + (sub ? '<div class="district-nyt-sub" style="padding-left:18px">' + esc(sub) + '</div>' : '')
      + '<table class="district-nyt-table"><tbody>'
      + '<tr><td>' + (b.vagas > (b.declaradas || 0) ? 'Cadeiras na projeção' : 'Cadeiras') + '</td>'
      + '<td class="votes-cell winner">' + APU.fmt.int(b.vagas)
      + '</td><td class="pct-cell">' + (total ? (100 * b.vagas / total).toFixed(1) : '0,0') + '%</td></tr>'
      + (b.votos == null ? '' : '<tr><td>Votos</td><td class="votes-cell">' + APU.fmt.int(b.votos)
        + '</td><td class="pct-cell">' + b.pct.toFixed(1) + '%</td></tr>')
      + '</tbody></table></div>';
  }

  /* Cláusula de desempenho de um bloco (APU.clausulaDeDesempenho): o veredito,
     e o balão com o apurado agora contra o mínimo de cada critério. */
  function veredictoDaClausula(a) {
    if (a.porCadeiras && a.porVotos) return 'Passa pelos deputados eleitos e pelos votos';
    if (a.porCadeiras) return 'Passa pelos deputados eleitos';
    if (a.porVotos) return 'Passa pelos votos';
    return 'Não passa: não cumpre nenhum dos dois mínimos';
  }

  function balaoDaClausula(a) {
    const b = a.bloco;
    const r = APU.CLAUSULA;
    const sub = b.federacao ? b.siglas.join(' · ') : '';
    const linha = (ok, rotulo, agora, minimo) => '<tr><td>' + (ok ? '✓ ' : '✗ ') + esc(rotulo) + '</td>'
      + '<td class="votes-cell' + (ok ? ' winner' : '') + '">' + agora + '</td>'
      + '<td class="pct-cell">' + minimo + '</td></tr>';
    return '<div class="nyt-tooltip-container">'
      + '<div class="district-nyt-title"><span class="apu-swatch" style="background:' + b.cor
      + ';margin-right:7px"></span>' + esc(b.rotulo) + '</div>'
      + (sub ? '<div class="district-nyt-sub" style="padding-left:18px">' + esc(sub) + '</div>' : '')
      + '<table class="district-nyt-table"><thead><tr><th></th><th>Agora</th><th>Mínimo</th></tr></thead>'
      + '<tbody>'
      + linha(a.cadeiras >= r.cadeiras, 'Deputados eleitos', APU.fmt.int(a.cadeiras), r.cadeiras)
      + linha(a.ufsCadeira >= r.ufsCadeira, 'UFs com deputado', APU.fmt.int(a.ufsCadeira), r.ufsCadeira)
      + linha(a.pct >= r.pct, 'Votos válidos no país', APU.fmt.pct(a.pct), APU.fmt.pct(r.pct))
      + linha(a.ufsVoto >= r.ufsVoto, `UFs com ${APU.fmt.pct(r.pctUF)} ou mais`,
        APU.fmt.int(a.ufsVoto), r.ufsVoto)
      + '</tbody></table>'
      + '<div class="district-nyt-nota">' + esc(veredictoDaClausula(a))
      + '. Basta cumprir um dos dois pares: deputados e UFs, ou votos e UFs.</div></div>';
  }

  /* Mosaico de cadeiras de uma casa pequena: pontos em grade, na ordem do
     espectro, com o mesmo número de colunas por faixa que os aglomerados do
     visualizador (createStateCircleDotsHTML). Serve ao cartão de cada estado. */
  function mosaico(blocos, total) {
    if (!(total > 0)) return '';
    const ordem = (blocos || []).filter((b) => b.vagas > 0).slice().sort(APU.porEspectro);
    const cores = [];
    ordem.forEach((b) => {
      for (let i = 0; i < b.vagas && cores.length < total; i++) {
        cores.push({ cor: b.cor, provisoria: i >= (b.declaradas || 0) });
      }
    });

    let colunas = 10;
    if (total <= 4) colunas = 2; else if (total <= 9) colunas = 3; else if (total <= 16) colunas = 4;
    else if (total <= 25) colunas = 5; else if (total <= 42) colunas = 6; else if (total <= 63) colunas = 8;
    const linhas = Math.ceil(total / colunas);
    const r = 4.2;
    const passo = r * 2 + 2;
    const w = colunas * passo - 2;
    const h = linhas * passo - 2;
    let pontos = '';
    for (let i = 0; i < total; i++) {
      const linha = Math.floor(i / colunas);
      const col = i % colunas;
      const naLinha = linha === linhas - 1 ? total - linha * colunas : colunas;
      const recuo = naLinha < colunas ? ((colunas - naLinha) * passo) / 2 : 0;
      pontos += '<circle cx="' + (r + recuo + col * passo).toFixed(1) + '" cy="' + (r + linha * passo).toFixed(1)
        + '" r="' + r + '"' + (cores[i]
          ? ' style="fill:' + cores[i].cor + '"' + (cores[i].provisoria ? ' class="is-provisorio"' : '')
          : ' class="is-vazio"') + '/>';
    }
    return '<svg class="apu-mosaico" viewBox="0 0 ' + w.toFixed(1) + ' ' + h.toFixed(1) + '" width="' + Math.ceil(w)
      + '" height="' + Math.ceil(h) + '" aria-hidden="true">' + pontos + '</svg>';
  }

  /* ---------------------------------------------------- cartões de estado */

  /* Ordem das células em bandeiras-estados.png. É a mesma que
     scripts/gerar_bandeiras_estados.py imprime ao gerar o sprite — se aquele
     script mudar de ordem, esta linha muda junto, ou cada estado passa a exibir
     a bandeira do vizinho. Fora da lista (o exterior, `zz`) fica sem chip. */
  const ORDEM_BANDEIRAS = ('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi '
    + 'pr rj rn ro rr rs sc se sp to').split(' ');

  /* Decorativa: o nome do estado está ao lado, então o leitor de tela não ganha
     nada repetindo "bandeira de São Paulo" antes dele. */
  function bandeira(uf) {
    const i = ORDEM_BANDEIRAS.indexOf(uf);
    return i < 0 ? ''
      : '<span class="apu-estado-bandeira" style="--bandeira:' + i + '" aria-hidden="true"></span>';
  }

  /* As 27 unidades, ordenadas por tamanho do eleitorado (TSE, 2022) — não é
     ranking de importância política, é onde mais gente vota. */
  const UFS_POR_ELEITORADO = ['sp', 'mg', 'rj', 'ba', 'rs', 'pr', 'pe', 'ce', 'pa', 'sc', 'go', 'ma',
    'am', 'es', 'pb', 'rn', 'mt', 'al', 'pi', 'df', 'ms', 'se', 'ro', 'to', 'ac', 'ap', 'rr'];

  /* Um cartão por estado, na grade de governador e na de senador. Com boletim
     mostra os dois primeiros; sem boletim, os dois primeiros da chapa
     registrada, todos em 0,00%. `href` leva à página do estado. */
  function cartaoEstado(uf, cargo, pacote, chapa, href) {
    const nome = APU.UF_NOMES[uf] || uf.toUpperCase();
    const entrada = pacote && pacote.abr && pacote.abr[uf];
    const dicionario = (pacote && pacote.cand) || {};
    const comVotos = !!(entrada && entrada.vv > 0);

    /* A marca sai da lista inteira, não do recorte: quem ocupa a segunda vaga do
       Senado é o segundo da UF, e cortar antes de marcar mudaria o índice. */
    const completa = comVotos ? APU.ranking(entrada, dicionario) : APU.rankingZerado(chapa, uf);
    if (comVotos) APU.marcar(completa, entrada, cargo);
    /* Os dois primeiros do placar e, se a marca de eleito ou de 2º turno caiu
       em alguém mais abaixo (porque um dos dois de cima teve o voto anulado),
       também ele: o cartão nunca esconde quem está eleito ou no 2º turno. */
    const lista = completa.slice(0, 2)
      .concat(completa.slice(2).filter((c) => c.marca === 'eleito' || c.marca === 'segundo'));
    const pst = entrada ? (entrada.pst || 0) : 0;

    if (!lista.length) {
      return '<a class="apu-estado is-vazio" href="' + href + '">'
        + '<div class="apu-estado-head">' + bandeira(uf)
        + '<span class="apu-estado-uf">' + esc(nome) + '</span></div>'
        + '<p class="apu-estado-vazio">sem lista importada</p></a>';
    }

    const linhas = lista.map((c, i) => {
      /* Check sólido quando é certo — declarado pelo TSE ou matematicamente
         definido: verde para eleito, azul para quem vai ao 2º turno.
         Tracejado quando ainda é leitura. */
      const marca = c.marca
        ? '<span class="apu-tique is-' + c.marca + (firme(c) ? '' : ' is-previsto')
          + '" title="' + esc(tituloDaMarca(c)) + '">' + icone('tique', 11) + '</span>'
        : '';
      return '<div class="apu-estado-linha ' + (i === 0 && comVotos ? 'is-lead' : '') + '"'
        + ' style="--cor-linha:' + APU.cor(c.partido) + '">'
        /* O nome encolhe com reticências; o check fica sempre inteiro ao lado,
           e o aviso de voto anulado também. */
        + '<span class="apu-estado-nome"><span class="apu-estado-nome-txt">' + esc(c.urna) + '</span>'
        + marca + (APU.votoAnulado(c)
          ? '<span class="apu-estado-anulado" title="' + esc(c.destino) + ': o voto não elege">anulado</span>'
          : '') + '</span>'
        + '<span class="apu-estado-pct">' + APU.fmt.pct(c.pct) + '</span></div>';
    }).join('');

    return '<a class="apu-estado" href="' + href + '">'
      + '<div class="apu-estado-head">' + bandeira(uf)
      + '<span class="apu-estado-uf">' + esc(nome) + '</span></div>'
      + linhas
      + '<div class="apu-estado-pe">'
      + '<div class="apu-mini"><span style="width:' + Math.min(100, pst) + '%;background:var(--ink)"></span></div>'
      + '<span class="apu-estado-apurado">' + APU.fmt.pct(pst) + ' apurado</span>'
      + '</div></a>';
  }

  /* Parâmetros que identificam a fonte de dados (`eleicao`, `dados`), mais os
     extras, para os links entre as páginas da apuração. */
  function paramsDeFonte(extra) {
    const q = new URLSearchParams();
    const atual = new URLSearchParams(location.search);
    ['eleicao', 'dados'].forEach((k) => { if (atual.get(k)) q.set(k, atual.get(k)); });
    Object.entries(extra || {}).forEach(([k, v]) => q.set(k, v));
    const s = q.toString();
    return s ? '?' + s : '';
  }

  /* ----------------------------------------- cabeçalho: cargos e estados */

  /* Para onde vai cada cargo, no país ou num estado. Majoritário no estado é a
     página da UF (mapa por município); no país, a página do cargo. Deputado vai
     sempre à página de deputados, com ou sem UF. */
  function hrefDoCargo(cargo, uf) {
    if (cargo === '0006' || cargo === '0007') {
      return 'apuracao-deputados.html' + paramsDeFonte(uf ? { cargo, uf } : { cargo });
    }
    if (uf) return 'apuracao-uf.html' + paramsDeFonte({ uf, cargo });
    const pagina = { '0001': 'apuracao-presidente.html', '0003': 'apuracao-governador.html',
      '0005': 'apuracao-senado.html' }[cargo];
    return pagina + paramsDeFonte(cargo === '0001' ? { cargo } : {});
  }

  const CARGOS_DO_SELETOR = [['0001', 'Presidente'], ['0003', 'Governador'], ['0005', 'Senador'],
    ['0006', 'Deputado federal'], ['0007', 'Deputado estadual']];

  /* Os cinco cargos, no mesmo lugar em todas as páginas da apuração. No DF a
     casa estadual é a Câmara Legislativa: o botão diz "Deputado distrital". */
  function seletorDeCargo(alvo, cargo, uf) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    const ativo = cargo === '0008' ? '0007' : cargo;
    el.innerHTML = CARGOS_DO_SELETOR.map(([cd, rotulo]) => {
      const nome = cd === '0007' && uf === 'df' ? 'Deputado distrital' : rotulo;
      const eh = cd === ativo;
      return `<a class="apu-cargo${eh ? ' is-ativo' : ''}" data-pagina-cargo="${cd}"`
        + (eh ? ' aria-current="page"' : '') + ` href="${esc(hrefDoCargo(cd, uf))}">${nome}</a>`;
    }).join('');
  }

  /* Brasil e as 27 unidades. Brasil leva à página do cargo no país; o estado,
     à página dele no mesmo cargo. */
  function barraDeUFs(alvo, cargo, uf) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    const ufs = ORDEM_BANDEIRAS;
    const chips = [['', 'Brasil']].concat(ufs.map((u) => [u, u.toUpperCase()]));
    el.innerHTML = '<div class="wrap apu-dep-ufs-in">' + chips.map(([u, rotulo]) => {
      const eh = u === (uf || '');
      return `<a class="apu-dep-uf${eh ? ' is-ativo' : ''}${u ? '' : ' is-brasil'}" data-uf="${u}"`
        + (eh ? ' aria-current="page"' : '') + ` title="${esc(u ? APU.UF_NOMES[u] : 'O país inteiro')}"`
        + ` href="${esc(hrefDoCargo(cargo === '0008' ? '0007' : cargo, u))}">${rotulo}</a>`;
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------- menu de cargos */

  /* O menu do topo é o mesmo nas quatro páginas (#menuCargos): só cargos. Os
     links ganham a fonte de dados da página (`eleicao` e `dados`), senão quem
     abre o ensaio ou o simulado cairia nos dados publicados ao trocar de
     página; e o cargo da página fica marcado. `cargo` vazio: nenhum (central).
     Deputado distrital (0008) marca Deputado estadual, que é onde ele mora. */
  function ligarMenu(cargo) {
    const menu = $('menuCargos');
    if (!menu) return;
    const atual = new URLSearchParams(location.search);
    const ativo = cargo === '0008' ? '0007' : (cargo || '');
    menu.querySelectorAll('a[data-cargo]').forEach((a) => {
      if (!a.dataset.base) a.dataset.base = a.getAttribute('href');
      const [caminho, ancora] = a.dataset.base.split('#');
      const [pagina, busca] = caminho.split('?');
      const q = new URLSearchParams(busca || '');
      ['eleicao', 'dados'].forEach((k) => { if (atual.get(k)) q.set(k, atual.get(k)); });
      const s = q.toString();
      a.href = pagina + (s ? '?' + s : '') + (ancora ? '#' + ancora : '');
      const eh = a.dataset.cargo === ativo;
      a.classList.toggle('is-ativo', eh);
      if (eh) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  /* ------------------------------------------------------------- projeção */

  /* Chance como fração dos cenários da projeção. Nunca 0% nem 100%: nos dois
     extremos o texto diz "menos de 1" e "mais de 99", porque a simulação não
     prova certeza — isso só o TSE declara. */
  function chance(p) {
    if (p > 0.99) return 'em mais de 99 de cada 100 cenários';
    if (p < 0.01) return 'em menos de 1 de cada 100 cenários';
    return `em ${Math.round(p * 100)} de cada 100 cenários`;
  }

  function chancePct(p) {
    if (p > 0.99) return '>99%';
    if (p < 0.01) return '<1%';
    return `${Math.round(p * 100)}%`;
  }

  return { selo, avisos, progresso, placar, participacao, chance, chancePct,
    legendaMarcas, firme, tituloDaMarca, balao, conteudoDoBalao, tinta, tom, faixa, legendaFaixas, pintarMapa,
    foto, esc, icone,
    hemiciclo, destacarBloco, mosaico, ligarMenu, balaoDoCandidato, situacaoDoCandidato,
    balaoDaClausula, veredictoDaClausula, bandeira, cartaoEstado, paramsDeFonte, UFS_POR_ELEITORADO,
    hrefDoCargo, seletorDeCargo, barraDeUFs, marcasDaEleicao, comDefinicaoDa };
})();
