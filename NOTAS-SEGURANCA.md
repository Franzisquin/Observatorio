# Notas de segurança e capacidade

Configuração que vive fora do código — o que precisa ser feito no Cloudflare, e o
que ficou pendente no próprio repositório. Escrito na auditoria de pré-lançamento.

## 1. Cloudflare na frente (pendente — é configuração de conta)

Duas razões, e a primeira é de capacidade, não de segurança.

### O problema de capacidade

Cada visitante com a aba visível consulta `raw.githubusercontent.com` a cada 20s
(`APU.cfg.intervalo`, em `js/apuracao-dados.js`), com `cache: 'no-store'` **e**
cache-buster. Isso é cache zero: toda consulta de todo visitante é hit direto na
origem.

Com 10 mil simultâneos são mais de 1.000 req/s contra um endpoint que o GitHub
não oferece para tráfego de produção e que estrangula por IP. Quem está atrás de
NAT de operadora começa a tomar 429 exatamente no pico da noite.

### Regra de cache

Ponha o domínio no Cloudflare e crie uma Cache Rule para os snapshots:

| Campo | Valor |
|---|---|
| Quando | `http.host eq "<seu-dominio>"` e `http.request.uri.path` começa com o caminho dos snapshots |
| Cache eligibility | Eligible for cache |
| Edge TTL | 10 segundos |
| Browser TTL | Respect origin (ou 0) |

Dez segundos de TTL de borda colapsam N visitantes em 1 hit de origem, sem que a
tela fique mais velha que a cadência de 20s que ela já pratica. Se o fetch mantiver
o cache-buster na querystring, configure **Cache Key** para ignorar a query — senão
cada visitante gera uma chave distinta e o cache não serve para nada.

### Cabeçalhos que só o Cloudflare pode dar

O GitHub Pages não deixa definir cabeçalho HTTP. Estes não funcionam em `<meta>` e
precisam vir de uma Transform Rule (Modify Response Header):

```
Content-Security-Policy: frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
```

O `frame-ancestors` é o que impede clickjacking — a diretiva é ignorada quando vem
por `<meta>`, então hoje ela não existe em lugar nenhum.

### Bot Fight Mode

Ligar eleva o custo do raspador preguiçoso. Não impede a cópia dos dados, e não é
para isso que serve — ver a seção 4.

## 2. Pendências no código

### Remover `'unsafe-inline'` do `script-src`

O CSP das páginas de apuração está apertado, menos por um ponto: `script-src`
ainda precisa de `'unsafe-inline'` por causa do handler inline que o placar gera
via `innerHTML` em `js/apuracao-ui.js` (o `onerror=` do `<img class="apu-face">`).

Trocar aquele handler por `addEventListener` depois de inserir o nó permite tirar
o `'unsafe-inline'` e transformar o CSP numa defesa real contra XSS, em vez de só
uma trava de origem de dados.

### Hospedar o `sql-wasm.wasm`

O SRI cobre o `sql-wasm.js`, mas não o `.wasm` que ele busca em runtime pelo
`locateFile` em `js/data-zip.js:162`. Baixar o par e servir do próprio site fecha
a lacuna e ainda tira `cdnjs` do `connect-src`.

### Recalcular hashes de SRI ao trocar versão

```bash
curl -sSL <url> | openssl dgst -sha384 -binary | openssl base64 -A
```

O `d3` está fixado em `7.9.0` no cdnjs. A URL antiga (`d3js.org/d3.v7.min.js`)
acompanha a última 7.x — com SRI ela quebraria sozinha no próximo release.

## 3. Onde as travas de origem de dados vivem

O parâmetro `?dados=` aceita apenas a origem publicada e caminhos relativos
(`baseSegura`, em `js/apuracao-dados.js`). Sem isso, um link com
`?dados=https://terceiro/` fazia a página renderizar números de outra pessoa com
a marca, o layout e o domínio do site — resultado forjado publicado como se fosse
nosso.

O `connect-src` do CSP é a segunda trava, no navegador: mesmo que o allowlist seja
contornado, o fetch para fora das origens declaradas não sai.

Ao mudar onde os snapshots são publicados, os dois lugares precisam ser atualizados
juntos, ou a apuração fica sem dados.

## 4. Sobre impedir cópia dos dados

Não é alcançável por meio técnico, e o esforço nessa direção sai caro. Tudo que o
navegador desenha, o visitante tem. O site é estático: um `wget -r` baixa tudo.
Ofuscar, bloquear botão direito ou desenhar número em canvas custa horas ao
copista e quebra acessibilidade e SEO — preço alto por nada, ainda mais num site
de transparência eleitoral.

Além disso, resultado eleitoral do TSE é dado público (LAI, Lei 12.527/2011), e
número de voto é fato — a Lei 9.610/98 não protege fato. O que é nosso e
protegível: a compilação e organização da base (art. 7º, XIII), o código, os
mapas, o design e os cálculos derivados (swing, ISE, estimativas EI).

Estratégia viável:

1. **Cloudflare** (seção 1) — resolve capacidade e eleva o custo do raspador.
2. **Licença e termos** sobre a compilação e os derivados, exigindo atribuição.
3. **Marca d'água nos dados derivados** para *provar* a cópia, já que impedir não
   é possível: ordenação, precisão decimal insignificante nas estimativas.
   **Nunca nos números de votação.** O cabeçalho de `js/apuracao-dados.js` já
   registra que alterar voto, percentual ou seções esbarra no art. 267 §4 da
   Res. 23.751/2026. Marca d'água em resultado apurado seria falsificação, não
   proteção.
4. **Ser a fonte canônica** — ao vivo, primeiro, com URL própria. Um scrape vira
   foto velha em minutos.
