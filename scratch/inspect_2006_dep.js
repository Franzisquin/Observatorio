const fs = require('fs');
const path = require('path');
const admZip = require('adm-zip');

const zipPath = 'resultados_geo/Legislativas 2006/deputados_federal_2006_RJ.zip';
const zip = new admZip(zipPath);
const zipEntries = zip.getEntries();

zipEntries.forEach((entry) => {
  if (entry.entryName.endsWith('.json')) {
    console.log('File found inside zip:', entry.entryName);
    const content = entry.getData().toString('utf8');
    const json = JSON.parse(content);
    
    console.log('METADATA structure keys:', Object.keys(json.METADATA || {}));
    if (json.METADATA && json.METADATA.cand_names) {
      const candKeys = Object.keys(json.METADATA.cand_names);
      console.log('Sample cand_names keys (first 10):', candKeys.slice(0, 10));
      candKeys.slice(0, 10).forEach(k => {
        console.log(`cand_names[${k}]:`, json.METADATA.cand_names[k]);
      });
    }

    if (json.METADATA && json.METADATA.coalition_adjustments) {
      console.log('coalition_adjustments (first 5):', Object.entries(json.METADATA.coalition_adjustments).slice(0, 5));
    }
    
    if (json.RESULTS) {
      const resultKeys = Object.keys(json.RESULTS);
      console.log('Sample RESULTS keys (first 5):', resultKeys.slice(0, 5));
      resultKeys.slice(0, 3).forEach(k => {
        console.log(`RESULTS[${k}]:`, json.RESULTS[k]);
      });
    }
  }
});
