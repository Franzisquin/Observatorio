import os
import json
import re

workspace = r"c:\mapas\Observatorio"

corruptions_found = []

for root, dirs, files in os.walk(workspace):
    if '.git' in root or 'node_modules' in root or 'scratch' in root:
        continue
    for file in files:
        filepath = os.path.join(root, file)
        ext = os.path.splitext(file)[1].lower()
        if ext in ['.json', '.js', '.html', '.css', '.md', '.csv', '.txt', '.py', '.geojson']:
            try:
                with open(filepath, 'rb') as f:
                    content_bytes = f.read()
                
                # Check 1: \ufffd or  in raw bytes or utf-8 string
                if b'\xef\xbf\xbd' in content_bytes:
                    count = content_bytes.count(b'\xef\xbf\xbd')
                    # Find some context lines
                    text = content_bytes.decode('utf-8', errors='replace')
                    bad_lines = [line.strip() for line in text.splitlines() if '' in line or '\ufffd' in line]
                    corruptions_found.append({
                        'file': filepath,
                        'type': 'replacement_char_EFBFBD',
                        'count': count,
                        'samples': bad_lines[:5]
                    })
                
                # Check 2: Raw control chars (\x00-\x08, \x0b-\x0c, \x0e-\x1f)
                # Excluding \r, \n, \t
                bad_control_matches = re.findall(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]', content_bytes)
                if bad_control_matches:
                    corruptions_found.append({
                        'file': filepath,
                        'type': 'control_chars',
                        'count': len(bad_control_matches),
                        'hexes': set(hex(b) for b in bad_control_matches)
                    })

                # Check 3: UTF-8 decode error
                try:
                    text_utf8 = content_bytes.decode('utf-8')
                except UnicodeDecodeError as e:
                    corruptions_found.append({
                        'file': filepath,
                        'type': 'invalid_utf8_encoding',
                        'error': str(e)
                    })
                    continue

                # Check 4: Latin-1 / Windows-1252 double encoding (mojibake)
                # Common patterns in Portuguese: Ã¡, Ã©, Ã³, Ãº, Ã£, Ãµ, Ã§, Ã, Ã, Ã, Ã, Ã, Ã, Ã, Ã, Ã
                mojibake_matches = re.findall(r'(?:Ã[¡éóúãõ§ÀÁÂÃÉÊÍÓÔÕÚÇàáâãéêíóôõúç]|Ã\s|Â[°º]|Ã¢|Ãª)', text_utf8)
                if mojibake_matches:
                    corruptions_found.append({
                        'file': filepath,
                        'type': 'mojibake',
                        'count': len(mojibake_matches),
                        'samples': mojibake_matches[:5]
                    })

            except Exception as ex:
                print(f"Error reading {filepath}: {ex}")

print(f"TOTAL CORRUPTED FILES FOUND: {len(corruptions_found)}")
print(json.dumps(corruptions_found, indent=2, ensure_ascii=False))
