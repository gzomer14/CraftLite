/**
 * Agente de sessão longa, injetado **na página** (PROMPT.md §11).
 *
 * Ele joga sozinho: entra no menu, cria um mundo criativo, liga o voo e segura
 * o "para frente" — que é o pior caso do pipeline, porque voar em linha reta
 * nunca para de pedir chunk novo. A cada 30 s guarda uma amostra do overlay de
 * depuração, que já reúne tudo que interessa medir (doc 02 §6).
 *
 * Roda na página e não no driver de propósito: as amostras continuam sendo
 * coletadas mesmo se o processo que abriu o Chrome morrer, e o que se mede é o
 * que o jogador veria.
 *
 * Os campos da tela de criar mundo são achados **pela forma** e não pelo
 * rótulo: o rótulo é um `<span>` irmão do campo e o texto dele pode mudar sem
 * aviso.
 */
(() => {
  if (window.__soak !== undefined) return 'já instalado';
  const soak = {
    inicio: Date.now(), fase: 'boot', amostras: [], erros: [], pronto: false, travadas: 0,
  };
  window.__soak = soak;

  addEventListener('error', (e) => soak.erros.push({ t: Date.now(), msg: String(e.message) }));
  addEventListener('unhandledrejection', (e) => soak.erros.push({ t: Date.now(), msg: 'promise: ' + String(e.reason) }));

  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  const tecla = (tipo, code) =>
    window.dispatchEvent(new KeyboardEvent(tipo, { code, key: code, bubbles: true }));
  const visivel = () => [...document.querySelectorAll('[role="dialog"]')].filter((d) => !d.hidden).pop();
  const botao = (raiz, texto) =>
    [...raiz.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(texto));

  async function ateQue(cond, limite = 30000) {
    const fim = Date.now() + limite;
    while (Date.now() < fim) {
      const v = cond();
      if (v) return v;
      await esperar(200);
    }
    throw new Error('tempo esgotado esperando condição');
  }

  /** Altura atual, lida do overlay de depuração. */
  function altura() {
    const m = /XYZ [-\d.]+ \/ ([-\d.]+)/.exec(document.querySelector('#debug pre')?.textContent ?? '');
    return m === null ? null : Number(m[1]);
  }

  /**
   * Liga o voo e sobe **bem** acima do terreno, conferindo que funcionou.
   *
   * O duplo toque no pulo alterna o voo (doc 06 §9), e o terceiro aperto —
   * o que segura para subir — caía em cima dos 300 ms da janela do duplo
   * toque: às vezes ligava o voo, às vezes desligava o que acabara de ligar.
   * Era cara ou coroa, e no coroa o teste passava duas horas medindo um boneco
   * encalhado numa parede a seis blocos do nascimento. Agora o terceiro aperto
   * vem bem depois, e o resultado é **verificado**: subiu e ficou, está voando.
   */
  async function subir() {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const y0 = altura();
      tecla('keydown', 'Space'); tecla('keyup', 'Space');
      await esperar(120);
      tecla('keydown', 'Space'); tecla('keyup', 'Space');
      await esperar(1500);
      tecla('keydown', 'Space');
      await esperar(8000);
      tecla('keyup', 'Space');
      await esperar(1500);
      const y1 = altura();
      if (y0 !== null && y1 !== null && y1 - y0 > 25) return true;
    }
    return false;
  }

  async function entrar() {
    soak.fase = 'título';
    const titulo = await ateQue(() => {
      const t = document.getElementById('title-screen');
      return t !== null && !t.hidden ? t : null;
    });
    botao(titulo, 'Jogar').click();

    soak.fase = 'mundos';
    const mundos = await ateQue(() => {
      const m = document.getElementById('worlds-screen');
      return m !== null && !m.hidden ? m : null;
    });
    botao(mundos, 'Criar novo').click();
    await esperar(400);

    // Os campos são achados pela **forma**, não por rótulo: o rótulo é um
    // `<span>` irmão e não um `aria-label`, e o texto dele pode mudar.
    const campos = [...mundos.querySelectorAll('input, select')].filter((c) => c.type !== 'file');
    const textos = campos.filter((c) => c.tagName === 'INPUT');
    const nome = textos[0];
    const seed = textos[1];
    const modo = campos.find((c) => c.tagName === 'SELECT'
      && [...c.options].some((o) => o.value === 'creative'));
    if (nome === undefined || seed === undefined || modo === undefined) {
      throw new Error('formulário de criar mundo mudou de forma');
    }
    nome.value = 'Soak';
    nome.dispatchEvent(new Event('input', { bubbles: true }));
    seed.value = 'soak-' + Date.now();
    seed.dispatchEvent(new Event('input', { bubbles: true }));
    modo.value = 'creative';
    modo.dispatchEvent(new Event('change', { bubbles: true }));
    botao(mundos, 'Criar e jogar').click();

    soak.fase = 'carregando';
    await ateQue(() => visivel() === undefined && document.getElementById('hud') !== null, 60000);
    await esperar(3000);

    soak.fase = 'voando';
    tecla('keydown', 'F3'); tecla('keyup', 'F3');
    if (!await subir()) {
      soak.erros.push({ t: Date.now(), msg: 'não consegui ligar o voo' });
    }
    tecla('keydown', 'KeyW');
    /*
     * O "para frente" é **reafirmado**, não segurado.
     *
     * `Keyboard` esvazia as teclas apertadas no `blur` da janela — está certo,
     * senão perder o foco deixaria o jogador andando sozinho. Só que uma janela
     * headless perde o foco sem avisar, e o teste passou minutos com o jogador
     * imóvel num mundo que carregava normalmente: parecia saudável e não estava
     * medindo nada. Reapertar a cada 500 ms é imune a isso, e `e.repeat` é
     * falso nestes eventos, então cada um conta como aperto novo.
     */
    setInterval(() => tecla('keydown', 'KeyW'), 500);
    soak.pronto = true;
  }

  /** Lê o overlay de depuração, que já tem tudo que interessa medir. */
  function amostrar() {
    const pre = document.querySelector('#debug pre');
    const linhas = (pre?.textContent ?? '').split('\n');
    const num = (re, alvo) => {
      for (const l of alvo) { const m = re.exec(l); if (m) return Number(m[1]); }
      return null;
    };
    const mem = performance.memory?.usedJSHeapSize ?? 0;
    soak.amostras.push({
      min: +((Date.now() - soak.inicio) / 60000).toFixed(2),
      heapMB: +(mem / 1048576).toFixed(1),
      fps: num(/fps (\d+)/, linhas),
      frameMs: num(/fps \d+ \(([\d.]+)ms\)/, linhas),
      tickMs: num(/tick ([\d.]+)ms/, linhas),
      renderMs: num(/render ([\d.]+)ms/, linhas),
      colunas: num(/C: (\d+)\//, linhas),
      fila: num(/(\d+) na fila/, linhas),
      mobs: num(/E: (\d+) mobs/, linhas),
      itens: num(/(\d+) itens/, linhas),
      vertices: (() => { const m = /V: ([\dk]+) vértices/.exec(linhas[6] ?? ''); return m ? m[1] : null; })(),
      xyz: (() => { const m = /XYZ ([-\d.]+) \/ ([-\d.]+) \/ ([-\d.]+)/.exec(linhas[3] ?? ''); return m ? m.slice(1).map(Number) : null; })(),
      erros: soak.erros.length,
    });
    /*
     * Parado é falha, não silêncio.
     *
     * Um teste de sessão longa que mede um jogador imóvel não mede nada — e
     * foi exatamente o que aconteceu antes da reafirmação da tecla. Duas
     * amostras seguidas no mesmo lugar viram erro registrado.
     */
    const agora = soak.amostras.at(-1);
    const antes = soak.amostras.at(-2);
    if (agora?.xyz != null && antes?.xyz != null
      && agora.xyz.every((v, i) => v === antes.xyz[i])) {
      soak.travadas++;
      soak.erros.push({ t: Date.now(), msg: 'jogador parado em ' + agora.xyz.join('/') });
      /*
       * Destrava subindo. Um aperto só, e longe do anterior: dois apertos de
       * pulo em menos de 300 ms **alternam o voo** (doc 06 §9), e um watchdog
       * que desliga o voo que ele mesmo precisa seria um belo tiro no pé.
       */
      tecla('keydown', 'Space');
      setTimeout(() => tecla('keyup', 'Space'), 2000);
      tecla('keydown', 'KeyW');
    }
    if (soak.amostras.length > 5000) soak.amostras.splice(0, 1000);
  }

  entrar().catch((e) => { soak.erros.push({ t: Date.now(), msg: 'agente: ' + String(e) }); });
  setInterval(amostrar, 30000);
  return 'instalado';
})()
