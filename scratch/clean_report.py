import os
import json
import re

workspace = r"c:\mapas\Observatorio"

def scan_all():
    report = []
    for root, dirs, files in os.walk(workspace):
        # Skip git, node_modules, temp_mt_zip, scratch
        if '.git' in root or 'node_modules' in root or 'temp_mt_zip' in root or 'scratch' in root or 'resultados_geo_backup' in root:
            continue
        for file in files:
            filepath = os.path.join(root, file)
            ext = os.path.splitext(file)[1].lower()
            if ext in ['.js', '.json', '.html', '.css', '.md', '.csv', '.txt', '.py', '.geojson']:
                try:
                    with open(filepath, 'rb') as f:
                        b = f.read()
                    
                    utf8_ok = True
                    try:
                        text = b.decode('utf-8')
                    except UnicodeDecodeError:
                        utf8_ok = False
                        text = b.decode('utf-8', errors='replace')
                    
                    rep_chars = b.count(b'\xef\xbf\xbd') + text.count('\ufffd')
                    
                    # control chars
                    ctrl = len(re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', text))
                    
                    if not utf8_ok or rep_chars > 0 or ctrl > 0:
                        rel = os.path.relpath(filepath, workspace)
                        report.append({
                            'file': rel,
                            'utf8_valid': utf8_ok,
                            'replacement_chars': rep_chars,
                            'control_chars': ctrl
                        })
                except Exception as e:
                    print(f"Err {filepath}: {e}")
    return report

rep = scan_all()
print(f"Total non-clean files in workspace: {len(rep)}")
for r in rep:
    print(r)
