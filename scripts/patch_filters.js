const fs = require('fs');

// Patch eleicoes.html
let html = fs.readFileSync('eleicoes.html', 'utf8');

// 1. Remove Município filter DIV
const municipioRegex = /<div class="ctrl section-hidden" id="ctrlCidadeFilter">[\s\S]*?<\/div>\s*<\/div>/g;
html = html.replace(municipioRegex, '');

// 2. Convert Bairro combobox to select
// Note: using a more flexible regex for target lines
const bairroRegex = /<div class="ctrl"\s*>\s*<label for="inputBairro">Bairro<\/label>\s*<div class="combobox-container" id="boxBairro">[\s\S]*?<\/div>\s*<\/div>/g;
const newBairroHtml = `<div class="ctrl">
              <label for="inputBairro">Bairro</label>
              <select id="inputBairro" class="select" disabled>
                <option value="all" selected>Todos os bairros</option>
              </select>
            </div>`;
html = html.replace(bairroRegex, newBairroHtml);

fs.writeFileSync('eleicoes.html', html, 'utf8');
console.log('Patch Applied to eleicoes.html');
