import { useEffect, useState } from 'react';
import { Bike, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ClipboardList, Printer, Search, ShoppingBasket, Store, UtensilsCrossed } from 'lucide-react';
import { Modal } from '../../../componentes/Modal';
import { useToast } from '../../../componentes/Toast';
import { imprimirPedido } from '../../../lib/impressao';
import { msgErro, supabase } from '../../../lib/supabase';
import type { Pedido, StatusPedido } from '../../../lib/tipos';
import { STATUS_ROTULO, brl, cx, rotuloForma } from '../../../lib/util';
import { usePainel } from '../Painel';
import { PaginaConfig } from './Layout';

type Periodo = 'hoje' | '7' | '30' | 'mes' | 'outro';
const TIPOS: Record<Pedido['tipo'], string> = { mesa: 'Mesa', delivery: 'Delivery', retirada: 'Retirada', balcao: 'Balcão' };
const iconeTipo = (t: Pedido['tipo'], n = 15) =>
  t === 'delivery' ? <Bike size={n} /> : t === 'retirada' ? <Store size={n} /> : t === 'balcao' ? <ShoppingBasket size={n} /> : <UtensilsCrossed size={n} />;
const dataCurta = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hojeISO = () => new Date().toLocaleDateString('sv-SE');

function intervalo(p: Periodo, de: string, ate: string): [Date, Date] {
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  const amanha = new Date(inicio); amanha.setDate(amanha.getDate() + 1);
  if (p === '7') { inicio.setDate(inicio.getDate() - 6); }
  if (p === '30') { inicio.setDate(inicio.getDate() - 29); }
  if (p === 'mes') { inicio.setDate(1); }
  if (p === 'outro') {
    const a = new Date(`${de}T00:00:00`); const b = new Date(`${ate}T00:00:00`); b.setDate(b.getDate() + 1);
    return [a, b];
  }
  return [inicio, amanha];
}

/** Rodapé de tabela: total de registros, páginas e quantidade por página (como no Anota AI). */
export function Paginacao({ total, pagina, porPagina, aoPagina, aoPorPagina }: {
  total: number; pagina: number; porPagina: number; aoPagina: (n: number) => void; aoPorPagina: (n: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="cfg-paginacao">
      <span>Total de <b>{total}</b> {total === 1 ? 'registro' : 'registros'}</span>
      <div className="cfg-paginacao__ctrl">
        <span className="cfg-paginacao__pag">{pagina} de {paginas}</span>
        <button className="icone-btn" disabled={pagina <= 1} onClick={() => aoPagina(1)} aria-label="Primeira página"><ChevronsLeft size={18} /></button>
        <button className="icone-btn" disabled={pagina <= 1} onClick={() => aoPagina(pagina - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
        <button className="icone-btn" disabled={pagina >= paginas} onClick={() => aoPagina(pagina + 1)} aria-label="Próxima página"><ChevronRight size={18} /></button>
        <button className="icone-btn" disabled={pagina >= paginas} onClick={() => aoPagina(paginas)} aria-label="Última página"><ChevronsRight size={18} /></button>
        <select className="select" value={porPagina} onChange={(e) => aoPorPagina(Number(e.target.value))} aria-label="Por página">
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
    </div>
  );
}

export default function HistoricoPedidos() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [periodo, setPeriodo] = useState<Periodo>('7');
  const [de, setDe] = useState(hojeISO());
  const [ate, setAte] = useState(hojeISO());
  const [tipo, setTipo] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaFinal, setBuscaFinal] = useState('');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [res, setRes] = useState<{ lista: Pedido[]; total: number; soma: number } | null>(null);
  const [aberto, setAberto] = useState<Pedido | null>(null);

  useEffect(() => { const t = setTimeout(() => setBuscaFinal(busca.trim()), 350); return () => clearTimeout(t); }, [busca]);
  useEffect(() => setPagina(1), [periodo, de, ate, tipo, status, buscaFinal, porPagina]);

  useEffect(() => {
    let vivo = true;
    const [ini, fim] = intervalo(periodo, de, ate);
    const filtrar = <T,>(q: T) => {
      let x = q as any;
      x = x.eq('restaurante_id', r.id).gte('criado_em', ini.toISOString()).lt('criado_em', fim.toISOString());
      if (tipo) x = x.eq('tipo', tipo);
      if (status) x = x.eq('status', status);
      if (buscaFinal) {
        if (/^\d+$/.test(buscaFinal)) x = x.eq('numero', Number(buscaFinal));
        else {
          const t = buscaFinal.replace(/[,()%*]/g, ' ');
          x = x.or(`cliente_nome.ilike.%${t}%,mesa_nome.ilike.%${t}%`);
        }
      }
      return x as T;
    };
    setRes(null);
    void Promise.all([
      filtrar(supabase.from('pedidos').select('*, pedido_itens(*)', { count: 'exact' })).order('criado_em', { ascending: false }).range((pagina - 1) * porPagina, pagina * porPagina - 1),
      filtrar(supabase.from('pedidos').select('total')).neq('status', 'cancelado').limit(10000),
    ]).then(([a, b]) => {
      if (!vivo) return;
      if (a.error) { toast(msgErro(a.error), 'erro'); setRes({ lista: [], total: 0, soma: 0 }); return; }
      setRes({ lista: (a.data ?? []) as Pedido[], total: a.count ?? 0, soma: (b.data ?? []).reduce((s, x) => s + Number((x as { total: number }).total), 0) });
    });
    return () => { vivo = false; };
  }, [r.id, periodo, de, ate, tipo, status, buscaFinal, pagina, porPagina, toast]);

  const pagamento = (p: Pedido) =>
    p.status === 'cancelado' ? '—'
      : p.pago_em ? (p.forma_pagamento ? rotuloForma(p.forma_pagamento) : 'Pago na conta')
        : p.tipo === 'mesa' ? 'Conta da mesa' : 'A receber';

  return (
    <PaginaConfig titulo="Meus pedidos">
      <div className="cfg-filtros">
        <div className="segmentado">
          {([['hoje', 'Hoje'], ['7', '7 dias'], ['30', '30 dias'], ['mes', 'Este mês'], ['outro', 'Escolher']] as [Periodo, string][]).map(([id, t]) => (
            <button key={id} type="button" className={cx(periodo === id && 'ativo')} onClick={() => setPeriodo(id)}>{t}</button>
          ))}
        </div>
        {periodo === 'outro' && (
          <div className="cfg-datas">
            <input className="input" type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} aria-label="De" />
            <span>até</span>
            <input className="input" type="date" value={ate} min={de} max={hojeISO()} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
          </div>
        )}
      </div>
      <div className="cfg-tabela__barra">
        <label className="cfg-busca"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº do pedido, cliente ou mesa" /></label>
        <select className="select" value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Origem">
          <option value="">Todas as origens</option>
          {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
          <option value="">Todas as situações</option>
          {(Object.keys(STATUS_ROTULO) as StatusPedido[]).map((k) => <option key={k} value={k}>{STATUS_ROTULO[k]}</option>)}
        </select>
      </div>
      {res && res.total > 0 && <p className="cfg-resumo">{res.total} {res.total === 1 ? 'pedido' : 'pedidos'} · <b>{brl(res.soma)}</b> em vendas (sem cancelados)</p>}

      {!res ? <div className="spinner" style={{ margin: '40px auto' }} /> : res.lista.length === 0 ? (
        <div className="cfg-vazio-grande">
          <ClipboardList size={40} strokeWidth={1.4} />
          <strong>Nenhum pedido neste período</strong>
          <p>Troque o período ou os filtros acima.</p>
        </div>
      ) : (
        <div className="cfg-tabela">
          <table>
            <thead><tr><th>Pedido</th><th>Data</th><th>Origem</th><th className="num">Itens</th><th>Pagamento</th><th>Situação</th><th className="num">Total</th></tr></thead>
            <tbody>
              {res.lista.map((p) => (
                <tr key={p.id} className="clicavel" onClick={() => setAberto(p)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setAberto(p)}>
                  <td data-rotulo="Pedido"><strong>#{p.numero}</strong></td>
                  <td data-rotulo="Data">{dataCurta(p.criado_em)}</td>
                  <td data-rotulo="Origem"><span className="cfg-origem">{iconeTipo(p.tipo)} {p.tipo === 'mesa' ? p.mesa_nome : p.cliente_nome || TIPOS[p.tipo]}</span></td>
                  <td data-rotulo="Itens" className="num">{p.pedido_itens.reduce((s, i) => s + i.qtd, 0)}</td>
                  <td data-rotulo="Pagamento">{pagamento(p)}</td>
                  <td data-rotulo="Situação"><span className={cx('cfg-status', `cfg-status--${p.status}`)}>{STATUS_ROTULO[p.status]}</span></td>
                  <td data-rotulo="Total" className="num"><strong>{brl(Number(p.total))}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res && res.total > 0 && <Paginacao total={res.total} pagina={pagina} porPagina={porPagina} aoPagina={setPagina} aoPorPagina={setPorPagina} />}

      {aberto && (
        <Modal
          aberto
          aoFechar={() => setAberto(null)}
          titulo={`Pedido #${aberto.numero}`}
          largura={480}
          rodape={<button className="btn btn--contorno" onClick={() => imprimirPedido(aberto, r.nome)}><Printer size={17} /> Reimprimir</button>}
        >
          <div className="cfg-detalhe">
            <p className="cfg-detalhe__linha">{iconeTipo(aberto.tipo, 16)} {TIPOS[aberto.tipo]}{aberto.tipo === 'mesa' ? ` · ${aberto.mesa_nome}` : aberto.cliente_nome ? ` · ${aberto.cliente_nome}` : ''} · {new Date(aberto.criado_em).toLocaleString('pt-BR')}</p>
            <span className={cx('cfg-status', `cfg-status--${aberto.status}`)}>{STATUS_ROTULO[aberto.status]}</span>
            <ul className="cfg-detalhe__itens">
              {aberto.pedido_itens.map((i) => (
                <li key={i.id}><span>{i.qtd}× {i.nome}{i.complementos && <small>{i.complementos}</small>}{i.obs && <small>“{i.obs}”</small>}</span><span>{brl(i.qtd * Number(i.preco_unit))}</span></li>
              ))}
            </ul>
            {aberto.observacao && <p className="cfg-detalhe__obs">Obs.: {aberto.observacao}</p>}
            <div className="cfg-detalhe__totais">
              {Number(aberto.taxa_entrega) > 0 && <div><span>Entrega</span><span>{brl(Number(aberto.taxa_entrega))}</span></div>}
              {Number(aberto.desconto) > 0 && <div><span>Desconto</span><span>− {brl(Number(aberto.desconto))}</span></div>}
              <div className="total"><span>Total</span><strong>{brl(Number(aberto.total))}</strong></div>
              <div><span>Pagamento</span><span>{pagamento(aberto)}</span></div>
            </div>
          </div>
        </Modal>
      )}
    </PaginaConfig>
  );
}
