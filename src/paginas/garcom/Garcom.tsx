import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Bell, BellOff, Camera, ChefHat, Check, ChevronLeft, ChevronRight, ClipboardList, Clock, DoorOpen, ExternalLink, HandPlatter, LayoutDashboard, LayoutGrid, Medal, Menu, Printer, QrCode, Receipt, RefreshCw, ScanLine, Search, Smartphone, Target, Trophy, UserRound, Users, Volume2, VolumeX, X } from 'lucide-react';
import QRCode from 'qrcode';
import { aplicarAtualizacao, useNovaVersao } from '../../lib/versao';
import { Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { ModalTrocarMesa } from '../../componentes/TrocarMesa';
import { AcessosPendentes, iconeAparelho, responderAcesso } from '../../componentes/AcessosMesa';
import { linkMesa } from '../../lib/linkCurto';
import { Avatar, ModalPerfil } from '../../componentes/Perfil';
import { PedidoCard } from '../../componentes/PedidoCard';
import { PessoasMesa } from '../../componentes/PessoasMesa';
import { fecharMesaSemPedido } from '../../componentes/FecharMesa';
import { useToast } from '../../componentes/Toast';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { REPETIR_CHAMADO_MS, definirSom, somLigado, tocarAlerta, tocarChamadoUmaVez, vibrar } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, Mesa, MesaAcesso, Pedido, RestauranteComPapel, StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, descreverChamado, hora, ordenarNome, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import '../../estilos/painel.css';
import '../../estilos/garcom.css';
import { cancelarComMotivo } from '../../componentes/CancelarPedido';
import { ConfigGarcom, DesafiosGarcom, METAS_HOJE, MenuGarcom, nivel, type Numeros, type TelaGarcom } from './MenuGarcom';
import { useAparencia } from '../../lib/aparencia';
import { useEscalaApp } from '../../lib/escalaApp';

type Aba = 'levar' | 'cozinha' | 'mesas' | 'metas';
const ABAS: Aba[] = ['levar', 'cozinha', 'mesas', 'metas'];
const CHAVE_ABA = 'bf:garcom:aba';
const CHAVE_FOTO = 'bf:garcom:dica-foto';
const lerLocal = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarLocal = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };

function saudacao(agora: number) {
  const h = new Date(agora).getHours();
  return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Números do dia/semana do garçom (metas e nível), atualizados a cada minuto e quando um pedido muda. */
function useMetas(restauranteId: string | undefined, chave: string) {
  const [d, setD] = useState<{ hoje: Numeros; semana: Numeros } | null>(null);
  useEffect(() => {
    if (!restauranteId) return;
    let vivo = true;
    const ler = () => void supabase.rpc('garcom_desafios', { p_rest: restauranteId, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' })
      .then(({ data }) => { if (vivo && data) setD(data as { hoje: Numeros; semana: Numeros }); });
    const t = setTimeout(ler, 400);
    const i = setInterval(ler, 60000);
    return () => { vivo = false; clearTimeout(t); clearInterval(i); };
  }, [restauranteId, chave]);
  return d;
}

/**
 * Saiu versão nova: o app do garçom atualiza sozinho, sem precisar tocar em nada.
 * Só espera se ele estiver no meio de algo (janela aberta ou digitando); com a tela apagada atualiza na hora.
 */
function useAtualizarSozinho(novaVersao: string | null) {
  useEffect(() => {
    if (!novaVersao) return;
    // Segurança contra recarregar sem parar (ex.: a publicação ainda chegando): no máximo 2 tentativas por versão
    const CHAVE = 'bf:garcom:auto-versao';
    let feitas = 0;
    try { const t = JSON.parse(sessionStorage.getItem(CHAVE) ?? '{}') as { v?: string; n?: number }; if (t.v === novaVersao) feitas = t.n ?? 0; } catch { /* sem armazenamento */ }
    if (feitas >= 2) return;
    let foi = false;
    const tentar = () => {
      if (foi) return;
      const el = document.activeElement;
      const digitando = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      const ocupado = digitando || !!document.querySelector('.modal-fundo, .gmenu.aberto');
      if (document.visibilityState !== 'hidden' && ocupado) return;
      foi = true;
      try { sessionStorage.setItem(CHAVE, JSON.stringify({ v: novaVersao, n: feitas + 1 })); } catch { /* sem armazenamento */ }
      aplicarAtualizacao();
    };
    tentar();
    const i = setInterval(tentar, 3000);
    document.addEventListener('visibilitychange', tentar);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', tentar); };
  }, [novaVersao]);
}

export default function Garcom({ modoApp = false }: { modoApp?: boolean }) {
  const s = useSessao();
  const toast = useToast();
  const r = s.restaurante;
  const agora = useAgora(20000);
  const [aba, setAbaEstado] = useState<Aba>(() => { const v = lerLocal(CHAVE_ABA) as Aba | null; return v && ABAS.includes(v) ? v : 'mesas'; });
  const setAba = (a: Aba) => { setAbaEstado(a); gravarLocal(CHAVE_ABA, a); window.scrollTo({ top: 0 }); };
  const [som, setSom] = useState(somLigado());
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [semDicaFoto, setSemDicaFoto] = useState(() => lerLocal(CHAVE_FOTO) === '1');
  const novaVersao = useNovaVersao(30000);
  useAtualizarSozinho(novaVersao);
  // No app (/appgarcom) quem ajusta a escala é a tela de fora, que também cuida da entrada
  useEscalaApp(!modoApp);

  const vivo = usePedidosAoVivo(r?.id, {
    aoNovoPedido: () => tocarAlerta('pedido'),
    aoPedidoPronto: (p) => { tocarAlerta('pronto'); toast(`Pedido #${p.numero} pronto · ${p.mesa_nome}`, 'ok'); },
    aoNovoChamado: (c) => { tocarChamadoUmaVez(`chamado-${c.id}`, r?.som_chamado); toast(`${c.mesa_nome}: ${descreverChamado(c)}`, 'info'); },
    aoNovoAcesso: (a) => { tocarChamadoUmaVez(`acesso-${a.id}`, r?.som_chamado); toast(`${a.mesa_nome} quer fazer pedidos. Libere a mesa.`, 'info'); },
  });
  const chaveMetas = useMemo(() => vivo.pedidos.filter((p) => p.status === 'entregue').length + ':' + vivo.chamados.length, [vivo.pedidos, vivo.chamados]);
  const metas = useMetas(r?.id, chaveMetas);

  // Chamado é obrigatório: o toque repete a cada 30 s até alguém marcar "Atendido"
  const somRef = useRef(r?.som_chamado);
  somRef.current = r?.som_chamado;
  const haChamados = vivo.chamados.length > 0 || vivo.acessos.length > 0;
  useEffect(() => {
    if (!haChamados) return;
    const i = setInterval(() => tocarChamadoUmaVez(`repete-${Math.floor(Date.now() / REPETIR_CHAMADO_MS)}`, somRef.current), REPETIR_CHAMADO_MS);
    return () => clearInterval(i);
  }, [haChamados]);

  useEffect(() => { void estadoPush().then(setPush); }, []);
  const [perfilAberto, setPerfilAberto] = useState(false);
  const [menu, setMenu] = useState(false);
  // Claro ou escuro: escolha de cada celular (Menu › Configurações)
  useAparencia('garcom', true);
  const [tela, setTela] = useState<TelaGarcom>('principal');
  // Tocar no chamado abre a mesa (o "Atendido" fica lá dentro, para não tocar sem querer)
  const [abrirMesa, setAbrirMesa] = useState<string | null>(null);

  if (s.carregando) return <Carregando />;
  if (!r) {
    return <Vazio titulo="Sua conta não está ligada a nenhum restaurante."><button className="btn btn--contorno" onClick={() => void s.sair()}>Sair</button></Vazio>;
  }

  async function ativarNotificacoes() {
    try {
      await ativarPush(r!.id);
      toast('Pronto! Você vai receber os avisos mesmo com o celular bloqueado.', 'ok');
    } catch (e) {
      toast(msgErro(e), 'erro');
    }
    setPush(await estadoPush());
  }

  async function mudar(p: Pedido, status: StatusPedido) {
    if (status === 'cancelado') return void cancelarComMotivo(p, vivo.atualizarPedido, toast);
    const antes = p.status;
    vivo.atualizarPedido(p.id, { status });
    const { error } = await supabase.rpc('pedido_mudar_status', { p_pedido: p.id, p_status: status });
    if (error) {
      vivo.atualizarPedido(p.id, { status: antes });
      toast(msgErro(error), 'erro');
    }
  }

  async function atender(c: Chamado) {
    vivo.removerChamado(c.id);
    const { error } = await supabase.rpc('chamado_atender', { p_chamado: c.id });
    if (error) {
      toast(msgErro(error), 'erro');
      void vivo.recarregar();
    } else {
      toast(`${c.mesa_nome} atendida.`, 'ok');
    }
  }

  const prontos = vivo.pedidos.filter((p) => p.status === 'pronto');
  const cozinha = vivo.pedidos.filter((p) => p.status === 'novo' || p.status === 'preparando');
  const alertasMesa = vivo.chamados.length + vivo.acessos.length;
  const abas: { id: Aba; rotulo: string; icone: ReactNode; qtd?: number; alerta?: boolean }[] = [
    { id: 'mesas', rotulo: 'Mesas', icone: <LayoutGrid size={22} />, qtd: alertasMesa, alerta: true },
    { id: 'levar', rotulo: 'Levar', icone: <HandPlatter size={22} />, qtd: prontos.length, alerta: true },
    { id: 'cozinha', rotulo: 'Cozinha', icone: <ChefHat size={22} />, qtd: cozinha.length },
    { id: 'metas', rotulo: 'Metas', icone: <Trophy size={22} /> },
  ];
  const lista = aba === 'levar' ? prontos : cozinha;
  const principal = tela === 'principal';
  const primeiroNome = (s.nome || 'Garçom').trim().split(/\s+/)[0];
  const irPara = (t: TelaGarcom) => { if (t === 'desafios') { setTela('principal'); setAba('metas'); } else { setTela(t); window.scrollTo({ top: 0 }); } };

  return (
    <div className="garcom gapp" style={{ '--acento': r.cor } as CSSProperties}>
      <header className="gtopo">
        <button className="gtopo__btn" onClick={() => setMenu(true)} aria-label="Abrir menu">
          <Menu size={21} />{haChamados && <i className="gtopo__ponto" />}
        </button>
        <button className="gtopo__perfil" onClick={() => setPerfilAberto(true)} aria-label="Meu perfil" title="Meu perfil">
          <Avatar nome={s.nome || 'Garçom'} foto={s.foto} tamanho={42} />
          <i className={cx('gtopo__vivo', vivo.conectado && 'on')} />
        </button>
        <div className="gtopo__txt">
          <strong>{saudacao(agora)}, {primeiroNome}</strong>
          <span className={cx('gtopo__status', vivo.conectado && 'on')}>{vivo.conectado ? 'Ao vivo' : 'Reconectando…'} · {r.nome}</span>
        </div>
        <button className="gtopo__btn" onClick={() => { const v = !som; setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }} aria-label={som ? 'Desligar som' : 'Ligar som'}>
          {som ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        {!modoApp && r.papel !== 'garcom' && <Link to="/painel" className="gtopo__btn" aria-label="Abrir painel"><LayoutDashboard size={20} /></Link>}
      </header>
      <MenuGarcom
        aberto={menu}
        tela={principal && aba === 'metas' ? 'desafios' : tela}
        nomeRest={r.nome}
        logo={r.logo_url}
        aoIr={irPara}
        aoPerfil={() => setPerfilAberto(true)}
        aoSair={() => void s.sair()}
        aoFechar={() => setMenu(false)}
      />
      {perfilAberto && <ModalPerfil aoFechar={() => setPerfilAberto(false)} />}

      <main className="gapp__conteudo">
        {novaVersao && (
          <div className="gaviso gaviso--info">
            <span className="gaviso__icone"><RefreshCw size={18} /></span>
            <div className="gaviso__txt"><b>Atualizando o app…</b><small>Atualiza sozinho ao fechar esta janela</small></div>
            <button className="gaviso__btn" onClick={aplicarAtualizacao}>Agora</button>
          </div>
        )}

        {/* Mesas pedindo para abrir: o cliente só pede depois que o garçom libera */}
        <AcessosPendentes acessos={vivo.acessos} agora={agora} variante="garcom" aoResponder={vivo.removerAcesso} />
        {/* Chamados ficam fixos no topo até alguém marcar "Atendido" */}
        {vivo.chamados.length > 0 && (
          <section className="garcom__chamados" aria-label="Mesas chamando">
            {vivo.chamados.map((c) => (
              <button key={c.id} type="button" className={cx('garcom__chamado', c.tipo === 'conta' && 'garcom__chamado--conta')}
                onClick={() => { setTela('principal'); setAba('mesas'); setAbrirMesa(c.mesa_id); }}>
                <span className="garcom__chamado-icone">{c.tipo === 'conta' ? <Receipt size={22} /> : <Bell size={22} />}</span>
                <div>
                  <strong>{c.mesa_nome}</strong>
                  <span className="garcom__chamado-motivo">{descreverChamado(c)}</span>
                  <small>{tempoDesde(c.criado_em, agora) === 'agora' ? 'agora' : `há ${tempoDesde(c.criado_em, agora)}`} · toque para abrir</small>
                </div>
                <span className="garcom__chamado-abrir" aria-hidden="true"><ChevronRight size={22} /></span>
              </button>
            ))}
          </section>
        )}

        {principal && push && (push === 'inativo' || push === 'bloqueado' || push === 'precisa-instalar') && (
          <div className="gaviso">
            <span className="gaviso__icone"><BellOff size={18} /></span>
            <div className="gaviso__txt">
              <b>Ative as notificações</b>
              <small>{push === 'precisa-instalar' ? 'No iPhone: Compartilhar › Adicionar à Tela de Início e abra pelo ícone'
                : push === 'bloqueado' ? 'Bloqueadas: libere em Permissões › Notificações' : 'Receba os pedidos com a tela bloqueada'}</small>
            </div>
            {push === 'inativo' && <button className="gaviso__btn" onClick={() => void ativarNotificacoes()}>Ativar</button>}
          </div>
        )}
        {principal && !s.foto && !semDicaFoto && (
          <div className="gaviso gaviso--suave">
            <span className="gaviso__icone"><Camera size={18} /></span>
            <button className="gaviso__txt gaviso__txt--botao" onClick={() => setPerfilAberto(true)}>
              <b>Coloque sua foto</b><small>A equipe vê quem atendeu cada mesa</small>
            </button>
            <button className="gaviso__fechar" onClick={() => { setSemDicaFoto(true); gravarLocal(CHAVE_FOTO, '1'); }} aria-label="Dispensar"><X size={16} /></button>
          </div>
        )}

        {tela === 'config' ? (
          <>
            <div className="gsecao">
              <button className="gsecao__voltar" onClick={() => setTela('principal')} aria-label="Voltar"><ChevronLeft size={20} /></button>
              <h2>Configurações</h2>
            </div>
            <ConfigGarcom restauranteId={r.id} />
          </>
        ) : aba === 'metas' ? (
          <>
            <div className="gsecao"><h2>Metas e desafios</h2></div>
            <DesafiosGarcom restauranteId={r.id} />
          </>
        ) : (
          <>
            <CartaoMeta d={metas} aoAbrir={() => setAba('metas')} />
            {aba === 'mesas' ? (
              vivo.carregando ? <Carregando /> : (
                <MesasGarcom restaurante={r} pedidosAoVivo={vivo.pedidos} chamados={vivo.chamados} acessos={vivo.acessos} liberados={vivo.liberados} aoResponderAcesso={vivo.removerAcesso} agora={agora}
                  abrirMesa={abrirMesa} aoAbrir={() => setAbrirMesa(null)} aoAtender={(c) => void atender(c)} />
              )
            ) : (
              <>
                <div className="gsecao">
                  <h2>{aba === 'levar' ? 'Prontos para levar' : 'Na cozinha'}</h2>
                  {lista.length > 0 && <span className="gsecao__qtd">{lista.length}</span>}
                </div>
                {vivo.carregando ? <Carregando /> : lista.length === 0 ? (
                  <div className="gvazio">
                    <span className="gvazio__icone">{aba === 'levar' ? <HandPlatter size={34} /> : <ChefHat size={34} />}</span>
                    <strong>{aba === 'levar' ? 'Nada pronto para levar' : 'Nenhum pedido na cozinha'}</strong>
                    <p>{aba === 'levar' ? 'Quando a cozinha marcar um pedido como pronto, ele aparece aqui e o celular avisa.' : 'Os pedidos novos das mesas aparecem aqui enquanto são preparados.'}</p>
                  </div>
                ) : (
                  <div className="garcom__lista">
                    {lista.map((p) => <PedidoCard key={p.id} pedido={p} agora={agora} aoMudar={(st) => void mudar(p, st)} compacto />)}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <nav className="gnav" aria-label="Seções do app">
        {abas.map((a) => {
          const ativa = principal && aba === a.id;
          return (
            <button key={a.id} className={cx('gnav__item', ativa && 'ativo')} aria-current={ativa ? 'page' : undefined} onClick={() => { setTela('principal'); setAba(a.id); }}>
              <span className="gnav__icone">{a.icone}{!!a.qtd && <b className={cx(a.alerta && 'alerta')}>{a.qtd > 99 ? '99+' : a.qtd}</b>}</span>
              <span className="gnav__rotulo">{a.rotulo}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** Meta do dia no topo: anel de progresso, a próxima meta e o nível da semana. */
function CartaoMeta({ d, aoAbrir }: { d: { hoje: Numeros; semana: Numeros } | null; aoAbrir: () => void }) {
  if (!d) return <div className="gturno gturno--esqueleto" aria-hidden="true" />;
  const meta = METAS_HOJE.find((m) => Number(d.hoje[m.chave]) < m.meta);
  const feitas = METAS_HOJE.filter((m) => Number(d.hoje[m.chave]) >= m.meta).length;
  const valor = meta ? Number(d.hoje[meta.chave]) : 1;
  const alvo = meta?.meta ?? 1;
  const nv = nivel(d.semana.pontos);
  const C = 2 * Math.PI * 21;
  return (
    <button className={cx('gturno', !meta && 'gturno--feito')} onClick={aoAbrir}>
      <span className="gturno__anel">
        <svg viewBox="0 0 52 52" aria-hidden="true">
          <circle cx="26" cy="26" r="21" className="gturno__trilho" />
          <circle cx="26" cy="26" r="21" className="gturno__valor" strokeDasharray={`${Math.min(1, valor / alvo) * C} ${C}`} />
        </svg>
        <b>{meta ? `${valor}/${alvo}` : <Check size={20} strokeWidth={3} />}</b>
      </span>
      <span className="gturno__txt">
        <small><Target size={13} /> Meta do dia · {feitas} de {METAS_HOJE.length}</small>
        <strong>{meta ? meta.titulo : 'Todas as metas de hoje batidas!'}</strong>
        <span className="gturno__linha">
          {meta ? `Faltam ${alvo - valor}` : 'Mandou bem'}
          <span className={cx('gturno__nivel', `gturno__nivel--${nv.classe}`)}><Medal size={12} /> {nv.nome.split(' ')[0]} · {d.semana.pontos} pts</span>
        </span>
      </span>
      <ChevronRight size={20} className="gturno__seta" />
    </button>
  );
}

/* ---------------- Aba Mesas: conta de cada mesa + imprimir no caixa ---------------- */
function MesasGarcom({ restaurante, pedidosAoVivo, chamados, acessos, liberados, aoResponderAcesso, agora, abrirMesa, aoAbrir, aoAtender }: {
  restaurante: RestauranteComPapel;
  pedidosAoVivo: Pedido[];
  chamados: Chamado[];
  acessos: MesaAcesso[];
  liberados: MesaAcesso[];
  aoResponderAcesso: (id: string) => void;
  agora: number;
  /** Mesa para abrir já (tocou no chamado lá em cima) */
  abrirMesa: string | null;
  aoAbrir: () => void;
  aoAtender: (c: Chamado) => void;
}) {
  const restauranteId = restaurante.id;
  const toast = useToast();
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [abertos, setAbertos] = useState<Pedido[]>([]);
  const [sel, setSel] = useState<Mesa | null>(null);
  const [busca, setBusca] = useState('');
  // Mesas ou comandas (a escolha fica guardada no celular)
  const [ver, setVerEstado] = useState<'mesa' | 'comanda'>(() => { try { return localStorage.getItem('bf:garcom:ver') === 'comanda' ? 'comanda' : 'mesa'; } catch { return 'mesa'; } });
  const setVer = (v: 'mesa' | 'comanda') => { setVerEstado(v); try { localStorage.setItem('bf:garcom:ver', v); } catch { /* sem armazenamento */ } };

  const carregar = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('mesas').select('*').eq('restaurante_id', restauranteId).eq('ativo', true),
      supabase.from('pedidos').select('*, pedido_itens(*)').eq('restaurante_id', restauranteId)
        .is('pago_em', null).neq('status', 'cancelado').order('criado_em'),
    ]);
    if (m.error) toast(msgErro(m.error), 'erro');
    setMesas(((m.data ?? []) as Mesa[]).sort(ordenarNome));
    setAbertos((p.data ?? []) as Pedido[]);
  }, [restauranteId, toast]);

  // Atualiza junto com os pedidos ao vivo
  const assinatura = useMemo(() => pedidosAoVivo.map((p) => `${p.id}:${p.status}:${p.pago_em ?? ''}`).join('|'), [pedidosAoVivo]);
  useEffect(() => { void carregar(); }, [carregar, assinatura]);

  // Chegou pelo chamado: abre a mesa (e mostra mesas ou comandas, conforme o caso)
  useEffect(() => {
    if (!abrirMesa || !mesas) return;
    const m = mesas.find((x) => x.id === abrirMesa);
    if (m) { setVer(m.tipo === 'comanda' ? 'comanda' : 'mesa'); setSel(m); }
    aoAbrir();
  }, [abrirMesa, mesas, aoAbrir]);

  if (!mesas) return <Carregando />;
  if (!mesas.length) return <Vazio titulo="Nenhuma mesa cadastrada" />;

  const pedidosDa = (id: string) => abertos.filter((p) => p.mesa_id === id);
  const totalDa = (id: string) => pedidosDa(id).reduce((s, p) => s + Number(p.total), 0);

  const t = busca.trim().toLowerCase();
  const daComanda = mesas.filter((m) => m.tipo === 'comanda');
  const soMesas = mesas.filter((m) => m.tipo !== 'comanda');
  const tipoVer = daComanda.length ? ver : 'mesa';
  const doTipo = tipoVer === 'comanda' ? daComanda : soMesas;
  const visiveis = t ? doTipo.filter((m) => m.nome.toLowerCase().includes(t)) : doTipo;
  const ocupadasDe = (l: Mesa[]) => l.filter((m) => pedidosDa(m.id).length > 0 || liberados.some((a) => a.mesa_id === m.id)).length;
  const chamaEm = (l: Mesa[]) => l.some((m) => chamados.some((c) => c.mesa_id === m.id) || acessos.some((a) => a.mesa_id === m.id));

  return (
    <>
    <div className="garcom__mesas-barra">
      {daComanda.length > 0 && (
        <div className="garcom__tipos" role="tablist" aria-label="Mesas ou comandas">
          {([['mesa', 'Mesas', soMesas], ['comanda', 'Comandas', daComanda]] as const).map(([id, rotulo, l]) => (
            <button key={id} role="tab" aria-selected={tipoVer === id} className={cx(tipoVer === id && 'ativo')} onClick={() => { setVer(id); setBusca(''); }}>
              {chamaEm(l) && tipoVer !== id && <i className="garcom__tipos-alerta" aria-label="chamando" />}
              {rotulo}
              <b>{ocupadasDe(l)}/{l.length}</b>
            </button>
          ))}
        </div>
      )}
      <label className="garcom__busca"><Search size={17} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={tipoVer === 'comanda' ? 'Buscar pelo nome da comanda' : 'Buscar pelo nome da mesa'} aria-label="Buscar" /></label>
      <div className="garcom__legenda">
        <span><i className="livre" /> Livres</span>
        <span><i className="ocupada" /> Ocupadas</span>
        <span><i className="levar" /> Levar</span>
        <span><i className="chamando" /> Chamando</span>
      </div>
    </div>
    <div className="garcom__mesas">
      {visiveis.length === 0 && <p className="muted garcom__mesas-vazio">{tipoVer === 'comanda' ? 'Nenhuma comanda com esse nome.' : 'Nenhuma mesa com esse nome.'}</p>}
      {visiveis.map((m) => {
        const ps = pedidosDa(m.id);
        const total = ps.reduce((s, p) => s + Number(p.total), 0);
        const chamando = chamados.some((c) => c.mesa_id === m.id);
        const pedindo = acessos.some((a) => a.mesa_id === m.id);
        // Liberada pelo garçom (cliente já no cardápio) também é mesa ocupada
        const sentado = liberados.some((a) => a.mesa_id === m.id);
        // Pisca: pedido pronto para levar, pedido novo do cliente ou mesa chamando
        const levar = ps.some((p) => p.status === 'pronto');
        const novo = ps.some((p) => p.status === 'novo');
        const alerta = chamando ? 'Chamando' : pedindo ? 'Liberar' : levar ? 'Levar pedido' : novo ? 'Pedido novo' : null;
        return (
          <button key={m.id} className={cx('garcom__mesa', (ps.length > 0 || sentado) && 'ocupada', (chamando || pedindo) && 'chamando', !(chamando || pedindo) && levar && 'levar', !(chamando || pedindo) && !levar && novo && 'novo', alerta && 'pisca')} onClick={() => setSel(m)}>
            <span className="garcom__mesa-topo">
              <strong>{m.nome}</strong>
              {(chamando || pedindo || levar || novo) && (
                <span className="garcom__mesa-sino">{chamando ? <Bell size={13} strokeWidth={2.6} /> : pedindo ? <Smartphone size={13} strokeWidth={2.6} /> : levar ? <HandPlatter size={13} strokeWidth={2.4} /> : <ClipboardList size={13} strokeWidth={2.4} />}</span>
              )}
            </span>
            {m.cliente_nome && <span className="garcom__mesa-cliente">{m.cliente_nome}</span>}
            <span className="garcom__mesa-rodape">
              {ps.length > 0 ? (
                <>
                  <span className="garcom__mesa-total">{brl(total)}</span>
                  <small className="garcom__mesa-tempo"><Clock size={11} strokeWidth={2.6} /> {tempoDesde(ps[0].criado_em, agora)}{m.pessoas ? <><span className="garcom__mesa-sep">·</span><Users size={11} strokeWidth={2.6} /> {m.pessoas}</> : ps.length > 1 ? ` · ${ps.length} ped.` : ''}</small>
                </>
              ) : <small className="garcom__mesa-estado">{sentado ? 'Sem pedido' : 'Livre'}{m.pessoas ? <span className="garcom__mesa-sep">· <Users size={11} strokeWidth={2.6} /> {m.pessoas}</span> : null}</small>}
              {alerta && <span className="garcom__mesa-chamando">{alerta}</span>}
            </span>
          </button>
        );
      })}

      {sel && (
        <ContaMesa
          restaurante={restaurante}
          acessos={acessos.filter((a) => a.mesa_id === sel.id)}
          aoResponderAcesso={aoResponderAcesso}
          mesa={sel}
          chamados={chamados.filter((c) => c.mesa_id === sel.id)}
          aoAtender={aoAtender}
          pedidos={pedidosDa(sel.id)}
          agora={agora}
          mesas={mesas}
          totalDa={totalDa}
          aoFechar={() => setSel(null)}
          aoTrocar={() => { setSel(null); void carregar(); }}
          ocupada={liberados.some((a) => a.mesa_id === sel.id) || !!sel.cliente_nome || !!sel.cliente_telefone || !!sel.pessoas}
          aoFecharMesa={() => { setMesas((l) => l && l.map((x) => (x.id === sel.id ? { ...x, pessoas: null, cliente_nome: null, cliente_telefone: null } : x))); setSel(null); void carregar(); }}
          aoPessoas={(n) => { setMesas((l) => l && l.map((x) => (x.id === sel.id ? { ...x, pessoas: n } : x))); setSel((x) => x && { ...x, pessoas: n }); }}
        />
      )}
    </div>
    </>
  );
}

function ContaMesa({ restaurante, acessos, aoResponderAcesso, mesa, chamados, aoAtender, pedidos, agora, mesas, totalDa, aoFechar, aoTrocar, aoPessoas, ocupada, aoFecharMesa }: {
  aoPessoas: (n: number | null) => void;
  /** Cliente sentado (celular liberado, nome ou pessoas): sem pedido, dá para fechar a mesa */
  ocupada: boolean;
  aoFecharMesa: () => void;
  restaurante: RestauranteComPapel;
  acessos: MesaAcesso[];
  chamados: Chamado[];
  aoAtender: (c: Chamado) => void;
  aoResponderAcesso: (id: string) => void;
  mesa: Mesa;
  pedidos: Pedido[];
  agora: number;
  mesas: Mesa[];
  totalDa: (id: string) => number;
  aoFechar: () => void;
  aoTrocar: () => void;
}) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [aba, setAba] = useState<'qr' | 'conta'>('qr');
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  const [fechando, setFechando] = useState(false);
  async function fechar() {
    setFechando(true);
    const ok = await fecharMesaSemPedido(mesa, toast);
    setFechando(false);
    if (ok) aoFecharMesa();
  }

  // Agrupa itens iguais para a conferência
  const itens = useMemo(() => {
    const m = new Map<string, { nome: string; obs: string | null; qtd: number; valor: number }>();
    for (const p of pedidos) for (const i of p.pedido_itens) {
      const nome = i.complementos ? `${i.nome} (${i.complementos})` : i.nome;
      const obs = i.obs?.trim() || null;
      const k = `${nome}|${obs ?? ''}|${i.preco_unit}`;
      const atual = m.get(k) ?? { nome, obs, qtd: 0, valor: 0 };
      atual.qtd += i.qtd;
      atual.valor += i.qtd * Number(i.preco_unit);
      m.set(k, atual);
    }
    return [...m.values()];
  }, [pedidos]);

  async function imprimirNoCaixa() {
    setEnviando(true);
    const { data: id, error } = await supabase.rpc('impressao_solicitar_conta', { p_mesa: mesa.id });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(`Conta da ${mesa.nome} enviada para a impressora do caixa.`, 'ok');

    // Confirma quando o computador do caixa imprimir (ou avisa se ninguém imprimir)
    let impresso = false;
    const canal = supabase
      .channel(`impressao-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'fila_impressao', filter: `id=eq.${id}` }, () => {
        impresso = true;
        toast(`Conta da ${mesa.nome} impressa no caixa.`, 'ok');
        void supabase.removeChannel(canal);
      })
      .subscribe();
    setTimeout(() => {
      if (!impresso) toast('Nenhum computador imprimiu ainda. Confira se o caixa está aberto com “Imprimir automaticamente” ligado.', 'erro');
      void supabase.removeChannel(canal);
    }, 25000);
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={mesa.nome}
      classe="gmesa"
      rodape={
        <>
          <a className="btn btn--contorno" href={`/mesa/${mesa.token}`} target="_blank" rel="noopener"><ExternalLink size={18} /> Lançar pedido</a>
          {pedidos.length === 0 ? (
            <button className="btn gmesa__fechar" onClick={() => void fechar()} disabled={!ocupada || fechando}>
              <DoorOpen size={18} /> {fechando ? 'Fechando…' : 'Fechar mesa'}
            </button>
          ) : (
            <button className="btn btn--primario" onClick={() => void imprimirNoCaixa()} disabled={enviando}>
              <Printer size={18} /> {enviando ? 'Enviando…' : 'Imprimir conta no caixa'}
            </button>
          )}
        </>
      }
    >
      {(mesa.cliente_nome || mesa.cliente_telefone) && (
        <div className="gmesa__cliente">
          <UserRound size={18} />
          <span><b>{mesa.cliente_nome || 'Cliente'}</b>{mesa.cliente_telefone && <small>{mesa.cliente_telefone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')}</small>}</span>
          {mesa.cliente_telefone && <a className="btn btn--fantasma btn--sm" href={`https://wa.me/55${mesa.cliente_telefone}`} target="_blank" rel="noopener">WhatsApp</a>}
        </div>
      )}
      <PessoasMesa mesa={mesa} aoMudar={aoPessoas} />
      {/* Chamados desta mesa: o garçom marca "Atendido" aqui dentro */}
      {chamados.length > 0 && (
        <div className="gmesa__chamados">
          {chamados.map((c) => (
            <div key={c.id} className={cx('gmesa__chamado', c.tipo === 'conta' && 'gmesa__chamado--conta')}>
              <span className="gmesa__chamado-icone">{c.tipo === 'conta' ? <Receipt size={20} /> : <Bell size={20} />}</span>
              <div>
                <strong>{descreverChamado(c)}</strong>
                <small>Chamou {tempoDesde(c.criado_em, agora) === 'agora' ? 'agora' : `há ${tempoDesde(c.criado_em, agora)}`}</small>
              </div>
              <button className="btn btn--sucesso" onClick={() => aoAtender(c)}><Check size={18} strokeWidth={2.6} /> Atendido</button>
            </div>
          ))}
        </div>
      )}
      <div className="gqr-abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'qr'} className={cx(aba === 'qr' && 'ativo')} onClick={() => setAba('qr')}>
          <QrCode size={17} /> QR code{acessos.length > 0 && <b className="gqr-abas__selo">{acessos.length}</b>}
        </button>
        <button type="button" role="tab" aria-selected={aba === 'conta'} className={cx(aba === 'conta' && 'ativo')} onClick={() => setAba('conta')}>
          <Receipt size={17} /> Conta{pedidos.length > 0 && <small>{brl(total)}</small>}
        </button>
      </div>

      {aba === 'qr' ? (
        <QrMesa restaurante={restaurante} mesa={mesa} mesas={mesas} pendentes={acessos} aoResponder={aoResponderAcesso} />
      ) : pedidos.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{ocupada ? 'Nenhum pedido ainda. Se o cliente foi embora sem pedir, toque em Fechar mesa.' : 'Mesa livre: nenhum pedido em aberto.'}</p>
      ) : (
        <div className="form">
          <ul className="linhas-conta">
            {itens.map((i) => <li key={`${i.nome}|${i.obs ?? ''}`}><span>{i.qtd}× {i.nome}{i.obs && <span className="linha-obs">» {i.obs}</span>}</span><span>{brl(i.valor)}</span></li>)}
          </ul>
          <div className="total-linha"><span>Total da mesa</span><strong>{brl(total)}</strong></div>
          <div className="garcom__conta-pedidos">
            {pedidos.map((p) => (
              <span key={p.id} className={`badge badge--${p.status}`}>#{p.numero} · {STATUS_ROTULO[p.status]} · {tempoDesde(p.criado_em, agora)}</span>
            ))}
          </div>
          <button className="btn btn--contorno btn--bloco" onClick={() => setTrocando(true)}>
            <ArrowRightLeft size={18} /> Cliente trocou de mesa
          </button>
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>O pagamento é registrado pelo caixa, no computador.</p>
        </div>
      )}
      {trocando && (
        <ModalTrocarMesa origem={mesa} mesas={mesas} totalDa={totalDa} aoFechar={() => setTrocando(false)} aoTrocar={aoTrocar} />
      )}
    </Modal>
  );
}

/**
 * O garçom mostra o QR code da mesa no celular dele; o cliente escaneia com o próprio celular
 * e o pedido de acesso aparece aqui mesmo, para o garçom liberar na hora.
 */
function QrMesa({ restaurante, mesa, mesas, pendentes, aoResponder }: {
  restaurante: RestauranteComPapel;
  mesa: Mesa;
  mesas: Mesa[];
  pendentes: MesaAcesso[];
  aoResponder: (id: string) => void;
}) {
  const toast = useToast();
  const link = linkMesa(restaurante, mesa, mesas);
  const [qr, setQr] = useState('');
  const [liberados, setLiberados] = useState<MesaAcesso[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void QRCode.toDataURL(link, { width: 720, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#14110f', light: '#ffffff' } }).then((u) => vivo && setQr(u));
    return () => { vivo = false; };
  }, [link]);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('mesa_acessos').select('*').eq('mesa_id', mesa.id).eq('status', 'liberado').order('respondido_em');
    setLiberados((data ?? []) as MesaAcesso[]);
  }, [mesa.id]);
  const chavePendentes = pendentes.map((a) => a.id).join(',');
  useEffect(() => { void carregar(); }, [carregar, chavePendentes]);

  // Cliente acabou de escanear: vibra para o garçom perceber
  const antes = useRef(pendentes.length);
  useEffect(() => {
    if (pendentes.length > antes.current) vibrar([120, 60, 120]);
    antes.current = pendentes.length;
  }, [pendentes.length]);

  async function agir(a: MesaAcesso, acao: 'liberar' | 'recusar' | 'desconectar') {
    setOcupado(a.id);
    try {
      if (acao === 'desconectar') {
        const { error } = await supabase.rpc('mesa_acesso_encerrar', { p_acesso: a.id });
        if (error) throw error;
        toast('Aparelho desconectado da mesa.', 'info');
      } else {
        await responderAcesso(a.id, acao === 'liberar');
        aoResponder(a.id);
        toast(acao === 'liberar' ? `${mesa.nome} liberada. O cliente já pode pedir.` : 'Pedido de acesso recusado.', acao === 'liberar' ? 'ok' : 'info');
      }
      void carregar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(null);
    }
  }

  const nomeAparelho = (a: MesaAcesso) => (a.cliente_nome ? `${a.cliente_nome.split(' ')[0]} · ${a.aparelho ?? 'celular'}` : a.aparelho ?? 'Celular do cliente');

  return (
    <div className="gqr">
      <div className="gqr__cartao">
        <div className="gqr__qr">
          {qr ? <img src={qr} alt={`QR code da ${mesa.nome}`} /> : <span className="gqr__qr-vazio" />}
        </div>
        <strong className="gqr__mesa">{mesa.nome}</strong>
        <span className="gqr__dica"><ScanLine size={16} /> Escaneie com a câmera para pedir</span>
      </div>

      {pendentes.length > 0 ? (
        <ul className="gqr__lista" aria-label="Pedindo para abrir a mesa">
          {pendentes.map((a) => (
            <li key={a.id} className="gqr__item gqr__item--pendente">
              <span className="gqr__icone">{iconeAparelho(a.aparelho, 19)}</span>
              <span className="gqr__txt"><b>{nomeAparelho(a)}</b><small>Quer fazer pedidos</small></span>
              <button className="gqr__recusar" onClick={() => void agir(a, 'recusar')} disabled={ocupado === a.id} aria-label="Recusar"><X size={18} /></button>
              <button className="gqr__liberar" onClick={() => void agir(a, 'liberar')} disabled={ocupado === a.id}><Check size={18} strokeWidth={2.6} /> Liberar</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gqr__aguardando"><span className="gqr__pulso" aria-hidden="true" /> Esperando o cliente escanear… o pedido para abrir a mesa aparece aqui.</p>
      )}

      {liberados && liberados.length > 0 && (
        <div className="gqr__bloco">
          <small className="gqr__rotulo">Já podem pedir nesta mesa</small>
          <ul className="gqr__lista">
            {liberados.map((a) => (
              <li key={a.id} className="gqr__item">
                <span className="gqr__icone gqr__icone--ok">{iconeAparelho(a.aparelho, 18)}</span>
                <span className="gqr__txt">
                  <b>{nomeAparelho(a)}{a.fixo && <span className="badge badge--azul">Tablet fixo</span>}</b>
                  <small>Liberado{a.respondido_por_nome ? ` por ${a.respondido_por_nome}` : ''}{a.respondido_em ? ` às ${hora(a.respondido_em)}` : ''}</small>
                </span>
                <button className="btn btn--fantasma btn--sm" onClick={() => void agir(a, 'desconectar')} disabled={ocupado === a.id}>Desconectar</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
