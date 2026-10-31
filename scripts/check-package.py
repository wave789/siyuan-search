"""Validate the local marketplace artifact; no network or third-party Python packages."""
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile, BadZipFile
import json
import re
import sys


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check(archive, root):
    source = json.loads((root / "plugin.json").read_text())
    with ZipFile(archive) as package:
        require(package.testzip() is None, "ZIP integrity check failed")
        names = package.namelist()
        require(len(names) == len(set(names)), "ZIP contains duplicate paths")
        for name in names:
            path = PurePosixPath(name)
            require(not path.is_absolute() and ".." not in path.parts and "\\" not in name, f"Invalid ZIP path: {name}")
            require(not name.endswith(".map"), f"Source maps should stay out of the install package: {name}")
        require("plugin.json" in names, "Missing plugin.json at the ZIP root")
        manifest = json.loads(package.read("plugin.json"))
        require(manifest == source, "Packaged plugin.json differs from the current source")
        version = manifest["version"]
        require(re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", version), "Invalid plugin version")
        repo = urlsplit(manifest["url"])
        require(repo.scheme == "https" and repo.hostname == "github.com", "Plugin URL must point to the GitHub repository")
        require(repo.path.rstrip("/").split("/")[-1] == manifest["name"], "Plugin name must match the repository name")
        require(bool(manifest["author"].strip()), "Missing plugin author")
        for field in ("displayName", "description", "readme"):
            localized = manifest[field]
            require(isinstance(localized, dict) and bool(localized.get("default")), f"Missing {field}.default")
            require(all("_" not in key for key in localized), f"Use locale keys such as zh-CN in {field}")
        for file in {"index.js", "index.css", "LICENSE", *manifest["readme"].values()}:
            require(file in names and bool(package.read(file).strip()), f"Missing or empty package file: {file}")
        for field, limit in (("icon", 64 * 1024), ("preview", 512 * 1024)):
            file = manifest.get(field)
            if not file:
                continue
            require(PurePosixPath(file).name == file, f"{field} must be at the package root")
            require(file in names, f"Declared {field} is missing: {file}")
            require(Path(file).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".avif"}, f"Unsupported {field} image format")
            require(len(package.read(file)) <= limit, f"{field} image exceeds {limit // 1024} KiB")
        for readme in set(manifest["readme"].values()):
            text = package.read(readme).decode("utf-8")
            for image in re.findall(r"!\[[^\]]*\]\(([^\s)]+)", text):
                url = urlsplit(image)
                if not url.scheme and not url.netloc:
                    relative = (PurePosixPath(readme).parent / unquote(url.path)).as_posix()
                    require(relative in names, f"README image is missing from the package: {relative}")
        for name in names:
            require(package.read(name) == (root / "dist" / name).read_bytes(), f"Package differs from dist: {name}")
            source_file = root / name
            if source_file.is_file():
                require(package.read(name) == source_file.read_bytes(), f"Packaged resource is out of date: {name}")
    for name in ("package.json", "package-lock.json"):
        require(json.loads((root / name).read_text())["version"] == version, f"Version mismatch in {name}")
    lock = json.loads((root / "package-lock.json").read_text())
    require(lock["packages"][""]["version"] == version, "Version mismatch in lockfile root package")
    versioned = root / f'{source["name"]}-{version}.zip'
    require(archive.read_bytes() == versioned.read_bytes(), "Marketplace and versioned ZIP files differ")
    print(f"Validated {archive.name}: {source['name']} {version}, {len(names)} files, {archive.stat().st_size:,} bytes")
    print("Manifest, version fields, declared images, README images, LICENSE and bundled resources match the current source.")


if __name__ == "__main__":
    project = Path(__file__).resolve().parent.parent
    target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else project / "package.zip"
    try:
        check(target, project)
    except (OSError, ValueError, KeyError, BadZipFile) as error:
        raise SystemExit(f"Package validation failed: {error}") from error
