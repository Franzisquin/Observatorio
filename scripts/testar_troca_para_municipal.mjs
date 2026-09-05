/* Trocar de eleicao GERAL para MUNICIPAL e clicar num municipio do mapa.
 *
 * O defeito que este teste tranca:
 *
 * Ao entrar no modo municipal, o seletor de UF ja vem com um estado escolhido
 * (o primeiro da lista — o Acre) e o resumo estadual e desenhado. Mas o
 * preenchimento do seletor de MUNICIPIOS morava so dentro do handler de
 * 'change' da UF, que nesse caminho nao dispara. O seletor ficava vazio.
 *
 * Com ele vazio, o clique num municipio do mapa nao acha a <option>
 * correspondente. O codigo entao faz `select.value = nome` — e atribuir a um
 * <select> um value que nao existe entre as options deixa o value em ''. O
 * 'change' dispara vazio, o site entende "voltar ao resumo estadual", e o
 * usuario ve o mapa PISCAR E NAO FAZER NADA.
 *
 * Sempre no primeiro estado depois da troca; depois de escolher qualquer UF no
 * dropdown, o handler roda, as options aparecem e tudo passa a funcionar —
 * inclusive o Acre. Era por isso que parecia um defeito "do Acre".
 *
 *     node scripts/testar_troca_para_municipal.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  - ' + detalhe : ''}`);
  if (!cond) falhas++;
}

const lista = JSON.parse(readFileSync(path.join(RAIZ, 'lista_municipios.json'), 'utf8'));
const fonteUi = readFileSync(path.join(RAIZ, 'js/ui-controls.js'), 'utf8');

console.log('Troca de eleicao geral -> municipal');

// ------------------------------------------------- <select> de verdade
//
// O ponto do teste e o comportamento do <select>: atribuir um value que nao
// esta entre as options NAO gruda. E isso que transformava "seletor vazio" em
// "volta ao resumo estadual".
function novoSelect() {
  return {
    options: [],
    _value: '',
    innerHTML: '',
    disabled: false,
    get value() { return this._value; },
    set value(v) {
      const existe = this.options.some((o) => o.value === v);
      this._value = existe ? v : '';
    },
    appendChild(opt) { this.options.push(opt); },
    set innerHTMLReset(_) {}
  };
}

// Reproduz popularMunicipiosDaUF sem carregar o site inteiro: o que importa e
// se ela E CHAMADA no caminho da troca de eleicao, verificado logo abaixo.
function popular(select, uf) {
  select.options = [{ value: '', text: 'Resumo estadual' }];
  select._value = '';
  (lista[uf] || []).slice().sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .forEach((nome) => select.options.push({ value: nome, text: nome }));
  select.disabled = select.options.length <= 1;
}

// ------------------------------------------------- o mecanismo do defeito
{
  const sel = novoSelect();
  // Estado ANTES da correcao: entrou no modo municipal sem popular o seletor.
  sel.options = [{ value: '', text: 'Resumo estadual' }];

  // O clique no mapa: nao acha a option e cai no `select.value = nome`.
  const nome = 'RIO BRANCO';
  const achou = sel.options.some((o) => o.value === nome);
  sel.value = nome;
  ok(achou === false && sel.value === '',
    'seletor vazio: atribuir o nome NAO gruda, o value fica vazio',
    JSON.stringify(sel.value));

  // E value vazio e exatamente o que o listener entende como "resumo estadual".
  ok(!sel.value, 'e o change dispara vazio — dai o "piscar e voltar"');
}

// ------------------------------------------------- com o seletor populado
{
  const sel = novoSelect();
  popular(sel, 'AC');
  ok(sel.options.length === (lista.AC || []).length + 1,
    `AC popula ${(lista.AC || []).length} municipios + "Resumo estadual"`,
    `${sel.options.length}`);

  sel.value = 'RIO BRANCO';
  ok(sel.value === 'RIO BRANCO',
    'com as options no lugar, o clique gruda o municipio e a carga acontece');

  // O acento e o caso que mais assusta, e passa igual.
  sel.value = 'BRASILÉIA';
  ok(sel.value === 'BRASILÉIA', 'inclusive nomes acentuados');
}

// ------------------------------------------------- a correcao esta no lugar
//
// Nao ha como executar o handler de troca de eleicao aqui sem montar o site
// inteiro; o que se garante e que o preenchimento deixou de morar SO dentro do
// handler de 'change' da UF, e passou a ser chamado tambem ao entrar no modo
// municipal — que era o caminho sem cobertura.
{
  ok(/function popularMunicipiosDaUF\(uf\)/.test(fonteUi),
    'o preenchimento virou funcao propria, fora do handler de UF');

  const trechoMunicipal = fonteUi.slice(
    fonteUi.indexOf("if (type === 'municipal') {", fonteUi.indexOf('selectElectionLevel')),
    fonteUi.indexOf('showMunicipalStatewideOverview', fonteUi.indexOf('selectElectionLevel')) + 40);
  ok(/popularMunicipiosDaUF\(uf\)/.test(trechoMunicipal),
    'e e chamado ao entrar no modo municipal, ANTES de desenhar o mapa clicavel');

  const handlerUf = fonteUi.slice(fonteUi.indexOf('dom.selectUFMunicipal.addEventListener'));
  ok(/popularMunicipiosDaUF\(uf\)/.test(handlerUf.slice(0, 1200)),
    'o handler de UF passou a usar a mesma funcao, sem duplicar a logica');
}

// ------------------------------------------------- e o caminho de VOLTA
//
// O botao "Carregar" e display:none: quem carrega e o disparo automatico, e
// todo seletor que muda o contexto o agenda. O handler de TIPO de eleicao era o
// unico que nao agendava. Na ida isso passava despercebido, porque o ramo
// municipal chama showMunicipalStatewideOverview direto; na volta para a geral
// nao havia nada — o mapa municipal anterior ficava na tela, nenhum dado novo
// era lido, e so o F5 resolvia (no boot o site carrega sozinho).
{
  const inicio = fonteUi.indexOf('dom.selectElectionLevel.addEventListener');
  const fim = fonteUi.indexOf('dom.selectYearGeneral.addEventListener', inicio);
  ok(inicio > -1 && fim > inicio, 'o handler de tipo de eleicao foi localizado');
  const handler = fonteUi.slice(inicio, fim);

  const ramoMunicipal = handler.slice(handler.lastIndexOf("if (type === 'municipal') {"));
  const ramoGeral = handler.slice(handler.indexOf('VOLTAR PARA A GERAL'));

  ok(/showMunicipalStatewideOverview\(/.test(ramoMunicipal),
    'ida: entrar na municipal desenha o resumo estadual');
  ok(ramoGeral.length > 0 && /scheduleInstantLoad\(\)/.test(ramoGeral),
    'volta: sair para a geral agenda a carga, como todo outro seletor faz');
  ok(/map\?\.hasLayer\?\.\(STATE\.municipiosLayer\)/.test(ramoGeral)
    && /removeLayer\(STATE\.municipiosLayer\)/.test(ramoGeral),
    'e tira o mapa municipal da tela antes de carregar');
  ok(/STATE\.currentMapMuniUF = null/.test(ramoGeral),
    'sem deixar a UF municipal pendurada em STATE');

  // A regra geral: nenhum seletor de contexto pode ficar sem gatilho de carga.
  const semGatilho = [
    ['UF geral', 'dom.selectUFGeneral.addEventListener', 'dom.selectYearGeneral?.addEventListener'],
    ['ano geral', 'dom.selectYearGeneral?.addEventListener', 'Enche o seletor de municipios'],
    ['ano municipal', 'dom.selectYearMunicipal?.addEventListener', 'FILTRO REGIONAL'],
    ['municipio', 'dom.selectMunicipio.addEventListener', 'dom.selectYearMunicipal?.addEventListener'],
  ].filter(([, abre, fecha]) => {
    const i = fonteUi.indexOf(abre);
    if (i < 0) return true;
    const trecho = fonteUi.slice(i, fonteUi.indexOf(fecha, i + 1));
    return !/scheduleInstantLoad\(\)|showMunicipalStatewideOverview\(/.test(trecho);
  }).map(([nome]) => nome);

  ok(semGatilho.length === 0,
    'e todo seletor de contexto continua com gatilho de carga',
    semGatilho.join(', ') || 'nenhum sem gatilho');
}

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo ok.');
process.exit(falhas ? 1 : 0);
