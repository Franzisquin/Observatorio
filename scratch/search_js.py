import os

js_dir = r"c:\Users\lixov\OneDrive\Documentos\Observatorio\js"
for fn in os.listdir(js_dir):
    if not fn.endswith(".js"):
        continue
    fp = os.path.join(js_dir, fn)
    with open(fp, "r", encoding="utf-8", errors="ignore") as f:
        for i, line in enumerate(f, 1):
            if "function filterMunicipalFeatures2008" in line or "filterMunicipalFeatures2008 =" in line:
                print(f"{fn} Line {i}: {line.strip()}")
