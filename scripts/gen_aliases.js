const normalizeMunicipioSlug = (value) => {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const rawAliases = [
  ['PARATY', 'PARATI'],
  ['EMBU DAS ARTES', 'EMBU'],
  ['TRAJANO DE MORAES', 'TRAJANO DE MORAIS'],
  ['SAO TOME DAS LETRAS', 'SAO THOME DAS LETRAS'],
  ['ITAPAJE', 'ITAPAGE'],
  ['MOGI MIRIM', 'MOJI MIRIM'],
  ['IGUARACY', 'IGUARACI'],
  ['ELDORADO DOS CARAJAS', 'ELDORADO DO CARAJAS'],
  ['SANTA ISABEL DO PARA', 'SANTA IZABEL DO PARA'],
  ['SANTANA DO LIVRAMENTO', 'SANT ANA DO LIVRAMENTO', "SANT'ANA DO LIVRAMENTO", "SANTANA DO LIVRAMENTO"],
  ['MACAMBARA', 'MASSAMBARA'],
  ['AMAPARI', 'PEDRA BRANCA DO AMAPARI', 'PEDRA BRANCA'],
  ['BARRO PRETO', 'GOVERNADOR LOMANTO JUNIOR', 'BARRO PRETO'],
  ['CAMACA', 'CAMACAN'],
  ['QUIJINGUE', 'QUINJINGUE'],
  ['BRAZOPOLIS', 'BRASOPOLIS'],
  ['JOCA CLAUDINO', 'SANTAREM'],
  ['SAO DOMINGOS', 'SAO DOMINGOS DE POMBAL'],
  ['TACIMA', 'CAMPO DE SANTANA'],
  ['BELEM DO SAO FRANCISCO', 'BELEM DE SAO FRANCISCO'],
  ['ILHA DE ITAMARACA', 'ITAMARACA', 'ILHA DE ITAMARACA'],
  ['MUNHOZ DE MELLO', 'MUNHOZ DE MELO'],
  ['AREZ', 'ARES'],
  ['SANTO ANTONIO DO LEVERGER', 'SANTO ANTONIO DE LEVERGER'],
  
  // New ones from request
  ['UNA', 'UNAS'],
  ['DONA EUZEBIA', 'DONA EUSEBIA'],
  ['BARAO DE MONTE ALTO', 'BARAO DO MONTE ALTO'],
  ['ACU', 'ASSU'],
  ['JANUARIO CICCO', 'BOA SAUDE'],
  ['SÃO LUIZ DO PARAITINGA', 'SÃO LUÍS DO PARAITINGA'],
  ['AMPARO DO SAO FRANCISCO', 'AMPARO DE SAO FRANCISCO'],
  
  // RO d'Oeste pattern
  ['MACHADINHO D OESTE', "MACHADINHO D'OESTE", 'MACHADINHO DOESTE', 'MACHADINHO DO OESTE'],
  ['ESPIGAO D OESTE', "ESPIGAO D'OESTE", 'ESPIGAO DOESTE', 'ESPIGAO DO OESTE'],
  ['ALVORADA D OESTE', "ALVORADA D'OESTE", 'ALVORADA DOESTE', 'ALVORADA DO OESTE'],
  ['NOVA BRASILANDIA D OESTE', "NOVA BRASILANDIA D'OESTE", 'NOVA BRASILANDIA DOESTE', 'NOVA BRASILANDIA DO OESTE', 'NOVA BRASILÂNDIA D OESTE'],
  ['ALTA FLORESTA D OESTE', "ALTA FLORESTA D'OESTE", 'ALTA FLORESTA DOESTE', 'ALTA FLORESTA DO OESTE'],
  ['SANTA LUZIA D OESTE', "SANTA LUZIA D'OESTE", 'SANTA LUZIA DOESTE', 'SANTA LUZIA DO OESTE'],
  ['SAO FELIPE D OESTE', "SAO FELIPE D'OESTE", 'SAO FELIPE DOESTE', 'SAO FELIPE DO OESTE'],
  
  // SC
  ['LUIZ ALVES', 'LUIS ALVES'],
  ['PRESIDENTE CASTELLO BRANCO', 'PRESIDENTE CASTELO BRANCO'],
  
  // TO
  ['SAO VALERIO', 'SAO VALERIO DA NATIVIDADE'],
  ['COUTO MAGALHAES', 'COUTO DE MAGALHAES']
];

const aliasObject = {};

rawAliases.forEach(list => {
  const slugs = Array.from(new Set(list.map(normalizeMunicipioSlug))).filter(Boolean);
  slugs.forEach(s => {
    aliasObject[s] = slugs;
  });
});

// Final alphabetical sort for cleaner file
const sortedKeys = Object.keys(aliasObject).sort();
console.log('const MUNICIPAL_NAME_ALIASES = {');
sortedKeys.forEach((k, i) => {
  const line = `  ${k.match(/^[A-Z0-9_]+$/) ? k : "'" + k + "'"}: [${aliasObject[k].map(v => "'" + v + "'").join(', ')}]`;
  console.log(line + (i === sortedKeys.length - 1 ? '' : ','));
});
console.log('};');
