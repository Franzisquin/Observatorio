const fs = require('fs');

const norm = (v) => (v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const MUNI_ALIASES = {
  'PARATY': ['PARATI', 'PARATY'],
  'PARATI': ['PARATI', 'PARATY'],
  'EMBU DAS ARTES': ['EMBU', 'EMBU DAS ARTES'],
  'EMBU': ['EMBU', 'EMBU DAS ARTES'],
  'TRAJANO DE MORAES': ['TRAJANO DE MORAIS', 'TRAJANO DE MORAES'],
  'TRAJANO DE MORAIS': ['TRAJANO DE MORAIS', 'TRAJANO DE MORAES'],
  'SAO TOME DAS LETRAS': ['SAO THOME DAS LETRAS', 'SAO TOME DAS LETRAS'],
  'SAO THOME DAS LETRAS': ['SAO THOME DAS LETRAS', 'SAO TOME DAS LETRAS'],
  'ITAPAJE': ['ITAPAGE', 'ITAPAJE'],
  'ITAPAGE': ['ITAPAGE', 'ITAPAJE'],
  'MOGI MIRIM': ['MOJI MIRIM', 'MOGI MIRIM'],
  'MOJI MIRIM': ['MOJI MIRIM', 'MOGI MIRIM'],
  'IGUARACY': ['IGUARACI', 'IGUARACY'],
  'IGUARACI': ['IGUARACI', 'IGUARACY'],
  'ELDORADO DOS CARAJAS': ['ELDORADO DO CARAJAS', 'ELDORADO DOS CARAJAS'],
  'ELDORADO DO CARAJAS': ['ELDORADO DO CARAJAS', 'ELDORADO DOS CARAJAS'],
  'SANTA ISABEL DO PARA': ['SANTA IZABEL DO PARA', 'SANTA ISABEL DO PARA'],
  'SANTA IZABEL DO PARA': ['SANTA IZABEL DO PARA', 'SANTA ISABEL DO PARA'],
  'SANTANA DO LIVRAMENTO': ['SANT ANA DO LIVRAMENTO', 'SANTANA DO LIVRAMENTO', "SANT'ANA DO LIVRAMENTO"],
  'SANT ANA DO LIVRAMENTO': ['SANT ANA DO LIVRAMENTO', 'SANTANA DO LIVRAMENTO', "SANT'ANA DO LIVRAMENTO"],
  "SANT'ANA DO LIVRAMENTO": ['SANT ANA DO LIVRAMENTO', 'SANTANA DO LIVRAMENTO', "SANT'ANA DO LIVRAMENTO"],
  'MASSAMBARA': ['MASSAMBARA', 'MACAMBARA'],
  'MACAMBARA': ['MASSAMBARA', 'MACAMBARA']
};

function getMunicipalAliases(name) {
  const n = norm(name);
  return MUNI_ALIASES[n] || [n];
}

const lista = JSON.parse(fs.readFileSync('lista_municipios.json', 'utf8'));
const zipIndexObj = JSON.parse(fs.readFileSync('resultados_geo/zip_index.json', 'utf8'));

// Build a normalized-key index of zipIndex
const zipIndexNorm = {};
for (const originalKey of Object.keys(zipIndexObj)) {
  zipIndexNorm[norm(originalKey)] = originalKey;
}

const missing = [];
for (const uf of Object.keys(lista)) {
  for (const muni of lista[uf]) {
    const aliases = getMunicipalAliases(muni);
    
    for (const year of [2008, 2012, 2016, 2020, 2024]) {
      let found = false;
      for (const al of aliases) {
        const safeName = al.replace(/[\/\\]/g, '-');
        const expectedFileNorm = `${year} MUNICIPAIS/${uf}/${safeName}_ORDINARIA_${year}.GEOJSON`;
        if (zipIndexNorm[expectedFileNorm]) {
          found = true;
          break;
        }
      }
      if (!found) {
        missing.push({uf, muni, year});
      }
    }
  }
}

const grouped = {};
for (const m of missing) {
  const k = m.uf + ' - ' + m.muni;
  if (!grouped[k]) grouped[k] = [];
  grouped[k].push(m.year);
}

const completelyMissing = [];
for (const [city, years] of Object.entries(grouped)) {
  if (years.length >= 4) {
    completelyMissing.push(`${city} (${years.join(', ')})`);
  }
}

// Write to a local file for inspection instead of flooding the console
fs.writeFileSync('missing_cities.txt', completelyMissing.join('\\n'), 'utf8');
console.log('Done! Wrote ' + completelyMissing.length + ' cities to missing_cities.txt');
