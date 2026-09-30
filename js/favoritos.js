/* ===========================================================================
   ElectoMaps — eleições favoritas

   Guarda no navegador a eleição que está na tela e devolve ela num clique.

   O QUE É UMA FAVORITA. O contexto que decide QUAL apuração o mapa mostra:
   tipo (geral/municipal), ano, UF, município e cargo. O turno fica de fora de
   propósito — ele é um alternador dentro de uma eleição já carregada, e quase
   todo handler de seletor o zera de volta para 1; guardá-lo aqui seria brigar
   com o resto da página para restaurar algo que o usuário troca num clique.

   COMO ELA VOLTA. Não há um segundo caminho de carregamento aqui. Aplicar uma
   favorita é escrever nos mesmos <select> e clicar nos mesmos chips que a
   pessoa clicaria, e deixar os handlers de ui-controls.js fazerem o resto.
   Isso importa por dois motivos:

     - aqueles handlers carregam MUITO estado junto (limpam cache de zip,
       resetam filtros de censo, trocam a malha, repovoam o seletor de
       municípios). Um atalho que só chamasse o loader deixaria metade desse
       estado apontando para a eleição anterior;
     - todos terminam em scheduleInstantLoad(), que é debounced. Três
       `change` em sequência viram UMA carga, não três.

   A ORDEM DOS DISPAROS NÃO É ARBITRÁRIA:

     1. tipo   — o handler dele reseta tudo e troca quais caixas aparecem;
     2. UF     — no municipal, é ele que popula o <select> de municípios, então
                 tem de vir antes do município existir;
     3. ano    — chama updateCargoChipsVisibility(), que ESCONDE cargos que não
                 existem naquele ano (1989 só teve presidente) e, se o cargo
                 ativo for um deles, volta para presidente;
     4. cargo  — por último, justamente porque o passo 3 pode tê-lo derrubado.

   Inverter 3 e 4 restaura a eleição certa com o cargo errado, sem erro nenhum
   no console. É o bug que scripts/testar_favoritos.js existe para pegar.

   ONDE FICA. localStorage, chave `em_favoritos`, ao lado de `em_lang` e
   `em_consent`. Nada sai do navegador; está declarado em privacidade.html.
   =========================================================================== */
'use strict';

const FAVORITOS = (() => {

  const CHAVE = 'em_favoritos';

  /* ------------------------------------------------------------ persistência */

  /* Toda leitura e escrita passa por try/catch: em aba privada, com dados de
     site bloqueados, o próprio acesso a localStorage lança. A página tem de
     continuar funcionando sem favoritas, então a falha é silenciosa e o que
     sobra é uma lista vazia — nunca uma exceção que derruba o init(). */
  function ler() {
    try {
      const cru = JSON.parse(window.localStorage.getItem(CHAVE) || '[]');
      return Array.isArray(cru) ? cru.filter((f) => f && f.tipo && f.ano) : [];
    } catch (e) {
      return [];
    }
  }

  function gravar(lista) {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify(lista));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Identidade de uma favorita. É o que decide se o clique na estrela salva ou
     remove, então tem de conter exatamente os campos que mudam a eleição — nem
     mais (o rótulo entraria e duas favoritas iguais conviveriam) nem menos. */
  function id(f) {
    return [f.tipo, f.uf, f.ano, f.municipio, f.cargo, f.subtipo].join('|');
  }

  /* ---------------------------------------------------- leitura da tela */

  function seletores(tipo) {
    return tipo === 'municipal'
      ? { uf: dom.selectUFMunicipal, ano: dom.selectYearMunicipal, grupo: dom.officeChipsMunicipal }
      : { uf: dom.selectUFGeneral, ano: dom.selectYearGeneral, grupo: dom.cargoChipsGeneral };
  }

  function chipAtivo(grupo) {
    return grupo ? grupo.querySelector('.chip-button.active') : null;
  }

  /* A eleição que está na tela agora. */
  function atual() {
    const tipo = dom.selectElectionLevel?.value === 'municipal' ? 'municipal' : 'geral';
    const s = seletores(tipo);
    const cargo = chipAtivo(s.grupo);
    /* Ordinária/suplementar é um grupo de chips separado, montado em tempo de
       execução, e só existe nos anos que tiveram suplementar. Sem chip ativo o
       campo fica vazio, e aplicar depois não tenta clicar em nada. */
    const sub = tipo === 'geral' ? chipAtivo(dom.cargoChipsGeneralSubtype) : null;

    return {
      tipo,
      uf: s.uf?.value || '',
      ano: s.ano?.value || '',
      municipio: tipo === 'municipal' ? (dom.selectMunicipio?.value || '') : '',
      cargo: cargo?.dataset.value || '',
      subtipo: sub?.dataset.type || ''
    };
  }

  /* Rótulo do chip, montado na hora de salvar e guardado junto. Poderia ser
     recalculado na renderização, mas aí dependeria de o <select> ainda estar
     naquela UF e de o chip daquele cargo ainda existir na tela — que é
     justamente o que deixa de valer quando a pessoa navega para outra eleição.
     Guardar o texto é uma linha de JSON e não tem essa dependência. */
  function rotuloDe(f) {
    const s = seletores(f.tipo);
    const chip = s.grupo
      ? [...s.grupo.querySelectorAll('.chip-button')].find((b) => b.dataset.value === f.cargo)
      : null;
    const cargo = (chip?.textContent || f.cargo || '—').trim();

    const nomeMun = (typeof toTitleCase === 'function')
      ? toTitleCase(f.municipio) : f.municipio;
    const lugar = f.municipio ? `${nomeMun}/${f.uf}`
      : (f.uf === 'BR' ? 'Brasil' : (f.uf || '—'));

    return `${f.ano} · ${cargo}${f.subtipo === 'sup' ? ' (sup.)' : ''} · ${lugar}`;
  }

  /* --------------------------------------------------------- aplicar */

  /* Escreve no <select> e avisa a página. `select.value = x` já atualiza o
     rótulo do dropdown customizado (ui-helpers.js sobrescreve o setter), mas
     NÃO dispara `change` — quem carrega dados são os handlers, então o evento
     tem de ser explícito. Se o valor já é o desejado, não mexe: cada `change`
     desnecessário limpa caches e refaz trabalho. */
  function definir(select, valor) {
    if (!select || !valor || select.value === valor) return false;
    select.value = valor;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  function clicarChip(grupo, seletor) {
    const btn = grupo ? grupo.querySelector(seletor) : null;
    /* Chip escondido é cargo que não existe naquele ano (updateCargoChipsVisibility).
       Clicar nele restauraria um cargo impossível; a página já caiu para
       presidente sozinha, e dizer isso é mais honesto que fingir que deu. */
    if (!btn || btn.classList.contains('hidden')) return false;
    if (btn.classList.contains('active')) return false;
    btn.click();
    return true;
  }

  function aplicar(f) {
    definir(dom.selectElectionLevel, f.tipo);

    const s = seletores(f.tipo);
    definir(s.uf, f.uf);

    if (f.tipo === 'municipal') {
      /* O município vem do <select> que o handler da UF acabou de popular.
         Atribuir um nome que não está na lista deixa o value em '' e a página
         entende "voltar ao resumo estadual" — falha silenciosa, e foi o que o
         comentário de popularMunicipiosDaUF já documentou uma vez. */
      const existe = f.municipio && dom.selectMunicipio
        && [...dom.selectMunicipio.options].some((o) => o.value === f.municipio);
      if (f.municipio && !existe) {
        avisar(`${f.municipio} não está no índice de ${f.uf}; abrindo o resumo estadual.`);
      }
      definir(s.ano, f.ano);
      if (existe) definir(dom.selectMunicipio, f.municipio);
    } else {
      definir(s.ano, f.ano);
    }

    /* Cargo depois do ano: ver a nota de ordem no topo do arquivo. */
    if (f.cargo) {
      const alvo = s.grupo?.querySelector(`.chip-button[data-value="${f.cargo}"]`);
      if (alvo && alvo.classList.contains('hidden')) {
        avisar(`${f.ano} não tem esse cargo; abrindo presidente.`);
      } else {
        clicarChip(s.grupo, `.chip-button[data-value="${f.cargo}"]`);
      }
    }
    if (f.tipo === 'geral' && f.subtipo) {
      clicarChip(dom.cargoChipsGeneralSubtype, `.chip-button[data-type="${f.subtipo}"]`);
    }

    sincronizar();
  }

  function avisar(msg, tipo) {
    if (typeof showToast === 'function') showToast(msg, tipo);
    else console.warn('[favoritos]', msg);
  }

  /* ------------------------------------------------------------ alternar */

  function alternar() {
    const f = atual();
    if (!f.ano || !f.cargo) {
      avisar('Escolha uma eleição antes de favoritar.');
      return;
    }
    const lista = ler();
    const chave = id(f);
    const i = lista.findIndex((x) => id(x) === chave);

    if (i >= 0) {
      lista.splice(i, 1);
      if (gravar(lista)) avisar('Removida das favoritas.');
    } else {
      lista.push({ ...f, rotulo: rotuloDe(f) });
      if (!gravar(lista)) {
        avisar('Não foi possível salvar: o navegador está bloqueando o armazenamento local.', 'error');
        return;
      }
      avisar('Salva nas favoritas.');
    }
    desenhar();
    sincronizar();
  }

  /* ------------------------------------------------------------ desenho */

  const ESTRELA_CHEIA = '★';
  const ESTRELA_VAZIA = '☆';

  function desenhar() {
    const caixa = document.getElementById('favoritosBox');
    const chips = document.getElementById('favoritosChips');
    if (!caixa || !chips) return;

    const lista = ler();
    caixa.hidden = lista.length === 0;

    const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

    chips.innerHTML = lista.map((f) => {
      const chave = esc(id(f));
      const rot = esc(f.rotulo || rotuloDe(f));
      return `<span class="fav-item">`
        + `<button type="button" class="chip-button fav-ir" data-fav="${chave}"`
        + ` title="Abrir ${rot}">${rot}</button>`
        + `<button type="button" class="chip-button fav-remover" data-remover="${chave}"`
        + ` title="Remover ${rot} das favoritas" aria-label="Remover ${rot} das favoritas">×</button>`
        + `</span>`;
    }).join('');
  }

  /* Estado da estrela. Roda a cada mudança de contexto, então é só comparação
     de string — nada de I/O além da leitura do localStorage, que é síncrona e
     minúscula. */
  function sincronizar() {
    const btn = document.getElementById('btnFavoritar');
    if (!btn) return;
    const f = atual();
    const salva = ler().some((x) => id(x) === id(f));
    btn.classList.toggle('is-salva', salva);
    btn.setAttribute('aria-pressed', salva ? 'true' : 'false');
    btn.textContent = salva
      ? `${ESTRELA_CHEIA} Nas favoritas`
      : `${ESTRELA_VAZIA} Favoritar esta eleição`;
    btn.title = salva
      ? 'Remover esta eleição das favoritas'
      : 'Guardar esta eleição para abrir depois num clique';
  }

  /* --------------------------------------------------------------- ligação */

  function setup() {
    const btn = document.getElementById('btnFavoritar');
    const chips = document.getElementById('favoritosChips');
    if (!btn || !chips) return;

    btn.addEventListener('click', alternar);

    chips.addEventListener('click', (e) => {
      const remover = e.target.closest('[data-remover]');
      if (remover) {
        const lista = ler().filter((f) => id(f) !== remover.dataset.remover);
        gravar(lista);
        desenhar();
        sincronizar();
        return;
      }
      const ir = e.target.closest('[data-fav]');
      if (!ir) return;
      const f = ler().find((x) => id(x) === ir.dataset.fav);
      if (f) aplicar(f);
    });

    /* A estrela tem de saber onde a pessoa está. Estes são todos os controles
       que mudam a eleição; os listeners entram depois dos de setupControls(),
       então `currentOffice` e companhia já estão atualizados quando rodamos. */
    ['selectElectionLevel', 'selectUFGeneral', 'selectYearGeneral',
      'selectUFMunicipal', 'selectYearMunicipal', 'selectMunicipio']
      .forEach((nome) => document.getElementById(nome)
        ?.addEventListener('change', sincronizar));

    [dom.cargoChipsGeneral, dom.cargoChipsGeneralSubtype, dom.officeChipsMunicipal]
      .forEach((g) => g?.addEventListener('click', sincronizar));

    desenhar();
    sincronizar();
  }

  return { setup, ler, gravar, id, atual, aplicar, rotuloDe, alternar, desenhar, sincronizar, CHAVE };
})();

window.setupFavoritos = FAVORITOS.setup;
