import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowDownCircle, ArrowUpCircle, Banknote, History, KeyRound, Lock, Pencil, Plus, Printer, Trash2, UserRound, Users, Wallet,
} from 'lucide-react';
import { Campo, Switch, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { confirmar } from '../../componentes/Confirmar';
import { imprimirFechamento, imprimirMovimentoCaixa } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { ResumoCaixa } from '../../lib/tipos';
import { FORMAS, brl, cx, duracao, hora, lerPreco, mascaraPreco } from '../../lib/util';
import { IconeForma } from '../../componentes/Pagamento';
import { usePainel } from './Painel';
import { ResumoView } from './Caixa';

/* =====================================================================
   Gestão de caixas (dono e gerente): caixa atual, histórico de todos os
   caixas, sangrias/reforços e os operadores (usuário e senha).
   ===================================================================== */

type Aba = 'atual' | 'historico' | 'movimentos' | 'operadores';
type Periodo = 'hoje' | '7d' | 'mes' | 'mes-passado' | '90d';

interface CaixaLinha {
  id: string; aberto_em: string; fechado_em: string | null; operador_nome: string | null; fechado_por_nome: string | null;
  valor_inicial: number; valor_contado: number | null; observacao: string | null;
  recebido: number; dinheiro: number; retiradas: number; suprimentos: number; diferenca: number | null;
}
interface MovLinha { id: string; caixa_id: string; tipo: 'retirada' | 'suprimento'; valor: number; motivo: string | null; quem: string | null; criado_em: string }
interface Relatorio { caixas: CaixaLinha[]; movimentos: MovLinha[]; por_forma: Record<string, number> }
interface Operador { id: string; nome: string; usuario: string; ativo: boolean; criado_em: string; ultimo_acesso: string | null }

const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' }, { id: '7d', rotulo: '7 dias' }, { id: 'mes', rotulo: 'Este mês' }, { id: 'mes-passado', rotulo: 'Mês passado' }, { id: '90d', rotulo: '90 dias' },
];

function intervalo(p: Periodo) {
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  let fim = new Date(ini); fim.setDate(fim.getDate() + 1);
  if (p === '7d') ini.setDate(ini.getDate() - 6);
  if (p === '90d') ini.setDate(ini.getDate() - 89);
  if (p === 'mes') ini.setDate(1);
  if (p === 'mes-passado') { ini.setDate(1); fim = new Date(ini); ini.setMonth(ini.getMonth() - 1); }
  return { inicio: ini.toISOString(), fim: fim.toISOString() };
}
const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
const num = (v: unknown) => Number(v ?? 0);

export default function GestaoCaixas() {
  const { restaurante: r, caixa, recarregarCaixa, abrirCaixa, abrirCaixaModo } = usePainel();
  const [params, setParams] = useSearchParams();
  const aba = (params.get('aba') as Aba) || 'atual';
  const irAba = (a: Aba) => setParams(a === 'atual' ? {} : { aba: a }, { replace: true });
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [detalhe, setDetalhe] = useState<CaixaLinha | null>(null);
  const toast = useToast();

  const carregar = useCallback(async () => {
    const { inicio, fim } = intervalo(periodo);
    const { data, error } = await supabase.rpc('caixas_relatorio', { p_rest: r.id, p_inicio: inicio, p_fim: fim });
    if (error) { toast(msgErro(error), 'erro'); return; }
    setRel(data as Relatorio);
  }, [r.id, periodo, toast]);
  useEffect(() => { setRel(null); void carregar(); }, [carregar]);
  // Caixa mudou (sangria, fechamento): atualiza o relatório
  useEffect(() => { void carregar(); }, [caixa?.recebido, caixa?.retiradas, caixa?.suprimentos, caixa?.caixa_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = useMemo(() => {
    const cx2 = rel?.caixas ?? [];
    const dif = cx2.reduce((s, c) => s + (c.diferenca ?? 0), 0);
    return {
      qtd: cx2.length,
      recebido: cx2.reduce((s, c) => s + num(c.recebido), 0),
      retiradas: cx2.reduce((s, c) => s + num(c.retiradas), 0),
      faltas: cx2.filter((c) => (c.diferenca ?? 0) < -0.004).length,
      dif,
    };
  }, [rel]);

  return (
    <div className="pagina gcx">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Gestão de caixas</h1>
          <p>Todos os caixas, quem operou cada um, fechamentos, sangrias e diferenças. Só você e o gerente veem esta tela.</p>
        </div>
        <div className="rl-seg" role="tablist" aria-label="Período">
          {PERIODOS.map((p) => <button key={p.id} className={cx(periodo === p.id && 'ativo')} onClick={() => setPeriodo(p.id)}>{p.rotulo}</button>)}
        </div>
      </div>

      <div className="kpis gcx__kpis">
        <div className="kpi"><span>Caixas no período</span><strong>{rel ? k.qtd : '—'}</strong></div>
        <div className="kpi"><span>Recebido nos caixas</span><strong>{rel ? brl(k.recebido) : '—'}</strong></div>
        <div className="kpi"><span>Sangrias (retiradas)</span><strong>{rel ? brl(k.retiradas) : '—'}</strong></div>
        <div className={cx('kpi', rel && k.dif < -0.004 && 'kpi--perigo')}>
          <span>Diferença no dinheiro</span>
          <strong>{rel ? (Math.abs(k.dif) < 0.005 ? 'Tudo certo' : `${k.dif > 0 ? '+' : '−'} ${brl(Math.abs(k.dif))}`) : '—'}</strong>
          {rel && k.faltas > 0 && <small className="gcx__kpi-nota">{k.faltas} {k.faltas === 1 ? 'caixa fechou' : 'caixas fecharam'} com falta</small>}
        </div>
      </div>

      <nav className="rl-abas" role="tablist">
        <button role="tab" aria-selected={aba === 'atual'} className={cx(aba === 'atual' && 'ativo')} onClick={() => irAba('atual')}><Wallet size={16} /> Caixa atual</button>
        <button role="tab" aria-selected={aba === 'historico'} className={cx(aba === 'historico' && 'ativo')} onClick={() => irAba('historico')}><History size={16} /> Fechamentos</button>
        <button role="tab" aria-selected={aba === 'movimentos'} className={cx(aba === 'movimentos' && 'ativo')} onClick={() => irAba('movimentos')}><Banknote size={16} /> Sangrias e reforços</button>
        <button role="tab" aria-selected={aba === 'operadores'} className={cx(aba === 'operadores' && 'ativo')} onClick={() => irAba('operadores')}><Users size={16} /> Operadores</button>
      </nav>

      {aba === 'atual' && (
        caixa === undefined ? <Carregando /> : !caixa ? (
          <section className="card gcx__fechado">
            <Wallet size={30} />
            <div><strong>Nenhum caixa aberto agora</strong><span>O caixa é aberto com o usuário e a senha do operador.</span></div>
            <button className="btn btn--sucesso" onClick={abrirCaixa}>Abrir caixa</button>
          </section>
        ) : (
          <CaixaAtual c={caixa} restaurante={r} aoMudar={() => { recarregarCaixa(); void carregar(); }} aoFechar={() => abrirCaixaModo('fechar')} />
        )
      )}

      {aba === 'historico' && (
        !rel ? <Carregando /> : rel.caixas.length === 0 ? (
          <Vazio icone={<History size={32} />} titulo="Nenhum caixa neste período" />
        ) : (
          <section className="card gcx__tabela">
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr><th>Dia</th><th>Operador</th><th>Horário</th><th className="num">Troco inicial</th><th className="num">Recebido</th><th className="num">Sangrias</th><th className="num">Contado</th><th>Conferência</th><th /></tr></thead>
                <tbody>
                  {rel.caixas.map((c) => (
                    <tr key={c.id} className="linha-clicavel" onClick={() => setDetalhe(c)}>
                      <td><b>{dataCurta(c.aberto_em)}</b></td>
                      <td>{c.operador_nome ?? '—'}{c.fechado_por_nome && c.fechado_em && c.fechado_por_nome !== c.operador_nome && <small className="muted gcx__sub">fechou: {c.fechado_por_nome}</small>}</td>
                      <td className="muted">{hora(c.aberto_em)} → {c.fechado_em ? hora(c.fechado_em) : <span className="badge badge--verde">aberto</span>}</td>
                      <td className="num">{brl(num(c.valor_inicial))}</td>
                      <td className="num"><b>{brl(num(c.recebido))}</b></td>
                      <td className="num">{num(c.retiradas) ? brl(num(c.retiradas)) : '—'}</td>
                      <td className="num">{c.valor_contado != null ? brl(num(c.valor_contado)) : '—'}</td>
                      <td><Diferenca d={c.fechado_em ? c.diferenca : undefined} /></td>
                      <td className="num"><button className="btn btn--fantasma btn--sm">Ver</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.keys(rel.por_forma).length > 0 && (
              <div className="gcx__formas">
                <span className="muted">Recebido por forma no período:</span>
                {FORMAS.filter((f) => rel.por_forma[f.id]).map((f) => (
                  <span key={f.id} className="gcx__forma"><IconeForma forma={f.id} tamanho={14} /> {f.rotulo} <b>{brl(num(rel.por_forma[f.id]))}</b></span>
                ))}
              </div>
            )}
          </section>
        )
      )}

      {aba === 'movimentos' && (
        !rel ? <Carregando /> : rel.movimentos.length === 0 ? (
          <Vazio icone={<Banknote size={32} />} titulo="Nenhuma sangria ou reforço neste período" />
        ) : (
          <section className="card gcx__tabela">
            <div className="tabela-wrap">
              <table className="tabela">
                <thead><tr><th>Quando</th><th>Tipo</th><th>Motivo</th><th>Quem</th><th className="num">Valor</th><th /></tr></thead>
                <tbody>
                  {rel.movimentos.map((m) => (
                    <tr key={m.id}>
                      <td><b>{dataCurta(m.criado_em)}</b> <span className="muted">{hora(m.criado_em)}</span></td>
                      <td>{m.tipo === 'retirada'
                        ? <span className="gcx__mov gcx__mov--saida"><ArrowUpCircle size={15} /> Sangria</span>
                        : <span className="gcx__mov gcx__mov--entrada"><ArrowDownCircle size={15} /> Reforço de troco</span>}</td>
                      <td>{m.motivo ?? <span className="muted">—</span>}</td>
                      <td className="muted">{m.quem ?? '—'}</td>
                      <td className="num"><b className={m.tipo === 'retirada' ? 'mov--saida' : 'mov--entrada'}>{m.tipo === 'retirada' ? '−' : '+'} {brl(num(m.valor))}</b></td>
                      <td className="num">
                        <button className="icone-btn" title="Imprimir comprovante" aria-label="Imprimir comprovante"
                          onClick={() => imprimirMovimentoCaixa({ ...m, user_nome: m.quem }, r.nome, NaN)}><Printer size={17} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      )}

      {aba === 'operadores' && <Operadores restauranteId={r.id} caixas={rel?.caixas ?? null} />}

      {detalhe && <DetalheCaixa c={detalhe} restaurante={r.nome} aoFechar={() => setDetalhe(null)} />}
    </div>
  );
}

function Diferenca({ d }: { d: number | null | undefined }) {
  if (d === undefined) return <span className="muted">—</span>;
  if (d === null) return <span className="badge">Sem contagem</span>;
  if (Math.abs(d) < 0.005) return <span className="badge badge--verde">Confere</span>;
  return <span className={cx('badge', d > 0 ? 'badge--azul' : 'badge--vermelho')}>{d > 0 ? 'Sobra' : 'Falta'} {brl(Math.abs(d))}</span>;
}

/* ---------------- Caixa aberto agora ---------------- */
function CaixaAtual({ c, restaurante, aoMudar, aoFechar }: { c: ResumoCaixa; restaurante: { id: string; nome: string }; aoMudar: () => void; aoFechar: () => void }) {
  const toast = useToast();
  const [mov, setMov] = useState<'retirada' | 'suprimento' | null>(null);
  const [valor, setValor] = useState('');
  const [motivo, setMotivo] = useState('');
  const [imprimir, setImprimir] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const v = valor.trim() ? lerPreco(valor) : NaN;

  async function registrar() {
    if (!mov || !Number.isFinite(v) || v <= 0) return toast('Informe o valor.', 'erro');
    setOcupado(true);
    const { data, error } = await supabase.rpc('caixa_movimentar', { p_caixa: c.caixa_id, p_tipo: mov, p_valor: v, p_motivo: motivo });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    const novo = data as ResumoCaixa;
    const m = novo.movimentos?.[novo.movimentos.length - 1];
    if (imprimir && m) imprimirMovimentoCaixa(m, restaurante.nome, Number(novo.dinheiro_esperado));
    toast(`${mov === 'retirada' ? 'Sangria' : 'Reforço'} de ${brl(v)} registrado. Na gaveta: ${brl(Number(novo.dinheiro_esperado))}.`, 'ok');
    setMov(null); setValor(''); setMotivo('');
    aoMudar();
  }

  return (
    <div className="gcx__atual">
      <section className="card gcx__aberto">
        <div className="gcx__aberto-topo">
          <span className="gcx__aberto-icone"><UserRound size={22} /></span>
          <div>
            <small>Operador do caixa</small>
            <strong>{c.aberto_por_nome ?? '—'}</strong>
            <span>Aberto há {duracao(c.aberto_em)} · desde {hora(c.aberto_em)} · troco inicial {brl(Number(c.valor_inicial))}</span>
          </div>
          <span className="badge badge--verde">Aberto</span>
        </div>
        <div className="caixa">
          <ResumoView r={c} />
        </div>
        <div className="acoes-linha gcx__acoes">
          <button className="btn btn--contorno" onClick={() => imprimirFechamento(c, restaurante.nome, true)}><Printer size={17} /> Imprimir parcial</button>
          <button className="btn btn--contorno" onClick={() => setMov('retirada')}><ArrowUpCircle size={17} /> Sangria</button>
          <button className="btn btn--contorno" onClick={() => setMov('suprimento')}><ArrowDownCircle size={17} /> Reforço de troco</button>
          <button className="btn btn--primario" onClick={aoFechar}><Lock size={17} /> Fechar caixa</button>
        </div>
      </section>

      {mov && (
        <Modal aberto aoFechar={() => setMov(null)} titulo={mov === 'retirada' ? 'Sangria (retirada de dinheiro)' : 'Reforço de troco'} largura={480}
          rodape={<>
            <button className="btn btn--contorno" onClick={() => setMov(null)}>Cancelar</button>
            <button className="btn btn--primario" disabled={ocupado || !Number.isFinite(v) || v <= 0} onClick={() => void registrar()}>{ocupado ? 'Registrando…' : 'Registrar'}</button>
          </>}>
          <div className="form">
            <p className="muted" style={{ margin: 0 }}>Dinheiro esperado na gaveta agora: <b>{brl(Number(c.dinheiro_esperado))}</b>.</p>
            <Campo rotulo="Valor (R$)"><input className="input input--grande" inputMode="decimal" placeholder="0,00" value={valor} onChange={(e) => setValor(mascaraPreco(e.target.value))} autoFocus onKeyDown={(e) => e.key === 'Enter' && void registrar()} /></Campo>
            <Campo rotulo="Motivo (opcional)"><input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} placeholder={mov === 'retirada' ? 'Ex.: depósito, pagamento de fornecedor' : 'Ex.: troco extra'} /></Campo>
            <Switch marcado={imprimir} aoMudar={setImprimir}>Imprimir comprovante com espaço para assinatura</Switch>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- Detalhe de um caixa ---------------- */
function DetalheCaixa({ c, restaurante, aoFechar }: { c: CaixaLinha; restaurante: string; aoFechar: () => void }) {
  const [r, setR] = useState<ResumoCaixa | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('caixas').select('resumo').eq('id', c.id).single();
      const salvo = (data as { resumo: ResumoCaixa | null } | null)?.resumo;
      if (salvo) return setR(salvo);
      const x = await supabase.rpc('caixa_resumo', { p_caixa: c.id, p_ate: new Date().toISOString() });
      if (x.error) setErro(msgErro(x.error)); else setR(x.data as ResumoCaixa);
    })();
  }, [c.id]);
  return (
    <Modal aberto aoFechar={aoFechar} titulo={`Caixa de ${dataCurta(c.aberto_em)} · ${c.operador_nome ?? ''}`} largura={640}
      rodape={r ? <>
        <button className="btn btn--contorno" onClick={aoFechar}>Fechar</button>
        <button className="btn btn--primario" onClick={() => imprimirFechamento(r, restaurante, !c.fechado_em)}><Printer size={17} /> Imprimir</button>
      </> : undefined}>
      {erro ? <p className="erro-form">{erro}</p> : !r ? <Carregando /> : (
        <div className="caixa">
          <div className="gcx__det-linha">
            <div><small>Abertura</small><b>{new Date(c.aberto_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</b><span>{c.operador_nome ?? '—'}</span></div>
            <div><small>Fechamento</small><b>{c.fechado_em ? new Date(c.fechado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Ainda aberto'}</b><span>{c.fechado_por_nome ?? '—'}</span></div>
            <div><small>Conferência</small><b><Diferenca d={c.fechado_em ? c.diferenca : undefined} /></b><span>{c.valor_contado != null ? `contado ${brl(num(c.valor_contado))}` : ''}</span></div>
          </div>
          <ResumoView r={r} />
          {c.observacao && <p className="caixa__alerta">Obs.: {c.observacao}</p>}
        </div>
      )}
    </Modal>
  );
}

/* ---------------- Operadores de caixa ---------------- */
function Operadores({ restauranteId, caixas }: { restauranteId: string; caixas: CaixaLinha[] | null }) {
  const toast = useToast();
  const [lista, setLista] = useState<Operador[] | null>(null);
  const [editando, setEditando] = useState<Operador | 'novo' | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('caixa_operadores').select('id, nome, usuario, ativo, criado_em, ultimo_acesso').eq('restaurante_id', restauranteId).order('nome');
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as Operador[]);
  }, [restauranteId, toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  const stats = useMemo(() => {
    const m = new Map<string, { caixas: number; recebido: number; dif: number }>();
    for (const c of caixas ?? []) {
      const k = c.operador_nome ?? '';
      const x = m.get(k) ?? { caixas: 0, recebido: 0, dif: 0 };
      x.caixas++; x.recebido += num(c.recebido); x.dif += c.diferenca ?? 0;
      m.set(k, x);
    }
    return m;
  }, [caixas]);

  async function remover(o: Operador) {
    if (!(await confirmar(`Remover o operador ${o.nome}?\n\nSe ele já abriu algum caixa, fica só desativado (o histórico continua).`, { sim: 'Remover', perigo: true }))) return;
    const { error } = await supabase.rpc('caixa_operador_remover', { p_id: o.id });
    if (error) return toast(msgErro(error), 'erro');
    toast(`${o.nome} removido.`, 'ok');
    void carregar();
  }

  return (
    <section className="card gcx__ops">
      <div className="gcx__ops-cab">
        <div>
          <h2 className="card__titulo"><KeyRound size={18} /> Operadores de caixa</h2>
          <p className="muted">Quem pode abrir e fechar o caixa. Cada um tem usuário e senha próprios, e todo caixa fica no nome de quem abriu.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setEditando('novo')}><Plus size={17} /> Novo operador</button>
      </div>
      {!lista ? <Carregando /> : lista.length === 0 ? (
        <Vazio icone={<UserRound size={32} />} titulo="Nenhum operador cadastrado">Cadastre quem trabalha no caixa. A partir do primeiro, abrir e fechar o caixa pede usuário e senha.</Vazio>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Operador</th><th>Usuário</th><th>Situação</th><th className="num">Caixas no período</th><th className="num">Recebido</th><th>Diferenças</th><th /></tr></thead>
            <tbody>
              {lista.map((o) => {
                const s = stats.get(o.nome);
                return (
                  <tr key={o.id}>
                    <td><b>{o.nome}</b>{o.ultimo_acesso && <small className="muted gcx__sub">último acesso {dataCurta(o.ultimo_acesso)} {hora(o.ultimo_acesso)}</small>}</td>
                    <td><code className="gcx__usuario">{o.usuario}</code></td>
                    <td>{o.ativo ? <span className="badge badge--verde">Ativo</span> : <span className="badge">Desativado</span>}</td>
                    <td className="num">{s?.caixas ?? 0}</td>
                    <td className="num">{brl(s?.recebido ?? 0)}</td>
                    <td><Diferenca d={s ? s.dif : undefined} /></td>
                    <td className="num">
                      <div className="acoes-linha" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button className="icone-btn" title="Editar / nova senha" aria-label={`Editar ${o.nome}`} onClick={() => setEditando(o)}><Pencil size={17} /></button>
                        <button className="icone-btn icone-btn--perigo" title="Remover" aria-label={`Remover ${o.nome}`} onClick={() => void remover(o)}><Trash2 size={17} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editando && <ModalOperador restauranteId={restauranteId} op={editando === 'novo' ? null : editando} aoFechar={() => setEditando(null)} aoSalvar={() => { setEditando(null); void carregar(); }} />}
    </section>
  );
}

function ModalOperador({ restauranteId, op, aoFechar, aoSalvar }: { restauranteId: string; op: Operador | null; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [nome, setNome] = useState(op?.nome ?? '');
  const [usuario, setUsuario] = useState(op?.usuario ?? '');
  const [senha, setSenha] = useState('');
  const [ativo, setAtivo] = useState(op?.ativo ?? true);
  const [ocupado, setOcupado] = useState(false);
  // Sugere o usuário a partir do primeiro nome
  const sugerir = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '') ?? '';

  async function salvar() {
    setOcupado(true);
    const { error } = await supabase.rpc('caixa_operador_salvar', { p_rest: restauranteId, p_id: op?.id ?? null, p_nome: nome, p_usuario: usuario, p_senha: senha, p_ativo: ativo });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(op ? 'Operador atualizado.' : `${nome} cadastrado. Usuário: ${usuario}.`, 'ok');
    aoSalvar();
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={op ? `Editar ${op.nome}` : 'Novo operador de caixa'} largura={480}
      rodape={<>
        <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
        <button className="btn btn--primario" disabled={ocupado || nome.trim().length < 2 || usuario.length < 3 || (!op && senha.length < 4)} onClick={() => void salvar()}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
      </>}>
      <div className="form">
        <Campo rotulo="Nome"><input className="input" value={nome} maxLength={60} autoFocus placeholder="Ex.: Maria Souza"
          onChange={(e) => { const n = e.target.value; if (!op && (!usuario || usuario === sugerir(nome))) setUsuario(sugerir(n)); setNome(n); }} /></Campo>
        <Campo rotulo="Usuário (para entrar no caixa)" dica="Letras e números, sem espaço. Ex.: maria">
          <input className="input" value={usuario} maxLength={30} autoCapitalize="none" onChange={(e) => setUsuario(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))} />
        </Campo>
        <Campo rotulo={op ? 'Nova senha (deixe em branco para manter)' : 'Senha'} dica="Mínimo 4 caracteres. Só o operador deve saber.">
          <input className="input" type="password" value={senha} autoComplete="new-password" onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        {op && <Switch marcado={ativo} aoMudar={setAtivo}>Operador ativo (pode abrir e fechar caixa)</Switch>}
      </div>
    </Modal>
  );
}

