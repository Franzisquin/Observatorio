import json
import zipfile
import glob
import os
import sqlite3
import re

def norm(text):
    if not text: return ""
    text = str(text).upper()
    replacements = {
        'Á':'A', 'À':'A', 'Â':'A', 'Ã':'A', 'Ä':'A',
        'É':'E', 'È':'E', 'Ê':'E', 'Ë':'E',
        'Í':'I', 'Ì':'I', 'Î':'I', 'Ï':'I',
        'Ó':'O', 'Ò':'O', 'Ô':'O', 'Õ':'O', 'Ö':'O',
        'Ú':'U', 'Ù':'U', 'Û':'U', 'Ü':'U',
        'Ç':'C', 'Ñ':'N'
    }
    for k, v in replacements.items():
        text = text.replace(k, v)
    text = re.sub(r'[^A-Z0-9]', '', text)
    return text

print("--- Inspecting JS loader logic for AL for each year ---")

# Let's inspect how JS loads 2022 Presidente for AL
# Check data-geral-2022.js, 2018, 2014, 2010, 2006, 2002, 1998
# For 2022: loadMajoritariaCargo2022 loads president JSON + GPKG / zip
