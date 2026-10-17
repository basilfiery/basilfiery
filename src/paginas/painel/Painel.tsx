import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import {
  Banknote, BarChart3, Bell, BellRing, BookOpen, Bot, Building2, ChevronDown, ChevronsUpDown, ClipboardList, Eye, History, LayoutGrid, Lock, LockOpen, LogOut, Moon, Package, Printer, RefreshCw, Search, Settings, ShieldCheck, Smartphone, Store, Sun, UserCog, UserRound, Users, Volume2, VolumeX, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { AvisoAtualizacao, ModalCaixa, type ModoCaixa } from './Caixa';
import { Logo, Switch } from '../../componentes/Basicos';
import { Avatar, ModalPerfil, iniciais } from '../../componentes/Perfil';
import { AcessosPendentes } from '../../componentes/AcessosMesa';
import { Suspenso } from '../../componentes/Suspenso';
import { useToast } from '../../componentes/Toast';
import {
  EVENTO_CONFIG_IMPRESSAO, EVENTO_ERRO_IMPRESSAO, gravarConfigImpressao, imprimirConta, imprimirPedido, imprimirTeste,
  lerConfigImpressao, programaDesktop,
} from '../../lib/impressao';
import { useSessao } from '../../lib/sessao';
import { definirSom, notificarLocal, somLigado, tocarAlerta, tocarChamado } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, MesaAcesso, Papel, Pedido, RestauranteComPapel, ResumoCaixa } from '../../lib/tipos';
import { PAPEL_ROTULO, brl, cx, descreverChamado, ehGestor, hora, ls, podeCaixa, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import { adiarAtualizacao, aplicarAtualizacao, useNovaVersao, versaoAdiada } from '../../lib/versao';
import '../../estilos/painel.css';

export interface ContextoPainel {
  restaurante: RestauranteComPapel;
  papel: Papel;
  pedidos: Pedido[];
  chamados: Chamado[];
  acessos: MesaAcesso[];
  conectado: boolean;
  carregando: boolean;
  recarregar: () => Promise<void>;
  atualizarPedido: (id: string, mudancas: Partial<Pedido>) => void;
  /** Caixa aberto agora (null = fechado, undefined = carregando) */
  caixa: ResumoCaixa | null | undefined;
  abrirCaixa: () => void;
  recarregarCaixa: () => void;
  /** Texto digitado na busca da barra superior */
  busca: string;
}

export const usePainel = () => useOutletContext<ContextoPainel>();

const TODOS: Papel[] = ['dono', 'gerente', 'caixa', 'garcom'];
const MENU: { para: string; icone: LucideIcon; rotulo: string; papeis: Papel[]; fim?: boolean }[] = [
  { para: '/painel', icone: ClipboardList, rotulo: 'Pedidos', papeis: TODOS, fim: true },
  { para: '/painel/mesas', icone: LayoutGrid, rotulo: 'Mesas', papeis: TODOS },
  { para: '/painel/cardapio', icone: BookOpen, rotulo: 'Cardápio', papeis: ['dono', 'gerente'] },
  { para: '/painel/estoque', icone: Package, rotulo: 'Estoque', papeis: ['dono', 'gerente', 'caixa'] },
  { para: '/painel/relatorios', icone: BarChart3, rotulo: 'Relatórios', papeis: ['dono', 'gerente', 'caixa'] },
  { para: '/painel/garcons', icone: UserRound, rotulo: 'Garçons', papeis: ['dono', 'gerente'] },
  { para: '/painel/equipe', icone: Users, rotulo: 'Equipe', papeis: ['dono', 'gerente'] },
  { para: '/painel/config', icone: Settings, rotulo: 'Configurações', papeis: TODOS },
];

const PLANO_ROTULO: Record<string, string> = {
  teste: 'Teste gratuito',
  essencial: 'Plano Essencial',
  profissional: 'Plano Profissional',
  rede: 'Plano Rede',
};

type Tema = 'claro' | 'escuro';


export default function Painel() {
  const s = useSessao();
  const toast = useToast();
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [permissaoNotif, setPermissaoNotif] = useState<NotificationPermission | 'indisponivel'>(
    () => ('Notification' in window ? Notification.permission : 'indisponivel'),
  );
  const local = useLocation();
  const navegar = useNavigate();
  const r = s.restaurante;
  const [som, setSom] = useState(somLigado());
  const [cfgImp, setCfgImp] = useState(lerConfigImpressao());
  const [busca, setBusca] = useState('');
  const buscaRef = useRef<HTMLInputElement>(null);
  const agora = useAgora(30000);

  /* ---------- Tema claro/escuro (só no painel) ---------- */
  const [tema, setTema] = useState<Tema>(() => ls.ler<Tema>('bf:tema', 'claro'));
  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    ls.gravar('bf:tema', tema);
    return () => { delete document.documentElement.dataset.tema; };
  }, [tema]);

  // Ctrl+K: foca a busca
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        buscaRef.current?.focus();
        buscaRef.current?.select();
      }
    };
    document.addEventListener('keydown', atalho);
    return () => document.removeEventListener('keydown', atalho);
  }, []);

  const vivo = usePedidosAoVivo(r?.id, {
    aoNovoPedido: (p) => {
      tocarAlerta('pedido');
      const itens = (p.pedido_itens ?? []).map((i) => `${i.qtd}× ${i.nome}`);
      const resumo = itens.length > 3 ? `${itens.slice(0, 3).join(', ')} e mais ${itens.length - 3}` : itens.join(', ');
      notificarLocal(`Chegou um novo pedido! #${p.numero} · ${p.mesa_nome}`, [resumo, `Total ${brl(p.total)}`].filter(Boolean).join(' · '), `pedido-${p.id}`);
    },
    aoNovoChamado: (c) => {
      tocarChamado(r?.som_chamado);
      notificarLocal(`${c.mesa_nome}: ${descreverChamado(c)}`, c.detalhe ?? 'Toque para ver.', `chamado-${c.id}`);
    },
    aoNovoAcesso: (a) => {
      tocarChamado(r?.som_chamado);
      notificarLocal(`${a.mesa_nome} quer fazer pedidos`, `${a.aparelho ?? 'Um aparelho'} pediu para abrir a mesa. Libere no sistema.`, `acesso-${a.id}`);
    },
  });

  // Chamado é obrigatório: enquanto ninguém marcar "Atendido", o toque repete a cada 30 s
  const somChamadoRef = useRef(r?.som_chamado);
  somChamadoRef.current = r?.som_chamado;
  const haChamados = vivo.chamados.length > 0 || vivo.acessos.length > 0;
  useEffect(() => {
    if (!haChamados) return;
    const i = setInterval(() => tocarChamado(somChamadoRef.current), 30000);
    return () => clearInterval(i);
  }, [haChamados]);

  /* ---------- Fila de impressão: o garçom pede a conta pelo celular, este computador imprime ---------- */
  const cfgImpRef = useRef(cfgImp);
  cfgImpRef.current = cfgImp;
  const restRef = useRef(r);
  restRef.current = r;
  useEffect(() => {
    if (!r?.id) return;
    const rest = r.id;
    const atender = async (item: { id: string; mesa_id: string | null; criado_em: string }) => {
      if (!cfgImpRef.current.auto || !item.mesa_id) return; // só o computador que imprime
      if (Date.now() - new Date(item.criado_em).getTime() > 15 * 60000) return;
      const { data: pegou } = await supabase.rpc('impressao_reivindicar', { p_id: item.id });
      if (!pegou) return; // outro computador já imprimiu
      const [{ data: mesa }, { data: peds }] = await Promise.all([
        supabase.from('mesas').select('nome').eq('id', item.mesa_id).single(),
        supabase.from('pedidos').select('*, pedido_itens(*)').eq('mesa_id', item.mesa_id)
          .is('pago_em', null).neq('status', 'cancelado').order('criado_em'),
      ]);
      const nomeRest = restRef.current?.nome ?? '';
      if (mesa && peds?.length) imprimirConta(mesa.nome, nomeRest, peds as Pedido[]);
    };
    // Pendentes de antes deste computador abrir
    void supabase.from('fila_impressao').select('id, mesa_id, criado_em').eq('restaurante_id', rest).is('impresso_em', null)
      .then(({ data }) => (data ?? []).forEach((i) => void atender(i)));
    const canal = supabase
      .channel(`fila-${rest}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'fila_impressao', filter: `restaurante_id=eq.${rest}` },
        (payload) => void atender(payload.new as { id: string; mesa_id: string | null; criado_em: string }))
      .subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [r?.id, cfgImp.auto]);

  /* ---------- Caixa (aberto/fechado), sincronizado entre computadores ---------- */
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined);
  const [modoCaixa, setModoCaixa] = useState<ModoCaixa | null>(null);
  const rid = r?.id;
  const carregarCaixa = useCallback(async () => {
    if (!rid) return;
    const { data, error } = await supabase.rpc('caixa_atual', { p_rest: rid });
    if (!error) setCaixa((data as ResumoCaixa | null) ?? null);
  }, [rid]);

  useEffect(() => {
    if (!rid) return;
    setCaixa(undefined);
    void carregarCaixa();
    const canal = supabase
      .channel(`caixa-${rid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'caixas', filter: `restaurante_id=eq.${rid}` }, () => void carregarCaixa())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'caixa_movimentos', filter: `restaurante_id=eq.${rid}` }, () => void carregarCaixa())
      .subscribe();
    const i = setInterval(() => void carregarCaixa(), 60000);
    return () => { void supabase.removeChannel(canal); clearInterval(i); };
  }, [rid, carregarCaixa]);

  // Pedido novo / conta fechada mudam os números do caixa
  const assinaturaPedidos = useMemo(() => vivo.pedidos.map((p) => `${p.id}:${p.status}:${p.pago_em ?? ''}`).join('|'), [vivo.pedidos]);
  useEffect(() => {
    const t = setTimeout(() => void carregarCaixa(), 1000);
    return () => clearTimeout(t);
  }, [assinaturaPedidos, carregarCaixa]);

  /* ---------- Atualização do sistema ---------- */
  const novaVersao = useNovaVersao();
  const [adiada, setAdiada] = useState(versaoAdiada());
  const caixaAberto = !!caixa;
  const pendenteNoFechamento = !!novaVersao && adiada === novaVersao && caixaAberto;

  useEffect(() => {
    const atualizar = () => setCfgImp(lerConfigImpressao());
    const erro = (e: Event) => toast(`A impressora não respondeu: ${(e as CustomEvent<string>).detail}. Confira se está ligada e com papel.`, 'erro');
    window.addEventListener(EVENTO_CONFIG_IMPRESSAO, atualizar);
    window.addEventListener(EVENTO_ERRO_IMPRESSAO, erro);
    return () => {
      window.removeEventListener(EVENTO_CONFIG_IMPRESSAO, atualizar);
      window.removeEventListener(EVENTO_ERRO_IMPRESSAO, erro);
    };
  }, [toast]);

  // Impressão automática: só neste computador, se ligada. O banco garante que
  // cada pedido seja impresso uma única vez, mesmo com dois caixas abertos.
  const tentados = useRef(new Set<string>());
  useEffect(() => {
    if (!cfgImp.auto || !r) return;
    const limite = Date.now() - 3 * 3600e3;
    for (const p of vivo.pedidos) {
      if (p.status !== 'novo' || p.impresso_em || tentados.current.has(p.id)) continue;
      if (new Date(p.criado_em).getTime() < limite || p.pedido_itens.length === 0) continue;
      tentados.current.add(p.id);
      void supabase.rpc('pedido_marcar_impresso', { p_pedido: p.id }).then(({ data, error }) => {
        if (error) toast(`Não foi possível imprimir o pedido #${p.numero}: ${msgErro(error)}`, 'erro');
        else if (data) imprimirPedido(p, r.nome);
      });
    }
  }, [vivo.pedidos, cfgImp.auto, r, toast]);

  if (!r) {
    return (
      <div className="tela-login">
        <div className="login card">
          <Logo tamanho="lg" />
          <h1 className="titulo">Nenhum restaurante ligado à sua conta</h1>
          <p className="muted">Peça ao responsável pelo restaurante para adicionar o seu e-mail na equipe.</p>
          {s.ehAdmin && <Link className="btn btn--primario" to="/plataforma">Ir para a plataforma</Link>}
          <button className="btn btn--contorno" onClick={() => void s.sair()}>Sair</button>
        </div>
      </div>
    );
  }

  const papel = r.papel;
  const itens = MENU.filter((m) => m.papeis.includes(papel));
  const atual = MENU.find((m) => (m.fim ? local.pathname === m.para : local.pathname.startsWith(m.para)));
  const permitido = !atual || atual.papeis.includes(papel);
  const naTelaDePedidos = local.pathname === '/painel';
  const novos = vivo.pedidos.filter((p) => p.status === 'novo').length;
  const desktop = programaDesktop();
  const ultimoPedido = vivo.pedidos.filter((p) => p.status !== 'cancelado').slice(-1)[0];

  async function atender(c: Chamado) {
    const { error } = await supabase.rpc('chamado_atender', { p_chamado: c.id });
    if (error) toast(msgErro(error), 'erro');
  }

  function alternarSom() {
    const v = !som;
    setSom(v);
    definirSom(v);
    if (v) tocarAlerta('pronto');
  }

  const ctx: ContextoPainel = {
    restaurante: r,
    papel,
    pedidos: vivo.pedidos,
    chamados: vivo.chamados,
    acessos: vivo.acessos,
    conectado: vivo.conectado,
    carregando: vivo.carregando,
    recarregar: vivo.recarregar,
    atualizarPedido: vivo.atualizarPedido,
    caixa,
    abrirCaixa: () => setModoCaixa('resumo'),
    recarregarCaixa: () => void carregarCaixa(),
    busca,
  };

  const avatarEmpresa = r.logo_url
    ? <span className="avatar"><img src={r.logo_url} alt="" /></span>
    : <span className="avatar" style={{ background: r.cor }}>{iniciais(r.nome)}</span>;

  return (
    <div className="painel" style={{ '--acento': r.cor } as CSSProperties}>
      {/* ================= Barra lateral ================= */}
      <aside className="lateral">
        <Link to="/painel" className="lateral__marca" aria-label="BasilFiery">
          <img src="/favicon.png" alt="" />
          <div>
            <strong>Basil<span>Fiery</span></strong>
            <small>Gestão de pedidos</small>
          </div>
        </Link>

        <nav className="lateral__menu" aria-label="Menu principal">
          {itens.map((m) => (
            <NavLink key={m.para} to={m.para} end={m.fim} title={m.rotulo} className={({ isActive }) => cx('lateral__item', isActive && 'ativo')}>
              <m.icone size={20} strokeWidth={1.8} />
              <span>{m.rotulo}</span>
              {m.para === '/painel' && novos > 0 && <b className="lateral__contador">{novos}</b>}
            </NavLink>
          ))}
        </nav>

        <div className="lateral__rodape">
          <Suspenso
            alinhar="esq"
            largura={240}
            gatilho={(_, alternar) => (
              <button className="usuario-btn" onClick={alternar} aria-label="Menu da conta">
                <Avatar nome={s.nome || 'Usuário'} foto={s.foto} />
                <div>
                  <strong>{s.nome || 'Usuário'}</strong>
                  <small>{PAPEL_ROTULO[papel]}</small>
                </div>
                <ChevronsUpDown size={16} />
              </button>
            )}
          >
            {(fechar) => (
              <>
                <div className="menu-cab">
                  <Avatar nome={s.nome || 'Usuário'} foto={s.foto} />
                  <div><strong>{s.nome || 'Usuário'}</strong><small>{s.usuario?.email}</small></div>
                </div>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { fechar(); setPerfilAberto(true); }}><UserCog size={18} /> Meu perfil</button>
                <Link className="menu-item" to="/garcom" onClick={fechar}><Smartphone size={18} /> Tela do garçom</Link>
                {s.ehAdmin && <Link className="menu-item" to="/plataforma" onClick={fechar}><ShieldCheck size={18} /> Plataforma</Link>}
                <div className="menu-sep" />
                <button className="menu-item menu-item--perigo" onClick={() => void s.sair()}><LogOut size={18} /> Sair</button>
              </>
            )}
          </Suspenso>
        </div>
      </aside>
      {perfilAberto && <ModalPerfil aoFechar={() => setPerfilAberto(false)} />}

      {/* ================= Área principal ================= */}
      <div className="painel__principal">
        <header className="topo">
          <label className="topo__busca">
            <Search size={20} />
            <span className="sr">Buscar</span>
            <input
              ref={buscaRef}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setBusca('');
                if (e.key === 'Enter' && !naTelaDePedidos) navegar('/painel');
              }}
              placeholder="Buscar pedido, mesa ou número..."
            />
            {busca ? (
              <button type="button" className="topo__limpar" onClick={() => setBusca('')} aria-label="Limpar busca">×</button>
            ) : (
              <kbd>Ctrl + K</kbd>
            )}
          </label>

          <div className="topo__acoes">
            {!vivo.conectado && <span className="topo__aviso"><RefreshCw size={14} /> Reconectando…</span>}
            {pendenteNoFechamento && (
              <button className="chip-status chip-status--atualizacao" onClick={aplicarAtualizacao} title="Clique para atualizar agora">
                <RefreshCw size={16} /> <span>Atualiza no fechamento</span>
              </button>
            )}

            {/* Assistente do WhatsApp: ainda não integrado */}
            <Suspenso
              largura={300}
              gatilho={(_, alternar) => (
                <button className="topo-btn topo-btn--icone oculto-mobile" onClick={alternar} title="Assistente do WhatsApp" aria-label="Assistente do WhatsApp">
                  <Bot size={21} strokeWidth={1.8} />
                  <i className="topo-btn__ponto" />
                </button>
              )}
            >
              {() => (
                <>
                  <div className="menu-cab">
                    <span className="avatar avatar--cinza"><Bot size={18} /></span>
                    <div><strong>Assistente do WhatsApp</strong><small>Não conectado</small></div>
                  </div>
                  <p className="menu-texto">
                    A integração com o WhatsApp ainda não está disponível no BasilFiery. Quando estiver, as conversas e as
                    respostas automáticas aparecem aqui.
                  </p>
                </>
              )}
            </Suspenso>

            {/* Caixa: menu com resumo rápido, retirada e fechamento */}
            <Suspenso
              largura={300}
              gatilho={(aberto, alternar) => (
                <button
                  className={cx('topo-btn', aberto && 'ativo')}
                  onClick={alternar}
                  disabled={caixa === undefined}
                  aria-label="Caixa"
                >
                  <Wallet size={20} strokeWidth={1.8} />
                  <span>Caixa</span>
                  <i className={cx('topo-btn__ponto', caixa ? 'on' : caixa === null && 'alerta')} />
                </button>
              )}
            >
              {(fechar) => {
                const abrir = (m: ModoCaixa) => { setModoCaixa(m); fechar(); };
                const pode = podeCaixa(papel);
                return caixa ? (
                  <>
                    <div className="menu-cab">
                      <span className="avatar avatar--ok"><Wallet size={18} /></span>
                      <div>
                        <strong>Caixa aberto</strong>
                        <small>Desde {hora(caixa.aberto_em)}{caixa.aberto_por_nome ? ` · ${caixa.aberto_por_nome}` : ''}</small>
                      </div>
                    </div>
                    <div className="menu-numeros">
                      <div><small>Recebido</small><strong>{brl(caixa.recebido)}</strong></div>
                      <div><small>Na gaveta</small><strong>{brl(caixa.dinheiro_esperado)}</strong></div>
                    </div>
                    <div className="menu-sep" />
                    <button className="menu-item" onClick={() => abrir('resumo')}><Eye size={18} /> Ver resumo do caixa</button>
                    <button className="menu-item" onClick={() => abrir('retirada')} disabled={!pode}><Banknote size={18} /> Retirada (sangria)</button>
                    <button className="menu-item" onClick={() => abrir('fechar')} disabled={!pode}><Lock size={18} /> Fechar caixa</button>
                  </>
                ) : (
                  <>
                    <div className="menu-cab">
                      <span className="avatar avatar--alerta"><Wallet size={18} /></span>
                      <div><strong>Caixa fechado</strong><small>Abra para receber pagamentos</small></div>
                    </div>
                    <div className="menu-sep" />
                    <button className="menu-item" onClick={() => abrir('resumo')} disabled={!pode}><LockOpen size={18} /> Abrir caixa</button>
                    <button className="menu-item" onClick={() => abrir('resumo')}><History size={18} /> Últimos fechamentos</button>
                  </>
                );
              }}
            </Suspenso>

            {/* Impressora */}
            <Suspenso
              largura={300}
              gatilho={(_, alternar) => (
                <button className="topo-btn topo-btn--icone" onClick={alternar} title="Impressão" aria-label="Impressão">
                  <Printer size={20} strokeWidth={1.8} />
                  <i className={cx('topo-btn__ponto', cfgImp.auto && 'on')} />
                </button>
              )}
            >
              {(fechar) => (
                <>
                  <div className="menu-cab">
                    <span className="avatar avatar--cinza"><Printer size={18} /></span>
                    <div>
                      <strong>Impressão</strong>
                      <small>{desktop ? (cfgImp.impressora || 'Impressora padrão do Windows') : 'Pelo navegador'} · {cfgImp.largura} mm</small>
                    </div>
                  </div>
                  <div className="menu-item menu-item--switch">
                    <Switch marcado={cfgImp.auto} aoMudar={(v) => gravarConfigImpressao({ ...cfgImp, auto: v })}>
                      Imprimir pedidos novos automaticamente
                    </Switch>
                  </div>
                  <div className="menu-sep" />
                  <button className="menu-item" disabled={!ultimoPedido} onClick={() => { if (ultimoPedido) imprimirPedido(ultimoPedido, r.nome); fechar(); }}>
                    <Printer size={18} /> Reimprimir último pedido {ultimoPedido && <small>#{ultimoPedido.numero}</small>}
                  </button>
                  <button className="menu-item" onClick={() => { imprimirTeste(r.nome); fechar(); }}>
                    <Printer size={18} /> Imprimir teste
                  </button>
                  <Link className="menu-item" to="/painel/config" onClick={fechar}><Settings size={18} /> Configurar impressora</Link>
                </>
              )}
            </Suspenso>

            {/* Tema */}
            <button
              className="topo-btn topo-btn--icone oculto-mobile"
              onClick={() => setTema((t) => (t === 'claro' ? 'escuro' : 'claro'))}
              title={tema === 'claro' ? 'Usar tema escuro' : 'Usar tema claro'}
              aria-label="Alternar tema"
            >
              {tema === 'claro' ? <Moon size={20} strokeWidth={1.8} /> : <Sun size={20} strokeWidth={1.8} />}
            </button>

            {/* Empresa */}
            <Suspenso
              largura={290}
              gatilho={(_, alternar) => (
                <button className="empresa-btn" onClick={alternar} aria-label="Menu da empresa">
                  {avatarEmpresa}
                  <div>
                    <strong>{r.nome}</strong>
                    <small>{PLANO_ROTULO[r.plano] ?? r.plano}</small>
                  </div>
                  <ChevronDown size={18} />
                </button>
              )}
            >
              {(fechar) => (
                <>
                  <div className="menu-cab">
                    {avatarEmpresa}
                    <div><strong>{r.nome}</strong><small>{PLANO_ROTULO[r.plano] ?? r.plano} · {PAPEL_ROTULO[papel]}</small></div>
                  </div>
                  <div className="menu-sep" />
                  {ehGestor(papel) && (
                    <>
                      <Link className="menu-item" to="/painel/config" onClick={fechar}><Building2 size={18} /> Dados e identidade visual</Link>
                      <Link className="menu-item" to="/painel/equipe" onClick={fechar}><Users size={18} /> Equipe</Link>
                    </>
                  )}
                  <Link className="menu-item" to="/painel/config" onClick={fechar}><Settings size={18} /> Configurações</Link>
                  <button className="menu-item" onClick={alternarSom}>
                    {som ? <Volume2 size={18} /> : <VolumeX size={18} />} Som de novos pedidos <small>{som ? 'Ligado' : 'Desligado'}</small>
                  </button>
                  <button className="menu-item menu-item--mobile" onClick={() => setTema((t) => (t === 'claro' ? 'escuro' : 'claro'))}>
                    {tema === 'claro' ? <Moon size={18} /> : <Sun size={18} />} Tema {tema === 'claro' ? 'escuro' : 'claro'}
                  </button>
                  {s.restaurantes.length > 1 && (
                    <>
                      <div className="menu-sep" />
                      <p className="menu-texto" style={{ paddingBottom: 4 }}>Trocar de restaurante</p>
                      {s.restaurantes.map((x) => (
                        <button key={x.id} className="menu-item" onClick={() => { s.escolherRestaurante(x.id); fechar(); }}>
                          <Store size={18} /> {x.nome} {x.id === r.id && <small>atual</small>}
                        </button>
                      ))}
                    </>
                  )}
                  <div className="menu-sep" />
                  <button className="menu-item menu-item--perigo" onClick={() => void s.sair()}><LogOut size={18} /> Sair</button>
                </>
              )}
            </Suspenso>
          </div>
        </header>

        <AcessosPendentes acessos={vivo.acessos} agora={agora} variante="painel" aoResponder={vivo.removerAcesso} />
        {!desktop && permissaoNotif === 'default' && (
          <div className="aviso-notif">
            <BellRing size={18} />
            <span><b>Receba os pedidos no canto da tela</b>, mesmo com o navegador minimizado.</span>
            <button className="btn btn--sm btn--primario" onClick={() => void Notification.requestPermission().then(setPermissaoNotif)}>Ativar avisos</button>
            <button className="icone-btn" onClick={() => setPermissaoNotif('denied')} aria-label="Agora não"><X size={16} /></button>
          </div>
        )}
        {vivo.chamados.length > 0 && (
          <div className="chamados">
            {vivo.chamados.map((c) => (
              <div key={c.id} className={cx('chamado', c.tipo === 'conta' && 'chamado--conta')}>
                <Bell size={18} />
                <span><b>{c.mesa_nome}</b> · {descreverChamado(c)} · {tempoDesde(c.criado_em, agora)}</span>
                <button className="btn btn--sm btn--contorno" onClick={() => void atender(c)}>Atendido</button>
              </div>
            ))}
          </div>
        )}

        <main className={cx('painel__conteudo', naTelaDePedidos && permitido && 'painel__conteudo--cheio')}>
          {permitido ? <Outlet context={ctx} /> : <p className="vazio">Seu cargo não tem acesso a esta área.</p>}
        </main>
      </div>

      {novaVersao && !pendenteNoFechamento && (
        <AvisoAtualizacao
          caixaAberto={caixaAberto}
          aoAdiar={() => { adiarAtualizacao(novaVersao); setAdiada(novaVersao); }}
        />
      )}

      {modoCaixa && caixa !== undefined && (
        <ModalCaixa
          key={modoCaixa}
          restaurante={{ id: r.id, nome: r.nome }}
          papel={papel}
          caixa={caixa}
          modo={modoCaixa}
          aoFechar={() => setModoCaixa(null)}
          aoMudar={() => void carregarCaixa()}
          atualizarAoConcluir={!!novaVersao}
        />
      )}
    </div>
  );
}
