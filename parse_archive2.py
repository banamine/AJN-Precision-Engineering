import urllib.request, json
url = "https://archive.org/metadata/NightOfTheLivingDead"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    for f in data.get("files", []):
        print(f.get("name"), f.get("format"))
