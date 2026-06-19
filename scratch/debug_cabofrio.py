import zipfile
import sqlite3
import json
import os

# 1. Load Cabo Frio 2000 Prefeito JSON RESULTS
zip_json_path = 'resultados_geo/Municipais 2000/prefeito_2000_ord_t1_RJ.zip'
with zipfile.ZipFile(zip_json_path, 'r') as z:
    ord1_json = json.loads(z.read('58130_CABO_FRIO.json'))

# 2. Extract and connect to 2006 GPKG database
extracted_gpkg = 'resultados_geo/locais_votacao_2006.gpkg'
conn = sqlite3.connect(extracted_gpkg)
cursor = conn.cursor()

# Query locations in Cabo Frio
cursor.execute("""
    SELECT sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot,
           ds_endereco, ds_bairro, long, lat, tipo_match
    FROM locais_votacao_2006_padronizado 
    WHERE sg_uf = 'RJ' AND UPPER(nm_localidade) = 'CABO FRIO'
""")
rows = cursor.fetchall()
conn.close()

# 3. Build features dynamically (buildMunicipal2008Feature)
features = []
muniCode = '58130'
resultKeys = set(ord1_json['RESULTS'].keys())

for row in rows:
    sg_uf, cod_localidade_ibge, nr_zona, nr_locvot, nm_localidade, nm_locvot, ds_endereco, ds_bairro, longitude, latitude, tipo_match = row
    zoneLocalKey = f"{nr_zona}_{nr_locvot}"
    fullLocalKey = f"{nr_zona}_{muniCode}_{nr_locvot}"
    
    # Check if this location is in resultKeys (filterMunicipalFeatures2008)
    if fullLocalKey not in resultKeys:
        continue
        
    features.append({
        'type': 'Feature',
        'properties': {
            'local_id': zoneLocalKey,
            'id_unico': fullLocalKey,
            'ID_UNICO': fullLocalKey,
            'local_key': fullLocalKey,
            'ano': 2000,
            'sg_uf': sg_uf,
            'cd_localidade_tse': muniCode,
            'cod_localidade_ibge': cod_localidade_ibge,
            'nr_zona': nr_zona,
            'nr_locvot': nr_locvot,
            'nm_localidade': nm_localidade,
            'nm_locvot': nm_locvot,
            'ds_endereco': ds_endereco,
            'ds_bairro': ds_bairro,
            'long': longitude,
            'lat': latitude,
        }
    })

print(f"Loaded base features count: {len(features)}")

# 4. Simulate applyPrefeitoJsonToGeojson2024
metadata = ord1_json.get('METADATA', {}).get('cand_names', {})
turnoKey = '1T'

for feat in features:
    props = feat['properties']
    resultKey = props.get('id_unico') or props.get('local_key') or ''
    votes = ord1_json['RESULTS'].get(resultKey)
    if not votes:
        continue
    
    # applyTurnMetricsFromJsonVotes metrics
    props[f'NR_TURNO {turnoKey}'] = 1
    
    # Merge candidates
    for candidateId, rawVotes in votes.items():
        if candidateId in ('95', '96'):
            continue
        cand_meta = metadata.get(candidateId)
        if not cand_meta:
            continue
        nome = cand_meta[0] if cand_meta[0] else f"Candidato {candidateId}"
        partido = cand_meta[1] if cand_meta[1] else "?"
        status = cand_meta[2] if cand_meta[2] else "N/D"
        candidateKey = f"{nome} ({partido}) ({status}) {turnoKey}"
        props[candidateKey] = int(rawVotes)

# 5. Simulate discoverCandidatesAndMetrics
allKeys = set()
for feat in features:
    for k in feat['properties'].keys():
        allKeys.add(k)

candidates = []
METRIC_NAMES = [
    'Total_Votos_Validos', 'Votos_Brancos', 'Votos_Nulos',
    'Eleitores_Aptos', 'Eleitores_Aptos_Municipal',
    'Abstenções', 'Comparecimento', 'Votos_Legenda', 'NR_TURNO'
]

for key in allKeys:
    if not key.endswith(f" {turnoKey}"):
        continue
    coreKey = key[:-3] # remove ' 1T'
    isMetric = any(coreKey.upper() == m.upper() for m in METRIC_NAMES)
    if not isMetric:
        candidates.append(key)

print("Discovered candidates:", candidates)

# Check one feature properties
sample_feat = features[0]['properties']
print("\nSample feature properties:")
for k, v in sample_feat.items():
    if '1T' in k:
        print(f"  {k}: {v}")

# Simulate getVotosValidos on sample feature
print("\nSimulating getVotosValidos on sample feature:")
soma = 0
for cand_key in candidates:
    # getProp simulation (case insensitive)
    val = sample_feat.get(cand_key)
    print(f"  getProp('{cand_key}') = {val}")
    if val is not None:
        soma += val
print(f"  soma = {soma}")
