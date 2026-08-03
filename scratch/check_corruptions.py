import os
import re
import zipfile
import json
import sqlite3

workspace = r"c:\mapas\Observatorio"

def scan_text_file(filepath):
    try:
        with open(filepath, 'rb') as f:
            content_bytes = f.read()
        
        # Check if invalid UTF-8
        try:
            text = content_bytes.decode('utf-8')
        except UnicodeDecodeError as e:
            print(f"[INVALID UTF-8 FILE] {filepath}: {e}")
            return

        # Check for control characters (like \x00-\x08, \x0b-\x0c, \x0e-\x1f)
        matches = re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', text)
        if matches:
            char_hexes = set(hex(ord(c)) for c in matches)
            print(f"[CONTROL CHARS] {filepath}: found characters {char_hexes}")

        # Check for common Mojibake patterns (e.g. UTF-8 decoded as Latin-1 or double UTF-8)
        # e.g., 'Ã§', 'Ã£', 'Ã¡', 'Ã©', 'Ã³', 'Ãº', 'Ã', 'â€', 'ï¿½', ''
        mojibake = re.findall(r'(?:Ã[§£¡©³ºÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]|â€“|â€”|â€™|â€œ|â€|ï¿½|\ufffd)', text)
        if mojibake:
            print(f"[MOJIBAKE] {filepath}: found sample {mojibake[:5]} (total {len(mojibake)})")
            
    except Exception as ex:
        pass

def scan_zip(filepath):
    try:
        with zipfile.ZipFile(filepath, 'r') as z:
            for filename in z.namelist():
                if filename.endswith('.json') or filename.endswith('.geojson') or filename.endswith('.csv') or filename.endswith('.txt'):
                    with z.open(filename) as f:
                        content_bytes = f.read()
                        try:
                            text = content_bytes.decode('utf-8')
                            matches = re.findall(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', text)
                            if matches:
                                char_hexes = set(hex(ord(c)) for c in matches)
                                print(f"[CONTROL CHARS IN ZIP] {filepath} -> {filename}: {char_hexes}")
                            mojibake = re.findall(r'(?:Ã[§£¡©³ºÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]|â€“|â€”|â€™|â€œ|â€|ï¿½|\ufffd)', text)
                            if mojibake:
                                print(f"[MOJIBAKE IN ZIP] {filepath} -> {filename}: sample {mojibake[:5]}")
                        except UnicodeDecodeError:
                            print(f"[INVALID UTF-8 IN ZIP] {filepath} -> {filename}")
    except Exception as ex:
        pass

print("Starting scan...")
for root, dirs, files in os.walk(workspace):
    # skip .git, node_modules
    if '.git' in root or 'node_modules' in root:
        continue
    for file in files:
        filepath = os.path.join(root, file)
        ext = os.path.splitext(file)[1].lower()
        if ext in ['.js', '.json', '.html', '.css', '.geojson', '.py', '.txt', '.md', '.csv']:
            scan_text_file(filepath)
        elif ext in ['.zip']:
            scan_zip(filepath)

print("Scan complete.")
