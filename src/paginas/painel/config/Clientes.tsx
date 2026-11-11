import { useEffect, useMemo, useState } from 'react';
import { Bike, CalendarClock, ChevronRight, Download, Gift, History, Mail, MapPin, MessageCircle, Receipt, Repeat, Search, Store, Trophy, UserCheck, Users, UtensilsCrossed } from 'lucide-react';
import { Modal } from '../../../componentes/Modal';
import { confirmar } from '../../../componentes/Confirmar';
import { useToast } from '../../../componentes/Toast';
import { msgErro, supabase } from '../../../lib/supabase';
import { STATUS_ROTULO, brl, cx, hora } from '../../../lib/util';
import type { EnderecoEntrega, StatusPedido } from '../../../lib/tipos';
import { usePainel } from '../Painel';
import { mascaraTelefone } from './Estabelecimento';
import { Paginacao } from './HistoricoPedidos';

type Origem = 'delivery' | 'mesa' | 'balcao';
interface Cliente {
  chave: string; telefone: string | null; nome: string | null; email: string | null; pedidos: number; visitas_mesa: number; total: number;
  primeiro: string | null; ultimo: string | null; bairro: string | null; fidelidade: number; origens: Origem[]; conta: boolean;
}
type Ordem = 'ultimo' | 'pedidos' | 'total' | 'nome';
type Aba = 'todos' | Origem;

/** De onde o cliente veio */
const ORIGENS: { id: Origem; rotulo: string; curto: string; icone: typeof Bike; dica: string }[] = [
  { id: 'delivery', rotulo: 'Delivery', curto: 'Delivery', icone: Bike, dica: 'Pediram ou criaram conta no cardápio digital' },
  { id: 'mesa', rotulo: 'Mesas', curto: 'Mesa', icone: UtensilsCrossed, dica: 'Pediram acesso na mesa e deixaram o nome ou o WhatsApp' },
  { id: 'balcao', rotulo: 'Balcão', curto: 'Balcão', icone: Store, dica: 'Informaram o WhatsApp no PDV' },
];

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
const whatsapp = (tel: string) => `https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`;

export default function Clientes() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const fid = r.fidelidade?.ativo ? { meta: Number(r.fidelidade.meta ?? 10), premio: r.fidelidade.premio ?? 'prêmio' } : null;
  const [recarga, setRecarga] = useState(0);
  async function resgatar(c: Cliente) {
    if (!fid || !c.telefone || !(await confirmar(`Entregar "${fid.premio}" para ${c.nome ?? 'o cliente'}? O cartão dele volta a zero.`, { sim: 'Entreguei o prêmio' }))) return;
    const { error } = await supabase.rpc('fidelidade_resgatar', { p_rest: r.id, p_telefone: c.telefone });
    if (error) return toast(msgErro(error), 'erro');
    toast('Prêmio registrado. Cartão zerado.', 'ok');
    setRecarga((n) => n + 1);
  }
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('ultimo');
  const [aba, setAba] = useState<Aba>('todos');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [ficha, setFicha] = useState<Cliente | null>(null);

  useEffect(() => {
    void supabase.rpc('clientes_listar', { p_rest: r.id }).then(({ data: d, error }) => {
      if (error) { toast(msgErro(error), 'erro'); setLista([]); return; }
      setLista(((d ?? []) as Cliente[]).map((c) => ({
        ...c, pedidos: Number(c.pedidos), visitas_mesa: Number(c.visitas_mesa ?? 0), total: Number(c.total), fidelidade: Number(c.fidelidade ?? 0), origens: c.origens ?? [],
      })));
    });
  }, [r.id, toast, recarga]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = busca.replace(/\D/g, '');
    const l = (lista ?? [])
      .filter((c) => aba === 'todos' || c.origens.includes(aba))
      .filter((c) => !t || (c.nome ?? '').toLowerCase().includes(t) || (c.email ?? '').toLowerCase().includes(t)
        || (d && (c.telefone ?? '').includes(d)) || (c.bairro ?? '').toLowerCase().includes(t));
    const cmp: Record<Ordem, (a: Cliente, b: Cliente) => number> = {
      ultimo: (a, b) => (b.ultimo ?? '').localeCompare(a.ultimo ?? ''),
      pedidos: (a, b) => b.pedidos - a.pedidos,
      total: (a, b) => b.total - a.total,
      nome: (a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''),
    };
    return [...l].sort(cmp[ordem]);
  }, [lista, busca, ordem, aba]);
  useEffect(() => setPagina(1), [busca, ordem, porPagina, aba]);
  const qtd = (o: Origem) => (lista ?? []).filter((c) => c.origens.includes(o)).length;
  const comConta = (lista ?? []).filter((c) => c.conta).length;
  const pag = filtrados.slice((pagina - 1) * porPagina, pagina * porPagina);
  const recorrentes = (lista ?? []).filter((c) => c.pedidos > 1).length;

  function exportar() {
    const linhas = [['Nome', 'WhatsApp', 'E-mail', 'Origem', 'Pedidos', 'Visitas na mesa', 'Total gasto', 'Primeiro contato', 'Último contato', 'Bairro'],
      ...filtrados.map((c) => [c.nome ?? '', c.telefone ?? '', c.email ?? '', c.origens.map((o) => ORIGENS.find((x) => x.id === o)?.curto ?? o).join(', '),
        String(c.pedidos), String(c.visitas_mesa), c.total.toFixed(2).replace('.', ','), data(c.primeiro), data(c.ultimo), c.bairro ?? ''])];
    const csv = '﻿' + linhas.map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `clientes-${r.codigo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="pagina cli-pagina">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Clientes</h1>
          <p>Todo mundo que já pediu: pelo cardápio digital, na mesa ou no balcão. Toque em um cliente para ver quantas vezes pediu e o que ele mais pede.</p>
        </div>
      </div>
      <section className="card cli-cartao">
      <div className="cfg-kpis cfg-kpis--4">
        <div><small>Clientes</small><strong>{lista?.length ?? '—'}</strong></div>
        <div><small>Com conta no cardápio</small><strong>{lista ? comConta : '—'}</strong></div>
        <div><small>Voltaram a pedir</small><strong>{lista ? recorrentes : '—'}</strong></div>
        <div><small>Total gasto por eles</small><strong>{lista ? brl(lista.reduce((s, c) => s + c.total, 0)) : '—'}</strong></div>
      </div>

      <div className="cli-abas" role="tablist" aria-label="De onde o cliente veio">
        <button role="tab" aria-selected={aba === 'todos'} className={cx(aba === 'todos' && 'ativo')} onClick={() => setAba('todos')}>
          <Users size={16} /> Todos <b>{lista?.length ?? 0}</b>
        </button>
        {ORIGENS.map((o) => (
          <button key={o.id} role="tab" aria-selected={aba === o.id} title={o.dica} className={cx(aba === o.id && 'ativo')} onClick={() => setAba(o.id)}>
            <o.icone size={16} /> {o.rotulo} <b>{qtd(o.id)}</b>
          </button>
        ))}
      </div>
      {aba !== 'todos' && <p className="cli-dica">{ORIGENS.find((o) => o.id === aba)?.dica}.</p>}

      <div className="cfg-tabela__barra">
        <label className="cfg-busca"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, WhatsApp ou bairro" /></label>
        <select className="select" value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar">
          <option value="ultimo">Pediu por último</option>
          <option value="pedidos">Mais pedidos</option>
          <option value="total">Mais gastou</option>
          <option value="nome">Nome (A-Z)</option>
        </select>
        <button className="btn btn--contorno" onClick={exportar} disabled={!filtrados.length}><Download size={16} /> <span>Exportar</span></button>
      </div>

      {!lista ? <div className="spinner" style={{ margin: '40px auto' }} /> : filtrados.length === 0 ? (
        <div className="cfg-vazio-grande">
          <Users size={40} strokeWidth={1.4} />
          <strong>{lista.length ? 'Nenhum cliente encontrado' : 'Você ainda não possui clientes'}</strong>
          <p>{lista.length ? 'Tente buscar de outro jeito ou troque a aba.' : 'Quem entrar no cardápio digital, pedir acesso na mesa ou informar o WhatsApp no PDV aparece aqui.'}</p>
        </div>
      ) : (
        <div className="cfg-tabela">
          <table>
            <thead><tr><th>Cliente</th><th>WhatsApp</th><th>Origem</th><th className="num">Pedidos</th><th className="num">Total gasto</th><th>Último contato</th><th>Bairro</th>{fid && <th>Fidelidade</th>}<th aria-label="Ações" /></tr></thead>
            <tbody>
              {pag.map((c) => (
                <tr key={c.chave} className="linha-clicavel" onClick={() => setFicha(c)} title="Ver a ficha do cliente">
                  <td data-rotulo="Cliente">
                    <span className="cli-nome">
                      <strong>{c.nome ?? 'Sem nome'}</strong>
                      {c.pedidos > 1 && <span className="cfg-selo">Recorrente</span>}
                      {c.conta && <span className="cli-conta" title="Tem conta no cardápio digital"><UserCheck size={13} /> Conta</span>}
                    </span>
                    {c.email && <small className="cli-email"><Mail size={12} /> {c.email}</small>}
                  </td>
                  <td data-rotulo="WhatsApp" className={cx(!c.telefone && 'muted')}>{c.telefone ? mascaraTelefone(c.telefone) : '—'}</td>
                  <td data-rotulo="Origem">
                    <span className="cli-origens">
                      {c.origens.map((o) => {
                        const x = ORIGENS.find((y) => y.id === o);
                        return x ? <span key={o} className={`cli-origem cli-origem--${o}`}><x.icone size={12} /> {x.curto}</span> : null;
                      })}
                    </span>
                  </td>
                  <td data-rotulo="Pedidos" className="num">
                    {c.pedidos}
                    {c.visitas_mesa > 0 && <small className="cli-visitas">{c.visitas_mesa} {c.visitas_mesa === 1 ? 'visita' : 'visitas'} na mesa</small>}
                  </td>
                  <td data-rotulo="Total gasto" className="num">{brl(c.total)}</td>
                  <td data-rotulo="Último contato">{data(c.ultimo)}</td>
                  <td data-rotulo="Bairro" className={cx(!c.bairro && 'muted')}>{c.bairro ?? '—'}</td>
                  {fid && (
                    <td data-rotulo="Fidelidade">
                      {!c.telefone ? <span className="muted">—</span> : c.fidelidade >= fid.meta
                        ? <button className="btn btn--sucesso btn--sm" onClick={(e) => { e.stopPropagation(); void resgatar(c); }}><Gift size={14} /> Entregar prêmio</button>
                        : <span className="cfg-fid"><i style={{ width: `${(c.fidelidade / fid.meta) * 100}%` }} /><small>{c.fidelidade}/{fid.meta}</small></span>}
                    </td>
                  )}
                  <td className="acao" onClick={(e) => e.stopPropagation()}>
                    {c.telefone
                      ? <a className="btn btn--contorno btn--sm" href={whatsapp(c.telefone)} target="_blank" rel="noopener"><MessageCircle size={15} /> Conversar</a>
                      : c.email ? <a className="btn btn--contorno btn--sm" href={`mailto:${c.email}`}><Mail size={15} /> E-mail</a> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lista && filtrados.length > 0 && <Paginacao total={filtrados.length} pagina={pagina} porPagina={porPagina} aoPagina={setPagina} aoPorPagina={setPorPagina} />}
      </section>
      {ficha && <FichaCliente c={ficha} restauranteId={r.id} aoFechar={() => setFicha(null)} />}
    </div>
  );
}

/* ---------------- Ficha do cliente: o que ele pede, histórico e endereços ---------------- */
interface PedidoFicha {
  id: string; numero: number; criado_em: string; tipo: 'mesa' | 'delivery' | 'retirada' | 'balcao'; status: StatusPedido; total: number;
  mesa_nome: string; forma: string | null; bairro: string | null; frete_gratis: boolean;
  itens: { nome: string; qtd: number; complementos: string | null }[] | null;
}
interface Ficha {
  pedidos: PedidoFicha[];
  produtos: { nome: string; qtd: number; vezes: number; total: number; preferido: string | null }[];
  enderecos: EnderecoEntrega[];
  visitas: { mesa: string; em: string }[];
}
const TIPO_PEDIDO: Record<PedidoFicha['tipo'], { rotulo: string; icone: typeof Bike }> = {
  delivery: { rotulo: 'Delivery', icone: Bike }, retirada: { rotulo: 'Retirada', icone: Store },
  balcao: { rotulo: 'Balcão', icone: Store }, mesa: { rotulo: 'Mesa', icone: UtensilsCrossed },
};
const dataLonga = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');

function FichaCliente({ c, restauranteId, aoFechar }: { c: Cliente; restauranteId: string; aoFechar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Ficha | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  useEffect(() => {
    void supabase.rpc('cliente_ficha', { p_rest: restauranteId, p_chave: c.chave }).then(({ data: d, error }) => {
      if (error) { toast(msgErro(error), 'erro'); return; }
      setF(d as Ficha);
    });
  }, [c.chave, restauranteId, toast]);

  const validos = (f?.pedidos ?? []).filter((p) => p.status !== 'cancelado');
  const total = validos.reduce((s, p) => s + Number(p.total), 0);
  const ticket = validos.length ? total / validos.length : 0;
  // De quantos em quantos dias ele pede (entre o primeiro e o último pedido)
  const datas = validos.map((p) => new Date(p.criado_em).getTime()).sort((a, b) => a - b);
  const intervalo = datas.length >= 2 ? Math.round((datas[datas.length - 1] - datas[0]) / 86400e3 / (datas.length - 1)) : null;
  const diasSemPedir = datas.length ? Math.floor((Date.now() - datas[datas.length - 1]) / 86400e3) : null;
  const maior = Math.max(1, ...(f?.produtos ?? []).map((x) => Number(x.qtd)));
  const pedidos = verTodos ? (f?.pedidos ?? []) : (f?.pedidos ?? []).slice(0, 8);
  const inicial = (c.nome ?? '?').trim().charAt(0).toUpperCase();

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Ficha do cliente" largura={760} classe="ficha-modal">
      <div className="ficha">
        <header className="ficha__cab">
          <span className="ficha__avatar" aria-hidden="true">{inicial}</span>
          <div className="ficha__quem">
            <strong>{c.nome ?? 'Sem nome'}</strong>
            <span>
              {c.telefone && <>{mascaraTelefone(c.telefone)}</>}
              {c.email && <><Mail size={12} /> {c.email}</>}
            </span>
            <span className="cli-origens">
              {c.origens.map((o) => {
                const x = ORIGENS.find((y) => y.id === o);
                return x ? <span key={o} className={`cli-origem cli-origem--${o}`}><x.icone size={12} /> {x.curto}</span> : null;
              })}
              {c.conta && <span className="cli-conta"><UserCheck size={13} /> Conta no cardápio</span>}
            </span>
          </div>
          {c.telefone && <a className="btn btn--whats btn--sm" href={whatsapp(c.telefone)} target="_blank" rel="noopener"><MessageCircle size={15} /> WhatsApp</a>}
        </header>

        {!f ? <div className="spinner" style={{ margin: '40px auto' }} /> : (
          <>
            <div className="ficha__kpis">
              <div><small><Receipt size={13} /> Pedidos</small><strong>{validos.length}</strong>{c.visitas_mesa > 0 && <span>+ {c.visitas_mesa} {c.visitas_mesa === 1 ? 'visita' : 'visitas'} na mesa</span>}</div>
              <div><small>Total gasto</small><strong>{brl(total)}</strong><span>ticket médio {brl(ticket)}</span></div>
              <div><small><Repeat size={13} /> Pede</small><strong>{intervalo != null ? (intervalo <= 1 ? 'Todo dia' : `A cada ${intervalo} dias`) : validos.length === 1 ? '1ª vez' : '—'}</strong><span>{diasSemPedir != null ? (diasSemPedir === 0 ? 'pediu hoje' : `último há ${diasSemPedir} ${diasSemPedir === 1 ? 'dia' : 'dias'}`) : 'ainda não pediu'}</span></div>
              <div><small><CalendarClock size={13} /> Cliente desde</small><strong>{c.primeiro ? new Date(c.primeiro).toLocaleDateString('pt-BR') : '—'}</strong><span>{c.bairro ? <><MapPin size={11} /> {c.bairro}</> : ' '}</span></div>
            </div>

            {f.produtos.length > 0 && (
              <section className="ficha__secao">
                <h3><Trophy size={16} /> O que ele mais pede</h3>
                <ol className="ficha__produtos">
                  {f.produtos.map((x, i) => (
                    <li key={x.nome}>
                      <span className="ficha__pos">{i + 1}</span>
                      <div className="ficha__prod">
                        <div><b>{x.nome}</b><span>{Number(x.qtd)}× · em {x.vezes} {Number(x.vezes) === 1 ? 'pedido' : 'pedidos'}</span></div>
                        {x.preferido && <em className="ficha__pref">Mais pede: {x.preferido.replace(/^Sabores?:s*/i, '')}</em>}
                        <i style={{ width: `${(Number(x.qtd) / maior) * 100}%` }} />
                      </div>
                      <small>{brl(Number(x.total))}</small>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="ficha__secao">
              <h3><History size={16} /> Histórico de pedidos <small>{f.pedidos.length}</small></h3>
              {f.pedidos.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>{f.visitas.length ? 'Ainda não fez pedido em nome dele: só esteve na mesa.' : 'Nenhum pedido encontrado.'}</p>
              ) : (
                <ul className="ficha__pedidos">
                  {pedidos.map((p) => {
                    const t = TIPO_PEDIDO[p.tipo] ?? TIPO_PEDIDO.mesa;
                    return (
                      <li key={p.id} className={cx(p.status === 'cancelado' && 'cancelado')}>
                        <div className="ficha__ped-topo">
                          <b>#{p.numero}</b>
                          <span className="ficha__tipo"><t.icone size={13} /> {p.tipo === 'mesa' ? p.mesa_nome : t.rotulo}</span>
                          <small>{dataLonga(p.criado_em)} · {hora(p.criado_em)}</small>
                          {p.frete_gratis && <span className="badge badge--frete"><Gift size={11} /> Frete grátis</span>}
                          <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
                          <strong>{brl(Number(p.total))}</strong>
                        </div>
                        <p>{(p.itens ?? []).map((i) => `${i.qtd}× ${i.nome}`).join(' · ') || '—'}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              {f.pedidos.length > 8 && (
                <button className="btn btn--fantasma btn--sm ficha__mais" onClick={() => setVerTodos((v) => !v)}>
                  {verTodos ? 'Mostrar menos' : `Ver todos os ${f.pedidos.length} pedidos`} <ChevronRight size={14} />
                </button>
              )}
            </section>

            {f.enderecos.length > 0 && (
              <section className="ficha__secao">
                <h3><MapPin size={16} /> Endereços de entrega</h3>
                <ul className="ficha__enderecos">
                  {f.enderecos.map((e, i) => (
                    <li key={i}><b>{e.rua}, {e.numero}{e.complemento ? ` · ${e.complemento}` : ''}</b><span>{e.bairro}{e.referencia ? ` · Ref.: ${e.referencia}` : ''}</span></li>
                  ))}
                </ul>
              </section>
            )}

            {f.visitas.length > 0 && (
              <section className="ficha__secao">
                <h3><UtensilsCrossed size={16} /> Visitas na mesa</h3>
                <p className="ficha__visitas">{f.visitas.slice(0, 12).map((v) => `${v.mesa} · ${dataLonga(v.em)}`).join('   •   ')}</p>
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
