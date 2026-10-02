/* ===========================================================================
   ElectoMaps — apuração do Senado

   As 81 cadeiras num semicírculo, como o da Câmara: no miolo, os 27 senadores
   eleitos em 2022, que ficam até 2031, com o partido de hoje (ou o suplente em
   exercício); na periferia, as 54 vagas de 2026, duas por estado, com os dois
   mais votados do momento onde já há voto (APU.senado). Os dois grupos vão da
   esquerda para a direita pela régua do espectro, e a periferia se reordena a
   cada boletim. Cadeira em disputa fica em meia opacidade até o TSE declarar
   o eleito.

   Lê a camada alta de senador ({ele}-0005-uf.json) e o retrato do Senado em
   exercício (resultados_geo/senado_em_exercicio.json).
   =========================================================================== */
'use strict';

(function () {

  const $ = (id) => document.getElementById(id);
  const esc = APUUI.esc;
  const CARGO = '0005';
  const UFS = APUUI.UFS_POR_ELEITORADO;

  /* Cinco anéis: os dois de dentro com as 27 cadeiras mantidas, os três de
     fora com as 54 em disputa. Cadeiras por anel crescendo com o raio, para o
     espaçamento ficar parecido de dentro para fora. */
  const ANEIS = [{ raio: 165, n: 13 }, { raio: 188, n: 14 },
    { raio: 211, n: 16 }, { raio: 234, n: 18 }, { raio: 257, n: 20 }];
  const ANEIS_DO_MIOLO = 2;

  const estado = { sen: null, chapa: null, emExercicio: null, timer: null };

  const hrefDaUF = (uf) => 'apuracao-uf.html' + APUUI.paramsDeFonte({ uf, cargo: CARGO });

  async function emExercicio() {
    try {
      const r = await fetch('resultados_geo/senado_em_exercicio.json');
      return r.ok ? await r.json() : { senadores: [] };
    } catch (e) {
      return { senadores: [] };
    }
  }

  /* --------------------------------------------- semicírculo e quadro */

  function palco(leitura) {
    const svg = $('hemiciclo');
    APUUI.hemiciclo(svg, leitura.disputa, APU.SENADO.total, {
      aneis: ANEIS,
      miolo: { aneis: ANEIS_DO_MIOLO, blocos: leitura.miolo },
      rotulo: 'CADEIRAS'
    });

    const emDisputa = leitura.disputa.reduce((s, b) => s + b.vagas, 0);
    const declaradas = leitura.disputa.reduce((s, b) => s + (b.declaradas || 0), 0);
    $('hemicicloLegenda').textContent = 'No miolo, os 27 senadores com mandato até 2031. Na periferia, as 54 vagas'
      + ' de 2026, com os dois mais votados de cada estado'
      + (emDisputa > declaradas ? '; em meia opacidade, até o TSE declarar o eleito.' : '.');

    /* Só o total de cadeiras. Antes da primeira urna, todo partido com
       candidatura entra, com o que tem do terço mantido; depois, só quem tem
       ao menos uma cadeira. */
    const linhas = leitura.quadro.filter((q) => !leitura.ufsComVoto || q.cadeiras > 0);
    $('quadro').innerHTML = linhas.map((q) => `<tr class="${q.cadeiras ? '' : 'is-sem'}" data-chave="${esc(q.chave)}">
        <td><span class="apu-lead-cell"><span class="apu-swatch" style="background:${q.cor}"></span>
          <span class="apu-dep-tab-nome">${esc(q.rotulo)}</span></span></td>
        <td class="num apu-dep-tab-cad">${APU.fmt.int(q.cadeiras)}</td>
      </tr>`).join('');
    $('quadro').querySelectorAll('tr[data-chave]').forEach((tr) => {
      tr.onmouseenter = () => APUUI.destacarBloco(svg, tr.dataset.chave);
      tr.onmouseleave = () => APUUI.destacarBloco(svg, null);
    });
    return { emDisputa, declaradas };
  }

  /* ---------------------------------------------------------- estados */

  function estados() {
    const pacote = estado.sen;
    $('gradeEstados').innerHTML = UFS
      .map((uf) => APUUI.cartaoEstado(uf, CARGO, pacote, estado.chapa, hrefDaUF(uf))).join('');
    const comVoto = pacote && pacote.abr
      ? UFS.filter((uf) => pacote.abr[uf] && pacote.abr[uf].vv > 0).length : 0;
    $('notaEstados').textContent = comVoto
      ? `${comVoto} de ${UFS.length} unidades com votos` : `${UFS.length} unidades federativas`;
  }

  /* ------------------------------------------------------------ ciclo */

  function pintar() {
    const pacote = estado.sen;
    const cab = APU.cabecalhoDe(pacote && pacote.abr);
    APUUI.seletorDeCargo('seletorCargo', CARGO, '');
    APUUI.barraDeUFs('seletorUF', CARGO, '');
    APUUI.ligarMenu(CARGO);
    APUUI.selo(pacote && pacote.meta, cab);
    APUUI.progresso(cab && cab.ts ? cab : null);

    const leitura = APU.senado(estado.emExercicio, pacote, estado.chapa);
    const { declaradas } = palco(leitura);
    $('subtitulo').textContent = '81 cadeiras · 54 em disputa'
      + (declaradas ? ` · ${declaradas} ${declaradas === 1 ? 'eleito declarado' : 'eleitos declarados'}` : '');
    estados();
  }

  async function atualizar() {
    if (estado.chapa === null) {
      [estado.chapa, estado.emExercicio] = await Promise.all([APU.candidaturas(CARGO), emExercicio()]);
    }
    const sen = await APU.snapshot('uf', CARGO);
    /* Boletim antigo vale mais que painel vazio: só substitui o que chegou. */
    if (sen) estado.sen = sen;
    pintar();
  }

  function agendar() {
    clearTimeout(estado.timer);
    if (document.visibilityState === 'hidden') return;
    estado.timer = setTimeout(async () => {
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

  (async function iniciar() {
    try {
      await atualizar();
    } catch (e) {
      console.warn('[apuracao] primeira carga falhou', e);
    }
    agendar();
  })();
})();
