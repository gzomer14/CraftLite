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

/**
 * Mods (M21): o que está em `m/` só é baixado com mod ligado. O orçamento vale
 * para **o jogo** — o resto —, e os mods aparecem à parte, sem orçamento: um
 * mod pode pesar; o jogo sem mod, não.
 */
const isMod = (file) => file.startsWith('m/');
/** A página de prova de conexão do M20 (`rede.html` e `n/`): também fora do jogo. */
const isNet = (file) => file.startsWith('n/') || file === 'rede.html';
const bucketOf = (file) => (isMod(file) ? 'mods' : isNet(file) ? 'net' : 'game');

const rows = [];
const totals = {
  game: { raw: 0, gz: 0, br: 0 }, mods: { raw: 0, gz: 0, br: 0 }, net: { raw: 0, gz: 0, br: 0 },
};

for (const file of walk(DIST).sort()) {
  const ext = extname(file);
  if (!['.js', '.css', '.html', '.json', '.webmanifest'].includes(ext)) continue;
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  const br = brotliCompressSync(buf).length;
  const name = file.replace(`${DIST}/`, '').split('\\').join('/');
  rows.push({ file: name, raw: buf.length, gz, br });
  const bucket = totals[bucketOf(name)];
  bucket.raw += buf.length;
  bucket.gz += gz;
  bucket.br += br;
}

const kb = (n) => (n / 1024).toFixed(1).padStart(7);
const line = (label, t) => `  ${label.padEnd(34)} ${kb(t.raw)} ${kb(t.gz)} ${kb(t.br)}  KB`;
console.log('\n  arquivo                                 bruto    gzip  brotli');
console.log('  ' + '-'.repeat(62));
for (const r of rows.filter((r) => bucketOf(r.file) === 'game')) {
  console.log(`  ${r.file.padEnd(34)} ${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
}
console.log('  ' + '-'.repeat(62));
console.log(line('TOTAL do jogo', totals.game));
const modRows = rows.filter((r) => isMod(r.file));
if (modRows.length > 0) {
  console.log('\n  só com mod ligado (m/)');
  for (const r of modRows) console.log(`  ${r.file.padEnd(34)} ${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
  console.log(line('TOTAL de mods', totals.mods));
}
const netRows = rows.filter((r) => isNet(r.file));
if (netRows.length > 0) {
  console.log('\n  rede local (n/: a sala do jogo, só ao abrir ou entrar numa sala; e rede.html, a prova)');
  for (const r of netRows) console.log(`  ${r.file.padEnd(34)} ${kb(r.raw)} ${kb(r.gz)} ${kb(r.br)}`);
  console.log(line('TOTAL da rede local', totals.net));
}

/*
 * O pedaço principal não pode depender de outro arquivo: um `import` estático
 * dele para um pedaço compartilhado seria uma requisição a mais no jogo **sem
 * mod e sem sala** (acontece se um mod importar valor do jogo — ver
 * `src/mods/types.ts` — ou se o ajudante `__vitePreload` do Vite virar pedaço
 * próprio). O único `import()` aceito é o da sala na rede local (M20), por URL,
 * que só roda quando o jogador abre ou entra numa sala.
 */
for (const r of rows.filter((r) => r.file.startsWith('a/') && r.file.endsWith('.js'))) {
  const code = readFileSync(join(DIST, r.file), 'utf8');
  const staticImport = /\bfrom\s*["']\.{1,2}\/|(^|[;}])import\s*["']\.{1,2}\//.test(code);
  const dynamic = code.match(/\bimport\s*\([^)]{0,40}/g) ?? [];
  const foreign = dynamic.filter((d) => !/^import\(new URL\("\.\.\/n\//.test(d));
  if (staticImport || foreign.length > 0) {
    console.error(`\n  ✗ ${r.file} importa outro pedaço: o jogo sem mod e sem sala baixaria mais de um arquivo`);
    process.exit(1);
  }
}

const gzipKb = totals.game.gz / 1024;
const pct = ((gzipKb / BUDGET_KB) * 100).toFixed(0);
console.log(`\n  orçamento: ${BUDGET_KB} KB gzip — o jogo usa ${gzipKb.toFixed(1)} KB (${pct}%)`);

if (gzipKb > BUDGET_KB) {
  console.error(`\n  ✗ orçamento estourado em ${(gzipKb - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
console.log('  ✓ dentro do orçamento\n');
