/**
 * O Chrome dos scripts de medida (smoke, soak, bench, rede lenta).
 *
 * Cada script tinha a sua cópia de `chromeBin()` — oito, iguais. E nenhum subia
 * o Chrome num container rodando como root (o caso do CI e das sessões em
 * nuvem): o Chrome se recusa a abrir sem `--no-sandbox` como root, e o script
 * morria com "Chrome não respondeu na porta de depuração" sem dizer por quê.
 * Era preciso um invólucro apontado por `CHROME` (M24).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** O executável: `CHROME`, ou o primeiro Chrome/Chromium instalado que achar. */
export function chromeBin() {
  const env = process.env.CHROME;
  if (env !== undefined && env !== '') return env;
  const candidatos = [
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  // O Chromium que o Playwright instala, quando a máquina tem um.
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw !== undefined && pw !== '') candidatos.push(join(pw, 'chromium'));
  for (const caminho of candidatos) {
    if (existsSync(caminho)) return caminho;
  }
  throw new Error('Chrome não encontrado — aponte com a variável CHROME');
}

/**
 * Flags que dependem da máquina, e não do teste: como root, `--no-sandbox`.
 * Fora de root a sandbox fica, como sempre.
 */
export function chromeFlags() {
  return typeof process.getuid === 'function' && process.getuid() === 0 ? ['--no-sandbox'] : [];
}
