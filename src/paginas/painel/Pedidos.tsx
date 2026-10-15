import { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { PedidoCard } from '../../componentes/PedidoCard';
import { useToast } from '../../componentes/Toast';
import { imprimirPedido } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { Pedido, StatusPedido } from '../../lib/tipos';
import { brl, inicioDoDia, useAgora } from '../../lib/util';
import { usePainel } from './Painel';

const COLUNAS: { status: StatusPedido; titulo: string }[] = [
  { status: 'novo', titulo: 'Novos' },
  { status: 'preparando', titulo: 'Em preparo' },
  { status: 'pronto', titulo: 'Prontos para levar' },
];

export function useMudarStatus() {
  const { atualizarPedido } = usePainel();
  const toast = useToast();
  return async (p: Pedido, status: StatusPedido) => {
    if (status === 'cancelado' && !confirm(`Cancelar o pedido #${p.numero} (${p.mesa_nome})? Os itens voltam para o estoque.`)) return;
    const antes = p.status;
    atualizarPedido(p.id, { status });
    const { error } = await supabase.rpc('pedido_mudar_status', { p_pedido: p.id, p_status: status });
    if (error) {
      atualizarPedido(p.id, { status: antes });
      toast(msgErro(error), 'erro');
    }
  };
}

export default function Pedidos() {
  const { pedidos, restaurante, carregando } = usePainel();
  const mudar = useMudarStatus();
  const agora = useAgora(20000);
  const [verFinalizados, setVerFinalizados] = useState(false);

  if (carregando) return <Carregando />;

  const hoje = inicioDoDia();
  const deHoje = pedidos.filter((p) => new Date(p.criado_em).getTime() >= hoje && p.status !== 'cancelado');
  const faturamento = deHoje.reduce((s, p) => s + Number(p.total), 0);
  const emAberto = pedidos.filter((p) => ['novo', 'preparando', 'pronto'].includes(p.status)).length;
  const finalizados = pedidos.filter((p) => p.status === 'entregue' || p.status === 'cancelado').slice().reverse();

  return (
    <div className="pagina">
      <div className="kpis">
        <div className="kpi"><span>Pedidos hoje</span><strong>{deHoje.length}</strong></div>
        <div className="kpi"><span>Vendido hoje</span><strong>{brl(faturamento)}</strong></div>
        <div className="kpi"><span>Ticket médio</span><strong>{brl(deHoje.length ? faturamento / deHoje.length : 0)}</strong></div>
        <div className="kpi"><span>Em andamento</span><strong>{emAberto}</strong></div>
      </div>

      <div className="quadro">
        {COLUNAS.map((col) => {
          const lista = pedidos.filter((p) => p.status === col.status);
          return (
            <section key={col.status} className={`coluna coluna--${col.status}`}>
              <header className="coluna__topo">
                <h2>{col.titulo}</h2>
                <span className="coluna__qtd">{lista.length}</span>
              </header>
              <div className="coluna__lista">
                {lista.map((p) => (
                  <PedidoCard
                    key={p.id}
                    pedido={p}
                    agora={agora}
                    aoMudar={(s) => void mudar(p, s)}
                    aoImprimir={() => imprimirPedido(p, restaurante.nome)}
                  />
                ))}
                {lista.length === 0 && <p className="coluna__vazia">Nada por aqui.</p>}
              </div>
            </section>
          );
        })}
      </div>

      <section className="finalizados">
        <button className="btn btn--fantasma" onClick={() => setVerFinalizados((v) => !v)}>
          {verFinalizados ? 'Esconder' : 'Ver'} finalizados recentes ({finalizados.length})
        </button>
        {verFinalizados && (
          finalizados.length ? (
            <div className="grade-pedidos">
              {finalizados.map((p) => (
                <PedidoCard key={p.id} pedido={p} agora={agora} aoMudar={() => {}} aoImprimir={() => imprimirPedido(p, restaurante.nome)} compacto />
              ))}
            </div>
          ) : (
            <Vazio icone={<ClipboardList size={32} />} titulo="Nenhum pedido finalizado ainda" />
          )
        )}
      </section>
    </div>
  );
}
