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
  const n = {
    id, textContent: '', hidden: false, style: {},
    classList: {
      _c: new Set(),
      add(c) { this._c.add(c); },
      remove(c) { this._c.delete(c); },
      contains(c) { return this._c.has(c); },
      toggle(c, ligado) { if (ligado) this._c.add(c); else this._c.delete(c); }
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    /* Guarda o que foi anexado: os botões de "Mostrar mais" do placar e da
       participação entram por aqui, e sem isso não haveria como acioná-los. */
    filhos: [],
    appendChild(filho) { this.filhos.push(filho); },
    getBoundingClientRect: () => ({ width: 0, height: 0 })
  };

  /* Reatribuir innerHTML descarta os filhos, como no navegador. Sem isso um
     botão de uma renderização anterior sobrevivia à seguinte, e uma asserção
     sobre "tem botão?" passaria a responder sobre lixo acumulado. */
  let html = '';
  Object.defineProperty(n, 'innerHTML', {
    get: () => html,
    set: (v) => { html = v; n.filhos.length = 0; },
    enumerable: true
  });
  return n;
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
const fontes = ['espectro-partidos.js', 'apuracao-dados.js', 'apuracao-ui.js']
  .map((a) => fs.readFileSync(path.join(RAIZ, 'js', a), 'utf8'))
  .join('\n;\n');
const { APU, APUUI } = vm.runInContext(
  fontes + '\n;({ APU: APU, APUUI: APUUI });', contexto, { filename: 'front.js' });

/* ------------------------------------------------------------------ dados */

const ler = (n) => JSON.parse(fs.readFileSync(path.join(DADOS, n), 'utf8'));
const uf = ler('6278-0003-uf.json');
const mun = ler('6278-0003-rr.json');
const ab = ler('619-ab.json');

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

/* ------------------------------------------------------------ cor do mapa */

/* A mesma regra pinta o SVG das páginas estaduais e o MapLibre da presidencial:
   se ela quebrar, os dois mapas saem plausíveis e errados juntos. */
console.log('\ncor do mapa — o tom do líder, pela faixa do percentual dele');
const tinta = APUUI.tinta(rr, dicionario);
ok(!!tinta && tinta.cor === APUUI.tom(APU.cor(primeiro.partido), APUUI.faixa(primeiro.pct)),
  'a cor é o tom da faixa do líder, na cor do partido dele', tinta && tinta.cor);
ok(!!tinta && tinta.op === 1, 'tom sólido, sem transparência', tinta && String(tinta.op));
ok(APUUI.faixa(19.99) === 0 && APUUI.faixa(20) === 1 && APUUI.faixa(55) === 4
  && APUUI.faixa(79.9) === 6 && APUUI.faixa(80) === 7 && APUUI.faixa(100) === 7,
  'faixas de 10 pontos: <20, 20–30, …, 70–80, 80+');
ok(APUUI.tom('#304091', 5) === '#304091', 'entre 60% e 70% o tom é a própria cor do partido');
ok(APUUI.tom('#304091', 0) !== APUUI.tom('#304091', 7), 'o mais claro e o mais escuro diferem');
ok(/^#[0-9a-f]{6}$/.test(APUUI.tom('hsl(210 58% 56%)', 3)), 'cor derivada (hsl) também ganha tom');
ok(APUUI.tinta(null, dicionario) === null, 'sem boletim não há tinta');
ok(APUUI.tinta({ ...rr, vv: 0 }, dicionario) === null, 'sem voto válido não há tinta');

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
ok(APU.lider({ vv: 0, cand: { a: 0, b: 0 } }, {}) === null,
  'sem voto apurado não há líder — nada de candidato qualquer em 0,00%');
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

console.log('\navisos: liberação das 17h e totalização sem eleito');
APUUI.avisos({ dv: 'n', esnt: 0 }, 'avisos');
ok(nos.avisos.innerHTML.includes('17h'), 'dv=n explica a liberação das 17h');
ok(nos.avisos.hidden === false, 'bloco de avisos aparece quando há aviso');

APUUI.avisos({ dv: 's', esae: 's', mnae: ['Motivo de teste'] }, 'avisos');
ok(nos.avisos.innerHTML.includes('sem atribuição de eleito'), 'esae=s é anunciado');
ok(nos.avisos.innerHTML.includes('Motivo de teste'), 'mnae lista os motivos');

/* O aviso de eleitorado que falta e de virada possível saiu da tela: a linha de
   seções do cabeçalho já diz o que falta. Aqui se garante que não voltou. */
APUUI.avisos({ dv: 's', esnt: 5000, snt: 12 }, 'avisos');
ok(nos.avisos.hidden === true,
  'eleitorado que falta não gera aviso — o bloco fica escondido');

APUUI.avisos({ dv: 's' }, 'avisos');
ok(nos.avisos.hidden === true, 'sem aviso, o bloco se esconde');

/* ------------------------------------------------------- anatomia do voto */

console.log('\nanatomia do voto e das seções');

/* O painel nasce fechado: o que aparece é o botão, não as treze células. */
const abrirParticipacao = () => {
  const filhos = nos.participacao.filhos;
  filhos[filhos.length - 1].onclick();
};

APUUI.participacao(rr, 'participacao');
ok(nos.participacao.innerHTML === '', 'participação nasce fechada, sem células');
ok(/^Mostrar mais \(\d+\)$/.test(
  nos.participacao.filhos[nos.participacao.filhos.length - 1].textContent),
'e oferece o botão de mostrar mais');

abrirParticipacao();
const p = nos.participacao.innerHTML;
ok(p.includes('Anulados sub judice'), 'célula de anulados sub judice aparece');
ok(p.includes('Nominais'), 'célula de votos nominais aparece');
ok(!p.includes('Nulos técnicos'), 'nulo técnico zerado não ocupa célula');
ok(nos.participacao.filhos[nos.participacao.filhos.length - 1].textContent
  === 'Mostrar menos', 'aberto, o botão oferece fechar');

/* A escolha de quem abriu tem de sobreviver ao redesenho de cada boletim. */
APUUI.participacao(rr, 'participacao');
ok(nos.participacao.innerHTML.includes('Nominais'),
  'o painel aberto continua aberto no boletim seguinte');

abrirParticipacao();
ok(nos.participacao.innerHTML === '', 'e fecha de volta pelo mesmo botão');

/* --- o arranjo que as páginas usam: um botão só para os dois blocos --- */

/* `seguir` amarra a participação à abertura do placar, e o botão do placar é
   ancorado fora dele, depois da participação — senão o "Mostrar menos" ficaria
   no meio do que fecha. É a montagem de apuracao-nacional.js e apuracao-uf.js. */
/* `limite: 2` porque a suplementar de RR tem poucas candidaturas: sem isso a
   lista caberia inteira e o botão — que é o objeto do teste — não existiria. */
const chapaRR = APU.ranking(rr, dicionario);
const verParticipacao = () =>
  APUUI.participacao(rr, 'participacao', { seguir: 'placar' });
const montar = () => APUUI.placar(chapaRR, 'placar',
  { entrada: rr, cargo: '0003', limite: 2, botao: 'maisResultado',
    aoAlternar: verParticipacao });

montar();
verParticipacao();
ok(chapaRR.length > 2, 'a chapa de prova excede o limite, então há botão',
  String(chapaRR.length));
ok(nos.participacao.filhos.length === 0,
  'com `seguir`, a participação não ganha botão próprio');
ok(nos.maisResultado.filhos.length === 1,
  'o botão do placar é ancorado fora dele');
ok(nos.placar.filhos.length === 0, 'e não sobra botão dentro do placar');
ok(nos.participacao.innerHTML === '' && nos.rotuloParticipacao.hidden === true,
  'fechada, a participação esconde células e título');

nos.maisResultado.filhos[0].onclick();
ok(nos.participacao.innerHTML.includes('Nominais'),
  'o botão do placar abre a participação junto');
ok(nos.rotuloParticipacao.hidden === false, 'e traz o título de volta');
ok(nos.maisResultado.filhos[nos.maisResultado.filhos.length - 1].textContent
  === 'Mostrar menos', 'e passa a oferecer fechar');

nos.maisResultado.filhos[nos.maisResultado.filhos.length - 1].onclick();
ok(nos.participacao.innerHTML === '' && nos.rotuloParticipacao.hidden === true,
  'e fecha os dois de uma vez');

/* A camada municipal não traz a anatomia: célula ausente, não célula zerada. */
const umMunicipio = Object.values(mun.abr)[0];
APUUI.participacao(umMunicipio, 'participacao');
abrirParticipacao();
const pm = nos.participacao.innerHTML;
ok(!pm.includes('Anulados sub judice'),
  'município sem o campo não ganha célula de anulados');
ok(pm.includes('Eleitorado'), 'município mantém as células que a camada traz');

/* ---------------------------------------------------------- acompanhamento */

console.log('\nacompanhamento (EA14)');
ok(ab.br && ab.br.tp === 'br', 'EA14 tem a entrada do Brasil');
ok(Object.keys(ab.uf).length >= 26, 'EA14 tem as unidades federativas',
  String(Object.keys(ab.uf).length));
ok(ab.br.uff + ab.br.ufpt + ab.br.ufnr > 0, 'contadores de estágio das UFs vêm preenchidos');

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

// Matematicamente eleito, pela conta com o eleitorado que falta (esnt)
const votos3 = (a, b, c) => [{ votos: a }, { votos: b }, { votos: c }];
l = APU.marcar(votos3(600, 300, 100), { nv: 1, vv: 1000, esnt: 150, snt: 50 }, '0003');
ok(l[0].marca === 'eleito' && l[0].matematico && !l[0].oficial,
  'governador: 600 de 1.000 válidos com 150 eleitores faltando é matematicamente eleito');
l = APU.marcar(votos3(600, 300, 100), { nv: 1, vv: 1000, esnt: 250, snt: 50 }, '0003');
ok(!l[0].marca, 'com 250 faltando ainda não: 600 não passa de (1.000 + 250) / 2');
l = APU.marcar(votos3(500, 300, 100), { nv: 1, vv: 900, esnt: 150, snt: 50 }, '0005');
ok(l[0].marca === 'eleito' && l[0].matematico && !l[1].marca,
  'Senado: à frente do primeiro de fora por mais que o eleitorado restante');
l = APU.marcar(votos3(600, 300, 100), { nv: 1, vv: 1000, snt: 50 }, '0003');
ok(!l[0].marca, 'sem esnt (camada municipal) não há conta, e não há marca');
l = APU.marcar(votos3(600, 300, 100), { nv: 1, vv: 1000, md: 'e' }, '0003');
ok(l[0].matematico, 'md=e do TSE também é matematicamente eleito');
l = APU.marcar(votos3(450, 350, 200), { nv: 1, vv: 1000, md: 's' }, '0003');
ok(l[0].marca === 'segundo' && l[0].matematico && l[1].matematico && !l[2].marca,
  'md=s do TSE: os dois primeiros vão ao 2º turno, com marca firme');

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

/* --------------------------------------- quem sai da lista antes da 1ª urna */

/* A distinção que custa caro errar: "Indeferido" é registro negado com decisão
   firme e sai da tela, mas "Indeferido em prazo recursal ou com recurso"
   concorre sub judice, vai estar na urna e pode receber voto. Um `^Indeferido`
   sem âncora no fim apagaria os dois — o eleitor abriria a página e não
   acharia candidato que o TSE mostra na hora de votar. */

console.log('\ncandidaturas que não entram no ranking zerado');
const registro = {
  a: { urna: 'DEFERIDA', partido: 'X', uf: 'MG', situacao: 'Deferido' },
  b: { urna: 'COM RECURSO', partido: 'X', uf: 'MG', situacao: 'Deferido com recurso' },
  c: { urna: 'PENDENTE', partido: 'X', uf: 'MG', situacao: 'Pendente de julgamento' },
  d: { urna: 'SUB JUDICE', partido: 'X', uf: 'MG', situacao: 'Indeferido em prazo recursal ou com recurso' },
  e: { urna: 'NEGADA', partido: 'X', uf: 'MG', situacao: 'Indeferido' },
  f: { urna: 'DESISTIU', partido: 'X', uf: 'MG', situacao: 'Renúncia' },
  g: { urna: 'SEM SITUACAO', partido: 'X', uf: 'MG', situacao: '' },
  h: { urna: 'DE OUTRA UF', partido: 'X', uf: 'SP', situacao: 'Deferido' },
  i: { urna: 'CANCELADA', partido: 'X', uf: 'MG', situacao: 'Cancelado' },
  j: { urna: 'FALECEU', partido: 'X', uf: 'MG', situacao: 'Falecimento' },
  k: { urna: 'NAO CONHECIDO', partido: 'X', uf: 'MG', situacao: 'Pedido não conhecido' },
  l: { urna: 'NAO CONHECIDO RECORRE', partido: 'X', uf: 'MG',
    situacao: 'Pedido não conhecido em prazo recursal ou com recurso' }
};
const naTela = new Set(APU.rankingZerado(registro, 'mg').map((c) => c.chave));
ok(naTela.has('d') && naTela.has('l'), 'quem ainda recorre CONTINUA na lista — está na urna');
ok(!naTela.has('e') && !naTela.has('k'), 'indeferido e pedido não conhecido com decisão firme saem');
ok(!naTela.has('f') && !naTela.has('i') && !naTela.has('j'), 'renúncia, cancelamento e falecimento saem');
ok(naTela.has('a') && naTela.has('b') && naTela.has('c'), 'deferido e pendente ficam');
ok(naTela.has('g'), 'situação vazia não é motivo para sumir com o candidato');
ok(!naTela.has('h'), 'o filtro de UF segue valendo');
ok(naTela.size === 6, 'nada além disso entrou', [...naTela].join(','));
ok(APU.nomeProprio('FERNANDO FERREIRA (GÊMEOS)') === 'Fernando Ferreira (Gêmeos)'
  && APU.nomeProprio("JOÃO D'ÁVILA DA SILVA") === "João D'Ávila da Silva",
  'nome: maiúscula depois de parêntese e de apóstrofo, partícula em minúscula',
  APU.nomeProprio('FERNANDO FERREIRA (GÊMEOS)'));

/* ------------------------------------------------------ deputados: vagas */

/* A página de deputados diz quem está dentro das vagas de cada bloco. O que
   ela pode deduzir e o que só o TSE pode declarar valem um check próprio,
   como a marca de eleito majoritário acima. */

console.log('\ndeputados: quem ocupa as vagas do bloco');

const lista3 = (extra) => [
  { sq: 'a', urna: 'ANA', partido: 'AA', v: 900 },
  { sq: 'b', urna: 'BETO', partido: 'AA', v: 800, dvt: 'Anulado sub judice' },
  { sq: 'c', urna: 'CAIO', partido: 'BB', v: 700 },
  { sq: 'd', urna: 'DIDI', partido: 'BB', v: 600 },
  ...(extra || [])
];

let ml = APU.marcarLista(lista3(), 2);
ok(ml.map((c) => c.sq).join('') === 'abcd', 'lista ordenada por voto');
ok(ml[0].dentro && !ml[1].dentro && ml[2].dentro && !ml[3].dentro,
  'duas vagas vão aos dois mais votados que disputam vaga — o sub judice é pulado',
  ml.map((c) => c.sq + (c.dentro ? '*' : '')).join(','));
ok(ml.every((c) => !c.oficial), 'sem st nem e, a leitura das vagas é dedução');

ml = APU.marcarLista(lista3(), 0);
ok(ml.every((c) => !c.dentro), 'bloco sem vaga não põe ninguém dentro');

ml = APU.marcarLista(lista3().map((c) => (c.sq === 'd' ? { ...c, e: 's' } : c)), 2);
ok(ml[3].dentro && ml[3].oficial, 'e=s do TSE vale como declarado');
ok(ml[0].dentro && !ml[0].oficial && !ml[2].dentro,
  'e a vaga que sobra vai ao mais votado, sem passar do total do bloco',
  ml.map((c) => c.sq + (c.dentro ? '*' : '')).join(','));

ml = APU.marcarLista(lista3().map((c) => ({
  ...c, st: c.sq === 'c' ? 'Eleito por média' : (c.sq === 'a' ? 'Suplente' : 'Não eleito')
})), 2);
ok(ml.filter((c) => c.dentro).map((c) => c.sq).join('') === 'c',
  'na totalização final só o st manda — nenhuma vaga é deduzida por cima dele');
ok(ml[0].marca === 'suplente' && ml[3].marca === 'fora', 'suplente e não eleito reconhecidos');

console.log('\ndeputados: blocos, nome e espectro');

const agremTeste = [
  { nm: 'Federação Brasil da Esperança - FE BRASIL', com: 'PT/PC do B/PV', tp: 'f', fed: 'FE BRASIL',
    vag: 3, v: 300, par: [{ sg: 'PT', vtn: 250, vtl: 10 }, { sg: 'PC do B', vtn: 20 }, { sg: 'PV', vtn: 20 }] },
  { nm: 'FEDERAÇÃO PSOL REDE', com: 'PSOL/REDE', tp: 'f', fed: 'PSOL REDE',
    vag: 1, v: 100, par: [{ sg: 'PSOL', vtn: 90 }, { sg: 'REDE', vtn: 10 }] },
  { nm: 'PARTIDO LIBERAL', com: 'PARTIDO LIBERAL', tp: 'i', vag: 3, v: 300,
    par: [{ sg: 'PL', nm: 'PARTIDO LIBERAL', vtn: 300 }] },
  { nm: 'FEDERAÇÃO 9995', com: 'P 9984 / P 9992', tp: 'f', fed: 'F 9995', vag: 0, v: 50,
    par: [{ sg: 'P 9984', vtn: 25 }, { sg: 'P 9992', vtn: 25 }] }
];
const bl = APU.blocos(agremTeste, { vv: 750 });
const porChaveBl = Object.fromEntries(bl.map((b) => [b.chave, b]));
ok(porChaveBl['F:FE BRASIL'].rotulo === 'BRASIL DA ESPERANÇA',
  'federação perde o "Federação" e a sigla do fim, e sai em maiúsculas', porChaveBl['F:FE BRASIL'].rotulo);
ok(porChaveBl['F:PSOL REDE'].rotulo === 'PSOL REDE',
  'nome de federação em maiúsculas, como sigla de partido', porChaveBl['F:PSOL REDE'].rotulo);
ok(porChaveBl['F:F 9995'].rotulo === 'F 9995', 'nome só com número cai na sigla da federação');
ok(porChaveBl['P:PL'].rotulo === 'PL', 'partido isolado aparece pela sigla');
ok(porChaveBl['F:FE BRASIL'].cor === APU.cor('PT'), 'a cor da federação é a do partido cabeça');
ok(porChaveBl['F:F 9995'].siglas.join('/') === 'P 9984/P 9992',
  'composição com espaço em volta da barra é lida igual');
ok(bl.slice().sort(APU.porEspectro).map((b) => b.rotulo).join(' < ')
  === 'PSOL REDE < BRASIL DA ESPERANÇA < PL < F 9995',
  'hemiciclo: esquerda para a direita, e sigla fora da régua no fim',
  bl.slice().sort(APU.porEspectro).map((b) => b.rotulo).join(' < '));
ok(bl.slice().sort(APU.porCadeiras).map((b) => b.rotulo).join(',')
  === 'BRASIL DA ESPERANÇA,PL,PSOL REDE,F 9995',
  'listas: cadeiras primeiro e voto no desempate (3 x 3, mesmo voto: alfabética)',
  bl.slice().sort(APU.porCadeiras).map((b) => b.rotulo).join(','));

const somados = APU.somarBlocos({ sp: bl, rj: APU.blocos(agremTeste.slice(0, 1), { vv: 300 }) });
const feNacional = somados.find((b) => b.chave === 'F:FE BRASIL');
ok(feNacional.vagas === 6 && feNacional.porUF.length === 2,
  'a federação soma as bancadas das UFs pela mesma chave');

/* As federações de 2026, como o DivulgaCandContas as escreve: nome limpo, cor e
   lugar no hemiciclo da cabeça (União; PRD). */
const fed2026 = APU.blocos([
  { nm: 'FEDERAÇÃO UNIÃO PROGRESSISTA(44-UNIÃO/11-PP)', com: 'UNIÃO/PP', tp: 'f', fed: 'UNIÃO PROGRESSISTA',
    vag: 0, v: 10, par: [{ sg: 'UNIÃO', vtn: 6 }, { sg: 'PP', vtn: 4 }] },
  { nm: 'FEDERAÇÃO RENOVAÇÃO SOLIDÁRIA', com: 'PRD/SOLIDARIEDADE', tp: 'f', fed: 'RENOVAÇÃO SOLIDÁRIA',
    vag: 0, v: 10, par: [{ sg: 'PRD', vtn: 5 }, { sg: 'SOLIDARIEDADE', vtn: 5 }] }
], { vv: 20 });
ok(fed2026.map((b) => b.rotulo).join(' | ') === 'UNIÃO PROGRESSISTA | RENOVAÇÃO SOLIDÁRIA',
  'federações de 2026: nome sem "Federação" e sem a composição, em maiúsculas', fed2026.map((b) => b.rotulo).join(' | '));
ok(fed2026[0].cor === APU.cor('UNIÃO') && fed2026[1].cor === APU.cor('PRD'),
  'federações de 2026: cor da cabeça');
ok(fed2026[0].espectro === 30 && fed2026[1].espectro === 33
  && contexto.window.getPartySpectrumRank('FEDERAÇÃO UNIÃO PROGRESSISTA', 2026) === 30
  && contexto.window.getPartySpectrumRank('FEDERAÇÃO RENOVAÇÃO SOLIDÁRIA', 2026) === 33,
  'federações de 2026: lugar da cabeça na régua, também pelo nome',
  `${fed2026[0].espectro}/${fed2026[1].espectro}`);

/* `cad` é a conta do coletor pelas regras de 2026: só vale enquanto o TSE não
   distribuiu vaga nenhuma na UF, e sai marcada como estimada. */
const comCad = agremTeste.map((a, i) => ({ ...a, cad: [2, 2, 3, 0][i] }));
ok(APU.blocos(comCad, { vv: 750 }).every((b) => b.estimadas === 0)
  && APU.blocos(comCad, { vv: 750 })[0].vagas === 3, 'com vaga do TSE, o cad é ignorado');
const semTSE = APU.blocos(comCad.map((a) => ({ ...a, vag: 0 })), { vv: 750 });
ok(semTSE.map((b) => b.vagas).join() === '2,2,3,0' && semTSE[0].estimadas === 2,
  'sem vaga do TSE, valem as do cad, marcadas como estimadas',
  semTSE.map((b) => b.vagas + '/' + b.estimadas).join());
ok(APU.somarBlocos({ sp: semTSE, rj: bl }).find((b) => b.chave === 'F:FE BRASIL').estimadas === 2,
  'a soma do país conta quantas cadeiras são estimadas');

/* 100% das seções totalizadas: as vagas do TSE ficam firmes (sólidas) antes da
   totalização final; a conta do coletor, nunca. */
const cheia = { vv: 750, ts: 10, st: 10 };
ok(APU.blocos(agremTeste, { ...cheia, st: 9 }).every((b) => b.declaradas === 0),
  'com seção por totalizar, nenhuma cadeira é firme');
ok(APU.blocos(agremTeste, cheia).every((b) => b.declaradas === b.vagas),
  'com 100% totalizado, as vagas do TSE ficam firmes');
ok(APU.blocos(comCad.map((a) => ({ ...a, vag: 0 })), cheia).every((b) => b.declaradas === 0),
  'com 100% totalizado, a conta do coletor continua projeção');
ml = APU.marcarLista(lista3(), 2, true);
ok(ml[0].dentro && ml[0].oficial && ml[2].dentro && ml[2].oficial && !ml[1].dentro,
  'com 100% totalizado, quem está nas vagas do TSE fica firme — e o sub judice segue fora');

/* Snapshot de verdade do simulado do TSE, quando houver: as vagas somam as do
   cargo e todo bloco sai com nome e cor. */
const SIMULADO_DEP = path.join(RAIZ, 'scratch', 'apuracao', 'plantao', '21272-0006-uf.json');
if (fs.existsSync(SIMULADO_DEP)) {
  const dep = JSON.parse(fs.readFileSync(SIMULADO_DEP, 'utf8'));
  const blSp = APU.blocos(dep.agrem.sp, dep.abr.sp);
  ok(blSp.reduce((s, b) => s + b.vagas, 0) === dep.abr.sp.nv,
    'simulado de SP: as vagas dos blocos somam o nv do cargo');
  ok(blSp.every((b) => b.rotulo && b.cor), 'simulado de SP: todo bloco tem nome e cor');
}

/* -------------------------------------------- cláusula de desempenho */

/* EC 97/2017, regra de 2026: 13 deputados em 9 UFs, ou 2,5% dos válidos do
   país com 1,5% em 9 UFs. Federação conta como um partido só. */
console.log('\ncláusula de desempenho');
const ufsTeste = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma'];
const entradasTeste = Object.fromEntries(ufsTeste.map((u) => [u, { vv: 1000 }]));
const bloco = (chave, vagas, votos) => ({ chave, rotulo: chave, vagas, votos });
const porUFTeste = Object.fromEntries(ufsTeste.map((u, i) => [u, [
  // A: 2 deputados em cada UF (20 em 10 UFs) e 30% dos votos — passa pelos dois
  bloco('A', 2, 300),
  // B: 13 deputados, mas só em 8 UFs, e 1% dos votos — não passa
  bloco('B', i < 8 ? (i < 5 ? 2 : 1) : 0, 10),
  // C: sem deputado, 3% do país, com 1,5% ou mais em 9 UFs — passa pelos votos
  bloco('C', 0, i < 9 ? 32 : 12),
  // D: 3% do país, mas 1,5% ou mais só em 8 UFs — não passa
  bloco('D', 0, i < 8 ? 36 : 6)
]]));
const cl = Object.fromEntries(APU.clausulaDeDesempenho(porUFTeste, entradasTeste).map((a) => [a.chave || a.bloco.chave, a]));
ok(cl.A.passa && cl.A.porCadeiras && cl.A.porVotos, 'passa pelos dois critérios');
ok(cl.B.cadeiras === 13 && cl.B.ufsCadeira === 8 && !cl.B.passa,
  '13 deputados em só 8 UFs não basta', `${cl.B.cadeiras} em ${cl.B.ufsCadeira}`);
ok(cl.C.passa && !cl.C.porCadeiras && cl.C.porVotos && cl.C.ufsVoto === 9,
  '2,5% do país com 1,5% em 9 UFs passa, mesmo sem deputado', `${cl.C.pct} / ${cl.C.ufsVoto}`);
ok(!cl.D.passa && cl.D.pct >= 2.5 && cl.D.ufsVoto === 8,
  '2,5% do país com 1,5% em só 8 UFs não passa', `${cl.D.pct} / ${cl.D.ufsVoto}`);

/* ------------------------------------------- ids que o script pede da página */

/* `$('legenda')` sobreviveu à remoção da legenda do mapa e ficou apontando para
   um id que não existe mais em apuracao-uf.html. Como a linha estava dentro do
   ramo "ainda não há boletim", só quebrava antes da primeira urna: a página do
   estado parava no subtítulo, sem mapa e sem placar, e o TypeError morria no
   catch da volta. Este check fecha a classe inteira — todo $('id') tem de
   existir na página que carrega aquele script. */

/* ------------------------------------------------ comparação com 2022 */

/* Lula 48% -> 50% e Jair 43% -> Flávio 40%: a diferença andou 5 pontos para
   Lula (negativo). Sem voto em 2026 não há variação; sem base, nada. */
console.log('\ncomparação com 2022');
const dic2026 = { s13: { numero: '13', urna: 'LULA', partido: 'PT' },
  s22: { numero: '22', urna: 'FLAVIO BOLSONARO', partido: 'PL' } };
const comp = APU.comparar({ vv: 1000, vvc: 1000, cand: { s13: 500, s22: 400, s30: 100 } },
  dic2026, [1000, 480, 430], ['13', '22']);
ok(Math.abs(comp.desvio + 5) < 1e-9 && comp.pares[0].agora === 50 && comp.pares[1].antes === 43,
  'desvio é a variação da diferença, a favor do 2º número', JSON.stringify(comp && comp.desvio));
const semVoto = APU.comparar(null, dic2026, [1000, 480, 430], ['13', '22']);
ok(semVoto.desvio === null && semVoto.pares[0].antes === 48, 'sem voto em 2026: só 2022, sem variação');
ok(APU.comparar({ vv: 1, cand: {} }, dic2026, null, ['13', '22']) === null,
  'unidade sem 2022 (instalada depois) não compara');

console.log('\ngovernadores');
const dicGov = {
  s1: { urna: 'ANA', partido: 'PT' }, s2: { urna: 'BIA', partido: 'PL' },
  r1: { urna: 'CAIO', partido: 'PSD' }, r2: { urna: 'DUDA', partido: 'PL' },
  m1: { urna: 'EVA', partido: 'PT' }, m2: { urna: 'FABIO', partido: 'NOVO' }
};
const gov = APU.governos({ cand: dicGov, abr: {
  sp: { vv: 1000, vvc: 1000, nv: 1, md: 'e', cand: { s1: 600, s2: 400 } },
  rj: { vv: 1000, vvc: 1000, nv: 1, md: 's', cand: { r1: 450, r2: 350 } },
  mg: { vv: 1000, vvc: 1000, nv: 1, cand: { m1: 520, m2: 480 } },
  zz: { vv: 10, vvc: 10, nv: 1, md: 'e', cand: { s1: 10 } }
} });
ok(gov.porUF.sp.estado === 'eleito' && gov.porUF.rj.estado === 'segundo'
  && gov.porUF.mg.estado === 'lidera' && gov.porUF.ba.estado === 'vazio',
  'eleito, 2º turno, à frente e sem voto, por UF',
  ['sp', 'rj', 'mg', 'ba'].map((u) => gov.porUF[u].estado).join(','));
ok(gov.eleitos === 1 && gov.segundo === 1 && gov.lidera === 1 && gov.vazio === 24 && !gov.porUF.zz,
  'contagem só das 27 UFs, sem o exterior');
ok(gov.porPartido.length === 1 && gov.porPartido[0].sigla === 'PT' && gov.porPartido[0].eleitos === 1
  && gov.porPartido[0].ufs.join() === 'sp', 'no placar por partido só entra eleito declarado',
  JSON.stringify(gov.porPartido));
ok(APU.governos(null).vazio === 27 && !APU.governos(null).porPartido.length, 'sem boletim: 27 vazios');

console.log('\nSenado');
const mantidos = { senadores: [
  { uf: 'sp', nome: 'Fulano', partido: 'PT', participacao: 'Titular', ate: '2031-01-31' },
  { uf: 'rj', nome: 'Sicrano', partido: 'S/Partido', participacao: 'Titular', ate: '2031-01-31' },
  { uf: 'mg', nome: 'Beltrana', partido: 'PSD', participacao: '1º Suplente', ate: '2031-01-31' }
] };
const dicSen = {
  a: { urna: 'A', partido: 'PL', situacao: 'Eleito' }, b: { urna: 'B', partido: 'PT' },
  c: { urna: 'C', partido: 'PSD' }
};
const sen = APU.senado(mantidos, { cand: dicSen, abr: {
  sp: { vv: 1000, vvc: 1000, nv: 2, snt: 0, and: 'f', cand: { a: 500, b: 300, c: 200 } }
} }, { x: { partido: 'NOVO', situacao: 'Deferido' } });
const vagas = (bs) => bs.reduce((s, b) => s + b.vagas, 0);
ok(vagas(sen.miolo) === 3 && vagas(sen.disputa) === 2 && sen.ufsComVoto === 1,
  'miolo com os mantidos, periferia com os dois primeiros de cada UF com voto');
const pt = sen.quadro.find((q) => q.rotulo === 'PT');
ok(pt && pt.cadeiras === 2 && pt.mantidas === 1 && pt.disputa === 1, 'quadro soma mantidas e em disputa',
  JSON.stringify(pt));
const pl = sen.disputa.find((b) => b.rotulo === 'PL');
const ptDisputa = sen.disputa.find((b) => b.rotulo === 'PT');
ok(pl && pl.declaradas === 1 && ptDisputa && ptDisputa.declaradas === 0,
  'só o eleito declarado pelo TSE é cadeira firme');
const semPartido = sen.miolo.find((b) => b.rotulo === 'SEM PARTIDO');
ok(!!semPartido && semPartido.espectro === 17.5, 'sem partido fica no meio do semicírculo');
ok(!sen.quadro.some((q) => q.rotulo === 'NOVO'), 'com voto, partido só de candidatura não entra no quadro');
const senVazio = APU.senado(mantidos, null, { x: { partido: 'NOVO', situacao: 'Deferido' } });
ok(senVazio.ufsComVoto === 0 && vagas(senVazio.disputa) === 0
  && senVazio.quadro.some((q) => q.rotulo === 'NOVO' && q.cadeiras === 0),
  'antes da primeira urna: periferia vazia e todo partido com candidatura no quadro');

console.log('\ncabeçalho de várias UFs e links entre páginas');
const cab = APU.cabecalhoDe({
  sp: { st: 50, ts: 100, vv: 10, and: 'p', dt: '04/10/2026', ht: '18:00:00' },
  rj: { st: 100, ts: 100, vv: 20, and: 'f', dt: '04/10/2026', ht: '19:30:00' },
  zz: { st: 0, ts: 1000, vv: 0, and: 'n', dt: '04/10/2026', ht: '20:00:00' }
});
ok(cab.st === 150 && cab.ts === 200 && cab.pst === 75 && cab.and === 'p' && cab.tf === 'n'
  && cab.ht === '19:30:00', 'soma as UFs sem o exterior, e o carimbo é o mais recente', JSON.stringify(cab));
ok(APU.cabecalhoDe({}) === null, 'sem UF não há cabeçalho');
ok(APUUI.hrefDoCargo('0003', '') === 'apuracao-governador.html?eleicao=6278'
  && APUUI.hrefDoCargo('0005', 'sp') === 'apuracao-uf.html?eleicao=6278&uf=sp&cargo=0005'
  && APUUI.hrefDoCargo('0006', 'sp') === 'apuracao-deputados.html?eleicao=6278&cargo=0006&uf=sp'
  && APUUI.hrefDoCargo('0001', '') === 'apuracao-presidente.html?eleicao=6278&cargo=0001',
  'cada cargo leva à sua página, no país ou no estado');

console.log('\nids de getElementById presentes na página');
const PARES = [
  ['js/apuracao-uf.js', 'apuracao-uf.html'],
  ['js/apuracao-nacional.js', 'apuracao-presidente.html'],
  ['js/apuracao-governador.js', 'apuracao-governador.html'],
  ['js/apuracao-senado.js', 'apuracao-senado.html'],
  ['js/apuracao-deputados.js', 'apuracao-deputados.html']
];
for (const [js, pagina] of PARES) {
  const fonte = fs.readFileSync(path.join(RAIZ, js), 'utf8');
  const html = fs.readFileSync(path.join(RAIZ, pagina), 'utf8');
  const existentes = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const pedidos = new Set([...fonte.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const faltam = [...pedidos].filter((id) => !existentes.has(id));
  ok(faltam.length === 0, `${js} não pede id que ${pagina} não tem`, faltam.join(', '));
}

console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'tudo certo'));
process.exit(falhas ? 1 : 0);
