const fs = require('fs');

let html = fs.readFileSync('eleicoes.html', 'utf8');

// We want to replace the whole filterBox row cleanly
const rowStart = html.indexOf('<div class="row" style="grid-template-columns: 1fr 1fr;">');
const rowEnd = html.indexOf('<!-- FILTROS CENSITÁRIOS -->');

if (rowStart !== -1 && rowEnd !== -1) {
    const filtersHtml = `
          <div class="row">
            <div class="ctrl">
              <label for="filterRGINT">Região Intermediária</label>
              <select id="filterRGINT" class="select" disabled>
                <option value="" selected>Todas as regiões intermediárias</option>
              </select>
            </div>
            <div class="ctrl">
              <label for="filterRGI">Região Imediata</label>
              <select id="filterRGI" class="select" disabled>
                <option value="" selected>Todas as regiões imediatas</option>
              </select>
            </div>
            <div class="ctrl">
              <label for="inputBairro">Bairro</label>
              <select id="inputBairro" class="select" disabled>
                <option value="all" selected>Todos os bairros</option>
              </select>
            </div>
            <div class="ctrl">
              <label for="searchLocal">Buscar por Local de Votação (mín. 3 letras)</label>
              <div class="searchwrap">
                <input id="searchLocal" class="select" placeholder="Digite o nome do local..." disabled />
              </div>
            </div>
          </div>
          `;
    
    const newHtml = html.substring(0, rowStart) + filtersHtml + html.substring(rowEnd);
    fs.writeFileSync('eleicoes.html', newHtml, 'utf8');
    console.log('Cleaned up eleicoes.html filter layout');
} else {
    console.log('Could not find row boundaries');
}
