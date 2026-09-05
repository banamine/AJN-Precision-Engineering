import urllib.request, json
url = "https://archive.org/metadata/devil-and-miss-sarah-1975-gene-barry"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    meta = json.loads(response.read().decode())
    files = meta.get("files", [])
    for f in files:
        if f.get("name", "").endswith(".mp4"):
            print(f.get("name"), "width:", f.get("width"), "format:", f.get("format"))
