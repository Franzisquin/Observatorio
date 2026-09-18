# Notas de segurança e capacidade

Configuração que vive fora do código — o que precisa ser feito no Cloudflare, e o
que ficou pendente no próprio repositório. Escrito na auditoria de pré-lançamento.

## 0. Estado do lançamento (17/09/2026)

**Escopo desta publicação:** `index.html` (home), `brasil.html` (portal),
`eleicoes.html` (visualizador) e `simulador.html`, mais sobre/termos/privacidade.
As três páginas de apuração e a de locais de votação **ficam fora** — excluídas
pelo `.assetsignore`, não apagadas. Para publicá-las depois, remover as linhas
correspondentes daquele arquivo.

**O site está publicado e fora do ar de propósito.** O Worker `electomaps` existe
no account com 3.886 arquivos carregados, e as quatro páginas do lançamento foram
testadas no ar. Terminado o teste, a URL `workers.dev` foi desligada: até o
domínio entrar, não há endereço público. Religar é `workers_dev: true` mais um
deploy — os arquivos já estão lá, então volta em segundos, não nos 4 minutos da
primeira vez.

**Feito:**

- Faxina: 4,01 GB -> 1,91 GB versionados; peso morto e insumo de build saíram da
  publicação (continuam em disco, fora do git).
- Hospedagem configurada: `wrangler.jsonc`, `.assetsignore`, `_headers`.
- Segurança: allowlist do `?dados=`, SRI nas quatro dependências de CDN, CSP em
  cinco páginas, entradas do workflow por `env:`.
- Zona `electomaps.com.br` criada na Cloudflare e **no ar**: `amos.ns.cloudflare.com`
  e `bingo.ns.cloudflare.com` respondem com SOA autoritativo. A zona está no
  account `electomaps`, o mesmo do Worker — conferido, e é o que faz a conexão
  do domínio ser trivial depois.
- `npx wrangler login` feito. Account `electomaps`
  (`fb3deb1186d822071fe34aabf61f6672`) fixado no `wrangler.jsonc`.
- Subdomínio `workers.dev` do account criado (`electomaps`). Ele não existia, e
  sem ele o deploy para e pergunta.
- Deploy feito. Versões: `4bc89753` (inicial, 3.859 arquivos em 4 min),
  `f8e32758` (correção do `wrangler.jsonc` exposto), `6bbff327`
  (`workers.dev` desligada).
- Teste no ar das quatro páginas: **zero 4xx/5xx e console limpo em todas**.
  `eleicoes` carregou 206 recursos, com mapa desenhado e o presidencial de 2022
  correto; `simulador` montou o cenário base com 95.096 locais de votação.
  As páginas de apuração e `locais.html` confirmadas em 404, e os quatro
  cabeçalhos do `_headers` confirmados no ar.
- Auditoria de referências: as 66 referências relativas das sete páginas do
  lançamento resolvem, e nenhuma aponta para arquivo que o `.assetsignore` tira
  do ar. `tse_demographics_locais.json`, excluído, não é referenciado por
  ninguém no código publicado.
- Página 404 com a identidade do site (`404.html`), e
  `not_found_handling: "404-page"` no `wrangler.jsonc`. Antes, quem errasse a
  URL recebia o 404 pelado da Cloudflare. As chaves de tradução dela estão em
  `js/i18n.js` (`meta.404.*` e `e404.*`), nos dois idiomas.
- `sql-wasm.wasm` passou a ser servido pelo próprio site (`js/vendor/`), o que
  fecha a lacuna de SRI e tirou o `cdnjs` do `connect-src` — ver a seção 2.

**Em andamento:** o Registro.br está com a delegação em transição. Os dois
nameservers da Cloudflare já constam no painel; o registro ainda publica
`a.auto.dns.br` / `b.auto.dns.br`, e a zona segue `pending`. Conferir com:

```
nslookup -type=ns -norecurse electomaps.com.br a.dns.br
```

Quando devolver os `ns.cloudflare.com`, propagou.

**Próximos passos:**

1. Conectar `electomaps.com.br` ao Worker quando o DNS estiver ativo.
2. Só então configurar a segurança de zona: SSL/TLS **Full (strict)**, Always Use
   HTTPS, TLS mínimo 1.2, Bot Fight Mode e Browser Integrity Check; Security
   Level no padrão **Medium**, porque mexer nele sem tráfego medido é chute.
   Antes do domínio isso não tem efeito nenhum — ver a armadilha abaixo.
3. Decidir se `workers_dev` volta a `true` ou fica desligada em definitivo.

**Armadilhas conhecidas:**

- O wrangler **não lê `.gitignore`**. Quem governa o upload é o `.assetsignore`.
  Sem ele o deploy tenta subir 5,2 GB e falha nos zips de 107 MB de
  `Resultados 1998`.
- As pastas `Resultados 1998/2000-2004/2002` e o
  `resultados_geo/emancipacoes_pre2014.fonte.json` existem **só localmente**. São
  a origem da reconstrução dos 58 municípios emancipados. Guardar cópia fora do
  repositório.
- O MCP da Cloudflare só conecta em sessão iniciada **depois** da autorização;
  `/reload-plugins` não basta, e `/mcp reconnect` pode nem estar disponível. O
  deploy não depende dele — é trabalho do wrangler.
- Há dois *accounts* sob o mesmo login da Cloudflare: usar o **`electomaps`**, não
  o pessoal. Sem `account_id` no `wrangler.jsonc`, o deploy falha com
  "More than one account available but unable to select one".
- **O `wrangler.jsonc` é servido como asset** se não estiver no `.assetsignore`.
  Conferido no ar: respondia 200, com o `account_id` legível. Corrigido. ID de
  conta não é credencial, mas configuração de deploy não tem por que ser pública
  — e a regra vale para qualquer arquivo de configuração que caia na raiz.
- O `_headers` **não** pode ir para o `.assetsignore`. A Cloudflare o lê do
  diretório de assets na hora do deploy; excluí-lo provavelmente faz os quatro
  cabeçalhos pararem de ser aplicados. Ele não aparece no ar porque é consumido,
  não porque está ignorado.
- **`.wrangler/` também não pode ir ao ar.** O `wrangler dev` cria essa pasta na
  raiz do projeto, e ela não estava em nenhum dos dois arquivos de exclusão:
  entraria no commit *e* subiria como asset. Acrescentada ao `.gitignore` e ao
  `.assetsignore` em 17/09/2026.
- O `wrangler dev` **não funciona com `directory: "./"`**: ele vigia o diretório
  de assets, escreve dentro de `.wrangler/`, que está nesse diretório, e entra
  em laço infinito de reload sem nunca servir. Para testar localmente, use um
  servidor estático que imite o roteamento (`/foo` -> `foo.html`, ausente ->
  `404.html` com status 404). Atenção: servidor local não aplica o
  `.assetsignore`, então páginas excluídas respondem 200 ali e 404 no ar.
- **O token do `npx wrangler login` não configura zona.** Ele tem `zone (read)`,
  que serve para listar zonas: `GET /zones/{id}/settings`, `/bot_management` e
  `/dns_records` respondem **403**. Refazer o login não adianta — o escopo é fixo
  na ferramenta, não depende do seu papel na conta. Configuração de zona sai pelo
  painel, por API token escopado, ou pelo MCP.
- **Regra de segurança de zona não alcança `workers.dev`.** Bot Fight Mode,
  Security Level e WAF governam o tráfego da zona `electomaps.com.br`. Um
  hostname `*.workers.dev` não pertence à zona: ligar aquilo enquanto o site só
  existe ali protege exatamente nada, e deixa a impressão contrária.

## 1. Hospedagem: Workers + Static Assets

**Decisão de 17/09/2026: o site é hospedado inteiramente na Cloudflare, em
Workers com Static Assets. Sem GitHub Pages.**

O GitHub Pages foi descartado por limite de tamanho: publica no máximo 1 GB por
site, e o repositório, mesmo depois da faxina, tem 1,90 GB. A Cloudflare
recomenda Workers em vez de Pages para projetos novos, e os números medidos
cabem no plano Free:

| | medido | limite (Free) |
|---|---|---|
| Arquivos | 4.429 | 20.000 |
| Maior arquivo | 14,8 MB | 25 MiB |
| Total | 1,90 GB | sem limite documentado |

E **requisições a asset estático são gratuitas e ilimitadas** — o que resolve a
capacidade da noite de apuração para tudo que é arquivo do site.

Configuração em `wrangler.jsonc`. O que sobe é governado por `.assetsignore`, e
não pelo `.gitignore`: **o wrangler não lê o `.gitignore`**. Sem aquele arquivo o
deploy tenta subir os 5,2 GB do diretório e falha nos zips de 107 MB de
`Resultados 1998`, que estouram o limite de 25 MiB por arquivo.

Deploy: `npx wrangler deploy`. Para publicar a cada push, ver Workers Builds.

### O problema de capacidade que permanece

Cada visitante com a aba visível consulta `raw.githubusercontent.com` a cada 20s
(`APU.cfg.intervalo`, em `js/apuracao-dados.js`), com `cache: 'no-store'` **e**
cache-buster. Isso é cache zero: toda consulta de todo visitante é hit direto na
origem.

Com 10 mil simultâneos são mais de 1.000 req/s contra um endpoint que o GitHub
não oferece para tráfego de produção e que estrangula por IP. Quem está atrás de
NAT de operadora começa a tomar 429 exatamente no pico da noite.

### Por que hospedar na Cloudflare não resolve isso sozinho

Cuidado com a armadilha: os snapshots **não são assets do site**. O navegador os
busca direto em `raw.githubusercontent.com`, tráfego que nunca passa pelo domínio
e portanto nunca toca o cache da Cloudflare. Uma Cache Rule no domínio não teria
efeito nenhum sobre eles.

A solução é uma rota de Worker que busca no GitHub e guarda em cache de borda por
~10s, colapsando N visitantes em 1 requisição de origem. Isso exige, além do
Worker, três mudanças de código:

1. `PUBLICADO`, em `js/apuracao-dados.js`, aponta para a rota nova;
2. a origem nova entra em `ORIGENS_OK`, na mesma função `baseSegura`;
3. e entra no `connect-src` do CSP das quatro páginas que carregam
   `apuracao-dados.js` (`apuracao.html`, `apuracao-presidente.html`,
   `apuracao-uf.html`, `locais.html`).

Se o fetch mantiver o cache-buster na querystring, a chave de cache precisa
ignorá-la — senão cada visitante gera uma chave distinta e o cache não serve para
nada.

### Cabeçalhos de resposta

Ficam em `_headers`, na raiz dos assets. São os quatro que não funcionam em
`<meta>` e que no GitHub Pages seriam impossíveis, porque o Pages não permite
cabeçalho próprio:

```
Strict-Transport-Security, Referrer-Policy, X-Content-Type-Options,
Content-Security-Policy: frame-ancestors 'none'
```

O `frame-ancestors` é o que impede clickjacking. O CSP completo continua na
`<meta>` de cada página, porque varia entre elas.

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

### Hospedar o `sql-wasm.wasm` — feito em 17/09/2026

O SRI cobre o `sql-wasm.js`, mas não o `.wasm` que ele busca em runtime. O par
da versão 1.10.3 passou a ser servido do próprio site, em
`js/vendor/sql-wasm.wasm`, e o `locateFile` de `js/data-zip.js` aponta para lá.
Com isso o `cdnjs` saiu do `connect-src` do `eleicoes.html` — ele permanece em
`script-src`, porque o `sql-wasm.js` e o `d3` continuam vindo de lá com SRI.

Verificado em servidor local pelo caminho real da interface (municipal, AC,
2020, Rio Branco): o `.wasm` é buscado em `/js/vendor/`, responde 200 e o sql.js
instancia. Ao trocar de versão do sql.js, **baixe o `.wasm` junto** — o par tem
de casar, ou o banco municipal para de abrir.

### CSP falta em cinco páginas do lançamento

Só `eleicoes.html` e `simulador.html` têm CSP em `<meta>`. A `index.html`, a
`brasil.html`, a `sobre.html`, a `termos.html` e a `privacidade.html` não têm —
as cinco com CSP citadas na seção 0 são as de apuração, que saíram do ar. Essas
páginas são de conteúdo estático, e o `_headers` já lhes dá `frame-ancestors`,
HSTS e `nosniff`; ainda assim, um `default-src 'self'` nelas é barato e fecha o
vão. Exige teste próprio: a `index` e a `brasil` carregam fontes do Google e
têm estilo inline.

### 404 previsível no municipal de 2020

O `data-municipal.js` pede `prefeito_2020_sup_t1_<UF>.zip` para toda UF, mas o
arquivo só existe nas 21 que tiveram eleição suplementar. Nas outras o
visitante toma um 404 no console e uma requisição é desperdiçada. A página se
recupera e renderiza normalmente — é ruído, não falha. Conferido no AC em
17/09/2026. Consultar a lista de UFs que têm o arquivo antes de pedir resolve.
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

### Precedente: como o redistricter.com resolve isso

Vale registrar, porque é o experimento que naturalmente se cogita. O
redistricter.com separa os dados num domínio próprio (`data.redistricter.com`,
S3 atrás de CloudFront) e tem autenticação completa via Clerk. Ainda assim, em
teste direto de 16/09/2026:

```
$ curl -I https://data.redistricter.com/OK/v1-2OKBlockGroups.geojson.gz
HTTP/1.1 200 OK
Content-Length: 4881698
```

Sem token, sem referer, sem cookie. Texas idem, 26,4 MB. CORS está configurado
(`Vary: Origin`, sem `Access-Control-Allow-Origin` para origem estranha), o que
impede JS de outro site no navegador e **não impede** `curl` — CORS é mecanismo
de navegador, não de protocolo.

Duas lições: separar os dados em outro domínio não protege nada por si só, e
autenticar a interface não protege o dado se a URL do dado for anônima. O que a
separação compra é controle operacional — cache, rate limit e regras de CDN
próprias —, que é motivo suficiente, mas é outro motivo.

### Metadado de derivação: auditar o que é servido

A curadoria vaza principalmente por campo que a interface não lê. Caso concreto:
`emancipacoes_pre2014.json` publicava `secoes` (796 seções atribuídas),
`n_secoes_ambiguas` (36 juízos editoriais), `identidade_ano` e `revisar`. O
cliente lê apenas `cd_ibge`, `nome`, `por_pai` e `resultados` — conferido em
`js/emancipacoes-pre2014.js`. A derivação saiu do ar por
`scripts/preparar_emancipacoes_publico.py`.

Além de entregar a pesquisa de graça, publicar a derivação enfraquecia a prova
de autoria: com o método público, quem copiasse poderia alegar que chegou aos
mesmos números sozinho.

Ao acrescentar artefato novo ao site, vale a pergunta: *a interface lê este
campo?* Candidatos típicos a ficar de fora — contadores de ambiguidade, flags de
revisão, ano de identidade, notas de proveniência, escores de confiança.

Estratégia viável:

1. **Cloudflare** (seção 1) — resolve capacidade e eleva o custo do raspador.
2. **Licença e termos** sobre a compilação e os derivados, exigindo atribuição.
   Feito: a seção 4 da LICENSE reivindica a base de dados pelo art. 7º, XIII e
   art. 87 da Lei 9.610/98, nomeando os artefatos curados. O `termos.html` já
   vedava coleta automatizada e não precisou mudar.
3. **Marca d'água nos dados derivados** para *provar* a cópia, já que impedir não
   é possível: ordenação, precisão decimal insignificante nas estimativas.
   **Nunca nos números de votação.** O cabeçalho de `js/apuracao-dados.js` já
   registra que alterar voto, percentual ou seções esbarra no art. 267 §4 da
   Res. 23.751/2026. Marca d'água em resultado apurado seria falsificação, não
   proteção.
4. **Ser a fonte canônica** — ao vivo, primeiro, com URL própria. Um scrape vira
   foto velha em minutos.
