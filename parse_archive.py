import urllib.request, json
url = "https://archive.org/metadata/ep-345-pe"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    for f in data.get("files", []):
        if f.get("name", "").endswith(".mp4") or f.get("name", "").endswith(".m4v"):
            print(json.dumps(f, indent=2))
