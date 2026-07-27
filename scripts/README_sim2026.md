# Pipeline do Simulador 2026

Gera `resultados_geo/sim2026/`, que é tudo o que `simulador.html` consome.

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

# 5. Validação (sem browser).
node scripts/testar_sim_ei_worker.mjs      # motor: NNLS, IPF, conservação, determinismo
node scripts/testar_logica_simulador.mjs   # lógica eleitoral: migração, apuração, 2º turno
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

O registro binário tem 59 bytes: cabeçalho de 18 (`cd_municipio u32`,
`cod_ibge u32`, `nr_zona u16`, `nr_locvot u16`, `aptos u32`, `flags u8`, pad)
seguido de 41 frações `u8`. `flags & 1` marca um local imputado.

## Decisões que valem lembrar

**A chave de casamento 2022↔2026 é `(CD_MUNICIPIO, NR_ZONA, NR_LOCAL_VOTACAO)`.**
O `local_id` inteiro dos GeoJSON do repo é sintético e não existe nos dados do
TSE. O par `NR_ZONA + NR_LOCAL_VOTACAO` sozinho colide em ~19% dos locais, por
isso o município entra na chave.

**Não usamos `CD_RACA_COR` do TSE.** Em 2026 ela está ~71% "NÃO INFORMADO" —
só é coletada em realistamentos recentes, o que enviesa a subamostra para
eleitores jovens. A raça vem do Censo, já agregada por local nos GeoJSON de
`locais_votacao_2022`, com cobertura completa.

**A regressão ecológica é regularizada (ridge, α = 0,15).** Sem encolhimento
para a média do escopo ela devolve soluções de canto 0%/100% — a composição dos
locais é fortemente colinear, o sistema é mal condicionado e o NNLS empurra os
coeficientes não identificados para a fronteira. Isso produz números absurdos
("100% dos analfabetos votaram Lula") que são ruído, não achado. O mesmo α é
usado offline aqui e ao vivo em `js/sim_ei_worker.js` — se mudar num lado, mude
no outro.

**Os nomes dos candidatos nos GeoJSON de 2022 estão em cp1252 mal decodificado**
(`"JAIR BOLSONARO (PL) (N?O ELEITO) 2T"`). `achar_chave()` casa por prefixo e
sufixo, que caem na parte sem acento. Não compare a string inteira.

**O invariante do motor é o eleitorado apto de 2026**, não o total de votos.
Abstenção e nulo/branco são colunas do vetor como qualquer candidato — é isso
que permite editar comparecimento por grupo demográfico.

## Pendente

Modo governador. Os pacotes atuais só carregam a dimensão `voto2022`
presidencial. Para governador é preciso um pacote por UF com os candidatos
estaduais de 2022 (`governador2022/governador_<UF>_2022.geojson` já está no
repo), já que a lista de candidatos muda de estado para estado e não cabe no
esquema global fixo.
