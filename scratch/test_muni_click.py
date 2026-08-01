import json
import glob
import os
import zipfile
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

print("--- Testing municipality name matching across years ---")

# Let's inspect how general data for AL (Alagoas) is loaded for each year in JS
# 1998, 2002, 2006, 2010, 2014, 2018, 2022
