import zipfile
import json
import re

# Mock of ensureNumber
def ensure_number(v):
    if v is None:
        return 0
    try:
        return float(str(v).replace(',', '.'))
    except:
        return 0

# Mock of parseCandidateKey
def parse_candidate_key(key):
    result = {"nome": "N/D", "partido": "N/D", "status": "N/D", "key": key}
    turno_match = re.search(r' (1T|2T)$', key)
    core_key = re.sub(r' (1T|2T)$', '', key)
    status_matches = re.findall(r'\((.*?)\)', core_key)
    if not status_matches:
        result["nome"] = core_key
        return result
    
    party = status_matches[0]
    # We find where first parentheses start to get name
    idx = core_key.find('(')
    name = core_key[:idx].strip()
    result["partido"] = party
    result["nome"] = name
    
    all_status = [s.upper() for s in status_matches[1:]]
    if 'INAPTO' in all_status:
        result["status"] = 'INAPTO'
    elif '2° TURNO' in all_status or '2º TURNO' in all_status:
        result["status"] = '2° TURNO'
    elif any(s.startswith('ELEITO') for s in all_status):
        result["status"] = 'ELEITO'
    elif 'NÃO ELEITO' in all_status:
        result["status"] = 'NÃO ELEITO'
    elif all_status:
        result["status"] = all_status[0]
    return result

# Mock of discoverCandidatesAndMetrics
def discover_candidates_and_metrics(geojson):
    local_state = {
        'candidates': {'1T': [], '2T': []},
        'metrics': {'1T': [], '2T': []},
        'inaptos': {'1T': [], '2T': []},
        'dataHas2T': False,
        'dataHasInaptos': False
    }
    
    all_keys = set()
    sample_size = min(len(geojson['features']), 1000)
    for i in range(sample_size):
        props = geojson['features'][i].get('properties', {})
        for key in props.keys():
            all_keys.add(key)
            
    METRIC_NAMES = [
        'Total_Votos_Validos', 'Votos_Brancos', 'Votos_Nulos',
        'Eleitores_Aptos', 'Eleitores_Aptos_Municipal',
        'Abstenções', 'Comparecimento', 'Votos_Legenda', 'NR_TURNO'
    ]
    
    for key in all_keys:
        turno_match = re.search(r' (1T|2T)$', key)
        if not turno_match:
            continue
            
        turno = turno_match.group(1)
        if turno == '2T':
            local_state['dataHas2T'] = True
            
        core_key = re.sub(r' (1T|2T)$', '', key)
        is_metric = any(core_key.upper() == m.upper() for m in METRIC_NAMES)
        
        if is_metric:
            local_state['metrics'][turno].append(key)
        else:
            local_state['candidates'][turno].append(key)
            cand = parse_candidate_key(key)
            if cand['status'] == 'INAPTO':
                local_state['inaptos'][turno].append(key)
                local_state['dataHasInaptos'] = True
                
    local_state['candidates']['1T'].sort()
    local_state['candidates']['2T'].sort()
    return local_state

def simulate(zip_path, json_name, city_name, muni_code):
    print(f"\n=== Simulating for {city_name} ===")
    with zipfile.ZipFile(zip_path, 'r') as z:
        full_json = json.loads(z.read(json_name))
        
    # Create mock geojson base map
    # We will simulate having a few mock features matching results keys
    results_keys = list(full_json.get('RESULTS', {}).keys())
    features = []
    for rk in results_keys:
        features.append({
            'type': 'Feature',
            'properties': {
                'id_unico': rk,
                'local_key': rk
            }
        })
    geojson = {'type': 'FeatureCollection', 'features': features}
    
    # 1. Apply prefeito JSON
    metadata = full_json.get('METADATA', {}).get('cand_names', {})
    for feature in geojson['features']:
        props = feature['properties']
        result_key = props['id_unico']
        votes = full_json['RESULTS'].get(result_key)
        if not votes:
            continue
            
        for cand_id, raw_votes in votes.items():
            if cand_id in ('95', '96'):
                continue
            cand_meta = metadata.get(cand_id)
            if not cand_meta:
                continue
            nome = cand_meta[0] or f"Candidato {cand_id}"
            partido = cand_meta[1] or "?"
            status = cand_meta[2] or "N/D"
            # 1T
            cand_key = f"{nome} ({partido}) ({status}) 1T"
            props[cand_key] = ensure_number(raw_votes)
            
    # 2. Discover Candidates
    res = discover_candidates_and_metrics(geojson)
    print("Discovered candidates 1T:", res['candidates']['1T'])
    print("Discovered candidates 2T:", res['candidates']['2T'])

simulate('resultados_geo/Municipais 2000/prefeito_2000_ord_t1_BA.zip', '35157_FEIRA_DE_SANTANA.json', 'Feira de Santana', '35157')
simulate('resultados_geo/Municipais 2000/prefeito_2000_ord_t1_MA.zip', '9210_SAO_LUIS.json', 'São Luís', '9210')
