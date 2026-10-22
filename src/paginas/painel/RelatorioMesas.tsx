import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock, DollarSign, Download, LayoutGrid, ReceiptText, Search, Ticket, Timer } from 'lucide-react';
import { GraficoColunas, type Ponto } from '../../componentes/Graficos';
import { msgErro, supabase } from '../../lib/supabase';
import { brl, cx, hora } from '../../lib/util';

/* =====================================================================
   Mesas e comandas (como no Anota AI): cada conta de mesa fechada no
   caixa é uma comanda. Mostra o desempenho de cada mesa, o tempo que os
   clientes ficam e a lista de comandas — e as que ainda estão abertas.
   ===================================================================== */

interface Comanda { id: string; mesa: string; aberta_em: string; fechada_em: string; pedidos: number; itens: number; total: number; forma: string }
interface Aberta { mesa: string; aberta_em: string; pedidos: number; itens: number; total: number }
interface PorMesa { mesa: string; comandas: number; pedidos: number; itens: number; faturamento: number; ticket_medio: number; minutos_medio: number }
interface Resposta {
  resumo: { comandas: number; faturamento: number; ticket_medio: number; pedidos: number; itens: number; minutos_medio: number; mesas_usadas: number };
  abertas_resumo: { comandas: number; total: number };
  por_mesa: PorMesa[];
  por_hora: { hora: number; comandas: number }[];
  comandas: Comanda[];
  abertas: Aberta[];
}

const FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', outro: 'Outro' };
const inteiro = (n: number) => Number(n).toLocaleString('pt-BR');
function duracao(min: number) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}min` : ''}`;
}
const minutosEntre = (a: string, b: string | number) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
const diaHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function RelatorioMesas({ restauranteId, inicio, fim, tz, versao, rotuloPeriodo, agora, aoErro }: {
  restauranteId: string; inicio: Date; fim: Date; tz: string; versao: number; rotuloPeriodo: string; agora: number; aoErro: (m: string) => void;
}) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<'faturamento' | 'comandas' | 'tempo'>('faturamento');

  useEffect(() => {
    let vivo = true;
    void supabase.rpc('relatorio_mesas', { p_rest: restauranteId, p_inicio: inicio.toISOString(), p_fim: fim.toISOString(), p_tz: tz })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { aoErro(msgErro(error)); return; }
        setDados(data as Resposta);
      });
    return () => { vivo = false; };
  }, [restauranteId, inicio, fim, tz, versao, aoErro]);

  const porMesa = useMemo(() => {
    const l = [...(dados?.por_mesa ?? [])];
    if (ordem === 'comandas') l.sort((a, b) => b.comandas - a.comandas || b.faturamento - a.faturamento);
    else if (ordem === 'tempo') l.sort((a, b) => b.minutos_medio - a.minutos_medio);
    else l.sort((a, b) => Number(b.faturamento) - Number(a.faturamento));
    return l;
  }, [dados, ordem]);

  if (!dados) return <div className="carregando"><div className="spinner" /></div>;

  const r = dados.resumo;
  const t = busca.trim().toLowerCase();
  const comandas = t ? dados.comandas.filter((c) => c.mesa.toLowerCase().includes(t)) : dados.comandas;
  const maxFat = Math.max(1, ...porMesa.map((m) => Number(m.faturamento)));

  const cartoes: { icone: ReactNode; valor: string; rotulo: string; dica: string; tom?: 'ok' }[] = [
    { icone: <ReceiptText size={17} />, valor: inteiro(r.comandas), rotulo: 'Comandas fechadas', dica: `${inteiro(r.pedidos)} pedidos · ${inteiro(r.itens)} itens` },
    { icone: <DollarSign size={17} />, valor: brl(Number(r.faturamento)), rotulo: 'Faturamento nas mesas', dica: 'Contas fechadas no caixa', tom: 'ok' },
    { icone: <Ticket size={17} />, valor: brl(Number(r.ticket_medio)), rotulo: 'Ticket médio por comanda', dica: 'Quanto cada mesa gasta, em média' },
    { icone: <Timer size={17} />, valor: r.comandas ? duracao(r.minutos_medio) : '—', rotulo: 'Tempo médio na mesa', dica: 'Do primeiro pedido até fechar a conta' },
    { icone: <LayoutGrid size={17} />, valor: inteiro(r.mesas_usadas), rotulo: 'Mesas usadas', dica: 'Mesas com pelo menos uma comanda' },
    { icone: <Clock size={17} />, valor: inteiro(dados.abertas_resumo.comandas), rotulo: 'Abertas agora', dica: `${brl(Number(dados.abertas_resumo.total))} ainda sem pagamento` },
  ];

  // Chegada das mesas por horário (primeiro pedido de cada comanda)
  const horas = dados.por_hora.map((h) => h.hora);
  const pontos: Ponto[] = [];
  if (horas.length) {
    let ini = Math.max(0, Math.min(...horas) - 1);
    let fimH = Math.min(23, Math.max(...horas) + 1);
    while (fimH - ini < 11) { if (ini > 0) ini--; if (fimH - ini < 11 && fimH < 23) fimH++; }
    const mapa = new Map(dados.por_hora.map((h) => [h.hora, h.comandas]));
    for (let h = ini; h <= fimH; h++) {
      const n = mapa.get(h) ?? 0;
      pontos.push({ chave: String(h), rotulo: `${h}h`, detalhe: `${h}h às ${h + 1}h`, valor: n, sub: `${n} ${n === 1 ? 'comanda' : 'comandas'}`, n });
    }
  }

  function exportar() {
    const cab = ['Mesa', 'Abertura', 'Fechamento', 'Tempo', 'Pedidos', 'Itens', 'Pagamento', 'Total'];
    const linhas = comandas.map((c) => [c.mesa, diaHora(c.aberta_em), diaHora(c.fechada_em), duracao(minutosEntre(c.aberta_em, c.fechada_em)),
      String(c.pedidos), String(c.itens), FORMA[c.forma] ?? c.forma, Number(c.total).toFixed(2).replace('.', ',')]);
    const csv = '﻿' + [cab, ...linhas].map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'comandas.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <section className="card rl-card">
        <header className="rl-card__cab"><div><h2>Resumo das mesas</h2><small>{rotuloPeriodo} · comandas fechadas no período</small></div></header>
        <div className="rl-painel">
          {cartoes.map((c) => (
            <div key={c.rotulo} className={cx('rl-stat', c.tom && `rl-stat--${c.tom}`)}>
              <span className="rl-stat__icone">{c.icone}</span>
              <div><strong>{c.valor}</strong><span>{c.rotulo}</span><small>{c.dica}</small></div>
            </div>
          ))}
        </div>
      </section>

      {dados.abertas.length > 0 && (
        <section className="card rl-card">
          <header className="rl-card__cab"><div><h2>Comandas abertas agora</h2><small>Mesas com pedidos ainda sem pagamento</small></div></header>
          <div className="rm-abertas">
            {dados.abertas.map((a) => (
              <div key={a.mesa + a.aberta_em} className="rm-aberta">
                <span className="rm-aberta__mesa">{a.mesa}</span>
                <strong>{brl(Number(a.total))}</strong>
                <small>{a.pedidos} {a.pedidos === 1 ? 'pedido' : 'pedidos'} · aberta às {hora(a.aberta_em)} · há {duracao(minutosEntre(a.aberta_em, agora))}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card rl-card">
        <header className="rl-card__cab">
          <div><h2>Desempenho por mesa</h2><small>{porMesa.length} {porMesa.length === 1 ? 'mesa' : 'mesas'} com comandas no período</small></div>
          <div className="rl-seg" role="tablist" aria-label="Ordenar mesas">
            <button role="tab" aria-selected={ordem === 'faturamento'} className={cx(ordem === 'faturamento' && 'ativo')} onClick={() => setOrdem('faturamento')}>Faturamento</button>
            <button role="tab" aria-selected={ordem === 'comandas'} className={cx(ordem === 'comandas' && 'ativo')} onClick={() => setOrdem('comandas')}>Comandas</button>
            <button role="tab" aria-selected={ordem === 'tempo'} className={cx(ordem === 'tempo' && 'ativo')} onClick={() => setOrdem('tempo')}>Tempo</button>
          </div>
        </header>
        {porMesa.length === 0 ? <p className="muted vazio-mini">Nenhuma conta de mesa fechada no período.</p> : (
          <div className="tabela-wrap">
            <table className="tabela rl-tabela rl-ranking">
              <thead><tr><th>#</th><th>Mesa</th><th className="num">Comandas</th><th className="num">Pedidos</th><th className="num">Ticket médio</th><th className="num">Tempo médio</th><th className="num">Faturamento</th></tr></thead>
              <tbody>
                {porMesa.map((m, i) => (
                  <tr key={m.mesa}>
                    <td className="rl-ranking__pos">{i + 1}</td>
                    <td><span className="rl-ranking__nome">{m.mesa}<i style={{ width: `${(Number(m.faturamento) / maxFat) * 100}%` }} /></span></td>
                    <td className="num">{inteiro(m.comandas)}</td>
                    <td className="num">{inteiro(m.pedidos)}</td>
                    <td className="num">{brl(Number(m.ticket_medio))}</td>
                    <td className="num">{duracao(m.minutos_medio)}</td>
                    <td className="num"><b>{brl(Number(m.faturamento))}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {pontos.length > 0 && (
        <section className="card rl-card">
          <header className="rl-card__cab"><div><h2>Horário de chegada das mesas</h2><small>Quando cada comanda começou · {rotuloPeriodo}</small></div></header>
          <GraficoColunas dados={pontos} formatar={(v) => `${inteiro(v)} ${v === 1 ? 'comanda' : 'comandas'}`} formatarEixo={(v) => (Number.isInteger(v) ? inteiro(v) : '')} rotuloAria="Comandas por horário de chegada" />
        </section>
      )}

      <section className="card rl-card">
        <header className="rl-card__cab">
          <div><h2>Comandas</h2><small>{inteiro(comandas.length)} {comandas.length === 1 ? 'comanda fechada' : 'comandas fechadas'} · a mais recente primeiro</small></div>
          <div className="rm-ferramentas">
            <label className="rm-busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar mesa" aria-label="Buscar mesa" /></label>
            <button className="btn btn--contorno btn--sm" onClick={exportar} disabled={!comandas.length}><Download size={15} /> Exportar</button>
          </div>
        </header>
        {comandas.length === 0 ? <p className="muted vazio-mini">{t ? 'Nenhuma comanda dessa mesa no período.' : 'Nenhuma comanda fechada no período.'}</p> : (
          <div className="tabela-wrap">
            <table className="tabela rl-tabela rm-comandas">
              <thead><tr><th>Mesa</th><th>Abertura</th><th>Fechamento</th><th className="num">Tempo</th><th className="num">Pedidos</th><th className="num">Itens</th><th>Pagamento</th><th className="num">Total</th></tr></thead>
              <tbody>
                {comandas.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.mesa}</b></td>
                    <td>{diaHora(c.aberta_em)}</td>
                    <td>{diaHora(c.fechada_em)}</td>
                    <td className="num">{duracao(minutosEntre(c.aberta_em, c.fechada_em))}</td>
                    <td className="num">{inteiro(c.pedidos)}</td>
                    <td className="num">{inteiro(c.itens)}</td>
                    <td><span className="rm-forma">{FORMA[c.forma] ?? c.forma}</span></td>
                    <td className="num"><b>{brl(Number(c.total))}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
