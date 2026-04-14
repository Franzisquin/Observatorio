const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Patch 1: Santa Izabel do Para
code = code.replace(
  /'SANTA ISABEL DO PARA': \['SANTA IZABEL DO PARA', 'SANTA ISABEL DO PARA'\],[\s\S]*?'SANTA IZABEL DO PARA': \['SANTA IZABEL DO PARA', 'SANTA ISABEL DO PARA'\],/g,
  \`'SANTA ISABEL DO PARA': ['SANTA ISABEL DO PARÁ', 'SANTA IZABEL DO PARÁ'],
  'SANTA IZABEL DO PARA': ['SANTA ISABEL DO PARÁ', 'SANTA IZABEL DO PARÁ'],\`
);

// Patch 2: Amapari
code = code.replace(
  /'PEDRA BRANCA DO AMAPARI': \['AMAPARI', 'PEDRA BRANCA DO AMAPARI'\],[\s\S]*?'AMAPARI': \['AMAPARI', 'PEDRA BRANCA DO AMAPARI'\],/g,
  \`'PEDRA BRANCA DO AMAPARI': ['ÁGUA BRANCA DO AMAPARI', 'AMAPARI', 'PEDRA BRANCA DO AMAPARI'],
  'AMAPARI': ['ÁGUA BRANCA DO AMAPARI', 'AMAPARI', 'PEDRA BRANCA DO AMAPARI'],\`
);

// Patch 3: Macambara
code = code.replace(
  /'MASSAMBARA': \['MASSAMBARÁ', 'MAÇAMBARÁ', 'MACAMBARÁ'\],[\s\S]*?'MACAMBARA': \['MASSAMBARÁ', 'MAÇAMBARÁ', 'MACAMBARÁ'\],/g,
  \`'MASSAMBARA': ['MAÇAMBARA', 'MASSAMBARÁ', 'MAÇAMBARÁ', 'MACAMBARÁ'],
  'MACAMBARA': ['MAÇAMBARA', 'MASSAMBARÁ', 'MAÇAMBARÁ', 'MACAMBARÁ'],\`
);

// Patch 4: Sao Valerio
code = code.replace(
  /'SAO VALERIO': \['SÃO VALÉRIO DA NATIVIDADE', 'SÃO VALÉRIO'\],[\s\S]*?'SAO VALERIO DA NATIVIDADE': \['SÃO VALÉRIO DA NATIVIDADE', 'SÃO VALÉRIO'\],/g,
  \`'SAO VALERIO': ['SÃO VALÉRIO DO TOCANTINS', 'SÃO VALÉRIO DA NATIVIDADE', 'SÃO VALÉRIO'],
  'SAO VALERIO DA NATIVIDADE': ['SÃO VALÉRIO DO TOCANTINS', 'SÃO VALÉRIO DA NATIVIDADE', 'SÃO VALÉRIO'],\`
);

fs.writeFileSync('app.js', code, 'utf8');
console.log('Final fixes applied successfully.');
