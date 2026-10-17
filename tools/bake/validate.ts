/* `npx tsx tools/bake/validate.ts [--root DIR]` — OFFLINE. Schema, hashes, counts, duplicate ids, references, budgets.
 * Exit 1 with one clear line per problem. Never touches the network (see check-urls.ts for that). */
import fs from 'node:fs';
import path from 'node:path';
import { BAKED_DIR, SCHEMA_CATALOG, SCHEMA_MANIFEST, sha256, type Catalog, type Manifest } from './lib';

export function validate(root: string): string[] {
  const errs: string[] = [];
  const mp = path.join(root, BAKED_DIR, 'manifest.json');
  if (!fs.existsSync(mp)) return [`manifest missing: ${mp}`];
  let m: Manifest; try { m = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e: any) { return [`manifest unreadable: ${e.message}`]; }
  if (m.schema !== SCHEMA_MANIFEST) errs.push(`manifest schema ${m.schema} != ${SCHEMA_MANIFEST}`);
  const dir = path.join(root, BAKED_DIR, m.dir ?? '');
  if (!m.dir || !fs.existsSync(dir)) return [...errs, `version dir missing: ${m.dir}`];
  const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const f of onDisk) if (!m.files[f]) errs.push(`${f}: on disk but not in manifest`);
  const allChannelIds = new Map<string, string>();
  for (const [f, meta] of Object.entries(m.files)) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) { errs.push(`${f}: listed in manifest but missing`); continue; }
    const text = fs.readFileSync(p, 'utf8');
    if (sha256(text) !== meta.sha256) { errs.push(`${f}: sha256 mismatch (corrupt or edited)`); continue; }
    let c: Catalog; try { c = JSON.parse(text); } catch (e: any) { errs.push(`${f}: invalid JSON`); continue; }
    if (c.schema !== SCHEMA_CATALOG) errs.push(`${f}: schema ${c.schema}`);
    const ids = Object.keys(c.items ?? {});
    if (ids.length !== meta.items) errs.push(`${f}: ${ids.length} items, manifest says ${meta.items}`);
    if ((c.channels ?? []).length !== meta.channels) errs.push(`${f}: ${c.channels?.length} channels, manifest says ${meta.channels}`);
    for (const id of ids) {
      const it = c.items[id];
      if (it.id !== id) errs.push(`${f}: item key ${id} != id ${it.id}`);
      if (!it.path || !it.path.startsWith('/download/') && !/^https?:\/\//.test(it.path)) errs.push(`${f}: ${id}: bad path`);
      if (it.kind === 'audio' && !(it.durationSeconds! > 0)) errs.push(`${f}: ${id}: audio without duration`);
      if (!it.title?.trim()) errs.push(`${f}: ${id}: empty title`);
    }
    for (const ch of c.channels ?? []) {
      if (allChannelIds.has(ch.id)) errs.push(`${f}: duplicate channel id ${ch.id} (also in ${allChannelIds.get(ch.id)})`);
      allChannelIds.set(ch.id, f);
      if (!ch.itemIds?.length) errs.push(`${f}: channel ${ch.id} has no items`);
      const seen = new Set<string>();
      for (const id of ch.itemIds ?? []) { if (!c.items[id]) errs.push(`${f}: channel ${ch.id} references unknown item ${id}`); if (seen.has(id)) errs.push(`${f}: channel ${ch.id} repeats item ${id}`); seen.add(id); }
    }
    if (meta.bytes !== Buffer.byteLength(text)) errs.push(`${f}: byte count differs from manifest`);
  }
  return errs;
}

if (process.argv[1]?.endsWith('validate.ts')) {
  const i = process.argv.indexOf('--root'); const root = i > 0 ? process.argv[i + 1] : process.cwd();
  const errs = validate(root);
  if (errs.length) { console.error(errs.map((e) => 'FAIL ' + e).join('\n')); process.exit(1); }
  console.log('baked catalogs valid');
}
