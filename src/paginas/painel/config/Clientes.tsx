import { useEffect, useMemo, useState } from 'react';
import { Download, MessageCircle, Search, Users } from 'lucide-react';
import { useToast } from '../../../componentes/Toast';
import { msgErro, supabase } from '../../../lib/supabase';
import { brl, cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { mascaraTelefone } from './Estabelecimento';
import { PaginaConfig } from './Layout';
import { Paginacao } from './HistoricoPedidos';

interface Cliente { telefone: string; nome: string | null; pedidos: number; total: number; primeiro: string; ultimo: string; bairro: string | null }
type Ordem = 'ultimo' | 'pedidos' | 'total' | 'nome';

const data = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
const whatsapp = (tel: string) => `https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`;

export default function Clientes() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [lista, setLista] = useState<Cliente[] | null>(null);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<Ordem>('ultimo');
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);

  useEffect(() => {
    void supabase.rpc('clientes_listar', { p_rest: r.id }).then(({ data: d, error }) => {
      if (error) { toast(msgErro(error), 'erro'); setLista([]); return; }
      setLista(((d ?? []) as Cliente[]).map((c) => ({ ...c, pedidos: Number(c.pedidos), total: Number(c.total) })));
    });
  }, [r.id, toast]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const d = busca.replace(/\D/g, '');
    const l = (lista ?? []).filter((c) => !t || (c.nome ?? '').toLowerCase().includes(t) || (d && c.telefone.includes(d)) || (c.bairro ?? '').toLowerCase().includes(t));
    const cmp: Record<Ordem, (a: Cliente, b: Cliente) => number> = {
      ultimo: (a, b) => b.ultimo.localeCompare(a.ultimo),
      pedidos: (a, b) => b.pedidos - a.pedidos,
      total: (a, b) => b.total - a.total,
      nome: (a, b) => (a.nome ?? '').localeCompare(b.nome ?? ''),
    };
    return [...l].sort(cmp[ordem]);
  }, [lista, busca, ordem]);
  useEffect(() => setPagina(1), [busca, ordem, porPagina]);
  const pag = filtrados.slice((pagina - 1) * porPagina, pagina * porPagina);
  const recorrentes = (lista ?? []).filter((c) => c.pedidos > 1).length;

  function exportar() {
    const linhas = [['Nome', 'WhatsApp', 'Pedidos', 'Total gasto', 'Primeiro pedido', 'Último pedido', 'Bairro'],
      ...filtrados.map((c) => [c.nome ?? '', c.telefone, String(c.pedidos), c.total.toFixed(2).replace('.', ','), data(c.primeiro), data(c.ultimo), c.bairro ?? ''])];
    const csv = '﻿' + linhas.map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `clientes-${r.codigo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <PaginaConfig titulo="Meus clientes">
      <div className="cfg-kpis">
        <div><small>Clientes</small><strong>{lista?.length ?? '—'}</strong></div>
        <div><small>Voltaram a pedir</small><strong>{lista ? recorrentes : '—'}</strong></div>
        <div><small>Total gasto por eles</small><strong>{lista ? brl(lista.reduce((s, c) => s + c.total, 0)) : '—'}</strong></div>
      </div>

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
          <p>{lista.length ? 'Tente buscar de outro jeito.' : 'Quem pedir pelo cardápio digital (ou informar o WhatsApp no PDV) aparece aqui.'}</p>
        </div>
      ) : (
        <div className="cfg-tabela">
          <table>
            <thead><tr><th>Cliente</th><th>WhatsApp</th><th className="num">Pedidos</th><th className="num">Total gasto</th><th>Último pedido</th><th>Bairro</th><th aria-label="Ações" /></tr></thead>
            <tbody>
              {pag.map((c) => (
                <tr key={c.telefone}>
                  <td data-rotulo="Cliente"><strong>{c.nome ?? 'Sem nome'}</strong>{c.pedidos > 1 && <span className="cfg-selo">Recorrente</span>}</td>
                  <td data-rotulo="WhatsApp">{mascaraTelefone(c.telefone)}</td>
                  <td data-rotulo="Pedidos" className="num">{c.pedidos}</td>
                  <td data-rotulo="Total gasto" className="num">{brl(c.total)}</td>
                  <td data-rotulo="Último pedido">{data(c.ultimo)}</td>
                  <td data-rotulo="Bairro" className={cx(!c.bairro && 'muted')}>{c.bairro ?? '—'}</td>
                  <td className="acao"><a className="btn btn--contorno btn--sm" href={whatsapp(c.telefone)} target="_blank" rel="noopener"><MessageCircle size={15} /> Conversar</a></td>
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
