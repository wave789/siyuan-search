"""Build a SiYuan archive with plugin files at the ZIP root (no enclosing folder)."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
manifest = json.loads((dist / "plugin.json").read_text())
for required in ("index.js", "index.css", "plugin.json", "README.md", "LICENSE"):
    if not (dist / required).is_file():
        raise SystemExit(f"Missing dist/{required}; run npm run build first")
archive = root / f"{manifest['name']}-{manifest['version']}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for file in sorted(dist.rglob("*")):
        if file.is_file() and not file.name.startswith(".") and not file.name.endswith(".map"):
            package.write(file, file.relative_to(dist))
print(f"Plugin package: {archive}")
