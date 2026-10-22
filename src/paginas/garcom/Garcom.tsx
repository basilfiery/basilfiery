import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, Bell, BellOff, Check, ExternalLink, LayoutDashboard, Menu, Printer, QrCode, Receipt, RefreshCw, ScanLine, Search, Smartphone, Volume2, VolumeX, X } from 'lucide-react';
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
import { useToast } from '../../componentes/Toast';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { REPETIR_CHAMADO_MS, definirSom, somLigado, tocarAlerta, tocarChamadoUmaVez } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, Mesa, MesaAcesso, Pedido, RestauranteComPapel, StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, descreverChamado, hora, ordenarNome, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import '../../estilos/painel.css';
import { cancelarComMotivo } from '../../componentes/CancelarPedido';
import { ConfigGarcom, DesafiosGarcom, MenuGarcom, type TelaGarcom } from './MenuGarcom';
import { useAparencia } from '../../lib/aparencia';

type Aba = 'levar' | 'cozinha' | 'mesas';

export default function Garcom({ modoApp = false }: { modoApp?: boolean }) {
  const s = useSessao();
  const toast = useToast();
  const r = s.restaurante;
  const agora = useAgora(20000);
  const [aba, setAba] = useState<Aba>('levar');
  const [som, setSom] = useState(somLigado());
  const [push, setPush] = useState<EstadoPush | null>(null);
  const novaVersao = useNovaVersao();

  const vivo = usePedidosAoVivo(r?.id, {
    aoNovoPedido: () => tocarAlerta('pedido'),
    aoPedidoPronto: (p) => { tocarAlerta('pronto'); toast(`Pedido #${p.numero} pronto · ${p.mesa_nome}`, 'ok'); },
    aoNovoChamado: (c) => { tocarChamadoUmaVez(`chamado-${c.id}`, r?.som_chamado); toast(`${c.mesa_nome}: ${descreverChamado(c)}`, 'info'); },
    aoNovoAcesso: (a) => { tocarChamadoUmaVez(`acesso-${a.id}`, r?.som_chamado); toast(`${a.mesa_nome} quer fazer pedidos. Libere a mesa.`, 'info'); },
  });

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
  const abas: { id: Aba; rotulo: string; qtd?: number }[] = [
    { id: 'levar', rotulo: 'Para levar', qtd: prontos.length },
    { id: 'cozinha', rotulo: 'Na cozinha', qtd: cozinha.length },
    { id: 'mesas', rotulo: 'Mesas' },
  ];
  const lista = aba === 'levar' ? prontos : cozinha;

  return (
    <div className="garcom" style={{ '--acento': r.cor } as CSSProperties}>
      <header className="garcom__topo">
        <button className="icone-btn garcom__menu" onClick={() => setMenu(true)} aria-label="Abrir menu">
          <Menu size={21} />{haChamados && <i className="garcom__menu-ponto" />}
        </button>
        <button className="garcom__perfil" onClick={() => setPerfilAberto(true)} aria-label="Meu perfil" title="Meu perfil">
          <Avatar nome={s.nome || 'Garçom'} foto={s.foto} tamanho={40} />
        </button>
        <div>
          <strong>{s.nome || r.nome}</strong>
          <small className="garcom__rest">{r.nome}</small>
          <span className={cx('ao-vivo', vivo.conectado && 'on')}>{vivo.conectado ? 'Ao vivo' : 'Reconectando…'}</span>
        </div>
        <button className="icone-btn" onClick={() => { const v = !som; setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }} aria-label={som ? 'Desligar som' : 'Ligar som'}>
          {som ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        {!modoApp && r.papel !== 'garcom' && <Link to="/painel" className="icone-btn" aria-label="Abrir painel"><LayoutDashboard size={20} /></Link>}
      </header>
      <MenuGarcom
        aberto={menu}
        tela={tela}
        nomeRest={r.nome}
        logo={r.logo_url}
        aoIr={setTela}
        aoPerfil={() => setPerfilAberto(true)}
        aoSair={() => void s.sair()}
        aoFechar={() => setMenu(false)}
      />
      {perfilAberto && <ModalPerfil aoFechar={() => setPerfilAberto(false)} />}
      {tela !== 'principal' && (
        <div className="garcom__subtopo">
          <button className="btn btn--fantasma btn--sm" onClick={() => setTela('principal')}>← Mesas e pedidos</button>
          <strong>{tela === 'desafios' ? 'Desafios do garçom' : 'Configurações'}</strong>
        </div>
      )}
      {tela === 'principal' && !s.foto && (
        <button className="garcom__dica-foto" onClick={() => setPerfilAberto(true)}>
          Coloque sua foto e confira seu nome em <b>Meu perfil</b>
        </button>
      )}

      {novaVersao && (
        <div className="garcom__aviso garcom__aviso--versao">
          <p><RefreshCw size={16} style={{ verticalAlign: '-3px' }} /> <b>Nova atualização disponível.</b> Leva poucos segundos.</p>
          <button className="btn btn--primario" onClick={aplicarAtualizacao}>Atualizar agora</button>
        </div>
      )}

      {tela === 'principal' && push && push !== 'ativo' && (
        <div className="garcom__aviso">
          <p><BellOff size={16} style={{ verticalAlign: '-3px' }} /> <b>Ative as notificações</b> para receber os pedidos mesmo com a tela bloqueada.</p>
          {push === 'precisa-instalar' ? (
            <p className="muted">No iPhone: toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>, abra o BasilFiery pelo ícone e volte aqui.</p>
          ) : push === 'bloqueado' ? (
            <p className="muted">As notificações estão bloqueadas. Toque no cadeado ao lado do endereço → Permissões → Notificações → Permitir.</p>
          ) : (
            <button className="btn btn--primario" onClick={() => void ativarNotificacoes()} disabled={push === 'indisponivel'}>
              <Bell size={18} /> Ativar notificações
            </button>
          )}
        </div>
      )}

      {/* Mesas pedindo para abrir: o cliente só pede depois que o garçom libera */}
      <AcessosPendentes acessos={vivo.acessos} agora={agora} variante="garcom" aoResponder={vivo.removerAcesso} />
      {/* Chamados ficam fixos no topo até alguém marcar "Atendido" */}
      {vivo.chamados.length > 0 && (
        <section className="garcom__chamados" aria-label="Mesas chamando">
          {vivo.chamados.map((c) => (
            <div key={c.id} className={cx('garcom__chamado', c.tipo === 'conta' && 'garcom__chamado--conta')}>
              <span className="garcom__chamado-icone">{c.tipo === 'conta' ? <Receipt size={22} /> : <Bell size={22} />}</span>
              <div>
                <strong>{c.mesa_nome}</strong>
                <span className="garcom__chamado-motivo">{descreverChamado(c)}</span>
                <small>há {tempoDesde(c.criado_em, agora)}</small>
              </div>
              <button className="btn btn--sucesso btn--lg" onClick={() => void atender(c)}><Check size={20} /> Atendido</button>
            </div>
          ))}
        </section>
      )}

      {tela === 'desafios' ? <DesafiosGarcom restauranteId={r.id} /> : tela === 'config' ? <ConfigGarcom restauranteId={r.id} /> : (<>
      <nav className="garcom__abas">
        {abas.map((a) => (
          <button key={a.id} className={cx('garcom__aba', aba === a.id && 'ativo')} onClick={() => setAba(a.id)}>
            {a.rotulo} {a.qtd !== undefined && <b>{a.qtd}</b>}
          </button>
        ))}
      </nav>

      {vivo.carregando ? <Carregando /> : aba === 'mesas' ? (
        <MesasGarcom restaurante={r} pedidosAoVivo={vivo.pedidos} chamados={vivo.chamados} acessos={vivo.acessos} aoResponderAcesso={vivo.removerAcesso} agora={agora} />
      ) : (
        <div className="garcom__lista">
          {lista.length === 0 ? (
            <Vazio titulo={aba === 'levar' ? 'Nada pronto para levar' : 'Nenhum pedido na cozinha'}>
              {aba === 'levar' ? 'Quando a cozinha marcar um pedido como pronto, ele aparece aqui.' : 'Os pedidos novos das mesas aparecem aqui.'}
            </Vazio>
          ) : (
            lista.map((p) => <PedidoCard key={p.id} pedido={p} agora={agora} aoMudar={(st) => void mudar(p, st)} compacto />)
          )}
        </div>
      )}
      </>)}
    </div>
  );
}

/* ---------------- Aba Mesas: conta de cada mesa + imprimir no caixa ---------------- */
function MesasGarcom({ restaurante, pedidosAoVivo, chamados, acessos, aoResponderAcesso, agora }: {
  restaurante: RestauranteComPapel;
  pedidosAoVivo: Pedido[];
  chamados: Chamado[];
  acessos: MesaAcesso[];
  aoResponderAcesso: (id: string) => void;
  agora: number;
}) {
  const restauranteId = restaurante.id;
  const toast = useToast();
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [abertos, setAbertos] = useState<Pedido[]>([]);
  const [sel, setSel] = useState<Mesa | null>(null);
  const [busca, setBusca] = useState('');

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

  if (!mesas) return <Carregando />;
  if (!mesas.length) return <Vazio titulo="Nenhuma mesa cadastrada" />;

  const pedidosDa = (id: string) => abertos.filter((p) => p.mesa_id === id);
  const totalDa = (id: string) => pedidosDa(id).reduce((s, p) => s + Number(p.total), 0);

  const t = busca.trim().toLowerCase();
  const visiveis = t ? mesas.filter((m) => m.nome.toLowerCase().includes(t)) : mesas;

  return (
    <>
    <div className="garcom__mesas-barra">
      <label className="garcom__busca"><Search size={17} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome da mesa" aria-label="Buscar mesa" /></label>
      <div className="garcom__legenda">
        <span><i className="livre" /> Livres</span>
        <span><i className="ocupada" /> Ocupadas</span>
        <span><i className="chamando" /> Chamando</span>
      </div>
    </div>
    <div className="garcom__mesas">
      {visiveis.length === 0 && <p className="muted garcom__mesas-vazio">Nenhuma mesa com esse nome.</p>}
      {visiveis.map((m) => {
        const ps = pedidosDa(m.id);
        const total = ps.reduce((s, p) => s + Number(p.total), 0);
        const chamando = chamados.some((c) => c.mesa_id === m.id);
        const pedindo = acessos.some((a) => a.mesa_id === m.id);
        return (
          <button key={m.id} className={cx('garcom__mesa', ps.length > 0 && 'ocupada', (chamando || pedindo) && 'chamando')} onClick={() => setSel(m)}>
            <strong>{m.nome}</strong>
            {ps.length > 0 ? (
              <>
                <span className="garcom__mesa-total">{brl(total)}</span>
                <small>{ps.length} {ps.length === 1 ? 'pedido' : 'pedidos'} · {hora(ps[0].criado_em)}</small>
              </>
            ) : <small>Livre</small>}
            {chamando && <span className="garcom__mesa-chamando"><Bell size={12} /> chamando</span>}
            {pedindo && !chamando && <span className="garcom__mesa-chamando"><Smartphone size={12} /> liberar</span>}
          </button>
        );
      })}

      {sel && (
        <ContaMesa
          restaurante={restaurante}
          acessos={acessos.filter((a) => a.mesa_id === sel.id)}
          aoResponderAcesso={aoResponderAcesso}
          mesa={sel}
          pedidos={pedidosDa(sel.id)}
          agora={agora}
          mesas={mesas}
          totalDa={totalDa}
          aoFechar={() => setSel(null)}
          aoTrocar={() => { setSel(null); void carregar(); }}
        />
      )}
    </div>
    </>
  );
}

function ContaMesa({ restaurante, acessos, aoResponderAcesso, mesa, pedidos, agora, mesas, totalDa, aoFechar, aoTrocar }: {
  restaurante: RestauranteComPapel;
  acessos: MesaAcesso[];
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

  // Agrupa itens iguais para a conferência
  const itens = useMemo(() => {
    const m = new Map<string, { nome: string; qtd: number; valor: number }>();
    for (const p of pedidos) for (const i of p.pedido_itens) {
      const nome = i.complementos ? `${i.nome} (${i.complementos})` : i.nome;
      const k = `${nome}|${i.preco_unit}`;
      const atual = m.get(k) ?? { nome, qtd: 0, valor: 0 };
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
          <button className="btn btn--primario" onClick={() => void imprimirNoCaixa()} disabled={enviando || pedidos.length === 0}>
            <Printer size={18} /> {enviando ? 'Enviando…' : 'Imprimir conta no caixa'}
          </button>
        </>
      }
    >
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
        <p className="muted" style={{ margin: 0 }}>Mesa livre: nenhum pedido em aberto.</p>
      ) : (
        <div className="form">
          <ul className="linhas-conta">
            {itens.map((i) => <li key={i.nome}><span>{i.qtd}× {i.nome}</span><span>{brl(i.valor)}</span></li>)}
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
    if (pendentes.length > antes.current && 'vibrate' in navigator) navigator.vibrate?.([120, 60, 120]);
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
