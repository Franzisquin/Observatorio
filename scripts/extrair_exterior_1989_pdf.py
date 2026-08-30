"""Le o voto no exterior de 1989 dos boletins digitalizados do TSE.

Nao existe arquivo eletronico do exterior em 1989: o que ha e o boletim impresso
("ELEICOES 89 / EXTERIOR"), digitalizado sem camada de texto. Este script faz OCR
das paginas e devolve um CSV com um voto por (pais, candidato).

  T1: paginas 132-146 de 00000001_-_Bloco_III.pdf         (22 candidatos)
  T2: paginas 372-377 de EXTERIOR_2T_1_240117_110535.pdf  (Lula e Collor)

POR COORDENADA, NAO POR REGEX
-----------------------------
O boletim tem tres colunas em posicao fixa (resumo do pais, e dois blocos de
candidatos). Ler pelas coordenadas que o tesseract devolve para cada palavra
dispensa interpretar a fileira de pontos -- que sai do OCR cheia de virgula,
acento e digito solto e derruba qualquer expressao regular.

O QUE TORNA ISTO CONFIAVEL
--------------------------
Ao lado de cada numero o boletim imprime o percentual dele sobre os votos
validos do pais. Isso da uma conferencia por VALOR, e nao so por total: um
digito trocado no OCR faz o percentual recalculado divergir do impresso. Onde
divergir, o script tenta recuperar o numero A PARTIR do percentual e so aceita
se a volta fechar; o que nao fechar dos dois lados sai listado, para conferir no
papel. Nenhum numero entra no acervo sem ter batido com o proprio boletim.

Uso:
  python scripts/extrair_exterior_1989_pdf.py --turno 1
  python scripts/extrair_exterior_1989_pdf.py --turno 2 --paginas 372
"""

import argparse
import csv
import difflib
import io
import os
import re
import sys
import unicodedata

import fitz
import pytesseract
from PIL import Image

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_DIR = os.path.join(BASE_DIR, 'ex_94_89')
SAIDA_DIR = os.path.join(BASE_DIR, 'scripts', 'dados_exterior_1989')

FONTES = {
    1: ('00000001_-_Bloco_III.pdf', range(132, 147)),
    2: ('EXTERIOR_2T_1_240117_110535.pdf', range(372, 378)),
}

# Fronteiras das tres colunas, em fracao da largura da pagina. Medidas nas
# coordenadas do proprio OCR: os rotulos comecam em x ~ 100, 845 e 1595 numa
# pagina de 2480 px.
CORTES = (0.33, 0.633)

RESUMO = ('ELEITORADO', 'SECOES', 'ABSTENCOES', 'VOTANTES', 'BRANCOS', 'NULOS',
          'VOTOS VALIDOS')

# Os 22 nomes de urna como o boletim os abrevia. Fixar a lista e o que impede o
# OCR de inventar candidato: "MARIO CovAS", "AFIF °" e ".MALUF" sao a mesma
# pessoa lida tres vezes, e sem normalizar viravam tres linhas que inflavam a
# soma do pais.
CANDIDATOS = ('LULA', 'MARRONZINHO', 'ZAMIR', 'AFIF', 'R. FREIRE', 'PG', 'AURELIANO',
              'BRIZOLA', 'GABEIRA', 'PEDREIRA', 'MANOEL HORTA', 'CORREA', 'CELSO BRANT',
              'MALUF', 'MARIO COVAS', 'LIVIA MARIA', 'COLLOR', 'A. CAMARGO', 'ENEAS',
              'ULYSSES', 'R. CAIADO', 'EUDES')

# Rodape das paginas do boletim, que o detector de pais confundiria com um.
# Rodape e cabecalho das paginas do boletim, que o detector de pais confundiria
# com um. Entram por prefixo porque o OCR come letras do carimbo ("TRIBUNAL SUSE").
NAO_E_PAIS = ('TRIBUNAL', 'BIBLIOTEC', 'EXTERIOR', 'TURNO', 'ELEICOES', 'SUPERIOR')
# O OCR troca zero por O, o, Q, ©, @, D, U (e combinacoes); o ponto e separador
# de milhar. Nenhum dos dois aparece em numero legitimo do boletim.
DIGITOS = str.maketrans({'O': '0', 'o': '0', 'Q': '0', '©': '0', '@': '0',
                         'D': '0', 'U': '0', 'l': '1', 'I': '1', '.': ''})


def sem_acento(texto):
    return ''.join(c for c in unicodedata.normalize('NFD', str(texto))
                   if unicodedata.category(c) != 'Mn')


def numero(bruto):
    # Virgula e % marcam percentual, nunca contagem de voto: o boletim so usa
    # ponto, como separador de milhar. Sem esta recusa, um percentual que
    # escapasse do PCT_FINAL virava numero de votos ("99,00%" -> 9900).
    bruto = str(bruto)
    if ',' in bruto or '%' in bruto or not TOKEN_NUMERO.match(bruto):
        return None
    limpo = re.sub(r'[^0-9OoQ©@DUlI]', '', bruto).translate(DIGITOS)
    return int(limpo) if limpo.isdigit() else None


def percentual(bruto):
    achado = re.search(r'(\d{1,3})[,.](\d{2})', str(bruto))
    return float(f'{achado.group(1)}.{achado.group(2)}') if achado else None


def linhas_ocr(pdf, pagina, dpi=300):
    """[(largura, [(x, palavra), ...]), ...] -- uma entrada por linha impressa."""
    doc = fitz.open(pdf)
    pixmap = doc[pagina - 1].get_pixmap(dpi=dpi)
    doc.close()
    imagem = Image.open(io.BytesIO(pixmap.tobytes('png')))
    dados = pytesseract.image_to_data(
        imagem, config='--psm 6 -c preserve_interword_spaces=1',
        output_type=pytesseract.Output.DICT)

    agrupadas = {}
    for i, texto in enumerate(dados['text']):
        texto = texto.strip()
        if not texto:
            continue
        chave = (dados['block_num'][i], dados['par_num'][i], dados['line_num'][i])
        agrupadas.setdefault(chave, []).append((dados['left'][i], sem_acento(texto)))
    return imagem.size[0], [sorted(v) for _, v in sorted(agrupadas.items())]


# Um token so e numero se for feito de digito, de sosia de zero (O, o, Q, ©, @, D,
# U) e de pontuacao. Sem esta exigencia, "HORTA" virava o numero 0 -- o O do meio
# passava pelo filtro -- e a linha inteira do candidato se perdia.
TOKEN_NUMERO = re.compile(r"^[0-9OoQ©@DUlI()\[\]{}.,;:°'`_-]+$")

# Percentual quebrado em dois tokens pelo OCR ("0," + "76%"). Precisa ser juntado
# antes de qualquer leitura: sem isso o "76" era tomado como o numero de votos e
# a Grecia fechava com 76 votos em Marronzinho, no lugar de 1.
PCT_PARTIDO = re.compile(r'(?<=[0-9])\s*,\s*(?=[0-9]{1,2}\s*%)')
PCT_FINAL = re.compile(r'([0-9]{1,3},[0-9]{2})\s*%[^0-9]*$')
SO_PONTOS = re.compile(r"^[.,;:_'`’·-]+$")


def celula(tokens):
    """Tokens de uma coluna -> (rotulo, valor|None, pct|None).

    O numero e o token imediatamente antes do percentual -- por POSICAO, e nao
    por ser legivel. Quando o OCR o estraga ("MANOEL HORTA . j 0,10%"), o valor
    volta None e quem o reconstitui e o percentual, na conferencia. Buscar o
    ultimo token legivel, como antes, fazia a leitura recuar para dentro do nome
    e inventar um zero.
    """
    if len(tokens) < 2:
        return None
    texto = PCT_PARTIDO.sub(',', ' '.join(t for _, t in tokens))
    texto = re.sub(r'\s+%', '%', texto)

    pct = None
    achado = PCT_FINAL.search(texto)
    if achado:
        pct = percentual(achado.group(1))
        texto = texto[:achado.start()]

    corpo = texto.split()
    while corpo and SO_PONTOS.match(corpo[-1]):
        corpo.pop()
    if not corpo:
        return None

    valor = numero(corpo[-1])
    if valor is None and pct is None:
        # Sem percentual, so o numero identifica a celula: e o caso da coluna do
        # resumo (ELEITORADO, SECOES). Ilegivel dos dois lados, nao ha o que ler.
        for i in range(len(corpo) - 1, -1, -1):
            valor = numero(corpo[i])
            if valor is not None:
                corpo = corpo[:i + 1]
                break
        if valor is None:
            return None

    rotulo = ' '.join(p for p in corpo[:-1] if not SO_PONTOS.match(p))
    rotulo = re.sub(r"[.,;:_'`·-]+$", '', rotulo).strip()
    return (rotulo, valor, pct) if rotulo else None


def canonico(rotulo, opcoes, corte=0.75):
    """Rotulo lido pelo OCR -> o nome oficial mais parecido, ou None.

    Duas tolerancias, cada uma para um jeito de o OCR estragar o rotulo:

      lixo grudado no fim  "NULOS sete reese", "PG ........0e" -- por isso o
                           comeco do rotulo tambem e testado, truncado no
                           tamanho de cada nome oficial;
      comeco comido        "COVAS" por "MARIO COVAS" -- por isso vale tambem o
                           rotulo ser o final de um nome oficial.

    Rotulo de ate tres letras nao entra na semelhanca: com tao pouca letra
    qualquer coisa passa do corte, e "PG" viraria "PEDREIRA".
    """
    alvo = re.sub(r'[^A-Z]', '', rotulo.upper())
    if not alvo:
        return None
    limpos = {re.sub(r'[^A-Z]', '', o): o for o in opcoes}
    if alvo in limpos:
        return limpos[alvo]
    if len(alvo) < 4:
        return None

    melhor, nota = None, 0.0
    for limpo, oficial in limpos.items():
        if len(limpo) < 4:
            continue
        if len(alvo) >= 5 and limpo.endswith(alvo):
            return oficial
        for teste in {alvo, alvo[:len(limpo)]}:
            r = difflib.SequenceMatcher(None, teste, limpo).ratio()
            if r > nota:
                melhor, nota = oficial, r
    return melhor if nota >= corte else None


def cabecalho_pais(tokens, largura, manuais=None):
    """Nome do pais, se a linha for o titulo de um bloco.

    O sinal decisivo e a POSICAO: o nome vem centrado (x ~ 1050 de 2480) e as
    linhas de dados comecam na margem (x ~ 100). So o texto nao basta -- o OCR
    encosta sujeira da coluna vizinha no titulo ("AUSTRIA 13", "BELGICA : ;") e
    qualquer casamento exato de letras deixava o bloco inteiro cair no pais
    anterior, dobrando os votos dele.
    """
    # Respingo de pontuacao solta ao redor do titulo ("BANGLADESH . - - .") nao
    # conta como palavra: contando, o limite de tokens rejeitava o cabecalho e o
    # bloco seguinte caia no pais anterior.
    if manuais:
        bruto = ' '.join(t for _, t in tokens).strip(" .,;:-'").upper()
        if bruto in manuais:
            return manuais[bruto]
    uteis = [(x, t) for x, t in tokens
             if not re.fullmatch(r"[.,;:_'`|‘’“”·•«»-]+", t)]
    if not uteis or uteis[0][0] < 0.25 * largura or len(uteis) > 4:
        return None
    palavras = [t for _, t in uteis]
    nome = []
    for palavra in palavras:
        # O OCR gruda pontuacao no nome ("-CHINA", "COSTA."); sem limpar as
        # pontas, o titulo era rejeitado e o bloco caia no pais anterior.
        limpa = re.sub(r"^[^A-Z]+", '', re.sub(r"[^A-Z')]+$", '', palavra))
        if len(limpa) >= 2 and re.fullmatch(r"[A-Z][A-Z'()-]*", limpa):
            nome.append(limpa)
        else:
            break
    if not nome or len(nome[0]) < 3:
        return None
    # Depois do nome so pode sobrar respingo curto (um numero de coluna vizinha,
    # dois sinais de pontuacao); palavra de verdade ali significa outra coisa.
    sobra = palavras[len(nome):]
    if any(len(s) > 3 for s in sobra):
        return None
    junto = ' '.join(nome)
    if junto in RESUMO or junto in CANDIDATOS:
        return None
    if any(marca in junto for marca in NAO_E_PAIS):
        return None
    return junto


def parse_pagina(largura, linhas, pagina, candidatos, desconhecidos, cabecalhos):
    paises = {}
    atual = None
    nome_atual = '?'
    limites = (largura * CORTES[0], largura * CORTES[1])

    for tokens in linhas:
        palavras = [t for _, t in tokens]
        pais = cabecalho_pais(tokens, largura, cabecalhos)
        if pais:
            nome_atual = pais
            atual = paises.setdefault(pais, {'resumo': {}, 'votos': {}, 'pagina': pagina})
            continue
        if atual is None:
            continue

        bandas = ([], [], [])
        for x, palavra in tokens:
            bandas[0 if x < limites[0] else 1 if x < limites[1] else 2].append((x, palavra))

        for banda in bandas:
            lido = celula(banda)
            if not lido:
                continue
            rotulo, valor, pct = lido
            resumo = proximo_do_resumo(rotulo)
            if resumo:
                atual['resumo'][resumo] = (valor, pct)
                continue
            nome = canonico(rotulo, candidatos)
            if not nome:
                desconhecidos.append(f'{nome_atual} (p{pagina}): rotulo "{rotulo}" '
                                     f'= {valor} nao e candidato conhecido')
                continue
            # O OCR pode ler o mesmo candidato duas vezes (uma com sujeira grudada
            # no nome). Guarda as duas leituras e deixa a conferencia escolher:
            # entrar com as duas dobrava o total do pais.
            if nome in atual['votos']:
                atual.setdefault('duplicados', {}).setdefault(nome, []).append((valor, pct))
            else:
                atual['votos'][nome] = (valor, pct)

    return paises


def proximo_do_resumo(rotulo):
    """Rotulo do resumo, tolerando caixa e letra trocada pelo OCR.

    "VOTOS VALIDOS" chega como "voTos VALIbDOS", com letra a mais: comparar
    posicao a posicao nao serve, por isso a semelhanca por sequencia.
    """
    return canonico(rotulo, RESUMO, corte=0.78)


def bate(valor, pct, base):
    return base > 0 and pct is not None and abs(round(valor * 100 / base, 2) - pct) <= 0.02


def resolver_duplicados(pais, dados, problemas):
    """Escolhe, entre as leituras repetidas do mesmo candidato, a que fecha.

    O criterio e o percentual impresso ao lado do numero: das duas leituras, so
    uma costuma reproduzi-lo. Quando nenhuma reproduz, fica a maior e o caso vai
    para a lista de conferir no papel -- adivinhar aqui seria pior que apontar.
    """
    validos = dados['resumo'].get('VOTOS VALIDOS', (None, None))[0]
    for nome, extras in dados.pop('duplicados', {}).items():
        opcoes = [dados['votos'][nome]] + extras
        boas = [(v, p) for v, p in opcoes if validos and bate(v, p, validos)]
        if len(boas) == 1:
            dados['votos'][nome] = boas[0]
            continue
        dados['votos'][nome] = max(opcoes, key=lambda vp: vp[0])
        problemas.append(f'{pais} (p{dados["pagina"]}): {nome} lido {len(opcoes)}x '
                         f'({", ".join(str(v) for v, _ in opcoes)}); nenhuma leitura fecha '
                         f'com o percentual')


def recuperar_eleitorado(dados):
    """O ELEITORADO e o divisor de todo o resumo; lido errado, derruba as cinco
    linhas de uma vez. Quando isso acontece, ele e deduzido de volta a partir de
    qualquer linha do resumo cujo percentual seja utilizavel."""
    resumo = dados['resumo']
    eleitorado = resumo.get('ELEITORADO', (None, None))[0]
    if eleitorado is None:
        return
    linhas = [(v, p) for n, (v, p) in resumo.items()
              if n != 'ELEITORADO' and p is not None and p > 0 and v is not None and v > 0]
    if not linhas:
        return
    if sum(1 for v, p in linhas if bate(v, p, eleitorado)) >= max(2, len(linhas) - 1):
        return  # o eleitorado lido explica o resumo; nada a fazer

    for base in (round(v * 100 / p) for v, p in linhas):
        if base > 0 and sum(1 for v, p in linhas if bate(v, p, base)) >= len(linhas) - 1:
            resumo['ELEITORADO'] = (base, resumo['ELEITORADO'][1])
            return


def carregar_cabecalhos_manuais(turno):
    """Texto que o OCR devolveu -> pais, para os titulos ilegiveis."""
    caminho = os.path.join(SAIDA_DIR, 'correcoes_manuais_1989.csv')
    manuais = {}
    if not os.path.exists(caminho):
        return manuais
    with open(caminho, encoding='utf-8') as fh:
        for linha in fh:
            partes = linha.strip().split(';')
            if len(partes) < 4 or not partes[0].isdigit():
                continue
            if int(partes[0]) == turno and partes[2] == '@CABECALHO':
                manuais[partes[3].upper()] = partes[1]
    return manuais


def carregar_correcoes_manuais(turno):
    """Valores conferidos a olho no boletim, onde o OCR nao fechou."""
    caminho = os.path.join(SAIDA_DIR, 'correcoes_manuais_1989.csv')
    manuais = {}
    if not os.path.exists(caminho):
        return manuais
    with open(caminho, encoding='utf-8') as fh:
        for linha in fh:
            linha = linha.strip()
            if not linha or linha.startswith('#'):
                continue
            partes = linha.split(';')
            if len(partes) < 4 or int(partes[0]) != turno or partes[2] == '@CABECALHO':
                continue
            manuais.setdefault(partes[1], {})[partes[2]] = int(partes[3])
    return manuais


def aplicar_correcoes_manuais(pais, dados, manuais, correcoes):
    for chave, valor in manuais.get(pais, {}).items():
        if chave.startswith('#'):
            nome = chave[1:]
            antes = dados['resumo'].get(nome, (None, None))
            dados['resumo'][nome] = (valor, antes[1])
        else:
            antes = dados['votos'].get(chave, (None, None))
            dados['votos'][chave] = (valor, antes[1])
        correcoes.append(f'{pais} (p{dados["pagina"]}): {chave} {antes[0]} -> {valor} '
                         f'(conferido no papel)')


def resumo_fecha_sozinho(resumo):
    """VOTANTES = BRANCOS + NULOS + VOTOS VALIDOS.

    Identidade do proprio boletim, independente dos percentuais. Quando ela
    fecha, os numeros do resumo estao certos e um percentual divergente e erro
    de OCR no percentual -- foi o caso do Canada (1,31% lido como 1,81%) e da
    Costa Rica (1,28% lido como 41,28%).
    """
    try:
        votantes = resumo['VOTANTES'][0]
        return votantes == (resumo['BRANCOS'][0] + resumo['NULOS'][0]
                            + resumo['VOTOS VALIDOS'][0])
    except (KeyError, TypeError):
        return False


def reconstituir_valores(pais, dados, validos, correcoes, problemas):
    """Preenche o numero que o OCR nao conseguiu ler, a partir do percentual.

    A celula sabe onde o numero esta (posicao), mesmo quando nao consegue le-lo
    ("MANOEL HORTA . j 0,10%"). Nesses casos o percentual impresso ao lado ainda
    esta legivel e determina o valor -- so ele multiplicado pelos votos validos.
    """
    for nome, (valor, pct) in sorted(dados['votos'].items()):
        if valor is not None:
            continue
        if pct is None or not validos:
            problemas.append(f'{pais} (p{dados["pagina"]}): {nome} sem numero e sem '
                             f'percentual legiveis')
            dados['votos'][nome] = (0, pct)
            continue
        deduzido = round(pct * validos / 100)
        dados['votos'][nome] = (deduzido, pct)
        correcoes.append(f'{pais} (p{dados["pagina"]}): {nome} ilegivel -> {deduzido} '
                         f'(pelo percentual impresso, {pct:.2f}%)')

    for nome, (valor, pct) in list(dados['resumo'].items()):
        if valor is None:
            dados['resumo'].pop(nome)


def fechar_pelo_residuo(pais, dados, correcoes):
    """Um unico candidato sem percentual: o valor dele e o que falta para os validos.

    Quando o OCR perde o percentual de uma celula, o numero ao lado dela fica sem
    conferencia -- e e justamente ali que aparecem os erros que sobram (Peru com
    "ULYSSES 40" no lugar de 1). Se todos os outros candidatos fecham com o
    percentual impresso, o que falta para os votos validos e, por definicao, o
    valor do que ficou sem. Vale so com UM sem percentual: com dois, a divisao
    entre eles seria chute.
    """
    validos = dados['resumo'].get('VOTOS VALIDOS', (None, None))[0]
    if not validos:
        return
    sem_pct = [n for n, (_, p) in dados['votos'].items() if p is None]
    if len(sem_pct) != 1:
        return
    com_pct = [(v, p) for n, (v, p) in dados['votos'].items() if p is not None]
    if not all(bate(v, p, validos) for v, p in com_pct):
        return

    nome = sem_pct[0]
    residuo = validos - sum(v for v, _ in com_pct)
    antigo = dados['votos'][nome][0]
    if residuo < 0 or residuo == antigo:
        return
    dados['votos'][nome] = (residuo, None)
    correcoes.append(f'{pais} (p{dados["pagina"]}): {nome} {antigo} -> {residuo} '
                     f'(unico sem percentual; e o que falta para os {validos} validos)')


def conferir_resumo(pais, dados, problemas, correcoes, pct_suspeito):
    """Confere a coluna do resumo do pais. Roda ANTES dos candidatos.

    VOTOS VALIDOS e o divisor de todo percentual de candidato: conferi-lo depois
    deles fazia um erro dele condenar os candidatos certos. Foi o que aconteceu
    nos Estados Unidos do 2o turno, onde "1.495" saiu do OCR como "4495" e levou
    Lula e Collor a serem 'corrigidos' de 835 e 660 para 2510 e 1985.
    """
    pagina = dados['pagina']
    resumo = dados['resumo']
    eleitorado = resumo.get('ELEITORADO', (None, None))[0]
    fechado = resumo_fecha_sozinho(resumo)
    if not eleitorado:
        return

    for nome in ('ABSTENCOES', 'VOTANTES', 'BRANCOS', 'NULOS', 'VOTOS VALIDOS'):
        valor, pct = resumo.get(nome, (None, None))
        if valor is None or pct is None or bate(valor, pct, eleitorado):
            continue
        if fechado:
            pct_suspeito.append(f'{pais} (p{pagina}): {nome} = {valor} '
                                f'({valor * 100 / eleitorado:.2f}%), '
                                f'boletim imprime {pct:.2f}%')
            continue
        deduzido = round(pct * eleitorado / 100)
        if bate(deduzido, pct, eleitorado) and deduzido != valor:
            resumo[nome] = (deduzido, pct)
            correcoes.append(f'{pais} (p{pagina}): {nome} {valor} -> {deduzido}')
        else:
            problemas.append(f'{pais} (p{pagina}): {nome} = {valor} daria '
                             f'{valor * 100 / eleitorado:.2f}%, boletim diz {pct:.2f}%')


def conferir_e_corrigir(pais, dados, problemas, correcoes, pct_suspeito, manuais):
    """Confere os numeros do pais contra as provas que o proprio boletim traz.

    Sao tres, em ordem de forca:

      a identidade do resumo   VOTANTES = BRANCOS + NULOS + VALIDOS, exata e
                               independente de qualquer percentual;
      a soma dos candidatos    tem de dar os votos validos, tambem exata e
                               valida para o bloco inteiro;
      o percentual impresso    ao lado de cada numero, que so vale um numero de
                               cada vez e e o que o OCR mais estraga.

    Por isso a soma decide antes do percentual: se ela ja fecha, um percentual
    divergente e erro de leitura DELE, e nao do numero ao lado.
    """
    pagina = dados['pagina']
    aplicar_correcoes_manuais(pais, dados, manuais, correcoes)
    recuperar_eleitorado(dados)
    conferir_resumo(pais, dados, problemas, correcoes, pct_suspeito)

    validos = dados['resumo'].get('VOTOS VALIDOS', (None, None))[0]
    if validos is None:
        problemas.append(f'{pais} (p{pagina}): sem VOTOS VALIDOS')
        return False

    reconstituir_valores(pais, dados, validos, correcoes, problemas)
    resolver_duplicados(pais, dados, problemas)
    fechar_pelo_residuo(pais, dados, correcoes)

    def soma_votos():
        return sum(v for v, _ in dados['votos'].values())

    divergentes = [(n, v, p) for n, (v, p) in sorted(dados['votos'].items())
                   if p is not None and not bate(v, p, validos)]

    # A soma e prova mais forte que o percentual: ela vale para o bloco inteiro e
    # e exata. Se ja fecha com o que o OCR leu, nao ha o que reparar -- foi o caso
    # da Franca, onde "MALUF 17 / 1,96%" saiu com o percentual lido como 4,96% e
    # reparar o numero para 43 quebrava um bloco que estava certo.
    if soma_votos() == validos:
        for nome, valor, pct in divergentes:
            pct_suspeito.append(f'{pais} (p{pagina}): {nome} = {valor} '
                                f'({valor * 100 / validos:.2f}%), boletim imprime {pct:.2f}%')
        return True

    aplicadas, sobraram = [], []
    for nome, valor, pct in divergentes:
        deduzido = round(pct * validos / 100)
        if bate(deduzido, pct, validos) and deduzido != valor:
            dados['votos'][nome] = (deduzido, pct)
            aplicadas.append((nome, (valor, pct), deduzido))
        else:
            sobraram.append((nome, valor, pct))

    # Uma correcao que fecha a soma sozinha sendo desfeita e sinal de que ela era
    # a errada: o numero do OCR estava certo e quem saiu torto foi o percentual.
    if soma_votos() != validos:
        for nome, antes, depois in aplicadas:
            dados['votos'][nome] = antes
            if soma_votos() == validos:
                aplicadas.remove((nome, antes, depois))
                sobraram.append((nome, antes[0], antes[1]))
                break
            dados['votos'][nome] = (depois, antes[1])

    for nome, antes, depois in aplicadas:
        correcoes.append(f'{pais} (p{pagina}): {nome} {antes[0]} -> {depois} '
                         f'(percentual impresso {antes[1]:.2f}%)')

    soma = soma_votos()
    for nome, valor, pct in sobraram:
        destino = pct_suspeito if soma == validos else problemas
        destino.append(f'{pais} (p{pagina}): {nome} = {valor} '
                       f'({valor * 100 / validos:.2f}%), boletim imprime {pct:.2f}%')
    if soma != validos:
        problemas.append(f'SOMA {pais} (p{pagina}): candidatos somam {soma}, '
                         f'boletim diz {validos} validos')

    return not any(p.startswith(pais + ' ') or p.startswith('SOMA ' + pais + ' ')
                   for p in problemas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--turno', type=int, choices=(1, 2), required=True)
    ap.add_argument('--paginas', nargs='*', type=int)
    args = ap.parse_args()

    arquivo, paginas = FONTES[args.turno]
    paginas = args.paginas or list(paginas)
    pdf = os.path.join(PDF_DIR, arquivo)

    problemas, correcoes, pct_suspeito, desconhecidos, todos = [], [], [], [], {}
    manuais = carregar_correcoes_manuais(args.turno)
    cabecalhos = carregar_cabecalhos_manuais(args.turno)
    for pagina in paginas:
        print(f'  OCR pagina {pagina}...', flush=True)
        largura, linhas = linhas_ocr(pdf, pagina)
        candidatos = CANDIDATOS if args.turno == 1 else ('LULA', 'COLLOR')
        for pais, dados in parse_pagina(largura, linhas, pagina, candidatos,
                                        desconhecidos, cabecalhos).items():
            if pais in todos:
                problemas.append(f'{pais} aparece em duas paginas '
                                 f'({todos[pais]["pagina"]} e {pagina})')
            todos[pais] = dados

    fechados = sum(1 for pais, d in sorted(todos.items())
                   if conferir_e_corrigir(pais, d, problemas, correcoes,
                                          pct_suspeito, manuais))

    os.makedirs(SAIDA_DIR, exist_ok=True)
    destino = os.path.join(SAIDA_DIR, f'exterior_1989_t{args.turno}.csv')
    with open(destino, 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, delimiter=';')
        w.writerow(['pais', 'pagina', 'chave', 'votos', 'pct_impresso'])
        for pais, dados in sorted(todos.items()):
            for nome in RESUMO:
                if nome in dados['resumo']:
                    v, pct = dados['resumo'][nome]
                    w.writerow([pais, dados['pagina'], f'#{nome}', v,
                                '' if pct is None else f'{pct:.2f}'])
            for nome, (v, pct) in sorted(dados['votos'].items(), key=lambda kv: -kv[1][0]):
                w.writerow([pais, dados['pagina'], nome, v,
                            '' if pct is None else f'{pct:.2f}'])

    somas = [p for p in problemas if p.startswith('SOMA')]
    erros = [p for p in problemas if not p.startswith('SOMA')]
    print(f'\n{len(todos)} paises; {fechados} com todo percentual fechando.')
    if correcoes:
        print(f'\n{len(correcoes)} numero(s) recuperados pelo percentual impresso:')
        for c in correcoes:
            print('  ~', c)
    if desconhecidos:
        print(f'{len(desconhecidos)} rotulo(s) que o OCR nao encaixou em candidato:')
        for d in desconhecidos:
            print('  -', d)
    if pct_suspeito:
        print(f'\n{len(pct_suspeito)} percentual(is) mal lidos pelo OCR '
              f'-- a soma do pais fecha, entao quem vale e o numero:')
        for c in pct_suspeito:
            print('  ?', c)
    if somas:
        print(f'\n{len(somas)} pais(es) em que a soma nao fecha:')
        for p in somas:
            print('  !', p)
    if erros:
        print(f'\n{len(erros)} pendencia(s) para conferir no papel:')
        for p in erros:
            print('  *', p)
    print(f'\nCSV: {destino}')
    return 1 if erros or somas else 0


if __name__ == '__main__':
    sys.exit(main())
