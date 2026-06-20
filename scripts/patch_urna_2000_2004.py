"""
Corrige cand_names (nome de urna, sigla, status, coligacao) das eleicoes
MUNICIPAIS de 2000/2004 nos estados cujo layout LEGADO de munzona nao foi lido
pelo gerador -- PR 2000, CE 2004 e PA 2004. Nesses estados os candidatos
apareciam com o NOME COMPLETO (title-case, sem acento) no lugar do NOME DE URNA,
o "sigla" trazia o nome completo em maiusculas e o status do vereador ficava N/D.

A correcao usa o munzona OFICIAL e LIMPO do TSE (latin-1, com acentuacao integra),
baixado em scratch/munzona_clean/, e reaproveita as funcoes do gerador
(build_candnames_coalmap / build_vereador_official) para produzir EXATAMENTE o
mesmo formato dos demais estados.

E um patch cirurgico: reescreve apenas campos de METADATA dos zips ja existentes
(cand_names, official_summary.votesByDisplayKey do prefeito e os totais oficiais
de vereador). NAO reprocessa secoes nem geolocalizacao (RESULTS intactos).

Uso:
  py scripts/patch_urna_2000_2004.py
  py scripts/patch_urna_2000_2004.py --dry-run
"""

import argparse
import csv
import importlib.util
import io
import json
import os
import urllib.request
import zipfile
from collections import defaultdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEO_DIR = os.path.join(BASE_DIR, 'resultados_geo')
CLEAN_DIR = os.path.join(BASE_DIR, 'scratch', 'munzona_clean')

TARGETS = [(2000, 'PR'), (2000, 'CE'), (2000, 'PA'), (2004, 'CE'), (2004, 'PA')]

# Munzona OFICIAL do TSE (latin-1, acentuacao integra). E baixado sob demanda
# para scratch/ (que NAO deve ir ao git: os zips legados do repositorio chegaram
# corrompidos por conversao CRLF). Tamanho usado como verificacao de integridade.
TSE_MUNZONA_URL = ('https://cdn.tse.jus.br/estatistica/sead/odsele/'
                   'votacao_candidato_munzona/votacao_candidato_munzona_{year}.zip')
TSE_MUNZONA_SIZE = {2000: 12488704, 2004: 41242913}

CD_PREFEITO = 11
CD_VEREADOR = 13

# --- reaproveita as funcoes do gerador (formato identico aos demais estados) ---
_spec = importlib.util.spec_from_file_location(
    'gen_municipais', os.path.join(os.path.dirname(__file__), 'gerar_municipais_2000_2004.py'))
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)


# ----------------------------------------------------------------------------
# Leitura do munzona limpo (resolve colunas por NOME do cabecalho: o layout
# muda de ano para ano -- 2000 tem 44 colunas, 2004 tem 38).
# ----------------------------------------------------------------------------

def ensure_clean_munzona(year):
    """Garante scratch/munzona_clean/mz{year}.zip integro (baixa do TSE se faltar
    ou se o tamanho nao bater)."""
    os.makedirs(CLEAN_DIR, exist_ok=True)
    path = os.path.join(CLEAN_DIR, f'mz{year}.zip')
    expected = TSE_MUNZONA_SIZE.get(year)
    if os.path.exists(path) and (expected is None or os.path.getsize(path) == expected):
        try:
            with zipfile.ZipFile(path) as zf:
                zf.namelist()
            return path
        except zipfile.BadZipFile:
            pass
    print(f'  baixando munzona {year} do TSE...')
    urllib.request.urlretrieve(TSE_MUNZONA_URL.format(year=year), path)
    return path


def read_clean_munzona(year, uf):
    """Retorna meta_by_mun[mode][cdmun] = {num: info} e party_by_mun[cdmun] = {nr2: sigla}.

    info segue o mesmo esquema esperado por build_candnames_coalmap/cand_entry:
      {'urna','full','sigla','status'(normalizado),'colig','colig_seq','_turno'}
    """
    zip_path = ensure_clean_munzona(year)
    with zipfile.ZipFile(zip_path) as zf:
        member = next(n for n in zf.namelist()
                      if n.upper().endswith(f'_{uf}.CSV') or n.upper().endswith(f'_{uf}.TXT'))
        text = zf.read(member).decode('latin-1')

    reader = csv.reader(io.StringIO(text), delimiter=';', quotechar='"')
    header = next(reader)
    idx = {name: i for i, name in enumerate(header)}

    def col(row, name):
        i = idx.get(name, -1)
        return row[i].strip() if 0 <= i < len(row) else ''

    meta_by_mun = {'prefeito': defaultdict(dict), 'vereador': defaultdict(dict)}
    party_by_mun = defaultdict(dict)

    for row in reader:
        if not row or len(row) < len(header) - 2:
            continue
        try:
            cargo = int(col(row, 'CD_CARGO'))
        except (TypeError, ValueError):
            continue
        if cargo == CD_PREFEITO:
            mode = 'prefeito'
        elif cargo == CD_VEREADOR:
            mode = 'vereador'
        else:
            continue
        try:
            cdmun = int(col(row, 'CD_MUNICIPIO'))
            num = str(int(col(row, 'NR_CANDIDATO')))
        except (TypeError, ValueError):
            continue
        try:
            turno = int(col(row, 'NR_TURNO'))
        except (TypeError, ValueError):
            turno = 1

        sigla = col(row, 'SG_PARTIDO')
        nm_colig = col(row, 'NM_COLIGACAO')
        colig = '' if nm_colig in ('#NULO#', '#NE#', '-1', '') else nm_colig
        sq = col(row, 'SQ_COLIGACAO')
        colig_seq = '' if sq in ('', '-1', '#NE#', '0') else sq
        info = {
            'urna': col(row, 'NM_URNA_CANDIDATO'),
            'full': col(row, 'NM_CANDIDATO'),
            'sigla': sigla,
            'status': gen.normalize_status(col(row, 'DS_SIT_TOT_TURNO')),
            'colig': colig,
            'colig_seq': colig_seq,
            '_turno': turno,
        }
        prev = meta_by_mun[mode][cdmun].get(num)
        # mantem o registro do turno mais alto (status final: ELEITO/NAO ELEITO)
        if prev is None or turno >= prev.get('_turno', -1):
            meta_by_mun[mode][cdmun][num] = info

        nr_part = col(row, 'NR_PARTIDO')
        if nr_part and sigla:
            try:
                party_by_mun[cdmun][str(int(nr_part))] = sigla
            except (TypeError, ValueError):
                pass

    return meta_by_mun, party_by_mun


# ----------------------------------------------------------------------------
# Reescrita dos cand_names a partir do munzona limpo
# ----------------------------------------------------------------------------

def rebuild_cand_names(existing, munz_meta, party_map, mode):
    """Regenera cand_names para os numeros ja presentes em `existing`.
    Numeros sem registro no munzona (ex.: legendas) sao tratados por cand_entry
    via party_map, exatamente como no gerador."""
    pairs = []
    for num in existing:
        if num in ('95', '96', '97'):
            continue
        nm = (munz_meta.get(num, {}).get('full') or existing[num][0] or '')
        pairs.append((num, nm))
    cand_names, coal_map = gen.build_candnames_coalmap(pairs, munz_meta, party_map, mode)
    # preserva quaisquer chaves especiais que ja existiam (95/96/97 ja vem do builder)
    for num in existing:
        cand_names.setdefault(num, existing[num])
    return cand_names, coal_map


def patch_prefeito(year, uf, meta_by_mun, party_by_mun, stats, dry_run):
    munz_pref = meta_by_mun['prefeito']
    for turno in (1, 2):
        zip_path = os.path.join(GEO_DIR, f'Municipais {year}',
                                f'prefeito_{year}_ord_t{turno}_{uf}.zip')
        if not os.path.exists(zip_path):
            continue
        new_members = {}
        changed = 0
        with zipfile.ZipFile(zip_path) as zf:
            for name in zf.namelist():
                data = json.loads(zf.read(name))
                md = data.get('METADATA', {})
                cdmun = int(md.get('cd_municipio') or name.split('_')[0])
                munz_meta = munz_pref.get(cdmun, {})
                existing = md.get('cand_names', {})
                if munz_meta:
                    party_map = party_by_mun.get(cdmun, {})
                    new_cn, _ = rebuild_cand_names(existing, munz_meta, party_map, 'prefeito')
                    # prefeito: mantem o STATUS ja calculado (ELEITO/NAO ELEITO dos totais)
                    for num, e in new_cn.items():
                        old = existing.get(num)
                        if old and len(old) > 2 and old[2] not in ('', 'N/D'):
                            e[2] = old[2]
                    md['cand_names'] = new_cn
                    _rebuild_prefeito_summary(md, new_cn)
                    changed += 1
                new_members[name] = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        stats[f'{uf} {year} prefeito t{turno}'] = changed
        if not dry_run:
            _rewrite_zip(zip_path, new_members)


def _rebuild_prefeito_summary(md, cand_names):
    """Reescreve official_summary[*].votesByDisplayKey usando os novos nomes,
    preservando rawTotals e os agregados (mesma logica de write_prefeito)."""
    summary = md.get('official_summary') or {}
    for tkey, block in summary.items():
        raw = block.get('rawTotals') or {}
        turno = tkey.replace('T', '')
        vbk = {}
        for cid, v in raw.items():
            if cid in ('95', '96', '97'):
                continue
            m = cand_names.get(cid)
            if not m:
                continue
            disp = f"{m[0] or ('Candidato ' + cid)} ({m[1] or '?'}) ({m[2] or 'N/D'}) {turno}T"
            vbk[disp] = int(v)
        block['votesByDisplayKey'] = vbk


def patch_vereador(year, uf, meta_by_mun, party_by_mun, existing_totals_uf,
                   official_totals, stats, dry_run):
    munz_ver = meta_by_mun['vereador']
    zip_path = os.path.join(GEO_DIR, f'Municipais_Legislativas {year}',
                            f'vereadores_{year}_{uf}.zip')
    if not os.path.exists(zip_path):
        return
    new_members = {}
    changed = 0
    uf_totals = official_totals.setdefault(uf, {})
    with zipfile.ZipFile(zip_path) as zf:
        for name in zf.namelist():
            data = json.loads(zf.read(name))
            md = data.get('METADATA', {})
            cdmun = int(md.get('cd_municipio') or name.rsplit('_', 1)[-1].split('.')[0])
            munz_meta = munz_ver.get(cdmun, {})
            existing = md.get('cand_names', {})
            if munz_meta:
                party_map = party_by_mun.get(cdmun, {})
                new_cn, coal_map = rebuild_cand_names(existing, munz_meta, party_map, 'vereador')
                md['cand_names'] = new_cn
                # recomputa os totais oficiais (coligacoes, QE, vagas) reagrupando os
                # votos por partido (ja corretos) nas coligacoes reais + status correto.
                slug = _slug_from_vereador_name(name, cdmun)
                prev_tot = existing_totals_uf.get(slug)
                if prev_tot:
                    uf_totals[slug] = recompute_vereador_official(
                        prev_tot, munz_meta, new_cn, coal_map, party_map)
                changed += 1
            new_members[name] = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    stats[f'{uf} {year} vereador'] = changed
    if not dry_run:
        _rewrite_zip(zip_path, new_members)


def recompute_vereador_official(prev_tot, munz_meta, cand_names, coal_map, party_map):
    """Reagrupa os totais por PARTIDO (ja corretos no arquivo antigo, mas sem
    coligacao e com elected=0) nas coligacoes reais do munzona e reconta os
    eleitos a partir do status corrigido. Replica a matematica de
    build_vereador_official (QE art.106 CE, vagas por QP)."""
    maps = gen.build_coalition_maps(munz_meta)
    coal_of = gen.make_coal_of(munz_meta, party_map, maps)
    sigla_to_coal = {}
    for num, inf in munz_meta.items():
        s = gen.strip_accents_upper(inf.get('sigla', ''))
        if s and s not in sigla_to_coal:
            sigla_to_coal[s] = coal_of(num)  # (ck, name, comp)

    coal_votes = defaultdict(int)
    coal_comp = {}
    votos_validos = 0
    for c in prev_tot.get('coalitions', []):
        sig = gen.strip_accents_upper(c.get('raw_comp') or c.get('id') or '')
        votes = int(c.get('votes', 0))
        votos_validos += votes
        ck, _cname, comp = sigla_to_coal.get(sig, (f'PARTY:{sig}', '', sig))
        coal_votes[ck] += votes
        coal_comp.setdefault(ck, gen.normalize_comp(comp) or comp or sig)

    coal_elected = defaultdict(int)
    for cid, m in cand_names.items():
        if cid in ('95', '96', '97') or len(str(cid)) <= 2:
            continue
        st = gen.strip_accents_upper(m[2] if len(m) > 2 else '')
        if 'ELEITO' in st and 'NAO' not in st:
            ck = coal_map.get(cid, (None, '', ''))[0]
            if not ck:
                ck = f'PARTY:{gen.strip_accents_upper(m[1] if len(m) > 1 else "")}'
            coal_elected[ck] += 1

    qt_vagas = sum(coal_elected.values())
    vr_qe = gen.compute_qe(votos_validos, qt_vagas) if qt_vagas else 0

    coalitions = []
    for ck, votes in sorted(coal_votes.items(), key=lambda x: -x[1]):
        elected = coal_elected.get(ck, 0)
        vagas_qp = (votes // vr_qe) if vr_qe else 0
        el_qp = min(vagas_qp, elected)
        comp_id = coal_comp.get(ck, ck)
        coalitions.append({
            'id': comp_id, 'raw_comp': comp_id, 'votes': int(votes),
            'elected': int(elected), 'elected_qp': int(el_qp),
            'elected_avg': int(max(0, elected - el_qp)), 'vagas_qp': int(vagas_qp),
        })
    return {
        'stats': {'qt_vagas': int(qt_vagas), 'vr_qe': int(vr_qe),
                  'qt_votos_validos': int(votos_validos)},
        'coalitions': coalitions,
    }


def _slug_from_vereador_name(filename, cdmun):
    # vereadores_{year}_{UF}_{SLUG}_{cdmun}.json
    base = filename[:-5] if filename.endswith('.json') else filename
    parts = base.split('_')
    # remove prefixo vereadores_{year}_{UF} (3 tokens) e sufixo {cdmun} (1 token)
    return '_'.join(parts[3:-1])


def _rewrite_zip(zip_path, members):
    tmp = zip_path + '.tmp'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
        for name, payload in members.items():
            zf.writestr(name, payload)
    os.replace(tmp, zip_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    stats = {}
    totals_by_year = defaultdict(dict)  # year -> {uf: {slug: totals}}
    existing_doc_by_year = {}            # year -> doc carregado de official_totals
    for year, uf in TARGETS:
        print(f'\n=== {uf} {year} ===')
        if year not in existing_doc_by_year:
            tpath = os.path.join(GEO_DIR, f'Municipais_Legislativas {year}',
                                 f'official_totals_vereadores_{year}.json')
            with open(tpath, 'r', encoding='utf-8') as f:
                existing_doc_by_year[year] = json.load(f)
        meta_by_mun, party_by_mun = read_clean_munzona(year, uf)
        np = sum(len(v) for v in meta_by_mun['prefeito'].values())
        nv = sum(len(v) for v in meta_by_mun['vereador'].values())
        print(f'  munzona limpo: {len(meta_by_mun["prefeito"])} muni prefeito ({np} cand), '
              f'{len(meta_by_mun["vereador"])} muni vereador ({nv} cand)')
        patch_prefeito(year, uf, meta_by_mun, party_by_mun, stats, args.dry_run)
        patch_vereador(year, uf, meta_by_mun, party_by_mun,
                       existing_doc_by_year[year].get(uf, {}), totals_by_year[year],
                       stats, args.dry_run)

    # splice nos official_totals_vereadores_{year}.json (preserva demais UFs)
    for year, by_uf in totals_by_year.items():
        path = os.path.join(GEO_DIR, f'Municipais_Legislativas {year}',
                            f'official_totals_vereadores_{year}.json')
        doc = existing_doc_by_year[year]
        for uf, slugmap in by_uf.items():
            doc.setdefault(uf, {}).update(slugmap)
            print(f'  official_totals {year}: {uf} atualizado ({len(slugmap)} municipios)')
        if not args.dry_run:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))

    print('\n--- resumo ---')
    for k, v in stats.items():
        print(f'  {k}: {v} municipios')
    if args.dry_run:
        print('\n(DRY-RUN: nada foi gravado)')


if __name__ == '__main__':
    main()
