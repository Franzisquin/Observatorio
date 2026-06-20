import zipfile
import os
import csv
from collections import defaultdict

DADOS_DIR = r"E:\Mapas\Dados"
zip_path = os.path.join(DADOS_DIR, "votacao_candidato_munzona_2004.zip")

if os.path.exists(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        names = [n for n in zf.namelist() if "RJ" in n.upper()]
        if names:
            text = zf.read(names[0]).decode('latin-1')
            lines = text.splitlines()
            
            delim = ';' if text[:5000].count(';') >= text[:5000].count(',') else ','
            reader = csv.reader(lines, delimiter=delim)
            
            # Map: cdmun -> {colig_seq -> set(sigla)}
            mun_seq_parties = defaultdict(lambda: defaultdict(set))
            for row in reader:
                if len(row) < 13:
                    continue
                c = None
                for i in range(10, len(row)):
                    if row[i].upper() in ('PREFEITO', 'VEREADOR'):
                        c = i
                        break
                if c is None:
                    continue
                
                suffix_len = len(row) - 1 - c
                if suffix_len >= 12:
                    cdmun = row[7]
                    colig_seq = row[c + 10]
                    colig = row[c + 11]
                    sigla = row[c + 8]
                    if colig == '#NULO#':
                        mun_seq_parties[cdmun][colig_seq].add(sigla)
            
            # Print sequence numbers that group more than one party in a municipality
            count = 0
            for cdmun, seq_map in mun_seq_parties.items():
                for seq, parties in seq_map.items():
                    if len(parties) > 1:
                        print(f"Muni {cdmun}, Seq {seq} groups multiple parties: {parties}")
                        count += 1
                        if count > 20:
                            break
                if count > 20:
                    break
            if count == 0:
                print("No colig_seq groups multiple parties when colig is #NULO#.")
