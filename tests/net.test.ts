/**
 * Rede local, peças sem navegador (M20.0): o código em texto, a sinalização
 * compacta, o gerador de QR e o isolamento da página de prova.
 *
 * A ligação de verdade (dois `RTCPeerConnection`) roda em `npm run smoke:net`,
 * num Chrome headless; a leitura do QR gerado foi conferida com o leitor do
 * OpenCV, da versão 1 à 8 (doc 15 §3, M20).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, normalize, relative, sep } from 'path';
import { crc16, decodeCode, encodeCode, groupCode } from '../src/net/base32';
import {
  candidatesOf, decodeSignal, encodeSignal, ipv6Bytes, midOf, sdpFromSignal, signalFromSdp,
} from '../src/net/signal';
import {
  alignmentPositions, dataCodewords, encodeQr, formatBits, interleave, rsRemainder,
} from '../src/net/qr';

const FP = 'A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:01:12:23:34:45:56:67:78:89:9A:AB:BC:CD:DE:EF:F0';

/** Um SDP de oferta como o Chrome gera, já com os candidatos reunidos. */
const CHROME_OFFER = [
  'v=0', 'o=- 4611731400430051336 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE 0', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
  'm=application 51937 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:3310432911 1 udp 2113937151 7c9a8a41-54d1-4b8b-9e2d-0f3c2b1a9d8e.local 51937 typ host generation 0 network-cost 999',
  'a=candidate:1720891421 1 udp 2113939711 3b1f2e4d-aaaa-4bbb-8ccc-123456789abc.local 51938 typ host generation 0 network-cost 999',
  'a=candidate:2141539851 1 tcp 1518280447 7c9a8a41-54d1-4b8b-9e2d-0f3c2b1a9d8e.local 9 typ host tcptype active generation 0 network-cost 999',
  'a=ice-ufrag:Xk9q', 'a=ice-pwd:9Tq3bZ0yXw7Vn2Lm5Kp8Rs1u', 'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${FP}`, 'a=setup:actpass', 'a=mid:0',
  'a=sctp-port:5000', 'a=max-message-size:262144', '',
].join('\r\n');

/** Uma resposta como o Firefox gera: mid `0`, IPv4 e IPv6 à vista, `UDP` maiúsculo. */
const FIREFOX_ANSWER = [
  'v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 7021542380813125430 0 IN IP4 0.0.0.0', 's=-', 't=0 0',
  `a=fingerprint:sha-256 ${FP}`, 'a=group:BUNDLE 0', 'a=ice-options:trickle', 'a=msid-semantic:WMS *',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 192.168.0.23 54400 typ host',
  'a=candidate:1 1 UDP 2122187007 fe80::1c2b:3aff:fe4d:5e6f 54401 typ host',
  'a=candidate:2 1 TCP 2105524479 192.168.0.23 9 typ host tcptype active',
  'a=sendrecv', 'a=end-of-candidates', 'a=ice-pwd:f3a9c1d2e4b5a6978897a6b5c4d3e2f1',
  'a=ice-ufrag:8c3f2a1b', 'a=mid:0', 'a=setup:active', 'a=sctp-port:5000',
  'a=max-message-size:1073741823', '',
].join('\r\n');

describe('código em texto', () => {
  it('vai e volta, e o CRC pega letra trocada', () => {
    const bytes = Uint8Array.from({ length: 97 }, (_, i) => (i * 37 + 11) & 0xff);
    const code = encodeCode(bytes);
    expect(code).toMatch(/^[A-Z2-7]+$/);
    expect(decodeCode(code)).toEqual(bytes);
    expect(decodeCode(groupCode(code).toLowerCase())).toEqual(bytes);
    const typo = code.slice(0, 20) + (code[20] === 'A' ? 'B' : 'A') + code.slice(21);
    expect(decodeCode(typo)).toBeNull();
    expect(decodeCode(code.slice(0, -3))).toBeNull();
  });

  it('zero e um digitados no lugar de O e I são corrigidos', () => {
    const bytes = Uint8Array.from([0x6c, 0xa0, 0x8f, 0x33, 0x10]);
    const code = encodeCode(bytes);
    expect(decodeCode(code.replace(/O/g, '0').replace(/I/g, '1'))).toEqual(bytes);
  });

  it('CRC-16/CCITT-FALSE confere com o valor de referência', () => {
    expect(crc16(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });
});

describe('sinalização compacta', () => {
  it('lê a oferta do Chrome: credenciais, impressão digital e só candidatos UDP', () => {
    const offer = signalFromSdp(CHROME_OFFER, 'offer');
    expect(offer.ufrag).toBe('Xk9q');
    expect(offer.pwd).toBe('9Tq3bZ0yXw7Vn2Lm5Kp8Rs1u');
    expect(offer.setup).toBe('actpass');
    expect(offer.fingerprint).toHaveLength(32);
    expect(offer.candidates.map((c) => [c.kind, c.port])).toEqual([['mdns', 51937], ['mdns', 51938]]);
    expect(midOf(CHROME_OFFER)).toBe('0');
  });

  it('lê a resposta do Firefox: IPv4 e IPv6, sem o TCP', () => {
    const answer = signalFromSdp(FIREFOX_ANSWER, 'answer');
    expect(answer.setup).toBe('active');
    expect(answer.candidates.map((c) => c.kind)).toEqual(['ipv4', 'ipv6']);
  });

  it('o binário vai e volta sem perder nada', () => {
    for (const [sdp, role] of [[CHROME_OFFER, 'offer'], [FIREFOX_ANSWER, 'answer']] as const) {
      const signal = signalFromSdp(sdp, role);
      const back = decodeSignal(encodeSignal(signal));
      expect(back).not.toBeNull();
      expect(back!.role).toBe(role);
      expect(back!.ufrag).toBe(signal.ufrag);
      expect(back!.pwd).toBe(signal.pwd);
      expect(back!.setup).toBe(signal.setup);
      expect(Array.from(back!.fingerprint)).toEqual(Array.from(signal.fingerprint));
      expect(back!.candidates.map((c) => [c.kind, c.port])).toEqual(signal.candidates.map((c) => [c.kind, c.port]));
      // O endereço volta: IPv6 por extenso, mas o mesmo em bytes.
      for (let i = 0; i < signal.candidates.length; i++) {
        const a = signal.candidates[i];
        const b = back!.candidates[i];
        if (a.kind === 'ipv6') expect(ipv6Bytes(b.address)).toEqual(ipv6Bytes(a.address));
        else expect(b.address).toBe(a.address);
      }
    }
  });

  it('o código da oferta cabe num QR que um celular lê de longe (versão ≤ 8)', () => {
    const bytes = encodeSignal(signalFromSdp(CHROME_OFFER, 'offer'));
    expect(bytes.length).toBeLessThanOrEqual(120);
    expect(encodeQr(encodeCode(bytes)).version).toBeLessThanOrEqual(8);
  });

  it('bytes que não são sinal dão null, e não exceção', () => {
    expect(decodeSignal(Uint8Array.from([9, 9, 9]))).toBeNull();
    const good = encodeSignal(signalFromSdp(CHROME_OFFER, 'offer'));
    expect(decodeSignal(good.slice(0, good.length - 1))).toBeNull();
  });

  it('o SDP remontado tem o que o navegador precisa, e os candidatos voltam iguais', () => {
    const offer = signalFromSdp(CHROME_OFFER, 'offer');
    const sdp = sdpFromSignal(offer, '0');
    expect(sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(sdp).toContain(`a=fingerprint:sha-256 ${FP}`);
    expect(sdp).toContain('a=ice-ufrag:Xk9q');
    expect(sdp).toContain('a=setup:actpass');
    expect(sdp).toContain('a=mid:0');
    expect(sdp.endsWith('\r\n')).toBe(true);
    expect(candidatesOf(sdp)).toEqual(offer.candidates);
    expect(signalFromSdp(sdp, 'offer').ufrag).toBe('Xk9q');
  });

  it('IPv6 com e sem abreviação', () => {
    expect(Array.from(ipv6Bytes('::1')!)).toEqual([...new Array(15).fill(0), 1]);
    expect(ipv6Bytes('fe80::1%eth0')).not.toBeNull();
    expect(ipv6Bytes('1:2:3')).toBeNull();
    expect(ipv6Bytes('1::2::3')).toBeNull();
  });
});

describe('QR', () => {
  it('Reed–Solomon confere com o exemplo clássico de "HELLO WORLD", versão 1-M', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
    expect(interleave(data, 1)).toEqual([...data, 196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  it('bits de formato do nível M batem com a tabela da norma', () => {
    const table = [
      '101010000010010', '101000100100101', '101111001111100', '101101101001011',
      '100010111111001', '100000011001110', '100111110010111', '100101010100000',
    ];
    for (let mask = 0; mask < 8; mask++) {
      expect(formatBits(mask).toString(2).padStart(15, '0')).toBe(table[mask]);
    }
  });

  it('capacidade e alinhamento das versões conferem com a norma', () => {
    expect([1, 2, 5, 7, 10].map(dataCodewords)).toEqual([16, 28, 86, 124, 216]);
    expect(alignmentPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPositions(10)).toEqual([6, 28, 50]);
  });

  it('o QR carrega as marcas de posição e o formato da máscara escolhida', () => {
    const qr = encodeQr('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(4));
    const at = (x: number, y: number): number => qr.dark[y * qr.size + x];
    for (const [ox, oy] of [[0, 0], [qr.size - 7, 0], [0, qr.size - 7]]) {
      for (let i = 0; i < 7; i++) {
        expect(at(ox + i, oy)).toBe(1);
        expect(at(ox + i, oy + 6)).toBe(1);
      }
      expect(at(ox + 1, oy + 1)).toBe(0);
      expect(at(ox + 3, oy + 3)).toBe(1);
    }
    // Formato lido do canto de cima, na ordem em que foi escrito.
    let bits = 0;
    const cells: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
      [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    cells.forEach(([x, y], i) => { bits |= at(x, y) << i; });
    expect(bits).toBe(formatBits(qr.mask));
  });

  it('recusa o que não é alfanumérico e o que não cabe na versão 10', () => {
    expect(() => encodeQr('abc')).toThrow();
    expect(() => encodeQr('A'.repeat(400))).toThrow();
  });
});

describe('isolamento da página de rede', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
  const rel = (f: string): string => relative('src', f).split(sep).join('/');

  /** Os imports de valor de um arquivo, já resolvidos para `src/…`. */
  const valueImports = (file: string): string[] => {
    const code = readFileSync(file, 'utf8');
    const out: string[] = [];
    for (const m of code.matchAll(/^import\s+(type\s+)?[^;]*?from\s+'([^']+)';/gm)) {
      if (m[1] !== undefined) continue;
      out.push(relative('src', normalize(join(dirname(file), m[2]))).split(sep).join('/'));
    }
    return out;
  };

  it('a página de prova e tudo que ela puxa só importam de src/net/', () => {
    // A prova é outro ponto de entrada: um módulo do jogo nela iria para um
    // pedaço compartilhado que o `main` teria de importar.
    const seen = new Set<string>();
    const queue = ['net/probe'];
    const leaks: string[] = [];
    while (queue.length > 0) {
      const mod = queue.pop()!;
      if (seen.has(mod)) continue;
      seen.add(mod);
      for (const to of valueImports(join('src', `${mod}.ts`))) {
        if (!to.startsWith('net/')) leaks.push(`${mod} → ${to}`);
        else queue.push(to);
      }
    }
    expect(leaks).toEqual([]);
    expect(seen.has('net/link')).toBe(true);
  });

  it('o jogo não importa nada de src/net/ por valor: só o `netgate`, por URL', () => {
    const offenders = files('src').filter((f) => !rel(f).startsWith('net/'))
      .filter((f) => valueImports(f).some((to) => to.startsWith('net/')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('o jogo não importa a página de prova', () => {
    const offenders = files('src').filter((f) => !rel(f).startsWith('net/'))
      .filter((f) => /from\s+'[^']*net\/probe/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('rede.html sobe a prova; o precache leva a sala e não leva a prova', () => {
    expect(readFileSync('rede.html', 'utf8')).toContain('src="/src/net/probe.ts"');
    const config = readFileSync('vite.config.ts', 'utf8');
    // A sala do jogo (`n/`) vai para o cache offline; a página de prova, não.
    expect(config).not.toContain("!file.startsWith('n/')");
    expect(config).toContain("file !== 'rede.html'");
  });
});
