import urllib.request, json
url = "https://archive.org/advancedsearch.php?q=title%3A%28Night%20of%20the%20Living%20Dead%29&fl[]=identifier,title,mediatype,description,date&rows=10&output=json"
req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    docs = data.get("response", {}).get("docs", [])
for doc in docs:
    print(doc['identifier'])
