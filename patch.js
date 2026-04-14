const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Refactoring loadGeoJSON
code = code.replace(/let dataPath;[\s\n]*if\s*\(STATE\.currentElectionType\s*===\s*'geral'\)[\s\S]*?catch\(e\s*=>\s*null\);/g,
`if (STATE.currentElectionType === 'geral') {
    const dataPath = buildDataPath_General(id, uf, ano, normalizedType);
    if (!dataPath) return null;
    return await fetchGeoJSON(dataPath, normalizedType === 'sup').catch(e => null);
  } else {
    const aliases = getMunicipalAliases(id);
    for (const alias of aliases) {
      const dataPath = buildDataPath_Municipal(alias, uf, ano, type);
      if (!dataPath) continue;
      const res = await fetchGeoJSON(dataPath, true).catch(e => null);
      if (res) return res;
    }
    return null;
  }`);

// Refactoring loadMunicipalOverviewSummary
code = code.replace(/const municipio = municipios\[index\+\+\];[\s\n]*const dataPath = buildDataPath_Municipal\(municipio, uf, year, getMunicipalSubtypeFileLabel\(subtype\)\);[\s\n]*const geojson = await fetchGeoJSON\(dataPath, true\)\.catch\(\(\) => null\);[\s\n]*if \(!geojson\) continue;/g,
`const municipio = municipios[index++];
        const aliases = getMunicipalAliases(municipio);
        let geojson = null;
        for (const alias of aliases) {
          const dataPath = buildDataPath_Municipal(alias, uf, year, getMunicipalSubtypeFileLabel(subtype));
          if (!dataPath) continue;
          geojson = await fetchGeoJSON(dataPath, true).catch(() => null);
          if (geojson) break;
        }
        if (!geojson) continue;`);

// Refactoring loadMunicipalityDetailedSummary
code = code.replace(/const dataPath = buildDataPath_Municipal\(resolvedName, uf, year, getMunicipalSubtypeFileLabel\(subtype\)\);[\s\n]*const geojson = await fetchGeoJSON\(dataPath, true\)\.catch\(\(\) => null\);[\s\n]*const summary/g,
`const aliases = getMunicipalAliases(resolvedName);
    let geojson = null;
    for (const alias of aliases) {
      const dataPath = buildDataPath_Municipal(alias, uf, year, getMunicipalSubtypeFileLabel(subtype));
      if (!dataPath) continue;
      geojson = await fetchGeoJSON(dataPath, true).catch(() => null);
      if (geojson) break;
    }
    const summary`);

fs.writeFileSync('app.js', code, 'utf8');
console.log('Regex patch applied!');
