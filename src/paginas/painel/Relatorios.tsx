import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownRight, ArrowUpRight, BadgePercent, Banknote, BarChart3, Bike, CalendarDays, ChevronLeft, ChevronRight, Clock, CreditCard, DollarSign, Download, Minus, Package,
  PiggyBank, QrCode, Radio, ReceiptText, ShoppingBasket, Store, Table2, Ticket, TrendingUp, UtensilsCrossed, Wallet, XCircle,
} from 'lucide-react';
import { GraficoColunas, type Ponto } from '../../componentes/Graficos';
import { Vazio } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { msgErro, supabase } from '../../lib/supabase';
import type { StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, ehGestor, hora, inicioDoDia, tempoDesde, useAgora } from '../../lib/util';
import { Link, useParams } from 'react-router-dom';
import { usePainel } from './Painel';
import { RelatorioItens } from './RelatorioItens';
import { RelatorioMesas } from './RelatorioMesas';

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
interface Lucro {
  receita: number; custo: number; descontos: number; lucro: number; itens_sem_custo: number; produtos_sem_custo: string[];
  por_dia: { dia: string; receita: number; custo: number; lucro: number }[];
  por_produto: { nome: string; qtd: number; receita: number; custo: number; lucro: number; tem_custo: boolean }[];
}
interface Extra {
  por_forma: { forma: string; pedidos: number; receita: number }[];
  por_tipo: { tipo: string; pedidos: number; receita: number }[];
  taxas: number;
  descontos: number;
}
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
  const { restaurante, pedidos: aoVivo, papel } = usePainel();
  const veLucro = ehGestor(papel);
  const toast = useToast();
  const agora = useAgora(30000);
  // Subpáginas do menu: Visão geral · Itens · Mesas e comandas
  const { aba: abaUrl } = useParams<{ aba?: string }>();
  const aba = abaUrl === 'itens' || abaUrl === 'mesas' ? abaUrl : 'geral';

  const [preset, setPreset] = useState<Preset>('mes');
  const [de, setDe] = useState(iso(somarDias(new Date(), -6)));
  const [ate, setAte] = useState(iso(new Date()));
  const periodo = useMemo(() => periodoDe(preset, de, ate), [preset, de, ate]);
  const comparacao = useMemo(() => periodoAnterior(preset, periodo), [preset, periodo]);

  const [rel, setRel] = useState<Relatorio | null>(null);
  const [relAnt, setRelAnt] = useState<Relatorio | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [lucro, setLucro] = useState<Lucro | null>(null);
  const [meses, setMeses] = useState<Mes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [atualizadoEm, setAtualizadoEm] = useState<number | null>(null);
  const [verVendas, setVerVendas] = useState<'periodo' | 'meses'>('periodo');

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    const args = (p: Periodo) => ({ p_rest: restaurante.id, p_inicio: p.inicio.toISOString(), p_fim: p.fim.toISOString(), p_tz: TZ });
    const [a, b, m, x, l] = await Promise.all([
      supabase.rpc('relatorio_vendas', args(periodo)),
      supabase.rpc('relatorio_vendas', args(comparacao.periodo)),
      supabase.rpc('relatorio_meses', { p_rest: restaurante.id, p_meses: 12, p_tz: TZ }),
      supabase.rpc('relatorio_extra', { p_rest: restaurante.id, p_inicio: periodo.inicio.toISOString(), p_fim: periodo.fim.toISOString() }),
      veLucro ? supabase.rpc('relatorio_lucro', args(periodo)) : Promise.resolve({ data: null, error: null }),
    ]);
    setCarregando(false);
    if (a.error) {
      setErro(msgErro(a.error));
      return;
    }
    setErro('');
    setRel(a.data as Relatorio);
    setRelAnt(b.error ? null : (b.data as Relatorio));
    setExtra(x.error ? null : (x.data as Extra));
    setLucro(l.error ? null : (l.data as Lucro | null));
    if (!m.error) setMeses(m.data as Mes[]);
    setAtualizadoEm(Date.now());
  }, [restaurante.id, periodo, comparacao, veLucro]);

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
    setVerVendas('periodo');
  }

  const dias = Math.round((periodo.fim.getTime() - periodo.inicio.getTime()) / DIA);
  const rotuloPeriodo = dias === 1 ? dataLonga(periodo.inicio) : `${dataCurta(periodo.inicio)} a ${dataCurta(somarDias(periodo.fim, -1))}`;

  return (
    <div className="pagina relatorios rl">
      <div className="rl-cab">
        <div>
          <h1 className="titulo">{aba === 'itens' ? 'Itens vendidos' : aba === 'mesas' ? 'Mesas e comandas' : 'Relatórios'}</h1>
          <span className="rl-cab__sub">
            {aba === 'itens' ? 'Os itens mais vendidos, por quantidade e faturamento'
              : aba === 'mesas' ? 'Cada conta de mesa fechada no caixa é uma comanda'
                : 'Vendas são os pedidos não cancelados · tudo se atualiza sozinho'}
          </span>
        </div>
        <AoVivoHoje pedidos={aoVivo} agora={agora} />
      </div>

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
          <CalendarDays size={15} /> <b>{rotuloPeriodo}</b>
          {atualizadoEm && <> · atualizado {hora(new Date(atualizadoEm).toISOString())}</>}
        </span>
      </div>

      {erro ? (
        <p className="erro-form">{erro}</p>
      ) : !rel ? (
        <div className="carregando"><div className="spinner" /></div>
      ) : aba === 'mesas' ? (
        <div className={cx('relatorio', carregando && 'recarregando')}>
          <RelatorioMesas restauranteId={restaurante.id} inicio={periodo.inicio} fim={periodo.fim} tz={TZ} versao={atualizadoEm ?? 0} rotuloPeriodo={rotuloPeriodo} agora={agora} aoErro={(m) => toast(m, 'erro')} />
        </div>
      ) : aba === 'itens' ? (
        <div className={cx('relatorio', carregando && 'recarregando')}>
          <div className="relatorio__duplo">
            <section className="card rl-card">
              <header className="rl-card__cab"><div><h2>Produtos mais vendidos</h2><small>Top {Math.min(10, rel.top_produtos.length) || 10} do período</small></div></header>
              <Ranking linhas={rel.top_produtos.slice(0, 10).map((p) => ({ nome: p.nome, qtd: p.qtd, valor: Number(p.faturamento) }))} coluna="Produto" unidade="un." />
            </section>
            <section className="card rl-card">
              <header className="rl-card__cab"><div><h2>Vendas por categoria</h2><small>Itens e receita de cada categoria</small></div></header>
              <Ranking linhas={rel.por_categoria.map((c) => ({ nome: c.categoria, qtd: c.qtd, valor: Number(c.faturamento) }))} coluna="Categoria" unidade="itens" />
            </section>
          </div>
          <RelatorioItens restauranteId={restaurante.id} inicio={periodo.inicio} fim={periodo.fim} tz={TZ} versao={atualizadoEm ?? 0} rotuloPeriodo={rotuloPeriodo} aoErro={(m) => toast(m, 'erro')} />
        </div>
      ) : (
        <div className={cx('relatorio', carregando && 'recarregando')}>
          <section className="card rl-card">
            <header className="rl-card__cab">
              <div><h2>Painel operacional</h2><small>{rotuloPeriodo} · comparado com {comparacao.rotulo}</small></div>
            </header>
            <PainelOperacional rel={rel} ant={relAnt} extra={extra} rotuloComparacao={comparacao.rotulo} />
          </section>

          {lucro && <LucroPeriodo lucro={lucro} periodo={periodo} dias={dias} rotuloPeriodo={rotuloPeriodo} />}

          <HorariosPedidos porHora={rel.por_hora} rotuloPeriodo={rotuloPeriodo} />

          <QuantidadePedidos rel={rel} extra={extra} />

          <section className="card rl-card">
            <header className="rl-card__cab">
              <div>
                <h2>{verVendas === 'meses' ? 'Vendas por mês' : dias === 1 ? 'Vendas por hora' : dias > 62 ? 'Vendas por mês no período' : 'Vendas por dia'}</h2>
                <small>{verVendas === 'meses' ? 'Últimos 12 meses · toque num mês para ver o relatório dele' : rotuloPeriodo}</small>
              </div>
              <div className="rl-seg" role="tablist">
                <button role="tab" aria-selected={verVendas === 'periodo'} className={cx(verVendas === 'periodo' && 'ativo')} onClick={() => setVerVendas('periodo')}>Período</button>
                <button role="tab" aria-selected={verVendas === 'meses'} className={cx(verVendas === 'meses' && 'ativo')} onClick={() => setVerVendas('meses')}>12 meses</button>
              </div>
            </header>
            {verVendas === 'meses' ? <GraficoMensal meses={meses} aoEscolher={escolherMes} /> : <GraficoPeriodo rel={rel} periodo={periodo} dias={dias} />}
          </section>

          <ListaPedidos restauranteId={restaurante.id} restauranteNome={restaurante.nome} periodo={periodo} versao={atualizadoEm ?? 0} aoErro={(m) => toast(m, 'erro')} />
        </div>
      )}
    </div>
  );
}

/* ---------------- Ao vivo: faixa compacta no topo ---------------- */
function AoVivoHoje({ pedidos, agora }: { pedidos: ReturnType<typeof usePainel>['pedidos']; agora: number }) {
  const hoje = inicioDoDia();
  const deHoje = pedidos.filter((p) => new Date(p.criado_em).getTime() >= hoje && p.status !== 'cancelado');
  const total = deHoje.reduce((s, p) => s + Number(p.total), 0);
  const ultimo = deHoje.slice().sort((a, b) => b.criado_em.localeCompare(a.criado_em))[0];
  const ha = ultimo ? tempoDesde(ultimo.criado_em, agora) : '';
  return (
    <div className="rl-vivo" aria-live="polite">
      <span className="rl-vivo__selo"><Radio size={13} /> Ao vivo · hoje</span>
      <strong>{brl(total)}</strong>
      <span className="rl-vivo__info">
        {deHoje.length} {deHoje.length === 1 ? 'pedido' : 'pedidos'}
        {ultimo && <> · último #{ultimo.numero} {ultimo.mesa_nome} {ha === 'agora' ? 'agora mesmo' : `há ${ha}`}</>}
      </span>
    </div>
  );
}

/* ---------------- Painel operacional (cartões compactos) ---------------- */
function PainelOperacional({ rel, ant, extra, rotuloComparacao }: { rel: Relatorio; ant: Relatorio | null; extra: Extra | null; rotuloComparacao: string }) {
  const r = rel.resumo;
  const a = ant?.resumo;
  const cartoes: { icone: ReactNode; valor: string; rotulo: string; dica?: string; atual?: number; anterior?: number; tom?: 'perigo' | 'ok' }[] = [
    { icone: <DollarSign size={17} />, valor: brl(r.faturamento), rotulo: 'Total das vendas', atual: r.faturamento, anterior: a?.faturamento },
    { icone: <ReceiptText size={17} />, valor: inteiro(r.pedidos), rotulo: 'Total de pedidos', atual: r.pedidos, anterior: a?.pedidos },
    { icone: <Ticket size={17} />, valor: brl(r.ticket_medio), rotulo: 'Ticket médio', atual: r.ticket_medio, anterior: a?.ticket_medio },
    { icone: <Package size={17} />, valor: inteiro(r.itens), rotulo: 'Itens vendidos', atual: r.itens, anterior: a?.itens },
    { icone: <Wallet size={17} />, valor: brl(r.recebido), rotulo: 'Valor recebido', dica: 'Contas já fechadas no caixa', tom: 'ok' },
    { icone: <Clock size={17} />, valor: brl(r.em_aberto), rotulo: 'Em aberto', dica: 'Mesas e pedidos ainda sem pagamento' },
    { icone: <Bike size={17} />, valor: brl(Number(extra?.taxas ?? 0)), rotulo: 'Taxas de entrega', dica: 'Somadas nos pedidos de delivery' },
    { icone: <BadgePercent size={17} />, valor: brl(Number(extra?.descontos ?? 0)), rotulo: 'Descontos', dica: 'Descontos dados no balcão (PDV)' },
    { icone: <XCircle size={17} />, valor: inteiro(rel.cancelados.pedidos), rotulo: 'Cancelados', dica: `${brl(rel.cancelados.valor)} que não entraram nas vendas`, tom: 'perigo' },
  ];
  return (
    <div className="rl-painel">
      {cartoes.map((c) => (
        <div key={c.rotulo} className={cx('rl-stat', c.tom && `rl-stat--${c.tom}`)}>
          <span className="rl-stat__icone">{c.icone}</span>
          <div>
            <strong>{c.valor}</strong>
            <span>{c.rotulo}</span>
            {c.atual !== undefined ? <DeltaCurto atual={c.atual} anterior={c.anterior} rotulo={rotuloComparacao} /> : c.dica && <small>{c.dica}</small>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Comparação numa linha só: "▲ +12% vs. mês anterior". */
function DeltaCurto({ atual, anterior, rotulo }: { atual: number; anterior?: number; rotulo: string }) {
  if (anterior === undefined) return null;
  if (anterior === 0) return <span className="delta delta--neutro" title={`Sem vendas no ${rotulo} para comparar`}><Minus size={13} /> sem histórico</span>;
  const v = (atual - anterior) / anterior;
  if (Math.abs(v) < 0.005) return <span className="delta delta--neutro"><Minus size={13} /> igual ao {rotulo}</span>;
  return (
    <span className={cx('delta', v > 0 ? 'delta--sobe' : 'delta--desce')} title={`Comparado com ${rotulo}`}>
      {v > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
      {`${v > 0 ? '+' : ''}${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} <span className="muted">vs. {rotulo}</span>
    </span>
  );
}

/* ---------------- Lucro (só dono e gerente) ---------------- */
function LucroPeriodo({ lucro, periodo, dias, rotuloPeriodo }: { lucro: Lucro; periodo: Periodo; dias: number; rotuloPeriodo: string }) {
  const receita = Number(lucro.receita);
  const valor = Number(lucro.lucro);
  const margem = receita > 0 ? (valor / receita) * 100 : 0;
  const mapa = new Map(lucro.por_dia.map((d) => [d.dia, d]));
  const pontos: Ponto[] = [];
  if (dias > 1 && dias <= 62) {
    for (let d = periodo.inicio; d < periodo.fim; d = somarDias(d, 1)) {
      const v = mapa.get(iso(d));
      pontos.push({ chave: iso(d), rotulo: dataCurta(d), detalhe: dataLonga(d), valor: Math.max(0, Number(v?.lucro ?? 0)), sub: v ? `Vendas ${brl(Number(v.receita))} · custo ${brl(Number(v.custo))}` : 'Sem vendas' });
    }
  }
  const top = lucro.por_produto.filter((x) => x.tem_custo).slice(0, 5);
  return (
    <section className="card rl-card rl-lucro">
      <header className="rl-card__cab">
        <div><h2>Lucro</h2><small>{rotuloPeriodo} · vendas dos produtos − custo − descontos (taxa de entrega fica de fora)</small></div>
      </header>
      <div className="rl-painel">
        <div className="rl-stat"><span className="rl-stat__icone"><DollarSign size={17} /></span><div><strong>{brl(receita)}</strong><span>Vendas de produtos</span></div></div>
        <div className="rl-stat rl-stat--perigo"><span className="rl-stat__icone"><Package size={17} /></span><div><strong>{brl(Number(lucro.custo))}</strong><span>Custo dos produtos</span></div></div>
        {Number(lucro.descontos) > 0 && <div className="rl-stat"><span className="rl-stat__icone"><BadgePercent size={17} /></span><div><strong>{brl(Number(lucro.descontos))}</strong><span>Descontos</span></div></div>}
        <div className="rl-stat rl-stat--ok rl-stat--destaque"><span className="rl-stat__icone"><PiggyBank size={17} /></span><div><strong className={cx(valor < 0 && 'texto-perigo')}>{brl(valor)}</strong><span>Lucro</span></div></div>
        <div className="rl-stat rl-stat--ok"><span className="rl-stat__icone"><TrendingUp size={17} /></span><div><strong>{Math.round(margem)}%</strong><span>Margem</span></div></div>
      </div>
      {lucro.itens_sem_custo > 0 && (
        <p className="rl-aviso">
          <Package size={16} />
          <span><b>{lucro.produtos_sem_custo.length} {lucro.produtos_sem_custo.length === 1 ? 'produto vendido está' : 'produtos vendidos estão'} sem custo</b> ({lucro.produtos_sem_custo.slice(0, 4).join(', ')}{lucro.produtos_sem_custo.length > 4 ? '…' : ''}). Sem o custo, o lucro deles parece maior do que é.</span>
          <Link className="btn btn--contorno btn--sm" to="/painel/estoque">Cadastrar custos</Link>
        </p>
      )}
      {pontos.some((p) => p.valor > 0) && (
        <div className="rl-lucro__grafico">
          <GraficoColunas dados={pontos} formatar={brl} formatarEixo={eixoReais} altura={170} rotuloAria="Lucro por dia" />
        </div>
      )}
      {top.length > 0 && (
        <div className="tabela-wrap">
          <table className="tabela rl-tabela">
            <thead><tr><th>Produtos que mais deram lucro</th><th className="num">Qtd.</th><th className="num">Vendas</th><th className="num">Custo</th><th className="num">Lucro</th></tr></thead>
            <tbody>
              {top.map((x) => (
                <tr key={x.nome}><td><b>{x.nome}</b></td><td className="num">{inteiro(x.qtd)}</td><td className="num">{brl(Number(x.receita))}</td><td className="num">{brl(Number(x.custo))}</td><td className="num"><b className="texto-ok">{brl(Number(x.lucro))}</b></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- Horários com mais pedidos ---------------- */
function HorariosPedidos({ porHora, rotuloPeriodo }: { porHora: Relatorio['por_hora']; rotuloPeriodo: string }) {
  const [medida, setMedida] = useState<'pedidos' | 'faturamento'>('pedidos');
  const mapa = new Map(porHora.map((h) => [h.hora, h]));
  const horas = porHora.map((h) => h.hora);
  const lista: { h: number; v: number; n: number; fat: number }[] = [];
  if (horas.length) {
    // Pelo menos 12 horas na tela (com poucos horários as barras não ficam soltas)
    let ini = Math.max(0, Math.min(...horas) - 1);
    let fim = Math.min(23, Math.max(...horas) + 1);
    while (fim - ini < 11) { if (ini > 0) ini--; if (fim - ini < 11 && fim < 23) fim++; }
    for (let h = ini; h <= fim; h++) {
      const d = mapa.get(h);
      const n = d?.pedidos ?? 0;
      const fat = Number(d?.faturamento ?? 0);
      lista.push({ h, n, fat, v: medida === 'pedidos' ? n : fat });
    }
  }
  const max = Math.max(1, ...lista.map((x) => x.v));
  const pico = lista.reduce((m, x, i) => (x.v > (lista[m]?.v ?? -1) ? i : m), 0);
  // Celular: o gráfico rola de lado; já abre mostrando o horário de pico
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = area.current;
    const alvo = el?.children[pico] as HTMLElement | undefined;
    if (el && alvo && el.scrollWidth > el.clientWidth) el.scrollLeft = alvo.offsetLeft - el.clientWidth / 2 + alvo.offsetWidth / 2;
  }, [pico, lista.length]);
  return (
    <section className="card rl-card">
      <header className="rl-card__cab">
        <div>
          <h2>Horários com mais pedidos</h2>
          <small>{rotuloPeriodo}{lista.length ? ` · pico às ${lista[pico].h}h` : ''}</small>
        </div>
        <div className="rl-seg" role="tablist">
          <button role="tab" aria-selected={medida === 'pedidos'} className={cx(medida === 'pedidos' && 'ativo')} onClick={() => setMedida('pedidos')}>Pedidos</button>
          <button role="tab" aria-selected={medida === 'faturamento'} className={cx(medida === 'faturamento' && 'ativo')} onClick={() => setMedida('faturamento')}>Faturamento</button>
        </div>
      </header>
      {!lista.length ? <p className="muted vazio-mini">Nenhuma venda no período.</p> : (
        <div className="rl-horas" ref={area} role="img" aria-label={`${medida === 'pedidos' ? 'Pedidos' : 'Faturamento'} por horário`}>
          {lista.map((x, i) => (
            <div key={x.h} className={cx('rl-hora', i === pico && x.v > 0 && 'pico')} title={`${x.h}h às ${x.h + 1}h · ${x.n} ${x.n === 1 ? 'pedido' : 'pedidos'} · ${brl(x.fat)}`}>
              <span className="rl-hora__valor">{x.v > 0 ? (medida === 'pedidos' ? x.v : eixoReais(x.v)) : ''}</span>
              <span className="rl-hora__trilho"><i style={{ height: `${Math.max(x.v > 0 ? 3 : 0, (x.v / max) * 100)}%` }} /></span>
              <span className="rl-hora__rotulo">{x.h}h</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Quantidade de pedidos (forma de pagamento, tipo, mesas) ---------------- */
const FORMAS: Record<string, { rotulo: string; icone: ReactNode }> = {
  pix: { rotulo: 'Pix', icone: <QrCode size={16} /> },
  dinheiro: { rotulo: 'Dinheiro', icone: <Banknote size={16} /> },
  credito: { rotulo: 'Cartão de crédito', icone: <CreditCard size={16} /> },
  debito: { rotulo: 'Cartão de débito', icone: <CreditCard size={16} /> },
  aberto: { rotulo: 'Ainda em aberto', icone: <Clock size={16} /> },
  outro: { rotulo: 'Outra forma', icone: <Wallet size={16} /> },
};
const TIPOS: Record<string, { rotulo: string; icone: ReactNode }> = {
  mesa: { rotulo: 'Mesa (salão)', icone: <UtensilsCrossed size={16} /> },
  delivery: { rotulo: 'Delivery', icone: <Bike size={16} /> },
  retirada: { rotulo: 'Retirada no balcão', icone: <Store size={16} /> },
  balcao: { rotulo: 'Balcão (PDV)', icone: <ShoppingBasket size={16} /> },
};

function QuantidadePedidos({ rel, extra }: { rel: Relatorio; extra: Extra | null }) {
  const [aba, setAba] = useState<'forma' | 'tipo' | 'mesa'>('forma');
  const linhas: { chave: string; rotulo: string; icone: ReactNode; pedidos: number; receita: number }[] =
    aba === 'forma'
      ? (extra?.por_forma ?? []).map((f) => ({ chave: f.forma, rotulo: FORMAS[f.forma]?.rotulo ?? f.forma, icone: FORMAS[f.forma]?.icone ?? <Wallet size={16} />, pedidos: f.pedidos, receita: Number(f.receita) }))
      : aba === 'tipo'
        ? (extra?.por_tipo ?? []).map((t) => ({ chave: t.tipo, rotulo: TIPOS[t.tipo]?.rotulo ?? t.tipo, icone: TIPOS[t.tipo]?.icone ?? <ReceiptText size={16} />, pedidos: t.pedidos, receita: Number(t.receita) }))
        : rel.por_mesa.map((m) => ({ chave: m.mesa, rotulo: m.mesa, icone: <UtensilsCrossed size={16} />, pedidos: m.pedidos, receita: Number(m.faturamento) }));
  const totalPedidos = linhas.reduce((s, l) => s + l.pedidos, 0);
  const totalReceita = linhas.reduce((s, l) => s + l.receita, 0);
  return (
    <section className="card rl-card">
      <header className="rl-card__cab"><div><h2>Quantidade de pedidos</h2><small>Como os pedidos chegaram e foram pagos</small></div></header>
      <nav className="rl-abas" role="tablist">
        {([['forma', 'Forma de pagamento'], ['tipo', 'Tipo de pedido'], ['mesa', 'Mesas']] as const).map(([id, r]) => (
          <button key={id} role="tab" aria-selected={aba === id} className={cx(aba === id && 'ativo')} onClick={() => setAba(id)}>{r}</button>
        ))}
      </nav>
      {!linhas.length ? <p className="muted vazio-mini">Nenhum pedido no período.</p> : (
        <div className="tabela-wrap">
          <table className="tabela rl-tabela">
            <thead><tr><th>{aba === 'forma' ? 'Forma' : aba === 'tipo' ? 'Tipo' : 'Mesa'}</th><th className="num">% do total</th><th className="num">Pedidos</th><th className="num">Receita</th></tr></thead>
            <tbody>
              {linhas.map((l) => {
                const pct = totalReceita ? (l.receita / totalReceita) * 100 : 0;
                return (
                  <tr key={l.chave}>
                    <td><span className="rl-nome"><span className="rl-nome__icone">{l.icone}</span>{l.rotulo}</span></td>
                    <td className="num"><span className="rl-pct"><span className="rl-pct__trilho"><i style={{ width: `${pct}%` }} /></span>{pct < 1 && pct > 0 ? '<1' : Math.round(pct)}%</span></td>
                    <td className="num">{inteiro(l.pedidos)}</td>
                    <td className="num"><b>{brl(l.receita)}</b></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">100%</td><td className="num">{inteiro(totalPedidos)}</td><td className="num">{brl(totalReceita)}</td></tr></tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------- Ranking (produtos, categorias) em tabela compacta ---------------- */
function Ranking({ linhas, coluna, unidade }: { linhas: { nome: string; qtd: number; valor: number }[]; coluna: string; unidade: string }) {
  if (!linhas.length) return <p className="muted vazio-mini">Nenhuma venda no período.</p>;
  const max = Math.max(...linhas.map((l) => l.valor), 1);
  return (
    <div className="tabela-wrap">
      <table className="tabela rl-tabela rl-ranking">
        <thead><tr><th>#</th><th>{coluna}</th><th className="num">Qtd.</th><th className="num">Receita</th></tr></thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={l.nome}>
              <td className="rl-ranking__pos">{i + 1}</td>
              <td><span className="rl-ranking__nome">{l.nome}<i style={{ width: `${(l.valor / max) * 100}%` }} /></span></td>
              <td className="num">{inteiro(l.qtd)} <small className="muted">{unidade}</small></td>
              <td className="num"><b>{brl(l.valor)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
        <span className="muted">Total em 12 meses: <b className="texto">{brl(total)}</b></span>
        <AlternarTabela tabela={tabela} aoMudar={setTabela} />
      </div>
      {tabela
        ? <TabelaPontos pontos={pontos} coluna="Mês" />
        : <GraficoColunas dados={pontos} formatar={brl} formatarEixo={eixoReais} altura={190} rotuloAria="Faturamento por mês" aoClicar={(i) => aoEscolher(pontos[i].chave)} destacar={pontos.length - 1} />}
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
        <GraficoColunas dados={pontos} formatar={brl} formatarEixo={eixoReais} altura={190} rotuloAria={`Faturamento por ${coluna.toLowerCase()}`} destacar={hojeIdx >= 0 ? hojeIdx : undefined} />
      )}
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
