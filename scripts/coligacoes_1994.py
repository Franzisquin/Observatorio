# -*- coding: utf-8 -*-
"""
Parser de 1994/coligações.txt — coligações de GOVERNADOR curadas manualmente
(o TSE nao registrou coligacoes em 1994). Tres layouts coexistem no arquivo:

  A) lista simples (maioria das UFs):
       Nome Cand / "SIGLA<TAB>Nome Vice" / "SIGLA_VICE<TAB>" / numero /
       nome da coligacao [/ "(COMPOSICAO)"] / votacao / percentual
  B) tabela wiki (BA, DF, SP): ancora = linha comecando com numero de 3
     digitos; celulas "<Nome completo>\tSIGLA\t..." dao candidato e vice;
     "Partido Isolado" ou "Nome Coligacao"+"(COMPOSICAO)" fecham o bloco.
  C) SC: apenas "SIGLAS-SEPARADAS-POR-HIFEN Nome da Coligacao" (uma por linha);
     associacao pelo partido-lider (primeira sigla).

Saida de parse_coligacoes(): {UF: [entry]} com
  entry = {partido, vice, vice_partido, colig, comp (lista de siglas),
           votacao (int|None), lider_only (bool)}
O join com os zips e por PARTIDO do candidato (unico por UF em 1994).
"""

import io
import os
import re
import unicodedata

TXT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        '1994', 'coligações.txt')

UF_HEADERS = {
    'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA',
    'CEARA': 'CE', 'DF': 'DF', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES',
    'GOIAS': 'GO', 'MARANHAO': 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
    'MINAS GERAIS': 'MG', 'PARA': 'PA', 'PARAIBA': 'PB', 'PARANA': 'PR',
    'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ',
    'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO',
    'RORAIMA': 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE',
    'TOCANTINS': 'TO',
}

SIGLA_RE = re.compile(r'^P[A-Za-z]{0,5}$|^PCdoB$|^PTdoB$|^PC do B$|^PT do B$')


def _norm(s):
    s = unicodedata.normalize('NFD', str(s or ''))
    return ''.join(c for c in s if unicodedata.category(c) != 'Mn').strip().upper()


def norm_sigla(s):
    """'PCdoB' / 'PC DO B' / 'PC do B' -> 'PCDOB'."""
    return re.sub(r'[^A-Z0-9]', '', _norm(s))


def _is_sigla(tok):
    tok = str(tok or '').strip()
    return bool(tok) and bool(SIGLA_RE.match(tok))


def _split_composicao(text):
    """'PPR, PP, PFL e PSC' / 'PPR-PTB-PSC' / 'PRN/PSD/PTdoB' -> lista de siglas."""
    parts = re.split(r'[,/\-]| e ', text)
    siglas = [p.strip() for p in parts if _is_sigla(p.strip())]
    return siglas if len(siglas) == len([p for p in parts if p.strip()]) and len(siglas) >= 2 else (siglas if len(siglas) >= 2 else [])


def _is_votes(line):
    return bool(re.match(r'^\d{1,3}(\.\d{3})+$', line)) or line == '0'


def _parse_int(line):
    try:
        return int(line.replace('.', ''))
    except ValueError:
        return None


ISOLADO_RE = re.compile(r'sem coliga|candidatura avulsa|partido isolado', re.I)


def _parse_block_meta(lines):
    """Das linhas entre o numero e a votacao: (colig_nome, comp_list, isolado)."""
    text = ' '.join(lines).strip()
    if ISOLADO_RE.search(text):
        return None, [], True
    m = re.search(r'\(([^)]+)\)', text)
    if m:
        comp = _split_composicao(m.group(1))
        nome = text[:m.start()].strip().rstrip(',')
        if comp:
            return (nome or None), comp, False
    # composicao sem parenteses ("PT, PSTU, PV, PTdoB" / "PFL, PSD")
    comp = _split_composicao(text)
    if comp:
        return None, comp, False
    return (text or None), [], False


def _parse_uf_lista(lines):
    """Layout A."""
    entries = []
    i = 0
    while i < len(lines):
        cells = lines[i].split('\t')
        # "SIGLA<TAB>Nome do vice"
        if len(cells) >= 2 and _is_sigla(cells[0]) and cells[1].strip():
            partido = cells[0].strip()
            vice = cells[1].strip()
            vice_partido = ''
            j = i + 1
            if j < len(lines) and _is_sigla(lines[j].split('\t')[0]):
                vice_partido = lines[j].split('\t')[0].strip()
                j += 1
            # numero
            if j < len(lines) and re.match(r'^\d{2,3}$', lines[j].strip()):
                j += 1
            # meta ate a votacao
            meta_lines = []
            votacao = None
            while j < len(lines):
                ln = lines[j].strip()
                if _is_votes(ln):
                    votacao = _parse_int(ln)
                    j += 1
                    if j < len(lines) and lines[j].strip().endswith('%'):
                        j += 1
                    break
                if ln.endswith('%'):
                    j += 1
                    break
                cells_j = lines[j].split('\t')
                if len(cells_j) >= 2 and _is_sigla(cells_j[0]) and cells_j[1].strip():
                    break  # proximo candidato sem votacao (dados incompletos)
                meta_lines.append(ln)
                j += 1
            colig, comp, isolado = _parse_block_meta([l for l in meta_lines if l])
            entries.append({
                'partido': partido, 'vice': vice, 'vice_partido': vice_partido,
                'colig': colig, 'comp': comp, 'isolado': isolado,
                'votacao': votacao, 'lider_only': False,
            })
            i = j
        else:
            i += 1
    return entries


def _parse_uf_wiki(lines):
    """Layout B (BA/DF/SP): blocos ancorados em linha que comeca com 3 digitos."""
    entries = []
    anchors = [idx for idx, ln in enumerate(lines) if re.match(r'^\d{3}\t', ln) or re.match(r'^\d{3}$', ln.strip())]
    for a_i, start in enumerate(anchors):
        end = anchors[a_i + 1] if a_i + 1 < len(anchors) else len(lines)
        block = lines[start:end]
        # celulas "Nome\tSIGLA" em ordem: 1a = candidato, 2a = vice
        found = []  # (nome, sigla)
        isolado = False
        meta_lines = []
        for ln in block:
            if 'Partido Isolado' in ln:
                isolado = True
            cells = ln.split('\t')
            for ci in range(len(cells) - 1):
                if cells[ci].strip() and _is_sigla(cells[ci + 1].strip()) and len(found) < 2:
                    # evita pegar "45	PSDB" (numero como nome)
                    if not re.match(r'^\d+$', cells[ci].strip()):
                        found.append((cells[ci].strip(), cells[ci + 1].strip()))
            stripped = ln.strip()
            if stripped and '\t' not in ln and not re.match(r'^\[\d+\]$', stripped):
                meta_lines.append(stripped)
        # Composicao = linha isolada "(...)" com >= 2 siglas (as biografias tem
        # parenteses de anos, entao nao da para usar o primeiro parenteses do
        # bloco); nome da coligacao = linha nao-vazia imediatamente anterior.
        colig, comp, iso2 = None, [], False
        for mi, ml in enumerate(meta_lines):
            m = re.match(r'^\((.+)\)$', ml)
            siglas = _split_composicao(m.group(1)) if m else []
            if siglas:
                comp = siglas
                for back in range(mi - 1, -1, -1):
                    prev = meta_lines[back].strip()
                    if prev and not prev.endswith(';') and '(19' not in prev:
                        colig = prev
                        break
                break
        if isolado:
            colig, comp = None, []
        entries.append({
            'partido': found[0][1] if found else '',
            'vice': found[1][0] if len(found) > 1 else '',
            'vice_partido': found[1][1] if len(found) > 1 else '',
            'colig': colig, 'comp': comp, 'isolado': isolado or iso2,
            'votacao': None, 'lider_only': False,
        })
    return [e for e in entries if e['partido']]


def _parse_uf_sc(lines):
    """Layout C (SC): 'PPR-PTB-PSC-PL-PFL Uniao por Santa Catarina'."""
    entries = []
    for ln in lines:
        m = re.match(r'^((?:[A-Za-z]+-)+[A-Za-z]+)\s+(.+)$', ln.strip())
        if not m:
            continue
        comp = [p for p in m.group(1).split('-') if _is_sigla(p)]
        if len(comp) < 2:
            continue
        entries.append({
            'partido': comp[0], 'vice': '', 'vice_partido': '',
            'colig': m.group(2).strip(), 'comp': comp, 'isolado': False,
            'votacao': None, 'lider_only': True,
        })
    return entries


def parse_coligacoes(path=TXT_PATH):
    with io.open(path, encoding='utf-8') as f:
        raw = f.read().splitlines()

    blocks = {}
    current = None
    for ln in raw:
        # Cabecalho de UF: "ACRE:" ou apenas "PARÁ" (algumas UFs vem sem dois-pontos).
        stripped = ln.strip()
        header = _norm(stripped.rstrip(':')) if stripped and '\t' not in stripped else None
        if header in UF_HEADERS:
            current = UF_HEADERS[header]
            blocks[current] = []
        elif current:
            blocks[current].append(ln)

    result = {}
    for uf, lines in blocks.items():
        if uf == 'SC':
            result[uf] = _parse_uf_sc(lines)
        elif any(re.match(r'^\d{3}\t', ln) for ln in lines):
            result[uf] = _parse_uf_wiki(lines)
        else:
            result[uf] = _parse_uf_lista(lines)
    return result


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    data = parse_coligacoes()
    for uf in sorted(data):
        print('==', uf, '==')
        for e in data[uf]:
            print('  %-6s vice=%-28s [%s] colig=%r comp=%s votos=%s' % (
                e['partido'], (e['vice'] or '-')[:28] + ('/' + e['vice_partido'] if e['vice_partido'] else ''),
                'ISOLADO' if e['isolado'] else ('LIDER' if e['lider_only'] else 'COLIG'),
                e['colig'], ','.join(e['comp']), e['votacao']))
