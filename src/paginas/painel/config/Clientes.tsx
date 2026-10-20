import { useEffect, useMemo, useState } from 'react';
import { Bike, Download, Gift, Mail, MessageCircle, Search, Store, UserCheck, Users, UtensilsCrossed } from 'lucide-react';
import { confirmar } from '../../../componentes/Confirmar';
import { useToast } from '../../../componentes/Toast';
import { msgErro, supabase } from '../../../lib/supabase';
import { brl, cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { mascaraTelefone } from './Estabelecimento';
import { PaginaConfig } from './Layout';
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
    <PaginaConfig titulo="Meus clientes">
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
                <tr key={c.chave}>
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
                        ? <button className="btn btn--sucesso btn--sm" onClick={() => void resgatar(c)}><Gift size={14} /> Entregar prêmio</button>
                        : <span className="cfg-fid"><i style={{ width: `${(c.fidelidade / fid.meta) * 100}%` }} /><small>{c.fidelidade}/{fid.meta}</small></span>}
                    </td>
                  )}
                  <td className="acao">
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
    </PaginaConfig>
  );
}
