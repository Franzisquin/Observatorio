# Diário dos simulados do TSE — Eleições 2026

Registro do que foi encontrado nas janelas de teste do TSE, na ordem em que
apareceu. Serve para duas coisas: não repetir descoberta em outubro, e deixar
rastreado *por que* cada correção existe.

Janelas: **15, 16 e 17** e **22, 23 e 24 de setembro de 2026**, das 9h às 12h e
das 14h às 17h (horário de Brasília).

---

## 15/09 — primeira janela, manhã

### 09:19 · Onde o simulado estava

Não estava onde as instruções de download sugeriam. A especificação diz que o
ambiente é uma pasta sob o mesmo host e dá `simulado` como exemplo de nome. No
host oficial, porém:

```
resultados.tse.jus.br/simulado/…        conexão cortada (não é 404)
resultados.tse.jus.br/teste/…           404 limpo
```

A assimetria entre "conexão cortada" e "404 limpo" foi o que indicou que o
caminho não era por ali. O endereço certo veio do próprio TSE: a raiz de
`resultados-sim.tse.jus.br` redireciona para
`/simulado/simulado2026/app/index.html`, e o bundle do aplicativo Resultados traz
a configuração em claro.

| | |
|---|---|
| host | `https://resultados-sim.tse.jus.br` |
| ambiente | `simulado/simulado2026` — **dois segmentos**, não um |
| ciclo | `ele2026` |
| EA11 | `…/simulado/simulado2026/comum/config/ele-c.json` |

O `Access Denied` do Akamai que aparece nos caminhos errados **não** é bloqueio
por excesso de requisições: é a resposta normal para objeto inexistente naquele
host. Foi confirmado lendo o corpo do 403, que traz uma referência `edgesuite`.

### 09:22 · O ciclo não está na raiz do EA11

O EA11 do simulado **não tem o atributo `c` na raiz**. O ciclo `ele2026` está em
`pl[].c`, como a especificação sempre descreveu — o arquivo oficial de 2024 é que
repetia o valor na raiz, e o coletor lia de lá.

Consequência se não tivesse sido corrigido na véspera: o token `<ciclo>` sairia
vazio e **toda** URL de dados daria 404, em série, o que ainda dispara bloqueio
de dez minutos.

### 09:24 · A eleição geral vem partida em duas

| eleição | tipo | 2º turno | cargos |
|---|---|---|---|
| 21270 | federal ordinária (`tp` 8) | 21271 | presidente |
| 21272 | estadual ordinária (`tp` 1) | 21273 | governador, senador, dep. federal, estadual, distrital |
| 21274 | municipal ordinária (`tp` 3) | — | cargo `25` |

A central mostra presidente, governador e senador na mesma tela e assumia **um**
código de eleição para todos. Pedir governador na eleição federal é 404 garantido.

Correção: o coletor passou a cobrir várias eleições na mesma rodada e a publicar
um `indice.json` mapeando cargo → eleição, com o `cdt2` de cada uma junto. A
virada para o segundo turno passa a ser leitura de arquivo, não edição de
configuração na véspera.

### 09:26 · Tamanho do pleito simulado

```
5.755 municípios em 28 abrangências   (as 27 UFs + zz, o exterior)
528.951 seções
163.079.139 eleitores
13 candidaturas a presidente
```

O exterior entrou sozinho: o coletor monta a lista de abrangências a partir do
EA12, e o `zz` está lá como qualquer UF.

### 09:31 · Candidatos fictícios, e uma string hostil de propósito

Os candidatos são `CANDIDATO 9999`, `CANDIDATO 9987`; os partidos, `P 9998`,
`P 9972`. Entre eles, plantada pelo TSE:

```
Candidato string 1234!@#$"TSE"
```

É um teste de escape. A renderização passa: a aspa sai como `&quot;` no HTML.
Testado junto com um `<img src=x onerror=…>` — nenhum dos dois vira marcação.

Os `sqcand` fictícios têm 8 dígitos, contra 11–12 dos candidatos reais de 2026.
Isso elimina o risco que se temia de uma foto oficial de pessoa real aparecer ao
lado de um nome inventado.

### 09:33 · O arquivo simulado tem voto anulado — e muito

```
van   1.848.835   anulados
vansj 2.083.131   anulados sub judice
vv   20.187.624   válidos
vvc  24.119.590   votos a votáveis concorrentes
```

O **primeiro colocado** é justamente um `Anulado sub judice`. O `pvap` que o TSE
publica é sobre `vvc`, não sobre os válidos:

| base | percentual do 1º colocado |
|---|---|
| sobre `vv` (o que o site fazia) | 10,32 % |
| sobre `vvc` (o que o TSE publica) | **8,64 %** |

Sem a correção feita na véspera, o número na tela divergiria do número oficial já
na primeira hora da primeira janela.

### 09:35 · O selo "Ao vivo" nunca acenderia

O andamento (`and`) do leiaute vale `n`, `p` ou `f`. O código comparava com `'s'`,
que não existe. Corrigido na véspera; no simulado o campo veio `p` e o selo
acendeu.

### 09:48 · Partido fora da paleta ficava tudo cinza

As siglas `P 9998` e companhia não estão na paleta partidária do site e caíam
todas no mesmo cinza — treze candidaturas indistinguíveis.

A primeira ideia, derivar o matiz de um hash da sigla, foi **medida e descartada**:

| | hash da sigla | atribuição por maior distância |
|---|---|---|
| cores distintas | — | 31 de 31 |
| menor distância de matiz | 0° | 10° |
| pares a menos de 15° | 23 | 0 |

Siglas que diferem num dígito caíam no mesmo tom. A solução foi dar a cada sigla
nova o matiz mais distante de todos os já entregues, atribuindo em ordem
alfabética — não na ordem do ranking, que se reordena a cada boletim e faria a
paleta inteira se remexer a cada virada.

Partido real não mudou: conferidos PT, PL, PSDB, União, MDB, Podemos e a
federação do PSOL contra o hexadecimal exato da paleta.

### 09:56 · Duas fragilidades de quem roda por horas

**O laço da página morria.** `setTimeout(async () => { await atualizar();
agendar(); })` — uma exceção em `atualizar()` e o `agendar()` seguinte nunca
rodava. A página congelava no último boletim, sem aviso, até um F5. Protegido nos
três pontos: tique periódico, primeira carga e retomada ao voltar o foco.

**A escrita não era atômica.** O coletor sobrescrevia em lugar arquivos que o
navegador pede a cada 45 s. Agora escreve ao lado e renomeia. Medido com o
plantão escrevendo ao vivo: **915 leituras, 0 truncadas**.

### 10:02 · Nome de município com entidade HTML

O TSE publica no EA12:

```
'MACHADINHO D&apos;OESTE'
```

Todo texto do TSE vem assim, e o coletor desfaz isso com `texto()` em cada campo
— menos na lista de municípios, o único lugar que copiava a string crua. São **45
municípios em 5.571**: Olho d'Água das Flores, Tanque d'Arca, Santa Luzia
d'Oeste, Nova Brasilândia d'Oeste e afins.

Foi a segunda vez que uma entidade escapou (a primeira, no nome da eleição, saía
`1&#186; Turno`). Duas vezes é padrão: o check passou a **varrer todas as strings
de todos os snapshots** atrás de `&xxx;`.

Detalhe operacional que isso ensinou: editar o arquivo não basta. O plantão já
tinha o módulo carregado em memória e continuou escrevendo o nome errado até ser
reiniciado.

### 10:05 · O 404 que sobrava: o Distrito Federal

O plantão vinha acumulando exatamente **um 404 por volta** — 2, 3, 4, 5… Pouco,
mas 404 repetido bloqueia o acesso igual a excesso de requisições, e num plantão
de seis horas isso são centenas.

Não era o EA14 nem nenhum cargo no Brasil ou em São Paulo, todos 200. Era o DF:

```
df-c0007-e021272-u.json   404    deputado estadual
df-c0008-e021272-u.json   200    deputado distrital
sp-c0008-e021272-u.json   404
```

O Distrito Federal tem Câmara Legislativa, não Assembleia: elege deputado
**distrital** (0008) e não elege **estadual** (0007). Nas outras 26 unidades é o
contrário. O EA11 declara os cargos da eleição inteira, não por UF, então a regra
não sai do arquivo — mas o efeito de ignorá-la sai no contador de 404.

Se o pedido tivesse incluído o 0008 sem essa regra, seriam **26 404 por volta**,
não um.

De quebra: o exterior (`zz`) participa da eleição federal (28 abrangências) mas
não da estadual (27), e o coletor já acertava isso sozinho porque monta a lista a
partir do EA12 de cada eleição.

### 10:06 · Quanto custa cada camada, medido

| camada | requisições | tempo | tráfego |
|---|---|---|---|
| alta (BR + UFs, 6 cargos) | 138 | ~3 s | desprezível após o 1º ciclo |
| municipal (5.755 × 5 cargos) | 28.178 | ~830 s | 2,5 GB |

Taxa média sustentada de 25,6 req/s, contra o teto de 100 do TSE — folga
confortável. A camada alta ser tão barata é o que permite acelerá-la sem risco.

O ETag aparece na conta: da segunda volta em diante a camada alta responde
inteira em 304, e o tráfego para de crescer.

### 10:08 · Cadência acelerada

Medido antes de mexer: o TSE não republica o arquivo presidencial mais que uma
vez a cada 2,5 minutos — não adianta pedir mais rápido que a fonte. O que dava
para encurtar era a soma dos dois atrasos, o do coletor e o da página.

| | antes | agora |
|---|---|---|
| plantão, camada alta | 45 s | **20 s** |
| plantão, camada municipal | 600 s | **240 s** |
| paralelismo da municipal | 24 | **48** |
| recarga da página | 45 s | **20 s** |

Pior caso entre o TSE publicar e a tela mostrar: de ~90 s para ~40 s.

### 10:16 · O que o coletor fazia sob punição era o pior caso possível

A janela existe para provar as defesas, não só o desenho da tela. Olhando o
tratamento de 403/429 que estava no ar:

```python
espera = min(120, 15 * tentativa)
print(f"! HTTP {err.code} — recuando {espera}s")
time.sleep(espera)
```

Cada thread recuava **sozinha**. Com 48 workers, uma punição do TSE viraria 47
threads continuando a pedir enquanto uma dormia — e o bloqueio é de dez minutos
**renovado a cada nova tentativa durante a punição**. O comportamento estava
desenhado para transformar um bloqueio de 10 minutos num bloqueio permanente.

O que entrou:

**Disjuntor global.** O primeiro 403/429 pausa o cliente inteiro por 11 minutos —
um a mais que a punição, de propósito. Quem chegar depois enxerga a pausa já
aberta e espera, em vez de abrir outra e empurrar o fim para frente.

**Memória de 404.** URL que deu 404 não é pedida de novo por 10 minutos. Não é
"nunca mais", porque arquivo pode passar a existir — o de eleitos só aparece
depois da totalização final. Mas um 404 estrutural deixa de custar uma requisição
por volta e passa a custar uma a cada dez minutos.

**403 não é sempre punição.** Neste CDN o mesmo 403 serve para "você foi
bloqueado" e para "esse arquivo não existe neste host" — foi o que apareceu ao
sondar `simulado/teste`. O que separa os dois é se aquela URL **já respondeu 200
alguma vez**: punição atinge o que funcionava; caminho errado nunca funcionou.
Sem essa distinção, sondar um ambiente inexistente pararia o plantão por 11
minutos.

**Taxa padrão de 80/s para 60/s.** O ritmo real medido é de 24 a 34 req/s, então
a folga não custa nada — e dobra a distância até o teto de 100.

Provado em `scripts/apuracao/testar_limites.py`, que sobe um servidor local
devolvendo 429, 403 e 404 de propósito. 18 asserções, incluindo a que importa:
durante a pausa, **6 threads não mandaram uma única requisição**, e 4 punições
simultâneas abrem uma pausa só, não quatro.

O painel de saúde deixou de ser só contagem: taxa média contra o teto de 100,
bloqueios, 404 e quantas repetições a memória evitou — e o quadro inteiro fica
vermelho se houver punição.

### 14:24 · A tarde recomeça do zero

A janela da tarde não continua a da manhã: o TSE reinicia a apuração e percorre
de 0 a 100% outra vez. O país voltou para 7,00% às 14h24, chegou a 100% às 16h26,
e os **seis cargos** alcançaram totalização final — presidente na eleição federal,
e governador, senador, deputado federal, estadual e distrital na estadual.

Foi aí que os selos tracejados viraram sólidos: com `tf=s` e `st` preenchido, a
dedução de `md` e `nv` deu lugar à declaração do TSE, e o arquivo de eleitos
(EA10) passou a existir para todos.

### 16:30 · A segunda falha de rede do dia

```
! volta 235 falhou (URLError: TLSV1_ALERT_INTERNAL_ERROR); seguindo para a proxima
```

O servidor derrubou o handshake TLS no meio da passada municipal. Uma ocorrência
em 273 voltas — e o plantão registrou e seguiu.

É a segunda falha da mesma família: de manhã foi `IncompleteRead`, agora TLS.
Classes diferentes, o mesmo desfecho evitado pela mesma proteção. Sem ela, a
cobertura teria encerrado meia hora antes do fim da janela, e o único aviso seria
a tela parada no último boletim.

A lição que nenhuma inspeção de código daria: **seis horas de rede não são seis
horas sem incidente**. As duas falhas só apareceram porque o coletor ficou o dia
inteiro no ar contra dados reais.

---

## Balanço da primeira janela

| | |
|---|---|
| duração | 5,5 h, 273 voltas |
| requisições | 193.482, das quais **452.162 responderam 304** |
| tráfego | 14,1 GB |
| taxa média | **9,8 req/s**, contra o teto de 100 |
| **404** | **0** |
| **bloqueios** | **0** |
| falhas de rede | 2, ambas absorvidas |
| rodadas completas | 2 (manhã e tarde), de 0 a 100% |

O ETag é o que sustenta esses números: mais respostas 304 do que requisições
novas, porque a maior parte dos 5.755 municípios não muda entre duas passadas.

---

## 15/09 — segunda janela, tarde

### 14:18 · Plantão da tarde, sem novidade de ambiente

Mesmo ambiente e mesmos códigos da manhã — `simulado/simulado2026`, 21270
(federal) e 21272 (estadual). A descoberta automática achou os dois sozinha, o
que era o ponto: nenhum código foi chumbado.

Primeira volta com camada municipal em 786 s, 28.178 requisições, **0 respostas
404** — reproduz a medição da manhã. As duas armadilhas conhecidas continuaram
cobertas: deputado estadual saiu com 26 abrangências (DF fora, que elege
distrital) e presidente com 28 (exterior dentro).

### 15:05 → 15:50 · Um platô que não era travamento

A apuração ficou meia hora parada em 62,54 %, com as voltas fechando normalmente
e o tráfego todo em 304. Parecia plantão travado; não era. O TSE simplesmente não
republicou naquele intervalo, e às 15:50 já estava em 80,74 %.

Como distinguir um do outro sem esperar: a linha da volta só é impressa **no fim**
da volta, e uma volta com camada municipal leva de 700 a 790 s. Dez minutos sem
linha nova é o normal durante a municipal, não um sintoma. A prova de vida é
olhar se a pasta de saída está recebendo arquivo — durante a municipal ela recebe
dezenas por minuto.

Cadência medida: a camada municipal cai nas voltas 1, 8, 15, 22, 29, 36 — uma a
cada sete.

### 16:09 · Totalização final do presidencial

O que a janela existia para exercitar.

| | |
|---|---|
| presidente (21270-0001) | `tf=s`, `and=f`, `md` vazio, 528.951 de 528.951 seções |
| governador (21272-0003) | `tf=n`, `and=p`, **`md=s`** |
| totalização do TSE | 15/09/2026 16:08:46, geração 16:09:51 |

Os quatro comportamentos que o `SIMULADO.md` manda conferir, conferidos na tela:

- o selo passou a **Encerrada** (`and=f`);
- o selo **Matematicamente definido** apagou sozinho, porque `md` deixa de existir
  quando há totalização final — e o governador, ainda em `tf=n`, acendeu o dele
  como **Segundo turno definido** (`md=s`). Os dois estados na mesma tela;
- os dois primeiros ganharam selo de **2º turno sólido**, não tracejado. É o certo:
  o registro do candidato traz `eleito=s` e `situacao=2º turno` vindos do próprio
  arquivo do TSE, então é declaração, não leitura nossa das vagas;
- o EA14 de acompanhamento chegou a ficar atrás do EA20 — 0 UFs finalizadas contra
  um presidencial já em 100 % —, mas alcançou na volta seguinte. É defasagem entre
  dois arquivos, não divergência: não vale alarme na tela.

Detalhe dos dados simulados: o primeiro colocado é um `Anulado sub judice` e o TSE
o classificou ao segundo turno assim mesmo. Não é caso a tratar — é dado fictício.

### 16:13 · O EA10 de presidente não existe

`CARGOS_COM_ELEITOS` em `tse.py` é `{0003, 0005, 0006, 0011}` e **não** inclui
presidente. Com `tf=s` na mão, dava para descobrir se isso era lacuna, com uma
requisição só — pedir EA10 antes da totalização é que daria 404 em série:

```
br-c0001-e021270-e.json   ausente
```

A exclusão está certa. E é coerente: `eleito` e `situacao` do presidente já vêm
dentro do próprio EA20, que é de onde o selo sólido saiu. O EA10 serve aos cargos
em que falta informação que o resultado não traz — coligação e suplentes.

### 16:20 · 100 % das seções não é totalização final

O melhor par de prova da janela, porque os dois estados coexistiram:

| | presidente (21270) | governador (21272) |
|---|---|---|
| seções | 528.951 de 528.951 | 106.580 de 106.580 (SP) |
| `and` | `f` | `p` |
| `tf` | `s` | `n` |
| `md` | vazio | `s` |
| selo de estado na tela | **Encerrada** | **Ao vivo** |
| marca no candidato | `is-segundo` — **sólida** | `is-segundo is-previsto` — **tracejada** |

Ou seja: contar todas as seções e totalizar são coisas diferentes, e o TSE
publica uma antes da outra. Quem tratar 100 % como fim da apuração vai declarar
resultado antes do tribunal.

A marca tracejada do governador é a leitura do `md=s`; a sólida do presidente vem
do `situacao` que o TSE preencheu. É a legenda embaixo da grade se pagando: com o
mesmo percentual na tela, o leitor distingue declaração de dedução.

### 16:56 · A estadual totalizou no fim da janela, e o EA10 veio

A estadual passou 43 minutos sem republicar (última geração 16:01:52) e parecia
que fecharia a janela em `tf=n`. Voltou às 16:44 com os quatro cargos totalizados
de uma vez, e o plantão pegou na volta 64.

Os três arquivos de eleitos apareceram sozinhos, como o desenho previa:

```
21272-0003-eleitos.json    17 KB    governador
21272-0005-eleitos.json    19 KB    senador
21272-0006-eleitos.json    81 KB    deputado federal
```

Deputado estadual (0007) totalizou junto e **não** tem EA10 — coerente com
`CARGOS_COM_ELEITOS`.

**O EA10 não traz `situacao`.** O registro é `sq, n, nome, urna, partido, com,
votos, seq, vice` — o que ele acrescenta é a coligação (`com`) e a ordem (`seq`),
não o rótulo. `Eleito`, `Não eleito` e `2º turno` vêm do EA20, no dicionário de
candidatos do arquivo de UF. Vale anotar porque a expectativa natural é a
inversa: o arquivo chamado "de eleitos" não é quem diz que alguém se elegeu.

### 16:57 · O bug que só aparece depois da totalização

O mais grave da janela, e não daria erro nenhum: **a página de estado perdia o
selo oficial no instante em que o TSE o declarava.**

`apuracao-uf.js` montava o ranking com o dicionário do arquivo **municipal**, e
os dois dicionários não são iguais:

| | municipal (`…-sp.json`) | UF (`…-uf.json`) |
|---|---|---|
| `situacao` | ausente | `2º turno` |
| `eleito` dos dois classificados | `n` | `s` |

Enquanto havia `md=s`, o selo saía do palpite — tracejado, e ninguém notava a
falta do dado. Quando veio `tf=s`, o `md` esvaziou, o `situacao` não estava ali e
o `eleito` do arquivo municipal dizia `n`: o selo simplesmente sumiu, justo quando
passou a ser oficial. Em outubro, páginas de estado nunca mostrariam quem venceu.

Corrigido sobrepondo o dicionário da UF ao municipal nos dois pontos que montam
ranking. O arquivo de UF já era buscado a cada ciclo — só não se guardava o
`cand` dele.

### 17:05 · Senado: vaga não é eleito, e o TSE avisa por quê

`nv=2` nas 27 unidades, e mesmo assim o TSE declarou **45 eleitos, não 54**: 19
estados com dois, 7 com um, e o Amapá com nenhum.

O motivo vem no arquivo, em `esae=s` com `mnae`, em 8 unidades:

> Candidata ou candidato concorrente a uma das vagas com maior votação nominal
> anulada ou anulada sub judice.

e, no Amapá, também que os anulados passam de 50 % da votação nominal.

Isto exercita a defesa mais importante do `marcar()`: há um ramo que, para cargo
de várias vagas com apuração encerrada, marcaria os `nv` primeiros. Se ele
tivesse precedência, o site declararia dois senadores no Amapá — onde o tribunal
declarou zero. O ramo oficial vem antes e venceu: conferido na tela, o Amapá
mostra o aviso de totalização sem atribuição de eleito, com os dois motivos, e
nenhum selo em candidato nenhum.

### Dois bugs de tela achados durante a janela

A limpeza de interface feita na tarde esbarrou em dois defeitos que não vinham de
dado do TSE, e que valem registro porque nenhum dos dois dava erro no console.

**O globo do exterior vinha com um "O" dentro.** `.apu-map path` tem uma classe e
um tipo — especificidade (0,1,1) — e vencia `.apu-exterior-grade`, que tinha só a
classe (0,1,0). A grade do globo recebia então o `fill` do mapa em vez do `none`
que a regra dela pedia: os meridianos elípticos eram desenhados como **área
preenchida de escuro sobre o disco já pintado**, e o de dentro virava um oval
sólido. O `stroke` vinha da cor do fundo pelo mesmo motivo, o que deixava o resto
da grade invisível. A regra irmã do disco já estava escrita como
`.apu-map .apu-exterior-disco`; só a da grade ficou sem o escopo.

Vale como alerta geral: qualquer regra de uma classe só, para elemento dentro de
`.apu-map`, perde para `.apu-map path` sem avisar.

**Uma referência a elemento removido.** `apuracao-nacional.js` ainda fazia
`$('legenda').innerHTML = ''` depois que o contêiner saiu do HTML. Como está no
ramo "sem dados", só lançaria antes do primeiro boletim — isto é, exatamente na
hora em que ninguém estaria olhando o console, e justamente o trecho que a
proteção de laço da manhã existe para salvar.

---

## Medições da janela

| | |
|---|---|
| passada nacional completa (presidente) | 5.787 requisições, **0 respostas 404**, 53,9 MB |
| ritmo da apuração simulada | 20,01 % às 09:17 → 50,01 % às 09:46 |
| conferência soma dos filhos × arquivo do pai | confere em todos os campos |

O TSE reproduz o fluxo de 0 % a 100 %, e não publica direto o resultado final —
o que é melhor para teste do que a apresentação de julho dava a entender.

Da janela da tarde, com o plantão inteiro rodando de 14:18 até a totalização:

| | |
|---|---|
| ritmo | 19,45 % às 14:16 → 62,54 % às 15:05 → 80,74 % às 15:50 → **100 % às 16:08** |
| totalização final | presidente 16:08, estadual (4 cargos) 16:44 |
| custo total | 118.576 requisições com conteúdo, 257.662 em 304, 7,8 GB |
| 404 e bloqueios | **0 e 0**, em 85 voltas e 200 minutos |

Depois das 17h o CDN congela e o custo cai a zero: as 22 últimas voltas, inclusive
uma passada municipal inteira de 614 s, não trouxeram **um byte novo** — tudo 304.
Quem quiser cobrir só a janela pode parar às 17h sem perder nada; deixar rodando
também não custa, que é o que se fez aqui.

O 304 passando o número de respostas com conteúdo é o ETag fazendo efeito: da
segunda volta em diante, a maior parte do que se pede não mudou.

---

## Como reproduzir

```bash
python scripts/apuracao/coleta.py --descobrir
python scripts/apuracao/coleta.py --ambiente auto --listar
python scripts/apuracao/plantao.py --ambiente auto --eleicao 21270,21272 \
    --cargos 0001,0003,0005,0006,0007 --saida scratch/apuracao/simulado
node scripts/apuracao/testar_front.js
```

O `--ambiente auto` prefere quem estiver em fase `s`; quando o simulado sair do
ar, cai sozinho no oficial.

---

## Em aberto

- **Selo de simulado.** Hoje é um chip amarelo no topo. Com candidato fictício
  num site público, provavelmente precisa ser mais difícil de não ver antes de
  qualquer publicação na branch que o site lê.
- **Foto em fase simulada.** Nenhum rosto real deveria aparecer numa janela de
  teste, mesmo com a colisão de `sqcand` descartada neste simulado.
- **`meta.gerado`.** Carimba a hora da escrita em todo arquivo, então o snapshot
  sai diferente mesmo quando o dado do TSE é idêntico — o plantão commita e
  empurra a cada volta sem motivo.
- **Cargo `25`** da eleição 21274 (municipal ordinária) não foi investigado.
- **EA16/EA18** (boletim de urna, hashes, horário de recebimento) não foram
  exercitados nesta janela.
- **Situações do voto proporcional.** `Eleito por QP`, `Eleito por média` e
  `Suplente` continuam sem aparecer. O EA20 de deputado federal é por partido —
  não tem dicionário de candidato —, e o EA10 lista os eleitos sem rótulo de
  situação, só com `seq`. Então nenhum dos dois arquivos, neste simulado,
  entregou o que a legenda do site promete para cargo proporcional. Falta
  descobrir se isso é característica do dado simulado ou do leiaute.
- **Segundo turno.** O simulado fechou o presidencial com dois classificados, e
  existem os códigos 21271 e 21273 para os segundos turnos. Se alguma janela
  publicar neles, é a chance de exercitar a virada de `cdt2` pelo `indice.json`
  sem editar configuração — que é justamente o que a correção das 09:24 previu e
  nunca foi testado com dado real.
