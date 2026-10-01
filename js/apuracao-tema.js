/* ===========================================================================
   ElectoMaps — tema da apuração

   Escuro de saída, como o visualizador e o simulador; o botão da barra do topo
   troca para o claro, e a escolha fica guardada no navegador e vale para as
   três páginas. O escuro já vem escrito no <html>: este arquivo só entra para
   trocar, e roda no <head>, antes da primeira pintura, para a página não abrir
   num tema e piscar para o outro.

   O mapa em MapLibre da presidencial lê as cores do CSS uma vez; o evento
   `apu-tema` é o aviso para ele se repintar.
   =========================================================================== */
'use strict';

(function () {

  const CHAVE = 'apuracao_tema';
  const raiz = document.documentElement;

  // localStorage pode estar bloqueado (modo anônimo, cookies de terceiros).
  let salvo = null;
  try { salvo = localStorage.getItem(CHAVE); } catch (e) { /* segue no padrão */ }
  if (salvo === 'light' || salvo === 'dark') raiz.dataset.theme = salvo;

  /* Os mesmos ícones do visualizador: a lua no escuro, o sol no claro. */
  const LUA = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>';
  const SOL = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41'
    + 'M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';

  function desenhar(botao) {
    const escuro = raiz.dataset.theme !== 'light';
    botao.querySelector('svg').innerHTML = escuro ? LUA : SOL;
    const rotulo = escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
    botao.setAttribute('aria-label', rotulo);
    botao.title = rotulo;
  }

  document.addEventListener('DOMContentLoaded', () => {
    const botao = document.getElementById('trocarTema');
    if (!botao) return;
    desenhar(botao);
    botao.addEventListener('click', () => {
      raiz.dataset.theme = raiz.dataset.theme === 'light' ? 'dark' : 'light';
      try { localStorage.setItem(CHAVE, raiz.dataset.theme); } catch (e) { /* ok */ }
      desenhar(botao);
      window.dispatchEvent(new Event('apu-tema'));
    });
  });
})();
