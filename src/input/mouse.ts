/**
 * Mouse com pointer lock.
 *
 * O delta é acumulado entre frames e consumido pelo tick — ler `movementX`
 * direto no handler faria a rotação depender da taxa de eventos do mouse, que
 * varia de 125 Hz a 1000 Hz conforme o aparelho.
 */

export class Mouse {
  private readonly canvas: HTMLElement;
  private accumX = 0;
  private accumY = 0;

  /** Radianos por pixel de movimento. */
  sensitivity = 0.0022;
  /** true = eixo vertical invertido (opção do jogador). */
  invertY = false;

  locked = false;
  /** Disparado quando o pointer lock entra ou sai. */
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;

    canvas.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.accumX += e.movementX;
      this.accumY += e.movementY;
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      this.accumX = 0;
      this.accumY = 0;
      this.onLockChange?.(this.locked);
    });

    // Falha de lock é comum (o navegador exige gesto do usuário) e não é fatal.
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false);
    });
  }

  requestLock(): void {
    if (this.locked) return;
    void this.canvas.requestPointerLock();
  }

  exitLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /**
   * Consome o movimento acumulado e devolve o delta de yaw/pitch em radianos.
   * Escreve em `out` (2 elementos) para não alocar por tick.
   */
  consume(out: Float32Array): void {
    // Yaw negativo: com up=+Y e forward=+Z num sistema destro, o vetor "direita"
    // da câmera é −X, então mover o mouse para a direita diminui o yaw.
    out[0] = -this.accumX * this.sensitivity;
    // Pitch positivo olha para baixo (forward.y = −sin pitch), e `movementY` é
    // positivo quando o mouse desce — os dois já concordam, então o delta vai
    // direto. `invertY` é a opção do jogador, não a correção do sinal.
    out[1] = (this.invertY ? -this.accumY : this.accumY) * this.sensitivity;
    this.accumX = 0;
    this.accumY = 0;
  }
}
