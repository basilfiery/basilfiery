import { useState } from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { msgErro, supabase } from '../lib/supabase';
import type { Mesa } from '../lib/tipos';
import { brl, cx } from '../lib/util';
import { confirmar } from './Confirmar';

/**
 * O cliente mudou de mesa: leva a conta aberta (pedidos e chamados) para a mesa nova.
 * Se a mesa escolhida já tiver conta, as duas são juntadas.
 */
export function ModalTrocarMesa({ origem, mesas, totalDa, aoFechar, aoTrocar }: {
  origem: Mesa;
  mesas: Mesa[];
  /** Total em aberto de cada mesa (0 = livre) */
  totalDa: (mesaId: string) => number;
  aoFechar: () => void;
  aoTrocar: (destino: Mesa) => void;
}) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const opcoes = mesas.filter((m) => m.id !== origem.id && m.ativo);
  const livres = opcoes.filter((m) => totalDa(m.id) === 0);
  const ocupadas = opcoes.filter((m) => totalDa(m.id) > 0);

  async function trocar(destino: Mesa) {
    const juntar = totalDa(destino.id) > 0;
    const pergunta = juntar
      ? `A ${destino.nome} já tem conta aberta (${brl(totalDa(destino.id))}). Juntar a conta da ${origem.nome} com ela?`
      : `Passar a conta da ${origem.nome} para a ${destino.nome}?`;
    if (!(await confirmar(pergunta, { sim: juntar ? 'Juntar contas' : 'Trocar de mesa' }))) return;
    setEnviando(true);
    const { error } = await supabase.rpc('mesa_trocar', { p_origem: origem.id, p_destino: destino.id });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(juntar ? `Contas juntadas na ${destino.nome}.` : `Conta passada para a ${destino.nome}. A ${origem.nome} está livre.`, 'ok');
    aoTrocar(destino);
  }

  const botao = (m: Mesa) => (
    <button key={m.id} className={cx('troca-mesa', totalDa(m.id) > 0 && 'troca-mesa--ocupada')} onClick={() => void trocar(m)} disabled={enviando}>
      <strong>{m.nome}</strong>
      <small>{totalDa(m.id) > 0 ? `Ocupada · ${brl(totalDa(m.id))}` : 'Livre'}</small>
    </button>
  );

  return (
    <Modal aberto aoFechar={aoFechar} titulo={`Trocar a ${origem.nome} de lugar`} largura={520}>
      <p className="muted" style={{ marginTop: 0 }}>
        <ArrowRightLeft size={16} style={{ verticalAlign: '-3px' }} /> Para qual mesa o cliente foi? Os pedidos e chamados
        em aberto vão junto, e a {origem.nome} fica livre.
      </p>
      {opcoes.length === 0 && <p className="muted">Não há outras mesas ativas.</p>}
      {livres.length > 0 && (
        <>
          <h3 className="troca-mesa__titulo">Mesas livres</h3>
          <div className="troca-mesa__grade">{livres.map(botao)}</div>
        </>
      )}
      {ocupadas.length > 0 && (
        <>
          <h3 className="troca-mesa__titulo">Ocupadas (junta as contas)</h3>
          <div className="troca-mesa__grade">{ocupadas.map(botao)}</div>
        </>
      )}
    </Modal>
  );
}
