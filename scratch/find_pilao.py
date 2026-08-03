import os
import json
import sqlite3
import zipfile

workspace = r"c:\mapas\Observatorio"

def search_in_file(filepath):
    try:
        if filepath.endswith('.json') or filepath.endswith('.js') or filepath.endswith('.csv'):
            with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
                if 'arcado' in content.lower() or 'pil' in content.lower():
                    lines = content.splitlines()
                    for idx, l in enumerate(lines):
                        if 'arcado' in l.lower() or 'pilã' in l.lower() or 'pil' in l.lower():
                            if 'pil' in l.lower() and ('arc' in l.lower() or 'a' in l.lower()):
                                print(f"Found in {filepath}:{idx+1}: {repr(l[:200])}")
        elif filepath.endswith('.gpkg'):
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()
            # check tables
            tables = cursor.execute("SELECT name FROM sqlite_master WHERE type='table';").fetchall()
            for t in tables:
                tname = t[0]
                try:
                    rows = cursor.execute(f"SELECT * FROM {tname} WHERE LOWER(CAST(name AS TEXT)) LIKE '%arcado%' OR LOWER(CAST(NM_MUN AS TEXT)) LIKE '%arcado%' OR LOWER(CAST(NM_MUNICIPIO AS TEXT)) LIKE '%arcado%' LIMIT 5;").fetchall()
                    if rows:
                        print(f"Found in GPKG {filepath} table {tname}: {rows}")
                except Exception:
                    pass
            conn.close()
    except Exception as e:
        print(f"Error checking {filepath}: {e}")

for root, dirs, files in os.walk(workspace):
    if '.git' in root or 'scratch' in root:
        continue
    for file in files:
        search_in_file(os.path.join(root, file))
