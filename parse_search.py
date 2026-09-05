import urllib.request, json
url = "https://archive.org/advancedsearch.php?q=collection:SciFi_Horror&fl[]=identifier,title,mediatype,description,date&rows=5&output=json"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    docs = data.get("response", {}).get("docs", [])
    
for doc in docs:
    ident = doc['identifier']
    url2 = f"https://archive.org/metadata/{ident}"
    with urllib.request.urlopen(urllib.request.Request(url2)) as res2:
        meta = json.loads(res2.read().decode())
        files = meta.get("files", [])
        for f in files:
            if "h.264" in str(f.get("format", "")).lower() or "mp4" in str(f.get("format", "")).lower() or f.get("name", "").endswith(".mp4"):
                print(ident, f.get("name"), f.get("format"), f.get("length"))
