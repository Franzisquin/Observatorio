const fs = require('fs');
const zipIndexObj = JSON.parse(fs.readFileSync('resultados_geo/zip_index.json', 'utf8'));

function testLookup(city, uf, year) {
  const path = `${year} Municipais/${uf}/${city}_Ordinaria_${year}.geojson`;
  return !!zipIndexObj[path];
}

console.log('LUIZ ALVES ->', testLookup('LUIZ ALVES', 'SC', 2008));
console.log('LUIS ALVES ->', testLookup('LUIS ALVES', 'SC', 2008));
console.log('PEDRA BRANCA DO AMAPARI ->', testLookup('PEDRA BRANCA DO AMAPARI', 'AP', 2008));
console.log('AMAPARI ->', testLookup('AMAPARI', 'AP', 2008));
