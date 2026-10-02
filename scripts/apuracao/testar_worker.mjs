// Prova o worker/apuracao.js sem Cloudflare: R2, cache e relógio de mentira.
//   node scripts/apuracao/testar_worker.mjs
import { timingSafeEqual } from 'node:crypto';

const MANDATO = 3 * 60 * 1000;
let agora = Date.UTC(2026, 9, 4, 20, 0, 0);
Date.now = () => agora;

// Workers têm crypto.subtle.timingSafeEqual; o Node, não.
crypto.subtle.timingSafeEqual = (a, b) => timingSafeEqual(a, b);

const memoria = new Map();
globalThis.caches = {
  default: {
    match: async (req) => memoria.get(req.url)?.clone(),
    put: async (req, resp) => { memoria.set(req.url, resp); }
  }
};

const objetos = new Map();
const DADOS = {
  async head(k) { const o = objetos.get(k); return o && { customMetadata: o.meta }; },
  async get(k) {
    const o = objetos.get(k);
    return o && { body: o.corpo, uploaded: new Date(agora) };
  },
  async put(k, corpo, opcoes = {}) { objetos.set(k, { corpo, meta: opcoes.customMetadata || {} }); }
};
const env = {
  DADOS,
  CHAVE_PLANTAO: 'segredo',
  ASSETS: { fetch: async () => new Response('asset', { status: 200 }) }
};
const ctx = { waitUntil: (p) => p };

const worker = (await import('../../worker/apuracao.js')).default;
const pedir = (caminho, init = {}) =>
  worker.fetch(new Request('https://electomaps.com.br' + caminho, init), env, ctx);
const gravar = (nome, corpo, quem = 'casa', chave = 'segredo') => pedir('/dados/' + nome, {
  method: 'PUT', body: corpo,
  headers: { Authorization: 'Bearer ' + chave, 'X-Plantao': quem }
});

let falhas = 0;
function ok(cond, rotulo) {
  console.log(`  [${cond ? 'ok ' : 'ERRO'}] ${rotulo}`);
  if (!cond) falhas++;
}

ok((await pedir('/apuracao-presidente.html')).status === 200, 'fora de /dados/ vai para os assets');
ok((await pedir('/dados/indice.json')).status === 404, 'antes do plantão: 404, e a página cai no pré-urna');
ok((await gravar('indice.json', '{}', 'casa', 'errada')).status === 403, 'chave errada é recusada');
ok((await gravar('indice.json', '{"a":', 'casa')).status === 400, 'JSON quebrado é recusado');
ok(!objetos.has('_comando'), 'gravação recusada não toma o comando');
ok((await gravar('sub/segredo.json', '{}')).status === 404, 'nome fora do padrão não grava');
ok((await gravar('_comando', '{}')).status === 404, 'o registro do comando não é gravável por URL');

ok((await gravar('6257-0001-br.json', '{"v":1}')).status === 204, 'plantão "casa" grava');
const lido = await pedir('/dados/6257-0001-br.json?_=123');
ok(lido.status === 200 && (await lido.text()) === '{"v":1}', 'GET devolve o que foi gravado');
ok(lido.headers.get('Cache-Control') === 'no-store', 'navegador não guarda (a página relê a cada 20 s)');
ok(memoria.has('https://electomaps.com.br/dados/6257-0001-br.json'),
  'o cache de borda ignora o ?_= da página');

ok((await gravar('6257-0001-br.json', '{"v":2}', 'reserva')).status === 409,
  'a reserva espera enquanto a casa está no comando');
agora += MANDATO - 1000;
ok((await gravar('6257-0001-br.json', '{"v":3}', 'reserva')).status === 409,
  'a reserva ainda espera um pouco antes do prazo');
agora += 2000;
ok((await gravar('6257-0001-br.json', '{"v":4}', 'reserva')).status === 204,
  'com a casa calada além do prazo, a reserva assume sozinha');
ok((await gravar('6257-0001-br.json', '{"v":5}', 'casa')).status === 409,
  'a casa, quando volta, vira a reserva');
agora += 60 * 1000;
ok((await gravar('6257-0001-br.json', '{"v":6}', 'reserva')).status === 204,
  'quem está no comando continua gravando');

console.log(falhas ? `\n${falhas} falha(s)` : '\ntudo certo');
process.exit(falhas ? 1 : 0);
