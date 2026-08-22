// GERADO por scripts/gerar_numeros_partidos.py — nao editar a mao.
//
// Numero do partido -> sigla VIGENTE NAQUELA ELEICAO. O voto de legenda chega
// com id de dois digitos e metadado "PARTIDO 19" no lugar da sigla; traduzir
// pelo nome de hoje (PODEMOS) impede o casamento com a composicao da coligacao
// da epoca (PTN) e joga o partido para fora do seu grupo.
//
// Extraido dos proprios metadados de candidato do acervo, onde a sigla ja e a
// da epoca e o numero do candidato comeca pelo numero do partido.
const PARTY_NUMBER_BY_YEAR = {
  '1994': { '11': 'PPR', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PTRB', '20': 'PSC', '21': 'PCB', '22': 'PL', '23': 'PPS', '25': 'PFL', '33': 'PMN', '36': 'PRN', '39': 'PP', '40': 'PSB', '41': 'PSD', '43': 'PV', '44': 'PRP', '45': 'PSDB', '56': 'PRONA', '65': 'PC DO B', '70': 'PT DO B' },
  '2000': { '11': 'PPB', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PSL', '18': 'PST', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PL', '23': 'PPS', '25': 'PFL', '26': 'PAN', '27': 'PSDC', '28': 'PRTB', '29': 'PCO', '30': 'PGT', '31': 'PHS', '33': 'PMN', '36': 'PRN', '40': 'PSB', '41': 'PSD', '43': 'PV', '44': 'PRP', '45': 'PSDB', '56': 'PRONA', '65': 'PC do B', '70': 'PT do B' },
  '2002': { '11': 'PPB', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PSL', '18': 'PST', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PL', '23': 'PPS', '25': 'PFL', '26': 'PAN', '27': 'PSDC', '28': 'PRTB', '29': 'PCO', '30': 'PGT', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '41': 'PSD', '43': 'PV', '44': 'PRP', '45': 'PSDB', '56': 'PRONA', '65': 'PC do B', '70': 'PT do B' },
  '2004': { '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PSL', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PL', '23': 'PPS', '25': 'PFL', '26': 'PAN', '27': 'PSDC', '28': 'PRTB', '29': 'PCO', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '56': 'PRONA', '65': 'PC do B', '70': 'PT do B' },
  '2006': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PSL', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PL', '23': 'PPS', '25': 'PFL', '26': 'PAN', '27': 'PSDC', '28': 'PRTB', '29': 'PCO', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '56': 'PRONA', '65': 'PC do B', '70': 'PT do B' },
  '2008': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '17': 'PSL', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PR', '23': 'PPS', '25': 'DEM', '27': 'PSDC', '28': 'PRTB', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '65': 'PC do B', '70': 'PT do B' },
  '2010': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PSL', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PR', '23': 'PPS', '25': 'DEM', '27': 'PSDC', '28': 'PRTB', '29': 'PCO', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '65': 'PC do B', '70': 'PT do B' },
  '2012': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '17': 'PSL', '19': 'PTN', '20': 'PSC', '22': 'PR', '23': 'PPS', '25': 'DEM', '27': 'PSDC', '28': 'PRTB', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '54': 'PPL', '55': 'PSD', '65': 'PC do B', '70': 'PT do B' },
  '2014': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '16': 'PSTU', '17': 'PSL', '19': 'PTN', '20': 'PSC', '21': 'PCB', '22': 'PR', '23': 'PPS', '25': 'DEM', '27': 'PSDC', '28': 'PRTB', '29': 'PCO', '31': 'PHS', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '51': 'PATRIOTA', '54': 'PPL', '55': 'PSD', '65': 'PC do B', '70': 'PT do B', '77': 'SD', '90': 'PROS' },
  '2016': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'PMDB', '17': 'PSL', '18': 'REDE', '19': 'PTN', '20': 'PSC', '22': 'PR', '23': 'PPS', '25': 'DEM', '27': 'PSDC', '28': 'PRTB', '31': 'PHS', '33': 'PMN', '35': 'PMB', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '51': 'PATRIOTA', '54': 'PPL', '55': 'PSD', '65': 'PC do B', '70': 'PT do B', '77': 'SD', '90': 'PROS' },
  '2018': { '10': 'PRB', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'MDB', '16': 'PSTU', '17': 'PSL', '18': 'REDE', '19': 'PODE', '20': 'PSC', '21': 'PCB', '22': 'PR', '23': 'PPS', '25': 'DEM', '27': 'DC', '28': 'PRTB', '29': 'PCO', '30': 'NOVO', '31': 'PHS', '33': 'PMN', '35': 'PMB', '36': 'PTC', '40': 'PSB', '43': 'PV', '44': 'PRP', '45': 'PSDB', '50': 'PSOL', '51': 'PATRIOTA', '54': 'PPL', '55': 'PSD', '65': 'PC do B', '70': 'AVANTE', '77': 'SOLIDARIEDADE', '90': 'PROS' },
  '2020': { '10': 'REPUBLICANOS', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'MDB', '17': 'PSL', '18': 'REDE', '19': 'PODE', '20': 'PSC', '22': 'PL', '23': 'CIDADANIA', '25': 'DEM', '28': 'PRTB', '33': 'PMN', '36': 'PTC', '40': 'PSB', '43': 'PV', '45': 'PSDB', '51': 'PATRIOTA', '55': 'PSD', '65': 'PC do B', '70': 'AVANTE', '77': 'SOLIDARIEDADE', '90': 'PROS' },
  '2022': { '10': 'REPUBLICANOS', '11': 'PP', '12': 'PDT', '13': 'PT', '14': 'PTB', '15': 'MDB', '16': 'PSTU', '18': 'REDE', '19': 'PODE', '20': 'PSC', '21': 'PCB', '22': 'PL', '23': 'CIDADANIA', '27': 'DC', '28': 'PRTB', '29': 'PCO', '30': 'NOVO', '33': 'PMN', '35': 'PMB', '36': 'AGIR', '40': 'PSB', '43': 'PV', '44': 'UNIÃO', '45': 'PSDB', '50': 'PSOL', '51': 'PATRIOTA', '55': 'PSD', '65': 'PC do B', '70': 'AVANTE', '77': 'SOLIDARIEDADE', '80': 'UP', '90': 'PROS' },
  '2024': { '10': 'REPUBLICANOS', '11': 'PP', '12': 'PDT', '13': 'PT', '15': 'MDB', '20': 'PODE', '22': 'PL', '23': 'CIDADANIA', '25': 'PRD', '27': 'DC', '28': 'PRTB', '30': 'NOVO', '35': 'PMB', '36': 'AGIR', '40': 'PSB', '43': 'PV', '44': 'UNIÃO', '45': 'PSDB', '50': 'PSOL', '55': 'PSD', '65': 'PC do B', '70': 'AVANTE', '77': 'SOLIDARIEDADE' },
};

const PARTY_NUMBER_YEARS = Object.keys(PARTY_NUMBER_BY_YEAR).map(Number).sort((a, b) => a - b);

// Ano exato quando existe; senao o ano conhecido mais proximo, preferindo o
// anterior — uma sigla vale ate ser trocada, entao olhar para tras erra menos.
function siglaForPartyNumber(numero, ano) {
  const chave = String(numero || '').trim().padStart(2, '0');
  if (!/^\d{2}$/.test(chave)) return '';
  const alvo = Number(ano);
  let melhor = null;
  for (const candidato of PARTY_NUMBER_YEARS) {
    if (!PARTY_NUMBER_BY_YEAR[String(candidato)][chave]) continue;
    if (melhor === null) { melhor = candidato; continue; }
    if (!Number.isFinite(alvo)) continue;
    if (candidato <= alvo && (melhor > alvo || candidato > melhor)) melhor = candidato;
    else if (candidato > alvo && melhor > alvo && candidato < melhor) melhor = candidato;
  }
  return melhor === null ? '' : PARTY_NUMBER_BY_YEAR[String(melhor)][chave];
}

// Tabela inteira de um ano, para semear cache de prefixo: inclui tambem os
// numeros que aquele ano nao registrou, resolvidos pelo ano mais proximo.
function partyNumbersForYear(ano) {
  const saida = {};
  PARTY_NUMBER_YEARS.forEach((y) => {
    Object.keys(PARTY_NUMBER_BY_YEAR[String(y)]).forEach((numero) => {
      if (!saida[numero]) saida[numero] = siglaForPartyNumber(numero, ano);
    });
  });
  return saida;
}

// 95 branco, 96 nulo, 97-99 reservados do TSE. Nenhum e partido, mas so 95 e
// 96 eram filtrados — o 97 aparecia como legenda "97" em 2002 (PA/PE) e 2018 (BA).
function isNonPartyBallotCode(id) {
  return /^9[5-9]$/.test(String(id || '').trim());
}

if (typeof window !== 'undefined') {
  window.PARTY_NUMBER_BY_YEAR = PARTY_NUMBER_BY_YEAR;
  window.siglaForPartyNumber = siglaForPartyNumber;
  window.partyNumbersForYear = partyNumbersForYear;
  window.isNonPartyBallotCode = isNonPartyBallotCode;
}
