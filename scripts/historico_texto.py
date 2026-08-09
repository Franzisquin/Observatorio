"""Normalizacao dos nomes de local de votacao, compartilhada.

Extraido de scratch/generate_histories.py sem mudanca de comportamento, para que o
agrupador de identidade (gerar_identidade_historico.py) e o gerador do historico
usem exatamente as mesmas regras. Se as duas pontas divergirem, a identidade
calculada offline deixa de casar com o que o site procura.

O par de funcoes tem um espelho em js/historico-presidente.js
(normalizeHistoryText / getHistoryNameCoreTokens): mudou aqui, mude la.
"""

import re
import unicodedata

# Palavras que descrevem o TIPO de estabelecimento, nao QUAL ele e. Tirar essas
# deixa so o nome proprio, que e o que sobrevive a um "ESCOLA MUNICIPAL X" virar
# "E.M.X" ou "CMEI X".
STOPWORDS_NUCLEO = {
    'ESCOLA', 'MUNICIPAL', 'ESTADUAL', 'ESTADO', 'ENSINO', 'FUNDAMENTAL',
    'COLEGIO', 'GRUPO', 'CENTRO', 'EDUCACIONAL', 'UNIDADE', 'INTEGRADA',
    'PROFESSOR', 'PROF', 'DOUTOR', 'DOUTORA', 'DR', 'DRA', 'DE', 'DA',
    'DO', 'DAS', 'DOS', 'EM', 'EE', 'EMEF', 'EMEI', 'CMEI', 'CEI',
    'CRECHE', 'INSTITUTO', 'COMPLEXO', 'ANEXO', 'CIEP', 'BRIZOLAO',
}


def normalize_history_school_terms(text):
    """Expande as abreviaturas escolares. E o que faz "E.M.CANDIDO HONORIO" e
    "ESCOLA MUNICIPAL CANDIDO HONORIO" virarem a mesma string."""
    words = text.split()
    expanded = []
    i = 0
    while i < len(words):
        one = words[i]
        if one == 'E' and i + 1 < len(words) and words[i + 1] == 'E':
            expanded.extend(['ESCOLA', 'ESTADUAL'])
            i += 2
            continue
        if one in ('E', 'EM', 'ESC', 'ESCOLA'):
            if i + 1 < len(words) and words[i + 1] in ('M', 'MUN', 'MUNIC', 'MUNICIPAL'):
                expanded.extend(['ESCOLA', 'MUNICIPAL'])
                i += 2
                continue
            if one == 'EM':
                expanded.extend(['ESCOLA', 'MUNICIPAL'])
                i += 1
                continue
            if one in ('ESC', 'ESCOLA'):
                expanded.append('ESCOLA')
                i += 1
                continue
        if one in ('MUN', 'MUNIC'):
            expanded.append('MUNICIPAL')
        elif one == 'ENS' and i + 1 < len(words) and words[i + 1] == 'FUND':
            expanded.extend(['ENSINO', 'FUNDAMENTAL'])
            i += 2
            continue
        elif one in ('ENS', 'ENSINO'):
            expanded.append('ENSINO')
        elif one in ('FUND', 'FUNDAMENTAL'):
            expanded.append('FUNDAMENTAL')
        elif one in ('EST', 'ESTAD'):
            expanded.append('ESTADUAL')
        elif one in ('PROF', 'PROFA', 'PROFESSORA'):
            expanded.append('PROFESSOR')
        elif one in ('DR', 'DOUTOR'):
            expanded.append('DOUTOR')
        elif one in ('DRA', 'DOUTORA'):
            expanded.append('DOUTORA')
        else:
            expanded.append(one)
        i += 1
    return " ".join(expanded)


def normalize_history_text(value):
    """Sem acento, maiusculo, so letras e numeros, abreviaturas expandidas."""
    if value is None:
        return ""
    text = unicodedata.normalize('NFD', str(value))
    text = "".join(c for c in text if unicodedata.category(c) != 'Mn')
    text = re.sub(r'[^A-Z0-9]+', ' ', text.upper())
    text = re.sub(r'\s+', ' ', text).strip()
    return normalize_history_school_terms(text)


def get_history_name_core_tokens(value):
    """So o nome proprio: tira os termos genericos e os tokens de uma letra."""
    return [t for t in normalize_history_text(value).split()
            if len(t) > 1 and t not in STOPWORDS_NUCLEO]


def demo():
    """Trava o que importa: as tres grafias do caso de Manaus tem de colapsar na
    mesma string, e CMEI/COLEGIO ... GRAZIELA RIBEIRO tem de compartilhar nucleo."""
    variantes = ['ESCOLA MUNICIPAL CANDIDO HONORIO', 'E.M.CÂNDIDO HONÓRIO',
                 'E. M. CÂNDIDO HONÓRIO']
    assert len({normalize_history_text(v) for v in variantes}) == 1, \
        [normalize_history_text(v) for v in variantes]
    assert normalize_history_text(variantes[1]) == 'ESCOLA MUNICIPAL CANDIDO HONORIO'

    a = set(get_history_name_core_tokens('CMEI GRAZIELA RIBEIRO'))
    b = set(get_history_name_core_tokens(
        'COLEGIO MUNICIPAL DE EDUCACAO INFANTIL GRAZIELA RIBEIRO'))
    assert a == {'GRAZIELA', 'RIBEIRO'}, a
    assert a <= b, (a, b)

    # E o que NAO pode colidir: predios vizinhos com nomes diferentes.
    assert not (a & set(get_history_name_core_tokens('E.M.CÂNDIDO HONÓRIO')))
    print('historico_texto: ok')


if __name__ == '__main__':
    demo()
