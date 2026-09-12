import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Os testes de orçamento de performance medem tempo de parede. Com os
    // arquivos rodando em paralelo, eles competem por CPU e medem contenção em
    // vez de regressão — 5 ms viram 55 ms. Rodar em série custa alguns segundos
    // e faz os números significarem alguma coisa.
    fileParallelism: false,
    include: ['tests/**/*.test.ts'],
  },
});
