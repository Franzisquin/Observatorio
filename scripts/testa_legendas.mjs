// Roda as funcoes REAIS de agrupamento proporcional de js/map-render.js contra os
// arquivos do acervo. Cobre o defeito das legendas historicas: em AC/2010/federal
// o voto de legenda do PTN (146) e o do PT do B (90) ficavam fora das coligacoes
// porque o numero do partido era traduzido pela sigla de hoje (PODEMOS, AVANTE).
//
//   node scripts/testa_legendas.mjs                  # casos padrao
//   node scripts/testa_legendas.mjs 2010:AC:f 2002:BA:e
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const RAIZ = process.cwd();
const semCR = (arq) => fs.readFileSync(arq, 'utf8').replace(/\r/g, '');

const sandbox = {
  console,
  STATE: { currentElectionYear: null, deputyMetadata: null, vereadorMetadata: null,
           _partyPrefixCache: null, _vereadorPartyPrefixCache: null },
  window: {}, document: { addEventListener() {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext([
  semCR('js/party-numbers.js'),
  semCR('js/utils.js').match(/^const norm = .*$/m)[0],
  semCR('js/data-loader.js').match(/function normalizePartyAlias[\s\S]*?\n}\n/)[0],
  // ate imediatamente antes de aggregateProportionalVotesByList: e o bloco de
  // resolucao de coligacao/legenda, o unico de que este teste precisa.
  semCR('js/map-render.js').split('\n').slice(0, 973).join('\n'),
].join('\n'), sandbox);

const tok = vm.runInContext('normalizeProportionalPartyToken', sandbox);
const ehCodigoReservado = vm.runInContext('isNonPartyBallotCode', sandbox);
const tabela = vm.runInContext('PARTY_NUMBER_BY_YEAR', sandbox);

// Sigla -> numero do partido, olhando todos os anos. E o que torna PTN e PODEMOS
// comparaveis: sao a mesma legenda, numero 19, so que em epocas diferentes.
const numeroDaSigla = (sigla) => {
  const alvo = tok(sigla);
  const achados = new Set();
  for (const ano of Object.keys(tabela)) {
    for (const [numero, s] of Object.entries(tabela[ano])) {
      if (tok(s) === alvo) achados.add(numero);
    }
  }
  return achados.size === 1 ? [...achados][0] : alvo;
};

// unzipit e do browser; aqui o acervo vem pelo python.
function lerAcervo(zip) {
  const py = `
import json,sys,zipfile,collections
z=zipfile.ZipFile(sys.argv[1]); n=z.namelist()
alvo=next((x for x in n if x.endswith('_resumo.json')), None)
if alvo:
    d=json.loads(z.read(alvo).decode('utf-8','replace')); tot=d.get('TOTALS') or {}
else:
    d=json.loads(z.read(n[0]).decode('utf-8','replace'))
    tot=collections.Counter()
    for m in (d.get('RESULTS') or {}).values():
        for cid,v in m.items(): tot[cid]+=int(v)
json.dump({'meta': d['METADATA']['cand_names'], 'tot': dict(tot)}, sys.stdout, ensure_ascii=False)
`;
  return JSON.parse(execFileSync('python', ['-c', py, zip], { maxBuffer: 1 << 30, encoding: 'utf8' }));
}

const casos = (process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['2010:AC:f', '2010:AM:f', '2010:AC:e', '2010:AM:e', '2002:AC:f', '2002:BA:f',
     '2014:SP:f', '2018:SP:f', '2018:RO:e', '2022:SP:f']).map((s) => s.split(':'));

let falhas = 0;
for (const [ano, uf, casa] of casos) {
  const zip = `${RAIZ}/resultados_geo/Legislativas ${ano}/deputados_${casa === 'e' ? 'estadual' : 'federal'}_${ano}_${uf}.zip`;
  if (!fs.existsSync(zip)) { console.log(`- ${ano} ${uf} ${casa}: sem arquivo`); continue; }

  const { meta, tot } = lerAcervo(zip);
  const oficial = JSON.parse(semCR(`resultados_geo/Legislativas ${ano}/official_totals_${ano}.json`))[uf][casa];

  // Mesmo estado que o app monta ao trocar de ano/cargo.
  sandbox.STATE.currentElectionYear = ano;
  sandbox.STATE.deputyMetadata = meta;
  sandbox.STATE._partyPrefixCache = null;
  const resolve = vm.runInContext('((id) => resolveProportionalGroupInfo(id, STATE.deputyMetadata, null))', sandbox);
  vm.runInContext('ensurePartyPrefixCache(false)', sandbox);

  const grupos = new Map();
  const soltas = new Map();
  for (const [cid, v] of Object.entries(tot)) {
    const votos = Number(v) || 0;
    if (votos <= 0 || ehCodigoReservado(cid)) continue;
    const gi = resolve(cid);
    const destino = gi.isGroup ? grupos : soltas;
    const chave = gi.isGroup ? gi.composition : gi.name;
    destino.set(chave, (destino.get(chave) || 0) + votos);
  }

  // Numeros que o official_totals poe DENTRO de alguma coligacao daquela UF.
  const dentroDeColigacao = new Set();
  for (const col of oficial.coalitions) {
    const partes = col.raw_comp.split('/').map(tok).filter(Boolean);
    if (partes.length > 1) partes.forEach((p) => dentroDeColigacao.add(numeroDaSigla(p)));
  }

  console.log(`\n${ano} ${uf} ${casa}  (${grupos.size} coligacoes, ${soltas.size} listas soltas)`);
  const orfas = [...soltas].filter(([sig]) => dentroDeColigacao.has(numeroDaSigla(sig)));
  if (orfas.length) {
    falhas += orfas.length;
    for (const [sig, v] of orfas) console.log(`  X  ${sig} (${v} votos) pertence a uma coligacao e saiu solto`);
  } else {
    console.log('  ok  nenhuma legenda fora da sua coligacao');
  }

  // Conferencia exata de totais so onde nao ha candidato INAPTO: official_totals
  // os exclui e este harness nao tem a lista de inaptos do app.
  if (ano === '2010' && uf === 'AC' && casa === 'f') {
    const chave = (raw) => raw.split('/').map(tok).filter(Boolean).sort().join('|');
    const soma = new Map();
    for (const [k, v] of [...grupos, ...soltas]) soma.set(chave(k), (soma.get(chave(k)) || 0) + v);
    for (const col of oficial.coalitions) {
      const obtido = soma.get(chave(col.raw_comp)) || 0;
      if (obtido === col.votes) console.log(`  ok  ${col.id} = ${obtido}`);
      else { falhas++; console.log(`  X  ${col.id}: ${obtido} vs oficial ${col.votes}`); }
    }
  }
}

console.log(falhas === 0 ? '\nTUDO OK' : `\n${falhas} divergencias`);
process.exit(falhas === 0 ? 0 : 1);
