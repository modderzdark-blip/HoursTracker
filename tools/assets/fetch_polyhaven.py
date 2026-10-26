#!/usr/bin/env python3
"""Downloads CC0 assets from Poly Haven (https://polyhaven.com) for the arenas.

Runs in CI (.github/workflows/fetch-assets.yml): the development container cannot reach
Poly Haven, GitHub's runners can. Reads a manifest (tools/assets/polyhaven.json) and writes:

  <out>/polyhaven-catalog.zip  catalog.json (every texture and model with its categories and
                               tags) + a 256 px thumbnail per asset, when "catalog" is true;
  <out>/polyhaven-assets.zip   for each manifest entry, the glTF file at the requested
                               resolution and every file it includes (textures, .bin), checked
                               against the published MD5 sums.

API terms: https://github.com/Poly-Haven/Public-API/blob/master/ToS.md (free for any use;
requests must carry a user agent naming the software). The assets themselves are CC0.
"""

import concurrent.futures
import hashlib
import json
import pathlib
import sys
import time
import urllib.request
import zipfile

API = "https://api.polyhaven.com"
USER_AGENT = "Ashbound-asset-fetch/1.0 (+https://github.com/modderzdark-blip/HoursTracker)"


def fetch(url: str, attempts: int = 4) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - network errors of any kind are retried
            if i == attempts - 1:
                raise RuntimeError(f"{url}: {e}") from e
            time.sleep(2 ** (i + 1))
    raise AssertionError("unreachable")


def fetch_json(path: str):
    return json.loads(fetch(API + path))


def build_catalog(out: pathlib.Path) -> None:
    entries = {}
    for kind in ("textures", "models"):
        for asset_id, info in fetch_json(f"/assets?type={kind}").items():
            entries[asset_id] = {
                "type": kind,
                "name": info.get("name"),
                "categories": info.get("categories", []),
                "tags": info.get("tags", []),
                "polycount": info.get("polycount"),
                "dimensions": info.get("dimensions"),
                "thumbnail_url": info.get("thumbnail_url"),
            }

    def thumb(item):
        asset_id, e = item
        url = e.get("thumbnail_url")
        return asset_id, e["type"], fetch(url) if url else None

    with zipfile.ZipFile(out / "polyhaven-catalog.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("catalog.json", json.dumps(entries, indent=1, sort_keys=True))
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            for asset_id, kind, data in pool.map(thumb, sorted(entries.items())):
                if data is not None:
                    z.writestr(f"thumbs/{kind}/{asset_id}.webp", data)
    print(f"catalog: {len(entries)} assets")


def checked(url: str, md5: str | None) -> bytes:
    data = fetch(url)
    if md5 and hashlib.md5(data).hexdigest() != md5:
        raise RuntimeError(f"{url}: MD5 mismatch")
    return data


def build_assets(out: pathlib.Path, wanted: dict) -> None:
    jobs = []
    for asset_id, opts in sorted(wanted.items()):
        res = opts.get("res", "1k")
        files = fetch_json(f"/files/{asset_id}")
        gltf = files.get("gltf", {}).get(res, {}).get("gltf")
        if gltf is None:
            have = sorted(files.get("gltf", {}).keys())
            raise RuntimeError(f"{asset_id}: no glTF at {res} (available: {have})")
        jobs.append((f"{asset_id}/{gltf['url'].rsplit('/', 1)[-1]}", gltf["url"], gltf.get("md5")))
        for rel, f in gltf.get("include", {}).items():
            jobs.append((f"{asset_id}/{rel}", f["url"], f.get("md5")))

    def get(job):
        path, url, md5 = job
        return path, checked(url, md5)

    total = 0
    with zipfile.ZipFile(out / "polyhaven-assets.zip", "w", zipfile.ZIP_DEFLATED) as z:
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            for path, data in pool.map(get, jobs):
                z.writestr(path, data)
                total += len(data)
        z.writestr("manifest.json", json.dumps(wanted, indent=1, sort_keys=True))
    print(f"assets: {len(wanted)} assets, {len(jobs)} files, {total / 1e6:.1f} MB")


def main() -> None:
    manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    if manifest.get("catalog"):
        build_catalog(out)
    if manifest.get("assets"):
        build_assets(out, manifest["assets"])


if __name__ == "__main__":
    main()
