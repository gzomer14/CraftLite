/**
 * Driver mínimo do Chrome DevTools Protocol.
 *
 * **Zero dependência**, como todo o resto do projeto: o Node 22 já traz
 * `fetch` e `WebSocket` globais, e o CDP é só JSON sobre um socket. Puppeteer
 * faria o mesmo trazendo 300 MB e um Chrome próprio — aqui se usa o Chrome que
 * já está instalado.
 *
 * Só o que os dois testes de sessão precisam: achar a aba, avaliar expressão e
 * mandar comando cru.
 */
export async function conectar(porta) {
  for (let i = 0; i < 100; i++) {
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${porta}/json/list`)).json();
      const pagina = alvos.find((a) => a.type === 'page' && a.webSocketDebuggerUrl);
      if (pagina !== undefined) return abrir(pagina.webSocketDebuggerUrl);
    } catch { /* o Chrome ainda não subiu */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Chrome não respondeu na porta de depuração');
}

function abrir(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pendentes = new Map();
    let proximo = 1;
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      const p = pendentes.get(msg.id);
      if (p === undefined) return;
      pendentes.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => resolve({
      enviar(metodo, params = {}) {
        const id = proximo++;
        ws.send(JSON.stringify({ id, method: metodo, params }));
        return new Promise((res, rej) => pendentes.set(id, { resolve: res, reject: rej }));
      },
      async avaliar(expressao) {
        const r = await this.enviar('Runtime.evaluate', {
          expression: expressao, awaitPromise: true, returnByValue: true,
        });
        if (r.exceptionDetails) {
          throw new Error(r.exceptionDetails.exception?.description ?? 'erro na página');
        }
        return r.result.value;
      },
      fechar() { ws.close(); },
    }));
  });
}
