import { useEffect, useState } from 'react';
import { Minus, Plus, Users } from 'lucide-react';
import { useToast } from './Toast';
import { msgErro, supabase } from '../lib/supabase';
import type { Mesa } from '../lib/tipos';
import { cx } from '../lib/util';

/**
 * Quantas pessoas estão na mesa: − número +. Salva na hora (zera sozinho quando a conta fecha).
 * Usado no app do garçom e no sistema (cartão da mesa e tela de lançar pedido).
 */
export function PessoasMesa({ mesa, aoMudar, variante = 'normal' }: {
  mesa: Mesa;
  aoMudar?: (n: number | null) => void;
  variante?: 'normal' | 'compacto';
}) {
  const toast = useToast();
  const [n, setN] = useState<number | null>(mesa.pessoas ?? null);
  useEffect(() => { setN(mesa.pessoas ?? null); }, [mesa.id, mesa.pessoas]);

  async function definir(novo: number | null) {
    const antes = n;
    setN(novo);
    aoMudar?.(novo);
    const { error } = await supabase.rpc('mesa_definir_pessoas', { p_mesa: mesa.id, p_pessoas: novo ?? 0 });
    if (error) {
      setN(antes);
      aoMudar?.(antes);
      toast(msgErro(error), 'erro');
    }
  }

  const rotulo = n ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'}` : 'Pessoas';
  return (
    <div className={cx('pessoas-mesa', `pessoas-mesa--${variante}`)} onClick={(e) => e.stopPropagation()}>
      {variante === 'normal' && <span className="pessoas-mesa__rotulo"><Users size={18} /> <span><b>Pessoas na mesa</b><small>{n ? rotulo : 'Toque no + para colocar'}</small></span></span>}
      <div className="pessoas-mesa__passo" role="group" aria-label="Pessoas na mesa">
        <button type="button" aria-label="Menos uma pessoa" disabled={!n} onClick={() => void definir(n && n > 1 ? n - 1 : null)}><Minus size={variante === 'compacto' ? 14 : 18} strokeWidth={2.6} /></button>
        {variante === 'compacto'
          ? <b className={cx(!n && 'sem')}><Users size={14} /> {n ?? '—'}</b>
          : <b className={cx(!n && 'sem')}>{n ?? '—'}</b>}
        <button type="button" aria-label="Mais uma pessoa" disabled={(n ?? 0) >= 99} onClick={() => void definir(Math.min(99, (n ?? 0) + 1))}><Plus size={variante === 'compacto' ? 14 : 18} strokeWidth={2.6} /></button>
      </div>
    </div>
  );
}
