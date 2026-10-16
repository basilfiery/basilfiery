import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Botão que abre o menu. Recebe se está aberto e a função para abrir/fechar. */
  gatilho: (aberto: boolean, alternar: () => void) => ReactNode;
  /** Conteúdo do menu. Recebe a função para fechá-lo. */
  children: (fechar: () => void) => ReactNode;
  alinhar?: 'dir' | 'esq';
  largura?: number;
}

/**
 * Menu suspenso desenhado por cima de tudo (portal), para não ser cortado
 * por colunas com rolagem. Fecha ao clicar fora, com Esc ou ao rolar a tela.
 */
export function Suspenso({ gatilho, children, alinhar = 'dir', largura }: Props) {
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const ancora = useRef<HTMLSpanElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const fechar = useCallback(() => setAberto(false), []);

  useLayoutEffect(() => {
    if (!aberto || !ancora.current) return;
    const r = ancora.current.getBoundingClientRect();
    const altura = painel.current?.offsetHeight ?? 280;
    const cabeAbaixo = r.bottom + 8 + altura < window.innerHeight;
    const vertical: CSSProperties = cabeAbaixo ? { top: r.bottom + 8 } : { bottom: window.innerHeight - r.top + 8 };
    const horizontal: CSSProperties = alinhar === 'dir'
      ? { right: Math.max(8, window.innerWidth - r.right) }
      : { left: Math.max(8, r.left) };
    setPos({ ...vertical, ...horizontal });
  }, [aberto, alinhar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!ancora.current?.contains(alvo) && !painel.current?.contains(alvo)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    const rolar = (e: Event) => { if (!painel.current?.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', rolar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', rolar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto, fechar]);

  return (
    <span className="suspenso" ref={ancora} onClick={(e) => e.stopPropagation()}>
      {gatilho(aberto, () => setAberto((v) => !v))}
      {aberto && createPortal(
        <div ref={painel} className="suspenso__painel" role="menu" style={{ ...pos, width: largura }} onClick={(e) => e.stopPropagation()}>
          {children(fechar)}
        </div>,
        document.body,
      )}
    </span>
  );
}
