import os
import zipfile
import json
import sqlite3
import re
import unicodedata
import sys

# Constants
MATCH_TYPES = [
    'local_key', 
    'city_zone_local', 
    'name_bairro', 
    'name_city', 
    'name_core_bairro', 
    'name_core_pair_bairro', 
    'name_core_city_loose', 
    'school_number_bairro', 
    'address_bairro', 
    'coord'
]

CONFIDENCE_BY_MATCH = {
    'local_key': 1.0,
    'city_zone_local': 0.8,
    'name_bairro': 0.65,
    'address_bairro': 0.65,
    'name_city': 0.6,
    'name_core_bairro': 0.58,
    'school_number_bairro': 0.56,
    'name_core_city_loose': 0.54,
    'name_core_pair_bairro': 0.52,
    'coord': 0.4
}

ALL_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
]

LOCALES_CACHE = {}

def get_history_year_sort_value(value):
    text = str(value or '')
    match = re.search(r'\d{4}', text)
    base = int(match.group(0)) if match else 0
    sup = 0.2 if re.search(r'sup', text, re.IGNORECASE) else 0.0
    return base + sup

def normalize_year(y):
    try:
        if str(y).isdigit():
            return int(y)
    except:
        pass
    return str(y)

# String normalization helpers
def normalize_history_text(value):
    if value is None:
        return ""
    text = str(value)
    text = unicodedata.normalize('NFD', text)
    text = "".join(c for c in text if unicodedata.category(c) != 'Mn')
    text = text.upper()
    text = re.sub(r'[^A-Z0-9]+', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return normalize_history_school_terms(text)

def normalize_history_school_terms(text):
    words = text.split()
    expanded = []
    i = 0
    while i < len(words):
        one = words[i]
        if one == 'E' and i + 1 < len(words) and words[i+1] == 'E':
            expanded.extend(['ESCOLA', 'ESTADUAL'])
            i += 2
            continue
        if one in ('E', 'EM', 'ESC', 'ESCOLA'):
            if i + 1 < len(words) and words[i+1] in ('M', 'MUN', 'MUNIC', 'MUNICIPAL'):
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
        elif one == 'ENS' and i + 1 < len(words) and words[i+1] == 'FUND':
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

def get_history_name_core_tokens(value):
    stopwords = {
        'ESCOLA', 'MUNICIPAL', 'ESTADUAL', 'ESTADO', 'ENSINO', 'FUNDAMENTAL',
        'COLEGIO', 'GRUPO', 'CENTRO', 'EDUCACIONAL', 'UNIDADE', 'INTEGRADA',
        'PROFESSOR', 'PROF', 'DOUTOR', 'DOUTORA', 'DR', 'DRA', 'DE', 'DA',
        'DO', 'DAS', 'DOS', 'EM', 'EE', 'EMEF', 'EMEI', 'CMEI', 'CEI',
        'CRECHE', 'INSTITUTO', 'COMPLEXO', 'ANEXO', 'CIEP', 'BRIZOLAO'
    }
    tokens = normalize_history_text(value).split()
    return [t for t in tokens if len(t) > 1 and t not in stopwords]

def get_history_loose_name_core_tokens(value):
    return [t.replace('Y', 'I') for t in get_history_name_core_tokens(value)]

def get_history_name_core_pair_keys(tokens):
    if not tokens or len(tokens) < 2 or len(tokens) > 6:
        return []
    keys = []
    for i in range(len(tokens)):
        for j in range(i + 1, len(tokens)):
            keys.append(f"{tokens[i]}|{tokens[j]}")
    return keys

def get_history_school_number_tokens(value):
    tokens = normalize_history_text(value).split()
    return [t for t in tokens if re.match(r'^\d{2,5}$', t)]

def build_president_history_aliases(props):
    aliases = []
    
    def push_alias(kind, val):
        clean = str(val or '').strip()
        if not clean:
            return
        alias = f"{kind}:{clean}"
        if alias not in aliases:
            aliases.append(alias)
            
    uf = str(props.get('sg_uf') or props.get('SG_UF') or '').upper().strip()
    local_key = str(props.get('id_unico') or props.get('ID_UNICO') or props.get('local_key') or '').strip()
    
    try:
        zona = int(props.get('nr_zona') or 0)
    except:
        zona = 0
        
    try:
        local = int(props.get('nr_locvot') or props.get('nr_local_votacao') or 0)
    except:
        local = 0
        
    city = normalize_history_text(props.get('nm_localidade'))
    name = normalize_history_text(props.get('nm_locvot'))
    core_tokens = get_history_name_core_tokens(props.get('nm_locvot'))
    core = " ".join(core_tokens)
    loose_core_tokens = get_history_loose_name_core_tokens(props.get('nm_locvot'))
    loose_core = " ".join(loose_core_tokens)
    school_numbers = get_history_school_number_tokens(props.get('nm_locvot'))
    bairro = normalize_history_text(props.get('ds_bairro'))
    address = normalize_history_text(props.get('ds_endereco') or props.get('ds_enderec'))
    
    try:
        lat = float(props.get('lat') or 0.0)
        lon = float(props.get('long') or 0.0)
    except:
        lat = 0.0
        lon = 0.0
        
    push_alias('local_key', local_key)
    if uf and city and zona > 0 and local > 0:
        push_alias('city_zone_local', f"{uf}|{city}|{zona}_{local}")
    if uf and city and name and bairro:
        push_alias('name_bairro', f"{uf}|{city}|{name}|{bairro}")
    if uf and city and name and len(name) >= 10:
        push_alias('name_city', f"{uf}|{city}|{name}")
    if uf and city and bairro and core and len(core) >= 6:
        push_alias('name_core_bairro', f"{uf}|{city}|{bairro}|{core}")
        for pair_key in get_history_name_core_pair_keys(core_tokens):
            push_alias('name_core_pair_bairro', f"{uf}|{city}|{bairro}|{pair_key}")
    if uf and city and loose_core and len(loose_core_tokens) >= 3 and len(loose_core) >= 14:
        push_alias('name_core_city_loose', f"{uf}|{city}|{loose_core}")
    for num_token in school_numbers:
        if uf and city and bairro:
            push_alias('school_number_bairro', f"{uf}|{city}|{bairro}|{num_token}")
    if uf and city and address and bairro:
        push_alias('address_bairro', f"{uf}|{city}|{address}|{bairro}")
    if uf and lat != 0.0 and lon != 0.0:
        push_alias('coord', f"{uf}|{lat:.5f}|{lon:.5f}")
        
    return aliases

# DB load helper
def get_locales_for_uf_and_year(uf, year):
    uf = uf.upper()
    cache_key = (uf, year)
    if cache_key in LOCALES_CACHE:
        return LOCALES_CACHE[cache_key]
        
    if year in (1998, 2000, 2004):
        zip_path = 'resultados_geo/locais_votacao_2006_gkpg.zip'
        table_name = 'locais_votacao_2006_padronizado'
    elif year == 2002:
        zip_path = 'resultados_geo/locais_votacao_2002_gkpg.zip'
        table_name = 'locais_votacao_2002_padronizado'
    else:
        raise ValueError(f"Unsupported locales year: {year}")
        
    if not os.path.exists(zip_path):
        print(f"Locales zip not found: {zip_path}")
        return {}
        
    os.makedirs('scratch', exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        gpkg_name = [n for n in z.namelist() if n.lower().endswith('.gpkg')][0]
        extracted_path = os.path.join('scratch', gpkg_name)
        if not os.path.exists(extracted_path):
            z.extract(gpkg_name, 'scratch')
            
    conn = sqlite3.connect(extracted_path)
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name})")
    cols = [col[1] for col in cursor.fetchall()]
    
    cursor.execute(f"SELECT * FROM {table_name} WHERE sg_uf=?", (uf,))
    rows = cursor.fetchall()
    
    locales_dict = {}
    for row in rows:
        row_dict = dict(zip(cols, row))
        try:
            zona = int(row_dict.get('nr_zona') or 0)
            local = int(row_dict.get('nr_locvot') or 0)
        except ValueError:
            continue
            
        if zona > 0 and local > 0:
            locales_dict[(zona, local)] = {
                'sg_uf': uf,
                'nr_zona': zona,
                'nr_locvot': local,
                'nm_localidade': row_dict.get('nm_localidade') or '',
                'nm_locvot': row_dict.get('nm_locvot') or '',
                'ds_endereco': row_dict.get('ds_endereco') or '',
                'ds_bairro': row_dict.get('ds_bairro') or '',
                'lat': float(row_dict.get('lat') or 0.0),
                'long': float(row_dict.get('long') or row_dict.get('longitude') or 0.0),
                'id_unico': row_dict.get('local_key') or row_dict.get('id_unico') or None
            }
            
    conn.close()
    LOCALES_CACHE[cache_key] = locales_dict
    return locales_dict

# Vote computation helper
def compute_turn_record(turno_name, votes, cand_names):
    nominal_votes = {k: int(v) for k, v in votes.items() if k not in ('95', '96', '97')}
    if not nominal_votes:
        return None
        
    sorted_cands = sorted(nominal_votes.items(), key=lambda x: (-x[1], x[0]))
    winner_num, winner_votes = sorted_cands[0]
    
    winner_info = cand_names.get(winner_num, [f"Candidato {winner_num}", "", "N/D", "", ""])
    winner_name = winner_info[0]
    winner_party = winner_info[1]
    winner_status = winner_info[2]
    
    total_valid = sum(nominal_votes.values())
    winner_pct = winner_votes / total_valid if total_valid > 0 else 0.0
    
    if len(sorted_cands) > 1:
        runner_num, runner_votes = sorted_cands[1]
        runner_info = cand_names.get(runner_num, [f"Candidato {runner_num}", "", "N/D", "", ""])
        runner_name = runner_info[0]
        runner_party = runner_info[1]
        runner_pct = runner_votes / total_valid if total_valid > 0 else 0.0
    else:
        runner_name = ""
        runner_party = ""
        runner_votes = 0
        runner_pct = 0.0
        
    margem_votos = winner_votes - runner_votes
    margem_pct = winner_pct - runner_pct
    
    brancos = int(votes.get('95', 0))
    nulos = int(votes.get('96', 0)) + int(votes.get('97', 0))
    comparecimento = total_valid + brancos + nulos
    
    return [
        turno_name,
        winner_name,
        winner_party,
        winner_status,
        winner_votes,
        winner_pct,
        runner_name,
        runner_party,
        runner_votes,
        runner_pct,
        margem_votos,
        margem_pct,
        total_valid,
        brancos,
        nulos,
        comparecimento
    ]

# Find ZIP helper
def find_results_zip(cargo, year, turn, uf):
    uf = uf.upper()
    if cargo == 'presidente':
        path = f"resultados_geo/Majoritarias {year}/presidente_{year}_t{turn}_{uf}.zip"
        if os.path.exists(path): return path
    elif cargo == 'governador':
        path1 = f"resultados_geo/Majoritarias {year}/governador_{year}_ord_t{turn}_{uf}.zip"
        path2 = f"resultados_geo/Majoritarias {year}/governador_{year}_t{turn}_{uf}.zip"
        if os.path.exists(path1): return path1
        if os.path.exists(path2): return path2
    elif cargo == 'senador':
        path1 = f"resultados_geo/Majoritarias {year}/senador_{year}_ord_t{turn}_{uf}.zip"
        path2 = f"resultados_geo/Majoritarias {year}/senador_{year}_t{turn}_{uf}.zip"
        if os.path.exists(path1): return path1
        if os.path.exists(path2): return path2
    elif cargo == 'prefeito':
        path1 = f"resultados_geo/Municipais {year}/prefeito_{year}_ord_t{turn}_{uf}.zip"
        path2 = f"resultados_geo/Municipais {year}/prefeito_{year}_t{turn}_{uf}.zip"
        if os.path.exists(path1): return path1
        if os.path.exists(path2): return path2
    return None

# Load results data helper
def load_results_for_year(cargo, year, uf):
    t1_path = find_results_zip(cargo, year, 1, uf)
    t2_path = find_results_zip(cargo, year, 2, uf)
    
    if not t1_path:
        return {}
        
    results = {}
    
    # Load turn 1
    with zipfile.ZipFile(t1_path) as z:
        name = z.namelist()[0]
        data_t1 = json.loads(z.read(name).decode('utf-8'))
        cand_names_t1 = data_t1['METADATA']['cand_names']
        results_t1 = data_t1['RESULTS']
        
    # Load turn 2 if exists
    cand_names_t2, results_t2 = {}, {}
    if t2_path:
        with zipfile.ZipFile(t2_path) as z:
            name = z.namelist()[0]
            data_t2 = json.loads(z.read(name).decode('utf-8'))
            cand_names_t2 = data_t2['METADATA']['cand_names']
            results_t2 = data_t2['RESULTS']
            
    # Combine keys
    all_keys = set(results_t1.keys()) | set(results_t2.keys())
    
    for key in all_keys:
        if '_S' in key: # skip synthetic keys
            continue
        parts = key.split('_')
        if len(parts) == 3:
            try:
                zona, cdmun, local = int(parts[0]), int(parts[1]), int(parts[2])
            except ValueError:
                continue
                
            votes_t1 = results_t1.get(key, {})
            votes_t2 = results_t2.get(key, {})
            
            turn_records = []
            rec_t1 = compute_turn_record('1T', votes_t1, cand_names_t1)
            if rec_t1:
                turn_records.append(rec_t1)
            rec_t2 = compute_turn_record('2T', votes_t2, cand_names_t2)
            if rec_t2:
                turn_records.append(rec_t2)
                
            if turn_records:
                results[(zona, local)] = {
                    'cdmun': cdmun,
                    'turn_records': turn_records,
                    'results_key': key
                }
                
    return results

# Core matching function
def match_and_append_records(history, new_results, locales, year, uf):
    identities = history.setdefault('identities', [])
    aliases = history.setdefault('aliases', {})
    
    # Map zone_local -> identity_idx from existing records
    zone_local_to_id = {}
    for idx, identity in enumerate(identities):
        for record in identity:
            r_zona, r_local = record[4], record[5]
            zone_local_to_id[(r_zona, r_local)] = idx
            
    # Process each new result
    for (zona, local), res in new_results.items():
        # Get details from locales GPKG
        loc_info = locales.get((zona, local))
        if not loc_info:
            continue # Skip non-geolocated
            
        # Prepare props for alias building
        props = {
            'sg_uf': uf,
            'id_unico': res['results_key'],
            'nr_zona': zona,
            'nr_locvot': local,
            'nm_localidade': loc_info['nm_localidade'],
            'nm_locvot': loc_info['nm_locvot'],
            'ds_bairro': loc_info['ds_bairro'],
            'ds_endereco': loc_info['ds_endereco'],
            'lat': loc_info['lat'],
            'long': loc_info['long']
        }
        
        computed_aliases = build_president_history_aliases(props)
        
        # Match identity index
        best_match_idx = None
        best_confidence = 0.0
        
        # 1. Alias matching
        for alias in computed_aliases:
            if alias in aliases:
                match_val = aliases[alias]
                id_idx = match_val[0]
                match_type_idx = match_val[1]
                match_type = MATCH_TYPES[match_type_idx]
                confidence = CONFIDENCE_BY_MATCH.get(match_type, 0.4)
                if confidence > best_confidence:
                    best_confidence = confidence
                    best_match_idx = id_idx
                    
        # 2. Zone/Local matching (very high confidence)
        if best_match_idx is None or best_confidence < 0.9:
            if (zona, local) in zone_local_to_id:
                best_match_idx = zone_local_to_id[(zona, local)]
                best_confidence = 0.9
                
        # Construct the new record
        new_record = [
            year,
            loc_info['nm_localidade'],
            loc_info['nm_locvot'],
            loc_info['ds_bairro'],
            zona,
            local,
            f"{zona}_{local}",
            res['turn_records']
        ]
        
        if best_match_idx is not None:
            # Append to existing identity
            identity = identities[best_match_idx]
            # Avoid duplicate year records
            existing_years = [r[0] for r in identity]
            if year not in existing_years:
                identity.append(new_record)
                identity.sort(key=lambda r: get_history_year_sort_value(r[0])) # keep ascending year order
        else:
            # Create new identity
            identities.append([new_record])
            best_match_idx = len(identities) - 1
            
        # Re-save aliases mapping for this new year record
        for alias in computed_aliases:
            # Choose best match type confidence
            match_type = 'local_key'
            for mt in MATCH_TYPES:
                if alias.startswith(mt + ":"):
                    match_type = mt
                    break
            match_type_idx = MATCH_TYPES.index(match_type)
            
            # If alias already exists, keep the one with higher confidence
            if alias in aliases:
                old_id, old_mt_idx = aliases[alias]
                old_mt = MATCH_TYPES[old_mt_idx]
                if CONFIDENCE_BY_MATCH.get(match_type, 0.4) > CONFIDENCE_BY_MATCH.get(old_mt, 0.4):
                    aliases[alias] = [best_match_idx, match_type_idx]
            else:
                aliases[alias] = [best_match_idx, match_type_idx]

# Compile cargo state level helper
def update_state_history(cargo, folder, file_prefix, new_years, uf):
    uf = uf.upper()
    zip_path = f"resultados_geo/{folder}/{file_prefix}_{uf}.zip"
    json_name = f"{file_prefix}_{uf}.json"
    
    # 1. Load existing history or start empty
    history = {}
    if os.path.exists(zip_path):
        with zipfile.ZipFile(zip_path) as z:
            history = json.loads(z.read(json_name).decode('utf-8'))
    else:
        history = {
            'schema': 2,
            'cargo': cargo,
            'uf': uf,
            'match_types': MATCH_TYPES,
            'years': [],
            'identities': [],
            'aliases': {}
        }
        
    history['years'] = sorted(list(set(normalize_year(y) for y in (list(history.get('years', [])) + list(new_years)))), key=get_history_year_sort_value)
    
    # 2. Process each new year
    for year in new_years:
        # Load locales
        locales = get_locales_for_uf_and_year(uf, year)
        # Load results
        new_results = load_results_for_year(cargo, year, uf)
        if not new_results:
            continue
            
        # Match and append
        match_and_append_records(history, new_results, locales, year, uf)
        
    # 3. Save JSON back into ZIP
    content = json.dumps(history, ensure_ascii=False, separators=(',', ':'))
    os.makedirs(os.path.dirname(zip_path), exist_ok=True)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(json_name, content)
    print(f"  Updated state history: {zip_path} (identities: {len(history['identities'])}, aliases: {len(history['aliases'])})")

# Compile prefeito municipal level helper
def update_prefeito_history(new_years, uf):
    uf = uf.upper()
    outer_zip_path = f"resultados_geo/Historico Prefeito/historico_prefeito_{uf}.zip"
    
    # If the state is DF, write an empty zip file as DF has no prefeitos
    if uf == 'DF':
        os.makedirs(os.path.dirname(outer_zip_path), exist_ok=True)
        with zipfile.ZipFile(outer_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('placeholder.txt', 'DF does not have municipalities')
        print(f"  Created placeholder for DF Prefeito history: {outer_zip_path}")
        return
        
    # 1. Gather all cdmun codes that have results in the new years
    cdmun_codes = set()
    for year in new_years:
        new_results = load_results_for_year('prefeito', year, uf)
        for (zona, local), res in new_results.items():
            cdmun_codes.add(res['cdmun'])
            
    # 2. Extract existing outer zip if it exists to get existing municipality histories
    existing_jsons = {}
    if os.path.exists(outer_zip_path):
        with zipfile.ZipFile(outer_zip_path) as z:
            for zip_name in z.namelist():
                if zip_name.endswith('.zip'):
                    # inner zip
                    with zipfile.ZipFile(z.open(zip_name)) as iz:
                        json_name = zip_name.replace('.zip', '.json')
                        existing_jsons[zip_name] = json.loads(iz.read(json_name).decode('utf-8'))
                        
    # 3. Also add existing municipality zip files to the processing list
    for zip_name in existing_jsons.keys():
        m = re.findall(r'\d+', zip_name)
        if m:
            cdmun_codes.add(int(m[0]))
            
    print(f"  Processing Prefeito for {uf}: {len(cdmun_codes)} municipalities")
    
    # 4. Process each municipality code
    updated_inner_zips = {}
    for cdmun in sorted(list(cdmun_codes)):
        inner_zip_name = f"historico_prefeito_{cdmun}.zip"
        inner_json_name = f"historico_prefeito_{cdmun}.json"
        
        history = existing_jsons.get(inner_zip_name)
        if not history:
            history = {
                'schema': 2,
                'cargo': 'prefeito',
                'uf': uf,
                'match_types': MATCH_TYPES,
                'years': [],
                'identities': [],
                'aliases': {}
            }
            
        history['years'] = sorted(list(set(normalize_year(y) for y in (list(history.get('years', [])) + list(new_years)))), key=get_history_year_sort_value)
        
        # Match for each new year
        for year in new_years:
            locales = get_locales_for_uf_and_year(uf, year)
            new_results = load_results_for_year('prefeito', year, uf)
            
            # Filter results for this municipality
            mun_results = {k: v for k, v in new_results.items() if v['cdmun'] == cdmun}
            if not mun_results:
                continue
                
            match_and_append_records(history, mun_results, locales, year, uf)
            
        # If we have no identities/records, skip creating it
        if not history['identities']:
            continue
            
        # Build inner zip bytes
        content = json.dumps(history, ensure_ascii=False, separators=(',', ':'))
        import io
        inner_zip_buffer = io.BytesIO()
        with zipfile.ZipFile(inner_zip_buffer, 'w', zipfile.ZIP_DEFLATED) as iz:
            iz.writestr(inner_json_name, content)
        updated_inner_zips[inner_zip_name] = inner_zip_buffer.getvalue()
        
    # 5. Save all inner zips back to the outer zip
    os.makedirs(os.path.dirname(outer_zip_path), exist_ok=True)
    with zipfile.ZipFile(outer_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for zip_name, zip_bytes in updated_inner_zips.items():
            z.writestr(zip_name, zip_bytes)
            
    print(f"  Updated Prefeito history: {outer_zip_path} (inner zips: {len(updated_inner_zips)})")

def main():
    target_ufs = ALL_UFS
    # Check if a list of UFs was passed as arg
    if len(sys.argv) > 1:
        target_ufs = [u.strip().upper() for u in sys.argv[1].split(',') if u.strip()]
        
    print(f"Starting history generation for UFs: {target_ufs}")
    
    for uf in target_ufs:
        print(f"\n===== Processing UF: {uf} =====")
        # 1. Presidente (1998, 2002)
        print("--- Presidente ---")
        update_state_history('presidente', 'Historico Presidente', 'historico_presidente', [1998, 2002], uf)
        
        # 2. Governador (1998, 2002)
        print("--- Governador ---")
        update_state_history('governador', 'Historico Governador', 'historico_governador', [1998, 2002], uf)
        
        # 3. Senador (1998, 2002)
        print("--- Senador ---")
        update_state_history('senador', 'Historico Senador', 'historico_senador', [1998, 2002], uf)
        
        # 4. Prefeito (2000, 2004)
        print("--- Prefeito ---")
        update_prefeito_history([2000, 2004], uf)
        
    print("\nHistory compilation finished successfully!")

if __name__ == '__main__':
    main()
