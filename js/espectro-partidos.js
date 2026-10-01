/* ===========================================================================
   ElectoMaps — regua do espectro politico

   Ordem esquerda -> direita em que os partidos ocupam o hemiciclo. Uma regua
   so para o site inteiro: o visualizador (js/national-view.js) enche o
   semicirculo da Camara e das Assembleias por ela, e a apuracao ao vivo
   (js/apuracao-deputados.js) enche o seu pela mesma ordem. Mexeu aqui, mexeu
   nos dois.

   Recebe sigla, nome de federacao ou composicao ("PT/PCDOB/PV"); o que nao
   reconhece vai para o fim (999), e o desempate fica com quem chama.
   =========================================================================== */
'use strict';

function getPartySpectrumRank(partyRaw, yearInput) {
  const year = parseInt(yearInput || (typeof STATE !== 'undefined' && STATE.currentElectionYear) || 2022, 10);
  const str = String(partyRaw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  const isMatch = (...list) => list.some((item) => (
    str === item ||
    str.startsWith(item + '/') ||
    str.endsWith('/' + item) ||
    str.includes('/' + item + '/') ||
    str.startsWith(item + ' ') ||
    str.includes(' ' + item)
  ));

  if (isMatch('PL')) {
    return year <= 2006 ? 25 : 34;
  }

  if (isMatch('PCO')) return 1;
  if (isMatch('PSTU')) return 2;
  if (isMatch('PCB')) return 3;
  if (isMatch('UP', 'UNIDADE POPULAR')) return 4;
  if (isMatch('PPL')) return 5;
  if (isMatch('PSOL', 'PSOL/REDE', 'REDE/PSOL')) return 6;
  if (isMatch('PCDOB', 'PC DO B')) return 7;
  if (isMatch('PT', 'FE BRASIL', 'FEDERACAO BRASIL DA ESPERANCA', 'PT/PCDOB/PV')) return 8;
  if (isMatch('REDE')) return 9;
  if (isMatch('PV')) return 10;
  if (isMatch('PDT')) return 11;
  if (isMatch('PSB')) return 12;
  // Mobiliza e o PMN renomeado (2023): mesmo lugar na regua.
  if (isMatch('PMN', 'MOBILIZA')) return 13;
  if (isMatch('PPS', 'CIDADANIA')) return 14;
  if (isMatch('AVANTE', 'PTDOB', 'PT DO B')) return 15;
  if (isMatch('SOLIDARIEDADE', 'SD')) return 16;
  if (isMatch('PROS')) return 16.5;
  if (isMatch('MDB', 'PMDB')) return 17;
  if (isMatch('PSD')) return 18;
  if (isMatch('PSDB', 'PSDB/CIDADANIA', 'CIDADANIA/PSDB', 'FEDERACAO PSDB CIDADANIA')) return 19;
  if (isMatch('PRP')) return 20;
  if (isMatch('PHS')) return 21;
  if (isMatch('AGIR', 'PTC', 'PRN')) return 22;
  if (isMatch('DC', 'PSDC', 'PDC')) return 23;
  if (isMatch('PMB', 'DEMOCRATA')) return 24;
  if (isMatch('PR')) return 25;
  if (isMatch('PTB')) return 26;
  if (isMatch('PODE', 'PODEMOS', 'PTN')) return 27;
  if (isMatch('REPUBLICANOS', 'PRB', 'REP')) return 28;
  if (isMatch('PP', 'PPB', 'PPR')) return 29;
  if (isMatch('UNIAO', 'UNIAO BRASIL', 'DEM', 'DEMOCRATAS', 'PFL')) return 30;
  if (isMatch('PSC')) return 31;
  if (isMatch('PATRIOTA', 'PATRI', 'PEN')) return 32;
  if (isMatch('PRD')) return 33;
  if (isMatch('NOVO')) return 35;
  // Missao (registrado em 2025): liberal-conservador, ao lado do NOVO.
  if (isMatch('MISSAO')) return 35.5;
  if (isMatch('PRTB')) return 36;

  return 999;
}
window.getPartySpectrumRank = getPartySpectrumRank;
