const fs = require('fs');

// Load PR geojson
const geojson = JSON.parse(fs.readFileSync('resultados_geo_backup/municipios_hd/municipios_PR.geojson', 'utf8'));

// Function definitions from map-render.js / data-zip.js
function normalizeMunicipioSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getMunicipalityFeatureCode(props) {
  if (!props) return '';
  return String(
    props.CD_MUN ||
    props.cd_mun ||
    props.CD_IBGE ||
    props.cd_ibge ||
    props.cod_localidade_ibge ||
    props.CD_LOCALIDADE_IBGE ||
    props.NR_LOCALIDADE_IBGE ||
    props.id ||
    ''
  ).trim();
}

function getMunicipalityFeatureName(props) {
  if (!props) return 'Município';
  return String(
    props.NM_MUN ||
    props.nm_mun ||
    props.municipio ||
    props.nm_localidade ||
    props.NOME ||
    'Município'
  ).trim();
}

function getMunicipalSummaryEntryForFeature(props, summary) {
  if (!props || !summary) return null;
  const directCode = getMunicipalityFeatureCode(props);
  if (directCode) {
    if (summary[directCode]) return summary[directCode];
    const direct6 = directCode.slice(0, 6);
    if (summary[direct6]) return summary[direct6];
    const byCode = Object.values(summary).find((entry) => {
      if (!entry || !entry.muniCode) return false;
      const code = String(entry.muniCode).trim();
      return code === directCode || code.slice(0, 6) === direct6;
    });
    if (byCode) return byCode;
  }

  const nome = getMunicipalityFeatureName(props);
  const aliases = [normalizeMunicipioSlug(nome)];

  return Object.values(summary).find((entry) => {
    const slug = normalizeMunicipioSlug(entry?.nome || '');
    return aliases.includes(slug);
  }) || null;
}

// Simulate test for 2002 PR
const test2002PyOutput = JSON.parse(fs.readFileSync('scratch/test_2002_data.json', 'utf8').catch(() => null) || '{}');
