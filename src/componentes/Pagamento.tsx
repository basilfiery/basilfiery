import { useState, type CSSProperties, type ReactElement } from 'react';
import { Banknote, Check, CircleCheck, CreditCard, Receipt, WalletCards, type LucideProps } from 'lucide-react';
import type { FormaPagamento } from '../lib/tipos';
import { FORMAS, brl, cx, rotuloForma } from '../lib/util';

/** Símbolo do Pix (losango), no traço dos ícones do sistema. */
function IconePix({ size = 24, strokeWidth = 2, ...resto }: LucideProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...resto}>
      <path d="M10.6 3.4a2 2 0 0 1 2.8 0l7.2 7.2a2 2 0 0 1 0 2.8l-7.2 7.2a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1 0-2.8z" />
      <path d="M8.5 12h1.3c.5 0 1-.2 1.4-.6l.8-.8.8.8c.4.4.9.6 1.4.6h1.3" />
    </svg>
  );
}

const ICONES: Record<FormaPagamento, (p: LucideProps) => ReactElement> = {
  dinheiro: (p) => <Banknote {...p} />,
  pix: (p) => <IconePix {...p} />,
  credito: (p) => <CreditCard {...p} />,
  debito: (p) => <WalletCards {...p} />,
  outro: (p) => <Receipt {...p} />,
};

export const COR_FORMA: Record<FormaPagamento, string> = {
  dinheiro: '#16a34a',
  pix: '#0f9f95',
  credito: '#2563eb',
  debito: '#7c3aed',
  outro: '#64748b',
};

/** Ícone da forma de pagamento num quadradinho na cor dela. */
export function IconeForma({ forma, tamanho = 18, caixa = true }: { forma: FormaPagamento | string; tamanho?: number; caixa?: boolean }) {
  const f = (forma in ICONES ? forma : 'outro') as FormaPagamento;
  const icone = ICONES[f]({ size: tamanho, strokeWidth: 1.9, 'aria-hidden': true });
  if (!caixa) return icone;
  return <span className="icone-forma" style={{ '--cor': COR_FORMA[f] } as CSSProperties}>{icone}</span>;
}

/** Escolhe a forma e confirma num botão só (sem janelinha do navegador). */
export function SeletorPagamento({ total, ocupado, aoReceber }: { total: number; ocupado?: boolean; aoReceber: (forma: FormaPagamento) => void }) {
  const [forma, setForma] = useState<FormaPagamento | null>(null);
  const opcoes = FORMAS.filter((f) => f.id !== 'outro');

  return (
    <div className="pagar">
      <div className="pagar__topo">
        <span>Receber pagamento</span>
        <strong>{brl(total)}</strong>
      </div>
      <div className="pagar__formas" role="radiogroup" aria-label="Forma de pagamento">
        {opcoes.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={forma === f.id}
            className={cx('pagar__forma', forma === f.id && 'ativo')}
            style={{ '--cor': COR_FORMA[f.id] } as CSSProperties}
            onClick={() => setForma(f.id)}
            disabled={ocupado}
          >
            <IconeForma forma={f.id} tamanho={20} />
            <span>{f.rotulo}</span>
            <span className="pagar__marca" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="pagar__confirmar"
        disabled={!forma || ocupado}
        onClick={() => forma && aoReceber(forma)}
      >
        <CircleCheck size={19} />
        {ocupado ? 'Registrando…' : forma ? `Receber ${brl(total)} no ${rotuloForma(forma)}` : 'Escolha a forma de pagamento'}
      </button>
      <small className="pagar__nota">Ao confirmar, o valor entra no caixa e a mesa fica livre.</small>
    </div>
  );
}
