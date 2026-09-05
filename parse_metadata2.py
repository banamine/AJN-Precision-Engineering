import urllib.request, json
url = "https://archive.org/metadata/ManwithTwoLives"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    meta = json.loads(response.read().decode())
    files = meta.get("files", [])
    for f in files:
        if f.get("name", "").endswith(".mp4"):
            print(f.get("name"), "source:", f.get("source"), "original:", f.get("original"))
