import { Ban, Clock, Printer } from 'lucide-react';
import type { Pedido, StatusPedido } from '../lib/tipos';
import { ACAO_STATUS, PROXIMO_STATUS, STATUS_ROTULO, brl, cx, hora, minutosDesde, tempoDesde } from '../lib/util';

interface Props {
  pedido: Pedido;
  agora: number;
  aoMudar: (status: StatusPedido) => void;
  aoImprimir?: () => void;
  compacto?: boolean;
}

export function PedidoCard({ pedido: p, agora, aoMudar, aoImprimir, compacto }: Props) {
  // Só bebidas/itens prontos: aceitar já deixa pronto para servir (pula "Em preparo")
  const semPreparo = p.status === 'novo' && p.precisa_preparo === false;
  const proximo = semPreparo ? 'pronto' : PROXIMO_STATUS[p.status];
  const rotuloAcao = semPreparo ? 'Aceitar e servir' : ACAO_STATUS[p.status];
  const emAndamento = p.status === 'novo' || p.status === 'preparando';
  const minutos = minutosDesde(p.criado_em, agora);
  const atrasado = emAndamento && minutos >= 20;
  const atencao = emAndamento && minutos >= 10;

  return (
    <article className={cx('pedido', `pedido--${p.status}`, compacto && 'pedido--compacto')}>
      <header className="pedido__topo">
        <div>
          <strong className="pedido__mesa">{p.mesa_nome}</strong>
          <span className="pedido__num">#{p.numero} · {hora(p.criado_em)}{p.precisa_preparo === false && ' · sem preparo'}</span>
        </div>
        <span className={cx('pedido__tempo', atencao && 'atencao', atrasado && 'atrasado')} title="Tempo desde o pedido">
          <Clock size={14} /> {tempoDesde(p.criado_em, agora)}
        </span>
      </header>

      <ul className="pedido__itens">
        {p.pedido_itens.map((i) => (
          <li key={i.id}>
            <span className="pedido__qtd">{i.qtd}×</span>
            <span>
              {i.nome}
              {i.obs && <em className="pedido__obs">» {i.obs}</em>}
            </span>
          </li>
        ))}
        {p.pedido_itens.length === 0 && <li className="muted">Carregando itens…</li>}
      </ul>

      {p.observacao && <p className="pedido__obs-geral">📝 {p.observacao}</p>}

      <footer className="pedido__rodape">
        <span className="pedido__total">{brl(p.total)}</span>
        <div className="pedido__acoes">
          {aoImprimir && (
            <button type="button" className="icone-btn" onClick={aoImprimir} title="Imprimir" aria-label="Imprimir pedido">
              <Printer size={18} />
            </button>
          )}
          {p.status !== 'entregue' && p.status !== 'cancelado' && (
            <button type="button" className="icone-btn icone-btn--perigo" onClick={() => aoMudar('cancelado')} title="Cancelar" aria-label="Cancelar pedido">
              <Ban size={18} />
            </button>
          )}
          {proximo ? (
            <button type="button" className={cx('btn btn--sm', p.status === 'preparando' ? 'btn--sucesso' : 'btn--primario')} onClick={() => aoMudar(proximo)}>
              {rotuloAcao}
            </button>
          ) : (
            <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
          )}
        </div>
      </footer>
    </article>
  );
}
