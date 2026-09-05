import urllib.request, json
url = "https://archive.org/advancedsearch.php?q=collection:SciFi_Horror&fl[]=identifier,title,mediatype,description,date&rows=5&output=json"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    docs = data.get("response", {}).get("docs", [])

print("Input assets:")
for doc in docs:
    ident = doc['identifier']
    url2 = f"https://archive.org/metadata/{ident}"
    with urllib.request.urlopen(urllib.request.Request(url2)) as res2:
        meta = json.loads(res2.read().decode())
        files = meta.get("files", [])
        for f in files:
            name = f.get("name", "")
            if name.endswith(".mp4") or name.endswith(".m4v"):
                source = f.get("source")
                orig = f.get("original", "")
                qual = f.get("format", "")
                print(f"  {ident}: {name} (source: {source}, orig: {orig}, qual: {qual})")
