import os
import zipfile
import pandas as pd
import json

BASE_DIR = r"c:\mapas\site eleições\resultados 2006"
OUTPUT_DIR = r"c:\mapas\site eleições\resultados_geo\Legislativas 2006"
ZIP_SOURCE = os.path.join(BASE_DIR, "quociente_eleitoral-brasil_2006.csv.zip")
JSON_OUTPUT = os.path.join(OUTPUT_DIR, "official_totals_2006.json")

def normalize_comp(comp_str):
    if not isinstance(comp_str, str): return ""
    # "PT / PSB / PC do B" -> "PC DO B/PSB/PT"
    parts = [p.strip().upper() for p in comp_str.split('/')]
    parts.sort()
    return "/".join(parts)

def generate_official_totals():
    print("Generating Official Totals 2006...")
    
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        
    data = {} # { UF: { CODE_CARGO: { stats: ..., coalitions: [] } } }
    
    if not os.path.exists(ZIP_SOURCE):
        print(f"File not found: {ZIP_SOURCE}")
        return

    try:
        with zipfile.ZipFile(ZIP_SOURCE, 'r') as z:
            # Find csv
            target = [f for f in z.namelist() if f.endswith('.csv')][0]
            with z.open(target) as f:
                df = pd.read_csv(f, sep=';', encoding='latin1', on_bad_lines='skip')
                
                cols = df.columns
                if 'UF' in cols and 'ds_cargo' in cols:
                    # Group by UF, Cargo
                    grouped = df.groupby(['UF', 'ds_cargo'])
                    
                    for (uf, cargo_desc), group in grouped:
                        if uf not in data: data[uf] = {}
                        
                        # Determine key
                        if 'FEDERAL' in cargo_desc.upper(): key = 'f'
                        elif 'ESTADUAL' in cargo_desc.upper(): key = 'e'
                        elif 'DISTRITAL' in cargo_desc.upper(): key = 'e'
                        else: continue
                        
                        # Stats (from first row)
                        first = group.iloc[0]
                        stats = {
                            "qt_vagas": int(first.get('qt_vagas_qe', 0) if pd.notnull(first.get('qt_vagas_qe')) else 0),
                            "vr_qe": int(first.get('vr_quociente_eleitoral', 0) if pd.notnull(first.get('vr_quociente_eleitoral')) else 0),
                            "qt_votos_validos": int(first.get('qt_votos_validos_qe', 0) if pd.notnull(first.get('qt_votos_validos_qe')) else 0)
                        }
                        
                        coalitions = []
                        for _, row in group.iterrows():
                            votes = int(row.get('Votos válidos composição', 0) if pd.notnull(row.get('Votos válidos composição')) else 0)
                            elected_qp = int(row.get('Eleitas e eleitos por QP', 0) if pd.notnull(row.get('Eleitas e eleitos por QP')) else 0)
                            elected_media = int(row.get('Eleitas e eleitos por média', 0) if pd.notnull(row.get('Eleitas e eleitos por média')) else 0)
                            total_elected = elected_qp + elected_media
                            comp = str(row.get('ds_composicao_coligacao', ''))
                            
                            coalitions.append({
                                "id": normalize_comp(comp),
                                "raw_comp": comp,
                                "votes": votes,
                                "elected": total_elected,
                                "elected_qp": elected_qp,
                                "elected_avg": elected_media,
                                "vagas_qp": int(row.get('Vagas QP', 0) if pd.notnull(row.get('Vagas QP')) else 0)
                            })
                        
                        coalitions.sort(key=lambda x: x['votes'], reverse=True)
                        
                        data[uf][key] = {
                            "stats": stats,
                            "coalitions": coalitions
                        }

        with open(JSON_OUTPUT, 'w', encoding='utf-8') as f:
            json.dump(data, f)
            
        print(f"Saved to {JSON_OUTPUT}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    generate_official_totals()
