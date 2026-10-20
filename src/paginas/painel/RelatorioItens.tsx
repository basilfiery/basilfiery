import { useEffect, useMemo, useState } from 'react';
import { Download, Search, Tag } from 'lucide-react';
import { msgErro, supabase } from '../../lib/supabase';
import { brl, cx } from '../../lib/util';

/* =====================================================================
   Relatório de itens (como o "Itens" do Anota AI, com dinheiro):
   quantidade vendida, faturamento pelo preço cobrado de verdade (promoção
   entra com o valor da promoção) e lucro estimado pelo custo da época.
   ===================================================================== */

interface Linha { nome: string; dia: number; qtd: number; faturamento: number; preco_min: number; preco_max: number; custo: number | null; qtd_sem_custo: number | null }
interface Resposta { ve_lucro: boolean; linhas: Linha[] }
interface Item { nome: string; qtd: number; fat: number; pmin: number; pmax: number; custo: number; semCusto: number }

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const num = (n: number) => n.toFixed(2).replace('.', ',');
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function RelatorioItens({ restauranteId, inicio, fim, tz, versao, rotuloPeriodo, aoErro }: {
  restauranteId: string; inicio: Date; fim: Date; tz: string; versao: number; rotuloPeriodo: string; aoErro: (m: string) => void;
}) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [dia, setDia] = useState<number | 'geral'>('geral');
  const [mostrar, setMostrar] = useState<'quantidade' | 'porcentagem'>('quantidade');
  const [busca, setBusca] = useState('');

  useEffect(() => {
    let vivo = true;
    void supabase.rpc('relatorio_itens', { p_rest: restauranteId, p_inicio: inicio.toISOString(), p_fim: fim.toISOString(), p_tz: tz })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { aoErro(msgErro(error)); setDados({ ve_lucro: false, linhas: [] }); return; }
        setDados(data as Resposta);
      });
    return () => { vivo = false; };
  }, [restauranteId, inicio, fim, tz, versao, aoErro]);

  const itens = useMemo(() => {
    const mapa = new Map<string, Item>();
    for (const l of dados?.linhas ?? []) {
      if (dia !== 'geral' && l.dia !== dia) continue;
      const it = mapa.get(l.nome) ?? { nome: l.nome, qtd: 0, fat: 0, pmin: Infinity, pmax: 0, custo: 0, semCusto: 0 };
      it.qtd += Number(l.qtd);
      it.fat += Number(l.faturamento);
      it.pmin = Math.min(it.pmin, Number(l.preco_min));
      it.pmax = Math.max(it.pmax, Number(l.preco_max));
      it.custo += Number(l.custo ?? 0);
      it.semCusto += Number(l.qtd_sem_custo ?? 0);
      mapa.set(l.nome, it);
    }
    return [...mapa.values()].sort((a, b) => b.qtd - a.qtd || b.fat - a.fat);
  }, [dados, dia]);

  const veLucro = !!dados?.ve_lucro;
  const totalQtd = itens.reduce((s, i) => s + i.qtd, 0);
  const totalFat = itens.reduce((s, i) => s + i.fat, 0);
  const comCusto = itens.filter((i) => i.semCusto < i.qtd);
  const totalLucro = comCusto.reduce((s, i) => s + (i.fat - i.custo), 0);
  const t = busca.trim().toLowerCase();
  const visiveis = t ? itens.filter((i) => i.nome.toLowerCase().includes(t)) : itens;
  const maxQtd = Math.max(1, ...itens.map((i) => i.qtd));
  const qtdPorDia = (d: number) => (dados?.linhas ?? []).filter((l) => l.dia === d).reduce((s, l) => s + Number(l.qtd), 0);

  function exportar() {
    const cab = ['Item', 'Quantidade', '% das vendas', 'Faturamento', 'Preço médio', 'Menor preço', 'Maior preço', ...(veLucro ? ['Custo', 'Lucro estimado', 'Margem'] : [])];
    const linhas = visiveis.map((i) => {
      const lucro = i.fat - i.custo;
      const base = [i.nome, String(i.qtd), pct((i.qtd / Math.max(1, totalQtd)) * 100), num(i.fat), num(i.fat / Math.max(1, i.qtd)), num(i.pmin), num(i.pmax)];
      return veLucro ? [...base, i.semCusto >= i.qtd ? '' : num(i.custo), i.semCusto >= i.qtd ? '' : num(lucro), i.semCusto >= i.qtd || !i.fat ? '' : pct((lucro / i.fat) * 100)] : base;
    });
    const csv = '﻿' + [cab, ...linhas].map((l) => l.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `itens-vendidos-${dia === 'geral' ? 'geral' : DIAS[dia].toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="card rl-card ri">
      <header className="rl-card__cab ri__cab">
        <div>
          <h2>Relatório de itens</h2>
          <small>{rotuloPeriodo} · faturamento pelo preço cobrado (promoções inclusas){veLucro ? ' · lucro pelo custo de cada venda' : ''}</small>
        </div>
        <div className="ri__controles">
          <div className="rl-seg" role="tablist" aria-label="Mostrar vendas por">
            <button role="tab" aria-selected={mostrar === 'quantidade'} className={cx(mostrar === 'quantidade' && 'ativo')} onClick={() => setMostrar('quantidade')}>Quantidade</button>
            <button role="tab" aria-selected={mostrar === 'porcentagem'} className={cx(mostrar === 'porcentagem' && 'ativo')} onClick={() => setMostrar('porcentagem')}>Porcentagem</button>
          </div>
          <button className="btn btn--contorno btn--sm" onClick={exportar} disabled={!visiveis.length}><Download size={15} /> Exportar</button>
        </div>
      </header>

      <div className="ri__dias" role="tablist" aria-label="Dia da semana">
        <button role="tab" aria-selected={dia === 'geral'} className={cx(dia === 'geral' && 'ativo')} onClick={() => setDia('geral')}>Geral</button>
        {DIAS.map((d, i) => (
          <button key={d} role="tab" aria-selected={dia === i} className={cx(dia === i && 'ativo')} onClick={() => setDia(i)} disabled={!!dados && qtdPorDia(i) === 0} title={dados && !qtdPorDia(i) ? 'Sem vendas neste dia da semana' : undefined}>{d}</button>
        ))}
      </div>

      <div className="ri__resumo">
        <div><small>Itens vendidos</small><strong>{totalQtd.toLocaleString('pt-BR')}</strong></div>
        <div><small>Faturamento dos itens</small><strong>{brl(totalFat)}</strong></div>
        {veLucro && <div><small>Lucro estimado</small><strong className={cx(totalLucro < 0 && 'texto-perigo')}>{comCusto.length ? brl(totalLucro) : '—'}</strong></div>}
        <label className="ri__busca"><Search size={15} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item" aria-label="Buscar item" /></label>
      </div>

      {!dados ? <div className="spinner" style={{ margin: '30px auto' }} /> : !visiveis.length ? (
        <p className="muted vazio-mini">{itens.length ? 'Nenhum item com esse nome.' : 'Nenhum item vendido no período.'}</p>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela rl-tabela ri__tabela">
            <thead>
              <tr>
                <th>Item</th><th>Vendas</th><th className="num">Faturamento</th><th className="num">Preço médio</th>
                {veLucro && <><th className="num">Lucro estimado</th><th className="num">Margem</th></>}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => {
                const share = (i.qtd / Math.max(1, totalQtd)) * 100;
                const lucro = i.fat - i.custo;
                const temCusto = i.semCusto < i.qtd;
                const margem = temCusto && i.fat > 0 ? lucro / i.fat : null;
                const promo = i.pmax - i.pmin >= 0.01;
                return (
                  <tr key={i.nome}>
                    <td><strong className="ri__nome">{i.nome}</strong></td>
                    <td className="ri__vendas">
                      <span className="ri__barra"><i style={{ width: `${(i.qtd / maxQtd) * 100}%` }} /></span>
                      <b>{mostrar === 'quantidade' ? `${i.qtd.toLocaleString('pt-BR')} un.` : pct(share)}</b>
                    </td>
                    <td className="num"><b>{brl(i.fat)}</b></td>
                    <td className="num">
                      {brl(i.fat / Math.max(1, i.qtd))}
                      {promo && <small className="ri__varia" title="O preço mudou no período (promoção ou ajuste)"><Tag size={11} /> {brl(i.pmin)} a {brl(i.pmax)}</small>}
                    </td>
                    {veLucro && (
                      <>
                        <td className={cx('num', temCusto && lucro < 0 && 'texto-perigo')}>
                          {temCusto ? <b>{brl(lucro)}</b> : <span className="muted" title="Cadastre o custo em Estoque › Custos e lucro">sem custo</span>}
                          {temCusto && i.semCusto > 0 && <small className="ri__varia">{i.semCusto} un. sem custo</small>}
                        </td>
                        <td className="num">
                          {margem == null ? <span className="muted">—</span>
                            : <span className={cx('badge', margem < 0 ? 'badge--vermelho' : margem < 0.3 ? 'badge--amarelo' : 'badge--verde')}>{Math.round(margem * 100)}%</span>}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
