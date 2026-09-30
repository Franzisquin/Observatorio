/* Testa a "última cadeira" do portal de Portugal (portugal/js/pt/ultima-cadeira-pt.js)
 * contra os resultados reais de todas as legislativas (1975-2025) e europeias.
 *
 * Carrega globals.js, utils.js e o módulo num contexto Node com `document`
 * stubado, na ordem das tags <script> do eleicoes_pt.html. O que protege:
 *   - o d'Hondt refeito reproduz os mandatos oficiais em todos os círculos,
 *     menos Fora da Europa em 2005 (os votos provisórios não dão os mandatos);
 *     os Açores de 1975 e 1976 entram como os três círculos da época, e cada
 *     um tem de dar os eleitos do mapa oficial do Diário da República;
 *   - "faltam" é exato: somar esses votos ao partido dá-lhe mais um deputado e
 *     um voto a menos não dá, refazendo o d'Hondt em cada partido de cada círculo;
 *   - os números que motivaram a funcionalidade (Porto e Setúbal em 1999);
 *   - o HTML do painel sai nos casos normais e nos sem análise.
 *
 *     node scripts/testar_ultima_cadeira_pt.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PT = path.join(RAIZ, 'portugal');
const RES = path.join(PT, 'dados', 'resultados');

let falhas = 0;
function ok(cond, nome, detalhe = '') {
  console.log(`${cond ? '  ok   ' : '  FALHA'} ${nome}${detalhe ? '  — ' + detalhe : ''}`);
  if (!cond) falhas++;
}

const ctx = vm.createContext({ console, document: { addEventListener() { } } });
ctx.window = ctx;
for (const f of ['js/globals.js', 'js/utils.js', 'js/pt/ultima-cadeira-pt.js']) {
  vm.runInContext(readFileSync(path.join(PT, f), 'utf-8'), ctx, { filename: f });
}
const { ucQuocientes, ucLugares: lugares, ucAnalisar, ucNacional, ucAcoresTresCirculos, ucAcoresAntigos,
  buildUltimaCadeiraHtml } = ctx;
const ler = (tag) => JSON.parse(readFileSync(path.join(RES, `${tag}.json`), 'utf-8'));

console.log('Casos pequenos');
{
  const a = ucAnalisar({ A: 12000, B: 7500, C: 4500 }, 4, { A: 2, B: 1, C: 1 });
  ok(a?.ultimo.party === 'C' && a.ultimo.divisor === 1, 'exemplo do modal: C leva o 4.º e último mandato');
  ok(a?.ordem[4].party === 'A' && a.ordem[4].divisor === 3, 'exemplo do modal: A ÷3 é o primeiro de fora');
  ok(a?.desafiante.faltam === 1501, 'exemplo do modal: faltavam 1.501 votos para tirar a última cadeira',
    `obtido ${a?.desafiante.faltam}`);
  ok(ucAnalisar({ A: 12000, B: 7500, C: 4500 }, 4, { A: 3, B: 1 }) === null,
    'mandatos que o d\'Hondt não reproduz: sem análise');
  const empate = (v) => JSON.stringify(Object.entries(lugares(v, 2)).sort());
  ok(empate({ Y: 12000, X: 6000 }) === '[["X",1],["Y",1]]' && empate({ X: 6000, Y: 12000 }) === '[["X",1],["Y",1]]',
    'empate de quocientes: leva a lista menos votada, qualquer que seja a ordem');
}

console.log('Todos os círculos (AR 1975-2025 e europeias)');
{
  const esperados = new Set(['ar_2005:E2']);
  const semAnalise = [];
  const errados = [];
  let circulos = 0;
  let conferidos = 0;
  for (const f of readdirSync(RES).filter((f) => /^(ar|ee)_\d{4}\.json$/.test(f)).sort()) {
    const tag = f.slice(0, -5);
    const ano = tag.slice(3);
    const j = ler(tag);
    const lista = tag.startsWith('ar')
      ? Object.entries(j.AGG.distrito)
      : [['PT', j.METADATA.global || j.METADATA.national]];
    for (const [key, d] of lista) {
      if (!d?.mandatos) continue;
      const casos = tag.startsWith('ar') && ucAcoresTresCirculos(ano, key)
        ? ucAcoresAntigos(ano, j.RESULTS).map((c) => [`${key}/${c.sub}`, c.a])
        : [[key, ucAnalisar(d.votes, d.mandatos, d.mandatos_p)]];
      for (const [nome, a] of casos) {
        circulos++;
        if (!a) {
          semAnalise.push(`${tag}:${nome}`);
          continue;
        }
        const votos = Object.fromEntries(a.partidos.map((p) => [p.party, p.votes]));
        for (const p of a.partidos) {
          if (p.faltam === null) continue;
          conferidos++;
          const com = lugares({ ...votos, [p.party]: p.votes + p.faltam }, a.n)[p.party] || 0;
          const votosSem = { ...votos, [p.party]: p.votes + p.faltam - 1 };
          const sem = lugares(votosSem, a.n)[p.party] || 0;
          // empate perfeito na linha de corte (mesmo quociente e mesmos votos): a lei
          // não decide, e o módulo pede um voto a mais em vez de contar com a sorte
          const q = ucQuocientes(votosSem, a.n);
          const sorte = q[a.n]?.valor === q[a.n - 1].valor && q[a.n].votes === q[a.n - 1].votes;
          if (com !== p.seats + 1 || (sem !== p.seats && !sorte)) {
            errados.push(`${tag} ${nome} ${p.party}: faltam ${p.faltam}, com ${com}, sem ${sem}, tem ${p.seats}`);
          }
        }
      }
    }
  }
  // A magnitude dos círculos é o n do d'Hondt. A planilha do SGMAI de 1976 traz 10
  // mandatos para os Açores (eram 6, como os mandatos por partido); o JSON foi
  // corrigido à mão, e um ETL novo traria o 10 de volta.
  const somas = readdirSync(RES).filter((f) => /^ar_\d{4}\.json$/.test(f)).map((f) => {
    const j = ler(f.slice(0, -5));
    const soma = Object.values(j.AGG.distrito).reduce((t, d) => t + (d.mandatos || 0), 0);
    return [f, soma, (j.METADATA.global || j.METADATA.national).mandatos];
  }).filter(([, soma, total]) => soma !== total);
  ok(somas.length === 0, 'AR: a soma dos mandatos dos círculos dá o total do país em todos os anos',
    somas.map(([f, s, t]) => `${f}: ${s} ≠ ${t}`).join(', '));
  const inesperados = semAnalise.filter((k) => !esperados.has(k));
  ok(inesperados.length === 0 && semAnalise.length === esperados.size,
    `${circulos - semAnalise.length} de ${circulos} círculos reproduzem os mandatos oficiais`,
    `sem análise: ${semAnalise.join(', ')}`);
  ok(errados.length === 0, `"faltam" exato em ${conferidos} partidos-círculo`, errados.slice(0, 5).join(' | '));
}

console.log('Os números de 1999');
{
  const j = ler('ar_1999');
  const d = j.AGG.distrito['13'];
  const a = ucAnalisar(d.votes, d.mandatos, d.mandatos_p);
  const faltam = (p) => a.partidos.find((x) => x.party === p)?.faltam;
  ok(a.ultimo.party === 'CDS-PP' && a.ultimo.divisor === 3, 'Porto: o 37.º mandato é o 3.º do CDS-PP');
  ok(a.desafiante.party === 'B.E.' && a.desafiante.faltam === 1645, 'Porto: o B.E. ficou a 1.645 votos dele (empate com o CDS-PP, que é mais votado)',
    `obtido ${a.desafiante.party} ${a.desafiante.faltam}`);
  ok(faltam('PS') === 20419, 'Porto: ao PS faltavam 20.419 votos para o 20.º deputado', `obtido ${faltam('PS')}`);
  const { porPartido } = ucNacional(j.AGG.distrito, '1999');
  ok(porPartido.PS?.key === '15' && porPartido.PS.faltam === 3877,
    'o 116.º deputado do PS esteve mais perto em Setúbal, a 3.877 votos', JSON.stringify(porPartido.PS));
}

console.log('HTML do painel');
{
  const painel = (elType, ano, scope, scopeData, data = null) => {
    ctx.__cfg = { elType, ano, scope, data };
    vm.runInContext(`selectedLocationIDs.clear();
      Object.assign(STATE, { currentElectionType: __cfg.elType, currentYear: __cfg.ano, scope: __cfg.scope,
        data: __cfg.data, currentNuts: '', selectedCountry: null });`, ctx);
    return buildUltimaCadeiraHtml(scopeData);
  };
  const circ = (tag, key) => {
    const d = ler(tag).AGG.distrito[key];
    return painel('ar', tag.slice(3), { level: 'distrito', key }, { votes: d.votes, official: d });
  };
  const porto = circ('ar_1999', '13');
  ok(['O 37.º e último mandato', 'linha de corte', '+1.645', 'Ver os 37 mandatos'].every((s) => porto.includes(s)),
    'Porto 1999: último mandato, linha de corte e votos em falta');
  const j99 = ler('ar_1999');
  const nac = painel('ar', '1999', { level: 'national', key: null },
    { votes: j99.METADATA.national.votes, official: j99.METADATA.national }, j99);
  ok(nac.includes('<h3>Última cadeira</h3>') && porto.includes('<h3>Última cadeira</h3>'),
    'Portugal e círculo: a secção sai com o cabeçalho e o botão do método');
  ok(nac.includes('Os círculos mais disputados') && nac.includes('data-uc-circulo="15"') && nac.includes('+3.877'),
    'Portugal 1999: círculos mais disputados e PS a 3.877 votos em Setúbal');
  const j76 = ler('ar_1976');
  const acores = painel('ar', '1976', { level: 'distrito', key: '40' },
    { votes: j76.AGG.distrito['40'].votes, official: j76.AGG.distrito['40'] }, j76);
  ok(['data-uc-sub="Angra do Heroísmo"', 'data-uc-sub="Horta"', 'data-uc-sub="Ponta Delgada"',
    'O 2.º e último mandato', 'O 1.º e último mandato', 'O 3.º e último mandato'].every((s) => acores.includes(s)),
  'Açores 1976: um chip e uma análise para cada um dos três círculos');
  const angra = ucAcoresAntigos('1976', j76.RESULTS)[0].a;
  ok(angra.ultimo.party === 'PS' && angra.desafiante.party === 'PPD' && angra.desafiante.faltam === 3629,
    'Angra do Heroísmo 1976: o PS levou o 2.º mandato e ao PPD faltaram 3.629 votos',
    `${angra.ultimo.party} / ${angra.desafiante.party} ${angra.desafiante.faltam}`);
  const j75 = ler('ar_1975');
  const nac75 = painel('ar', '1975', { level: 'national', key: null },
    { votes: j75.METADATA.national.votes, official: j75.METADATA.national }, j75);
  ok(nac75.includes('data-uc-ir="Ponta Delgada"') && !nac75.includes('Sem análise'),
    'Portugal 1975: os três círculos dos Açores entram nas listas, e nenhum círculo fica de fora');
  ok(circ('ar_2005', 'E2').includes('não dá os mandatos oficiais'), 'Fora da Europa 2005: sem análise, com o motivo');
  const ee = ler('ee_2024').METADATA.global;
  ok(painel('ee', '2024', { level: 'national', key: null }, { votes: ee.votes, official: ee }).includes('O 21.º e último mandato'),
    'europeias 2024: o país é o círculo');
  ok(painel('pr', '2021', { level: 'national', key: null }, { votes: {}, official: null }) === '',
    'presidenciais: sem secção');
}

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo ok');
process.exit(falhas ? 1 : 0);
