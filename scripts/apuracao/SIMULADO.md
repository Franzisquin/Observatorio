# Plantão da apuração — operação dos simulados

Janelas do TSE: **15, 16 e 17** e **22, 23 e 24 de setembro de 2026**, das 9h às
12h e das 14h às 17h. Os dados simulados vêm com 100% das seções recebidas e com
a totalização final incluída, na mesma estrutura de pastas do ambiente oficial.

Duas coisas não se sabem antes da janela abrir, e as duas se descobrem por
comando, não por adivinhação:

- **o nome da pasta de ambiente** — as instruções de download dizem que o nome
  para os testes "será divulgado oportunamente";
- **o código da eleição** — sai do próprio `ele-c.json`.

> **Só vai acompanhar uma janela, sem mexer no código?** Use
> [COMECAR-AQUI.md](COMECAR-AQUI.md): é um comando só, e explica por que abrir o
> HTML sozinho não traz dado nenhum. Este arquivo aqui é o detalhe de operação.

## 1. Reconhecimento (antes de qualquer coleta)

```bash
python scripts/apuracao/coleta.py --descobrir
```

Sonda os nomes conhecidos (`oficial`, `simulado`, `simulado1`, `simulado2`,
`teste`) com uma requisição em cada e imprime a fase de quem responder. Prefere o
ambiente cuja fase é `s`: o `oficial` responde sempre, e parar nele faria a
descoberta nunca achar o simulado.

Se o TSE divulgar um nome fora da lista, ele entra em `AMBIENTES`, em
`scripts/apuracao/tse.py`.

```bash
python scripts/apuracao/coleta.py --ambiente auto --listar
```

Lista as eleições com pleito, turno, data e cargos. É de onde sai o `--eleicao`.

## 2. Conferência antes de publicar

```bash
python scripts/apuracao/coleta.py --check --ambiente <amb> --eleicao <cd> \
    --cargo 0001 --uf rr
```

Soma dos filhos contra o arquivo do pai, nos dois números que o TSE publica nas
duas pontas. Divergência aqui é erro de coleta, não do TSE — **não publique**.

## 3. Plantão

```bash
python scripts/apuracao/plantao.py --ambiente auto --eleicao <cd> \
    --cargos 0001,0003,0005,0006,0007 --minutos 180 \
    --saida scratch/apuracao/plantao
```

No GitHub Actions é o workflow **Apuração ao vivo**, disparado à mão. O passo
"Reconhecimento do CDN" imprime ambiente, fase e eleições disponíveis antes de o
laço começar — numa janela de três horas, descobrir um código errado pela tela
vazia custa a janela inteira.

Cadências: camada alta (BR + 27 UFs, 28 arquivos por cargo) a cada 45 s; camada
municipal (5.569 por cargo) a cada 4 min; EA14 de acompanhamento, uma requisição
por volta; EA10 de eleitos só depois que alguma abrangência marca `tf=s`.

## 4. Conferir na tela

O plantão local escreve em `--saida`; a página lê de lá pelo parâmetro `dados`:

```
apuracao.html?eleicao=<cd>&dados=scratch/apuracao/plantao/
apuracao-presidente.html?eleicao=<cd>&cargo=0001&dados=scratch/apuracao/plantao/
apuracao-uf.html?eleicao=<cd>&cargo=0003&uf=rr&dados=scratch/apuracao/plantao/
```

O selo amarelo **Simulado** aparece sozinho quando o campo `f` do arquivo é `s`.
Se ele não aparecer numa janela de teste, o dado não é de teste — pare e confira o
ambiente antes de qualquer publicação.

A seção **Saúde do plantão**, na central, lê o `status.json`: ambiente, voltas,
requisições, 404 e o apurado do país. O teto do TSE é de 100 requisições por IP
por segundo, com bloqueio de 10 minutos renovável, e **404 repetido bloqueia
igual a excesso** — se a contagem de 404 subir de volta em volta, pare o plantão e
ache a URL errada antes de recomeçar.

## O que exercitar nesta janela

Os simulados incluem totalização final, que é justamente o estado que a noite de
outubro só alcança no fim. Vale conferir na tela:

- `tf=s` e a situação de cada candidato (`Eleito`, `Eleito por QP`, `Eleito por
  média`, `Suplente`);
- o arquivo de eleitos (EA10) aparecendo depois disso;
- `md` — o selo escuro "Matematicamente definido", que só existe enquanto `tf=n`;
- `dv=n` no arquivo presidencial: a tela deve explicar a liberação das 17h em vez
  de exibir 0,00% sem contexto;
- a anatomia do voto no painel de participação — nominal, legenda, anulado, sub
  judice, branco, nulo, nulo técnico — e as seções não instaladas e não apuradas;
- `esae=s` com `mnae`, se o simulado produzir uma eleição sem eleito atribuído.

## Prova sem esperar a janela

Os dados de 2024 seguem no ar até 4 de abril de 2028, e servem de teste real:

```bash
# municipal ordinária 2024: tem EA14 de acompanhamento e EA10 de prefeito
python scripts/apuracao/coleta.py --eleicao 619 --cargo 0011 --uf rr

# suplementar de governador de RR: 160.004 votos anulados sub judice —
# o caso em que a base do percentual aparece
python scripts/apuracao/coleta.py --eleicao 6278 --cargo 0003 --uf rr \
    --destino scratch/apuracao/local
node scripts/apuracao/testar_front.js
```

O check do front roda `js/apuracao-dados.js` e `js/apuracao-ui.js` contra esses
arquivos e confere a base do percentual, os estados do leiaute e a anatomia do
voto. Rode antes de publicar qualquer mudança nessas duas camadas.
