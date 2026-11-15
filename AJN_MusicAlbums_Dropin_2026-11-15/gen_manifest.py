# Regenerates src/data/musicAlbumsManifest.json from only2try_VA_album_files_2026-11-15.json (opus originals only)
import json,re,sys
src=sys.argv[1]; out=sys.argv[2]
d=json.load(open(src)); EXCL={'va-sound-bible-sound-effects-opus-48'}; KBPS=136000
def nat(s): return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)',s)]
RULES=[('Holiday & Seasonal',r'halloween|xmas|christmas|new year|nye\b|новог|новин.*настро|natale|sexy xmas'),
('Soundtracks',r'\bost\b|soundtrack|motion picture|music from|tangled|tinker bell|barbie|charmed|vigilante|need for speed|love actually|begin again|charlie.s angels|hollywood.s greatest|fantastic 4|a walk to remember|the best of me|songbirds'),
('Hardstyle & Hardcore',r'hardstyle|hardcore|hard bass|defqon|q-base|qontinent|thunderdome|dirty workz|rave parade|hardtechno|morphine|drumsound|hard-'),
('Trance',r'trance|state of trance|future sound of egypt|uplifting'),
('Workout & Sports',r'workout|fitness|sports?\b|running|jogging|aerobic|training|bike ride|sport target'),
('Techno & Electronic',r'techno|elektro|electro|\bedm\b|big room|electronic|drum ?& ?bass|dark drum|\bdnb\b|synth|space odyssey|bleep|digital dreams|ultra|wmc|retro futurism|percussion|cav demo|dynaudio|naim'),
('Disco & Italo',r'disco|italo|discotron'),
('Italian Hits',r'ital|sanremo|canzon|dolce vita|pure\.\.\. ?italia|ciao|vibrazioni|ti amo|cuore|malinconia|casa italiana|colazione|top hits italia|canta|made in italy|tendenze|papeete|ö3|radio 2'),
('Latin & Reggae',r'salsa|bachata|latin|reggae|caribbean|bolero|planeta mix|ska '),
('Love & Romance',r'romantic|love song|valentin|erotic|sexy|womanizer|swoon|soul love|intimacy|first ladies'),
('Chill, Lounge & Relax',r'chill|lounge|relax|meditat|yoga|ambient|serenity|dreaming|dream sequence|sounds of nature|inner peace|escapism|coffee|cocktail|ibiza|night flight|music for'),
('Jazz, Blues & Soul',r'jazz|blues|soul|r&b|funk|motown'),
('Rock & Metal',r'rock|metal|aerosmith|unplugged|cbgb|monarchs|new bands|elton john|in the air tonight|live lounge'),
('Classical & Instrumental',r'classical|guitar|instrumental|celtic|a time to remember|vintage chic|virgin land'),
('Country & Folk',r'country|outlaw|cowboy|folk|acorde|fado|sicil|sardaigne|cantu'),
('World & Regional',r'[\u0400-\u04ff]|german|deutsche|chanson|french|chansons|polish|rom[aâ]n|africa|s[aã]o tom|greek|russian|[\u0370-\u03ff]|eurovision|slagare|farsangi|zen[eé]s|putumayo|hip hop meets world|international pop'),
('House & Dance',r'house|deep|just paradise|dance|club|dj mix|nrj|booom|summer|party|megamix|remix|techno'),]
import re as _re
def genre(t):
    for g,rx in RULES:
        if _re.search(rx,t,_re.I): return g
    return 'Pop & Hits'
albums=[]; skipped=[]
for k,a in d.items():
    if k in EXCL: skipped.append((k,'excluded: sound effects')); continue
    fs=sorted([f for f in a['files'] if f['n'].lower().endswith('.opus') and not f.get('p')],key=lambda f:nat(f['n']))
    if not fs: skipped.append((k,'no opus tracks')); continue
    t=re.sub(r'\s*\((?:Opus|opus)[^)]*\)\s*\[Only2\]\s*$','',a['title']).strip()
    ys=[int(y) for y in re.findall(r'(?<!\d)(19[5-9]\d|20[0-3]\d)(?!\d)',t)]
    tr=[]
    for f in fs:
        if f.get('l'): tr.append([f['n'],f['s'],round(float(f['l'])),0])
        else: tr.append([f['n'],f['s'],round(f['s']*8/KBPS),1])
    albums.append({'i':k,'t':t,'g':genre(t),**({'y':ys[-1]} if ys else {}),'tr':tr})
json.dump({'schema':'ajn.musicAlbums.v1','note':'Opus originals; tr=[file,bytes,seconds,estimatedFlag]; est = size*8/136000 s','albums':albums},open(out,'w'),separators=(',',':'))
import collections; print(sorted(collections.Counter(x['g'] for x in albums).items(),key=lambda kv:-kv[1])); print(len(albums),'albums',sum(len(x['tr']) for x in albums),'tracks; skipped',skipped)
