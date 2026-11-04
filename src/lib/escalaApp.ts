import { useEffect } from 'react';

/**
 * App do garçom igual em qualquer celular: a tela é montada numa largura de referência
 * e encolhe (zoom) para caber no aparelho. Assim, celular pequeno ou com a letra do
 * Android aumentada (o Chrome aplica como zoom da página) não deixa letras e botões gigantes.
 * Só encolhe, nunca aumenta (tablet fica no tamanho normal).
 */
const LARGURA_REFERENCIA = 392;
const MENOR_ESCALA = 0.72;

export function useEscalaApp(ativo = true) {
  useEffect(() => {
    if (!ativo) return;
    const raiz = document.documentElement;
    const aplicar = () => {
      const largura = window.innerWidth;
      const z = Math.max(MENOR_ESCALA, Math.min(1, largura / LARGURA_REFERENCIA));
      raiz.style.setProperty('zoom', z >= 0.995 ? '' : z.toFixed(3));
      raiz.style.setProperty('--escala-app', String(z));
    };
    aplicar();
    window.addEventListener('resize', aplicar);
    window.addEventListener('orientationchange', aplicar);
    return () => {
      window.removeEventListener('resize', aplicar);
      window.removeEventListener('orientationchange', aplicar);
      raiz.style.removeProperty('zoom');
      raiz.style.removeProperty('--escala-app');
    };
  }, [ativo]);
}
