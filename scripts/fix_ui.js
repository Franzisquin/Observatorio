const fs = require('fs');

// Patch eleicoes.html
let html = fs.readFileSync('eleicoes.html', 'utf8');
const oldStyle = 'style="grid-column: 1 / -1;"';
// Try both with and without semicolon to be safe, though hex says with
html = html.replace(/style="grid-column: 1 \/ -1;?"/g, '');
fs.writeFileSync('eleicoes.html', html, 'utf8');

console.log('Patch applied to eleicoes.html');
