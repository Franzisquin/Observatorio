/* Dados da apuração ao vivo, servidos pelo próprio electomaps.com.br.

   O plantão (scripts/apuracao/plantao.py) baixa do TSE e grava aqui cada
   snapshot que mudou: PUT /dados/<arquivo>.json com a chave CHAVE_PLANTAO. O R2
   guarda, e as páginas leem por GET no mesmo caminho. Nada passa pelo GitHub.

   Só /dados/* chega a este código (run_worker_first no wrangler.jsonc); o resto
   do site continua servido como asset estático, sem custo por requisição.

   Leitura com cache de borda curto: mil visitantes pedindo o mesmo arquivo no
   mesmo minuto viram uma leitura no R2 a cada BORDA segundos por cidade da
   Cloudflare. A página põe ?_=<hora> para furar o cache do navegador; a chave
   do cache aqui é só o caminho, senão cada visitante seria uma chave nova.

   Dois plantões podem rodar ao mesmo tempo, em máquinas diferentes: só o que
   está no comando grava. Se ele ficar MANDATO sem gravar (luz, internet), o
   próximo PUT do outro assume o comando sozinho. */

const BORDA = 10;                          // segundos de cache na borda
const MANDATO = 3 * 60 * 1000;             // silêncio que passa o comando adiante
const TETO = 25 * 1024 * 1024;             // nenhum snapshot chega perto disso
const NOME = /^[a-z0-9][a-z0-9_.-]{0,100}\.json$/;
const COMANDO = '_comando';                // fora de NOME: ninguém lê nem grava por URL

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/dados/')) return env.ASSETS.fetch(req);
    const nome = url.pathname.slice('/dados/'.length);
    if (!NOME.test(nome)) return texto(404, 'não encontrado');
    if (req.method === 'GET' || req.method === 'HEAD') return ler(req, env, ctx, url, nome);
    if (req.method === 'PUT') return gravar(req, env, nome);
    return texto(405, 'método não permitido', { Allow: 'GET, HEAD, PUT' });
  }
};

async function ler(req, env, ctx, url, nome) {
  const chave = new Request(url.origin + url.pathname);
  let resp = await caches.default.match(chave);
  if (!resp) {
    const obj = await env.DADOS.get(nome);
    // Antes do plantão gravar, a página recebe 404 e mostra as listas pré-urna.
    if (!obj) return texto(404, 'ainda não publicado', { 'Cache-Control': 'no-store' });
    resp = new Response(obj.body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${BORDA}`,
        'Last-Modified': obj.uploaded.toUTCString()
      }
    });
    ctx.waitUntil(caches.default.put(chave, resp.clone()));
  }
  const final = new Response(req.method === 'HEAD' ? null : resp.body, resp);
  final.headers.set('Cache-Control', 'no-store');
  final.headers.set('X-Content-Type-Options', 'nosniff');
  return final;
}

async function gravar(req, env, nome) {
  if (!autorizado(req, env)) return texto(403, 'chave inválida');
  const quem = (req.headers.get('X-Plantao') || 'sem-nome').slice(0, 60);
  const agora = Date.now();
  const atual = await env.DADOS.head(COMANDO);
  const dono = atual?.customMetadata?.quem;
  const ate = Number(atual?.customMetadata?.ate || 0);
  if (dono && dono !== quem && ate > agora) return texto(409, `no comando: ${dono}`);

  const corpo = await req.arrayBuffer();
  if (corpo.byteLength > TETO) return texto(413, 'arquivo grande demais');
  // JSON quebrado na tela é pior que JSON velho: recusa e o anterior fica.
  try {
    JSON.parse(new TextDecoder().decode(corpo));
  } catch {
    return texto(400, 'JSON inválido');
  }

  if (dono !== quem || ate - agora < MANDATO / 2) {
    await env.DADOS.put(COMANDO, '', { customMetadata: { quem, ate: String(agora + MANDATO) } });
  }
  await env.DADOS.put(nome, corpo, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  return new Response(null, { status: 204 });
}

function autorizado(req, env) {
  if (!env.CHAVE_PLANTAO) return false;
  const veio = new TextEncoder().encode(req.headers.get('Authorization') || '');
  const certo = new TextEncoder().encode(`Bearer ${env.CHAVE_PLANTAO}`);
  return veio.byteLength === certo.byteLength && crypto.subtle.timingSafeEqual(veio, certo);
}

function texto(status, corpo, extra = {}) {
  return new Response(corpo, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
  });
}
