import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import {
  Banknote, BarChart3, Bell, FileText, BellRing, BookOpen, Bot, Building2, ChevronDown, CircleUserRound, ClipboardList, Clock, Eye, History, LayoutGrid, Lock, LockOpen, LogOut, Menu, MessagesSquare, Moon, Package, Printer, QrCode, Receipt, RefreshCw, Search, Settings, ShieldCheck, ShoppingBasket, ShoppingCart, Smartphone, Store, Sun, UserCog, UserRound, Users, Volume2, VolumeX, Wallet, X,
  type LucideIcon,
} from 'lucide-react';
import { AvisoAtualizacao, ModalCaixa, type ModoCaixa } from './Caixa';
import { Logo, Switch } from '../../componentes/Basicos';
import { Avatar, ModalPerfil, iniciais } from '../../componentes/Perfil';
import { AcessosPendentes } from '../../componentes/AcessosMesa';
import { ModalCardapioDigital } from '../../componentes/CardapioDigital';
import { Suspenso } from '../../componentes/Suspenso';
import { MarcaLateral, tituloMarca } from '../../componentes/MarcaSistema';
import { ErroTela } from '../../componentes/ErroGeral';
import { BalaoSuporte, useCaixaSuporte } from '../../componentes/ChatSuporte';
import { linkAssinar } from '../../config/site';
import { dataBR, linkPagarPlano, situacaoPlano } from '../../lib/fatura';
import { useToast } from '../../componentes/Toast';
import {
  EVENTO_CONFIG_IMPRESSAO, EVENTO_ERRO_IMPRESSAO, definirLojaImpressao, gravarConfigImpressao, imprimirConta, imprimirPedido, imprimirTeste,
  lerConfigImpressao, programaDesktop,
} from '../../lib/impressao';
import { useSessao } from '../../lib/sessao';
import { definirSom, notificarLocal, somLigado, tocarAlerta, tocarChamado } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, MesaAcesso, Papel, Pedido, RestauranteComPapel, ResumoCaixa } from '../../lib/tipos';
import { PAPEL_ROTULO, brl, cx, descreverChamado, duracao, ehGestor, ls, podeCaixa, quando, tempoDesde, useAgora } from '../../lib/util';
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
const GESTORES: Papel[] = ['dono', 'gerente'];
const CAIXA: Papel[] = ['dono', 'gerente', 'caixa'];

interface FilhoMenu { para: string; rotulo: string; papeis?: Papel[]; novo?: boolean }
interface ItemMenu { para: string; icone: LucideIcon; rotulo: string; curto?: string; papeis: Papel[]; fim?: boolean; filhos?: FilhoMenu[] }

/** Menu lateral em seções (como no Anota AI). Itens com "filhos" abrem e fecham. */
const SECOES: { titulo: string; itens: ItemMenu[] }[] = [
  {
    titulo: 'Seu dia a dia',
    itens: [
      { para: '/painel', icone: ClipboardList, rotulo: 'Pedidos', papeis: TODOS, fim: true },
      { para: '/painel/pdv', icone: ShoppingBasket, rotulo: 'Pedidos balcão (PDV)', curto: 'PDV', papeis: TODOS },
      { para: '/painel/mesas', icone: LayoutGrid, rotulo: 'Mesas', papeis: TODOS },
      {
        para: '/painel/cardapio', icone: BookOpen, rotulo: 'Gestor de cardápio', curto: 'Cardápio', papeis: GESTORES,
        filhos: [
          { para: '/painel/cardapio', rotulo: 'Itens e categorias' },
          { para: '/painel/cardapio/aparencia', rotulo: 'Aparência do cardápio', novo: true },
        ],
      },
      { para: '/painel/notas', icone: FileText, rotulo: 'Notas fiscais', papeis: CAIXA },
      { para: '/painel/estoque', icone: Package, rotulo: 'Estoque', papeis: CAIXA },
      { para: '/painel/compras', icone: ShoppingCart, rotulo: 'Lista de compras', curto: 'Compras', papeis: TODOS },
    ],
  },
  {
    titulo: 'Análises',
    itens: [
      {
        para: '/painel/relatorios', icone: BarChart3, rotulo: 'Relatórios', papeis: CAIXA,
        filhos: [
          { para: '/painel/relatorios', rotulo: 'Visão geral' },
          { para: '/painel/relatorios/itens', rotulo: 'Itens', novo: true },
          { para: '/painel/relatorios/mesas', rotulo: 'Mesas e comandas' },
        ],
      },
      { para: '/painel/apps', icone: Smartphone, rotulo: 'Apps no celular', papeis: GESTORES },
    ],
  },
  {
    titulo: 'Equipe',
    itens: [
      { para: '/painel/garcons', icone: UserRound, rotulo: 'Garçons', papeis: GESTORES },
      { para: '/painel/equipe', icone: Users, rotulo: 'Equipe', papeis: GESTORES },
    ],
  },
  {
    titulo: 'Configurações',
    itens: [
      {
        para: '/painel/conta', icone: CircleUserRound, rotulo: 'Minha conta', papeis: ['dono'],
        filhos: [
          { para: '/painel/conta', rotulo: 'Geral' },
          { para: '/painel/conta/pessoais', rotulo: 'Informações pessoais' },
          { para: '/painel/conta/pagamento', rotulo: 'Formas de pagamento' },
          { para: '/painel/conta/faturas', rotulo: 'Fatura' },
        ],
      },
      {
        para: '/painel/config', icone: Settings, rotulo: 'Configurações', papeis: TODOS,
        filhos: [
          { para: '/painel/config/clientes', rotulo: 'Meus clientes', papeis: CAIXA, novo: true },
          { para: '/painel/config/pedidos', rotulo: 'Meus pedidos', papeis: CAIXA },
          { para: '/painel/config/impressora', rotulo: 'Impressora' },
          { para: '/painel/config/integracoes', rotulo: 'Integrações', papeis: GESTORES },
          { para: '/painel/config/cardapio-digital', rotulo: 'Cardápio digital', papeis: GESTORES, novo: true },
          { para: '/painel/config/estabelecimento', rotulo: 'Estabelecimento', papeis: GESTORES },
          { para: '/painel/config/nota-fiscal', rotulo: 'Nota fiscal', papeis: GESTORES, novo: true },
          { para: '/painel/config/anuncios', rotulo: 'Integração de anúncios', papeis: GESTORES },
          { para: '/painel/config/logo-sistema', rotulo: 'Logo do sistema', papeis: GESTORES, novo: true },
          { para: '/painel/dominios', rotulo: 'Domínios', papeis: GESTORES, novo: true },
          { para: '/painel/config/avisos', rotulo: 'Avisos e sons' },
        ],
      },
    ],
  },
  {
    titulo: 'Central BasilFiery',
    itens: [
      { para: '/painel/termos', icone: ShieldCheck, rotulo: 'Termos e políticas', papeis: TODOS },
    ],
  },
];

/** Todas as telas (itens e subitens), para conferir permissão e para a busca do menu. */
const TELAS = SECOES.flatMap((sec) => sec.itens.flatMap((m) => [
  { para: m.para, rotulo: m.rotulo, papeis: m.papeis, fim: m.fim ?? !!m.filhos, icone: m.icone, pai: undefined as string | undefined },
  ...(m.filhos ?? []).map((f) => ({ para: f.para, rotulo: f.rotulo, papeis: f.papeis ?? m.papeis, fim: true, icone: m.icone, pai: m.rotulo })),
]));
const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const PLANO_ROTULO: Record<string, string> = {
  teste: 'Teste gratuito',
  start: 'Plano Start',
  premium: 'Plano Premium',
  essencial: 'Plano Start',
  profissional: 'Plano Premium',
  rede: 'Plano Rede',
};

type Tema = 'claro' | 'escuro';

function useMedia(consulta: string) {
  const [v, setV] = useState(() => window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudar = () => setV(m.matches);
    m.addEventListener('change', mudar);
    return () => m.removeEventListener('change', mudar);
  }, [consulta]);
  return v;
}


export default function Painel() {
  const s = useSessao();
  const toast = useToast();
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [cardapioDigital, setCardapioDigital] = useState(false);
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
  // Administrador: avisa quando uma loja escreve no suporte
  const suporte = useCaixaSuporte(s.ehAdmin, (m) => {
    const loja = s.restaurantes.find((x) => x.id === m.restaurante_id)?.nome ?? 'uma loja';
    toast(`Suporte: nova mensagem de ${loja}`, 'ok');
    if (somLigado()) tocarChamado('sino');
    notificarLocal(`Suporte · ${loja}`, m.texto, 'suporte-admin');
  });
  /* ---------- Menu lateral: gaveta (tela menor), grupos abertos e busca ---------- */
  const [gaveta, setGaveta] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [buscaMenu, setBuscaMenu] = useState('');
  const trilho = useMedia('(max-width: 1360px)');
  useEffect(() => { setGaveta(false); setBuscaMenu(''); }, [local.pathname]);

  // Nome da janela (programa do Windows) e da aba: segue a marca escolhida em Configurações › Logo do sistema
  const nomeJanela = r ? tituloMarca(r) : 'BasilFiery';
  useEffect(() => {
    const antes = document.title;
    document.title = `${nomeJanela} — Gestão de pedidos`;
    return () => { document.title = antes; };
  }, [nomeJanela]);
  useEffect(() => {
    if (!gaveta) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setGaveta(false); };
    document.addEventListener('keydown', fechar);
    return () => document.removeEventListener('keydown', fechar);
  }, [gaveta]);

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

  /* ---------- Lista de compras: contador e aviso de quem pediu acesso ---------- */
  const [compras, setCompras] = useState({ itens: 0, pessoas: 0 });
  const idCompras = r?.id;
  const gestorAqui = r?.papel === 'dono' || r?.papel === 'gerente';
  useEffect(() => {
    if (!idCompras) return;
    const contar = async () => {
      const [a, b] = await Promise.all([
        supabase.from('compras_itens').select('id', { count: 'exact', head: true }).eq('restaurante_id', idCompras).eq('status', 'pendente'),
        gestorAqui ? supabase.from('compras_pessoas').select('id', { count: 'exact', head: true }).eq('restaurante_id', idCompras).eq('status', 'pendente') : Promise.resolve({ count: 0 }),
      ]);
      setCompras({ itens: a.count ?? 0, pessoas: b.count ?? 0 });
    };
    void contar();
    const canal = supabase.channel(`compras-${idCompras}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_itens', filter: `restaurante_id=eq.${idCompras}` }, () => void contar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_pessoas', filter: `restaurante_id=eq.${idCompras}` }, (e) => {
        void contar();
        const nova = e.new as { nome?: string; status?: string } | null;
        if (gestorAqui && e.eventType === 'INSERT' && nova?.nome) toast(`${nova.nome} pediu acesso à lista de compras.`, 'info');
      })
      .subscribe();
    return () => { void supabase.removeChannel(canal); };
  }, [idCompras, gestorAqui, toast]);

  // Cabeçalho, logo e modelos de impressão deste restaurante
  useEffect(() => { if (r) definirLojaImpressao(r); }, [r]);

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
        else if (data) imprimirPedido(p, r.nome, { automatico: true });
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

  // Assinatura suspensa (cancelada, vencida ou reembolsada): o painel fica bloqueado até renovar
  if (!r.ativo && !s.ehAdmin) {
    const destino = linkAssinar();
    return (
      <div className="tela-login">
        <div className="login card">
          <Logo tamanho="lg" />
          <h1 className="titulo">Assinatura suspensa</h1>
          <p className="muted">O acesso de <b>{r.nome}</b> está pausado porque a assinatura não está em dia. Renove para voltar a usar. Seus dados continuam guardados.</p>
          <a className="btn btn--primario" href={destino} target={destino.startsWith('http') ? '_blank' : undefined} rel="noopener">Renovar assinatura</a>
          {s.restaurantes.length > 1 && <p className="muted">Você tem outras lojas: troque no menu da conta.</p>}
          <button className="btn btn--contorno" onClick={() => void s.sair()}>Sair</button>
        </div>
      </div>
    );
  }

  const papel = r.papel;
  const secoes = SECOES
    .map((sec) => ({
      ...sec,
      itens: sec.itens.filter((m) => m.papeis.includes(papel))
        .map((m) => ({ ...m, filhos: m.filhos?.filter((f) => (f.papeis ?? m.papeis).includes(papel)) })),
    }))
    .filter((sec) => sec.itens.length > 0);
  const atual = TELAS
    .filter((t) => (t.fim ? local.pathname === t.para : local.pathname.startsWith(t.para)))
    .sort((a, b) => b.para.length - a.para.length)[0];
  const permitido = !atual || atual.papeis.includes(papel);
  const termo = semAcento(buscaMenu.trim());
  const resultados = termo
    ? TELAS.filter((t, i) => t.papeis.includes(papel) && TELAS.findIndex((x) => x.para === t.para) === i && semAcento(`${t.rotulo} ${t.pai ?? ''}`).includes(termo))
    : [];
  const atalhos = secoes[0]?.itens.slice(0, 4) ?? [];
  const grupoAberto = (m: ItemMenu) => abertos[m.para] ?? local.pathname.startsWith(m.para);
  const alternarGrupo = (m: ItemMenu) => {
    // Barra só com ícones: abre o menu inteiro já com o grupo aberto
    if (trilho && !gaveta) {
      setGaveta(true);
      setAbertos((a) => ({ ...a, [m.para]: true }));
      return;
    }
    setAbertos((a) => ({ ...a, [m.para]: !grupoAberto(m) }));
  };
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
      {/* ================= Barra lateral (estilo Anota AI) ================= */}
      {gaveta && <div className="lateral-fundo" onClick={() => setGaveta(false)} aria-hidden="true" />}
      <aside className={cx('lateral', gaveta && 'lateral--gaveta')}>
        <div className="lateral__topo">
          <Link to="/painel" className="lateral__marca" aria-label={tituloMarca(r)}>
            <MarcaLateral r={r} />
          </Link>
          <button className="lateral__fechar" onClick={() => setGaveta(false)} aria-label="Fechar menu"><X size={20} /></button>
        </div>
        <button className="lateral__expandir" onClick={() => setGaveta(true)} aria-label="Abrir menu completo" title="Abrir menu completo"><Menu size={21} /></button>

        <label className="lateral__busca">
          <Search size={17} />
          <span className="sr">Buscar no menu</span>
          <input
            value={buscaMenu}
            onChange={(e) => setBuscaMenu(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setBuscaMenu('');
              if (e.key === 'Enter' && resultados[0]) navegar(resultados[0].para);
            }}
            placeholder="Procurando por algo?"
          />
        </label>

        <nav className="lateral__menu" aria-label="Menu principal">
          {termo ? (
            resultados.length ? (
              <div className="lateral__secao">
                <p className="lateral__titulo">Resultados</p>
                {resultados.map((t) => (
                  <NavLink key={t.para} to={t.para} end className={({ isActive }) => cx('lateral__item', isActive && 'ativo')}>
                    <t.icone size={20} strokeWidth={1.8} />
                    <span>{t.rotulo}{t.pai && <small>{t.pai}</small>}</span>
                  </NavLink>
                ))}
              </div>
            ) : <p className="lateral__nada">Nada encontrado para “{buscaMenu.trim()}”.</p>
          ) : secoes.map((sec) => (
            <div key={sec.titulo} className="lateral__secao">
              <p className="lateral__titulo">{sec.titulo}</p>
              {sec.itens.map((m) => (m.filhos?.length ? (
                <div key={m.para} className={cx('lateral__grupo', grupoAberto(m) && 'aberto')}>
                  <button
                    type="button"
                    className={cx('lateral__item', local.pathname.startsWith(m.para) && 'ativo')}
                    title={m.rotulo}
                    aria-expanded={grupoAberto(m)}
                    onClick={() => alternarGrupo(m)}
                  >
                    <m.icone size={20} strokeWidth={1.8} />
                    <span>{m.rotulo}</span>
                    <ChevronDown size={16} className="lateral__seta" />
                  </button>
                  {grupoAberto(m) && (
                    <div className="lateral__filhos">
                      {m.filhos.map((f) => (
                        <NavLink key={f.para} to={f.para} end className={({ isActive }) => cx('lateral__filho', isActive && 'ativo')}>
                          <span>{f.rotulo}</span>
                          {f.novo && <em className="lateral__novo">Novo</em>}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <NavLink key={m.para} to={m.para} end={m.fim} title={m.rotulo} className={({ isActive }) => cx('lateral__item', isActive && 'ativo')}>
                  <m.icone size={20} strokeWidth={1.8} />
                  <span>{m.rotulo}</span>
                  {m.para === '/painel' && novos > 0 && <b className="lateral__contador">{novos}</b>}
                  {m.para === '/painel/compras' && compras.itens + compras.pessoas > 0 && <b className={cx('lateral__contador', compras.pessoas > 0 && 'lateral__contador--alerta')}>{compras.itens + compras.pessoas}</b>}
                </NavLink>
              )))}
            </div>
          ))}
        </nav>

        <div className="lateral__rodape">
          <Suspenso
            alinhar="esq"
            largura={240}
            gatilho={(_, alternar) => (
              <button className="usuario-btn" onClick={alternar} aria-label="Menu da conta">
                {avatarEmpresa}
                <div>
                  <strong>{r.nome}</strong>
                  <small>{s.nome || 'Usuário'} · {PAPEL_ROTULO[papel]}</small>
                  <em className={cx('lateral__status', caixa && 'aberto')}>{caixa ? 'Caixa aberto' : 'Caixa fechado'}</em>
                </div>
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
                {s.ehAdmin && <Link className="menu-item" to="/plataforma?aba=suporte" onClick={fechar}><MessagesSquare size={18} /> Suporte{suporte.naoLidas > 0 && <span className="menu-item__selo">{suporte.naoLidas}</span>}</Link>}
                <div className="menu-sep" />
                <button className="menu-item menu-item--perigo" onClick={() => void s.sair()}><LogOut size={18} /> Sair</button>
              </>
            )}
          </Suspenso>
          <button className="lateral__sair" onClick={() => void s.sair()} title="Sair" aria-label="Sair"><LogOut size={18} /></button>
        </div>
      </aside>

      {/* Celular: atalhos embaixo + botão que abre o menu completo */}
      <nav className="barra-mobile" aria-label="Atalhos">
        {atalhos.map((m) => (
          <NavLink key={m.para} to={m.para} end={m.fim} className={({ isActive }) => cx('barra-mobile__item', isActive && 'ativo')}>
            <m.icone size={22} strokeWidth={1.8} />
            <span>{m.curto ?? m.rotulo}</span>
            {m.para === '/painel' && novos > 0 && <b className="lateral__contador">{novos}</b>}
          </NavLink>
        ))}
        <button className={cx('barra-mobile__item', gaveta && 'ativo')} onClick={() => setGaveta(true)}>
          <Menu size={22} strokeWidth={1.8} />
          <span>Menu</span>
        </button>
      </nav>
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
                        <strong>Caixa aberto <span className="tempo-caixa"><Clock size={12} /> há {duracao(caixa.aberto_em, agora)}</span></strong>
                        <small>Aberto {quando(caixa.aberto_em)}{caixa.aberto_por_nome ? ` · ${caixa.aberto_por_nome}` : ''}</small>
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
                  <Link className="menu-item" to="/painel/config/impressora" onClick={fechar}><Settings size={18} /> Configurar impressora</Link>
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

            {/* Empresa: menu com cardápio digital, dados, equipe, som e troca de restaurante */}
            <Suspenso
              largura={300}
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
                  <button className="menu-item" onClick={() => { fechar(); setCardapioDigital(true); }}>
                    <QrCode size={18} /> Cardápio digital
                    <small className={cx('menu-item__status', r.delivery_ativo && 'aberto')}>{r.delivery_ativo ? 'Aberto' : 'Fechado'}</small>
                  </button>
                  {ehGestor(papel) && (
                    <>
                      <Link className="menu-item" to="/painel/config/estabelecimento" onClick={fechar}><Building2 size={18} /> Dados e identidade visual</Link>
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

        {cardapioDigital && (
          <ModalCardapioDigital
            restaurante={r}
            gestor={ehGestor(papel)}
            aoMudarDelivery={() => void s.recarregar()}
            aoFechar={() => setCardapioDigital(false)}
          />
        )}

        {ehGestor(papel) && !s.ehAdmin && <ErroTela silencioso><AvisoFatura r={r} /></ErroTela>}
        <ErroTela silencioso><AcessosPendentes acessos={vivo.acessos} agora={agora} variante="painel" aoResponder={vivo.removerAcesso} /></ErroTela>
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

        <main className={cx('painel__conteudo', (naTelaDePedidos || local.pathname === '/painel/pdv') && permitido && 'painel__conteudo--cheio')}>
          {permitido
            ? <ErroTela chave={local.pathname}><Suspense fallback={<div className="carregando"><div className="spinner" /></div>}><Outlet context={ctx} /></Suspense></ErroTela>
            : <p className="vazio">Seu cargo não tem acesso a esta área.</p>}
        </main>
      </div>

      {novaVersao && !pendenteNoFechamento && (
        <AvisoAtualizacao
          caixaAberto={caixaAberto}
          aoAdiar={() => { adiarAtualizacao(novaVersao); setAdiada(novaVersao); }}
        />
      )}

      <ErroTela silencioso><BalaoSuporte restauranteId={r.id} /></ErroTela>
      {s.ehAdmin && suporte.naoLidas > 0 && (
        <Link className="sup-admin-aviso" to="/plataforma?aba=suporte">
          <MessagesSquare size={16} /> {suporte.naoLidas === 1 ? '1 mensagem nova no suporte' : `${suporte.naoLidas} mensagens novas no suporte`}
        </Link>
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

/** Igual ao Anota AI: lembra de pagar antes de bloquear (Pix/boleto perto do vencimento, ou fatura vencida) */
function AvisoFatura({ r }: { r: RestauranteComPapel }) {
  const sit = situacaoPlano(r);
  if (sit.estado !== 'perto' && sit.estado !== 'vencida') return null;
  const pagar = linkPagarPlano(r.plano);
  const vencida = sit.estado === 'vencida';
  return (
    <div className={cx('aviso-fatura', vencida && 'aviso-fatura--vencida')} role="status">
      <span className="aviso-fatura__icone"><Receipt size={18} /></span>
      <span>
        {vencida
          ? <><b>Sua fatura venceu em {dataBR(sit.vence)}.</b> Pague até {dataBR(sit.limite)} para evitar o bloqueio da conta.</>
          : <><b>Evite o bloqueio da sua conta.</b> Pague sua fatura até {dataBR(sit.vence)}.</>}
      </span>
      <a className="btn btn--sm btn--primario" href={pagar} target={pagar.startsWith('http') ? '_blank' : undefined} rel="noopener">Pagar fatura</a>
      <Link className="aviso-fatura__ver" to="/painel/conta/faturas">Ver faturas</Link>
    </div>
  );
}
