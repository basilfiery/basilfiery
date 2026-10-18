import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Check, CheckCheck, CircleAlert, Clock, Flame, KeyRound, MessageCircle, Plus, Printer, RefreshCw, RotateCcw, ShoppingCart, Smartphone, Trash2, UserCheck, UserPlus, UserX, Users, X,
} from 'lucide-react';
import { Switch } from '../../componentes/Basicos';
import { confirmar } from '../../componentes/Confirmar';
import { LinkCopiavel, QrCartao } from '../../componentes/Link';
import { useToast } from '../../componentes/Toast';
import { imprimirLista } from '../../lib/impressao';
import { useSessao } from '../../lib/sessao';
import { msgErro, supabase } from '../../lib/supabase';
import { cx, ehGestor, podeCaixa, tempoDesde, useAgora } from '../../lib/util';
import { usePainel } from './Painel';

/* =====================================================================
   Lista de compras: a equipe (cozinha, bar, limpeza…) pede o que precisa
   repor pelo link próprio; o dono vê tudo junto e vai marcando o que comprou.
   ===================================================================== */

export interface ItemCompra {
  id: string; restaurante_id: string; nome: string; quantidade: string | null; obs: string | null; setor: string | null;
  urgente: boolean; pessoa_id: string | null; pedido_por: string | null; pedido_tel?: string | null; status: 'pendente' | 'comprado';
  criado_em: string; comprado_em: string | null; comprado_por: string | null;
}
interface PessoaCompra {
  id: string; nome: string; setor: string; status: 'pendente' | 'ativo' | 'bloqueado'; criado_em: string; ultimo_acesso: string | null;
  telefone: string | null; login: string | null;
}
const SETORES = ['Cozinha', 'Bar', 'Salão', 'Caixa', 'Limpeza', 'Entregas', 'Outro'];
const telFmt = (t: string) => t.replace(/^(\d{2})(\d+)(\d{4})$/, '($1) $2-$3');
const zap = (t: string) => `https://wa.me/${t.length <= 11 ? `55${t}` : t}`;
const senhaNova = () => String(Math.floor(100000 + Math.random() * 900000));
const usuarioDe = (nome: string) => nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().split(/\s+/).slice(0, 2).join('.').replace(/[^a-z0-9.]/g, '').slice(0, 30);

type Aba = 'comprar' | 'comprados' | 'equipe';
export const linkColaboradores = (codigo: string) => `${window.location.origin}/colaboradores/${codigo}`;
export const linkListaCompras = linkColaboradores;

export default function Compras() {
  const { restaurante: r, papel } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const agora = useAgora(60000);
  const gestor = ehGestor(papel);
  const podeMarcar = podeCaixa(papel);
  const [aba, setAba] = useState<Aba>(() => (new URLSearchParams(window.location.search).get('aba') === 'equipe' ? 'equipe' : 'comprar'));
  const [itens, setItens] = useState<ItemCompra[] | null>(null);
  const [comprados, setComprados] = useState<ItemCompra[]>([]);
  const [pessoas, setPessoas] = useState<PessoaCompra[]>([]);
  const [setor, setSetor] = useState('');
  const [novo, setNovo] = useState({ nome: '', quantidade: '', urgente: false });

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 30 * 864e5).toISOString();
    const [a, b, c] = await Promise.all([
      supabase.from('compras_itens').select('*').eq('restaurante_id', r.id).eq('status', 'pendente').order('criado_em', { ascending: false }),
      supabase.from('compras_itens').select('*').eq('restaurante_id', r.id).eq('status', 'comprado').gte('comprado_em', desde).order('comprado_em', { ascending: false }).limit(300),
      gestor ? supabase.from('compras_pessoas').select('id, nome, setor, status, criado_em, ultimo_acesso, telefone, login').eq('restaurante_id', r.id).order('criado_em') : Promise.resolve({ data: [] }),
    ]);
    setItens((a.data ?? []) as ItemCompra[]);
    setComprados((b.data ?? []) as ItemCompra[]);
    setPessoas((c.data ?? []) as PessoaCompra[]);
  }, [r.id, gestor]);

  useEffect(() => {
    void carregar();
    const canal = supabase.channel(`compras-pag-${r.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_itens', filter: `restaurante_id=eq.${r.id}` }, () => void carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_pessoas', filter: `restaurante_id=eq.${r.id}` }, () => void carregar())
      .subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [carregar, r.id]);

  const setores = useMemo(() => [...new Set((itens ?? []).map((i) => i.setor || 'Outro'))].sort(), [itens]);
  const visiveis = (itens ?? []).filter((i) => !setor || (i.setor || 'Outro') === setor);
  const grupos = useMemo(() => {
    const m = new Map<string, ItemCompra[]>();
    for (const i of visiveis) {
      const k = i.setor || 'Outro';
      m.set(k, [...(m.get(k) ?? []), i]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([nome, l]) => [nome, [...l].sort((x, y) => Number(y.urgente) - Number(x.urgente) || x.nome.localeCompare(y.nome))] as const);
  }, [visiveis]);
  const pendentesEquipe = pessoas.filter((p) => p.status === 'pendente');

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    if (!novo.nome.trim()) return;
    const { error } = await supabase.from('compras_itens').insert({
      restaurante_id: r.id, nome: novo.nome.trim().slice(0, 80), quantidade: novo.quantidade.trim().slice(0, 30) || null,
      urgente: novo.urgente, setor: 'Gestão', pedido_por: (s.nome || 'Painel').slice(0, 60),
    });
    if (error) return toast(msgErro(error), 'erro');
    setNovo({ nome: '', quantidade: '', urgente: false });
    void carregar();
  }

  async function marcar(i: ItemCompra, comprado: boolean) {
    setItens((l) => (comprado ? l?.filter((x) => x.id !== i.id) ?? null : l));
    const { error } = await supabase.from('compras_itens').update(comprado
      ? { status: 'comprado', comprado_em: new Date().toISOString(), comprado_por: s.nome || 'Painel' }
      : { status: 'pendente', comprado_em: null, comprado_por: null }).eq('id', i.id);
    if (error) toast(msgErro(error), 'erro');
    void carregar();
  }

  async function marcarTodos() {
    if (!visiveis.length || !(await confirmar(`Marcar ${visiveis.length} ${visiveis.length === 1 ? 'item' : 'itens'} como comprados?`, { sim: 'Marcar tudo' }))) return;
    const { error } = await supabase.from('compras_itens').update({ status: 'comprado', comprado_em: new Date().toISOString(), comprado_por: s.nome || 'Painel' })
      .in('id', visiveis.map((i) => i.id));
    if (error) return toast(msgErro(error), 'erro');
    toast('Tudo marcado como comprado.', 'ok');
    void carregar();
  }

  async function apagar(i: ItemCompra) {
    const { error } = await supabase.from('compras_itens').delete().eq('id', i.id);
    if (error) return toast(msgErro(error), 'erro');
    void carregar();
  }

  async function pessoaStatus(p: PessoaCompra, status: PessoaCompra['status']) {
    const { error } = await supabase.from('compras_pessoas').update({ status }).eq('id', p.id);
    if (error) return toast(msgErro(error), 'erro');
    toast(status === 'ativo' ? `${p.nome} já pode mandar a lista.` : `Acesso de ${p.nome} desligado.`, 'ok');
    void carregar();
  }
  async function pessoaExcluir(p: PessoaCompra) {
    if (!(await confirmar(`Excluir ${p.nome} da lista de compras? Os itens que pediu continuam na lista.`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('compras_pessoas').delete().eq('id', p.id);
    if (error) return toast(msgErro(error), 'erro');
    void carregar();
  }

  const textoLista = () => {
    const linhas = grupos.flatMap(([g, l]) => [`*${g}*`, ...l.map((i) => `• ${i.urgente ? '(URGENTE) ' : ''}${i.nome}${i.quantidade ? ` — ${i.quantidade}` : ''}${i.obs ? ` (${i.obs})` : ''}`), '']);
    return `*Lista de compras — ${r.nome}*\n${new Date().toLocaleDateString('pt-BR')}\n\n${linhas.join('\n').trim()}`;
  };
  const link = linkListaCompras(r.codigo);

  return (
    <div className="pagina compras">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Lista de compras</h1>
          <p>O que a equipe pediu para repor. Cada um manda pelo próprio celular.</p>
        </div>
        {aba === 'comprar' && (itens?.length ?? 0) > 0 && (
          <div className="acoes-linha">
            <a className="btn btn--contorno" href={`https://wa.me/?text=${encodeURIComponent(textoLista())}`} target="_blank" rel="noopener"><MessageCircle size={17} /> Enviar no WhatsApp</a>
            <button className="btn btn--contorno" onClick={() => imprimirLista('LISTA DE COMPRAS', grupos.map(([g, l]) => ({ grupo: g, itens: l.map((i) => `${i.urgente ? '(!) ' : ''}${i.nome}${i.quantidade ? ` - ${i.quantidade}` : ''}${i.obs ? ` (${i.obs})` : ''}`) })))}>
              <Printer size={17} /> Imprimir
            </button>
          </div>
        )}
      </div>

      <div className="compras__abas" role="tablist">
        <button role="tab" aria-selected={aba === 'comprar'} className={cx(aba === 'comprar' && 'ativo')} onClick={() => setAba('comprar')}>
          <ShoppingCart size={17} /> A comprar <b>{itens?.length ?? 0}</b>
        </button>
        <button role="tab" aria-selected={aba === 'comprados'} className={cx(aba === 'comprados' && 'ativo')} onClick={() => setAba('comprados')}>
          <CheckCheck size={17} /> Comprados
        </button>
        {gestor && (
          <button role="tab" aria-selected={aba === 'equipe'} className={cx(aba === 'equipe' && 'ativo')} onClick={() => setAba('equipe')}>
            <Users size={17} /> Equipe {pendentesEquipe.length > 0 ? <b className="alerta">{pendentesEquipe.length}</b> : <b>{pessoas.filter((p) => p.status === 'ativo').length}</b>}
          </button>
        )}
      </div>

      {gestor && pendentesEquipe.length > 0 && aba !== 'equipe' && (
        <button className="compras__aviso" onClick={() => setAba('equipe')}>
          <CircleAlert size={18} /> <span><b>{pendentesEquipe.map((p) => p.nome).join(', ')}</b> {pendentesEquipe.length === 1 ? 'pediu' : 'pediram'} acesso à lista. Toque para liberar.</span>
        </button>
      )}

      {aba === 'comprar' && (
        <>
          <form className="compras__novo" onSubmit={adicionar}>
            <input className="input" value={novo.nome} maxLength={80} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Adicionar item (ex.: Tomate)" />
            <input className="input compras__qtd" value={novo.quantidade} maxLength={30} onChange={(e) => setNovo({ ...novo, quantidade: e.target.value })} placeholder="Quantidade" />
            <Switch marcado={novo.urgente} aoMudar={(v) => setNovo({ ...novo, urgente: v })}>Urgente</Switch>
            <button className="btn btn--primario" disabled={!novo.nome.trim()}><Plus size={17} /> Adicionar</button>
          </form>

          {setores.length > 1 && (
            <div className="compras__setores">
              <button className={cx('pdv-sub', !setor && 'ativa')} onClick={() => setSetor('')}>Todos <small>{itens?.length}</small></button>
              {setores.map((x) => (
                <button key={x} className={cx('pdv-sub', setor === x && 'ativa')} onClick={() => setSetor(x)}>{x} <small>{itens?.filter((i) => (i.setor || 'Outro') === x).length}</small></button>
              ))}
            </div>
          )}

          {!itens ? <div className="spinner" style={{ margin: '40px auto' }} /> : itens.length === 0 ? (
            <div className="compras__vazio">
              <span><CheckCheck size={34} /></span>
              <strong>Nada para comprar agora</strong>
              <p>Quando alguém da equipe pedir algo, aparece aqui na hora.</p>
            </div>
          ) : (
            <div className="compras__grupos">
              {grupos.map(([g, l]) => (
                <section key={g} className="compras__grupo">
                  <h2>{g} <small>{l.length}</small></h2>
                  <ul>
                    {l.map((i) => (
                      <li key={i.id} className={cx('compra', i.urgente && 'urgente')}>
                        <button className="compra__check" disabled={!podeMarcar} onClick={() => void marcar(i, true)} aria-label={`Marcar ${i.nome} como comprado`} title="Comprado"><Check size={16} strokeWidth={3} /></button>
                        <div className="compra__info">
                          <strong>{i.nome}{i.quantidade && <span className="compra__qtd">{i.quantidade}</span>}{i.urgente && <span className="compra__urgente"><Flame size={12} /> Urgente</span>}</strong>
                          {i.obs && <small className="compra__obs">{i.obs}</small>}
                          <small>
                            <Clock size={12} /> {i.pedido_por ?? 'Equipe'}
                            {i.pedido_tel && <> · <a className="compra__zap" href={zap(i.pedido_tel)} target="_blank" rel="noopener"><MessageCircle size={12} /> {telFmt(i.pedido_tel)}</a></>}
                            {' · '}{tempoDesde(i.criado_em, agora)}
                          </small>
                        </div>
                        {podeMarcar && <button className="icone-btn icone-btn--perigo" onClick={() => void apagar(i)} aria-label="Tirar da lista" title="Tirar da lista"><Trash2 size={16} /></button>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {podeMarcar && visiveis.length > 1 && (
                <button className="btn btn--contorno compras__todos" onClick={() => void marcarTodos()}><CheckCheck size={17} /> Marcar {setor ? `"${setor}"` : 'tudo'} como comprado</button>
              )}
            </div>
          )}
        </>
      )}

      {aba === 'comprados' && (
        comprados.length === 0 ? (
          <div className="compras__vazio"><span><ShoppingCart size={32} /></span><strong>Nada comprado nos últimos 30 dias</strong></div>
        ) : (
          <div className="compras__grupos">
            {Object.entries(comprados.reduce<Record<string, ItemCompra[]>>((acc, i) => {
              const d = new Date(i.comprado_em!).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
              (acc[d] ??= []).push(i);
              return acc;
            }, {})).map(([dia, l]) => (
              <section key={dia} className="compras__grupo">
                <h2>{dia} <small>{l.length}</small></h2>
                <ul>
                  {l.map((i) => (
                    <li key={i.id} className="compra comprada">
                      <span className="compra__check feito"><Check size={16} strokeWidth={3} /></span>
                      <div className="compra__info">
                        <strong>{i.nome}{i.quantidade && <span className="compra__qtd">{i.quantidade}</span>}</strong>
                        <small>Pedido por {i.pedido_por ?? 'Equipe'} · comprado por {i.comprado_por ?? '—'}</small>
                      </div>
                      {podeMarcar && <button className="btn btn--fantasma btn--sm" onClick={() => void marcar(i, false)}><RotateCcw size={15} /> Voltar</button>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      )}

      {aba === 'equipe' && gestor && <EquipeColaboradores pessoas={pessoas} link={link} nomeLoja={r.nome} aoMudar={() => void carregar()} aoStatus={pessoaStatus} aoExcluir={pessoaExcluir} />}
    </div>
  );
}

/* ---------- App dos colaboradores: você cria o acesso de cada um ---------- */
function EquipeColaboradores({ pessoas, link, nomeLoja, aoMudar, aoStatus, aoExcluir }: {
  pessoas: PessoaCompra[];
  link: string;
  nomeLoja: string;
  aoMudar: () => void;
  aoStatus: (p: PessoaCompra, s: PessoaCompra['status']) => Promise<void>;
  aoExcluir: (p: PessoaCompra) => Promise<void>;
}) {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const agora = useAgora(60000);
  const [novo, setNovo] = useState({ nome: '', telefone: '', setor: 'Cozinha', login: '', senha: senhaNova(), loginMexido: false });
  const [criando, setCriando] = useState(false);
  const [acesso, setAcesso] = useState<{ nome: string; telefone: string | null; login: string; senha: string } | null>(null);

  const mensagem = (a: { nome: string; login: string; senha: string }) =>
    `Olá, ${a.nome.split(' ')[0]}! Este é o app dos colaboradores da ${nomeLoja}, para mandar o que precisa repor:\n${link}\n\nUsuário: ${a.login}\nSenha: ${a.senha}\n\nDica: salve na tela de início do celular.`;

  async function criar(e: FormEvent) {
    e.preventDefault();
    setCriando(true);
    const { error } = await supabase.rpc('colaborador_criar', {
      p_rest: r.id, p_nome: novo.nome, p_telefone: novo.telefone, p_setor: novo.setor, p_login: novo.login, p_senha: novo.senha,
    });
    setCriando(false);
    if (error) return toast(msgErro(error), 'erro');
    setAcesso({ nome: novo.nome.trim(), telefone: novo.telefone.replace(/\D/g, '') || null, login: novo.login, senha: novo.senha });
    setNovo({ nome: '', telefone: '', setor: novo.setor, login: '', senha: senhaNova(), loginMexido: false });
    aoMudar();
  }

  async function trocarSenha(p: PessoaCompra) {
    if (!(await confirmar(`Gerar uma senha nova para ${p.nome}? A antiga para de funcionar.`, { sim: 'Gerar senha' }))) return;
    const senha = senhaNova();
    const { error } = await supabase.rpc('colaborador_senha', { p_rest: r.id, p_id: p.id, p_senha: senha });
    if (error) return toast(msgErro(error), 'erro');
    setAcesso({ nome: p.nome, telefone: p.telefone, login: p.login ?? p.nome, senha });
  }

  return (
    <div className="compras__equipe">
      <section className="card colab-novo">
        <h2 className="card__titulo"><UserPlus size={19} /> Novo colaborador</h2>
        <p className="muted">Você cria o usuário e a senha e manda pelo WhatsApp. Ele entra no app dos colaboradores e já pode mandar o que precisa repor.</p>
        <form className="colab-novo__form" onSubmit={criar}>
          <label className="campo"><span>Nome</span>
            <input className="input" required maxLength={60} value={novo.nome} placeholder="Ex.: Maria Souza"
              onChange={(e) => setNovo((x) => ({ ...x, nome: e.target.value, login: x.loginMexido ? x.login : usuarioDe(e.target.value) }))} />
          </label>
          <label className="campo"><span>WhatsApp</span>
            <input className="input" inputMode="tel" value={telFmt(novo.telefone)} placeholder="(00) 00000-0000" onChange={(e) => setNovo({ ...novo, telefone: e.target.value.replace(/\D/g, '').slice(0, 11) })} />
          </label>
          <div className="campo colab-novo__setores"><span>Setor</span>
            <div className="acoes-linha">{SETORES.map((x) => <button type="button" key={x} className={cx('pdv-sub', novo.setor === x && 'ativa')} onClick={() => setNovo({ ...novo, setor: x })}>{x}</button>)}</div>
          </div>
          <label className="campo"><span>Usuário</span>
            <input className="input" required value={novo.login} placeholder="maria.souza" onChange={(e) => setNovo({ ...novo, login: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30), loginMexido: true })} />
          </label>
          <label className="campo"><span>Senha</span>
            <span className="input-icone input-icone--fim">
              <input className="input" required minLength={4} maxLength={30} value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
              <button type="button" className="colab-novo__gerar" onClick={() => setNovo({ ...novo, senha: senhaNova() })} title="Gerar outra"><RefreshCw size={15} /></button>
            </span>
          </label>
          <button className="btn btn--primario colab-novo__criar" disabled={criando || novo.nome.trim().length < 2 || novo.login.length < 3}>{criando ? 'Criando…' : 'Criar acesso'}</button>
        </form>
      </section>

      {acesso && (
        <section className="colab-acesso">
          <div>
            <strong><KeyRound size={17} /> Acesso de {acesso.nome}</strong>
            <span>Usuário: <b>{acesso.login}</b> · Senha: <b>{acesso.senha}</b></span>
            <small>Anote ou envie agora: a senha não aparece de novo.</small>
          </div>
          <div className="acoes-linha">
            <a className="btn btn--primario btn--sm" target="_blank" rel="noopener"
              href={`https://wa.me/${acesso.telefone ? (acesso.telefone.length <= 11 ? `55${acesso.telefone}` : acesso.telefone) : ''}?text=${encodeURIComponent(mensagem(acesso))}`}>
              <MessageCircle size={15} /> Enviar pelo WhatsApp
            </a>
            <button className="icone-btn" onClick={() => setAcesso(null)} aria-label="Fechar"><X size={16} /></button>
          </div>
        </section>
      )}

      <section className="card compras__link">
        <div>
          <h2 className="card__titulo"><Smartphone size={19} /> Link do app dos colaboradores</h2>
          <p className="muted">É o mesmo link para todos. Cada um entra com o próprio usuário e senha.</p>
          <LinkCopiavel link={link} />
        </div>
        <QrCartao link={link} legenda="App dos colaboradores" arquivo={`qr-colaboradores-${r.codigo}`} />
      </section>

      {pessoas.length === 0 ? (
        <p className="cfg-vazio">Nenhum colaborador ainda. Crie o primeiro acima.</p>
      ) : (
        <ul className="compras__pessoas">
          {[...pessoas].sort((a, b) => ['pendente', 'ativo', 'bloqueado'].indexOf(a.status) - ['pendente', 'ativo', 'bloqueado'].indexOf(b.status)).map((p) => (
            <li key={p.id} className={cx('compra-pessoa', p.status)}>
              <span className="compra-pessoa__avatar">{p.nome.charAt(0).toUpperCase()}</span>
              <div className="compra-pessoa__info">
                <strong>{p.nome} <span className={`compra-pessoa__status compra-pessoa__status--${p.status}`}>{p.status === 'pendente' ? 'Aguardando liberação' : p.status === 'ativo' ? 'Liberado' : 'Desligado'}</span></strong>
                <small>
                  {p.setor}{p.login && <> · usuário <b>{p.login}</b></>}
                  {p.telefone && <> · <a className="compra__zap" href={zap(p.telefone)} target="_blank" rel="noopener"><MessageCircle size={12} /> {telFmt(p.telefone)}</a></>}
                  {' · '}{p.ultimo_acesso ? `usou ${tempoDesde(p.ultimo_acesso, agora)}` : 'ainda não entrou'}
                </small>
              </div>
              <div className="compra-pessoa__acoes">
                {p.status !== 'ativo' && <button className="btn btn--primario btn--sm" onClick={() => void aoStatus(p, 'ativo')}><UserCheck size={15} /> {p.status === 'pendente' ? 'Liberar' : 'Religar'}</button>}
                {p.status === 'ativo' && <button className="btn btn--contorno btn--sm" onClick={() => void trocarSenha(p)}><KeyRound size={15} /> Nova senha</button>}
                {p.status === 'ativo' && <button className="btn btn--fantasma btn--sm" onClick={() => void aoStatus(p, 'bloqueado')}><UserX size={15} /> Desligar</button>}
                <button className="icone-btn icone-btn--perigo" onClick={() => void aoExcluir(p)} aria-label={`Excluir ${p.nome}`} title="Excluir"><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
