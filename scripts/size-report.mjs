/**
 * Relatório de tamanho do bundle. Falha o processo se o orçamento do doc 02 §4
 * for estourado — o orçamento é normativo, então quem quebra é o build.
 */
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/** Orçamento do marco atual. M0 pede < 60 KB; o projeto todo, < 350 KB. */
const BUDGET_KB = Number(process.env.SIZE_BUDGET_KB ?? 60);
const DIST = 'dist';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

const rows = [];
let totalRaw = 0;
let totalGzip = 0;
let totalBrotli = 0;

for (const file of walk(DIST).sort()) {
  const ext = extname(file);
  if (!['.js', '.css', '.html', '.json', '.webmanifest'].includes(ext)) continue;
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf).length;
  rows.push({ file: file.replace(`${DIST}/`, ''), raw: buf.length, gz, br });
  totalRaw += buf.length;
  totalGzip += gz;
  totalBrotli += br;
}

const kb = (n) => (n / 1024).toFixed(1).padStart(7);
console.log('\n  arquivo                                 bruto    gzip  brotli');
console.log('  ' + '-'.repeat(62));
for (const r of rows) {
  console.log(`  ${r.file.padEnd(34)} ${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
}
console.log('  ' + '-'.repeat(62));
console.log(`  ${'TOTAL'.padEnd(34)} ${kb(totalRaw)} ${kb(totalGzip)} ${kb(totalBrotli)}  KB`);

const gzipKb = totalGzip / 1024;
const pct = ((gzipKb / BUDGET_KB) * 100).toFixed(0);
console.log(`\n  orçamento: ${BUDGET_KB} KB gzip — usando ${gzipKb.toFixed(1)} KB (${pct}%)`);

if (gzipKb > BUDGET_KB) {
  console.error(`\n  ✗ orçamento estourado em ${(gzipKb - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
console.log('  ✓ dentro do orçamento\n');
