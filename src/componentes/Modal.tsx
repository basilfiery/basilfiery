import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../lib/util';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  titulo?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: number;
  classe?: string;
}

/** Modais abertos, do de baixo para o de cima: só o de cima fecha com Esc. */
const pilha: symbol[] = [];

export function Modal({ aberto, aoFechar, titulo, children, rodape, largura, classe }: Props) {
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;
  useEffect(() => {
    if (!aberto) return;
    const eu = Symbol('modal');
    pilha.push(eu);
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape' && pilha[pilha.length - 1] === eu) fecharRef.current(); };
    document.addEventListener('keydown', aoTeclar);
    document.body.classList.add('travado');
    return () => {
      document.removeEventListener('keydown', aoTeclar);
      pilha.splice(pilha.indexOf(eu), 1);
      if (!pilha.length) document.body.classList.remove('travado');
    };
  }, [aberto]);

  if (!aberto) return null;

  return createPortal(
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div
        className={cx('modal', classe)}
        style={largura ? { maxWidth: largura } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={typeof titulo === 'string' ? titulo : undefined}
      >
        {titulo !== undefined && (
          <header className="modal__topo">
            <h2>{titulo}</h2>
            <button type="button" className="icone-btn" onClick={aoFechar} aria-label="Fechar">
              <X size={20} />
            </button>
          </header>
        )}
        <div className="modal__corpo">{children}</div>
        {rodape && <footer className="modal__rodape">{rodape}</footer>}
      </div>
    </div>,
    document.body,
  );
}
