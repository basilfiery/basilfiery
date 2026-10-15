import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cx } from '../lib/util';

export function Logo({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`logo logo--${tamanho}`}>
      <img src="/icone.svg" alt="" className="logo__icone" />
      <span className="logo__nome">
        <span className="logo__basil">Basil</span>
        <span className="logo__fiery">Fiery</span>
      </span>
    </span>
  );
}

interface StepperProps {
  valor: number;
  aoMudar: (v: number) => void;
  min?: number;
  max?: number;
  grande?: boolean;
}

export function Stepper({ valor, aoMudar, min = 1, max = 99, grande }: StepperProps) {
  return (
    <div className={cx('stepper', grande && 'stepper--lg')}>
      <button type="button" onClick={() => aoMudar(valor - 1)} disabled={valor <= min} aria-label="Diminuir">
        <Minus size={grande ? 22 : 16} />
      </button>
      <span aria-live="polite">{valor}</span>
      <button type="button" onClick={() => aoMudar(valor + 1)} disabled={valor >= max} aria-label="Aumentar">
        <Plus size={grande ? 22 : 16} />
      </button>
    </div>
  );
}

export function Switch({ marcado, aoMudar, children, desativado }: {
  marcado: boolean;
  aoMudar: (v: boolean) => void;
  children?: ReactNode;
  desativado?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={marcado} disabled={desativado} onChange={(e) => aoMudar(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
      {dica && <small className="campo__dica">{dica}</small>}
    </label>
  );
}

export function Vazio({ icone, titulo, children }: { icone?: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      {icone && <div className="vazio__icone">{icone}</div>}
      <strong>{titulo}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

/** Selos do produto: mais pedido, novo, vegetariano, picância. */
export function Selos({ p }: { p: { destaque?: boolean; novo?: boolean; vegetariano?: boolean; picancia?: number } }) {
  if (!p.destaque && !p.novo && !p.vegetariano && !p.picancia) return null;
  return (
    <div className="selos">
      {p.destaque && <span className="selo selo--top">★ Mais pedido</span>}
      {p.novo && <span className="selo selo--novo">Novo</span>}
      {p.vegetariano && <span className="selo selo--veg">🌿 Vegetariano</span>}
      {!!p.picancia && (
        <span className="selo selo--pic" title={`Picância ${p.picancia} de 3`} aria-label={`Picância ${p.picancia} de 3`}>
          {'🌶️'.repeat(p.picancia)}
        </span>
      )}
    </div>
  );
}

export function FotoProduto({ p, classe }: { p: { imagem_url: string | null; emoji: string | null; nome: string }; classe?: string }) {
  return (
    <div className={cx('foto', classe)}>
      {p.imagem_url ? <img src={p.imagem_url} alt={p.nome} loading="lazy" /> : <span aria-hidden="true">{p.emoji || '🍽️'}</span>}
    </div>
  );
}
