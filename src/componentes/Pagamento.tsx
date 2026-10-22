import { useState, type CSSProperties, type ReactElement } from 'react';
import { Banknote, Check, CircleCheck, CreditCard, Receipt, WalletCards, type LucideProps } from 'lucide-react';
import type { FormaPagamento } from '../lib/tipos';
import { FORMAS, brl, cx, rotuloForma } from '../lib/util';

/** Logo oficial do Pix (mesma do cardápio delivery). Um pouco menor que o quadro, como os outros ícones. */
export function IconePix({ size = 24, className, style }: LucideProps) {
  return (
    <svg width={size} height={size} viewBox="-48 -48 608 608" className={className} style={style} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M242.4 292.5C247.8 287.1 257.1 287.1 262.5 292.5L339.5 369.5C353.7 383.7 372.6 391.5 392.6 391.5H407.7L310.6 488.6C280.3 518.1 231.1 518.1 200.8 488.6L103.3 391.2H112.6C132.6 391.2 151.5 383.4 165.7 369.2L242.4 292.5zM262.5 218.9C256.1 224.4 247.9 224.5 242.4 218.9L165.7 142.2C151.5 127.1 132.6 120.2 112.6 120.2H103.3L200.7 22.76C231.1-7.586 280.3-7.586 310.6 22.76L407.8 119.9H392.6C372.6 119.9 353.7 127.7 339.5 141.9L262.5 218.9zM112.6 142.7C126.4 142.7 139.1 148.3 149.7 158.1L226.4 234.8C233.6 241.1 243 245.6 252.5 245.6C261.9 245.6 271.3 241.1 278.5 234.8L355.5 157.8C365.3 148.1 378.8 142.5 392.6 142.5H430.3L488.6 200.8C518.9 231.1 518.9 280.3 488.6 310.6L430.3 368.9H392.6C378.8 368.9 365.3 363.3 355.5 353.5L278.5 276.5C264.6 262.6 240.3 262.6 226.4 276.6L149.7 353.2C139.1 363 126.4 368.6 112.6 368.6H80.78L22.76 310.6C-7.586 280.3-7.586 231.1 22.76 200.8L80.78 142.7H112.6z" />
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
