# Acompanhar o simulado do TSE — instruções de operação

Escrito para quem (ou qual agente) for operar uma janela de teste sem ter
acompanhado o desenvolvimento. Leia até o fim antes de rodar: a primeira seção
desfaz uma expectativa errada que custa a janela inteira.

---

## A pergunta mais importante: os dados vêm sozinhos?

**Não.** Abrir o arquivo HTML no navegador não traz dado nenhum do TSE.

O navegador nunca fala com o TSE. Quem fala é um coletor em Python, que roda na
sua máquina, lê os arquivos do TSE e grava um resumo em disco; a página lê esse
resumo. Se o coletor não estiver rodando, a tela abre vazia e **não diz por quê**.

Isso não é limitação de preguiça. Uma noite de apuração são 5.755 municípios por
cargo; o navegador faria dezenas de milhares de requisições, esbarraria no CORS e
seria bloqueado pelo TSE em segundos. O coletor junta tudo em um arquivo por
camada e respeita os limites do tribunal.

**O que vem sozinho, uma vez que o coletor esteja rodando:**

- a página se atualiza a cada 20 segundos, sem recarregar nada na mão;
- o coletor relê o TSE a cada 20 segundos (camada nacional) e a cada 4 minutos
  (camada municipal);
- se o TSE ainda não começou a publicar às 14h, o coletor continua tentando e a
  tela se preenche sozinha no instante em que os arquivos aparecerem.

---

## O comando

Um só. Ele descobre o ambiente do simulado, descobre os códigos das eleições,
começa a coletar e sobe o servidor da página:

```bash
cd <pasta do repositório>
python scripts/apuracao/plantao.py --ambiente auto --minutos 200 --servir 8777
```

Não precisa instalar nada: o coletor usa só a biblioteca padrão do Python (3.10
ou mais novo).

Ele imprime, logo no começo, três endereços prontos. Abra o primeiro:

```
  tela da apuracao   http://127.0.0.1:8777/apuracao.html?dados=scratch/apuracao/plantao/
  mapa presidencial  http://127.0.0.1:8777/apuracao-presidente.html?cargo=0001&dados=...
  um estado          http://127.0.0.1:8777/apuracao-uf.html?uf=sp&cargo=0003&dados=...
```

Deixe o terminal aberto. Fechar o terminal para a coleta, e a tela congela no
último boletim.

### Não chumbe o código da eleição

`--ambiente auto` e o padrão `--eleicao auto` existem por um motivo: **o nome da
pasta de ambiente e os códigos das eleições mudam a cada janela**, e o TSE só os
divulga na véspera. Em 15/09 eram 21270 (federal) e 21272 (estadual), no ambiente
`simulado/simulado2026` do host `resultados-sim.tse.jus.br`. Nada disso é estável.

Passar código na mão é a forma mais fácil de chegar às 14h com a tela vazia.

---

## Como saber que está funcionando

**No terminal**, uma linha por volta:

```
  volta   12 |    3.1s | municipal=nao | 31503 gets, 27357 304, 0 404, 2822 MB
```

- `404` deve ficar em **zero**. Se começar a subir a cada volta, algo está sendo
  pedido onde não existe — pare e avise, porque 404 repetido bloqueia o acesso.
- `304` alto é bom: é o servidor confirmando "não mudou", quase sem tráfego.

**Na tela**, no fim da página inicial, a seção **Saúde do plantão** mostra taxa
média contra o teto de 100 requisições por segundo, bloqueios, e 404. O quadro
fica **vermelho** se houver punição do TSE.

**O selo amarelo "SIMULADO"** no topo tem de estar aceso. Ele vem do campo `f`
dentro do próprio arquivo do TSE, não de configuração nossa. Se você está numa
janela de teste e ele **não** aparece, pare: o dado não é de teste.

---

## Se der errado

| sintoma | o que é | o que fazer |
|---|---|---|
| tela vazia, terminal parado | o coletor não está rodando | rode o comando acima |
| tela vazia, terminal rodando | o TSE ainda não publicou | espere; ele preenche sozinho |
| `nenhum ambiente respondeu` | o simulado não está no ar, ou mudou de nome | rode `python scripts/apuracao/coleta.py --descobrir` e veja o que responde |
| `404` subindo a cada volta | pedido a caminho inexistente | pare o coletor e avise |
| `!! HTTP 403` ou `429` | o TSE bloqueou | **não reinicie**; ele já se pausa sozinho por 11 minutos, e insistir renova a punição |
| a página congelou | veja se o terminal ainda imprime voltas | se parou, rode o comando de novo |

### A regra que não pode ser quebrada

O TSE bloqueia por **10 minutos, renováveis**, quem passar de 100 requisições por
segundo — e 404 repetido conta igual. O coletor trabalha a 60/s e tem um disjuntor
que para tudo ao primeiro sinal de punição.

Isso só vale se houver **um** coletor. Não rode dois ao mesmo tempo contra o mesmo
TSE, e não aumente `--taxa`.

---

## Conferir antes, se sobrar tempo

```bash
python scripts/apuracao/coleta.py --descobrir      # que ambientes respondem
python scripts/apuracao/coleta.py --ambiente auto --listar   # que eleições existem
python scripts/apuracao/testar_limites.py          # defesas contra bloqueio
node scripts/apuracao/testar_front.js              # leitura dos dados na tela
```

Os dois últimos devem terminar com `tudo certo`.

---

## O que observar nesta janela

O simulado reproduz a apuração de 0 % a 100 %, com totalização final. Vale olhar:

- o percentual de cada candidato bate com o que o TSE publica no arquivo (a base
  é `vvc`, não os votos válidos — divergem quando há voto anulado);
- os selos de **eleito** e **2º turno**: sólido quando o TSE declarou, tracejado
  quando ainda é leitura nossa das vagas do cargo. A legenda explica, embaixo de
  cada grade;
- o Senado marca **dois** eleitos por estado, porque 2026 renova dois terços;
- a seção "Onde ainda se está contando", com as unidades por estágio.

Achado novo, comportamento estranho ou erro no terminal: registre em
`DIARIO-SIMULADO-2026.md`, na mesma pasta, com o horário. É esse arquivo que
evita redescobrir a mesma coisa em outubro.
