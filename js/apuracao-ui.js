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

    const emAndamento = entrada && entrada.and === 's';
    const encerrada = entrada && entrada.and === 'f';

    if (live) {
      live.classList.toggle('is-off', !emAndamento);
      live.textContent = emAndamento ? 'Ao vivo' : (encerrada ? 'Encerrada' : 'Aguardando');
    }
    if (sim) sim.classList.toggle('is-on', APU.simulado(meta));
    if (carimbo) {
      const c = APU.carimbo(entrada);
      carimbo.textContent = c ? `Atualizado em ${c}` : '';
    }
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

  /* Registro pendente de julgamento e o estado normal de quase toda a lista
     nesta altura do calendario — marcar isso em cada linha nao informa nada.
     Indeferimento e renuncia, sim: mudam quem esta de fato na disputa. */
  function rotuloSituacao(c) {
    const st = String(c.situacao || '');
    if (!st || /^(Deferido|Aguardando)/i.test(st)) return '';
    return `<span class="apu-cand-sit">${esc(st)}</span>`;
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
    el.innerHTML = [
      cel(APU.fmt.int(entrada.te), 'Eleitorado'),
      cel(APU.fmt.int(entrada.comp), `Comparecimento<br>${APU.fmt.pct(APU.fmt.parte(entrada.comp, entrada.te))}`),
      cel(APU.fmt.int(entrada.abst), `Abstenção<br>${APU.fmt.pct(APU.fmt.parte(entrada.abst, entrada.te))}`),
      cel(APU.fmt.int(entrada.vv), 'Votos válidos'),
      cel(APU.fmt.int(entrada.vb), `Brancos<br>${APU.fmt.pct(APU.fmt.parte(entrada.vb, entrada.tv))}`),
      cel(APU.fmt.int(entrada.vn), `Nulos<br>${APU.fmt.pct(APU.fmt.parte(entrada.vn, entrada.tv))}`)
    ].join('');
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

  return { selo, progresso, placar, participacao, legenda, lideresDistintos, balao, pintarMapa, foto, esc };
})();
