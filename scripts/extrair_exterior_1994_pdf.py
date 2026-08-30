"""Le o voto no exterior de 1994 do relatorio digitalizado do TSE.

Como 1989, 1994 nao tem arquivo eletronico do exterior: o que existe e o
"RESULTADO PARCIAL POR CANDIDATO" impresso pela Secretaria de Informatica do TSE
(EL1463RE), digitalizado. Ele e bem mais facil de ler que o boletim de 1989 --
traz o CODIGO TSE do pais e o NUMERO do candidato, que sao exatamente as chaves
que o resto do acervo usa, sem precisar casar nome nenhum.

  paginas 5-26: um bloco por pais, com os 8 candidatos a presidente
  pagina 2: o total do exterior, que serve de conferencia final

CONFERENCIA
-----------
Cada bloco fecha duas vezes: a soma dos candidatos tem de dar os "Votos
Nominais" impressos, e cada voto dividido por esse total tem de dar o percentual
"Validos" impresso ao lado. Onde as duas discordam, manda a soma -- ela e exata
e vale para o bloco inteiro, enquanto o percentual vale um numero de cada vez.

Uso:
  python scripts/extrair_exterior_1994_pdf.py
  python scripts/extrair_exterior_1994_pdf.py --paginas 5 6
"""

import argparse
import csv
import os
import re
import sys
import unicodedata

import fitz
import pytesseract
from PIL import Image
import io as _io

pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(BASE_DIR, 'ex_94_89', 'EXTERIOR_240304_231941.pdf')
SAIDA_DIR = os.path.join(BASE_DIR, 'scripts', 'dados_exterior_1989')
PAGINAS = range(5, 27)

# Totais do exterior impressos na pagina 2 do relatorio.
TOTAL_NOMINAIS, TOTAL_BRANCOS, TOTAL_NULOS = 26698, 260, 873

# O rotulo "Pais:" sai do OCR como "(Pais:", "pass:" ou "pals:"; o que nunca
# falha e a forma "<codigo> - <NOME> ... Aptos", entao a ancora e o Aptos.
# Na camada de texto o cabecalho vem junto com a linha do Aptos, e o traco entre
# o codigo e o nome nem sempre esta la.
PAIS = re.compile(r'[Pp]ais\s*[:;]\s*(\d{4,5})\s*[-~=]?\s*([A-Za-z][A-Za-z .]+?)(?:\s+Aptos|\s*$)')
# A linha do candidato comeca com o numero de urna, mas vem precedida do lixo da
# margem perfurada ("| @   45 FERNANDO..."), por isso search e nao match. O
# numero pode sair como letra ("il" por 11) e o percentual, com espaco antes da
# virgula ("64 ,29%").
CANDIDATO = re.compile(r'(?:^|\s)([0-9lIiOo]{2})\s+([A-Z][A-Z ]{6,}?)\s+'
                       r'([\d.()]+)\s+(\d{1,3}[\s,.]+\d{2})\s*%\s+'
                       r'(\d{1,3}[\s,.]+\d{2})\s*%')
NOMINAIS = re.compile(r'N[o0]minais\D+([\d.()]+)')
BRANCOS = re.compile(r'Brancos\D+([\d.()]+)')
NULOS = re.compile(r'Nu[l1]os\D+([\d.()]+)')
# Relatorio de comparecimento (paginas 3-4): "11100-ALEMANHA  2921  1826 62.51%"
COMPARECIMENTO = re.compile(r'(\d{4,5})\s*[-~=—–−]+\s*([A-Z][A-Z .]+?)\s+'
                            r'([\d.]+)\s+([\d.]+)\s+\d{1,3}[\s,.]+\d{2}\s*%')


def sem_acento(t):
    return ''.join(c for c in unicodedata.normalize('NFD', str(t))
                   if unicodedata.category(c) != 'Mn')


def inteiro(bruto):
    # Numero entre parenteses e zero mal digitalizado ("(6)" por "0"): o digito
    # de dentro nao e confiavel, entao o valor volta desconhecido e quem o
    # resolve e a identidade comparecimento = nominais + brancos + nulos.
    bruto = str(bruto)
    if '(' in bruto or ')' in bruto:
        return None
    # So digito e sosia de digito. Sem esta recusa, "LULA" virava o numero 1 (o L
    # vira 1) e passava a ser lido como a quantidade de votos.
    if not re.fullmatch(r"[0-9OolI.,;:%'-]+", bruto):
        return None
    limpo = re.sub(r'[^0-9]', '', bruto.replace('O', '0').replace('o', '0')
                   .replace('l', '1').replace('I', '1'))
    return int(limpo) if limpo else None


def numero_urna(bruto):
    return re.sub(r'[lIi]', '1', re.sub(r'[Oo]', '0', str(bruto)))


def pct(bruto):
    achado = re.search(r'(\d{1,3})[\s,.]+(\d{2})', str(bruto))
    return float(f'{achado.group(1)}.{achado.group(2)}') if achado else None


def texto_pagina(pagina):
    quebra = chr(10)
    return sem_acento(quebra.join(' '.join(l) for l in linhas_pagina(pagina)))


def linhas_pagina(pagina, tolerancia=5.0):
    """[[palavra, ...], ...] -- uma lista de palavras por linha impressa.

    O PDF de 1994 JA TEM camada de texto, e ela e exata -- diferente do boletim
    de 1989, que e imagem pura. O que ela nao tem e ordem de leitura: as palavras
    saem embaralhadas entre as colunas. Reagrupa-las pela coordenada vertical
    reconstitui a linha impressa, e dispensa passar o tesseract por cima (que
    reintroduziria erro num dado que ja esta certo).
    """
    doc = fitz.open(PDF)
    palavras = doc[pagina - 1].get_text('words')
    doc.close()

    linhas = []
    for x0, y0, x1, y1, palavra, *_ in sorted(palavras, key=lambda p: (p[1], p[0])):
        centro = (y0 + y1) / 2
        if linhas and abs(linhas[-1][0] - centro) <= tolerancia:
            linhas[-1][1].append((x0, palavra))
        else:
            linhas.append((centro, [(x0, palavra)]))
    return [[p for _, p in sorted(itens)] for _, itens in linhas]


def parse_comparecimento(paginas=(3, 4)):
    """Relatorio de acompanhamento por pais -> {codigo: (aptos, comparecimento)}.

    Segunda prova de cada bloco: comparecimento = nominais + brancos + nulos.
    E o que permite recuperar um branco ou um nulo que nao foi lido.
    """
    tabela = {}
    for pagina in paginas:
        for achado in COMPARECIMENTO.finditer(texto_pagina(pagina)):
            aptos, comparec = inteiro(achado.group(3)), inteiro(achado.group(4))
            if aptos is not None and comparec is not None:
                tabela[int(achado.group(1))] = (aptos, comparec)
    return tabela


def _abre_candidato(palavras, i):
    """(numero, indice_do_nome) se a posicao i abre uma linha de candidato.

    Duas armadilhas do texto do PDF, as duas vistas na Guiana e na Guiana
    Francesa: o numero as vezes vem partido em dois tokens ("4" "5" por 45), e a
    sujeira da margem pode ela mesma parecer um numero ("II" vira 11 e roubava a
    linha do candidato 20). Exigir que logo depois do numero venha o NOME
    resolve as duas.
    """
    def nome_em(j):
        return j < len(palavras) and re.fullmatch(r"[A-Za-z.']{2,}", palavras[j])

    numero = numero_urna(palavras[i])
    if re.fullmatch(r'\d{2}', numero) and nome_em(i + 1):
        return numero, i + 1
    if (re.fullmatch(r'\d', numero) and i + 1 < len(palavras)
            and re.fullmatch(r'\d', numero_urna(palavras[i + 1])) and nome_em(i + 2)):
        return numero + numero_urna(palavras[i + 1]), i + 2
    return None


def ler_linha_candidato(palavras):
    """[numero, NOME..., votos, %comparec, %validos] -> (numero, votos, %validos).

    Le por POSICAO e ignora o percentual do meio. Ele nao serve para nada aqui e
    era o que derrubava a linha: sai do PDF com tres decimais ("47 ,902%"), com
    letra no meio ("8B, 33%") ou sem o proprio %, e qualquer regra que dependesse
    dele perdia a linha inteira -- inclusive a de Lula nos Estados Unidos, 2.055
    votos.

    Regra: o numero de votos e o primeiro inteiro depois do nome; o percentual
    que interessa e o ultimo da linha, e so vale se houver dois % (com um so, nao
    da para saber se o que sobrou e o de comparecimento ou o de validos).
    """
    if len(palavras) < 4:
        return None
    abertura = next((a for a in (_abre_candidato(palavras, i)
                                 for i in range(min(4, len(palavras) - 3))) if a), None)
    if abertura is None:
        return None
    numero, inicio_nome = abertura

    resto = palavras[inicio_nome:]
    primeiro_pct = next((i for i, t in enumerate(resto) if '%' in t), None)
    if primeiro_pct is None:
        return None
    inteiros = [v for v in (inteiro(t) for t in resto[:primeiro_pct]) if v is not None]
    if not inteiros:
        return None

    cauda = ' '.join(resto[primeiro_pct:])
    achados = re.findall(r'(\d{1,3})[\s,.]+(\d{2})', cauda)
    validos = float(f'{achados[-1][0]}.{achados[-1][1]}') if len(achados) >= 2 else None
    return numero, inteiros[0], validos


def parse_paginas(paginas):
    """Le as paginas como UM fluxo: o bloco de um pais atravessa a virada de
    pagina -- cabecalho no pe de uma, "Votos Nominais" no topo da seguinte."""
    blocos, atual = {}, None
    for pagina in paginas:
        print(f'  OCR pagina {pagina}...', flush=True)
        for palavras in linhas_pagina(pagina):
            linha = ' '.join(palavras)
            achado = PAIS.search(linha)
            if achado:
                codigo = int(achado.group(1))
                atual = blocos.setdefault(codigo, {
                    'codigo': codigo, 'nome': achado.group(2).strip(' .'),
                    'votos': {}, 'nominais': None, 'brancos': None, 'nulos': None,
                    'pagina': pagina})
                continue
            if atual is None:
                continue

            campo = ('nominais' if NOMINAIS.search(linha) else
                     'brancos' if BRANCOS.search(linha) else
                     'nulos' if NULOS.search(linha) else None)
            if campo:
                # O valor e o ultimo token numerico da linha ("Votos Nominais...
                # 1.744  100%" tem o 100% depois, que nao entra).
                for token in reversed(palavras):
                    if '%' in token:
                        continue
                    valor = inteiro(token)
                    if valor is not None:
                        if atual[campo] is None:
                            atual[campo] = valor
                        break
                continue

            lido = ler_linha_candidato(palavras)
            if lido and lido[0] not in atual['votos']:
                atual['votos'][lido[0]] = (lido[1], lido[2])
    return blocos


def carregar_correcoes_manuais():
    """Valores conferidos a olho no relatorio, e paises a excluir.

    Devolve ({codigo: {numero: votos}}, {codigos a excluir}).
    """
    caminho = os.path.join(SAIDA_DIR, 'correcoes_manuais_1994.csv')
    manuais, excluir = {}, set()
    if not os.path.exists(caminho):
        return manuais, excluir
    with open(caminho, encoding='utf-8') as fh:
        for linha in fh:
            partes = linha.strip().split(';')
            if len(partes) < 3 or not partes[0].isdigit():
                continue
            codigo = int(partes[0])
            if partes[1] == '@EXCLUIR':
                excluir.add(codigo)
            else:
                manuais.setdefault(codigo, {})[partes[1]] = int(partes[2])
    return manuais, excluir


def aplicar_correcoes_manuais(bloco, manuais, correcoes):
    for numero, valor in manuais.get(bloco['codigo'], {}).items():
        antes = bloco['votos'].get(numero, (None, None))
        bloco['votos'][numero] = (valor, antes[1])
        correcoes.append(f"{bloco['nome']} ({bloco['codigo']}): candidato {numero} "
                         f"{antes[0]} -> {valor} (conferido no papel)")


def nominais_pela_soma(bloco, correcoes):
    """Sem a linha "Votos Nominais", o total e a soma dos candidatos.

    Acontece quando a linha se perde na digitalizacao (Egito). Nao e chute: a
    conferencia seguinte, contra o comparecimento do relatorio de paises, tem de
    fechar do mesmo jeito."""
    if bloco['nominais'] is not None or not bloco['votos']:
        return
    bloco['nominais'] = sum(v for v, _ in bloco['votos'].values() if v is not None)
    correcoes.append(f"{bloco['nome']} ({bloco['codigo']}): sem a linha de nominais; "
                     f"vale a soma dos candidatos ({bloco['nominais']})")


def fechar_pelo_comparecimento(bloco, comparec, correcoes):
    """comparecimento = nominais + brancos + nulos. Um desconhecido se resolve."""
    if comparec is None:
        return
    campos = {'nominais': bloco['nominais'], 'brancos': bloco['brancos'],
              'nulos': bloco['nulos']}
    faltando = [k for k, v in campos.items() if v is None]
    if len(faltando) != 1:
        return
    alvo = faltando[0]
    residuo = comparec - sum(v for v in campos.values() if v is not None)
    if residuo < 0:
        return
    bloco[alvo] = residuo
    correcoes.append(f"{bloco['nome']} ({bloco['codigo']}): {alvo} ilegivel -> {residuo} "
                     f"(comparecimento {comparec} menos o resto)")


def conferir(bloco, problemas, correcoes, pct_suspeito):
    nome = f"{bloco['nome']} ({bloco['codigo']}, p{bloco['pagina']})"
    nominais = bloco['nominais']
    if nominais is None:
        problemas.append(f'{nome}: sem "Votos Nominais"')
        return False

    def soma():
        return sum(v for v, _ in bloco['votos'].values() if v is not None)

    divergentes = [(n, v, p) for n, (v, p) in sorted(bloco['votos'].items())
                   if p is not None and v is not None
                   and (nominais == 0 or abs(round(v * 100 / nominais, 2) - p) > 0.02)]

    # A soma fecha: os numeros estao certos e quem o OCR errou foi o percentual.
    if soma() == nominais:
        for n, v, p in divergentes:
            pct_suspeito.append(f'{nome}: candidato {n} = {v} '
                                f'({v * 100 / nominais:.2f}%), boletim imprime {p:.2f}%')
        return True

    for n, v, p in divergentes:
        deduzido = round(p * nominais / 100)
        if abs(round(deduzido * 100 / nominais, 2) - p) <= 0.02 and deduzido != v:
            bloco['votos'][n] = (deduzido, p)
            correcoes.append(f'{nome}: candidato {n} {v} -> {deduzido} '
                             f'(percentual impresso {p:.2f}%)')

    if soma() != nominais:
        problemas.append(f'SOMA {nome}: candidatos somam {soma()}, '
                         f'boletim diz {nominais} nominais')
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--paginas', nargs='*', type=int, default=list(PAGINAS))
    args = ap.parse_args()

    problemas, correcoes, pct_suspeito, blocos = [], [], [], {}
    print('  OCR do relatorio de comparecimento (paginas 3 e 4)...', flush=True)
    comparecimento = parse_comparecimento()
    blocos = parse_paginas(args.paginas)

    manuais, excluir = carregar_correcoes_manuais()
    for codigo in excluir:
        if blocos.pop(codigo, None):
            correcoes.append(f'pais {codigo} excluido: o relatorio nao lista os '
                             f'candidatos principais (ver correcoes_manuais_1994.csv)')
    for b in blocos.values():
        aplicar_correcoes_manuais(b, manuais, correcoes)
        nominais_pela_soma(b, correcoes)
        fechar_pelo_comparecimento(b, (comparecimento.get(b['codigo']) or (None, None))[1],
                                   correcoes)
    fechados = sum(1 for b in blocos.values()
                   if conferir(b, problemas, correcoes, pct_suspeito))

    os.makedirs(SAIDA_DIR, exist_ok=True)
    destino = os.path.join(SAIDA_DIR, 'exterior_1994_t1.csv')
    with open(destino, 'w', encoding='utf-8', newline='') as fh:
        w = csv.writer(fh, delimiter=';')
        w.writerow(['cd_municipio', 'pais', 'pagina', 'numero', 'votos', 'pct_impresso'])
        for codigo in sorted(blocos):
            b = blocos[codigo]
            w.writerow([codigo, b['nome'], b['pagina'], '95', b['brancos'] or 0, ''])
            w.writerow([codigo, b['nome'], b['pagina'], '96', b['nulos'] or 0, ''])
            for numero, (v, p) in sorted(b['votos'].items(), key=lambda kv: -(kv[1][0] or 0)):
                w.writerow([codigo, b['nome'], b['pagina'], numero, v,
                            '' if p is None else f'{p:.2f}'])

    nominais = sum(sum(v for v, _ in b['votos'].values() if v) for b in blocos.values())
    brancos = sum(b['brancos'] or 0 for b in blocos.values())
    nulos = sum(b['nulos'] or 0 for b in blocos.values())
    print(f'\n{len(blocos)} paises; {fechados} fechando com os votos nominais.')
    if correcoes:
        print(f'\n{len(correcoes)} numero(s) recuperados pelo percentual impresso:')
        for c in correcoes:
            print('  ~', c)
    if pct_suspeito:
        print(f'\n{len(pct_suspeito)} percentual(is) mal lidos (a soma do pais fecha):')
        for c in pct_suspeito:
            print('  ?', c)
    if problemas:
        print(f'\n{len(problemas)} pendencia(s) para conferir no papel:')
        for p in problemas:
            print('  *', p)

    # Conferencia final contra o total impresso na pagina 2 do relatorio.
    print(f'\nTotal do exterior  nominais {nominais} (boletim {TOTAL_NOMINAIS}) | '
          f'brancos {brancos} ({TOTAL_BRANCOS}) | nulos {nulos} ({TOTAL_NULOS})')
    # O Panama sai do mapa por falha da fonte, entao o total fecha menos os
    # votos dele -- o relatorio imprime 130 nominais e 1 nulo naquele pais.
    bateu = (nominais + 130, brancos, nulos + 1) == (TOTAL_NOMINAIS, TOTAL_BRANCOS,
                                                     TOTAL_NULOS)
    print('CSV:', destino)
    return 0 if bateu and not problemas else 1


if __name__ == '__main__':
    sys.exit(main())
