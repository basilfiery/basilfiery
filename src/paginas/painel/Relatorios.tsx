import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Download, Minus, Radio, Table2, BarChart3 } from 'lucide-react';
import { BarrasHorizontais, GraficoColunas, type Ponto } from '../../componentes/Graficos';
import { Vazio } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { msgErro, supabase } from '../../lib/supabase';
import type { StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, hora, inicioDoDia, tempoDesde, useAgora } from '../../lib/util';
import { usePainel } from './Painel';

/* ---------------- Tipos vindos do banco ---------------- */
interface Relatorio {
  resumo: { faturamento: number; pedidos: number; ticket_medio: number; itens: number; mesas_atendidas: number; recebido: number; em_aberto: number };
  cancelados: { pedidos: number; valor: number };
  por_dia: { dia: string; faturamento: number; pedidos: number }[];
  por_hora: { hora: number; faturamento: number; pedidos: number }[];
  top_produtos: { nome: string; qtd: number; faturamento: number }[];
  por_categoria: { categoria: string; qtd: number; faturamento: number }[];
  por_mesa: { mesa: string; pedidos: number; faturamento: number }[];
}
interface Mes { mes: string; faturamento: number; pedidos: number }
interface LinhaPedido {
  id: string; numero: number; mesa_nome: string; status: StatusPedido; total: number;
  criado_em: string; pago_em: string | null;
  pedido_itens: { nome: string; qtd: number; preco_unit: number; obs: string | null; complementos?: string | null }[];
}

/* ---------------- Datas ---------------- */
type Preset = 'hoje' | 'ontem' | '7d' | '30d' | 'mes' | 'mes_passado' | 'ano' | 'personalizado';
const PRESETS: { id: Preset; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'ontem', rotulo: 'Ontem' },
  { id: '7d', rotulo: '7 dias' },
  { id: '30d', rotulo: '30 dias' },
  { id: 'mes', rotulo: 'Este mês' },
  { id: 'mes_passado', rotulo: 'Mês passado' },
  { id: 'ano', rotulo: 'Este ano' },
];
const DIA = 86400000;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const lerData = (s: string) => { const [a, m, d] = s.split('-').map(Number); return new Date(a, m - 1, d); };
const dataCurta = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const dataLonga = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

interface Periodo { inicio: Date; fim: Date } // fim exclusivo

function periodoDe(preset: Preset, de: string, ate: string): Periodo {
  const hoje = new Date(inicioDoDia());
  switch (preset) {
    case 'hoje': return { inicio: hoje, fim: somarDias(hoje, 1) };
    case 'ontem': return { inicio: somarDias(hoje, -1), fim: hoje };
    case '7d': return { inicio: somarDias(hoje, -6), fim: somarDias(hoje, 1) };
    case '30d': return { inicio: somarDias(hoje, -29), fim: somarDias(hoje, 1) };
    case 'mes': return { inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim: new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1) };
    case 'mes_passado': return { inicio: new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), fim: new Date(hoje.getFullYear(), hoje.getMonth(), 1) };
    case 'ano': return { inicio: new Date(hoje.getFullYear(), 0, 1), fim: new Date(hoje.getFullYear() + 1, 0, 1) };
    default: {
      const a = lerData(de);
      const b = lerData(ate);
      return a <= b ? { inicio: a, fim: somarDias(b, 1) } : { inicio: b, fim: somarDias(a, 1) };
    }
  }
}

/** Período de comparação: mês anterior, ano anterior, ou janela do mesmo tamanho logo antes. */
function periodoAnterior(preset: Preset, p: Periodo): { periodo: Periodo; rotulo: string } {
  const { inicio } = p;
  if (preset === 'mes' || preset === 'mes_passado') {
    return { periodo: { inicio: new Date(inicio.getFullYear(), inicio.getMonth() - 1, 1), fim: inicio }, rotulo: 'mês anterior' };
  }
  if (preset === 'ano') {
    return { periodo: { inicio: new Date(inicio.getFullYear() - 1, 0, 1), fim: inicio }, rotulo: 'ano anterior' };
  }
  const dias = Math.round((p.fim.getTime() - inicio.getTime()) / DIA);
  return {
    periodo: { inicio: somarDias(inicio, -dias), fim: inicio },
    rotulo: dias === 1 ? (preset === 'hoje' ? 'ontem' : 'dia anterior') : `${dias} dias anteriores`,
  };
}

/* ---------------- Formatação ---------------- */
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const eixoReais = (v: number) => (v === 0 ? 'R$ 0' : `R$ ${v >= 1000 ? compacto.format(v) : v.toLocaleString('pt-BR')}`);
const inteiro = (n: number) => Number(n).toLocaleString('pt-BR');

/* ======================================================================= */

export default function Relatorios() {
  const { restaurante, pedidos: aoVivo } = usePainel();
  const toast = useToast();
  const agora = useAgora(30000);

  const [preset, setPreset] = useState<Preset>('mes');
  const [de, setDe] = useState(iso(somarDias(new Date(), -6)));
  const [ate, setAte] = useState(iso(new Date()));
  const periodo = useMemo(() => periodoDe(preset, de, ate), [preset, de, ate]);
  const comparacao = useMemo(() => periodoAnterior(preset, periodo), [preset, periodo]);

  const [rel, setRel] = useState<Relatorio | null>(null);
  const [relAnt, setRelAnt] = useState<Relatorio | null>(null);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [atualizadoEm, setAtualizadoEm] = useState<number | null>(null);

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    const args = (p: Periodo) => ({ p_rest: restaurante.id, p_inicio: p.inicio.toISOString(), p_fim: p.fim.toISOString(), p_tz: TZ });
    const [a, b, m] = await Promise.all([
      supabase.rpc('relatorio_vendas', args(periodo)),
      supabase.rpc('relatorio_vendas', args(comparacao.periodo)),
      supabase.rpc('relatorio_meses', { p_rest: restaurante.id, p_meses: 12, p_tz: TZ }),
    ]);
    setCarregando(false);
    if (a.error) {
      setErro(msgErro(a.error));
      return;
    }
    setErro('');
    setRel(a.data as Relatorio);
    setRelAnt(b.error ? null : (b.data as Relatorio));
    if (!m.error) setMeses(m.data as Mes[]);
    setAtualizadoEm(Date.now());
  }, [restaurante.id, periodo, comparacao]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Tempo real: qualquer pedido novo ou mudança de status atualiza o relatório
  // (quando o período escolhido inclui o momento atual).
  const assinatura = useMemo(() => aoVivo.map((p) => `${p.id}:${p.status}:${p.pago_em ?? ''}`).join('|'), [aoVivo]);
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; return; }
    if (periodo.fim.getTime() < Date.now()) return;
    const t = setTimeout(() => void carregar(true), 1200);
    return () => clearTimeout(t);
  }, [assinatura]); // eslint-disable-line react-hooks/exhaustive-deps

  function escolherMes(chave: string) {
    const [a, m] = chave.split('-').map(Number);
    setDe(iso(new Date(a, m - 1, 1)));
    setAte(iso(new Date(a, m, 0)));
    setPreset('personalizado');
  }

  const dias = Math.round((periodo.fim.getTime() - periodo.inicio.getTime()) / DIA);
  const rotuloPeriodo = dias === 1 ? dataLonga(periodo.inicio) : `${dataCurta(periodo.inicio)} a ${dataCurta(somarDias(periodo.fim, -1))}`;

  return (
    <div className="pagina relatorios">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Relatórios</h1>
          <p>Vendas são os pedidos não cancelados. Tudo se atualiza sozinho quando entra um pedido.</p>
        </div>
      </div>

      <AoVivoHoje pedidos={aoVivo} agora={agora} />

      <section className="card">
        <div className="card__cab">
          <h2 className="card__titulo">Vendas por mês <small>últimos 12 meses</small></h2>
        </div>
        <GraficoMensal meses={meses} aoEscolher={escolherMes} />
      </section>

      {/* Filtro: escopo de tudo que vem abaixo */}
      <div className="filtros" role="group" aria-label="Período do relatório">
        <div className="filtros__presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={cx('filtro', preset === p.id && 'ativo')} onClick={() => setPreset(p.id)}>{p.rotulo}</button>
          ))}
          <button className={cx('filtro', preset === 'personalizado' && 'ativo')} onClick={() => setPreset('personalizado')}>Personalizado</button>
        </div>
        {preset === 'personalizado' && (
          <div className="filtros__datas">
            <label>De <input className="input" type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} /></label>
            <label>Até <input className="input" type="date" value={ate} min={de} onChange={(e) => e.target.value && setAte(e.target.value)} /></label>
            <label>Mês <input className="input" type="month" value={de.slice(0, 7)} onChange={(e) => e.target.value && escolherMes(e.target.value)} /></label>
          </div>
        )}
        <span className="filtros__info">
          <b>{rotuloPeriodo}</b>
          {atualizadoEm && <> · atualizado {hora(new Date(atualizadoEm).toISOString())}</>}
        </span>
      </div>

      {erro ? (
        <p className="erro-form">{erro}</p>
      ) : !rel ? (
        <div className="carregando"><div className="spinner" /></div>
      ) : (
        <div className={cx('relatorio', carregando && 'recarregando')}>
          <Resumo rel={rel} ant={relAnt} rotuloComparacao={comparacao.rotulo} />

          <section className="card">
            <h2 className="card__titulo">
              {dias === 1 ? 'Vendas por hora' : dias > 62 ? 'Vendas por mês no período' : 'Vendas por dia'}
            </h2>
            <GraficoPeriodo rel={rel} periodo={periodo} dias={dias} />
          </section>

          <div className="relatorio__duplo">
            <section className="card">
              <h2 className="card__titulo">Produtos mais vendidos</h2>
              {rel.top_produtos.length ? (
                <BarrasHorizontais
                  formatar={brl}
                  itens={rel.top_produtos.map((p) => ({ chave: p.nome, rotulo: p.nome, valor: p.faturamento, sub: `${inteiro(p.qtd)} un.` }))}
                />
              ) : <p className="muted vazio-mini">Nenhuma venda no período.</p>}
            </section>

            <section className="card">
              <h2 className="card__titulo">Por categoria</h2>
              {rel.por_categoria.length ? (
                <BarrasHorizontais
                  formatar={brl}
                  itens={rel.por_categoria.map((c) => ({ chave: c.categoria, rotulo: c.categoria, valor: c.faturamento, sub: `${inteiro(c.qtd)} itens` }))}
                />
              ) : <p className="muted vazio-mini">Nenhuma venda no período.</p>}
            </section>
          </div>

          <div className="relatorio__duplo">
            {dias > 1 && (
              <section className="card">
                <h2 className="card__titulo">Horários de pico</h2>
                <GraficoHoras porHora={rel.por_hora} />
              </section>
            )}
            <section className="card">
              <h2 className="card__titulo">Mesas que mais venderam</h2>
              {rel.por_mesa.length ? (
                <BarrasHorizontais
                  formatar={brl}
                  itens={rel.por_mesa.map((m) => ({ chave: m.mesa, rotulo: m.mesa, valor: m.faturamento, sub: `${inteiro(m.pedidos)} pedidos` }))}
                />
              ) : <p className="muted vazio-mini">Nenhuma venda no período.</p>}
            </section>
          </div>

          <ListaPedidos restauranteId={restaurante.id} restauranteNome={restaurante.nome} periodo={periodo} versao={atualizadoEm ?? 0} aoErro={(m) => toast(m, 'erro')} />
        </div>
      )}
    </div>
  );
}

/* ---------------- Ao vivo: o que está entrando hoje ---------------- */
function AoVivoHoje({ pedidos, agora }: { pedidos: ReturnType<typeof usePainel>['pedidos']; agora: number }) {
  const hoje = inicioDoDia();
  const deHoje = pedidos.filter((p) => new Date(p.criado_em).getTime() >= hoje && p.status !== 'cancelado');
  const total = deHoje.reduce((s, p) => s + Number(p.total), 0);
  const ultimos = deHoje.slice().sort((a, b) => b.criado_em.localeCompare(a.criado_em)).slice(0, 5);

  return (
    <section className="card ao-vivo-card">
      <div className="ao-vivo-card__numeros">
        <span className="ao-vivo-card__selo"><Radio size={14} /> Ao vivo · hoje</span>
        <strong className="ao-vivo-card__valor">{brl(total)}</strong>
        <span className="muted">
          {deHoje.length} {deHoje.length === 1 ? 'pedido' : 'pedidos'}
          {deHoje.length > 0 && <> · ticket médio {brl(total / deHoje.length)}</>}
        </span>
      </div>
      <div className="ao-vivo-card__feed">
        <span className="ao-vivo-card__rotulo">Últimos pedidos</span>
        {ultimos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum pedido hoje ainda. Assim que entrar, aparece aqui.</p>
        ) : (
          <ul>
            {ultimos.map((p) => (
              <li key={p.id} className={cx(agora - new Date(p.criado_em).getTime() < 90000 && 'recente')}>
                <span className="muted">{hora(p.criado_em)}</span>
                <span>#{p.numero} · {p.mesa_nome}</span>
                <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
                <strong>{brl(p.total)}</strong>
              </li>
            ))}
          </ul>
        )}
        {ultimos[0] && <small className="muted">Última venda {tempoDesde(ultimos[0].criado_em, agora) === 'agora' ? 'agora mesmo' : `há ${tempoDesde(ultimos[0].criado_em, agora)}`}</small>}
      </div>
    </section>
  );
}

/* ---------------- Resumo com comparação ---------------- */
function Resumo({ rel, ant, rotuloComparacao }: { rel: Relatorio; ant: Relatorio | null; rotuloComparacao: string }) {
  const r = rel.resumo;
  const a = ant?.resumo;
  return (
    <div className="resumo">
      <div className="resumo__hero card">
        <span className="resumo__rotulo">Faturamento</span>
        <strong className="resumo__hero-valor">{brl(r.faturamento)}</strong>
        <Delta atual={r.faturamento} anterior={a?.faturamento} rotulo={rotuloComparacao} />
        <div className="resumo__caixa">
          <span><i className="ponto ponto--ok" /> Recebido (contas fechadas) <b>{brl(r.recebido)}</b></span>
          <span><i className="ponto ponto--aberto" /> Em aberto nas mesas <b>{brl(r.em_aberto)}</b></span>
        </div>
      </div>
      <Tile rotulo="Pedidos" valor={inteiro(r.pedidos)} atual={r.pedidos} anterior={a?.pedidos} comparacao={rotuloComparacao} />
      <Tile rotulo="Ticket médio" valor={brl(r.ticket_medio)} atual={r.ticket_medio} anterior={a?.ticket_medio} comparacao={rotuloComparacao} />
      <Tile rotulo="Itens vendidos" valor={inteiro(r.itens)} atual={r.itens} anterior={a?.itens} comparacao={rotuloComparacao} />
      <div className="card tile">
        <span className="resumo__rotulo">Cancelados</span>
        <strong className="tile__valor">{inteiro(rel.cancelados.pedidos)}</strong>
        <span className="muted tile__sub">{brl(rel.cancelados.valor)} não faturados</span>
      </div>
    </div>
  );
}

function Tile({ rotulo, valor, atual, anterior, comparacao }: { rotulo: string; valor: string; atual: number; anterior?: number; comparacao: string }) {
  return (
    <div className="card tile">
      <span className="resumo__rotulo">{rotulo}</span>
      <strong className="tile__valor">{valor}</strong>
      <Delta atual={atual} anterior={anterior} rotulo={comparacao} />
    </div>
  );
}

function Delta({ atual, anterior, rotulo }: { atual: number; anterior?: number; rotulo: string }) {
  if (anterior === undefined) return null;
  if (anterior === 0) {
    return <span className="delta delta--neutro"><Minus size={14} /> {atual > 0 ? `sem vendas no ${rotulo}` : `igual ao ${rotulo}`}</span>;
  }
  const v = (atual - anterior) / anterior;
  const pctTxt = `${v > 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (Math.abs(v) < 0.005) return <span className="delta delta--neutro"><Minus size={14} /> igual ao {rotulo}</span>;
  return (
    <span className={cx('delta', v > 0 ? 'delta--sobe' : 'delta--desce')}>
      {v > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {pctTxt} <span className="muted">vs. {rotulo}</span>
    </span>
  );
}

/* ---------------- Gráficos ---------------- */
function AlternarTabela({ tabela, aoMudar }: { tabela: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <button className="btn btn--fantasma btn--sm alternar-tabela" onClick={() => aoMudar(!tabela)}>
      {tabela ? <><BarChart3 size={16} /> Ver gráfico</> : <><Table2 size={16} /> Ver tabela</>}
    </button>
  );
}

function TabelaPontos({ pontos, coluna }: { pontos: Ponto[]; coluna: string }) {
  return (
    <div className="tabela-wrap tabela-compacta">
      <table className="tabela">
        <thead><tr><th>{coluna}</th><th className="num">Pedidos</th><th className="num">Faturamento</th></tr></thead>
        <tbody>
          {pontos.map((p) => (
            <tr key={p.chave}><td>{p.detalhe}</td><td className="num">{p.n ?? 0}</td><td className="num">{brl(p.valor)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const subPedidos = (n: number) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`;

function GraficoMensal({ meses, aoEscolher }: { meses: Mes[]; aoEscolher: (mes: string) => void }) {
  const [tabela, setTabela] = useState(false);
  const pontos: Ponto[] = meses.map((m) => {
    const [a, mm] = m.mes.split('-').map(Number);
    return {
      chave: m.mes,
      rotulo: `${MESES[mm - 1]}/${String(a).slice(2)}`,
      detalhe: new Date(a, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
      valor: Number(m.faturamento),
      sub: subPedidos(m.pedidos), n: m.pedidos,
    };
  });
  const total = meses.reduce((s, m) => s + Number(m.faturamento), 0);
  if (!meses.length) return <div className="carregando" style={{ minHeight: 220 }}><div className="spinner" /></div>;
  return (
    <>
      <div className="grafico-topo">
        <span className="muted">Total em 12 meses: <b className="texto">{brl(total)}</b> · toque num mês para ver o relatório dele</span>
        <AlternarTabela tabela={tabela} aoMudar={setTabela} />
      </div>
      {tabela
        ? <TabelaPontos pontos={pontos} coluna="Mês" />
        : <GraficoColunas dados={pontos} formatar={brl} formatarEixo={eixoReais} rotuloAria="Faturamento por mês" aoClicar={(i) => aoEscolher(pontos[i].chave)} destacar={pontos.length - 1} />}
    </>
  );
}

function GraficoPeriodo({ rel, periodo, dias }: { rel: Relatorio; periodo: Periodo; dias: number }) {
  const [tabela, setTabela] = useState(false);
  let pontos: Ponto[];
  let coluna = 'Dia';

  if (dias === 1) {
    coluna = 'Hora';
    const porHora = new Map(rel.por_hora.map((h) => [h.hora, h]));
    const horas = rel.por_hora.map((h) => h.hora);
    const ini = horas.length ? Math.max(0, Math.min(...horas) - 1) : 10;
    const fim = horas.length ? Math.min(23, Math.max(...horas) + 1) : 23;
    pontos = [];
    for (let h = ini; h <= fim; h++) {
      const d = porHora.get(h);
      pontos.push({ chave: String(h), rotulo: `${h}h`, detalhe: `${h}h às ${h + 1}h`, valor: Number(d?.faturamento ?? 0), sub: subPedidos(d?.pedidos ?? 0), n: d?.pedidos ?? 0 });
    }
  } else if (dias > 62) {
    coluna = 'Mês';
    const porMes = new Map<string, { fat: number; n: number }>();
    for (const d of rel.por_dia) {
      const k = d.dia.slice(0, 7);
      const atual = porMes.get(k) ?? { fat: 0, n: 0 };
      porMes.set(k, { fat: atual.fat + Number(d.faturamento), n: atual.n + d.pedidos });
    }
    pontos = [];
    for (let m = new Date(periodo.inicio.getFullYear(), periodo.inicio.getMonth(), 1); m < periodo.fim; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
      const k = iso(m).slice(0, 7);
      const v = porMes.get(k);
      pontos.push({ chave: k, rotulo: `${MESES[m.getMonth()]}/${String(m.getFullYear()).slice(2)}`, detalhe: m.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), valor: v?.fat ?? 0, sub: subPedidos(v?.n ?? 0), n: v?.n ?? 0 });
    }
  } else {
    const porDia = new Map(rel.por_dia.map((d) => [d.dia, d]));
    pontos = [];
    for (let d = periodo.inicio; d < periodo.fim; d = somarDias(d, 1)) {
      const v = porDia.get(iso(d));
      pontos.push({ chave: iso(d), rotulo: dataCurta(d), detalhe: dataLonga(d), valor: Number(v?.faturamento ?? 0), sub: subPedidos(v?.pedidos ?? 0), n: v?.pedidos ?? 0 });
    }
  }

  const hojeIdx = dias === 1 ? -1 : pontos.findIndex((p) => p.chave === iso(new Date()));
  const algumaVenda = pontos.some((p) => p.valor > 0);

  return (
    <>
      <div className="grafico-topo">
        <span />
        <AlternarTabela tabela={tabela} aoMudar={setTabela} />
      </div>
      {!algumaVenda ? (
        <Vazio icone={<BarChart3 size={32} />} titulo="Nenhuma venda neste período" />
      ) : tabela ? (
        <TabelaPontos pontos={pontos} coluna={coluna} />
      ) : (
        <GraficoColunas dados={pontos} formatar={brl} formatarEixo={eixoReais} rotuloAria={`Faturamento por ${coluna.toLowerCase()}`} destacar={hojeIdx >= 0 ? hojeIdx : undefined} />
      )}
    </>
  );
}

function GraficoHoras({ porHora }: { porHora: Relatorio['por_hora'] }) {
  if (!porHora.length) return <p className="muted vazio-mini">Nenhuma venda no período.</p>;
  const mapa = new Map(porHora.map((h) => [h.hora, h]));
  const horas = porHora.map((h) => h.hora);
  const pontos: Ponto[] = [];
  for (let h = Math.max(0, Math.min(...horas) - 1); h <= Math.min(23, Math.max(...horas) + 1); h++) {
    const d = mapa.get(h);
    pontos.push({ chave: String(h), rotulo: `${h}h`, detalhe: `${h}h às ${h + 1}h`, valor: Number(d?.faturamento ?? 0), sub: subPedidos(d?.pedidos ?? 0), n: d?.pedidos ?? 0 });
  }
  const pico = pontos.reduce((m, p, i) => (p.valor > pontos[m].valor ? i : m), 0);
  return (
    <>
      <p className="muted" style={{ margin: '0 0 12px' }}>Maior movimento: <b className="texto">{pontos[pico].detalhe}</b></p>
      <GraficoColunas dados={pontos} formatar={brl} formatarEixo={eixoReais} altura={180} rotuloAria="Faturamento por horário" />
    </>
  );
}

/* ---------------- Lista de pedidos + exportação ---------------- */
const POR_PAGINA = 20;
type FiltroStatus = 'vendas' | 'todos' | 'cancelados';

function ListaPedidos({ restauranteId, restauranteNome, periodo, versao, aoErro }: {
  restauranteId: string;
  restauranteNome: string;
  periodo: Periodo;
  versao: number;
  aoErro: (msg: string) => void;
}) {
  const [pagina, setPagina] = useState(0);
  const [filtro, setFiltro] = useState<FiltroStatus>('vendas');
  const [linhas, setLinhas] = useState<LinhaPedido[]>([]);
  const [total, setTotal] = useState(0);
  const [aberto, setAberto] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => { setPagina(0); }, [periodo, filtro]);

  const consulta = useCallback(() => {
    let q = supabase.from('pedidos')
      .select('id, numero, mesa_nome, status, total, criado_em, pago_em, pedido_itens(nome, qtd, preco_unit, obs, complementos)', { count: 'exact' })
      .eq('restaurante_id', restauranteId)
      .gte('criado_em', periodo.inicio.toISOString())
      .lt('criado_em', periodo.fim.toISOString())
      .order('criado_em', { ascending: false });
    if (filtro === 'vendas') q = q.neq('status', 'cancelado');
    if (filtro === 'cancelados') q = q.eq('status', 'cancelado');
    return q;
  }, [restauranteId, periodo, filtro]);

  useEffect(() => {
    let vivo = true;
    void consulta().range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1).then(({ data, count, error }) => {
      if (!vivo) return;
      if (error) return aoErro(msgErro(error));
      setLinhas((data ?? []) as LinhaPedido[]);
      setTotal(count ?? 0);
    });
    return () => { vivo = false; };
  }, [consulta, pagina, versao, aoErro]);

  async function exportar() {
    setExportando(true);
    try {
      const todas: LinhaPedido[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await consulta().range(de, de + 999);
        if (error) throw error;
        todas.push(...((data ?? []) as LinhaPedido[]));
        if (!data || data.length < 1000) break;
      }
      const num = (n: number) => Number(n).toFixed(2).replace('.', ',');
      const cel = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const cab = ['Data', 'Hora', 'Pedido', 'Mesa', 'Status', 'Itens', 'Qtd. itens', 'Total (R$)', 'Conta fechada em'];
      const corpo = todas.map((p) => [
        new Date(p.criado_em).toLocaleDateString('pt-BR'),
        hora(p.criado_em),
        String(p.numero),
        cel(p.mesa_nome),
        STATUS_ROTULO[p.status],
        cel(p.pedido_itens.map((i) => `${i.qtd}x ${i.nome}${i.complementos ? ` [${i.complementos}]` : ''}${i.obs ? ` (${i.obs})` : ''}`).join(' | ')),
        String(p.pedido_itens.reduce((s, i) => s + i.qtd, 0)),
        num(p.total),
        p.pago_em ? new Date(p.pago_em).toLocaleString('pt-BR') : '',
      ].join(';'));
      const csv = '﻿' + [cab.join(';'), ...corpo].join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      const nomeArq = restauranteNome.normalize('NFD').replace(/[^\w]+/g, '-').toLowerCase();
      a.href = url;
      a.download = `vendas-${nomeArq}-${iso(periodo.inicio)}-a-${iso(somarDias(periodo.fim, -1))}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      aoErro(msgErro(e));
    } finally {
      setExportando(false);
    }
  }

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  return (
    <section className="card">
      <div className="card__cab">
        <h2 className="card__titulo">Pedidos do período <small>{inteiro(total)}</small></h2>
        <div className="acoes-linha">
          <select className="select select--sm" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroStatus)} aria-label="Filtrar pedidos">
            <option value="vendas">Somente vendas</option>
            <option value="todos">Todos</option>
            <option value="cancelados">Somente cancelados</option>
          </select>
          <button className="btn btn--contorno btn--sm" onClick={() => void exportar()} disabled={exportando || total === 0}>
            <Download size={16} /> {exportando ? 'Gerando…' : 'Baixar planilha'}
          </button>
        </div>
      </div>

      {linhas.length === 0 ? (
        <p className="muted vazio-mini">Nenhum pedido neste período.</p>
      ) : (
        <div className="tabela-wrap tabela-compacta">
          <table className="tabela">
            <thead>
              <tr><th>Data</th><th>Pedido</th><th>Mesa</th><th>Status</th><th className="num">Itens</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {linhas.map((p) => (
                <Fragment key={p.id}>
                  <tr key={p.id} className="linha-clicavel" onClick={() => setAberto(aberto === p.id ? null : p.id)} aria-expanded={aberto === p.id}>
                    <td>{new Date(p.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} <span className="muted">{hora(p.criado_em)}</span></td>
                    <td>#{p.numero}</td>
                    <td>{p.mesa_nome}</td>
                    <td><span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>{p.pago_em && p.status !== 'cancelado' && <span className="badge badge--verde" style={{ marginLeft: 4 }}>Pago</span>}</td>
                    <td className="num">{p.pedido_itens.reduce((s, i) => s + i.qtd, 0)}</td>
                    <td className="num"><b>{brl(p.total)}</b></td>
                  </tr>
                  {aberto === p.id && (
                    <tr key={`${p.id}-itens`} className="linha-detalhe">
                      <td colSpan={6}>
                        <ul>
                          {p.pedido_itens.map((i, n) => (
                            <li key={n}><span>{i.qtd}× {i.nome}{i.complementos && <em className="muted"> · {i.complementos}</em>}{i.obs && <em className="muted"> — {i.obs}</em>}</span><span>{brl(i.qtd * i.preco_unit)}</span></li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="paginacao">
          <button className="icone-btn" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={18} /></button>
          <span>Página {pagina + 1} de {paginas}</span>
          <button className="icone-btn" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={18} /></button>
        </div>
      )}
    </section>
  );
}
