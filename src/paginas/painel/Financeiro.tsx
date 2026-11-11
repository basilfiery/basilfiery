import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, Bot, CalendarClock, Check, ChevronLeft, ChevronRight, FileText,
  HandCoins, ImagePlus, Paperclip, Pencil, Plus, Receipt, Repeat, Search, Trash2, TrendingUp, Users, Wallet, X,
} from 'lucide-react';
import { Campo, Switch, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { confirmar } from '../../componentes/Confirmar';
import { msgErro, supabase } from '../../lib/supabase';
import { brl, cx, lerPreco, mascaraPreco, precoParaTexto } from '../../lib/util';
import {
  CATEGORIAS_DESPESA, CATEGORIAS_RECEITA, FORMAS_FIN, dataBRCurta, dataBRLonga, enviarComprovante, hojeISO, limitesMes, linkComprovante, nomeMes, rotuloForma,
  type ContaFixa, type Funcionario, type Lancamento, type ResumoFin, type TipoLanc,
} from '../../lib/financeiro';
import { usePainel } from './Painel';
import { BotWhatsApp } from './FinanceiroBot';

/* =====================================================================
   Financeiro: visão do mês, lançamentos, contas a pagar, folha de
   pagamento, contas fixas e o bot do WhatsApp. Só dono e gerente.
   ===================================================================== */

type Aba = 'geral' | 'lancamentos' | 'pagar' | 'folha' | 'fixas' | 'bot';
const ABAS: { id: Aba; rotulo: string; icone: ReactNode }[] = [
  { id: 'geral', rotulo: 'Visão geral', icone: <TrendingUp size={16} /> },
  { id: 'lancamentos', rotulo: 'Lançamentos', icone: <Receipt size={16} /> },
  { id: 'pagar', rotulo: 'Contas a pagar', icone: <CalendarClock size={16} /> },
  { id: 'folha', rotulo: 'Folha de pagamento', icone: <Users size={16} /> },
  { id: 'fixas', rotulo: 'Contas fixas', icone: <Repeat size={16} /> },
  { id: 'bot', rotulo: 'Bot do WhatsApp', icone: <Bot size={16} /> },
];
const num = (v: unknown) => Number(v ?? 0);
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function Financeiro() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'geral';
  const irAba = (a: Aba) => setParams(a === 'geral' ? {} : { aba: a }, { replace: true });
  const agora = new Date();
  const [mes, setMes] = useState({ ano: agora.getFullYear(), mes: agora.getMonth() });
  const lim = limitesMes(mes.ano, mes.mes);
  const mesAtual = mes.ano === agora.getFullYear() && mes.mes === agora.getMonth();
  const futuro = mes.ano * 12 + mes.mes > agora.getFullYear() * 12 + agora.getMonth();

  const [resumo, setResumo] = useState<ResumoFin | null>(null);
  const [lancs, setLancs] = useState<Lancamento[] | null>(null);
  const [abertos, setAbertos] = useState<Lancamento[] | null>(null);
  const [editando, setEditando] = useState<Partial<Lancamento> | null>(null);
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      // Mês atual ou futuro: gera as contas fixas e os salários do mês (a pagar)
      if (mesAtual || futuro) await supabase.rpc('fin_gerar_mes', { p_rest: r.id, p_mes: lim.ini });
      const [a, b, c] = await Promise.all([
        supabase.rpc('fin_resumo', { p_rest: r.id, p_inicio: lim.ini, p_fim: lim.fim }),
        supabase.from('fin_lancamentos').select('*').eq('restaurante_id', r.id)
          .or(`and(data.gte.${lim.ini},data.lte.${lim.fim}),and(pago_em.gte.${lim.ini},pago_em.lte.${lim.fim}),and(vencimento.gte.${lim.ini},vencimento.lte.${lim.fim})`)
          .order('data', { ascending: false }).order('criado_em', { ascending: false }),
        supabase.from('fin_lancamentos').select('*').eq('restaurante_id', r.id).eq('pago', false).eq('tipo', 'despesa').order('vencimento', { ascending: true }),
      ]);
      if (!vivo) return;
      if (a.error) toast(msgErro(a.error), 'erro');
      setResumo(a.data as ResumoFin);
      setLancs((b.data ?? []) as Lancamento[]);
      setAbertos((c.data ?? []) as Lancamento[]);
    })();
    return () => { vivo = false; };
  }, [r.id, lim.ini, lim.fim, mesAtual, futuro, versao, toast]);

  const mudarMes = (d: number) => setMes((m) => { const t = m.ano * 12 + m.mes + d; return { ano: Math.floor(t / 12), mes: t % 12 }; });

  async function pagar(l: Lancamento, valor?: number) {
    const { error } = await supabase.from('fin_lancamentos').update({ pago: true, pago_em: hojeISO(), ...(valor != null ? { valor } : {}) }).eq('id', l.id);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${l.descricao}: pago.`, 'ok');
    recarregar();
  }
  async function apagar(l: Lancamento) {
    if (!(await confirmar(`Apagar o lançamento "${l.descricao}" de ${brl(num(l.valor))}?`, { sim: 'Apagar', perigo: true }))) return;
    const { error } = await supabase.from('fin_lancamentos').delete().eq('id', l.id);
    if (error) return toast(msgErro(error), 'erro');
    if (l.comprovante_path) void supabase.storage.from('financeiro').remove([l.comprovante_path]);
    toast('Lançamento apagado.', 'ok');
    recarregar();
  }

  const acoes = { pagar, apagar, editar: (l: Lancamento) => setEditando(l) };

  return (
    <div className="pagina fin">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Financeiro</h1>
          <p>Tudo o que entra e sai da empresa: vendas do sistema, despesas, contas a pagar e folha de pagamento.</p>
        </div>
        <div className="fin__cab-acoes">
          <div className="fin__mes" role="group" aria-label="Mês">
            <button className="icone-btn" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
            <strong>{nomeMes(mes.ano, mes.mes)}</strong>
            <button className="icone-btn" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
          </div>
          <button className="btn btn--contorno" onClick={() => setEditando({ tipo: 'receita' })}><ArrowDownCircle size={17} /> Receita</button>
          <button className="btn btn--primario" onClick={() => setEditando({ tipo: 'despesa' })}><Plus size={17} /> Lançar despesa</button>
        </div>
      </div>

      <nav className="rl-abas fin__abas" role="tablist">
        {ABAS.map((a) => (
          <button key={a.id} role="tab" aria-selected={aba === a.id} className={cx(aba === a.id && 'ativo')} onClick={() => irAba(a.id)}>
            {a.icone} {a.rotulo}
            {a.id === 'pagar' && !!resumo?.vencidas.qtd && <b className="fin__aba-alerta">{resumo.vencidas.qtd}</b>}
          </button>
        ))}
      </nav>

      {aba === 'geral' && (!resumo || !lancs ? <Carregando /> : <VisaoGeral r={resumo} lim={lim} mesAtual={mesAtual} abertos={abertos ?? []} acoes={acoes} irAba={irAba} />)}
      {aba === 'lancamentos' && (!lancs ? <Carregando /> : <ListaLancamentos lancs={lancs} acoes={acoes} />)}
      {aba === 'pagar' && (!abertos ? <Carregando /> : <ContasPagar abertos={abertos} acoes={acoes} />)}
      {aba === 'folha' && <Folha restauranteId={r.id} lim={lim} lancs={lancs ?? []} aoMudar={recarregar} aoLancar={setEditando} acoes={acoes} />}
      {aba === 'fixas' && <ContasFixas restauranteId={r.id} aoMudar={recarregar} />}
      {aba === 'bot' && <BotWhatsApp restauranteId={r.id} />}

      {editando && (
        <ModalLancamento restauranteId={r.id} inicial={editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); recarregar(); }} />
      )}
    </div>
  );
}

interface Acoes { pagar: (l: Lancamento, valor?: number) => Promise<void>; apagar: (l: Lancamento) => Promise<void>; editar: (l: Lancamento) => void }

/* ---------------- Visão geral do mês ---------------- */
function VisaoGeral({ r, lim, mesAtual, abertos, acoes, irAba }: {
  r: ResumoFin; lim: { ini: string; fim: string; dias: number }; mesAtual: boolean; abertos: Lancamento[]; acoes: Acoes; irAba: (a: Aba) => void;
}) {
  const vendas = num(r.vendas.total);
  const saidas = num(r.despesas_pagas) + num(r.corridas);
  const resultado = vendas + num(r.receitas) - saidas;
  // Previsão até o fim do mês: vendas no ritmo de hoje + tudo que ainda vai vencer no mês
  const diaHoje = mesAtual ? Number(r.hoje.slice(8, 10)) : lim.dias;
  const vendasPrev = mesAtual && diaHoje > 0 ? (num(r.vendas_ate_hoje) / diaHoje) * lim.dias : vendas;
  const corridasPrev = mesAtual && diaHoje > 0 ? (num(r.corridas) / diaHoje) * lim.dias : num(r.corridas);
  const previsto = vendasPrev + num(r.receitas) - num(r.despesas_pagas) - num(r.despesas_a_pagar) - corridasPrev;
  const maiorCat = Math.max(1, ...r.por_categoria.map((c) => num(c.total)));
  const proximas = abertos.filter((l) => (l.vencimento ?? l.data) <= lim.fim).slice(0, 6);
  const totalCat = r.por_categoria.reduce((s, c) => s + num(c.total), 0) || 1;

  return (
    <div className="fin__geral">
      <div className="fin__kpis">
        <div className="fin__kpi fin__kpi--entrada">
          <span><ArrowDownCircle size={15} /> Vendas no mês</span>
          <strong>{brl(vendas)}</strong>
          <small>{r.vendas.pedidos} pedidos{num(r.receitas) > 0 ? ` · + ${brl(num(r.receitas))} outras receitas` : ''}</small>
        </div>
        <div className="fin__kpi fin__kpi--saida">
          <span><ArrowUpCircle size={15} /> Despesas pagas</span>
          <strong>{brl(saidas)}</strong>
          <small>{num(r.corridas) > 0 ? `inclui ${brl(num(r.corridas))} de corridas dos entregadores` : 'tudo que já saiu do caixa e do banco'}</small>
        </div>
        <div className={cx('fin__kpi', resultado >= 0 ? 'fin__kpi--ok' : 'fin__kpi--ruim')}>
          <span><Wallet size={15} /> Resultado até agora</span>
          <strong>{resultado < 0 ? '− ' : ''}{brl(Math.abs(resultado))}</strong>
          <small>vendas + receitas − despesas pagas</small>
        </div>
        <div className={cx('fin__kpi fin__kpi--destaque', previsto < 0 && 'negativo')}>
          <span><TrendingUp size={15} /> Saldo estimado do mês</span>
          <strong>{previsto < 0 ? '− ' : ''}{brl(Math.abs(previsto))}</strong>
          <small>{mesAtual ? `vendas no ritmo de hoje (${brl(vendasPrev)}) − contas do mês` : 'fechamento do mês'}{num(r.despesas_a_pagar) > 0 ? ` · ${brl(num(r.despesas_a_pagar))} ainda a pagar` : ''}</small>
        </div>
      </div>

      {r.vencidas.qtd > 0 && (
        <button className="fin__alerta" onClick={() => irAba('pagar')}>
          <AlertTriangle size={18} /> <span><b>{r.vencidas.qtd} {r.vencidas.qtd === 1 ? 'conta vencida' : 'contas vencidas'}</b> somando {brl(num(r.vencidas.total))}. Toque para ver.</span>
        </button>
      )}

      <section className="card fin__grafico">
        <div className="fin__grafico-cab">
          <h2 className="card__titulo">Entradas e saídas por dia</h2>
          <div className="fin__legenda"><span><i className="fin__cor--vendas" /> Vendas</span><span><i className="fin__cor--despesas" /> Despesas pagas</span></div>
        </div>
        <GraficoDias dias={r.por_dia} />
      </section>

      <div className="fin__duas">
        <section className="card">
          <h2 className="card__titulo">Para onde vai o dinheiro</h2>
          {r.por_categoria.length === 0 ? <p className="muted">Nenhuma despesa lançada neste mês.</p> : (
            <ul className="fin__cats">
              {r.por_categoria.map((c) => (
                <li key={c.categoria}>
                  <div><b>{c.categoria}</b><span>{brl(num(c.total))} <small>{Math.round((num(c.total) / totalCat) * 100)}%</small></span></div>
                  <i><em style={{ width: `${(num(c.total) / maiorCat) * 100}%` }} /></i>
                  {num(c.pago) < num(c.total) && <small className="muted">{brl(num(c.total) - num(c.pago))} ainda a pagar</small>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="card__titulo">Próximas contas</h2>
          {proximas.length === 0 ? <p className="muted">Nenhuma conta para pagar neste mês.</p> : (
            <ul className="fin__lista">
              {proximas.map((l) => <LinhaLanc key={l.id} l={l} acoes={acoes} compacta />)}
            </ul>
          )}
          {abertos.length > proximas.length && <button className="btn btn--fantasma btn--sm" onClick={() => irAba('pagar')}>Ver todas as contas a pagar</button>}
        </section>
      </div>

      {Object.keys(r.recebido_por_forma).length > 0 && (
        <section className="card">
          <h2 className="card__titulo">Recebido nos caixas, por forma</h2>
          <div className="fin__formas">
            {Object.entries(r.recebido_por_forma).sort((a, b) => num(b[1]) - num(a[1])).map(([f, v]) => (
              <div key={f}><small>{rotuloForma(f)}</small><b>{brl(num(v))}</b></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Barras por dia: vendas × despesas (passe o mouse ou toque para ver o valor) */
function GraficoDias({ dias }: { dias: ResumoFin['por_dia'] }) {
  const [sel, setSel] = useState<number | null>(null);
  const max = Math.max(1, ...dias.map((d) => Math.max(num(d.vendas), num(d.despesas))));
  if (!dias.length) return <p className="muted">Sem dados ainda.</p>;
  const d = sel != null ? dias[sel] : null;
  return (
    <div className="fin__barras-wrap" onMouseLeave={() => setSel(null)}>
      <div className="fin__barras" role="img" aria-label="Vendas e despesas por dia">
        {dias.map((x, i) => (
          <button key={x.dia} type="button" className={cx('fin__dia', sel === i && 'ativo')} onMouseEnter={() => setSel(i)} onFocus={() => setSel(i)} onClick={() => setSel(i)}
            aria-label={`${dataBRCurta(x.dia)}: vendas ${brl(num(x.vendas))}, despesas ${brl(num(x.despesas))}`}>
            <span className="fin__dia-barras">
              <i className="fin__cor--vendas" style={{ height: `${(num(x.vendas) / max) * 100}%` }} />
              <i className="fin__cor--despesas" style={{ height: `${(num(x.despesas) / max) * 100}%` }} />
            </span>
            <small>{Number(x.dia.slice(8, 10))}</small>
          </button>
        ))}
      </div>
      <div className={cx('fin__dica', d && 'visivel')} aria-live="polite">
        {d ? <><b>{dataBRLonga(d.dia)}</b><span><i className="fin__cor--vendas" /> Vendas {brl(num(d.vendas))}</span><span><i className="fin__cor--despesas" /> Despesas {brl(num(d.despesas))}</span></>
          : <span className="muted">Passe o mouse (ou toque) em um dia para ver os valores.</span>}
      </div>
    </div>
  );
}

/* ---------------- Uma linha de lançamento ---------------- */
function LinhaLanc({ l, acoes, compacta }: { l: Lancamento; acoes: Acoes; compacta?: boolean }) {
  const hoje = hojeISO();
  const venc = l.vencimento ?? l.data;
  const vencida = !l.pago && venc < hoje;
  const toast = useToast();
  async function verComprovante() {
    try { window.open(await linkComprovante(l.comprovante_path!), '_blank', 'noopener'); } catch (e) { toast(msgErro(e), 'erro'); }
  }
  return (
    <li className={cx('fin__linha', l.tipo === 'receita' && 'receita', vencida && 'vencida')}>
      <span className="fin__linha-icone">{l.tipo === 'receita' ? <ArrowDownCircle size={18} /> : l.origem === 'whatsapp' ? <Bot size={18} /> : l.funcionario_id ? <Users size={18} /> : l.conta_fixa_id ? <Repeat size={18} /> : <ArrowUpCircle size={18} />}</span>
      <button className="fin__linha-txt" onClick={() => acoes.editar(l)}>
        <b>{l.descricao}</b>
        <small>
          {l.categoria}
          {l.fornecedor ? ` · ${l.fornecedor}` : ''}
          {' · '}
          {l.pago ? `pago ${dataBRCurta(l.pago_em)}${l.forma ? ` no ${rotuloForma(l.forma).toLowerCase()}` : ''}` : vencida ? `venceu ${dataBRCurta(venc)}` : `vence ${dataBRCurta(venc)}`}
          {l.origem === 'whatsapp' ? ' · pelo WhatsApp' : ''}
        </small>
      </button>
      {l.comprovante_path && <button className="icone-btn" title="Ver comprovante" aria-label="Ver comprovante" onClick={() => void verComprovante()}><Paperclip size={16} /></button>}
      <strong className="fin__linha-valor">{l.tipo === 'receita' ? '+' : '−'} {brl(num(l.valor))}</strong>
      {!l.pago ? (
        <button className="btn btn--sucesso btn--sm" onClick={() => void acoes.pagar(l)}><Check size={15} /> Pagar</button>
      ) : !compacta ? (
        <span className="badge badge--verde fin__pago">Pago</span>
      ) : null}
      {!compacta && (
        <span className="fin__linha-acoes">
          <button className="icone-btn" title="Editar" aria-label="Editar" onClick={() => acoes.editar(l)}><Pencil size={16} /></button>
          <button className="icone-btn icone-btn--perigo" title="Apagar" aria-label="Apagar" onClick={() => void acoes.apagar(l)}><Trash2 size={16} /></button>
        </span>
      )}
    </li>
  );
}

/* ---------------- Lançamentos do mês ---------------- */
function ListaLancamentos({ lancs, acoes }: { lancs: Lancamento[]; acoes: Acoes }) {
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<'todos' | TipoLanc>('todos');
  const [cat, setCat] = useState('');
  const termo = normalizar(busca.trim());
  const lista = lancs.filter((l) => (tipo === 'todos' || l.tipo === tipo) && (!cat || l.categoria === cat)
    && (!termo || normalizar(`${l.descricao} ${l.fornecedor ?? ''} ${l.categoria}`).includes(termo)));
  const cats = [...new Set(lancs.map((l) => l.categoria))].sort();
  const tot = lista.reduce((s, l) => s + (l.tipo === 'receita' ? 1 : -1) * num(l.valor), 0);
  return (
    <section className="card fin__lanc">
      <div className="fin__filtros">
        <label className="fin__busca"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar descrição ou fornecedor" /></label>
        <div className="rl-seg">
          {(['todos', 'despesa', 'receita'] as const).map((t) => <button key={t} className={cx(tipo === t && 'ativo')} onClick={() => setTipo(t)}>{t === 'todos' ? 'Todos' : t === 'despesa' ? 'Despesas' : 'Receitas'}</button>)}
        </div>
        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      {lista.length === 0 ? <Vazio icone={<Receipt size={30} />} titulo="Nenhum lançamento">Use “Lançar despesa” ou mande a foto do comprovante para o bot do WhatsApp.</Vazio> : (
        <>
          <ul className="fin__lista">{lista.map((l) => <LinhaLanc key={l.id} l={l} acoes={acoes} />)}</ul>
          <div className="fin__total"><span>{lista.length} lançamentos</span><b>{tot < 0 ? '−' : '+'} {brl(Math.abs(tot))}</b></div>
        </>
      )}
    </section>
  );
}

/* ---------------- Contas a pagar ---------------- */
function ContasPagar({ abertos, acoes }: { abertos: Lancamento[]; acoes: Acoes }) {
  const hoje = hojeISO();
  const semana = new Date(); semana.setDate(semana.getDate() + 7);
  const limSemana = `${semana.getFullYear()}-${String(semana.getMonth() + 1).padStart(2, '0')}-${String(semana.getDate()).padStart(2, '0')}`;
  const venc = (l: Lancamento) => l.vencimento ?? l.data;
  const grupos = [
    { titulo: 'Vencidas', classe: 'vencidas', itens: abertos.filter((l) => venc(l) < hoje) },
    { titulo: 'Vencem em até 7 dias', classe: 'semana', itens: abertos.filter((l) => venc(l) >= hoje && venc(l) <= limSemana) },
    { titulo: 'Mais para frente', classe: '', itens: abertos.filter((l) => venc(l) > limSemana) },
  ].filter((g) => g.itens.length);
  if (!abertos.length) return <Vazio icone={<Check size={30} />} titulo="Nenhuma conta a pagar">Tudo em dia! Contas fixas e salários aparecem aqui sozinhos todo mês.</Vazio>;
  return (
    <div className="fin__pagar">
      {grupos.map((g) => (
        <section key={g.titulo} className={cx('card fin__grupo', g.classe && `fin__grupo--${g.classe}`)}>
          <div className="fin__grupo-cab"><h2 className="card__titulo">{g.titulo}</h2><b>{brl(g.itens.reduce((s, l) => s + num(l.valor), 0))}</b></div>
          <ul className="fin__lista">{g.itens.map((l) => <LinhaLanc key={l.id} l={l} acoes={acoes} />)}</ul>
        </section>
      ))}
    </div>
  );
}

/* ---------------- Folha de pagamento ---------------- */
function Folha({ restauranteId, lim, lancs, aoMudar, aoLancar, acoes }: {
  restauranteId: string; lim: { ini: string; fim: string }; lancs: Lancamento[]; aoMudar: () => void; aoLancar: (l: Partial<Lancamento>) => void; acoes: Acoes;
}) {
  const toast = useToast();
  const [lista, setLista] = useState<Funcionario[] | null>(null);
  const [editando, setEditando] = useState<Funcionario | 'novo' | null>(null);
  const [pagando, setPagando] = useState<{ f: Funcionario; l: Lancamento; vales: number } | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('fin_funcionarios').select('*').eq('restaurante_id', restauranteId).order('ativo', { ascending: false }).order('nome');
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as Funcionario[]);
  }, [restauranteId, toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  const doMes = (f: Funcionario) => {
    const deles = lancs.filter((l) => l.funcionario_id === f.id);
    const salario = deles.find((l) => l.chave_auto?.startsWith('salario:')) ?? null;
    const vales = deles.filter((l) => !l.chave_auto).reduce((s, l) => s + num(l.valor), 0);
    return { salario, vales };
  };
  const totalFolha = (lista ?? []).filter((f) => f.ativo).reduce((s, f) => s + num(f.salario), 0);

  return (
    <section className="card fin__folha">
      <div className="fin__sec-cab">
        <div>
          <h2 className="card__titulo"><Users size={18} /> Folha de pagamento</h2>
          <p className="muted">O salário de cada funcionário entra sozinho em “Contas a pagar” todo mês, no dia do pagamento. Vales e adiantamentos são descontados na hora de pagar.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setEditando('novo')}><Plus size={17} /> Funcionário</button>
      </div>
      {!lista ? <Carregando /> : lista.length === 0 ? (
        <Vazio icone={<Users size={30} />} titulo="Nenhum funcionário cadastrado">Cadastre a equipe com o salário e o dia do pagamento.</Vazio>
      ) : (
        <>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Funcionário</th><th className="num">Salário</th><th className="num">Vales no mês</th><th className="num">A receber</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {lista.map((f) => {
                  const m = doMes(f);
                  const aReceber = Math.max(0, num(f.salario) - m.vales);
                  return (
                    <tr key={f.id} className={cx(!f.ativo && 'fin__inativo')}>
                      <td><b>{f.nome}</b><small className="muted fin__sub">{[f.cargo, `paga dia ${f.dia_pagamento}`, f.pix && `Pix: ${f.pix}`].filter(Boolean).join(' · ')}</small></td>
                      <td className="num">{brl(num(f.salario))}</td>
                      <td className="num">{m.vales ? `− ${brl(m.vales)}` : '—'}</td>
                      <td className="num"><b>{m.salario?.pago ? brl(num(m.salario.valor)) : brl(aReceber)}</b></td>
                      <td>{!f.ativo ? <span className="badge">Desligado</span> : m.salario?.pago ? <span className="badge badge--verde">Pago {dataBRCurta(m.salario.pago_em)}</span>
                        : m.salario ? <span className="badge badge--amarelo">A pagar {dataBRCurta(m.salario.vencimento)}</span> : <span className="muted">—</span>}</td>
                      <td className="num">
                        <div className="acoes-linha" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {f.ativo && <button className="btn btn--contorno btn--sm" onClick={() => aoLancar({ tipo: 'despesa', categoria: 'Folha de pagamento', descricao: `Vale · ${f.nome}`, funcionario_id: f.id })}><HandCoins size={15} /> Vale</button>}
                          {m.salario && !m.salario.pago && <button className="btn btn--sucesso btn--sm" onClick={() => setPagando({ f, l: m.salario!, vales: m.vales })}><Check size={15} /> Pagar</button>}
                          <button className="icone-btn" title="Editar" aria-label={`Editar ${f.nome}`} onClick={() => setEditando(f)}><Pencil size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="fin__total"><span>Folha mensal (ativos)</span><b>{brl(totalFolha)}</b></div>
        </>
      )}
      {editando && <ModalFuncionario restauranteId={restauranteId} f={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)}
        aoSalvar={() => { setEditando(null); void carregar(); aoMudar(); }} />}
      {pagando && (
        <Modal aberto aoFechar={() => setPagando(null)} titulo={`Pagar salário · ${pagando.f.nome}`} largura={440}
          rodape={<>
            <button className="btn btn--contorno" onClick={() => setPagando(null)}>Cancelar</button>
            <button className="btn btn--sucesso" onClick={() => { void acoes.pagar(pagando.l, Math.max(0, num(pagando.f.salario) - pagando.vales) || num(pagando.f.salario)); setPagando(null); }}>
              <Check size={16} /> Confirmar pagamento
            </button>
          </>}>
          <ul className="linhas-conta">
            <li><span>Salário</span><b>{brl(num(pagando.f.salario))}</b></li>
            <li><span>Vales e adiantamentos do mês</span><b>− {brl(pagando.vales)}</b></li>
            <li className="fin__total-linha"><span>Valor a pagar agora</span><b>{brl(Math.max(0, num(pagando.f.salario) - pagando.vales))}</b></li>
          </ul>
          {pagando.f.pix && <p className="muted">Pix: <b>{pagando.f.pix}</b></p>}
        </Modal>
      )}
      <p className="muted fin__nota">Mês de {lim.ini.slice(5, 7)}/{lim.ini.slice(0, 4)}. Mude o mês no topo para ver outros meses.</p>
    </section>
  );
}

function ModalFuncionario({ restauranteId, f, aoFechar, aoSalvar }: { restauranteId: string; f: Funcionario | null; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [d, setD] = useState({
    nome: f?.nome ?? '', cargo: f?.cargo ?? '', salario: f ? precoParaTexto(num(f.salario)) : '', dia: String(f?.dia_pagamento ?? 5),
    admissao: f?.admissao ?? '', telefone: f?.telefone ?? '', pix: f?.pix ?? '', ativo: f?.ativo ?? true,
  });
  const [ocupado, setOcupado] = useState(false);
  async function salvar() {
    const salario = d.salario.trim() ? lerPreco(d.salario) : 0;
    const dia = Number(d.dia);
    if (!Number.isFinite(salario) || salario < 0) return toast('Salário inválido.', 'erro');
    if (!(dia >= 1 && dia <= 31)) return toast('Dia do pagamento: de 1 a 31.', 'erro');
    setOcupado(true);
    const dados = { restaurante_id: restauranteId, nome: d.nome.trim(), cargo: d.cargo.trim() || null, salario, dia_pagamento: dia, admissao: d.admissao || null,
      telefone: d.telefone.trim() || null, pix: d.pix.trim() || null, ativo: d.ativo };
    const { error } = f ? await supabase.from('fin_funcionarios').update(dados).eq('id', f.id) : await supabase.from('fin_funcionarios').insert(dados);
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(f ? 'Funcionário atualizado.' : `${d.nome} cadastrado. O salário já entra nas contas a pagar.`, 'ok');
    aoSalvar();
  }
  async function remover() {
    if (!f || !(await confirmar(`Remover ${f.nome}? Os pagamentos já lançados continuam no histórico.`, { sim: 'Remover', perigo: true }))) return;
    const { error } = await supabase.from('fin_funcionarios').delete().eq('id', f.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }
  return (
    <Modal aberto aoFechar={aoFechar} titulo={f ? `Editar ${f.nome}` : 'Novo funcionário'} largura={520}
      rodape={<>
        {f && <button className="btn btn--fantasma fin__remover" onClick={() => void remover()}><Trash2 size={16} /> Remover</button>}
        <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
        <button className="btn btn--primario" disabled={ocupado || d.nome.trim().length < 2} onClick={() => void salvar()}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="form">
        <div className="form-linha">
          <Campo rotulo="Nome"><input className="input" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} autoFocus /></Campo>
          <Campo rotulo="Cargo"><input className="input" value={d.cargo} onChange={(e) => setD({ ...d, cargo: e.target.value })} placeholder="Ex.: Pizzaiolo" /></Campo>
        </div>
        <div className="form-linha">
          <Campo rotulo="Salário (R$)"><span className="input-icone"><b>R$</b><input className="input" inputMode="decimal" value={d.salario} onChange={(e) => setD({ ...d, salario: mascaraPreco(e.target.value) })} placeholder="0,00" /></span></Campo>
          <Campo rotulo="Dia do pagamento"><input className="input" inputMode="numeric" value={d.dia} onChange={(e) => setD({ ...d, dia: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Campo>
        </div>
        <div className="form-linha">
          <Campo rotulo="Chave Pix (opcional)"><input className="input" value={d.pix} onChange={(e) => setD({ ...d, pix: e.target.value })} /></Campo>
          <Campo rotulo="Admissão (opcional)"><input className="input" type="date" value={d.admissao} onChange={(e) => setD({ ...d, admissao: e.target.value })} /></Campo>
        </div>
        <Campo rotulo="Telefone (opcional)"><input className="input" inputMode="tel" value={d.telefone} onChange={(e) => setD({ ...d, telefone: e.target.value })} /></Campo>
        {f && <Switch marcado={d.ativo} aoMudar={(v) => setD({ ...d, ativo: v })}>Trabalha aqui (desligue quando sair: o salário para de ser lançado)</Switch>}
      </div>
    </Modal>
  );
}

/* ---------------- Contas fixas ---------------- */
function ContasFixas({ restauranteId, aoMudar }: { restauranteId: string; aoMudar: () => void }) {
  const toast = useToast();
  const [lista, setLista] = useState<ContaFixa[] | null>(null);
  const [editando, setEditando] = useState<ContaFixa | 'nova' | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('fin_contas_fixas').select('*').eq('restaurante_id', restauranteId).order('dia_vencimento');
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as ContaFixa[]);
  }, [restauranteId, toast]);
  useEffect(() => { void carregar(); }, [carregar]);
  const total = (lista ?? []).filter((c) => c.ativo).reduce((s, c) => s + num(c.valor), 0);
  return (
    <section className="card fin__fixas">
      <div className="fin__sec-cab">
        <div>
          <h2 className="card__titulo"><Repeat size={18} /> Contas fixas</h2>
          <p className="muted">Aluguel, luz, internet, contador… Cadastre uma vez: todo mês a conta aparece sozinha em “Contas a pagar” com o vencimento certo.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setEditando('nova')}><Plus size={17} /> Conta fixa</button>
      </div>
      {!lista ? <Carregando /> : lista.length === 0 ? (
        <Vazio icone={<Repeat size={30} />} titulo="Nenhuma conta fixa">Ex.: Aluguel R$ 3.000 todo dia 10.</Vazio>
      ) : (
        <>
          <ul className="fin__lista">
            {lista.map((c) => (
              <li key={c.id} className={cx('fin__linha', !c.ativo && 'fin__inativo')}>
                <span className="fin__linha-icone"><Repeat size={18} /></span>
                <button className="fin__linha-txt" onClick={() => setEditando(c)}><b>{c.descricao}</b><small>{c.categoria} · todo dia {c.dia_vencimento}{!c.ativo ? ' · pausada' : ''}</small></button>
                <strong className="fin__linha-valor">{brl(num(c.valor))}</strong>
                <span className="fin__linha-acoes"><button className="icone-btn" title="Editar" aria-label="Editar" onClick={() => setEditando(c)}><Pencil size={16} /></button></span>
              </li>
            ))}
          </ul>
          <div className="fin__total"><span>Total fixo por mês</span><b>{brl(total)}</b></div>
        </>
      )}
      {editando && <ModalFixa restauranteId={restauranteId} c={editando === 'nova' ? null : editando} aoFechar={() => setEditando(null)}
        aoSalvar={() => { setEditando(null); void carregar(); aoMudar(); }} />}
    </section>
  );
}

function ModalFixa({ restauranteId, c, aoFechar, aoSalvar }: { restauranteId: string; c: ContaFixa | null; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [d, setD] = useState({ descricao: c?.descricao ?? '', categoria: c?.categoria ?? 'Aluguel', valor: c ? precoParaTexto(num(c.valor)) : '', dia: String(c?.dia_vencimento ?? 10), ativo: c?.ativo ?? true });
  const [ocupado, setOcupado] = useState(false);
  async function salvar() {
    const valor = lerPreco(d.valor);
    const dia = Number(d.dia);
    if (!(valor > 0)) return toast('Informe o valor.', 'erro');
    if (!(dia >= 1 && dia <= 31)) return toast('Dia do vencimento: de 1 a 31.', 'erro');
    setOcupado(true);
    const dados = { restaurante_id: restauranteId, descricao: d.descricao.trim(), categoria: d.categoria, valor, dia_vencimento: dia, ativo: d.ativo };
    const { error } = c ? await supabase.from('fin_contas_fixas').update(dados).eq('id', c.id) : await supabase.from('fin_contas_fixas').insert(dados);
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(c ? 'Conta fixa atualizada.' : 'Conta fixa criada. Ela já aparece nas contas a pagar deste mês.', 'ok');
    aoSalvar();
  }
  async function remover() {
    if (!c || !(await confirmar(`Remover a conta fixa "${c.descricao}"? As contas já lançadas continuam.`, { sim: 'Remover', perigo: true }))) return;
    const { error } = await supabase.from('fin_contas_fixas').delete().eq('id', c.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }
  return (
    <Modal aberto aoFechar={aoFechar} titulo={c ? 'Editar conta fixa' : 'Nova conta fixa'} largura={480}
      rodape={<>
        {c && <button className="btn btn--fantasma fin__remover" onClick={() => void remover()}><Trash2 size={16} /> Remover</button>}
        <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
        <button className="btn btn--primario" disabled={ocupado || d.descricao.trim().length < 2} onClick={() => void salvar()}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="form">
        <Campo rotulo="Descrição"><input className="input" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} placeholder="Ex.: Aluguel do salão" autoFocus /></Campo>
        <Campo rotulo="Categoria">
          <select className="select" value={d.categoria} onChange={(e) => setD({ ...d, categoria: e.target.value })}>
            {CATEGORIAS_DESPESA.filter((x) => x !== 'Folha de pagamento').map((x) => <option key={x}>{x}</option>)}
          </select>
        </Campo>
        <div className="form-linha">
          <Campo rotulo="Valor por mês (R$)"><span className="input-icone"><b>R$</b><input className="input" inputMode="decimal" value={d.valor} onChange={(e) => setD({ ...d, valor: mascaraPreco(e.target.value) })} placeholder="0,00" /></span></Campo>
          <Campo rotulo="Vence todo dia"><input className="input" inputMode="numeric" value={d.dia} onChange={(e) => setD({ ...d, dia: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Campo>
        </div>
        {c && <Switch marcado={d.ativo} aoMudar={(v) => setD({ ...d, ativo: v })}>Conta ativa (desligue para parar de lançar)</Switch>}
      </div>
    </Modal>
  );
}

/* ---------------- Lançar / editar despesa ou receita ---------------- */
function ModalLancamento({ restauranteId, inicial, aoFechar, aoSalvar }: { restauranteId: string; inicial: Partial<Lancamento>; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const editando = !!inicial.id;
  const [tipo, setTipo] = useState<TipoLanc>(inicial.tipo ?? 'despesa');
  const [d, setD] = useState({
    descricao: inicial.descricao ?? '', valor: inicial.valor ? precoParaTexto(num(inicial.valor)) : '',
    categoria: inicial.categoria ?? (inicial.tipo === 'receita' ? CATEGORIAS_RECEITA[0] : 'Mercadorias e insumos'),
    data: inicial.data ?? hojeISO(), pago: inicial.pago ?? true, vencimento: inicial.vencimento ?? hojeISO(),
    forma: inicial.forma ?? 'pix', fornecedor: inicial.fornecedor ?? '', observacao: inicial.observacao ?? '',
  });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [comprovante, setComprovante] = useState(inicial.comprovante_path ?? null);
  const [ocupado, setOcupado] = useState(false);
  const inputArq = useRef<HTMLInputElement>(null);
  const cats = tipo === 'despesa' ? CATEGORIAS_DESPESA : CATEGORIAS_RECEITA;
  const valor = lerPreco(d.valor);

  async function salvar() {
    if (!(valor > 0)) return toast('Informe o valor.', 'erro');
    if (!d.descricao.trim()) return toast('Diga o que foi (descrição).', 'erro');
    setOcupado(true);
    try {
      let caminho = comprovante;
      if (arquivo) caminho = await enviarComprovante(restauranteId, arquivo);
      const dados = {
        restaurante_id: restauranteId, tipo, categoria: d.categoria, descricao: d.descricao.trim(), valor, data: d.data,
        pago: d.pago, pago_em: d.pago ? (inicial.pago && inicial.pago_em ? inicial.pago_em : d.data) : null,
        vencimento: d.pago ? null : d.vencimento, forma: d.pago ? d.forma : null, fornecedor: d.fornecedor.trim() || null,
        observacao: d.observacao.trim() || null, comprovante_path: caminho, funcionario_id: inicial.funcionario_id ?? null,
      };
      const { error } = editando
        ? await supabase.from('fin_lancamentos').update(dados).eq('id', inicial.id!)
        : await supabase.from('fin_lancamentos').insert(dados);
      if (error) throw error;
      toast(editando ? 'Lançamento atualizado.' : `${tipo === 'despesa' ? 'Despesa' : 'Receita'} de ${brl(valor)} lançada.`, 'ok');
      aoSalvar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={editando ? 'Editar lançamento' : tipo === 'despesa' ? 'Lançar despesa' : 'Lançar receita'} largura={560}
      rodape={<>
        <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
        <button className="btn btn--primario" disabled={ocupado} onClick={() => void salvar()}>{ocupado ? 'Salvando…' : editando ? 'Salvar' : `Lançar${valor > 0 ? ` ${brl(valor)}` : ''}`}</button>
      </>}>
      <div className="form fin__form">
        {!editando && !inicial.funcionario_id && (
          <div className="segmentado">
            <button type="button" className={cx(tipo === 'despesa' && 'ativo')} onClick={() => { setTipo('despesa'); setD({ ...d, categoria: 'Mercadorias e insumos' }); }}><ArrowUpCircle size={16} /> Despesa (saiu)</button>
            <button type="button" className={cx(tipo === 'receita' && 'ativo')} onClick={() => { setTipo('receita'); setD({ ...d, categoria: CATEGORIAS_RECEITA[0] }); }}><ArrowDownCircle size={16} /> Receita (entrou)</button>
          </div>
        )}
        <div className="form-linha fin__form-topo">
          <Campo rotulo="O que foi"><input className="input" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} placeholder={tipo === 'despesa' ? 'Ex.: Compra de queijo e calabresa' : 'Ex.: Evento particular'} autoFocus /></Campo>
          <Campo rotulo="Valor (R$)"><span className="input-icone"><b>R$</b><input className="input input--grande" inputMode="decimal" value={d.valor} onChange={(e) => setD({ ...d, valor: mascaraPreco(e.target.value) })} placeholder="0,00" /></span></Campo>
        </div>
        <Campo rotulo="Categoria">
          <div className="fin__chips">
            {cats.map((c) => <button key={c} type="button" className={cx('fin__chip', d.categoria === c && 'ativo')} onClick={() => setD({ ...d, categoria: c })}>{c}</button>)}
          </div>
        </Campo>
        <div className="form-linha">
          <Campo rotulo={tipo === 'despesa' ? 'Data da compra' : 'Data'}><input className="input" type="date" value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} /></Campo>
          {tipo === 'despesa' && <Campo rotulo="Fornecedor (opcional)"><input className="input" value={d.fornecedor} onChange={(e) => setD({ ...d, fornecedor: e.target.value })} placeholder="Ex.: Atacadão" /></Campo>}
        </div>
        {tipo === 'despesa' && <Switch marcado={d.pago} aoMudar={(v) => setD({ ...d, pago: v })}>Já foi pago</Switch>}
        {d.pago ? (
          <Campo rotulo="Pago com">
            <div className="fin__chips">
              {FORMAS_FIN.map((f) => <button key={f.id} type="button" className={cx('fin__chip', d.forma === f.id && 'ativo')} onClick={() => setD({ ...d, forma: f.id })}>{f.rotulo}</button>)}
            </div>
          </Campo>
        ) : (
          <Campo rotulo="Vencimento"><input className="input" type="date" value={d.vencimento} onChange={(e) => setD({ ...d, vencimento: e.target.value })} /></Campo>
        )}
        <Campo rotulo="Comprovante (foto da nota ou recibo)">
          <div className="fin__comprovante">
            <input ref={inputArq} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setArquivo(f); e.target.value = ''; }} />
            {arquivo || comprovante ? (
              <span className="fin__arquivo"><FileText size={16} /> {arquivo?.name ?? 'Comprovante anexado'}
                {!arquivo && comprovante && <button type="button" className="btn btn--fantasma btn--sm" onClick={() => void linkComprovante(comprovante).then((u) => window.open(u, '_blank', 'noopener'))}>Ver</button>}
                <button type="button" className="icone-btn" aria-label="Tirar comprovante" onClick={() => { setArquivo(null); setComprovante(null); }}><X size={15} /></button>
              </span>
            ) : (
              <button type="button" className="btn btn--contorno" onClick={() => inputArq.current?.click()}><ImagePlus size={16} /> Anexar foto ou PDF</button>
            )}
          </div>
        </Campo>
        <Campo rotulo="Observação (opcional)"><input className="input" value={d.observacao} onChange={(e) => setD({ ...d, observacao: e.target.value })} maxLength={300} /></Campo>
        {inicial.itens && inicial.itens.length > 0 && (
          <div className="fin__itens">
            <small className="muted">Itens lidos do comprovante</small>
            <ul>{inicial.itens.map((i, n) => <li key={n}><span>{i.qtd ? `${i.qtd}× ` : ''}{i.nome}</span>{i.valor != null && <b>{brl(num(i.valor))}</b>}</li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

