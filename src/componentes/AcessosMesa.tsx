import { useState } from 'react';
import { Check, MonitorSmartphone, Smartphone, Tablet, X } from 'lucide-react';
import { useToast } from './Toast';
import { msgErro, supabase } from '../lib/supabase';
import type { MesaAcesso } from '../lib/tipos';
import { cx, tempoDesde } from '../lib/util';

export const iconeAparelho = (aparelho: string | null, tamanho = 18) =>
  /tablet|ipad/i.test(aparelho ?? '') ? <Tablet size={tamanho} />
    : /celular|iphone|android/i.test(aparelho ?? '') ? <Smartphone size={tamanho} />
      : <MonitorSmartphone size={tamanho} />;

export async function responderAcesso(id: string, liberar: boolean, fixo = false) {
  const { error } = await supabase.rpc('mesa_acesso_responder', { p_acesso: id, p_liberar: liberar, p_fixo: fixo });
  if (error) throw error;
}

/**
 * Mesas pedindo para abrir: o cliente escaneou o QR (ou abriu o tablet) e quer fazer pedidos.
 * Só depois de liberar é que aquele aparelho consegue pedir — evita pedido feito de casa.
 */
export function AcessosPendentes({ acessos, agora, variante, aoResponder }: {
  acessos: MesaAcesso[];
  agora: number;
  variante: 'painel' | 'garcom';
  aoResponder: (id: string) => void;
}) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState<string | null>(null);
  if (!acessos.length) return null;

  async function responder(a: MesaAcesso, liberar: boolean, fixo = false) {
    setOcupado(a.id);
    try {
      await responderAcesso(a.id, liberar, fixo);
      aoResponder(a.id);
      toast(liberar ? `${a.mesa_nome} liberada${fixo ? ' (tablet fixo)' : ''}.` : `Pedido da ${a.mesa_nome} recusado.`, liberar ? 'ok' : 'info');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section className={cx('acessos', `acessos--${variante}`)} aria-label="Mesas pedindo para abrir">
      {acessos.map((a) => (
        <div key={a.id} className="acesso">
          <span className="acesso__icone" aria-hidden="true">{iconeAparelho(a.aparelho, variante === 'garcom' ? 20 : 18)}</span>
          <div className="acesso__texto">
            <strong>{a.cliente_nome ? `${a.cliente_nome.split(' ')[0]} quer fazer pedidos na ${a.mesa_nome}` : `${a.mesa_nome} quer fazer pedidos`}</strong>
            <small>{a.aparelho ?? 'Aparelho do cliente'} · {tempoDesde(a.criado_em, agora)} · confira se há alguém na mesa</small>
          </div>
          <div className="acesso__acoes">
            <button className="acesso__recusar" onClick={() => void responder(a, false)} disabled={ocupado === a.id} title="Recusar" aria-label={`Recusar ${a.mesa_nome}`}>
              <X size={18} />
            </button>
            {variante === 'painel' && (
              <button className="btn btn--contorno btn--sm" onClick={() => void responder(a, true, true)} disabled={ocupado === a.id} title="Libera este aparelho para sempre (tablet que fica na mesa)">
                <Tablet size={15} /> Tablet fixo
              </button>
            )}
            <button className="acesso__liberar" onClick={() => void responder(a, true)} disabled={ocupado === a.id}>
              <Check size={17} strokeWidth={2.6} /> Liberar
            </button>
          </div>
          {variante === 'garcom' && (
            <button className="acesso__fixo" onClick={() => void responder(a, true, true)} disabled={ocupado === a.id}>
              É o tablet que fica na mesa? Liberar sempre
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
