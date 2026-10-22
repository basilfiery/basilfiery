/* Configurações › Aparência: cor do sistema (painel). Laranja é a cor tradicional do BasilFiery. */
import { useEffect } from 'react';

export type TemaSistema = 'laranja' | 'vermelho' | 'verde';

export const TEMAS: Record<TemaSistema, { nome: string; texto: string; cor: string; cor2: string; claro: string; escuro: string }> = {
  laranja: { nome: 'Laranja', texto: 'A cor tradicional do BasilFiery', cor: '#ff5a1f', cor2: '#f97316', claro: '#ff6a2b', escuro: '#f04a10' },
  vermelho: { nome: 'Vermelho', texto: 'Forte e marcante', cor: '#e5322d', cor2: '#ef4444', claro: '#f0443c', escuro: '#c81e1e' },
  verde: { nome: 'Verde', texto: 'Leve, combina com hortifrúti e saudáveis', cor: '#16a34a', cor2: '#22c55e', claro: '#22b358', escuro: '#15803d' },
};

/**
 * Aplica a cor escolhida no sistema todo (inclusive nas janelas, que ficam fora do painel).
 * Sem escolha, o painel continua com a cor da loja nos destaques, como sempre foi.
 */
export function useTemaSistema(tema: TemaSistema | null | undefined) {
  useEffect(() => {
    const t = tema ? TEMAS[tema] : null;
    if (!t) return;
    const raiz = document.documentElement.style;
    const vars: [string, string][] = [['--fire', t.cor], ['--fire-2', t.cor2], ['--acento', t.cor], ['--tema-claro', t.claro], ['--tema-escuro', t.escuro]];
    for (const [k, v] of vars) raiz.setProperty(k, v);
    return () => { for (const [k] of vars) raiz.removeProperty(k); };
  }, [tema]);
}
