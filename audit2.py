import urllib.request, json
url = "https://archive.org/metadata/NightOfTheLivingDead"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    meta = json.loads(response.read().decode())
    files = meta.get("files", [])
    for f in files:
        name = f.get("name", "")
        if name.endswith(".mp4") or name.endswith(".m4v"):
            source = f.get("source")
            orig = f.get("original", "")
            qual = f.get("format", "")
            print(f"{name} (source: {source}, orig: {orig}, qual: {qual})")
