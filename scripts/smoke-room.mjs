/**
 * Smoke test da sala na rede local (M20): dois Chrome **jogando** juntos.
 *
 * Um cria um mundo, põe um bloco, abre a sala pela pausa; o outro entra pela
 * tela de título, trocando os códigos pelas telas do jogo como uma pessoa
 * faria. Depois: o convidado vê o bloco de antes (chunk modificado vindo do
 * anfitrião), os dois veem os blocos um do outro, os bonecos e os mobs; o
 * convidado sai pelo menu e fica guardado **no mundo do anfitrião**, com o que
 * tinha no inventário — e nada do mundo fica no banco do convidado.
 *
 * Mesma infraestrutura do `smoke.mjs` e do `smoke-net.mjs`: dois perfis de
 * Chrome headless na mesma máquina, `dist/` num servidor do Node, CDP. Na
 * mesma máquina o mDNS não resolve num container, então o IP fica à vista
 * (`--disable-features=WebRtcHideLocalIpsWithMdns`); a rede Wi-Fi de verdade
 * foi provada em aparelho no M20.0.
 *
 * Uso: `npm run build && npm run smoke:room`.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { conectar } from './cdp.mjs';

const DIST = join(process.cwd(), 'dist');
const TIPOS = {
  '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
};
/** Bloco de ouro e de diamante: fáceis de reconhecer, sem física. */
const OURO = 'gold_block';
const DIAMANTE = 'diamond_block';

function chromeBin() {
  const env = process.env.CHROME;
  if (env !== undefined && env !== '') return env;
  for (const c of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (existsSync(c)) return c;
  }
  throw new Error('Chrome não encontrado — aponte com a variável CHROME');
}

function servir() {
  const server = createServer((req, res) => {
    const caminho = normalize(decodeURIComponent((req.url ?? '/').split('?')[0]));
    let arquivo = join(DIST, caminho);
    if (!arquivo.startsWith(DIST)) { res.writeHead(403).end(); return; }
    if (existsSync(arquivo) && statSync(arquivo).isDirectory()) arquivo = join(arquivo, 'index.html');
    if (!existsSync(arquivo)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream' });
    res.end(readFileSync(arquivo));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function ate(cdp, expressao, limite = 60000) {
  const fim = Date.now() + limite;
  let ultimo;
  while (Date.now() < fim) {
    ultimo = await cdp.avaliar(expressao).catch((e) => String(e));
    if (ultimo === true || (ultimo && typeof ultimo !== 'string')) return ultimo;
    if (typeof ultimo === 'string' && ultimo !== '' && !ultimo.startsWith('Error')) return ultimo;
    await esperar(250);
  }
  throw new Error(`tempo esgotado esperando: ${expressao.slice(0, 90)} (${ultimo})`);
}

const HELPERS = `(() => {
  if (window.__smoke !== undefined) return true;
  const s = { erros: [] };
  window.__smoke = s;
  addEventListener('error', (e) => s.erros.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => s.erros.push('promise: ' + String(e.reason)));
  s.botao = (raiz, texto) => [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));
  s.tela = (id) => document.getElementById(id);
  s.visivel = (id) => { const e = document.getElementById(id); return e !== null && !e.hidden; };
  s.id = (nome) => window.__craftlite.items.get(nome).placesBlock;
  return true;
})()`;

const passos = [];
function passo(nome, ok, detalhe = '') {
  passos.push({ nome, ok });
  console.log(`${ok ? '✓' : '✗'} ${nome}${detalhe ? ' — ' + detalhe : ''}`);
  if (!ok) throw new Error(nome);
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ não existe: rode `npm run build` antes.');
  process.exit(1);
}

const server = await servir();
const url = `http://127.0.0.1:${server.address().port}/?smoke`;
const chromes = [9351, 9352].map((porta) => spawn(chromeBin(), [
  '--headless=new', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${porta}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'craftlite-room-'))}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1024,640', '--lang=pt-BR',
  '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required', url,
], { stdio: 'ignore', env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' } }));

let host;
let guest;
try {
  host = await conectar(9351);
  guest = await conectar(9352);
  for (const cdp of [host, guest]) {
    await cdp.enviar('Runtime.enable');
    await ate(cdp, "document.readyState === 'complete' && document.getElementById('title-screen') !== null");
    await cdp.avaliar(HELPERS);
  }

  // 1. O anfitrião cria o mundo e põe um bloco **antes** de abrir a sala.
  await host.avaliar(`(async () => {
    const s = window.__smoke;
    s.botao(s.tela('title-screen'), 'Jogar').click();
    await new Promise((r) => setTimeout(r, 500));
    const m = s.tela('worlds-screen');
    s.botao(m, 'Criar novo').click();
    await new Promise((r) => setTimeout(r, 400));
    const campos = [...m.querySelectorAll('input, select')].filter((c) => c.type !== 'file');
    const textos = campos.filter((c) => c.tagName === 'INPUT');
    const modo = campos.find((c) => c.tagName === 'SELECT' && [...c.options].some((o) => o.value === 'creative'));
    textos[0].value = 'Sala'; textos[0].dispatchEvent(new Event('input', { bubbles: true }));
    textos[1].value = 'sala-2026'; textos[1].dispatchEvent(new Event('input', { bubbles: true }));
    modo.value = 'creative'; modo.dispatchEvent(new Event('change', { bubbles: true }));
    s.botao(m, 'Criar e jogar').click();
    return true;
  })()`);
  await ate(host, `(() => { const c = window.__craftlite; if (!c) return false; c.player.flying = false; return c.player.onGround === true; })()`, 120000);
  const antes = JSON.parse(await host.avaliar(`(() => {
    const { world, player } = window.__craftlite;
    const x = Math.floor(player.x) + 3, y = Math.floor(player.y) + 2, z = Math.floor(player.z) + 3;
    world.setBlock(x, y, z, __smoke.id('${OURO}'), 'player');
    return JSON.stringify([x, y, z, world.getBlock(x, y, z)]);
  })()`));
  passo('o anfitrião cria o mundo e põe um bloco de ouro antes da sala', antes[3] > 0, JSON.stringify(antes.slice(0, 3)));

  // 2. Pausa → Abrir para a rede local.
  await host.avaliar("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })), true");
  await ate(host, "__smoke.visivel('pause-menu')", 10000);
  await host.avaliar("__smoke.botao(__smoke.tela('pause-menu'), 'Abrir para a rede local').click(), true");
  const oferta = await ate(host, "__smoke.visivel('room-screen') && document.querySelector('#room-screen .net-code')?.textContent", 20000);
  passo('a pausa abre a sala e mostra o código', oferta.length > 40, `${oferta.replace(/-/g, '').length} caracteres`);

  // 3. O convidado: título → Entrar numa sala → cola o código → Continuar.
  await guest.avaliar("__smoke.botao(__smoke.tela('title-screen'), 'Entrar numa sala').click(), true");
  await ate(guest, "__smoke.visivel('join-screen') && document.querySelector('#join-screen textarea') !== null", 20000);
  await guest.avaliar(`(() => {
    const tela = __smoke.tela('join-screen');
    tela.querySelector('input').value = 'Visita';
    tela.querySelector('textarea').value = ${JSON.stringify(oferta)};
    __smoke.botao(tela, 'Continuar').click();
    return true;
  })()`);
  const resposta = await ate(guest, "document.querySelector('#join-screen .net-code')?.textContent", 20000);
  passo('o convidado lê o código da sala e mostra a resposta', resposta.length > 40);

  // 4. O anfitrião cola a resposta → Conectar.
  await host.avaliar(`(() => {
    const tela = __smoke.tela('room-screen');
    tela.querySelector('textarea').value = ${JSON.stringify(resposta)};
    __smoke.botao(tela, 'Conectar').click();
    return true;
  })()`);
  await ate(guest, `(() => { const c = window.__craftlite; if (!c) return false; c.player.flying = false; return c.player.onGround === true; })()`, 120000);
  const lista = await ate(host, "window.__craftliteNet?.room()?.guests.filter((g) => g.ready).map((g) => g.name).join(',')", 20000);
  passo('o convidado entra direto no mundo, e a sala o lista', lista === 'Visita', lista);
  await guest.avaliar(HELPERS);

  // 5. O bloco de antes veio pelo chunk modificado do anfitrião.
  const [x, y, z] = antes;
  const ouro = await ate(guest, `(() => { const w = window.__craftlite.world; return w.isLoaded(${x}, ${z}) && w.getBlock(${x}, ${y}, ${z}) === __smoke.id('${OURO}'); })()`, 30000);
  passo('o convidado vê o bloco posto antes da sala (chunk do anfitrião)', ouro === true);

  // 6. Bloco do anfitrião agora → aparece no convidado. Os dois Chrome estão
  // na mesma máquina, com o mesmo relógio: dá para cronometrar a viagem. Cinco
  // viagens, vale a mediana (o container desenha por software, e um quadro
  // lento de vez em quando atrasa qualquer uma).
  await guest.avaliar(`window.__chegou = {}; window.__craftlite.world.onBlockChange((c) => {
    if (c.x === ${x} && c.z === ${z} && c.y > ${y}) window.__chegou[c.y] = Date.now();
  }), true`);
  const viagens = [];
  for (let i = 1; i <= 5; i++) {
    const saiu = await host.avaliar(`(() => {
      window.__craftlite.world.setBlock(${x}, ${y + i}, ${z}, __smoke.id('${DIAMANTE}'), 'player');
      return Date.now();
    })()`);
    await ate(guest, `window.__craftlite.world.getBlock(${x}, ${y + i}, ${z}) === __smoke.id('${DIAMANTE}')`, 10000);
    viagens.push((await guest.avaliar(`window.__chegou[${y + i}]`)) - saiu);
  }
  viagens.sort((a, b) => a - b);
  passo('o bloco que o anfitrião põe aparece no convidado em menos de 150 ms (mediana)', viagens[2] < 150,
    `${viagens.join(', ')} ms`);

  // 7. Bloco do convidado → aparece no anfitrião. A coluna tem de estar
  // carregada no convidado: logo depois de entrar, ele pode ter só três ou
  // quatro, e `setBlock` fora delas não faz nada.
  await ate(guest, `(() => { const { world, player } = window.__craftlite;
    return world.isLoaded(Math.floor(player.x) - 2, Math.floor(player.z) - 2); })()`, 30000);
  const dele = JSON.parse(await guest.avaliar(`(() => {
    const { world, player } = window.__craftlite;
    const gx = Math.floor(player.x) - 2, gy = Math.floor(player.y) + 1, gz = Math.floor(player.z) - 2;
    world.setBlock(gx, gy, gz, __smoke.id('${DIAMANTE}'), 'player');
    return JSON.stringify([gx, gy, gz]);
  })()`));
  await ate(host, `window.__craftlite.world.getBlock(${dele[0]}, ${dele[1]}, ${dele[2]}) === __smoke.id('${DIAMANTE}')`, 10000);
  passo('o bloco que o convidado põe aparece no anfitrião', true, JSON.stringify(dele));

  // 8. Bonecos e mobs. O anfitrião traz um mob para perto do convidado: sem
  // isso, a conferência passaria com zero dos dois lados.
  // Logo depois da criação o mundo pode não ter mob nenhum ainda: espera o primeiro.
  await ate(host, `(() => {
    const st = window.__craftlite.session.mobs.store;
    const g = window.__craftliteNet.room().guests[0];
    if (st.active === 0) return false;
    st.x[0] = st.prevX[0] = g.x + 3; st.z[0] = st.prevZ[0] = g.z + 3; st.y[0] = st.prevY[0] = g.y + 1;
    return true;
  })()`, 30000);
  await esperar(1500);
  const noConvidado = JSON.parse(await guest.avaliar(`JSON.stringify({
    anfitriao: window.__craftliteNet.guest().avatars.list.filter((a) => a.placed).map((a) => a.name),
    mobs: window.__craftlite.session.mobs.store.active,
  })`));
  // Só vão ao convidado os mobs a até 64 blocos dele (`net/mobsync.ts`).
  const noAnfitriao = JSON.parse(await host.avaliar(`(() => {
    const st = window.__craftlite.session.mobs.store;
    const g = window.__craftliteNet.room().guests[0];
    let perto = 0;
    for (let i = 0; i < st.active; i++) if ((st.x[i] - g.x) ** 2 + (st.z[i] - g.z) ** 2 <= 64 * 64) perto++;
    return JSON.stringify({
      convidado: window.__craftliteNet.room().avatars.list.filter((a) => a.placed).map((a) => a.name),
      mobs: perto, total: st.active,
    });
  })()`));
  passo('cada um vê o boneco do outro', noConvidado.anfitriao.length === 1 && noAnfitriao.convidado[0] === 'Visita',
    `convidado vê ${noConvidado.anfitriao.join(',')}; anfitrião vê ${noAnfitriao.convidado.join(',')}`);
  passo('os mobs do anfitrião perto do convidado aparecem nele',
    noAnfitriao.mobs > 0 && Math.abs(noConvidado.mobs - noAnfitriao.mobs) <= 1,
    `${noConvidado.mobs} no convidado; ${noAnfitriao.mobs} perto dele no anfitrião, de ${noAnfitriao.total}`);

  // 9. O nome em cima do boneco: o convidado se afasta, o anfitrião olha para ele.
  await guest.avaliar(`(() => {
    const p = window.__craftlite.player;
    p.setPosition(p.x - 3, p.y + 1, p.z + 2);
    // Uma espada na mão: o boneco dele a mostra (item na mão, M20).
    const inv = window.__craftlite.session.inventory;
    inv.set(0, { item: window.__craftlite.items.get('iron_sword').id, count: 1, damage: 0 });
    inv.selected = 0;
    return true;
  })()`);
  await esperar(800);
  await host.avaliar(`(() => {
    const p = window.__craftlite.player;
    const g = window.__craftliteNet.room().guests[0];
    p.yaw = Math.atan2(g.x - p.x, g.z - p.z);
    // Para baixo é positivo: mira a cabeça dele, que pode estar num barranco.
    p.pitch = Math.atan2(p.y + 1.62 - (g.y + 2.1), Math.hypot(g.x - p.x, g.z - p.z));
    return true;
  })()`);
  const nome = await ate(host, "(() => { const e = document.querySelector('#name-tags div'); return e !== null && !e.hidden ? e.textContent : false; })()", 10000)
    .catch(() => host.avaliar("document.querySelector('#name-tags div')?.textContent ?? 'nenhum'"));
  passo('o anfitrião vê o nome do convidado em cima do boneco', nome === 'Visita', String(nome));

  // 10. Chat: o convidado escreve, o anfitrião lê.
  await guest.avaliar(`(() => {
    const input = document.querySelector('#chat input');
    input.value = 'oi, cheguei';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  const lido = await ate(host, "document.querySelector('#chat .lines')?.textContent.includes('Visita: oi, cheguei') ?? false", 10000);
  passo('o anfitrião lê no chat o que o convidado escreveu', lido === true);
  // `SMOKE_SHOT=arquivo.png`: a tela do anfitrião agora (nome e chat), para ver com os olhos.
  if (process.env.SMOKE_SHOT) {
    await host.avaliar("(__smoke.botao(document, 'Voltar ao jogo')?.click(), true)");
    await esperar(600);
    const { data } = await host.enviar('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.SMOKE_SHOT, Buffer.from(data, 'base64'));
  }

  // 11. Baú: o anfitrião guarda, o convidado abre e tira; o anfitrião fica sabendo.
  const bau = JSON.parse(await host.avaliar(`(() => {
    const { world, session } = window.__craftlite;
    const g = window.__craftliteNet.room().guests[0];
    const x = Math.floor(g.x) + 1, y = Math.floor(g.y), z = Math.floor(g.z) + 1;
    const chest = window.__craftlite.items.get('chest').placesBlock;
    world.setBlock(x, y, z, chest, 'player');
    session.tiles.create(x, y, z, chest);
    session.tiles.at(x, y, z).set(0, { item: window.__craftlite.items.get('diamond').id, count: 3, damage: 0 });
    return JSON.stringify([x, y, z]);
  })()`));
  const [bx, by, bz] = bau;
  await ate(guest, `window.__craftlite.world.getBlock(${bx}, ${by}, ${bz}) === __smoke.id('chest')`, 10000);
  await guest.avaliar(`window.__craftlite.session.workbench.open(${bx}, ${by}, ${bz}), true`);
  const viu = await ate(guest, `(() => { const s = window.__craftlite.session;
    return s.workbench.openScreen === 'chest' && s.tiles.at(${bx}, ${by}, ${bz})?.get(0)?.count === 3; })()`, 10000);
  await guest.avaliar(`window.__craftlite.session.tiles.at(${bx}, ${by}, ${bz}).set(0, null), true`);
  const tirou = await ate(host, `window.__craftlite.session.tiles.at(${bx}, ${by}, ${bz}).get(0) === null`, 10000);
  await guest.avaliar('window.__craftlite.session.workbench.closeScreen(), true');
  passo('o convidado abre o baú do anfitrião, vê os 3 diamantes e o que tira some lá', viu === true && tirou === true);

  // 12. Luz: o poço que o convidado cava fica claro no anfitrião (era escuro).
  const poco = JSON.parse(await guest.avaliar(`(() => {
    const { world, player } = window.__craftlite;
    const x = Math.floor(player.x) - 1, z = Math.floor(player.z) + 2;
    let y = 120;
    while (y > 1 && world.getBlock(x, y, z) === 0) y--;
    for (let d = 0; d < 3; d++) world.setBlock(x, y - d, z, 0, 'player');
    return JSON.stringify([x, y - 2, z]);
  })()`));
  const claro = await ate(host, `window.__craftlite.world.getBlock(${poco[0]}, ${poco[1]}, ${poco[2]}) === 0
    && window.__craftlite.world.getSkyLight(${poco[0]}, ${poco[1]}, ${poco[2]}) >= 12`, 10000)
    .catch(() => false);
  const luz = await host.avaliar(`window.__craftlite.world.getSkyLight(${poco[0]}, ${poco[1]}, ${poco[2]})`);
  passo('o fundo do poço cavado pelo convidado recebe a luz do céu no anfitrião', claro === true, `luz ${luz}`);

  // 12b. Longe do anfitrião — além do anel dele —, o anfitrião segura o mundo
  // em volta do convidado (âncora do pipeline): o bloco que ele põe lá vale.
  const anel = await host.avaliar('window.__craftlite.pipeline.renderDistance');
  const salto = (anel + 6) * 16;
  await guest.avaliar(`(() => { const p = window.__craftlite.player; p.setPosition(p.x + ${salto}, 110, p.z); return true; })()`);
  const longe = JSON.parse(await ate(guest, `(() => {
    const { world, player } = window.__craftlite;
    const x = Math.floor(player.x), z = Math.floor(player.z) + 2;
    if (!world.isLoaded(x, z)) return false;
    return JSON.stringify([x, z]);
  })()`, 30000));
  await ate(host, `window.__craftlite.world.isLoaded(${longe[0]}, ${longe[1]})`, 30000);
  const alto = await guest.avaliar(`(() => {
    const { world, player } = window.__craftlite;
    const y = Math.floor(player.y);
    world.setBlock(${longe[0]}, y, ${longe[1]}, __smoke.id('gold_block'), 'player');
    return y;
  })()`);
  const valeu = await ate(host, `window.__craftlite.world.getBlock(${longe[0]}, ${alto}, ${longe[1]}) === __smoke.id('gold_block')`, 10000)
    .catch(() => false);
  passo('além do anel do anfitrião, o bloco do convidado vale (o anfitrião segura o mundo em volta dele)', valeu === true,
    `${salto} blocos; anel do anfitrião ${anel} colunas`);

  // 12c. O anfitrião vai ao Nether: a sala vai junto; e volta.
  await host.avaliar("(() => { const p = window.__craftlite.player; window.__craftlite.session.travel.begin(Math.floor(p.x), Math.floor(p.z), 'nether'); return true; })()");
  const noNether = await ate(guest, `(() => {
    const { world, session, player } = window.__craftlite;
    if (world.dimension !== 1 || session.travel.isTravelling) return false;
    const h = window.__craftliteNet.guest().avatars.get(0);
    return h !== undefined && Math.hypot(h.x - player.x, h.z - player.z) < 3 ? JSON.stringify([Math.round(player.x), Math.round(player.z)]) : false;
  })()`, 60000).catch(() => false);
  passo('o anfitrião atravessa para o Nether e o convidado aparece ao lado dele', noNether !== false, String(noNether));
  await host.avaliar("(() => { const p = window.__craftlite.player; window.__craftlite.session.travel.begin(Math.floor(p.x), Math.floor(p.z), 'nether'); return true; })()");
  const deVolta = await ate(guest, `(() => {
    const { world, session } = window.__craftlite;
    return world.dimension === 0 && !session.travel.isTravelling;
  })()`, 60000).catch(() => false);
  passo('e na volta, os dois na superfície', deVolta === true);

  // 13. O convidado guarda um item e sai pelo menu: fica no mundo do anfitrião.
  const idConvidado = await guest.avaliar(`(() => {
    window.__craftlite.session.inventory.set(8, { item: window.__craftlite.items.get('diamond').id, count: 7, damage: 0 });
    return localStorage.getItem('craftlite.netid');
  })()`);
  await guest.avaliar("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })), true");
  await ate(guest, "__smoke.visivel('pause-menu')", 10000);
  await guest.avaliar("__smoke.botao(__smoke.tela('pause-menu'), 'Salvar e Sair').click(), true");
  await ate(host, "window.__craftliteNet.room().guests.length === 0", 20000);
  const guardado = JSON.parse(await ate(host, `(async () => {
    const r = await window.craftlite.save.loadPlayerRecord(${JSON.stringify(idConvidado)});
    return r === undefined ? '' : JSON.stringify({ diamantes: r.inventory[8 * 3 + 1], mundo: r.worldId === window.craftlite.meta.id });
  })()`, 20000));
  passo('o convidado sai e fica guardado no mundo do anfitrião, com o inventário', guardado.diamantes === 7 && guardado.mundo,
    JSON.stringify(guardado));

  // 14. Nada do mundo no banco do convidado.
  await ate(guest, "window.__smoke === undefined && document.readyState === 'complete' && document.getElementById('title-screen') !== null", 30000);
  const banco = await guest.avaliar(`new Promise((resolve) => {
    const open = indexedDB.open('craftlite');
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('worlds')) { resolve('0/0'); return; }
      const tx = db.transaction(['worlds', 'chunks'], 'readonly');
      const a = tx.objectStore('worlds').count(); const b = tx.objectStore('chunks').count();
      tx.oncomplete = () => resolve(a.result + '/' + b.result);
    };
    open.onerror = () => resolve('erro');
  })`);
  passo('o banco do convidado não tem mundo nem chunk', banco === '0/0', `mundos/chunks: ${banco}`);

  const erros = JSON.parse(await host.avaliar('JSON.stringify(window.__smoke.erros)'));
  passo('nenhum erro na página do anfitrião', erros.length === 0, erros.slice(0, 3).join(' | '));
  console.log(`\nsmoke da sala: ${passos.length} passos, todos verdes`);
} catch (e) {
  console.error('\nsmoke da sala FALHOU:', e.message);
  for (const [nome, cdp] of [['anfitrião', host], ['convidado', guest]]) {
    const erros = await cdp?.avaliar('JSON.stringify(window.__smoke?.erros ?? [])').catch(() => '');
    const texto = await cdp?.avaliar("[...document.querySelectorAll('.menu-screen:not([hidden])')].map((e) => e.innerText).join(' | ').slice(0, 600)").catch(() => '');
    console.error(`--- ${nome}: erros ${erros}; tela: ${texto}`);
  }
  process.exitCode = 1;
} finally {
  host?.fechar();
  guest?.fechar();
  for (const c of chromes) c.kill();
  server.close();
}
