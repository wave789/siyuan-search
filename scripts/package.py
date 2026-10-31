"""Build a SiYuan archive with plugin files at the ZIP root (no enclosing folder)."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import shutil

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
manifest = json.loads((dist / "plugin.json").read_text())
source_manifest = json.loads((root / "plugin.json").read_text())
if manifest != source_manifest:
    raise SystemExit("dist/plugin.json is out of date; run npm run build first")
required_files = {"index.js", "index.css", "plugin.json", "LICENSE", *manifest["readme"].values()}
required_files.update(manifest[key] for key in ("icon", "preview") if manifest.get(key))
for required in sorted(required_files):
    if not (dist / required).is_file():
        raise SystemExit(f"Missing dist/{required}; run npm run build first")
archive = root / f"{manifest['name']}-{manifest['version']}.zip"
with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for file in sorted(dist.rglob("*")):
        if file.is_file() and not file.name.startswith(".") and not file.name.endswith(".map"):
            package.write(file, file.relative_to(dist))
marketplace_archive = root / "package.zip"
shutil.copyfile(archive, marketplace_archive)
print(f"Plugin package: {archive}")
print(f"Marketplace upload: {marketplace_archive}")
