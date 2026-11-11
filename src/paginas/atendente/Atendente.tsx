import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft, Ban, BellOff, BellRing, Bike, Check, CheckCheck, ChefHat, ClipboardList, Clock, Copy, Gift, History, LogOut, MapPin, MessageCircle,
  Navigation, Package, PackageCheck, Phone, Printer, RefreshCw, Search, Settings2, Sparkles, Store, Sun, Timer, UserRound, Volume2, VolumeX, Wallet, X,
} from 'lucide-react';
import { Carregando } from '../../componentes/Carregando';
import { Switch } from '../../componentes/Basicos';
import { Avatar, ModalPerfil } from '../../componentes/Perfil';
import { useToast } from '../../componentes/Toast';
import { confirmar } from '../../componentes/Confirmar';
import { cancelarComMotivo } from '../../componentes/CancelarPedido';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { definirSom, destravarSom, somLigado, tocarAlerta } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Membro, Pedido, PedidoItem } from '../../lib/tipos';
import { brl, cx, hora, ls, minutosDesde, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import { aplicarAtualizacao, useNovaVersao } from '../../lib/versao';
import { useAparencia } from '../../lib/aparencia';
import { imprimirPedido, programaDesktop } from '../../lib/impressao';
import { caminhosLoja, dominioAtivo, origemSistema } from '../../lib/linkCurto';
import '../../estilos/painel.css';
import '../../estilos/garcom.css';
import '../../estilos/entregador.css';
import '../../estilos/atendente.css';

type Aba = 'novos' | 'cozinha' | 'prontos' | 'historico' | 'mais';
type Ocupado = string | null;

const FORMA: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Cartão de crédito', debito: 'Cartão de débito', outro: 'Outro' };
const TEMPOS = ['20 a 30 min', '30 a 40 min', '40 a 50 min', '50 a 60 min', '60 a 80 min', '80 a 100 min'];
const ATRASO_NOVO_MIN = 5;
const ATRASO_COZINHA_MIN = 30;

const doCardapio = (p: Pedido) => p.tipo === 'delivery' || p.tipo === 'retirada';
const saudacao = (agora: number) => { const h = new Date(agora).getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const telDe = (p: Pedido) => (p.cliente_telefone ?? '').replace(/\D/g, '');
const whats = (tel: string, texto?: string) => `https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
const telFormatado = (t: string) => t.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
const primeiro = (nome?: string | null) => (nome ?? '').trim().split(/\s+/)[0] || 'tudo bem';
const inicioHoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Itens que a pessoa já passou para o papel (fica salvo no aparelho) */
const CHAVE_ANOT = 'bf:atd:anotados';
type Anotados = Record<string, string[]>;

/* ======================================================================
   App de pedidos: recebe, anota e acompanha os pedidos do cardápio digital
   ====================================================================== */
export default function Atendente() {
  const s = useSessao();
  const toast = useToast();
  const r = s.restaurante!;
  const agora = useAgora(15000);
  const [aba, setAba] = useState<Aba>('novos');
  const [selId, setSelId] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [som, setSom] = useState(somLigado());
  const [insistir, setInsistir] = useState(() => ls.ler('bf:atd:insistir', true));
  const [telaAcesa, setTelaAcesa] = useState(() => ls.ler('bf:atd:acesa', true));
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [perfil, setPerfil] = useState(false);
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [anotados, setAnotados] = useState<Anotados>(() => ls.ler<Anotados>(CHAVE_ANOT, {}));
  const [loja, setLoja] = useState({ aberto: r.delivery_ativo, tempo: r.delivery_tempo || '' });
  const [entregadores, setEntregadores] = useState<Membro[]>([]);
  const largo = useLargo();
  const novaVersao = useNovaVersao(30000);
  useAparencia('garcom', true);

  const vivo = usePedidosAoVivo(r.id, {
    aoNovoPedido: (p) => {
      if (!doCardapio(p)) return;
      tocarAlerta('pedido');
      toast(`Pedido novo #${p.numero} · ${p.cliente_nome ?? (p.tipo === 'retirada' ? 'Retirada' : 'Entrega')}`, 'info');
    },
  });

  useEffect(() => { void estadoPush().then(setPush); }, []);
  // Loja (aberta/fechada e tempo) e entregadores
  useEffect(() => {
    void supabase.from('restaurantes').select('delivery_ativo, delivery_tempo').eq('id', r.id).single()
      .then(({ data }) => { if (data) setLoja({ aberto: data.delivery_ativo, tempo: data.delivery_tempo ?? '' }); });
    void supabase.from('membros').select('*').eq('restaurante_id', r.id).eq('papel', 'entregador').order('nome')
      .then(({ data }) => setEntregadores((data ?? []) as Membro[]));
  }, [r.id]);

  const meus = useMemo(() => vivo.pedidos.filter(doCardapio), [vivo.pedidos]);
  const novos = useMemo(() => meus.filter((p) => p.status === 'novo').sort(maisAntigo), [meus]);
  const cozinha = useMemo(() => meus.filter((p) => p.status === 'preparando').sort(maisAntigo), [meus]);
  const prontos = useMemo(() => meus.filter((p) => p.status === 'pronto').sort(maisAntigo), [meus]);
  const hoje = useMemo(() => {
    const ini = inicioHoje();
    return meus.filter((p) => new Date(p.criado_em).getTime() >= ini).sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  }, [meus]);
  const selecionado = meus.find((p) => p.id === selId) ?? null;

  // Pedido novo esperando: toca de novo a cada 15 s até alguém abrir/aceitar
  useEffect(() => {
    if (!novos.length || !insistir || !som) return;
    const t = setInterval(() => tocarAlerta('pedido'), 15000);
    return () => clearInterval(t);
  }, [novos.length, insistir, som]);
  // Título da aba pisca a quantidade de novos
  useEffect(() => {
    const base = `Pedidos · ${r.nome}`;
    document.title = novos.length ? `(${novos.length}) Pedido novo! · ${r.nome}` : base;
    return () => { document.title = base; };
  }, [novos.length, r.nome]);
  useTelaAcesa(telaAcesa);

  // Guarda só os anotados dos pedidos ainda na tela
  useEffect(() => {
    const ids = new Set(meus.map((p) => p.id));
    setAnotados((a) => {
      const limpo = Object.fromEntries(Object.entries(a).filter(([id]) => ids.has(id)));
      return Object.keys(limpo).length === Object.keys(a).length ? a : limpo;
    });
  }, [meus]);
  useEffect(() => { ls.gravar(CHAVE_ANOT, anotados); }, [anotados]);
  const marcarItem = useCallback((pedido: string, item: string) => {
    destravarSom();
    setAnotados((a) => {
      const atual = new Set(a[pedido] ?? []);
      if (atual.has(item)) atual.delete(item); else atual.add(item);
      return { ...a, [pedido]: [...atual] };
    });
  }, []);

  /* ---------- Ações ---------- */
  async function mudar(p: Pedido, status: 'preparando' | 'pronto' | 'entregue', ok: string) {
    setOcupado(p.id);
    const antes = p.status;
    vivo.atualizarPedido(p.id, { status, atualizado_em: new Date().toISOString() });
    const { error } = await supabase.rpc('pedido_mudar_status', { p_pedido: p.id, p_status: status });
    setOcupado(null);
    if (error) { vivo.atualizarPedido(p.id, { status: antes }); return toast(msgErro(error), 'erro'); }
    toast(ok, 'ok');
  }
  async function entrega(p: Pedido, rpc: 'entrega_saiu' | 'entrega_atribuir', entregador?: string | null) {
    setOcupado(p.id);
    const { error } = await supabase.rpc(rpc, rpc === 'entrega_saiu' ? { p_pedido: p.id } : { p_pedido: p.id, p_entregador: entregador || null });
    setOcupado(null);
    if (error) return toast(msgErro(error), 'erro');
    if (rpc === 'entrega_saiu') {
      vivo.atualizarPedido(p.id, { saiu_em: new Date().toISOString(), status: 'pronto' });
      toast(`Pedido #${p.numero} saiu para entrega.`, 'ok');
    } else {
      const nome = entregadores.find((m) => m.user_id === entregador)?.nome ?? null;
      vivo.atualizarPedido(p.id, { entregador_id: entregador || null, entregador_nome: nome, ...(entregador ? {} : { saiu_em: null }) });
      toast(entregador ? `#${p.numero} vai com ${nome}.` : `#${p.numero} sem entregador.`, 'ok');
    }
  }
  async function imprimir(p: Pedido) {
    // No programa do Windows (computador da impressora): imprime aqui mesmo
    if (programaDesktop()) { imprimirPedido(p, r.nome, { automatico: true }); return toast(`Pedido #${p.numero} enviado para a impressora.`, 'ok'); }
    const { data: id, error } = await supabase.rpc('impressao_solicitar_pedido', { p_pedido: p.id });
    if (error) return toast(msgErro(error), 'erro');
    toast(`Pedido #${p.numero} enviado para a impressora do caixa…`, 'info');
    acompanharImpressao(id as string, p.numero, toast);
  }
  async function cancelar(p: Pedido) {
    await cancelarComMotivo(p, vivo.atualizarPedido, toast);
  }
  async function mudarLoja(aberto: boolean | null, tempo: string | null) {
    const antes = loja;
    setLoja((l) => ({ aberto: aberto ?? l.aberto, tempo: tempo ?? l.tempo }));
    const { error } = await supabase.rpc('loja_recebimento', { p_rest: r.id, p_aberto: aberto, p_tempo: tempo });
    if (error) { setLoja(antes); return toast(msgErro(error), 'erro'); }
    toast(aberto === true ? 'Cardápio digital aberto: recebendo pedidos.' : aberto === false ? 'Cardápio digital fechado. Ninguém consegue pedir até abrir de novo.' : `Tempo de entrega: ${tempo}.`, 'ok');
  }
  async function ativarAvisos() {
    try {
      await ativarPush(r.id, 'atendente');
      toast('Pronto! Este aparelho avisa a cada pedido novo, mesmo bloqueado.', 'ok');
    } catch (e) {
      toast(msgErro(e), 'erro');
    }
    setPush(await estadoPush());
  }

  const acoes: AcoesComanda = { mudar, entrega, imprimir, cancelar };
  const abrir = (p: Pedido) => { destravarSom(); setSelId(p.id); };

  /* ---------- Lista da aba ---------- */
  const termo = normalizar(busca.trim().replace(/^#/, ''));
  const filtrar = (l: Pedido[]) => (!termo ? l : l.filter((p) => String(p.numero) === termo
    || normalizar(p.cliente_nome ?? '').includes(termo)
    || telDe(p).includes(termo.replace(/\D/g, '') || '§')
    || normalizar(p.endereco?.bairro ?? '').includes(termo)));
  const listaAba = aba === 'novos' ? novos : aba === 'cozinha' ? cozinha : aba === 'prontos' ? prontos : hoje;
  const lista = filtrar(listaAba);

  const primeiroNome = (s.nome || 'Atendente').trim().split(/\s+/)[0];
  const abas: { id: Aba; rotulo: string; icone: ReactNode; qtd?: number; alerta?: boolean }[] = [
    { id: 'novos', rotulo: 'Novos', icone: <BellRing size={22} />, qtd: novos.length, alerta: true },
    { id: 'cozinha', rotulo: 'Cozinha', icone: <ChefHat size={22} />, qtd: cozinha.length },
    { id: 'prontos', rotulo: 'Prontos', icone: <PackageCheck size={22} />, qtd: prontos.length },
    { id: 'historico', rotulo: 'Hoje', icone: <History size={22} /> },
    { id: 'mais', rotulo: 'Ajustes', icone: <Settings2 size={22} /> },
  ];
  const TITULO: Record<Aba, string> = { novos: 'Pedidos novos', cozinha: 'Na cozinha', prontos: 'Prontos', historico: 'Pedidos de hoje', mais: 'Ajustes' };

  return (
    <div className={cx('garcom gapp atd', largo && 'atd--largo', selecionado && 'atd--com-comanda')} style={{ '--acento': r.cor } as CSSProperties}>
      <header className="gtopo">
        <button className="gtopo__perfil" onClick={() => setPerfil(true)} aria-label="Meu perfil" title="Meu perfil">
          <Avatar nome={s.nome || 'Atendente'} foto={s.foto} tamanho={42} />
          <i className={cx('gtopo__vivo', vivo.conectado && 'on')} />
        </button>
        <div className="gtopo__txt">
          <strong>{saudacao(agora)}, {primeiroNome}</strong>
          <span className={cx('gtopo__status', vivo.conectado && 'on')}>{vivo.conectado ? 'Ao vivo' : 'Reconectando…'} · {r.nome}</span>
        </div>
        <button className={cx('atd-loja', loja.aberto ? 'aberta' : 'fechada')} onClick={() => setAba('mais')} title="Abrir ou fechar o cardápio digital">
          <i /> {loja.aberto ? 'Aberto' : 'Fechado'}
        </button>
        <button className="gtopo__btn" onClick={() => { const v = !som; setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }} aria-label={som ? 'Desligar som' : 'Ligar som'}>
          {som ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <button className="gtopo__btn" onClick={() => void confirmar('Sair do app de pedidos?', { sim: 'Sair' }).then((ok) => { if (ok) void s.sair(); })} aria-label="Sair"><LogOut size={19} /></button>
      </header>
      {perfil && <ModalPerfil aoFechar={() => setPerfil(false)} />}

      <div className="atd-corpo">
        <main className="gapp__conteudo atd-lista">
          {novaVersao && (
            <div className="gaviso gaviso--info">
              <span className="gaviso__icone"><RefreshCw size={18} /></span>
              <div className="gaviso__txt"><b>App atualizado</b><small>Toque para carregar a versão nova</small></div>
              <button className="gaviso__btn" onClick={aplicarAtualizacao}>Atualizar</button>
            </div>
          )}
          {!loja.aberto && aba !== 'mais' && (
            <div className="gaviso atd-aviso-fechado">
              <span className="gaviso__icone"><Store size={18} /></span>
              <div className="gaviso__txt"><b>Cardápio digital fechado</b><small>Os clientes não conseguem pedir agora</small></div>
              <button className="gaviso__btn" onClick={() => void mudarLoja(true, null)}>Abrir</button>
            </div>
          )}
          {push && (push === 'inativo' || push === 'bloqueado' || push === 'precisa-instalar') && aba !== 'mais' && (
            <div className="gaviso">
              <span className="gaviso__icone"><BellOff size={18} /></span>
              <div className="gaviso__txt">
                <b>Ative os avisos</b>
                <small>{push === 'precisa-instalar' ? 'No iPhone: Compartilhar › Adicionar à Tela de Início e abra pelo ícone'
                  : push === 'bloqueado' ? 'Bloqueados: libere em Permissões › Notificações' : 'Toca a cada pedido novo, mesmo com a tela bloqueada'}</small>
              </div>
              {push === 'inativo' && <button className="gaviso__btn" onClick={() => void ativarAvisos()}>Ativar</button>}
            </div>
          )}

          {vivo.carregando ? <Carregando /> : aba === 'mais' ? (
            <Ajustes restauranteId={r.id} loja={loja} aoMudarLoja={(a, t) => void mudarLoja(a, t)} som={som}
              aoSom={(v) => { setSom(v); definirSom(v); if (v) tocarAlerta('pedido'); }}
              insistir={insistir} aoInsistir={(v) => { setInsistir(v); ls.gravar('bf:atd:insistir', v); }}
              telaAcesa={telaAcesa} aoTelaAcesa={(v) => { setTelaAcesa(v); ls.gravar('bf:atd:acesa', v); }}
              push={push} aoAtivarPush={() => void ativarAvisos()} />
          ) : (
            <>
              {aba === 'historico' && <ResumoDia pedidos={hoje} />}
              <div className="gsecao">
                <h2>{TITULO[aba]}</h2>
                {listaAba.length > 0 && <span className="gsecao__qtd">{listaAba.length}</span>}
              </div>
              {(listaAba.length > 4 || aba === 'historico') && listaAba.length > 0 && (
                <label className="atd-busca">
                  <Search size={17} />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº do pedido, nome, telefone ou bairro" inputMode="search" />
                  {busca && <button onClick={() => setBusca('')} aria-label="Limpar busca"><X size={16} /></button>}
                </label>
              )}
              {lista.length === 0 ? (
                <Vazio aba={aba} busca={!!termo && listaAba.length > 0} />
              ) : (
                <div className="atd-cartoes">
                  {lista.map((p) => (
                    <CartaoPedido key={p.id} p={p} agora={agora} ativo={p.id === selId} ocupado={ocupado === p.id}
                      anotados={(anotados[p.id] ?? []).length} aoAbrir={() => abrir(p)} acoes={acoes} />
                  ))}
                </div>
              )}
            </>
          )}
        </main>

        {selecionado && (
          <Comanda key={selecionado.id} p={selecionado} agora={agora} r={{ ...r, delivery_tempo: loja.tempo || r.delivery_tempo }} entregadores={entregadores}
            anotados={anotados[selecionado.id] ?? []} aoMarcar={(i) => marcarItem(selecionado.id, i)}
            aoMarcarTodos={(ids) => setAnotados((a) => ({ ...a, [selecionado.id]: ids }))}
            ocupado={ocupado === selecionado.id} acoes={acoes} aoFechar={() => setSelId(null)} largo={largo} />
        )}
      </div>

      <nav className="gnav atd-nav" aria-label="Seções do app">
        {abas.map((a) => (
          <button key={a.id} className={cx('gnav__item', aba === a.id && 'ativo')} aria-current={aba === a.id ? 'page' : undefined}
            onClick={() => { setAba(a.id); setBusca(''); if (!largo) setSelId(null); window.scrollTo({ top: 0 }); }}>
            <span className="gnav__icone">{a.icone}{!!a.qtd && <b className={cx(a.alerta && 'alerta')}>{a.qtd > 99 ? '99+' : a.qtd}</b>}</span>
            <span className="gnav__rotulo">{a.rotulo}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

interface AcoesComanda {
  mudar: (p: Pedido, s: 'preparando' | 'pronto' | 'entregue', ok: string) => Promise<void>;
  entrega: (p: Pedido, rpc: 'entrega_saiu' | 'entrega_atribuir', entregador?: string | null) => Promise<void>;
  imprimir: (p: Pedido) => Promise<void>;
  cancelar: (p: Pedido) => Promise<void>;
}

const maisAntigo = (a: Pedido, b: Pedido) => a.criado_em.localeCompare(b.criado_em);

/** Tablet deitado/computador: lista e comanda lado a lado */
function useLargo() {
  const consulta = '(min-width: 980px)';
  const [largo, setLargo] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudar = () => setLargo(m.matches);
    m.addEventListener('change', mudar);
    return () => m.removeEventListener('change', mudar);
  }, []);
  return largo;
}

/** Não deixa a tela apagar enquanto o app está aberto (para não perder pedido) */
function useTelaAcesa(ativo: boolean) {
  useEffect(() => {
    type Trava = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Trava> } };
    if (!ativo || !nav.wakeLock) return;
    let trava: Trava | null = null;
    let vivo = true;
    const pedir = () => {
      if (document.visibilityState !== 'visible') return;
      void nav.wakeLock!.request('screen').then((t) => { if (vivo) trava = t; else void t.release(); }).catch(() => undefined);
    };
    pedir();
    document.addEventListener('visibilitychange', pedir);
    return () => { vivo = false; document.removeEventListener('visibilitychange', pedir); void trava?.release().catch(() => undefined); };
  }, [ativo]);
}

/** Espera a impressora do caixa confirmar (ou dizer o erro) */
function acompanharImpressao(id: string, numero: number, toast: ReturnType<typeof useToast>) {
  type Fila = { impresso_em: string | null; erro: string | null; falharam: string[] | null };
  let fim = false;
  const terminar = (msg: string, tipo: 'ok' | 'erro') => { if (fim) return; fim = true; clearInterval(t); clearTimeout(limite); void supabase.removeChannel(canal); toast(msg, tipo); };
  const ver = (f: Fila | null) => {
    if (!f) return;
    if (f.impresso_em) terminar(`Pedido #${numero} impresso.`, 'ok');
  };
  const buscar = () => void supabase.from('fila_impressao').select('impresso_em, erro, falharam').eq('id', id).maybeSingle().then(({ data }) => ver(data as Fila | null));
  const canal = supabase.channel(`imp-${id}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fila_impressao', filter: `id=eq.${id}` }, (e) => ver(e.new as Fila))
    .subscribe();
  const t = setInterval(buscar, 4000);
  const limite = setTimeout(() => {
    void supabase.from('fila_impressao').select('impresso_em, erro, falharam').eq('id', id).maybeSingle().then(({ data }) => {
      const f = data as Fila | null;
      if (f?.impresso_em) return terminar(`Pedido #${numero} impresso.`, 'ok');
      terminar(f?.erro ? `Não imprimiu: ${f.erro}` : 'A impressora do caixa não respondeu. Confira se o computador do caixa está com o sistema aberto.', 'erro');
    });
  }, 60000);
}

/* ---------------- Cartão da lista ---------------- */
function etapaDe(p: Pedido) {
  if (p.status === 'cancelado') return { classe: 'cancelado', texto: 'Cancelado', icone: <Ban size={13} /> };
  if (p.status === 'entregue') return { classe: 'feito', texto: p.tipo === 'retirada' ? 'Retirado' : 'Entregue', icone: <CheckCheck size={13} /> };
  if (p.status === 'novo') return { classe: 'novo', texto: 'Novo', icone: <BellRing size={13} /> };
  if (p.status === 'preparando') return { classe: 'cozinha', texto: 'Na cozinha', icone: <ChefHat size={13} /> };
  if (p.tipo === 'retirada') return { classe: 'pronto', texto: 'Esperando o cliente', icone: <Package size={13} /> };
  if (p.saiu_em) return { classe: 'rota', texto: `Em rota${p.entregador_nome ? ` · ${primeiro(p.entregador_nome)}` : ''}`, icone: <Navigation size={13} /> };
  return { classe: 'pronto', texto: p.entregador_nome ? `Pronto · vai com ${primeiro(p.entregador_nome)}` : 'Pronto · sem entregador', icone: <Package size={13} /> };
}

function CartaoPedido({ p, agora, ativo, ocupado, anotados, aoAbrir, acoes }: {
  p: Pedido; agora: number; ativo: boolean; ocupado: boolean; anotados: number; aoAbrir: () => void; acoes: AcoesComanda;
}) {
  const etapa = etapaDe(p);
  const qtd = p.pedido_itens.reduce((n, i) => n + i.qtd, 0);
  const min = minutosDesde(p.criado_em, agora);
  const atrasado = (p.status === 'novo' && min >= ATRASO_NOVO_MIN) || (p.status === 'preparando' && min >= ATRASO_COZINHA_MIN);
  const troco = p.forma_pagamento === 'dinheiro' && p.troco_para && Number(p.troco_para) > Number(p.total);
  const temObs = !!p.observacao || p.pedido_itens.some((i) => i.obs);
  const itens = p.pedido_itens.length;

  return (
    <article className={cx('atd-cartao', `atd-cartao--${etapa.classe}`, ativo && 'ativo', atrasado && 'atrasado', ocupado && 'ocupado')}>
      <button className="atd-cartao__abrir" onClick={aoAbrir} aria-label={`Abrir pedido ${p.numero}`}>
        <header className="atd-cartao__topo">
          <strong>#{p.numero}</strong>
          <span className={cx('atd-tipo', p.tipo === 'retirada' && 'atd-tipo--retirada')}>{p.tipo === 'retirada' ? <Store size={13} /> : <Bike size={13} />} {p.tipo === 'retirada' ? 'Retirada' : 'Entrega'}</span>
          <small className={cx(atrasado && 'urgente')}><Clock size={12} /> {p.status === 'entregue' || p.status === 'cancelado' ? hora(p.criado_em) : min < 1 ? 'agora' : tempoDesde(p.criado_em, agora)}</small>
        </header>
        <div className="atd-cartao__cliente">
          <b>{p.cliente_nome || 'Cliente'}</b>
          {p.tipo === 'delivery' && p.endereco?.bairro && <span><MapPin size={13} /> {p.endereco.bairro}</span>}
        </div>
        <p className="atd-cartao__itens">{p.pedido_itens.slice(0, 3).map((i) => `${i.qtd}× ${i.nome}`).join(' · ')}{itens > 3 ? ` · +${itens - 3}` : ''}</p>
        <div className="atd-cartao__rodape">
          <span className={cx('atd-etapa', `atd-etapa--${etapa.classe}`)}>{etapa.icone} {etapa.texto}</span>
          {p.frete_gratis && <span className="atd-selo atd-selo--frete"><Gift size={12} /> Frete grátis</span>}
          {troco && <span className="atd-selo atd-selo--troco"><Wallet size={12} /> Troco</span>}
          {p.pago_em && <span className="atd-selo atd-selo--pago"><Check size={12} /> Pago</span>}
          {temObs && <span className="atd-selo atd-selo--obs">Obs.</span>}
          <strong>{brl(Number(p.total))}</strong>
        </div>
        {p.status === 'novo' && (
          <div className="atd-cartao__anot">
            <i style={{ width: `${itens ? (Math.min(anotados, itens) / itens) * 100 : 0}%` }} />
            <span>{anotados ? `${Math.min(anotados, itens)} de ${itens} ${itens === 1 ? 'item anotado' : 'itens anotados'}` : `${qtd} ${qtd === 1 ? 'item' : 'itens'} para anotar · toque para abrir`}</span>
          </div>
        )}
      </button>
      {p.status === 'preparando' && (
        <button className="btn btn--pronto atd-cartao__acao" disabled={ocupado} onClick={() => void acoes.mudar(p, 'pronto', `#${p.numero} pronto!`)}><Check size={17} /> Ficou pronto</button>
      )}
    </article>
  );
}

function Vazio({ aba, busca }: { aba: Aba; busca: boolean }) {
  if (busca) return <div className="gvazio"><span className="gvazio__icone"><Search size={34} /></span><strong>Nada encontrado</strong><p>Confira o número do pedido ou o nome do cliente.</p></div>;
  const t: Record<Exclude<Aba, 'mais'>, { icone: ReactNode; titulo: string; texto: string }> = {
    novos: { icone: <BellRing size={34} />, titulo: 'Nenhum pedido novo', texto: 'Quando um cliente pedir pelo cardápio digital, o pedido aparece aqui e o aparelho toca.' },
    cozinha: { icone: <ChefHat size={34} />, titulo: 'Nada na cozinha', texto: 'Os pedidos que você anotar e mandar para a cozinha ficam aqui até ficarem prontos.' },
    prontos: { icone: <PackageCheck size={34} />, titulo: 'Nenhum pedido pronto', texto: 'Pedido pronto espera aqui até o cliente retirar ou o entregador levar.' },
    historico: { icone: <History size={34} />, titulo: 'Nenhum pedido hoje', texto: 'Os pedidos do dia aparecem aqui, com o total vendido.' },
  };
  const x = t[aba as Exclude<Aba, 'mais'>];
  return <div className="gvazio"><span className="gvazio__icone">{x.icone}</span><strong>{x.titulo}</strong><p>{x.texto}</p></div>;
}

function ResumoDia({ pedidos }: { pedidos: Pedido[] }) {
  const validos = pedidos.filter((p) => p.status !== 'cancelado');
  const total = validos.reduce((s, p) => s + Number(p.total), 0);
  const entregas = validos.filter((p) => p.tipo === 'delivery').length;
  const cancelados = pedidos.length - validos.length;
  return (
    <div className="atd-resumo">
      <div className="atd-resumo__destaque"><small>Vendido hoje no cardápio digital</small><strong>{brl(total)}</strong><span>{validos.length} {validos.length === 1 ? 'pedido' : 'pedidos'} · ticket médio {brl(validos.length ? total / validos.length : 0)}</span></div>
      <div><small>Entregas</small><strong>{entregas}</strong></div>
      <div><small>Retiradas</small><strong>{validos.length - entregas}</strong></div>
      <div><small>Cancelados</small><strong>{cancelados}</strong></div>
    </div>
  );
}

/* ---------------- Comanda: tudo para anotar e despachar o pedido ---------------- */
type LojaComanda = { nome: string; codigo: string; slug?: string | null; dominio?: string | null; dominio_status?: string | null; delivery_tempo: string };

function linkAcompanhar(r: LojaComanda, p: Pedido) {
  if (!p.acompanhar) return null;
  const d = dominioAtivo(r);
  if (d) return `https://${d}/pedido/${p.acompanhar}`;
  if (!r.slug) return null;
  return `${origemSistema()}${caminhosLoja(r.slug).base}/pedido/${p.acompanhar}`;
}

function textoPedido(p: Pedido) {
  const linhas = [`PEDIDO #${p.numero} · ${p.tipo === 'retirada' ? 'RETIRADA' : 'ENTREGA'} · ${hora(p.criado_em)}`, ''];
  for (const i of p.pedido_itens) {
    linhas.push(`${i.qtd}x ${i.nome}`);
    if (i.complementos) linhas.push(`   ${i.complementos}`);
    if (i.obs) linhas.push(`   OBS: ${i.obs}`);
  }
  if (p.observacao) linhas.push('', `OBS DO PEDIDO: ${p.observacao}`);
  linhas.push('', `Cliente: ${p.cliente_nome ?? '-'}${telDe(p) ? ` · ${telFormatado(telDe(p))}` : ''}`);
  const e = p.endereco;
  if (p.tipo === 'delivery' && e) linhas.push(`Endereço: ${e.rua}, ${e.numero}${e.complemento ? ` (${e.complemento})` : ''} · ${e.bairro}${e.referencia ? ` · Ref.: ${e.referencia}` : ''}`);
  linhas.push(`Pagamento: ${FORMA[p.forma_pagamento ?? ''] ?? '-'}${p.pago_em ? ' (PAGO)' : ''}${p.troco_para && Number(p.troco_para) > Number(p.total) ? ` · troco para ${brl(Number(p.troco_para))}` : ''}`);
  linhas.push(`TOTAL: ${brl(Number(p.total))}${p.frete_gratis ? ' (frete grátis)' : ''}`);
  return linhas.join('\n');
}

function mensagens(p: Pedido, r: LojaComanda) {
  const nome = primeiro(p.cliente_nome);
  const acomp = linkAcompanhar(r, p);
  const seguir = acomp ? `\nAcompanhe aqui: ${acomp}` : '';
  const total = Number(p.total);
  const cobrar = p.pago_em ? 'Já está pago.' : `Total: ${brl(total)} (${(FORMA[p.forma_pagamento ?? ''] ?? 'combinar').toLowerCase()})${p.troco_para && Number(p.troco_para) > total ? `, troco para ${brl(Number(p.troco_para))}` : ''}.`;
  const l = [
    { id: 'recebido', rotulo: 'Pedido recebido', texto: `Olá, ${nome}! Aqui é da ${r.nome}. Recebemos o seu pedido #${p.numero} e ele já foi para a cozinha. ${p.tipo === 'retirada' ? 'Avisamos quando estiver pronto para retirar.' : r.delivery_tempo ? `Previsão de entrega: ${r.delivery_tempo}.` : 'Avisamos quando sair para entrega.'}${seguir}` },
  ];
  if (p.tipo === 'retirada') l.push({ id: 'pronto', rotulo: 'Pronto para retirar', texto: `Olá, ${nome}! Seu pedido #${p.numero} já está pronto para retirar na ${r.nome}. ${cobrar}` });
  else l.push({ id: 'saiu', rotulo: 'Saiu para entrega', texto: `Olá, ${nome}! Seu pedido #${p.numero} saiu para entrega${p.entregador_nome ? ` com ${primeiro(p.entregador_nome)}` : ''} e já já chega aí. ${cobrar}${seguir}` });
  l.push({ id: 'demora', rotulo: 'Vai atrasar um pouco', texto: `Olá, ${nome}! Seu pedido #${p.numero} está um pouquinho mais demorado hoje por causa do movimento, mas já está sendo preparado com carinho. Obrigado pela paciência!` });
  l.push({ id: 'confirmar', rotulo: 'Confirmar endereço', texto: `Olá, ${nome}! Aqui é da ${r.nome}, sobre o pedido #${p.numero}. Pode confirmar o endereço de entrega e um ponto de referência?` });
  return l;
}

function Comanda({ p, agora, r, entregadores, anotados, aoMarcar, aoMarcarTodos, ocupado, acoes, aoFechar, largo }: {
  p: Pedido; agora: number; r: LojaComanda; entregadores: Membro[]; anotados: string[]; aoMarcar: (item: string) => void; aoMarcarTodos: (ids: string[]) => void;
  ocupado: boolean; acoes: AcoesComanda; aoFechar: () => void; largo: boolean;
}) {
  const toast = useToast();
  const [vezes, setVezes] = useState<number | null>(null);
  const [msgs, setMsgs] = useState(false);
  const tel = telDe(p);
  const e = p.endereco;
  const total = Number(p.total);
  const subtotal = p.pedido_itens.reduce((s2, i) => s2 + i.qtd * Number(i.preco_unit), 0);
  const troco = p.forma_pagamento === 'dinheiro' && p.troco_para && Number(p.troco_para) > total ? Number(p.troco_para) - total : 0;
  const feito = p.status === 'entregue' || p.status === 'cancelado';
  const marcados = new Set(anotados);
  const todos = p.pedido_itens.length > 0 && p.pedido_itens.every((i) => marcados.has(i.id));
  const etapa = etapaDe(p);
  const qtdTotal = p.pedido_itens.reduce((n, i) => n + i.qtd, 0);

  // Quantas vezes esse cliente já pediu (cliente novo ganha destaque)
  useEffect(() => {
    if (!tel) return;
    void supabase.from('pedidos').select('id', { count: 'exact', head: true })
      .eq('restaurante_id', p.restaurante_id).eq('cliente_telefone', tel).neq('status', 'cancelado').lt('criado_em', p.criado_em)
      .then(({ count }) => setVezes(count ?? 0));
  }, [p.id, p.restaurante_id, p.criado_em, tel]);
  // Celular: trava a rolagem da lista por trás; Esc fecha
  useEffect(() => {
    if (!largo) document.body.style.overflow = 'hidden';
    const tecla = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !document.querySelector('.modal-fundo')) aoFechar(); };
    document.addEventListener('keydown', tecla);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', tecla); };
  }, [largo, aoFechar]);

  async function copiar() {
    try { await navigator.clipboard.writeText(textoPedido(p)); toast('Pedido copiado.', 'ok'); } catch { toast('Não deu para copiar neste aparelho.', 'erro'); }
  }

  /* Botão principal de acordo com a etapa */
  let principal: ReactNode = null;
  if (p.status === 'novo') {
    const proximo = p.precisa_preparo === false ? 'pronto' : 'preparando';
    principal = (
      <button className={cx('btn btn--primario btn--lg atd-principal', todos && 'pronto-para-ir')} disabled={ocupado}
        onClick={() => { if (!todos) aoMarcarTodos(p.pedido_itens.map((i) => i.id)); void acoes.mudar(p, proximo, proximo === 'pronto' ? `#${p.numero} aceito (sem preparo).` : `#${p.numero} foi para a cozinha.`); }}>
        <ChefHat size={20} /> {todos ? 'Anotei tudo · mandar pra cozinha' : 'Aceitar e mandar pra cozinha'}
      </button>
    );
  } else if (p.status === 'preparando') {
    principal = <button className="btn btn--pronto btn--lg atd-principal" disabled={ocupado} onClick={() => void acoes.mudar(p, 'pronto', `#${p.numero} pronto!`)}><Check size={20} /> Ficou pronto</button>;
  } else if (p.status === 'pronto' && p.tipo === 'retirada') {
    principal = <button className="btn btn--sucesso btn--lg atd-principal" disabled={ocupado} onClick={() => void acoes.mudar(p, 'entregue', `#${p.numero} retirado pelo cliente.`)}><CheckCheck size={20} /> Cliente retirou</button>;
  } else if (p.status === 'pronto' && !p.saiu_em) {
    principal = entregadores.length && !p.entregador_id
      ? <button className="btn btn--primario btn--lg atd-principal" disabled>Escolha o entregador acima</button>
      : entregadores.length
        ? <button className="btn btn--primario btn--lg atd-principal" disabled={ocupado} onClick={() => void acoes.entrega(p, 'entrega_saiu')}><Navigation size={20} /> Saiu para entrega</button>
        : <button className="btn btn--sucesso btn--lg atd-principal" disabled={ocupado} onClick={() => void acoes.mudar(p, 'entregue', `#${p.numero} entregue.`)}><CheckCheck size={20} /> Foi entregue</button>;
  } else if (p.status === 'pronto') {
    principal = <button className="btn btn--sucesso btn--lg atd-principal" disabled={ocupado} onClick={() => void acoes.mudar(p, 'entregue', `#${p.numero} entregue.`)}><CheckCheck size={20} /> Foi entregue</button>;
  }

  return (
    <aside className={cx('atd-comanda', largo ? 'atd-comanda--lado' : 'atd-comanda--tela')} aria-label={`Pedido ${p.numero}`}>
      <header className="atd-comanda__topo">
        <button className="gtopo__btn" onClick={aoFechar} aria-label="Voltar">{largo ? <X size={20} /> : <ArrowLeft size={20} />}</button>
        <div>
          <strong>Pedido #{p.numero}</strong>
          <span>{p.tipo === 'retirada' ? 'Retirada no balcão' : 'Entrega'} · {hora(p.criado_em)} · {minutosDesde(p.criado_em, agora) < 1 ? 'agora' : `há ${tempoDesde(p.criado_em, agora)}`}</span>
        </div>
        <span className={cx('atd-etapa', `atd-etapa--${etapa.classe}`)}>{etapa.icone} {etapa.texto.split(' · ')[0]}</span>
      </header>

      <div className="atd-comanda__corpo">
        {/* Papel: o que vai para a cozinha */}
        <section className="atd-papel">
          <div className="atd-papel__cab">
            <span>{p.tipo === 'retirada' ? 'RETIRADA' : 'ENTREGA'}</span>
            <b>#{p.numero}</b>
            <span>{hora(p.criado_em)}</span>
          </div>
          {p.status === 'novo' && <p className="atd-papel__dica"><Sparkles size={14} /> Toque em cada item ao anotar no papel</p>}
          <ul className="atd-papel__itens">
            {p.pedido_itens.map((i) => <ItemComanda key={i.id} i={i} marcado={marcados.has(i.id)} aoMarcar={() => aoMarcar(i.id)} podeMarcar={p.status === 'novo'} />)}
          </ul>
          {p.observacao && <p className="atd-papel__obs"><b>Observação do pedido</b>{p.observacao}</p>}
          <div className="atd-papel__rodape">
            <span>{qtdTotal} {qtdTotal === 1 ? 'item' : 'itens'}</span>
            {p.status === 'novo' && <span className={cx('atd-papel__progresso', todos && 'ok')}>{todos ? <><CheckCheck size={15} /> Tudo anotado</> : `${p.pedido_itens.filter((i) => marcados.has(i.id)).length} de ${p.pedido_itens.length} anotados`}</span>}
          </div>
        </section>

        {/* Cliente */}
        <section className="atd-bloco">
          <h3><UserRound size={16} /> Cliente</h3>
          <div className="atd-cliente">
            <div>
              <b>{p.cliente_nome || 'Cliente'}</b>
              {tel && <span>{telFormatado(tel)}</span>}
            </div>
            {vezes != null && (vezes === 0
              ? <span className="atd-selo atd-selo--novo"><Sparkles size={12} /> 1º pedido</span>
              : <span className="atd-selo">{vezes + 1}º pedido</span>)}
          </div>
          {tel && (
            <div className="atd-botoes">
              <a className="ent-botao ent-botao--whats" href={whats(tel)} target="_blank" rel="noopener"><MessageCircle size={17} /> WhatsApp</a>
              <a className="ent-botao" href={`tel:${tel}`}><Phone size={17} /> Ligar</a>
            </div>
          )}
          {tel && !feito && (
            <>
              <button className="atd-msgs-btn" onClick={() => setMsgs((v) => !v)} aria-expanded={msgs}><MessageCircle size={15} /> Mensagens prontas para o cliente</button>
              {msgs && (
                <div className="atd-msgs">
                  {mensagens(p, r).map((m) => (
                    <a key={m.id} href={whats(tel, m.texto)} target="_blank" rel="noopener"><b>{m.rotulo}</b><small>{m.texto}</small></a>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* Entrega */}
        {p.tipo === 'delivery' && (
          <section className="atd-bloco">
            <h3><MapPin size={16} /> Endereço de entrega</h3>
            {e ? (
              <p className="ent-end">
                <MapPin size={16} />
                <span>
                  {e.rua}, {e.numero}{e.complemento ? ` · ${e.complemento}` : ''}
                  <strong>{e.bairro}{e.distancia_km != null ? ` · ${String(e.distancia_km).replace('.', ',')} km` : ''}</strong>
                  {e.referencia && <em>Ref.: {e.referencia}</em>}
                </span>
              </p>
            ) : <p className="muted" style={{ margin: 0 }}>Endereço não informado.</p>}
            {p.frete_gratis && <p className="ent-frete"><Gift size={16} /> <span><b>Frete grátis</b> (promoção do dia). O cliente não paga a entrega.</span></p>}
            {!feito && (
              <div className="atd-entregador">
                <span><Bike size={16} /> Entregador</span>
                {entregadores.length ? (
                  <select className="select" value={p.entregador_id ?? ''} disabled={ocupado || !!p.saiu_em} onChange={(ev) => void acoes.entrega(p, 'entrega_atribuir', ev.target.value)} aria-label="Entregador">
                    <option value="">{p.entregador_id ? 'Tirar entregador' : 'Escolher…'}</option>
                    {entregadores.map((m) => <option key={m.user_id} value={m.user_id}>{m.nome}</option>)}
                  </select>
                ) : <b>{p.entregador_nome ?? 'Nenhum cadastrado'}</b>}
              </div>
            )}
            {p.saiu_em && <p className="atd-linha"><Navigation size={15} /> Saiu às {hora(p.saiu_em)}{p.entregador_nome ? ` com ${p.entregador_nome}` : ''}{p.entregue_em ? ` · entregue às ${hora(p.entregue_em)}` : ''}</p>}
          </section>
        )}

        {/* Pagamento */}
        <section className="atd-bloco">
          <h3><Wallet size={16} /> Pagamento</h3>
          <div className={cx('ent-cobrar', p.pago_em && 'pago')}>
            <Wallet size={18} />
            {p.pago_em ? (
              <span><b>Já está pago</b><small>{FORMA[p.forma_pagamento ?? ''] ?? 'Pago'} · não cobrar nada do cliente</small></span>
            ) : (
              <span>
                <b>Cobrar {brl(total)}</b>
                <small>{FORMA[p.forma_pagamento ?? ''] ?? 'Combinar com o cliente'} {p.tipo === 'retirada' ? 'na retirada' : 'na entrega'}{p.forma_pagamento === 'credito' || p.forma_pagamento === 'debito' ? ' · levar a maquininha' : ''}</small>
                {troco > 0 && <small className="ent-troco">Levar troco: <b>{brl(troco)}</b> (paga com {brl(Number(p.troco_para))})</small>}
              </span>
            )}
          </div>
          <div className="atd-totais">
            <div><span>Itens</span><span>{brl(subtotal)}</span></div>
            {p.tipo === 'delivery' && <div><span>Entrega</span><span>{p.frete_gratis ? 'Grátis' : brl(Number(p.taxa_entrega ?? 0))}</span></div>}
            {Number(p.desconto ?? 0) > 0 && <div><span>Desconto</span><span>− {brl(Number(p.desconto))}</span></div>}
            {Number(p.acrescimo ?? 0) > 0 && <div><span>Acréscimo</span><span>{brl(Number(p.acrescimo))}</span></div>}
            <div className="atd-totais__total"><span>Total</span><span>{brl(total)}</span></div>
          </div>
        </section>

        {p.status === 'cancelado' && p.cancel_motivo && <p className="atd-cancelado"><Ban size={16} /> Cancelado: {p.cancel_motivo}</p>}

        <section className="atd-ferramentas">
          <button className="ent-botao" onClick={() => void acoes.imprimir(p)}><Printer size={17} /> Imprimir</button>
          <button className="ent-botao" onClick={() => void copiar()}><Copy size={17} /> Copiar pedido</button>
          {!feito && <button className="ent-botao atd-botao--perigo" onClick={() => void acoes.cancelar(p)}><Ban size={17} /> {p.status === 'novo' ? 'Recusar' : 'Cancelar'}</button>}
        </section>
      </div>

      {principal && <footer className="atd-comanda__acao">{principal}</footer>}
    </aside>
  );
}

function ItemComanda({ i, marcado, aoMarcar, podeMarcar }: { i: PedidoItem; marcado: boolean; aoMarcar: () => void; podeMarcar: boolean }) {
  // Adicionais um por um, agrupados (Sabores, Borda, Extras…)
  const grupos = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const a of i.adicionais ?? []) {
      const chave = a.grupo || 'Adicionais';
      g.set(chave, [...(g.get(chave) ?? []), `${a.qtd && a.qtd > 1 ? `${a.qtd}× ` : ''}${a.nome}`]);
    }
    return [...g.entries()];
  }, [i.adicionais]);
  const conteudo = (
    <>
      <span className="atd-item__check" aria-hidden="true">{marcado && <Check size={16} strokeWidth={3} />}</span>
      <span className="atd-item__qtd">{i.qtd}×</span>
      <span className="atd-item__txt">
        <b>{i.nome}</b>
        {grupos.length ? grupos.map(([g, l]) => <small key={g}><em>{g}:</em> {l.join(', ')}</small>)
          : i.complementos && <small>{i.complementos}</small>}
        {i.obs && <mark>Obs.: {i.obs}</mark>}
      </span>
    </>
  );
  return (
    <li className={cx('atd-item', marcado && 'marcado')}>
      {podeMarcar ? <button onClick={aoMarcar} aria-pressed={marcado}>{conteudo}</button> : <div>{conteudo}</div>}
    </li>
  );
}

/* ---------------- Ajustes: abrir/fechar, tempo, esgotados, avisos ---------------- */
type ProdutoEsg = { id: string; nome: string; esgotado: boolean; ativo: boolean };

function Ajustes({ restauranteId, loja, aoMudarLoja, som, aoSom, insistir, aoInsistir, telaAcesa, aoTelaAcesa, push, aoAtivarPush }: {
  restauranteId: string; loja: { aberto: boolean; tempo: string }; aoMudarLoja: (aberto: boolean | null, tempo: string | null) => void;
  som: boolean; aoSom: (v: boolean) => void; insistir: boolean; aoInsistir: (v: boolean) => void; telaAcesa: boolean; aoTelaAcesa: (v: boolean) => void;
  push: EstadoPush | null; aoAtivarPush: () => void;
}) {
  const toast = useToast();
  const [produtos, setProdutos] = useState<ProdutoEsg[] | null>(null);
  const [busca, setBusca] = useState('');
  const [mudando, setMudando] = useState<string | null>(null);
  useEffect(() => {
    void supabase.from('produtos').select('id, nome, esgotado, ativo').eq('restaurante_id', restauranteId).order('nome')
      .then(({ data }) => setProdutos(((data ?? []) as ProdutoEsg[]).filter((x) => x.ativo !== false)));
  }, [restauranteId]);

  async function esgotar(x: ProdutoEsg, v: boolean) {
    setMudando(x.id);
    setProdutos((l) => l?.map((y) => (y.id === x.id ? { ...y, esgotado: v } : y)) ?? null);
    const { error } = await supabase.rpc('produto_esgotar', { p_produto: x.id, p_esgotado: v });
    setMudando(null);
    if (error) {
      setProdutos((l) => l?.map((y) => (y.id === x.id ? { ...y, esgotado: !v } : y)) ?? null);
      return toast(msgErro(error), 'erro');
    }
    toast(v ? `${x.nome} esgotado: sumiu do cardápio.` : `${x.nome} voltou ao cardápio.`, 'ok');
  }

  const termo = normalizar(busca.trim());
  const esgotados = (produtos ?? []).filter((x) => x.esgotado);
  const lista = (produtos ?? []).filter((x) => (termo ? normalizar(x.nome).includes(termo) : x.esgotado));

  return (
    <>
      <div className="gsecao"><h2>Ajustes</h2></div>

      <section className={cx('atd-ajuste atd-ajuste--loja', loja.aberto ? 'aberta' : 'fechada')}>
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><Store size={20} /></span>
          <div><b>Cardápio digital {loja.aberto ? 'aberto' : 'fechado'}</b><small>{loja.aberto ? 'Os clientes estão conseguindo pedir.' : 'Ninguém consegue pedir até abrir de novo.'}</small></div>
          <Switch marcado={loja.aberto} aoMudar={(v) => {
            if (v) return aoMudarLoja(true, null);
            void confirmar('Fechar o cardápio digital agora? Os clientes não vão conseguir fazer pedidos até você abrir de novo.', { sim: 'Fechar', perigo: true }).then((ok) => { if (ok) aoMudarLoja(false, null); });
          }} />
        </div>
      </section>

      <section className="atd-ajuste">
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><Timer size={20} /></span>
          <div><b>Tempo de entrega</b><small>O cliente vê no cardápio. Aumente quando a cozinha estiver cheia.</small></div>
        </div>
        <div className="atd-tempos">
          {TEMPOS.map((t) => <button key={t} className={cx(loja.tempo === t && 'ativo')} onClick={() => loja.tempo !== t && aoMudarLoja(null, t)}>{t.replace(' min', '')}<small>min</small></button>)}
        </div>
      </section>

      <section className="atd-ajuste">
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><Package size={20} /></span>
          <div><b>Itens esgotados</b><small>{esgotados.length ? `${esgotados.length} ${esgotados.length === 1 ? 'item fora' : 'itens fora'} do cardápio agora` : 'Acabou algo? Esgote e ele some do cardápio na hora.'}</small></div>
        </div>
        <label className="atd-busca">
          <Search size={17} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar produto para esgotar" />
          {busca && <button onClick={() => setBusca('')} aria-label="Limpar busca"><X size={16} /></button>}
        </label>
        {!produtos ? <Carregando /> : lista.length > 0 && (
          <ul className="atd-produtos">
            {lista.slice(0, 40).map((x) => (
              <li key={x.id} className={cx(x.esgotado && 'esgotado')}>
                <span>{x.nome}{x.esgotado && <small>Esgotado</small>}</span>
                <button className={cx('btn btn--sm', x.esgotado ? 'btn--sucesso' : 'btn--contorno')} disabled={mudando === x.id} onClick={() => void esgotar(x, !x.esgotado)}>
                  {x.esgotado ? 'Voltou' : 'Esgotou'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {produtos && termo && lista.length === 0 && <p className="muted atd-ajuste__nada">Nenhum produto com esse nome.</p>}
      </section>

      <section className="atd-ajuste">
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><BellRing size={20} /></span>
          <div><b>Som de pedido novo</b><small>Toca quando chega pedido.</small></div>
          <Switch marcado={som} aoMudar={aoSom} />
        </div>
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><RefreshCw size={20} /></span>
          <div><b>Repetir até atender</b><small>Toca de novo a cada 15 s enquanto tiver pedido novo esperando.</small></div>
          <Switch marcado={insistir} aoMudar={aoInsistir} />
        </div>
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><Sun size={20} /></span>
          <div><b>Tela sempre acesa</b><small>A tela não apaga com o app aberto.</small></div>
          <Switch marcado={telaAcesa} aoMudar={aoTelaAcesa} />
        </div>
        <div className="atd-ajuste__linha">
          <span className="atd-ajuste__icone"><ClipboardList size={20} /></span>
          <div>
            <b>Avisos com o app fechado</b>
            <small>{push === 'ativo' ? 'Ativos neste aparelho.' : push === 'bloqueado' ? 'Bloqueados: libere em Permissões › Notificações.' : push === 'precisa-instalar' ? 'No iPhone: Compartilhar › Adicionar à Tela de Início.' : push === 'indisponivel' ? 'Este navegador não tem avisos. Use o Chrome.' : 'Avisa mesmo com a tela bloqueada.'}</small>
          </div>
          {push === 'inativo' && <button className="btn btn--primario btn--sm" onClick={aoAtivarPush}>Ativar</button>}
          {push === 'ativo' && <span className="atd-selo atd-selo--pago"><Check size={12} /> Ativo</span>}
        </div>
        <button className="btn btn--contorno btn--bloco" onClick={() => tocarAlerta('pedido')}><Volume2 size={17} /> Testar o som</button>
      </section>
    </>
  );
}
