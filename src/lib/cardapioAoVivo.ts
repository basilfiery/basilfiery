import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Cardápio sempre igual ao sistema: o banco avisa no canal "cardapio:<restaurante>" a cada mudança
 * (banner, produto, preço, esgotado…) e o aparelho recarrega na hora.
 * O atraso pequeno e aleatório junta várias mudanças seguidas e não recarrega todos os tablets no mesmo instante.
 */
export function useCardapioAoVivo(restauranteId: string | undefined, recarregar: () => void) {
  const ref = useRef(recarregar);
  ref.current = recarregar;

  useEffect(() => {
    if (!restauranteId) return;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const pedir = () => {
      clearTimeout(espera);
      espera = setTimeout(() => ref.current(), 250 + Math.random() * 500);
    };
    const canal = supabase
      .channel(`cardapio:${restauranteId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'mudou' }, pedir)
      .subscribe();
    const aoVoltar = () => { if (document.visibilityState === 'visible') pedir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', aoVoltar);
    return () => {
      clearTimeout(espera);
      void supabase.removeChannel(canal);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', aoVoltar);
    };
  }, [restauranteId]);
}
