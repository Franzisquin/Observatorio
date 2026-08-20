# Pipeline do Simulador 2026

Gera `resultados_geo/sim2026/` (presidencial) e `resultados_geo/simgov2026/`
(governador), que é tudo o que `simulador.html` consome.

## Ordem de execução

```bash
# 1. Baixa o perfil do eleitorado 2026 do CDN do TSE (~2,5 GB, resumível).
#    Vai para scratch/eleitorado/2026/, fora do git.
python scripts/baixar_perfil_eleitorado_2026.py --paralelo 6

#    Antes de mexer no parser, confira o layout real do CSV:
python scripts/baixar_perfil_eleitorado_2026.py --probe

# 2. Agrega o cruzamento por seção para local de votação (parquet intermediário).
python scripts/gerar_eleitorado_2026.py

# 3. Casa 2022 <-> 2026, imputa os locais novos e escreve os pacotes binários.
python scripts/gerar_base_2026.py

# 4. Regressão ecológica: como cada grupo votou em 2022, por escopo.
python scripts/gerar_ei_baselines_2026.py

# 5. Modo governador: sidecar por UF com a eleição estadual de 2022.
#    Só depende do que já está no repo — roda em qualquer checkout limpo.
python scripts/gerar_base_governador_2022.py --conferir   # relatório, sem escrever
python scripts/gerar_base_governador_2022.py

# 6. Validação (sem browser).
node scripts/testar_sim_ei_worker.mjs          # motor: NNLS, IPF, conservação, determinismo
node scripts/testar_logica_simulador.mjs       # lógica eleitoral: migração, apuração, 2º turno
node scripts/testar_sim_gov_worker.mjs         # motor no modo governador, fidelidade a 2022
node scripts/testar_integracao_governador.mjs  # ponta a ponta: front + worker + pacotes
```

Todos os scripts aceitam `--uf AC SC RJ` para rodar em um subconjunto, e são
idempotentes: reexecutar uma UF só reescreve os arquivos dela. O `manifest.json`
preserva as UFs que não foram reprocessadas.

## O que cada artefato é

| Arquivo | Conteúdo |
|---|---|
| `sim2026/index.json` | Esquema das dimensões, layout do registro binário, contagem de locais por UF |
| `sim2026/locais_<UF>.bin` | Um registro por local: identificação, eleitores aptos 2026, composição demográfica quantizada em `u8` |
| `sim2026/locais_<UF>.geojson` | Ponto + rótulos de cada local, para o mapa |
| `sim2026/manifest.json` | Casados vs imputados por UF — o relatório de qualidade do casamento |
| `sim2026/baselines/nacional.json` | Participação de cada grupo no eleitorado + voto estimado de 2022 por grupo |
| `sim2026/baselines/uf/<UF>.json` | Idem, por estado |
| `sim2026/baselines/muni/<UF>.json` | Só a composição, por município (o `support` é herdado da UF) |
| `sim2026/baselines/qualidade.json` | MAE do ajuste e ganho sobre o modelo trivial, por dimensão |
| `sim2026/baselines/regioes.json` | Resultado real do 1º turno de 2022 por macrorregião e por RGINT — é o que o painel de pesos regionais carrega automaticamente |
| `simgov2026/index.json` | Origens de 2022 de cada UF (candidatos, partidos, %), contagem de locais, info de 2º turno |
| `simgov2026/gov_<UF>.bin` | Composição do voto para governador em 2022, um registro por local, **alinhado linha a linha** com `sim2026/locais_<UF>.bin` |
| `simgov2026/regioes_<UF>.json` | Resultado real de 2022 para o governo do estado por UF, RGINT e RGI — o que o painel de pesos do modo governador carrega |

O registro binário tem 62 bytes: cabeçalho de 18 (`cd_municipio u32`,
`cod_ibge u32`, `nr_zona u16`, `nr_locvot u16`, `aptos u32`, `flags u8`, pad),
seguido de 42 frações `u8` e de 2 colunas `u8` de reduto (a partir de
`redutosOffset`). `flags & 1` marca um local imputado.

O registro do sidecar de governador tem `9 + K` bytes, com `K` = número de
origens daquela UF (2 a 6 candidatos + `outros` + `nulo_branco` + `abstencao`):
cabeçalho de 9 (`cd_municipio u32`, `nr_zona u16`, `nr_locvot u16`, `flags u8`)
seguido de `K` frações `u8`. A chave natural é repetida de propósito — ver
"Decisões que valem lembrar".

## Como a simulação é construída

A ordem importa e está codificada tanto no worker quanto na interface:

1. **Migração de 2022** (obrigatória) — a matriz leva cada comportamento do 1º
   turno (Lula, Bolsonaro, outros, nulo/branco, abstenção) para os candidatos de
   2026. É o que gera a superfície inicial de votos.
2. **Redutos pessoais** — Zema e Caiado têm sua votação redistribuída *dentro*
   do estado seguindo o mapa de onde foram bem para governador em 2022. O total
   no estado não muda; muda de onde vem.
3. **Pesos por macrorregião** (obrigatória) — metas agregadas, já pré-carregadas
   com o resultado real de 2022 de cada região.
4. **Regiões intermediárias**, ajustes por UF/município e **edições
   demográficas** — refinamentos, só liberados depois que a projeção base
   existe. Um ajuste mais específico sempre vence o mais geral.

Sem os passos 1 e 3 não há simulação: a interface não gera projeção nenhuma
antes de os dois estarem configurados.

**Candidatos somam 100% entre si; abstenção e nulos são independentes.** Os
alvos de abstenção e nulo/branco são percentuais do eleitorado apto e definem
quanto do eleitorado chega a ser distribuído. Eles são aplicados por *escala
multiplicativa*, nunca por atribuição direta — é isso que preserva a nuance
municipal (um município que abstém 30% num estado de 20% continua acima da
média depois do ajuste, em vez de todos virarem 20%).

**A posição ideológica vem só do partido** (`POS_PARTIDO` em `simulador.js`).
Não há controle manual: trocar o partido do candidato é o que o reposiciona.
Entre os partidos em disputa a ordem é PT < PSD < NOVO < MISSÃO < PL.

## Decisões que valem lembrar

**A chave de casamento 2022↔2026 é `(CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO)`.**
O `local_id` inteiro dos GeoJSON do repo é sintético e não existe nos dados do
TSE. O par `NR_ZONA + NR_LOCAL_VOTACAO` sozinho colide em ~19% dos locais, por
isso o município entra na chave.

**Não usamos `CD_RACA_COR` do TSE.** Em 2026 ela está ~71% "NÃO INFORMADO" —
só é coletada em realistamentos recentes, o que enviesa a subamostra para
eleitores jovens. A raça vem do Censo, já agregada por local nos GeoJSON de
`locais_votacao_2022`, com cobertura completa.

**A migração usa o PRIMEIRO turno de 2022, não o segundo.** O 1º turno tem a
categoria "outros" (Ciro, Tebet e demais), que é justamente o eleitorado mais
disputado em 2026; no 2º turno ele já está diluído em Lula/Bolsonaro e a
informação se perde. É também o 1º turno que alimenta o preenchimento
automático dos pesos regionais.

**Redutos são uma lista curada** (`REDUTOS` em `schema_sim2026.py`): governadores
de 2022 que disputam 2026. Para acrescentar alguém basta uma linha ali e
reprocessar `gerar_base_2026.py`. Guardamos a votação de 1º turno do político
para governador como fração dos aptos de cada local.

**A regressão ecológica é regularizada (ridge, α = 0,15).** Sem encolhimento
para a média do escopo ela devolve soluções de canto 0%/100% — a composição dos
locais é fortemente colinear, o sistema é mal condicionado e o NNLS empurra os
coeficientes não identificados para a fronteira. Isso produz números absurdos
("100% dos analfabetos votaram Lula") que são ruído, não achado. O mesmo α é
usado offline aqui e ao vivo em `js/sim_ei_worker.js` — se mudar num lado, mude
no outro.

**Os nomes dos candidatos nos GeoJSON de 2022 estão em UTF-8 correto.** Se o
terminal mostrar `"JAIR BOLSONARO (PL) (N?O ELEITO) 2T"`, o problema é o console
do Windows (cp1252), não o dado — conferido byte a byte nos 27 arquivos de
governador: zero ocorrências de U+FFFD. `achar_chave()` casa por prefixo e
sufixo porque é robusto a variações de grafia, não por causa de encoding;
`schema_simgov2022.COLUNA` extrai nome, partido e situação por regex, e cobre as
242 colunas de candidato dos 27 estados sem nenhuma falha.

**O invariante do motor é o eleitorado apto de 2026**, não o total de votos.
Abstenção e nulo/branco são colunas do vetor como qualquer candidato — é isso
que permite editar comparecimento por grupo demográfico.

## Modo governador

A eleição para governador são 27 disputas independentes com candidatos
diferentes, o que não cabe na dimensão `voto2022` — ela é global e fixa. Daí o
**sidecar por UF**: `simgov2026/gov_<UF>.bin` traz a composição do voto estadual
de 2022 e nada mais; eleitorado de 2026, código IBGE e demografia continuam
vindo do pacote presidencial, que segue sendo a fonte única.

**O sidecar é gerado a partir do que já está commitado.** `gerar_base_2026.py`
depende de `scratch/eleitorado/2026/*.parquet` (~2,5 GB, fora do git), então
regenerar o pacote presidencial é impossível num checkout limpo. Mas
`locais_<UF>.bin` já carrega a chave natural, os aptos e as 42 frações
demográficas — que é exatamente o espaço de busca da imputação por doadores.
`gerar_base_governador_2022.py` lê o `.bin` com numpy puro e não toca em nada de
`sim2026/`.

**A chave natural é repetida em cada registro do sidecar** (9 bytes por local,
~760 KB no total). É caro para o que é, e vale: um desalinhamento entre os dois
pacotes atribuiria os votos ao local errado **sem aparecer no agregado
estadual**, que continuaria batendo porque as mesmas linhas seriam somadas.
`carregarGov()` confere linha a linha a cada troca de UF.

**As origens de cada estado são os candidatos com ≥ 1,5% dos válidos estaduais,
no máximo 6** (`LIMIAR_ORIGEM`/`MAX_ORIGENS` em `schema_simgov2022.py`). Medido
nas 27 UFs de 2022: rende de 2 (PA, PI, RR) a 6 (DF, MS, RS, SC) origens, e o
resíduo que sobra em `outros` nunca passa de 2,5%.

**O vínculo candidato ↔ 2022 é explícito.** No presidencial dá para escrever "PT
herda Lula, PL herda Bolsonaro" no código, porque as origens são sempre as
mesmas. Aqui cada candidato tem um campo `origem` — sugerido pelo nome, senão
pelo partido, e editável na etapa 1. É ele que preenche os pesos territoriais.

**A RG intermediária substitui a macrorregião como etapa obrigatória**, e a RG
imediata assume o lugar de refinamento. Uma macrorregião não diz nada dentro de
um estado. O replay do worker ordena `nacional < mr < uf < ri < rgi < municipio`,
então o recorte mais específico sempre vence.

**Redutos ficam desligados no modo governador**: o candidato já *é* uma origem de
2022, com a geografia real da votação dele — o reduto duplicaria a concentração.

### Limitação conhecida

O IPF é multiplicativo. Uma meta de 0% numa etapa zera a coluna, e nenhuma etapa
seguinte consegue recuperá-la — o motor cai no rateio uniforme
(`pool / (np - 2)`). Vale igual no caminho presidencial macrorregião → RGINT. A
interface nunca produz isso, porque os valores da etapa de refinamento são
semeados a partir da simulação corrente, nunca zerados.
