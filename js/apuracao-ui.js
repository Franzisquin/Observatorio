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
      const g = meta && meta.idg ? ` · geração ${meta.idg}` : '';
      carimbo.textContent = c ? `Totalizado em ${c}${g}` : '';
    }
  }

  /* ---------------------------------------------------------------- avisos */

  /* As três coisas que uma tela de apuração precisa dizer e quase nenhuma diz:
     que a divulgação presidencial ainda está bloqueada, que a eleição terminou
     sem eleito, e quanto eleitorado ainda falta contar. Tudo num só lugar. */
  function avisos(entrada, lista, alvo) {
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

    const falta = APU.faltam(entrada, lista);
    if (falta && falta.eleitorado > 0) {
      const dif = falta.diferenca != null
        ? ` A diferença entre o primeiro e o segundo colocado é de ${APU.fmt.int(falta.diferenca)} votos, `
          + `então o que falta ${falta.alcancavel ? 'ainda pode' : 'já não'} alterar a ordem.`
        : '';
      partes.push(`<strong>${APU.fmt.int(falta.eleitorado)} eleitores</strong> em `
        + `${APU.fmt.int(falta.secoes)} seções ainda não totalizadas.` + dif);
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
          + (entrada.snt ? ` · faltam ${APU.fmt.int(entrada.snt)}` : '')
        : 'seções totalizadas';
    }
  }

  function rotuloSituacao(c) {
    const st = String(c.situacao || '');
    /* Registro pendente é o estado normal de quase toda a lista, e "Não eleito"
       é o estado normal de quase todo candidato depois da totalização: marcar
       qualquer um dos dois em cada linha não informa nada. O que informa são as
       situações do art. 215 — eleito por quociente, eleito por média, suplente —
       e as que mudam quem está de fato na disputa. */
    const muda = st && !/^(Deferido|Aguardando|N[ãa]o eleit)/i.test(st);
    const chips = [];
    if (muda) chips.push(`<span class="apu-cand-sit">${esc(st)}</span>`);
    /* dvt: a destinação do voto. Anulado e sub judice mudam a leitura do número
       que está ao lado — é o que o art. 265 §2 manda informar. */
    if (/anulado/i.test(String(c.destino || ''))) {
      chips.push(`<span class="apu-cand-sit is-anulado">${esc(c.destino)}</span>`);
    }
    if (!muda && c.eleito) chips.push('<span class="apu-cand-sit is-eleito">Eleito</span>');
    return chips.join('');
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
       inteira estouraria a altura do mapa. O resto entra pelo botão. */
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
      };
      el.appendChild(botao);
    }
  }

  /* --------------------------------------------------------- participação */

  function participacao(entrada, alvo) {
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
    el.innerHTML = celulas.filter(([mostrar]) => mostrar)
      .map(([, v, l]) => cel(v, l)).join('');
  }

  /* ----------------------------------------------------- saúde do plantão */

  /* O gargalo de uma cobertura ao vivo não é a ideia, é o coletor aguentar seis
     horas sem ser bloqueado. Última geração lida, requisições, 404 e atraso em
     relação à hora da totalização — o teto é 100 requisições por IP por segundo,
     e um 404 repetido bloqueia igual a excesso, por dez minutos renováveis. */
  function saude(estado, alvo) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    if (!estado) { el.hidden = true; return; }
    el.hidden = false;

    const req = estado.req || {};
    const br = estado.abrangencia || {};
    const minutos = Math.round((estado.segundos || 0) / 60);
    const cel = (v, l, alarme) => `<div${alarme ? ' class="is-alarme"' : ''}>`
      + `<div class="apu-stat-v">${v}</div><div class="apu-stat-l">${l}</div></div>`;

    /* As três regras do TSE, cada uma com o seu número na tela: teto de 100
       requisições por IP por segundo, bloqueio de 10 minutos renovável, e 404
       que pune igual a excesso. Número sem alarme não serve de nada numa noite
       de seis horas, então cada um acende quando sai da faixa segura. */
    const taxa = estado.taxa_medida != null
      ? estado.taxa_medida
      : (req.get || 0) / Math.max(1, estado.segundos || 1);
    const bloqueios = req.bloqueios || 0;
    const pausado = estado.bloqueado_por || 0;

    el.classList.toggle('is-alarme', bloqueios > 0 || pausado > 0);

    el.innerHTML = '<div class="apu-stats">' + [
      cel(esc(estado.ambiente || '—'),
        'Ambiente' + (estado.fase === 's' ? '<br>fase simulada' : '')),
      cel(APU.fmt.int(estado.volta), `Voltas<br>${minutos} min de plantão`),
      cel(APU.fmt.int(req.get), `Requisições<br>${APU.fmt.int(req['304'])} não modificadas`),
      cel(taxa.toFixed(1) + '/s', 'Taxa média<br>teto do TSE: 100/s', taxa > 80),
      cel(APU.fmt.int(bloqueios),
        pausado > 0
          ? `<strong>Pausado por ${Math.ceil(pausado / 60)} min</strong><br>bloqueio do TSE`
          : 'Bloqueios<br>' + (bloqueios ? 'já houve punição' : 'nenhuma punição'),
        bloqueios > 0),
      cel(APU.fmt.int(req['404']),
        `404 recebidos<br>${APU.fmt.int(req.evitados)} repetições evitadas`,
        (req['404'] || 0) > 0),
      cel(((req.bytes || 0) / 1e6).toFixed(1) + ' MB', 'Tráfego lido'),
      cel(br.pst != null ? APU.fmt.pct(br.pst) : '—',
        br.ht ? `Totalizado às ${esc(br.ht)}` : 'Apurado no país')
    ].join('') + '</div>';
  }

  /* -------------------------------------------------------------- legenda */

  function legenda(lideres, alvo) {
    const el = typeof alvo === 'string' ? $(alvo) : alvo;
    if (!el) return;
    el.innerHTML = lideres.map((l) =>
      `<span class="apu-legend-item">
         <span class="apu-swatch" style="background:${APU.cor(l.partido)}"></span>
         ${esc(l.urna || l.nome)}${l.partido ? ' <span style="color:var(--muted)">(' + esc(l.partido) + ')</span>' : ''}
         <span style="color:var(--muted)">· ${l.n}</span>
       </span>`).join('');
  }

  /* Quem lidera onde, para montar a legenda sem repetir nome. */
  function lideresDistintos(entradas, dicionario) {
    const conta = {};
    entradas.forEach((e) => {
      const l = APU.lider(e, dicionario);
      if (!l) return;
      if (!conta[l.chave]) conta[l.chave] = { ...l, n: 0 };
      conta[l.chave].n++;
    });
    return Object.values(conta).sort((a, b) => b.n - a.n);
  }

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
        + '<div class="district-nyt-sub">' + esc(subtitulo) + '</div>'
        + '<div class="district-nyt-nota">Sem votos apurados.</div></div>';
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
      const l = entrada ? APU.lider(entrada, dicionario) : null;

      /* O clique não depende de já haver voto: antes do primeiro boletim o mapa
         inteiro está vazio e ainda assim precisa responder. */
      p.onclick = aoClicar ? () => { tip.esconder(); aoClicar(chave, nome); } : null;
      p.classList.toggle('is-click', !!aoClicar);

      if (!l || !entrada.vv) {
        p.classList.add('is-empty');
        p.style.fill = '';
        const vazio = conteudoDoBalao(nome, 'Sem apuração', entrada, dicionario);
        p.onmousemove = (ev) => tip.mostrar(vazio, ev);
        p.onmouseleave = () => tip.esconder();
        return;
      }

      p.classList.remove('is-empty');
      p.style.fill = APU.cor(l.partido);
      /* Margem baixa = cor mais lavada. Dá a leitura de disputa sem inventar
         uma escala que o dado não tem. */
      const segundo = APU.ranking(entrada, dicionario)[1];
      const margem = segundo ? l.pct - segundo.pct : l.pct;
      p.style.fillOpacity = (0.42 + Math.min(0.58, margem / 55)).toFixed(2);

      const sub = APU.fmt.pct(entrada.pst || 0) + ' apurado';
      const html = conteudoDoBalao(nome, sub, entrada, dicionario);
      p.onmousemove = (ev) => tip.mostrar(html, ev);
      p.onmouseleave = () => tip.esconder();
    });
  }

  return { selo, avisos, progresso, placar, participacao, saude, legenda,
    lideresDistintos, balao, pintarMapa, foto, esc };
})();
