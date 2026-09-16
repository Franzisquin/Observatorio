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

## Medições da janela

| | |
|---|---|
| passada nacional completa (presidente) | 5.787 requisições, **0 respostas 404**, 53,9 MB |
| ritmo da apuração simulada | 20,01 % às 09:17 → 50,01 % às 09:46 |
| conferência soma dos filhos × arquivo do pai | confere em todos os campos |

O TSE reproduz o fluxo de 0 % a 100 %, e não publica direto o resultado final —
o que é melhor para teste do que a apresentação de julho dava a entender.

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
