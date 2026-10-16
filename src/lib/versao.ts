import { useEffect, useState } from 'react';
import { ls } from './util';

export const VERSAO_ATUAL = __VERSAO__;
/** Versão curta para mostrar na tela (ex.: 3768cb7). */
export const VERSAO_CURTA = VERSAO_ATUAL.startsWith('local-') ? 'local' : VERSAO_ATUAL.slice(0, 7);
const CHAVE_ADIADA = 'bf:atualizacao-adiada';

/**
 * Verifica de tempos em tempos se saiu uma publicação nova.
 * Devolve o identificador da versão nova, ou null se esta já é a mais recente.
 */
export function useNovaVersao(intervalo = 60000): string | null {
  const [nova, setNova] = useState<string | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let ativo = true;
    const checar = async () => {
      try {
        const r = await fetch(`/versao.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { versao } = (await r.json()) as { versao?: string };
        if (ativo && versao && versao !== VERSAO_ATUAL) setNova(versao);
      } catch { /* sem internet: tenta na próxima */ }
    };
    void checar();
    const i = setInterval(checar, intervalo);
    const aoVoltar = () => { if (document.visibilityState === 'visible') void checar(); };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      ativo = false;
      clearInterval(i);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [intervalo]);

  return nova;
}

export function aplicarAtualizacao() {
  ls.gravar(CHAVE_ADIADA, null);
  window.location.reload();
}

/** "Atualizar quando fechar o caixa": guarda qual versão foi adiada. */
export const adiarAtualizacao = (versao: string) => ls.gravar(CHAVE_ADIADA, versao);
export const versaoAdiada = () => ls.ler<string | null>(CHAVE_ADIADA, null);
