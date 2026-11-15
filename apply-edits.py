# Run from the repo root: python apply-edits.py   (idempotent; stops if anchors changed)
import pathlib,sys
p=pathlib.Path('server/libraryIndex.ts'); s=p.read_text(encoding='utf-8')
if 'extraLibraryRecords' in s: print('already applied'); sys.exit(0)
edits=[
("import { catalogRecords, isCatalogRecord } from './library/catalogRecords';",
 "import { catalogRecords, isCatalogRecord } from './library/catalogRecords';\nimport { extraLibraryRecords } from './library/extraLibraryRecords';"),
("export function setLibraryIndexForTests(items: IndexRecord[] | null) { searchItems",
 "let extraLibraryOn = true; // tests that install their own fixture turn the shipped extra records off\nexport function setExtraLibraryForTests(on: boolean) { extraLibraryOn = on; }\nexport function setLibraryIndexForTests(items: IndexRecord[] | null) { extraLibraryOn = false; searchItems"),
("...nker150Records(), ...catalogRecords()]",
 "...nker150Records(), ...catalogRecords(), ...(extraLibraryOn ? extraLibraryRecords() : [])]"),
]
for a,b in edits: assert s.count(a)==1,'anchor not found, libraryIndex.ts changed: stop: '+a[:50]
for a,b in edits: s=s.replace(a,b)
p.write_text(s,encoding='utf-8'); print('applied 3 edits to server/libraryIndex.ts')
