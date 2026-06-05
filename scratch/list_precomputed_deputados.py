import os

folder = r"c:\mapas\Observatorio\resultados_geo\Legislativas 2002"
if os.path.exists(folder):
    print("Files in Legislativas 2002:")
    files = os.listdir(folder)
    for f in sorted(files):
        if "deputado" in f.lower() or "precomputed" in f.lower():
            print("  -", f)
else:
    print("Folder not found:", folder)
