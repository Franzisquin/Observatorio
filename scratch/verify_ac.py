import zipfile
import json
import os

def check_history(zip_path, json_name, cargo_name):
    print(f"\n--- Checking {cargo_name} ({zip_path}) ---")
    if not os.path.exists(zip_path):
        print("File does not exist!")
        return
    with zipfile.ZipFile(zip_path) as z:
        data = json.loads(z.read(json_name).decode('utf-8'))
        print("Years:", data['years'])
        print("Total identities:", len(data['identities']))
        
        # Count records by year
        year_counts = {}
        for identity in data['identities']:
            for record in identity:
                year = record[0]
                year_counts[year] = year_counts.get(year, 0) + 1
        print("Record counts by year:", sorted(year_counts.items()))
        
        # Print a sample identity with a new year record
        sample = None
        for identity in data['identities']:
            years = [r[0] for r in identity]
            if any(y in (1998, 2002, 2000, 2004) for y in years):
                sample = identity
                break
        if sample:
            print("Sample identity with new year records:")
            for r in sample:
                # Print summary of turns
                turn_summaries = []
                for turn in r[7]:
                    turn_summaries.append(f"{turn[0]}: {turn[1]} ({turn[2]}) {turn[3]} - votes: {turn[4]}, pct: {turn[5]:.2%}, margin: {turn[11]:.2%}")
                print(f"  {r[0]} | {r[1]} | {r[2]} | {r[6]} | turns: {', '.join(turn_summaries)}")
        else:
            print("No identities found with new year records!")

check_history(
    "resultados_geo/Historico Presidente/historico_presidente_AC.zip",
    "historico_presidente_AC.json",
    "Presidente"
)

check_history(
    "resultados_geo/Historico Governador/historico_governador_AC.zip",
    "historico_governador_AC.json",
    "Governador"
)

check_history(
    "resultados_geo/Historico Senador/historico_senador_AC.zip",
    "historico_senador_AC.json",
    "Senador"
)

# For Prefeito, inspect one of the inner zips
print("\n--- Checking Prefeito (resultados_geo/Historico Prefeito/historico_prefeito_AC.zip) ---")
outer_path = "resultados_geo/Historico Prefeito/historico_prefeito_AC.zip"
with zipfile.ZipFile(outer_path) as z:
    inners = z.namelist()
    print("Total inner municipality zips:", len(inners))
    if inners:
        inner_name = inners[0]
        print("Inspecting inner zip:", inner_name)
        with zipfile.ZipFile(z.open(inner_name)) as iz:
            json_name = inner_name.replace('.zip', '.json')
            data = json.loads(iz.read(json_name).decode('utf-8'))
            print("Years:", data['years'])
            print("Total identities:", len(data['identities']))
            year_counts = {}
            for identity in data['identities']:
                for record in identity:
                    year = record[0]
                    year_counts[year] = year_counts.get(year, 0) + 1
            print("Record counts by year:", sorted(year_counts.items()))
