import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, Check, ExternalLink, LayoutDashboard, LogOut, Printer, Receipt, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { aplicarAtualizacao, useNovaVersao } from '../../lib/versao';
import { Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { Avatar, ModalPerfil } from '../../componentes/Perfil';
import { PedidoCard } from '../../componentes/PedidoCard';
import { useToast } from '../../componentes/Toast';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { definirSom, somLigado, tocarAlerta, tocarChamado } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, Mesa, Pedido, StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, descreverChamado, hora, ordenarNome, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import '../../estilos/painel.css';

type Aba = 'levar' | 'cozinha' | 'mesas';

export default function Garcom() {
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
    aoNovoChamado: (c) => { tocarChamado(r?.som_chamado); toast(`${c.mesa_nome}: ${descreverChamado(c)}`, 'info'); },
  });

  // Chamado é obrigatório: o toque repete a cada 30 s até alguém marcar "Atendido"
  const somRef = useRef(r?.som_chamado);
  somRef.current = r?.som_chamado;
  const haChamados = vivo.chamados.length > 0;
  useEffect(() => {
    if (!haChamados) return;
    const i = setInterval(() => tocarChamado(somRef.current), 30000);
    return () => clearInterval(i);
  }, [haChamados]);

  useEffect(() => { void estadoPush().then(setPush); }, []);
  const [perfilAberto, setPerfilAberto] = useState(false);

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
    if (status === 'cancelado' && !confirm(`Cancelar o pedido #${p.numero}?`)) return;
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
        {r.papel !== 'garcom' && <Link to="/painel" className="icone-btn" aria-label="Abrir painel"><LayoutDashboard size={20} /></Link>}
        <button className="icone-btn" onClick={() => void s.sair()} aria-label="Sair"><LogOut size={20} /></button>
      </header>
      {perfilAberto && <ModalPerfil aoFechar={() => setPerfilAberto(false)} />}
      {!s.foto && (
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

      {push && push !== 'ativo' && (
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

      <nav className="garcom__abas">
        {abas.map((a) => (
          <button key={a.id} className={cx('garcom__aba', aba === a.id && 'ativo')} onClick={() => setAba(a.id)}>
            {a.rotulo} {a.qtd !== undefined && <b>{a.qtd}</b>}
          </button>
        ))}
      </nav>

      {vivo.carregando ? <Carregando /> : aba === 'mesas' ? (
        <MesasGarcom restauranteId={r.id} pedidosAoVivo={vivo.pedidos} chamados={vivo.chamados} agora={agora} />
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
    </div>
  );
}

/* ---------------- Aba Mesas: conta de cada mesa + imprimir no caixa ---------------- */
function MesasGarcom({ restauranteId, pedidosAoVivo, chamados, agora }: {
  restauranteId: string;
  pedidosAoVivo: Pedido[];
  chamados: Chamado[];
  agora: number;
}) {
  const toast = useToast();
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  const [abertos, setAbertos] = useState<Pedido[]>([]);
  const [sel, setSel] = useState<Mesa | null>(null);

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

  return (
    <div className="garcom__mesas">
      {mesas.map((m) => {
        const ps = pedidosDa(m.id);
        const total = ps.reduce((s, p) => s + Number(p.total), 0);
        const chamando = chamados.some((c) => c.mesa_id === m.id);
        return (
          <button key={m.id} className={cx('garcom__mesa', ps.length > 0 && 'ocupada', chamando && 'chamando')} onClick={() => setSel(m)}>
            <strong>{m.nome}</strong>
            {ps.length > 0 ? (
              <>
                <span className="garcom__mesa-total">{brl(total)}</span>
                <small>{ps.length} pedido(s) · desde {hora(ps[0].criado_em)}</small>
              </>
            ) : <small>Livre</small>}
            {chamando && <span className="garcom__mesa-chamando"><Bell size={13} /> chamando</span>}
          </button>
        );
      })}

      {sel && <ContaMesa mesa={sel} pedidos={pedidosDa(sel.id)} agora={agora} aoFechar={() => setSel(null)} />}
    </div>
  );
}

function ContaMesa({ mesa, pedidos, agora, aoFechar }: { mesa: Mesa; pedidos: Pedido[]; agora: number; aoFechar: () => void }) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);

  // Agrupa itens iguais para a conferência
  const itens = useMemo(() => {
    const m = new Map<string, { nome: string; qtd: number; valor: number }>();
    for (const p of pedidos) for (const i of p.pedido_itens) {
      const k = `${i.nome}|${i.preco_unit}`;
      const atual = m.get(k) ?? { nome: i.nome, qtd: 0, valor: 0 };
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
        toast(`Conta da ${mesa.nome} impressa no caixa ✓`, 'ok');
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
      rodape={
        <>
          <a className="btn btn--contorno" href={`/mesa/${mesa.token}`} target="_blank" rel="noopener"><ExternalLink size={18} /> Lançar pedido</a>
          <button className="btn btn--primario" onClick={() => void imprimirNoCaixa()} disabled={enviando || pedidos.length === 0}>
            <Printer size={18} /> {enviando ? 'Enviando…' : 'Imprimir conta no caixa'}
          </button>
        </>
      }
    >
      {pedidos.length === 0 ? (
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
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>O pagamento é registrado pelo caixa, no computador.</p>
        </div>
      )}
    </Modal>
  );
}
