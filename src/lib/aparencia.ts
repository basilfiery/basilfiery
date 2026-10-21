import { useCallback, useEffect, useState } from 'react';
import { ls } from './util';

/*
 * Aparência (clara ou escura) dos apps de celular: garçom e dono.
 * Cada aparelho guarda a sua escolha. Padrão: escuro.
 */
export type Aparencia = 'escuro' | 'claro';

const EVENTO = 'bf:aparencia';

/**
 * @param app  'garcom' usa as cores do sistema (atributo data-tema);
 *             'dono' usa as cores próprias do app do dono (atributo data-dono-tema)
 */
export function useAparencia(app: 'garcom' | 'dono', aplicarNaTela = false) {
  const chave = `bf:${app}:aparencia`;
  const [aparencia, setEstado] = useState<Aparencia>(() => ls.ler<Aparencia>(chave, 'escuro'));

  // Outras partes do app (ex.: tela de configurações) avisam quando mudam
  useEffect(() => {
    const ouvir = (e: Event) => { if ((e as CustomEvent).detail?.app === app) setEstado((e as CustomEvent).detail.valor); };
    window.addEventListener(EVENTO, ouvir);
    return () => window.removeEventListener(EVENTO, ouvir);
  }, [app]);

  // Só o componente principal do app pinta a tela (e desfaz ao sair do app)
  useEffect(() => {
    if (!aplicarNaTela) return;
    const raiz = document.documentElement;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const corAntes = meta?.content;
    if (app === 'garcom') {
      if (aparencia === 'claro') raiz.dataset.tema = 'claro'; else delete raiz.dataset.tema;
    } else {
      raiz.dataset.donoTema = aparencia;
    }
    if (meta) meta.content = aparencia === 'claro' ? '#f4f5f4' : '#0a0a0a';
    return () => {
      if (app === 'garcom') delete raiz.dataset.tema; else delete raiz.dataset.donoTema;
      if (meta && corAntes) meta.content = corAntes;
    };
  }, [app, aparencia, aplicarNaTela]);

  const definir = useCallback((valor: Aparencia) => {
    ls.gravar(chave, valor);
    setEstado(valor);
    window.dispatchEvent(new CustomEvent(EVENTO, { detail: { app, valor } }));
  }, [app, chave]);

  return [aparencia, definir] as const;
}
