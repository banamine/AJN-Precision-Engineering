#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseCsv } from "./csv.mjs";

function args(argv) {
  const out = { directory: path.resolve("data/captions") };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--query") out.query = argv[++i];
    else if (a === "--day") out.day = argv[++i];
    else if (a === "--channel") out.channel = argv[++i];
    else if (a === "--directory") out.directory = path.resolve(argv[++i]);
    else if (!a.startsWith("--") && !out.query) out.query = a;
    else throw new Error("invalid-argument");
  }
  if (!out.query) throw new Error("missing-query");
  return out;
}

const options = args(process.argv.slice(2));
const files = await readdir(options.directory).catch(() => []);
const dayFiles = files.filter((name) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(name))
  .filter((name) => !options.day || name === `${options.day}.csv`)
  .sort();
const needle = options.query.normalize("NFC").toLocaleLowerCase();
const results = [];
for (const name of dayFiles) {
  const rows = parseCsv(await readFile(path.join(options.directory, name)));
  for (const row of rows) {
    if (!String(row.text ?? "").normalize("NFC").toLocaleLowerCase().includes(needle)) continue;
    if (options.channel && row.channel !== options.channel) continue;
    results.push({
      day_utc: row.day_utc,
      channel: row.channel,
      program: row.program,
      start_utc: row.start_utc,
      item_url: `${row.item_url}#t=${row.start_s}`,
    });
  }
}
process.stdout.write(`${JSON.stringify({ resultCount: results.length, results })}\n`);
