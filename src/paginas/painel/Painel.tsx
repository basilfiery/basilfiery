import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom';
import {
  BarChart3, Bell, ClipboardList, LayoutGrid, LogOut, Package, Printer, RefreshCw, Settings, ShieldCheck, Smartphone,
  Users, UtensilsCrossed, Volume2, VolumeX, Wallet, type LucideIcon,
} from 'lucide-react';
import { AvisoAtualizacao, ModalCaixa } from './Caixa';
import { adiarAtualizacao, aplicarAtualizacao, useNovaVersao, versaoAdiada } from '../../lib/versao';
import { Logo } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { EVENTO_CONFIG_IMPRESSAO, EVENTO_ERRO_IMPRESSAO, imprimirPedido, lerConfigImpressao } from '../../lib/impressao';
import { useSessao } from '../../lib/sessao';
import { definirSom, notificarLocal, somLigado, tocarAlerta } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, Papel, Pedido, RestauranteComPapel, ResumoCaixa } from '../../lib/tipos';
import { PAPEL_ROTULO, brl, cx, hora, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import '../../estilos/painel.css';

export interface ContextoPainel {
  restaurante: RestauranteComPapel;
  papel: Papel;
  pedidos: Pedido[];
  chamados: Chamado[];
  conectado: boolean;
  carregando: boolean;
  recarregar: () => Promise<void>;
  atualizarPedido: (id: string, mudancas: Partial<Pedido>) => void;
  /** Caixa aberto agora (null = fechado, undefined = carregando) */
  caixa: ResumoCaixa | null | undefined;
  abrirCaixa: () => void;
  recarregarCaixa: () => void;
}

export const usePainel = () => useOutletContext<ContextoPainel>();

const TODOS: Papel[] = ['dono', 'gerente', 'caixa', 'garcom'];
const MENU: { para: string; icone: LucideIcon; rotulo: string; papeis: Papel[]; fim?: boolean }[] = [
  { para: '/painel', icone: ClipboardList, rotulo: 'Pedidos', papeis: TODOS, fim: true },
  { para: '/painel/mesas', icone: LayoutGrid, rotulo: 'Mesas', papeis: TODOS },
  { para: '/painel/relatorios', icone: BarChart3, rotulo: 'Relatórios', papeis: ['dono', 'gerente', 'caixa'] },
  { para: '/painel/cardapio', icone: UtensilsCrossed, rotulo: 'Cardápio', papeis: ['dono', 'gerente'] },
  { para: '/painel/estoque', icone: Package, rotulo: 'Estoque', papeis: ['dono', 'gerente', 'caixa'] },
  { para: '/painel/equipe', icone: Users, rotulo: 'Equipe', papeis: ['dono', 'gerente'] },
  { para: '/painel/config', icone: Settings, rotulo: 'Configurações', papeis: TODOS },
];

export default function Painel() {
  const s = useSessao();
  const toast = useToast();
  const local = useLocation();
  const r = s.restaurante;
  const [som, setSom] = useState(somLigado());
  const [cfgImp, setCfgImp] = useState(lerConfigImpressao());
  const agora = useAgora(30000);

  const vivo = usePedidosAoVivo(r?.id, {
    aoNovoPedido: (p) => {
      tocarAlerta('pedido');
      notificarLocal(`Novo pedido #${p.numero} · ${p.mesa_nome}`, `Total ${brl(p.total)}`);
    },
    aoNovoChamado: (c) => {
      tocarAlerta('chamado');
      notificarLocal(c.tipo === 'conta' ? `${c.mesa_nome} pediu a conta` : `${c.mesa_nome} chamou o garçom`);
    },
  });

  /* ---------- Caixa (aberto/fechado), sincronizado entre computadores ---------- */
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined);
  const [verCaixa, setVerCaixa] = useState(false);
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

  async function atender(c: Chamado) {
    const { error } = await supabase.rpc('chamado_atender', { p_chamado: c.id });
    if (error) toast(msgErro(error), 'erro');
  }

  const ctx: ContextoPainel = {
    restaurante: r,
    papel,
    pedidos: vivo.pedidos,
    chamados: vivo.chamados,
    conectado: vivo.conectado,
    carregando: vivo.carregando,
    recarregar: vivo.recarregar,
    atualizarPedido: vivo.atualizarPedido,
    caixa,
    abrirCaixa: () => setVerCaixa(true),
    recarregarCaixa: () => void carregarCaixa(),
  };
  const novos = vivo.pedidos.filter((p) => p.status === 'novo').length;

  return (
    <div className="painel" style={{ '--acento': r.cor } as CSSProperties}>
      <aside className="painel__lateral">
        <Link to="/painel" className="painel__logo"><Logo tamanho="sm" /></Link>
        <nav className="painel__menu">
          {itens.map((m) => (
            <NavLink key={m.para} to={m.para} end={m.fim} className={({ isActive }) => cx('painel__item', isActive && 'ativo')}>
              <m.icone size={20} />
              <span>{m.rotulo}</span>
              {m.para === '/painel' && novos > 0 && <span className="painel__contador">{novos}</span>}
            </NavLink>
          ))}
          {s.ehAdmin && (
            <NavLink to="/plataforma" className="painel__item">
              <ShieldCheck size={20} /><span>Plataforma</span>
            </NavLink>
          )}
        </nav>
        <div className="painel__usuario">
          <div>
            <strong>{s.nome}</strong>
            <span>{PAPEL_ROTULO[papel]}</span>
          </div>
          <button className="icone-btn" onClick={() => void s.sair()} title="Sair" aria-label="Sair"><LogOut size={18} /></button>
        </div>
      </aside>

      <div className="painel__principal">
        <header className="painel__topo">
          {s.restaurantes.length > 1 ? (
            <select className="select painel__rest" value={r.id} onChange={(e) => s.escolherRestaurante(e.target.value)} aria-label="Restaurante">
              {s.restaurantes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          ) : (
            <strong className="painel__rest-nome">{r.nome}</strong>
          )}
          <span className={cx('ao-vivo', vivo.conectado && 'on')} title={vivo.conectado ? 'Recebendo pedidos em tempo real' : 'Reconectando…'}>
            {vivo.conectado ? 'Ao vivo' : 'Reconectando…'}
          </span>
          <div className="painel__topo-acoes">
            <Link to="/painel/config" className={cx('chip-status', cfgImp.auto && 'on')} title="Impressão automática neste computador">
              <Printer size={16} /> <span>{cfgImp.auto ? 'Impressão automática' : 'Impressão desligada'}</span>
            </Link>
            <button
              className="icone-btn"
              onClick={() => { const v = !som; setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }}
              title={som ? 'Som ligado' : 'Som desligado'}
              aria-label={som ? 'Desligar som' : 'Ligar som'}
            >
              {som ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <Link to="/garcom" className="icone-btn" title="Tela do garçom (celular)" aria-label="Tela do garçom"><Smartphone size={20} /></Link>
            {pendenteNoFechamento && (
              <button className="chip-status chip-status--atualizacao" onClick={aplicarAtualizacao} title="Clique para atualizar agora">
                <RefreshCw size={16} /> <span>Atualiza no fechamento</span>
              </button>
            )}
            <button
              className={cx('caixa-btn', caixa ? 'aberto' : 'fechado')}
              onClick={() => setVerCaixa(true)}
              disabled={caixa === undefined}
              title={caixa ? 'Ver ou fechar o caixa' : 'Abrir o caixa'}
            >
              <Wallet size={18} />
              <span className="caixa-btn__texto">
                <b>{caixa === undefined ? 'Caixa…' : caixa ? 'Caixa aberto' : 'Caixa fechado'}</b>
                {caixa && <small>desde {hora(caixa.aberto_em)} · {brl(caixa.recebido)}</small>}
              </span>
            </button>
          </div>
        </header>

        {vivo.chamados.length > 0 && (
          <div className="chamados">
            {vivo.chamados.map((c) => (
              <div key={c.id} className={cx('chamado', c.tipo === 'conta' && 'chamado--conta')}>
                <Bell size={18} />
                <span><b>{c.mesa_nome}</b> {c.tipo === 'conta' ? 'pediu a conta' : 'chamou o garçom'} · {tempoDesde(c.criado_em, agora)}</span>
                <button className="btn btn--sm" onClick={() => void atender(c)}>Atendido</button>
              </div>
            ))}
          </div>
        )}

        <main className="painel__conteudo">
          {permitido ? <Outlet context={ctx} /> : <p className="vazio">Seu cargo não tem acesso a esta área.</p>}
        </main>
      </div>

      {novaVersao && !pendenteNoFechamento && (
        <AvisoAtualizacao
          caixaAberto={caixaAberto}
          aoAdiar={() => { adiarAtualizacao(novaVersao); setAdiada(novaVersao); }}
        />
      )}

      {verCaixa && caixa !== undefined && (
        <ModalCaixa
          restaurante={{ id: r.id, nome: r.nome }}
          papel={papel}
          caixa={caixa}
          aoFechar={() => setVerCaixa(false)}
          aoMudar={() => void carregarCaixa()}
          atualizarAoConcluir={!!novaVersao}
        />
      )}
    </div>
  );
}
