import os
import zipfile
import pandas as pd
import json
import gc
import sys
from multiprocessing import Pool, cpu_count

# --- CONSTANTS ---
BASE_DIR = r"c:\mapas\site eleições\resultados 2006"
OUTPUT_DIR = r"c:\mapas\site eleições\resultados_geo\Legislativas 2006"

if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# Priority for DS_SIT_TOT_TURNO — higher number = higher priority
SIT_PRIORITY = {
    '#NULO': 0,
    '#NULO#': 0,
    '': 1,
    'SUPLENTE': 2,
    'INAPTO': 2,
    'NÃO ELEITO': 3,
    'NAO ELEITO': 3,
    'ELEITO POR QP': 4,
    'ELEITO POR MÉDIA': 4,
    'ELEITO POR MEDIA': 4,
    'ELEITO': 4,
    'MÉDIA': 4,
    'MEDIA': 4,
}

def get_sit_priority(sit_str):
    s = str(sit_str).strip().upper()
    return SIT_PRIORITY.get(s, 1)

def load_candidates(uf):
    print(f"[{uf}] Loading candidates...")
    zip_path = os.path.join(BASE_DIR, "consulta_cand_2006.zip")
    cand_map_fed = {} 
    cand_map_est = {} 
    priority_fed = {} 
    priority_est = {}
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            target = None
            for f in z.namelist():
                if f"_{uf}.csv" in f or f"_{uf}_.csv" in f: 
                    target = f; break
            if not target:
                 for f in z.namelist():
                    if f.endswith('.csv') and uf in f: target = f; break
            if not target:
                 for f in z.namelist():
                    if f.endswith('.csv'): target = f; break

            if target:
                with z.open(target) as f:
                    df = pd.read_csv(f, sep=';', encoding='latin1', dtype=str, on_bad_lines='skip')
                    cols = df.columns
                    if 'CD_CARGO' in cols and 'SG_UF' in cols:
                        df = df[(df['SG_UF'] == uf) & (df['CD_CARGO'].isin(['6', '7', '8']))]
                        for _, row in df.iterrows():
                            cargo, num = str(row['CD_CARGO']), str(row.get('NR_CANDIDATO', ''))
                            sit_tot = str(row.get('DS_SIT_TOT_TURNO', '')).upper()
                            detalhe_sit = str(row.get('DS_DETALHE_SITUACAO_CAND', '')).upper()
                            sit_cand = str(row.get('DS_SITUACAO_CANDIDATURA', '')).upper()
                            status = sit_tot
                            ips = ['INAPTO', 'CASSADO', 'INELEGÍVEL', 'INELEGIVEL', 'INDEFERIDO', 'FALECIMENTO', 'RENÚNCIA', 'RENUNCIA', 'CANCELADO', 'NÃO CONHECIMENTO']
                            if any(k in detalhe_sit for k in ips) or any(k in sit_tot for k in ips) or any(k in sit_cand for k in ips):
                                if 'COM RECURSO' not in detalhe_sit and 'COM RECURSO' not in sit_tot and 'COM RECURSO' not in sit_cand: status = 'INAPTO'
                            entry = [row.get('NM_URNA_CANDIDATO', ''), row.get('SG_PARTIDO', ''), status, row.get('NM_COLIGACAO', ''), row.get('DS_COMPOSICAO_COLIGACAO', '')]
                            target_map, target_pri = (cand_map_fed, priority_fed) if cargo == '6' else (cand_map_est, priority_est)
                            new_pri = get_sit_priority(sit_tot)
                            if new_pri > target_pri.get(num, -1):
                                target_map[num] = entry
                                target_pri[num] = new_pri
    except Exception as e: print(f"[{uf}] Error loading cand: {e}")
    return cand_map_fed, cand_map_est

def verify_and_fix_names(uf, cand_map, chunk, cargo_filter):
    if 'NM_VOTAVEL' not in chunk.columns: return
    pairs = chunk[chunk['CD_CARGO'].isin(cargo_filter)][['NR_VOTAVEL', 'NM_VOTAVEL']].drop_duplicates()
    for num_raw, name_vote in pairs.itertuples(index=False):
        num = str(num_raw)
        if num not in cand_map and len(num) > 2 and num not in ['95', '96']:
            prefix = num[:2]
            party = next((d[1] for k, d in cand_map.items() if str(k).startswith(prefix)), prefix)
            cand_map[num] = [str(name_vote).strip(), party, "EXTRAÍDO", "", ""]

def process_state(uf):
    try:
        cand_map_fed, cand_map_est = load_candidates(uf)
        if not cand_map_fed and not cand_map_est: return
        print(f"[{uf}] Processing votes...")
        zip_path = os.path.join(BASE_DIR, f"votacao_secao_2006_{uf}.zip")
        if not os.path.exists(zip_path): return
        res_f, res_e, tot_f, tot_e = {}, {}, {}, {}
        with zipfile.ZipFile(zip_path, 'r') as z:
            target = [f for f in z.namelist() if f.endswith('.csv') or f.endswith('.txt')][0]
            with z.open(target) as f:
                reader = pd.read_csv(f, sep=';', encoding='latin1', chunksize=200000, dtype=str, on_bad_lines='skip')
                for chunk in reader:
                    chunk = chunk[chunk['CD_CARGO'].isin(['6', '7', '8'])]
                    if chunk.empty: continue
                    verify_and_fix_names(uf, cand_map_fed, chunk, ['6'])
                    verify_and_fix_names(uf, cand_map_est, chunk, ['7', '8'])
                    chunk['QT_VOTOS'] = chunk['QT_VOTOS'].astype(int)
                    grouped = chunk.groupby(['CD_CARGO', 'NR_ZONA', 'CD_MUNICIPIO', 'NR_LOCAL_VOTACAO', 'NR_VOTAVEL'])['QT_VOTOS'].sum().reset_index()
                    for row in grouped.itertuples(index=False):
                        target_res, target_tot = (res_f, tot_f) if row.CD_CARGO == '6' else (res_e, tot_e)
                        key = f"{row.NR_ZONA}_{row.CD_MUNICIPIO}_{row.NR_LOCAL_VOTACAO}"
                        target_res.setdefault(key, {})[row.NR_VOTAVEL] = target_res.setdefault(key, {}).get(row.NR_VOTAVEL, 0) + row.QT_VOTOS
                        target_tot[row.NR_VOTAVEL] = target_tot.get(row.NR_VOTAVEL, 0) + row.QT_VOTOS
        off_f, off_e = load_official_totals(uf, 'Deputado Federal'), load_official_totals(uf, 'Deputado Estadual')
        save_data(uf, 'federal', res_f, tot_f, cand_map_fed, off_f)
        save_data(uf, 'estadual', res_e, tot_e, cand_map_est, off_e)
    except Exception as e: print(f"[{uf}] Error: {e}")

def normalize_comp(comp_str): return "/".join(sorted([p.strip().upper() for p in str(comp_str).split('/')])) if pd.notnull(comp_str) else ""

def load_official_totals(uf, cargo_desc):
    zip_path = os.path.join(BASE_DIR, "quociente_eleitoral-brasil_2006.csv.zip")
    totals = {}
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            target = [f for f in z.namelist() if f.endswith('.csv')][0]
            with z.open(target) as f:
                df = pd.read_csv(f, sep=';', encoding='latin1', on_bad_lines='skip')
                col_map = {c.upper(): c for c in df.columns}
                c_uf, c_cargo, c_comp = col_map.get('UF', 'UF'), col_map.get('DS_CARGO', 'ds_cargo'), col_map.get('DS_COMPOSICAO_COLIGACAO', 'ds_composicao_coligacao')
                c_votes = next((c for c in df.columns if 'votos' in c.lower() and 'composi' in c.lower()), 'Votos válidos composição')
                df = df[(df[c_uf] == uf) & (df[c_cargo].str.upper().str.contains(cargo_desc.split()[-1].upper()))]
                for _, row in df.iterrows(): 
                    v = row.get(c_votes, 0)
                    if pd.notnull(v): totals[normalize_comp(row[c_comp])] = int(v)
    except Exception as e: print(f"[{uf}] Warning QE: {e}")
    return totals

def save_data(uf, type_label, results, totals, cand_map, off_totals=None):
    meta_cands, all_ids = {}, set()
    for loc in results: all_ids.update(results[loc].keys())
    all_ids.update(totals.keys())
    sums = {}
    for cid in all_ids:
        if cid in cand_map:
            meta_cands[cid] = cand_map[cid]
            if off_totals:
                norm = normalize_comp(cand_map[cid][4])
                if norm: sums[norm] = sums.get(norm, 0) + totals.get(cid, 0)
        else:
            if cid == '95': meta_cands[cid] = ["VOTO BRANCO", "", "BRANCO", "", ""]
            elif cid == '96': meta_cands[cid] = ["VOTO NULO", "", "NULO", "", ""]
            elif len(cid) == 2: meta_cands[cid] = ["VOTO DE LEGENDA", "PARTIDO " + cid, "LEGENDA", "", ""]
            else: meta_cands[cid] = [f"Candidato {cid}", "", "DESCONHECIDO", "", ""]
    adj = {}
    if off_totals:
        for norm, off_v in off_totals.items():
            diff = off_v - sums.get(norm, 0)
            if diff > 0:
                adj[norm] = diff
                for cx in cand_map.values():
                    if normalize_comp(cx[4]) == norm: adj[cx[3].strip()] = diff; break
    final = { "METADATA": { "cand_names": meta_cands, "coalition_adjustments": adj }, "RESULTS": results }
    base = f"deputados_{type_label}_2006_{uf}"
    for suffix, data in [("", final), ("_resumo", { "METADATA": final["METADATA"], "TOTALS": totals })]:
        p = os.path.join(OUTPUT_DIR, f"{base}{suffix}.json")
        with open(p, 'w', encoding='utf-8') as f: json.dump(data, f)
    with zipfile.ZipFile(os.path.join(OUTPUT_DIR, f"{base}.zip"), 'w', zipfile.ZIP_DEFLATED) as z:
        for s in ["", "_resumo"]: z.write(os.path.join(OUTPUT_DIR, f"{base}{s}.json"), arcname=f"{base}{s}.json"); os.remove(os.path.join(OUTPUT_DIR, f"{base}{s}.json"))

if __name__ == "__main__":
    ufs = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"]
    with Pool(min(4, cpu_count())) as p: p.map(process_state, ufs)
