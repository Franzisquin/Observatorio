const DATA_BASE_URL = 'resultados_geo/';

let ZIP_INDEX = null;
let ZIP_READERS = new Map();

// --- ESTADO DO SIMULADOR ---
const SIM = {
  // Configurações
  baseYear: '2022',
  
  // Cache de Dados
  geoEstados: null, // As geometrias dos estados
  locaisCache: {},  // Cache de locais de votação por UF { 'SP': featureCollection, ... }
  votosCache: {},   // Cache de presidente_por_estado2022 { 'SP': map(local_id -> props) }
  
  // Totais agregados (calculados)
  resultadosUF: {}, // { 'SP': { 'Lula': 1000, 'Bolsonaro': 500, aptos: 2000, validos: 1500 } }
  resultadosNacional: {},
  
  // Configuração atual do usuário
  candidatos: [],
  sliders: {
    genero: { 'Mulheres': 0, 'Homens': 0 },
    idade: { '16 a 24 Anos': 0, '25 a 44 Anos': 0, '45 a 59 Anos': 0, '60+ Anos': 0 },
    educacao: { 'Até Ensino Médio': 0, 'Ensino Superior+': 0 },
    renda: { 'Até 2 SM': 0, '2 a 5 SM': 0, 'Mais de 5 SM': 0 },
    religiao: { 'Católicos': 0, 'Evangélicos': 0, 'Outras/Sem Religião': 0 },
    voto2022: { 'Votou Lula': 0, 'Votou Bolsonaro': 0, 'Outros/Abstenção': 0 }
  },
  
  // UI State
  estadoSelecionado: null
};

const UF_MAP = new Map([
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'],
  ['BA', 'Bahia'], ['CE', 'Ceará'], ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'], ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'], ['SE', 'Sergipe'], ['TO', 'Tocantins']
]);

// --- ZIP E FETCH UTILS (Copiado do App.js) ---

async function loadZipIndex() {
  try {
    const res = await fetch(DATA_BASE_URL + 'zip_index.json');
    if (res.ok) {
      ZIP_INDEX = await res.json();
      console.log("ZIP Index loaded.");
    } else {
      ZIP_INDEX = {};
    }
  } catch (e) {
    console.error("Error loading zip_index.json:", e);
    ZIP_INDEX = {};
  }
}

async function fetchGeoJSON(path) {
  if (ZIP_INDEX === null) await loadZipIndex();

  let relativePath = path;
  if (path.startsWith(DATA_BASE_URL)) {
    relativePath = path.substring(DATA_BASE_URL.length);
  }

  if (ZIP_INDEX && ZIP_INDEX[relativePath]) {
    const entry = ZIP_INDEX[relativePath];
    const zipUrl = DATA_BASE_URL + entry.zip;
    const innerFile = entry.file;
    return await fetchFromZip(zipUrl, innerFile);
  }

  const response = await fetch(path);
  if (!response.ok) throw new Error(`Arquivo não encontrado: ${path}`);
  return await response.json();
}

async function fetchFromZip(zipUrl, filename) {
  let reader = ZIP_READERS.get(zipUrl);

  if (!reader) {
    reader = await unzipit.unzip(zipUrl);
    ZIP_READERS.set(zipUrl, reader);
  }

  const ObjectEntries = reader.entries;
  let entry = ObjectEntries[filename];

  if (!entry) {
    const lowerName = filename.toLowerCase();
    for (const k in ObjectEntries) {
      if (k.toLowerCase() === lowerName) {
        entry = ObjectEntries[k];
        break;
      }
    }
  }

  if (!entry) throw new Error(`Arquivo ${filename} não encontrado no zip ${zipUrl}`);

  const blob = await entry.blob('application/json');
  return JSON.parse(await blob.text());
}

// --- CORES E TEMA ---
const SIM_COLORS = [
  '#C0122D', // Vermelho (PT)
  '#054577', // Azul Escuro (PL)
  '#009959', // Verde (MDB)
  '#f48c24', // Laranja (Novo/Solidariedade)
  '#8CC63E', // Verde Claro
  '#ec008c', // Rosa
  '#68018D', // Roxo
  '#ffff00'  // Amarelo
];

function getCorCandidato(idx) {
  return SIM_COLORS[idx % SIM_COLORS.length];
}

// Color Gradient
function hexToHSL(H) {
  let r = 0, g = 0, b = 0;
  if (H.length == 4) { r = "0x" + H[1] + H[1]; g = "0x" + H[2] + H[2]; b = "0x" + H[3] + H[3]; }
  else if (H.length == 7) { r = "0x" + H[1] + H[2]; g = "0x" + H[3] + H[4]; b = "0x" + H[5] + H[6]; }
  r /= 255; g /= 255; b /= 255;
  let cmin = Math.min(r, g, b), cmax = Math.max(r, g, b), delta = cmax - cmin, h = 0, s = 0, l = 0;
  if (delta == 0) h = 0;
  else if (cmax == r) h = ((g - b) / delta) % 6;
  else if (cmax == g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  l = (cmax + cmin) / 2;
  s = delta == 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  s = +(s * 100).toFixed(1); l = +(l * 100).toFixed(1);
  return { h, s, l };
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  let c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
  r = Math.round((r + m) * 255).toString(16);
  g = Math.round((g + m) * 255).toString(16);
  b = Math.round((b + m) * 255).toString(16);
  if (r.length == 1) r = "0" + r;
  if (g.length == 1) g = "0" + g;
  if (b.length == 1) b = "0" + b;
  return "#" + r + g + b;
}

function getGradientColor(baseColorHex, pct) {
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  const hsl = hexToHSL(baseColorHex);
  let targetL = 80 - (pct / 100) * 50; 
  return hslToHex(hsl.h, hsl.s, targetL);
}

// --- INIT E EVENTOS DA UI ---
window.addEventListener('DOMContentLoaded', simInit);

let map, geojsonLayer, locaisLayer;

async function simInit() {
  document.body.dataset.theme = 'dark';
  
  // Inicializar o Mapa
  map = L.map('map', { zoomControl: false }).setView([-15, -55], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO'
  }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  
  // Painel lateral e botões
  document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.body.dataset.theme === 'dark';
    document.body.dataset.theme = isDark ? 'light' : 'dark';
  });

  document.getElementById('btnAddCand').addEventListener('click', simAddCandidateUI);
  document.getElementById('btnStartSim').addEventListener('click', simExecutarSimulacao);
  
  // Botão para voltar ao mapa do Brasil (drill up)
  const btnBrasil = document.createElement('button');
  btnBrasil.id = 'btnVoltarBrasil';
  btnBrasil.className = 'button ghost';
  btnBrasil.style.display = 'none';
  btnBrasil.style.marginBottom = '10px';
  btnBrasil.innerHTML = '← Voltar ao Mapa Nacional';
  btnBrasil.onclick = () => {
    SIM.estadoSelecionado = null;
    btnBrasil.style.display = 'none';
    if(locaisLayer) map.removeLayer(locaisLayer);
    if(geojsonLayer) map.addLayer(geojsonLayer);
    simRenderPanel();
    map.flyTo([-15, -55], 4);
  };
  document.getElementById('resultsTitle').parentElement.insertBefore(btnBrasil, document.getElementById('resultsTitle'));

  // Sync sliders percentage
  document.querySelectorAll('.sim-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      const valDisp = e.target.parentElement.querySelector('.sim-slider-val');
      if (valDisp) valDisp.textContent = e.target.value + '%';
      simReadConfig(); // Lê e força 100% de teto
    });
  });

  simAddCandidateUI(); // Adiciona o 1º candidato default
  
  // Carregar os contornos dos estados (para o mapa nacional)
  try {
    const res = await fetch('estados_brasil.geojson');
    SIM.geoEstados = await res.json();
    simInicializarMapaEstados();
  } catch (e) {
    console.error("Erro ao carregar estados_brasil.geojson", e);
  }
}
// --- GERENCIAMENTO DE UI E CONFIGURAÇÃO ---

function simAddCandidateUI() {
  const container = document.getElementById('candidatesContainer');
  const idx = container.children.length;
  
  const div = document.createElement('div');
  div.className = 'sim-candidate';
  
  const cor = getCorCandidato(idx);
  
  div.innerHTML = `
    <div style="display: flex; gap: 8px; flex: 1;">
      <input type="color" class="sim-cand-color" value="${cor}" title="Cor do Candidato">
      <input type="text" class="sim-cand-name" placeholder="Ex: Candidato ${idx + 1}" style="flex:1;">
    </div>
    <div style="display: flex; gap: 8px; flex: 1;">
      <input type="number" class="sim-cand-pct" placeholder="Votos %" min="0" max="100" style="width: 80px;">
      <button class="button ghost sim-cand-remove" style="padding: 4px 8px;">✕</button>
    </div>
  `;
  
  div.querySelector('.sim-cand-remove').onclick = () => {
    div.remove();
  };
  
  container.appendChild(div);
}

function simReadConfig() {
  // LER CANDIDATOS
  SIM.candidatos = [];
  const candEls = document.querySelectorAll('.sim-candidate');
  
  let usedPct = 0;
  candEls.forEach(el => {
    const nome = el.querySelector('.sim-cand-name').value.trim();
    const cor = el.querySelector('.sim-cand-color').value;
    let pctRaw = parseFloat(el.querySelector('.sim-cand-pct').value) || 0;
    
    if (pctRaw < 0) pctRaw = 0;
    
    SIM.candidatos.push({ nome: nome || 'Sem Nome', cor, pctRaw });
    usedPct += pctRaw;
  });
  
  // Normalizar para 100% (ou considerar brancos/nulos se < 100)
  // Deixaremos a normalização para o cálculo de votos individuais se necessário
  // Para agora, apenas pegaremos o pct base de cada um.
  
  // LER SLIDERS
  const lerGrupo = (mapObj, keyPrefixo, baseKeys) => {
    let totalValor = 0;
    const lidos = {};
    baseKeys.forEach(bk => {
      const el = document.getElementById(`sld_${keyPrefixo}_${bk.replace(/\s+/g, '')}`);
      let v = el ? parseFloat(el.value) || 0 : 0;
      lidos[bk] = v;
      totalValor += v;
    });
    
    // Normalizar o grupo demográfico inteiro para somar 100% nos pesos
    // Se o user colocar tudo zero, peso fica igual para todos os buckets
    if(totalValor === 0) {
      baseKeys.forEach(bk => mapObj[bk] = 100 / baseKeys.length);
    } else {
      baseKeys.forEach(bk => mapObj[bk] = (lidos[bk] / totalValor) * 100);
    }
  };

  // Os IDs no HTML precisarão bater com esses prefixos (vamos assumir q os atuais são assim ou criaremos a lógica de map direto dos atributos dos inputs)
  // Modificação: Como a UI atual do simulador.html é fixa, vou ler pelos IDs literais:
  
  const getSld = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  
  // Gênero
  SIM.sliders.genero['Mulheres'] = getSld('sld_mulheres');
  SIM.sliders.genero['Homens'] = getSld('sld_homens');
  
  // Idade
  SIM.sliders.idade['16 a 24 Anos'] = getSld('sld_16_24');
  SIM.sliders.idade['25 a 44 Anos'] = getSld('sld_25_44');
  SIM.sliders.idade['45 a 59 Anos'] = getSld('sld_45_59');
  SIM.sliders.idade['60+ Anos'] = getSld('sld_60mais');

  // Educação (Não tem no censo dos locais de votação de forma completa, apenas Alfabetização. Vamos ignorar Alfabetização no cálculo, ou transformar ensino superior em peso 1:1)
  SIM.sliders.educacao['Até Ensino Médio'] = getSld('sld_ate_em');
  SIM.sliders.educacao['Ensino Superior+'] = getSld('sld_superior');

  // Renda
  SIM.sliders.renda['Até 2 SM'] = getSld('sld_ate_2sm');
  SIM.sliders.renda['2 a 5 SM'] = getSld('sld_2_5sm');
  SIM.sliders.renda['Mais de 5 SM'] = getSld('sld_mais_5sm');

  // Religião (Não existe no GeoJSON. Será ignorado ou peso igual)
  SIM.sliders.religiao['Católicos'] = getSld('sld_catolicos');
  SIM.sliders.religiao['Evangélicos'] = getSld('sld_evangelicos');
  SIM.sliders.religiao['Outras/Sem Religião'] = getSld('sld_outras');

  // Voto 2022
  SIM.sliders.voto2022['Votou Lula'] = getSld('sld_voto_lula');
  SIM.sliders.voto2022['Votou Bolsonaro'] = getSld('sld_voto_bolsonaro');
  SIM.sliders.voto2022['Outros/Abstenção'] = getSld('sld_voto_outros');
}


// --- CARREGAMENTO DE DADOS CENSITÁRIOS E VOTOS 2022 ---

function ensureNumber(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string') v = String(v || 0);
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Carrega os dados de um estado específico: presidente_por_estado + locais_votacao
async function simLoadEstado(uf) {
  if (SIM.locaisCache[uf]) return; // Já carregado

  // O zip index já faz o handle de resolver a URL inteira baseado no caminho lógico
  const relPathPres = `presidente_por_estado2022/presidente_${uf}_2022.geojson`;
  const relPathLoc = `locais_votacao_2022/locais_votacao_2022_${uf}.geojson`;
  
  const presPromise = fetchGeoJSON(relPathPres).catch(e => { console.error("Pres erro", uf, e); return null; });
  const locPromise = fetchGeoJSON(relPathLoc).catch(e => { console.error("Loc erro", uf, e); return null; });

  const [presData, locData] = await Promise.all([presPromise, locPromise]);

  if (!presData) return; // Se não tem dados base de voto, não rola

  const locaisMap = new Map();
  if (locData && locData.features) {
    locData.features.forEach(f => {
      let id = String(f.properties.local_id || f.properties.nr_locvot);
      locaisMap.set(id, f.properties);
    });
  }

  // Mergear
  const featuresFinais = [];
  presData.features.forEach(f => {
    let id = String(f.properties.local_id || f.properties.NR_LOCAL_VOTACAO);
    const demoProps = locaisMap.get(id);
    if (demoProps) {
      f.properties = { ...f.properties, ...demoProps };
    }
    
    // Assegura que tem as coords nativas (presidente GeoJSON já as tem em `lat` / `long`)
    if(f.geometry && f.geometry.type === "Point") {
       featuresFinais.push(f);
    }
  });

  SIM.locaisCache[uf] = { type: 'FeatureCollection', features: featuresFinais };
}

// Carrega todos os 27 estados paralelamente (com timeout/retrys para n sobrecarregar)
async function simCarregarTodosEstados() {
  const loader = document.getElementById('mapLoader');
  loader.style.display = 'flex';
  loader.innerText = `Carregando dados de locais e censo (≈90 mil pontos) de todo o Brasil...`;
  
  // Vamos fazer em batches de 5 estados pra não dar gargalo no network/IndexedDB/Unzipit
  const CHUNK_SIZE = 5;
  let loadedCount = 0;
  
  for (let i = 0; i < ALL_STATE_SIGLAS.length; i += CHUNK_SIZE) {
    const chunk = ALL_STATE_SIGLAS.slice(i, i + CHUNK_SIZE);
    await Promise.all(chunk.map(uf => simLoadEstado(uf)));
    loadedCount += chunk.length;
    loader.innerText = `Carregando dados... (${loadedCount}/${ALL_STATE_SIGLAS.length} Estados)`;
  }
}
// --- MOTOR DE PROJEÇÃO ---

function simCalcularProjecao() {
  simReadConfig();
  
  if (SIM.candidatos.length === 0) {
    alert("Adicione ao menos um candidato.");
    return false;
  }

  // Prepara buckets
  SIM.resultadosNacional = { aptos: 0, totalSimulado: 0 };
  SIM.candidatos.forEach(c => SIM.resultadosNacional[c.nome] = 0);
  
  ALL_STATE_SIGLAS.forEach(uf => {
    SIM.resultadosUF[uf] = { aptos: 0, totalSimulado: 0 };
    SIM.candidatos.forEach(c => SIM.resultadosUF[uf][c.nome] = 0);
  });

  const S = SIM.sliders;

  ALL_STATE_SIGLAS.forEach(uf => {
    const geo = SIM.locaisCache[uf];
    if (!geo) return;
    
    geo.features.forEach(f => {
      const p = f.properties;
      const aptos = ensureNumber(p['Eleitores_Aptos 1T']) || ensureNumber(p['Eleitores_Aptos 2T']) || 0;
      if (aptos === 0) return;
      
      // -- Gênero --
      const pctM = ensureNumber(p['Pct Mulheres']) / 100;
      const pctH = ensureNumber(p['Pct Homens']) / 100;
      
      // -- Idade --
      // Agrupar faixas etárias
      const i16_24 = (ensureNumber(p['Pct 15 a 19 anos']) + ensureNumber(p['Pct 20 a 24 anos']))/100;
      const i25_44 = (ensureNumber(p['Pct 25 a 29 anos']) + ensureNumber(p['Pct 30 a 34 anos']) + ensureNumber(p['Pct 35 a 39 anos']) + ensureNumber(p['Pct 40 a 44 anos']))/100;
      const i45_59 = (ensureNumber(p['Pct 45 a 49 anos']) + ensureNumber(p['Pct 50 a 54 anos']) + ensureNumber(p['Pct 55 a 59 anos']))/100;
      const i60 = (ensureNumber(p['Pct 60 a 64 anos']) + ensureNumber(p['Pct 65 a 69 anos']) + ensureNumber(p['Pct 70 a 74 anos']) + ensureNumber(p['Pct 75 a 79 anos']) + ensureNumber(p['Pct 80 a 84 anos']) + ensureNumber(p['Pct 85 a 89 anos']) + ensureNumber(p['Pct 90 a 94 anos']) + ensureNumber(p['Pct 95 a 99 anos']))/100;

      // -- Renda -- (Aproximação via Renda Média)
      const r_media = ensureNumber(p['Renda Media']);
      let pt2sm = 0, p2_5sm = 0, p5sm = 0;
      const SALARIO = 1212; // Valor ref 2022
      if (r_media <= SALARIO * 2) pt2sm = 1;
      else if (r_media <= SALARIO * 5) p2_5sm = 1;
      else p5sm = 1;

      // -- Religião/Educacao (Não Censitário - omitido) --
      
      // -- Voto 2022 --
      const vLula = ensureNumber(p['LULA (PT) (ELEITO) 2T']) || ensureNumber(p['LULA (PT) (2° TURNO) 1T']);  
      const vBolso = ensureNumber(p['JAIR BOLSONARO (PL) (NÃO ELEITO) 2T']) || ensureNumber(p['JAIR BOLSONARO (PL) (2° TURNO) 1T']);
      
      // Votos válidos e Outros referem-se àquelas opções no slider de voto2022
      const out_abs = Math.max(0, aptos - vLula - vBolso);
      const pvLula = vLula / aptos || 0;
      const pvBolso = vBolso / aptos || 0;
      const pvOutros = out_abs / aptos || 0;

      const votosCandNoLocal = {};
      let totalVotosNoLocal = 0;

      SIM.candidatos.forEach(c => {
        let fatorDemografico = 0;
        let cSld = c.pctRaw / 100; // a barra base do candidato que é escalada pelos pesos (ou podemos usar o método de transfer exact)
        
        // Método de Fatores:
        // O valor do slider no painel representa: "De 100 mulheres, quantas votam em mim?"
        // Fator Genero: (P_Mulheres * slider_mulheres) + (P_Homens * slider_homens)
        let fGen = pctM * (S.genero['Mulheres']/100) + pctH * (S.genero['Homens']/100);
        
        let fIda = i16_24 * (S.idade['16 a 24 Anos']/100) + 
                   i25_44 * (S.idade['25 a 44 Anos']/100) + 
                   i45_59 * (S.idade['45 a 59 Anos']/100) + 
                   i60    * (S.idade['60+ Anos']/100);

        let fRen = pt2sm * (S.renda['Até 2 SM']/100) + 
                   p2_5sm * (S.renda['2 a 5 SM']/100) + 
                   p5sm   * (S.renda['Mais de 5 SM']/100);
                   
        let fV22 = pvLula * (S.voto2022['Votou Lula']/100) + 
                   pvBolso * (S.voto2022['Votou Bolsonaro']/100) +
                   pvOutros * (S.voto2022['Outros/Abstenção']/100);

        // A média ponderada dos atributos disponíveis
        const mediaPotencial = (fGen + fIda + fRen + fV22) / 4;
        
        const votos = aptos * mediaPotencial;
        votosCandNoLocal[c.nome] = Math.round(votos);
        totalVotosNoLocal += votosCandNoLocal[c.nome];
      });

      // Normalizar para não ultrapassar os aptos
      if (totalVotosNoLocal > aptos) {
        const fatorCorte = aptos / totalVotosNoLocal;
        SIM.candidatos.forEach(c => {
          votosCandNoLocal[c.nome] = Math.round(votosCandNoLocal[c.nome] * fatorCorte);
        });
      }

      // Vencedor no local (para colorir)
      let vencedor = null;
      let maxVotos = -1;
      let candSum = 0;
      
      SIM.candidatos.forEach(c => {
        const v = votosCandNoLocal[c.nome];
        candSum += v;
        if(v > maxVotos) { maxVotos = v; vencedor = c; }
        
        // Agregar uf e nacional
        SIM.resultadosUF[uf][c.nome] += v;
        SIM.resultadosNacional[c.nome] += v;
      });
      
      SIM.resultadosUF[uf].aptos += aptos;
      SIM.resultadosUF[uf].totalSimulado += candSum;
      SIM.resultadosNacional.aptos += aptos;
      SIM.resultadosNacional.totalSimulado += candSum;

      // Armazena resultado no Ponto para renderização no mapa de locais
      f.properties._sim_votos = votosCandNoLocal;
      f.properties._sim_vencedor = vencedor;
      f.properties._sim_total_cand = candSum;
    });
  });

  return true;
}

// --- RENDERS ---

async function simExecutarSimulacao() {
  if (Object.keys(SIM.locaisCache).length === 0) {
    await simCarregarTodosEstados();
  }
  
  const ok = simCalcularProjecao();
  if(!ok) return;

  simRenderPanel();
  
  if (SIM.estadoSelecionado) {
    simRenderMapaLocais(SIM.estadoSelecionado);
  } else {
    simAtualizarCoresMapaEstados();
  }
  
  document.getElementById('mapLoader').style.display = 'none';
}

function simRenderPanel() {
  const uf = SIM.estadoSelecionado;
  const dataRef = uf ? SIM.resultadosUF[uf] : SIM.resultadosNacional;
  const nameRef = uf ? UF_MAP.get(uf) || uf : "Brasil";
  const validos = dataRef.totalSimulado;

  let html = `<div style="padding: 15px;">`;
  html += `<h3 style="margin-top:0; color:#fff; border-bottom:1px solid #333; padding-bottom:10px;">` +
          `Resultados Simulados: <span style="color:#01f6fe;">${nameRef}</span></h3>`;

  if (validos === 0) {
    html += `<p style="color:#ccc;">Sem votos projetados.</p></div>`;
    document.getElementById('resultsContent').innerHTML = html;
    document.getElementById('btnVoltarBrasil').style.display = uf ? 'block' : 'none';
    return;
  }

  const sorted = SIM.candidatos.slice().sort((a,b) => dataRef[b.nome] - dataRef[a.nome]);

  sorted.forEach(c => {
    const v = dataRef[c.nome];
    const pct = validos > 0 ? (v / validos) * 100 : 0;
    html += `
      <div style="margin-bottom: 12px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-weight:600;">
          <span style="color: ${c.cor};">${c.nome}</span>
          <span>${pct.toFixed(2)}%</span>
        </div>
        <div class="sim-bar-bg" style="height: 12px; background: #2a2a2a; border-radius: 6px; overflow: hidden;">
          <div class="sim-bar-fill" style="height: 100%; width: ${pct}%; background: ${c.cor}; border-radius: 6px;"></div>
        </div>
        <div style="font-size: 0.8rem; color: #888; text-align: right; margin-top: 2px;">
          ${v.toLocaleString('pt-BR')} proj.
        </div>
      </div>
    `;
  });

  html += `<div style="font-size:0.85rem; color:#666; margin-top:20px; text-align:center;">
             Total Votos Simulados: ${validos.toLocaleString('pt-BR')}<br>
             (Aptos base 2022: ${dataRef.aptos.toLocaleString('pt-BR')})
           </div></div>`;

  document.getElementById('resultsContent').innerHTML = html;
  document.getElementById('btnVoltarBrasil').style.display = uf ? 'block' : 'none';
}

function simInicializarMapaEstados() {
  if (!SIM.geoEstados) return;
  
  if (geojsonLayer) map.removeLayer(geojsonLayer);
  if (locaisLayer) map.removeLayer(locaisLayer);

  geojsonLayer = L.geoJSON(SIM.geoEstados, {
    style: f => ({
      fillColor: '#333',
      weight: 1,
      opacity: 1,
      color: '#000',
      fillOpacity: 0.7
    }),
    onEachFeature: (f, layer) => {
      layer.on('click', () => {
         SIM.estadoSelecionado = f.properties.SIGLA;
         simRenderMapaLocais(SIM.estadoSelecionado);
         simRenderPanel();
      });
      // Tooltip base
      layer.bindTooltip(f.properties.NM_ESTADO + ' (Clique para detalhes do Estado)', {
        direction: 'center', className: 'sim-tooltip'
      });
    }
  }).addTo(map);
  
  if (!SIM.estadoSelecionado) {
    map.fitBounds(geojsonLayer.getBounds());
  }
}

function simAtualizarCoresMapaEstados() {
  if (!geojsonLayer) return;
  if (locaisLayer) map.removeLayer(locaisLayer);
  map.addLayer(geojsonLayer);
  
  geojsonLayer.eachLayer(layer => {
    const uf = layer.feature.properties.SIGLA;
    const res = SIM.resultadosUF[uf];
    let fillColor = '#333';
    
    if (res && res.totalSimulado > 0) {
      let maxVotos = -1;
      let venc = null;
      SIM.candidatos.forEach(c => {
         if (res[c.nome] > maxVotos) { maxVotos = res[c.nome]; venc = c; }
      });
      if (venc) {
        const pct = (maxVotos / res.totalSimulado) * 100;
        // Se vitória mto fraca 50%, opacidade menor, vitória grande 90%, saturado
        // getGradientColor clareia cor. Range 0 a 100. Vitória magra (30-40%) -> claro
        fillColor = getGradientColor(venc.cor, pct); 
      }
    }

    layer.setStyle({ fillColor, fillOpacity: 0.9, color: '#111', weight: 1 });
    
    if (res && res.totalSimulado > 0) {
       layer.setTooltipContent(`
         <div style="text-align:center;">
           <strong>${layer.feature.properties.NM_ESTADO}</strong><br>
           Votos Projetados: ${res.totalSimulado.toLocaleString('pt-BR')}
         </div>
       `);
    }
  });
}

function simRenderMapaLocais(uf) {
  if (geojsonLayer) map.removeLayer(geojsonLayer);
  if (locaisLayer) map.removeLayer(locaisLayer);

  const geoCollection = SIM.locaisCache[uf];
  if (!geoCollection) return;

  locaisLayer = L.geoJSON(geoCollection, {
    pointToLayer: (feat, latlng) => {
       let cor = '#555';
       let radius = 4;
       
       const venc = feat.properties._sim_vencedor;
       if (venc) {
          const resMap = feat.properties._sim_votos;
          const maxV = resMap[venc.nome];
          const totalV = feat.properties._sim_total_cand;
          const pct = (maxV / totalV)*100;
          cor = getGradientColor(venc.cor, pct);
          if (totalV > 2000) radius = 7;
          else if (totalV > 1000) radius = 5;
       }
       
       return L.circleMarker(latlng, {
         radius: radius,
         fillColor: cor,
         color: '#000',
         weight: 0.5,
         fillOpacity: 0.8
       });
    },
    onEachFeature: (f, layer) => {
       const p = f.properties;
       if(!p._sim_votos) return;

       let t = `<strong>${p.nm_locvot || 'Local N/D'}</strong><br>
                <small>${p.nm_localidade || ''} - ${uf}</small><br>
                <hr style="margin:4px 0; border:0; border-top:1px solid #444;">`;
       
       const totalV = p._sim_total_cand;
       if(totalV > 0) {
         SIM.candidatos.slice().sort((a,b)=> p._sim_votos[b.nome] - p._sim_votos[a.nome]).forEach(c => {
           const v = p._sim_votos[c.nome];
           if (v > 0) {
              const pct = ((v/totalV)*100).toFixed(1);
              t += `<div style="display:flex; justify-content:space-between; width:150px;">
                      <span style="color:${c.cor}">${c.nome}</span>
                      <span>${pct}% (${v})</span>
                    </div>`;
           }
         });
       } else {
         t += `Sem eleitores simulados`;
       }

       layer.bindTooltip(t, {className: 'sim-tooltip'});
    }
  }).addTo(map);

  map.fitBounds(locaisLayer.getBounds(), { padding: [50, 50] });
}
