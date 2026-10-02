# Noite de 04/10/2026 — instruções de operação da apuração

Escrito para quem (ou qual agente) for operar a noite do 1º turno sem ter
acompanhado o desenvolvimento. Leia até o fim antes de rodar.

---

## Como os dados chegam ao site

```
TSE (resultados.tse.jus.br/oficial)
  → plantão (Python, numa máquina nossa)
  → Worker do electomaps.com.br (/dados/, guarda no R2 do Cloudflare)
  → páginas da apuração (releem a cada 20 s)
```

Nada passa pelo GitHub. O navegador do visitante nunca fala com o TSE: quem
fala é o plantão, que respeita os limites do tribunal e publica um resumo por
camada. **Se nenhum plantão estiver rodando, o site congela no último boletim.**

O plantão lê só o ambiente **oficial**, e se recusa a coletar se o arquivo de
configuração do TSE (EA11) não estiver em fase oficial (`f = "o"`). Os códigos
do 1º turno saem desse arquivo sozinhos (`--eleicao auto`, o padrão): **6257**
(presidente) e **6259** (governador, senador, deputados federal, estadual e
distrital). A 6261 (Conselho Distrital do DF) fica de fora. Conferido em
02/10/2026, com os arquivos oficiais já no ar, zerados desde 29/09: uma volta do
país inteiro, 17.041 requisições, 0 respostas 404, 0 bloqueios.

---

## Antes de domingo (uma vez só)

Quem tem o login do Cloudflare:

1. Assinar o **Workers Paid** e ativar o **R2** no painel.
2. Criar o bucket e a chave do plantão:
   ```bash
   npx wrangler r2 bucket create electomaps-apuracao
   python -c "import secrets; print(secrets.token_urlsafe(32))"   # gera a chave
   npx wrangler secret put CHAVE_PLANTAO                            # cola a chave
   ```
   Guarde a chave fora do repositório. Ela vai para quem roda o plantão.
3. Tirar do `.assetsignore` o bloco da apuração, inclusive a página de zonas
   (`apuracao-zonas.html`, `js/apuracao-zonas.js`) e as malhas
   `resultados_geo/zonas_svg/`. Ficam: `locais.*`, se locais continuar fora, e
   `resultados_geo/zonas_eleitorais/` (fontes brutas, nunca sobem). Publicar:
   `npx wrangler deploy`.
4. Conferir no ar: `/apuracao` redireciona para `/apuracao-presidente`, e
   `https://electomaps.com.br/dados/indice.json` responde 404 "ainda não
   publicado".

---

## No domingo

A partir das 16h. Os arquivos oficiais existem desde 29/09, então ligar cedo não
gera 404; o resultado de presidente só é liberado pelo TSE às 17h.

PowerShell, na pasta do repositório:

```powershell
$env:CHAVE_PLANTAO = "<a chave>"
python scripts/apuracao/plantao.py --publicar https://electomaps.com.br/dados/ --nome casa
```

Roda 12 horas (até de madrugada) sem mais nada. Não precisa instalar nada além do
Python 3.10+; com `numpy` instalado, sai também a projeção presidencial.

- **A máquina não pode dormir.** Energia: suspensão "Nunca" enquanto estiver na
  tomada. Deixe o terminal aberto.
- **Reserva**: o mesmo comando, em **outra casa, outra internet**, com
  `--nome reserva`. Só o plantão no comando grava; a reserva fica coletando e,
  se o principal ficar 3 minutos sem gravar (luz, internet, bloqueio), assume
  sozinha. Quando o principal volta, vira a reserva.
- **Nunca dois plantões na mesma internet**: o limite do TSE é por IP, e dois
  na mesma conexão passam dele.

---

## Como saber que está funcionando

No terminal, uma linha por volta (a cada ~45 s):

```
  volta   12 |   41.0s | municipal=sim (faltam 31 UFs) | 31503 gets, 27357 304, 0 404, 822 MB | 45 enviados, ok
```

- `404` deve ficar em **zero**. Se subir a cada volta, algo está sendo pedido onde
  não existe — pare e avise, porque 404 repetido bloqueia o acesso.
- `304` alto é bom: é o TSE confirmando "não mudou", quase sem tráfego.
- `enviados, ok` é o site recebendo. `em espera (outro plantão no comando)` é
  normal na reserva. `CHAVE RECUSADA` é chave errada em `CHAVE_PLANTAO`.
- A camada municipal anda em fatias de 30 s por volta, depois do placar do Brasil
  e dos estados; uma rodada do país leva uns 10 minutos.

De qualquer lugar: `https://electomaps.com.br/dados/status.json` mostra a volta,
as requisições, os 404, se há bloqueio (`bloqueado_por`) e a situação da
publicação.

---

## Se der errado

| sintoma | o que é | o que fazer |
|---|---|---|
| site parado, terminal parado | o plantão caiu | rode o comando de novo; a reserva cobre enquanto isso |
| `nao e o ambiente oficial` | o TSE não está em fase oficial | não force; avise |
| `404` subindo a cada volta | pedido a caminho inexistente | pare o plantão e avise |
| `!! HTTP 403` ou `429` | o TSE bloqueou este IP | **não reinicie**; ele já pausa sozinho por 11 min e a reserva assume |
| `CHAVE RECUSADA` | chave errada | confira `$env:CHAVE_PLANTAO` |
| `falha (sem rede) ... vai de novo` | internet oscilou | nada; o que falhou vai na volta seguinte |

### A regra que não pode ser quebrada

O TSE bloqueia por **10 minutos, renováveis**, quem passar de 100 requisições por
segundo — e 404 repetido e 304 contam igual. O plantão trabalha a 60/s e tem um
disjuntor que para tudo ao primeiro sinal de punição. Não aumente `--taxa`.

---

## Conferir antes, se sobrar tempo

```bash
python scripts/apuracao/coleta.py --listar     # 6257 e 6259 com data 04/10/2026
python scripts/apuracao/testar_limites.py      # defesas contra bloqueio
node scripts/apuracao/testar_worker.mjs        # chave, cache e troca de comando do Worker
node scripts/apuracao/testar_front.js          # leitura dos dados na tela
```

Para ver as páginas com dados de verdade sem publicar nada, rode o plantão sem
`--publicar` e com `--servir 8777`: ele imprime os endereços locais.

---

## As páginas

A página de deputados (federal e estadual; no DF, a Câmara Legislativa, cargo
0008) lê as listas abertas que o plantão grava por UF em
`{eleicao}-{cargo}-lista-{uf}.json`. As cadeiras são as do TSE (`vag`, que ele
refaz a cada totalização, segundo o EA20); numa UF em que o TSE ainda não
distribuiu vaga nenhuma, valem as da conta do plantão (`cad`, `cadeiras.py`: 10%
do QE no quociente, 80/20 nas sobras e a 3ª fase aberta pelo STF). Até 100% das
seções totalizadas tudo aparece como projeção, tracejado; firme (sólido), só o
que o TSE já distribuiu: as vagas dele com 100% totalizado, ou o eleito que ele
declarou (`e`, `st`). A conta do plantão nunca fica firme.
`python scripts/apuracao/testar_cadeiras.py` confere essa conta contra 2022.

Antes do primeiro boletim, a página mostra os partidos e as listas registrados,
com 0 voto e em ordem alfabética, de `resultados_geo/candidatos_2026/deputados/`
— escritos por `python scripts/apuracao/candidatos.py --cargos 6 7 8` (`--cargos
1 3 5` faz o mesmo para presidente, governador e senado).

### Zonas eleitorais

190 cidades têm mapa por zona (`resultados_geo/zonas_svg/indice.json`, de
`scripts/gerar_malhas_zonas.py`). Em cada rodada, o plantão baixa do TSE o
arquivo de cada zona delas para presidente, governador e senador
(`coleta.camada_zonas`, ~900 arquivos por cargo, uns 25 s) e grava
`{eleicao}-{cargo}-zonas-{ibge}.json`. Conferido em 02/10 contra o ambiente
oficial: 917 requisições, 0 respostas 404.

Clicar numa dessas cidades — no mapa nacional (presidente) ou no mapa do estado
(presidente, governador, senador) — mostra no painel o link "Ver as N zonas
eleitorais de …", que abre `apuracao-zonas.html?mun=<ibge>` no mesmo cargo.

### Comparação com 2022 (página presidencial)

A página presidencial compara 2026 com o 1º turno de 2022 pelo número de urna:
Lula (13) com Lula, Flávio Bolsonaro (22) com Jair. Bloco na lateral e, no botão
"Variação 2022" do mapa, uma seta por estado ou município, no estilo do NYT. A
base está em `resultados_geo/comparacao/presidente_2022_t1.json`; só precisa ser
refeita se mudar a malha ou o acervo: `python scripts/apuracao/comparacao_2022.py`.

Para ver a comparação em ação sem eleição, `simular2026.py` grava uma apuração
presidencial de 2026 inventada, só local (2022 município a município, levado a
Flávio 48%, Lula 41%, Renan, Cury, Caiado e Zema; `--semente` troca o sorteio):

```bash
python scripts/apuracao/simular2026.py
# apuracao-presidente.html?cargo=0001&dados=scratch/apuracao/sim2026/
```

### Ensaio com 2022, todos os cargos, sem o TSE

`ensaio_2022.py` toca a apuração real de 2022 a partir do acervo local do site e
escreve os mesmos arquivos que o plantão escreve:

```bash
python scripts/apuracao/ensaio_2022.py --tocar --duracao 10 --passo 8
python scripts/apuracao/ensaio_2022.py --instante 0.4
```

As páginas leem de `dados=scratch/apuracao/ensaio2022-t1/`.
