/* ===========================================================================
   Check do front da apuração, contra snapshot real do TSE.

   Roda js/apuracao-dados.js e js/apuracao-ui.js num DOM mínimo e confere o que
   quebraria em silêncio na noite: a base do percentual, os estados que o leiaute
   descreve (dv, md, and, esae) e a anatomia do voto.

   O caso de prova é a suplementar de governador de Roraima de 2024, a única
   eleição publicada com voto anulado sub judice em massa — 160.004 votos, contra
   102.845 válidos. É exatamente o caso em que dividir pelos válidos em vez de
   pelos votos a votáveis concorrentes dá 155% ao primeiro colocado.

       python scripts/apuracao/coleta.py --eleicao 6278 --cargo 0003 --uf rr \
           --destino scratch/apuracao/local
       node scripts/apuracao/testar_front.js
   =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..', '..');
const DADOS = path.join(RAIZ, 'scratch', 'apuracao', 'local');

let falhas = 0;

function ok(condicao, rotulo, detalhe) {
  if (condicao) {
    console.log('  [ok ] ' + rotulo);
  } else {
    falhas++;
    console.log('  [ERRO] ' + rotulo + (detalhe ? '  -> ' + detalhe : ''));
  }
}

function perto(a, b, tolerancia, rotulo) {
  ok(Math.abs(a - b) <= tolerancia, rotulo, `${a} vs ${b}`);
}

/* ---------------------------------------------------------------- DOM mínimo */

/* Os módulos do front leem do DOM por getElementById e escrevem innerHTML ou
   textContent. Um nó falso com essas três coisas é tudo de que precisam — sem
   jsdom, que seria uma dependência nova para não testar nada a mais. */
function no(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: false, style: {},
    classList: {
      _c: new Set(),
      add(c) { this._c.add(c); },
      remove(c) { this._c.delete(c); },
      contains(c) { return this._c.has(c); },
      toggle(c, ligado) { if (ligado) this._c.add(c); else this._c.delete(c); }
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    appendChild() {},
    getBoundingClientRect: () => ({ width: 0, height: 0 })
  };
}

const nos = {};
const contexto = {
  console,
  location: { search: '?eleicao=6278&cargo=0003&uf=rr' },
  document: {
    getElementById: (id) => (nos[id] = nos[id] || no(id)),
    createElement: (t) => no(t),
    addEventListener() {}
  },
  window: { innerWidth: 1200, innerHeight: 800 },
  fetch: () => Promise.reject(new Error('sem rede no check')),
  URLSearchParams, Intl, Set, Map, Object, Math, Number, String, Date, JSON
};
contexto.window.document = contexto.document;
vm.createContext(contexto);

/* Os dois arquivos num só script: `const APU` é ligação lexical do script, não
   propriedade do contexto, então rodá-los separados deixaria o segundo sem ver o
   primeiro. A última linha é o que traz as duas fachadas para cá. */
const fontes = ['apuracao-dados.js', 'apuracao-ui.js']
  .map((a) => fs.readFileSync(path.join(RAIZ, 'js', a), 'utf8'))
  .join('\n;\n');
const { APU, APUUI } = vm.runInContext(
  fontes + '\n;({ APU: APU, APUUI: APUUI });', contexto, { filename: 'front.js' });

/* ------------------------------------------------------------------ dados */

const ler = (n) => JSON.parse(fs.readFileSync(path.join(DADOS, n), 'utf8'));
const uf = ler('6278-0003-uf.json');
const mun = ler('6278-0003-rr.json');
const ab = ler('619-ab.json');
const status = ler('status.json');

const rr = uf.abr.rr;
const dicionario = uf.cand;

/* ------------------------------------------------- base do percentual (pvap) */

console.log('\nbase do percentual — o pvap do TSE é sobre vvc, não sobre vv');
const lista = APU.ranking(rr, dicionario);
ok(lista.length > 0, 'ranking devolve candidatos');

/* Cada pct tem de bater com o pvap que o próprio TSE publicou no arquivo, que
   está no dicionário porque candidatos() o guarda. */
const primeiro = lista[0];
ok(primeiro.votos === 160004, 'primeiro colocado com 160.004 votos computados',
  String(primeiro.votos));
perto(primeiro.pct, 60.87, 0.01, 'pct do primeiro = 60,87% (o do TSE), não 155,58%');
ok(rr.vvc === rr.vv + rr.van + rr.vansj, 'hierarquia vvc = vv + van + vansj');
ok(rr.tv === rr.vvc + rr.vb + rr.tvn + rr.vscv, 'hierarquia tv = vvc + vb + tvn + vscv');

/* --------------------------------------------------- destinação e situação */

console.log('\ndestinação do voto (art. 265 §2) e situação da totalização');
ok(primeiro.destino === 'Anulado sub judice', 'dvt do primeiro chega ao ranking',
  primeiro.destino);
const chip = (function () {
  APUUI.placar(lista, 'placar');
  return nos.placar.innerHTML;
})();
ok(chip.includes('Anulado sub judice'), 'placar marca o voto anulado sub judice');
ok(chip.includes('60,87%'), 'placar mostra o percentual do TSE');
ok(!chip.includes('155,58%'), 'placar não mostra o percentual sobre válidos');

/* ------------------------------------------------------ estados do leiaute */

console.log('\nestados que o leiaute do EA20 descreve');
ok(APU.bloqueado({ dv: 'n' }) === true, 'dv=n é divulgação bloqueada');
ok(APU.bloqueado({ dv: 's' }) === false, 'dv=s não é bloqueio');
ok(APU.definicao({ md: 'e', tf: 'n' }) === 'e', 'md=e com tf=n é eleito definido');
ok(APU.definicao({ md: 'e', tf: 's' }) === '', 'md some quando há totalização final');
ok(APU.definicao({ md: 's', tf: 'n' }) === 's', 'md=s é segundo turno definido');

APUUI.selo(uf.meta, rr);
ok(nos.selLive.textContent === 'Encerrada', 'and=f vira "Encerrada"', nos.selLive.textContent);
APUUI.selo(uf.meta, { ...rr, and: 'p' });
ok(nos.selLive.textContent === 'Ao vivo', 'and=p vira "Ao vivo"', nos.selLive.textContent);
APUUI.selo(uf.meta, { ...rr, and: 'n' });
ok(nos.selLive.textContent === 'Aguardando', 'and=n vira "Aguardando"');
ok(nos.selSimulado.classList.contains('is-on') === (uf.meta.f === 's'),
  'selo de simulado segue o campo f');

/* ------------------------------------------------------------------ avisos */

console.log('\navisos: liberação das 17h, sem eleito, eleitorado que falta');
APUUI.avisos({ dv: 'n', esnt: 0 }, [], 'avisos');
ok(nos.avisos.innerHTML.includes('17h'), 'dv=n explica a liberação das 17h');
ok(nos.avisos.hidden === false, 'bloco de avisos aparece quando há aviso');

APUUI.avisos({ dv: 's', esae: 's', mnae: ['Motivo de teste'] }, [], 'avisos');
ok(nos.avisos.innerHTML.includes('sem atribuição de eleito'), 'esae=s é anunciado');
ok(nos.avisos.innerHTML.includes('Motivo de teste'), 'mnae lista os motivos');

APUUI.avisos({ dv: 's', esnt: 5000, snt: 12 },
  [{ votos: 1000 }, { votos: 900 }], 'avisos');
ok(nos.avisos.innerHTML.includes('ainda pode'),
  '5.000 eleitores contra 100 de diferença: ainda pode virar');
APUUI.avisos({ dv: 's', esnt: 50, snt: 1 },
  [{ votos: 1000 }, { votos: 900 }], 'avisos');
ok(nos.avisos.innerHTML.includes('já não'),
  '50 eleitores contra 100 de diferença: já não vira');

APUUI.avisos({ dv: 's' }, [], 'avisos');
ok(nos.avisos.hidden === true, 'sem aviso, o bloco se esconde');

/* ------------------------------------------------------- anatomia do voto */

console.log('\nanatomia do voto e das seções');
APUUI.participacao(rr, 'participacao');
const p = nos.participacao.innerHTML;
ok(p.includes('Anulados sub judice'), 'célula de anulados sub judice aparece');
ok(p.includes('Nominais'), 'célula de votos nominais aparece');
ok(!p.includes('Nulos técnicos'), 'nulo técnico zerado não ocupa célula');

/* A camada municipal não traz a anatomia: célula ausente, não célula zerada. */
const umMunicipio = Object.values(mun.abr)[0];
APUUI.participacao(umMunicipio, 'participacao');
const pm = nos.participacao.innerHTML;
ok(!pm.includes('Anulados sub judice'),
  'município sem o campo não ganha célula de anulados');
ok(pm.includes('Eleitorado'), 'município mantém as células que a camada traz');

/* ------------------------------------------------- acompanhamento e saúde */

console.log('\nacompanhamento (EA14) e saúde do plantão');
ok(ab.br && ab.br.tp === 'br', 'EA14 tem a entrada do Brasil');
ok(Object.keys(ab.uf).length >= 26, 'EA14 tem as unidades federativas',
  String(Object.keys(ab.uf).length));
ok(ab.br.uff + ab.br.ufpt + ab.br.ufnr > 0, 'contadores de estágio das UFs vêm preenchidos');

APUUI.saude(status, 'saude');
const sa = nos.saude.innerHTML;
ok(sa.includes('Ambiente'), 'saúde mostra o ambiente lido');
ok(sa.includes('404'), 'saúde mostra os 404, que bloqueiam como excesso');
ok(nos.saude.hidden === false, 'painel de saúde aparece com status');
APUUI.saude(null, 'saude');
ok(nos.saude.hidden === true, 'sem status.json, o painel se esconde');

/* --------------------------------------------------------------- agregação */

console.log('\nagregação dos municípios');
const soma = APU.agregar(Object.values(mun.abr));
ok(soma.vvc === rr.vvc, 'soma dos municípios fecha com o vvc da UF',
  `${soma.vvc} vs ${rr.vvc}`);
ok(soma.vv === rr.vv, 'soma dos municípios fecha com os válidos da UF');
ok(soma.van === undefined, 'agregado não inventa campo que a camada não traz');

/* ------------------------------------------ eleito e segundo turno */

/* A marca declara gente eleita numa tela pública, então o que ela pode e o que
   ela NÃO pode fazer vale um check próprio. Medido no simulado de 15/09: com a
   apuração correndo, o TSE deixa `e` e `st` vazios mesmo com `md` já em 's' — a
   marca tem de sair de `nv` e `md`, e tem de se identificar como dedução. */

console.log('\nmarca de eleito e de segundo turno');

const chapa = (n) => Array.from({ length: n }, (_, i) => ({
  chave: String(i), urna: 'C' + i, votos: 100 - i, pct: 10 - i, partido: 'P' + i
}));

// Senado: duas vagas, apuração encerrada, TSE ainda sem declarar
let l = APU.marcar(chapa(4), { nv: 2, snt: 0 }, '0005');
ok(l[0].marca === 'eleito' && l[1].marca === 'eleito',
  'Senado com nv=2 e apuração fechada marca os DOIS primeiros',
  l.map((c) => c.marca).join(','));
ok(l[2].marca === '', 'e não marca o terceiro');
ok(l[0].oficial === false, 'a marca se identifica como dedução, não como oficial');

// Senado ainda contando: nada de marca
l = APU.marcar(chapa(4), { nv: 2, snt: 1200 }, '0005');
ok(l.every((c) => !c.marca), 'Senado com seções a totalizar não marca ninguém',
  l.map((c) => c.marca).join(','));

// Presidente: md='s' é o TSE dizendo que a eleição está definida em 2º turno
l = APU.marcar(chapa(5), { nv: 1, md: 's', snt: 9000 }, '0001');
ok(l[0].marca === 'segundo' && l[1].marca === 'segundo',
  'md=s marca os dois primeiros como segundo turno');
ok(l[2].marca === '', 'e o terceiro fica sem marca');
ok(l[0].oficial === false, 'ainda é dedução, porque o TSE não declarou');

// Presidente definido no primeiro turno
l = APU.marcar(chapa(3), { nv: 1, md: 'e', snt: 9000 }, '0001');
ok(l[0].marca === 'eleito' && l[1].marca === '', 'md=e marca só o primeiro');

// Vaga única, 100% apurado, sem md: NÃO declara vencedor
l = APU.marcar(chapa(3), { nv: 1, snt: 0 }, '0003');
ok(l.every((c) => !c.marca),
  'governador com tudo apurado mas sem md não ganha marca — isso seria projeção',
  l.map((c) => c.marca).join(','));

// O que o TSE declara manda, e vira oficial
l = APU.marcar([{ ...chapa(1)[0], situacao: 'Eleito por média' }], { nv: 8 }, '0005');
ok(l[0].marca === 'eleito' && l[0].oficial === true,
  'situação preenchida pelo TSE vira marca oficial');

l = APU.marcar([{ ...chapa(1)[0], situacao: 'Suplente' }], { nv: 2, snt: 0 }, '0005');
ok(l[0].marca === 'suplente' && l[0].oficial === true, 'suplente é reconhecido');

l = APU.marcar(chapa(3).map((c) => ({ ...c, eleito: true })),
  { nv: 1, md: 's' }, '0001');
ok(l[0].marca === 'segundo' && l[0].oficial === true,
  'e=s com md=s é classificação ao segundo turno, não eleição');

// Proporcional não recebe marca: a lista ali é de partidos
const antes = chapa(3);
APU.marcar(antes, { nv: 70, snt: 0 }, '0006');
ok(antes.every((c) => c.marca === undefined),
  'cargo proporcional não recebe marca nenhuma');

/* --------------------------------------------- entidades HTML nos snapshots */

/* Todo texto do TSE vem com entidade dentro da string — "D&apos;OESTE",
   "1&#186; Turno", "FELIPE D&apos;AVILA". O coletor desfaz isso com texto(), e
   quem esquecer de chamar texto() num campo novo manda a entidade crua para a
   tela, onde o esc() da renderização a congela de vez. Já escapou duas vezes: no
   nome da eleição e no nome do município. Esta varredura fecha a classe inteira,
   em vez de esperar a próxima aparecer numa captura de tela. */

console.log('\nentidades HTML nos snapshots publicados');
const ENTIDADE = /&(?:[a-zA-Z]+|#\d+);/;

function varrer(valor, caminho, achados) {
  if (typeof valor === 'string') {
    if (ENTIDADE.test(valor)) achados.push(caminho + ' = ' + JSON.stringify(valor));
  } else if (valor && typeof valor === 'object') {
    for (const k of Object.keys(valor)) varrer(valor[k], caminho + '.' + k, achados);
  }
}

const pastas = [DADOS, path.join(RAIZ, 'scratch', 'apuracao', 'simulado')];
let varridos = 0;
const sujos = [];
for (const pasta of pastas) {
  if (!fs.existsSync(pasta)) continue;
  for (const nome of fs.readdirSync(pasta).filter((n) => n.endsWith('.json'))) {
    varridos++;
    const achados = [];
    varrer(JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8')), nome, achados);
    sujos.push(...achados);
  }
}
ok(varridos > 0, 'ha snapshot para varrer', String(varridos));
ok(sujos.length === 0, varridos + ' snapshots sem entidade HTML crua',
  sujos.slice(0, 3).join(' | '));

console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'tudo certo'));
process.exit(falhas ? 1 : 0);
