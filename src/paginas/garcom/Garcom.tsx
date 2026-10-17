import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff, LayoutDashboard, LogOut, Receipt, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { aplicarAtualizacao, useNovaVersao } from '../../lib/versao';
import { Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { PedidoCard } from '../../componentes/PedidoCard';
import { useToast } from '../../componentes/Toast';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { definirSom, somLigado, tocarAlerta, tocarChamado } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, Pedido, StatusPedido } from '../../lib/tipos';
import { cx, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import '../../estilos/painel.css';

type Aba = 'levar' | 'cozinha' | 'chamados';

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
    aoNovoChamado: (c) => { tocarChamado(r?.som_chamado); toast(`${c.mesa_nome} ${c.tipo === 'conta' ? 'pediu a conta' : 'chamou o garçom'}`, 'info'); },
  });

  useEffect(() => { void estadoPush().then(setPush); }, []);

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
    if (error) toast(msgErro(error), 'erro');
  }

  const prontos = vivo.pedidos.filter((p) => p.status === 'pronto');
  const cozinha = vivo.pedidos.filter((p) => p.status === 'novo' || p.status === 'preparando');
  const abas: { id: Aba; rotulo: string; qtd: number }[] = [
    { id: 'levar', rotulo: 'Para levar', qtd: prontos.length },
    { id: 'cozinha', rotulo: 'Na cozinha', qtd: cozinha.length },
    { id: 'chamados', rotulo: 'Chamados', qtd: vivo.chamados.length },
  ];
  const lista = aba === 'levar' ? prontos : cozinha;

  return (
    <div className="garcom" style={{ '--acento': r.cor } as CSSProperties}>
      <header className="garcom__topo">
        <div>
          <strong>{r.nome}</strong>
          <span className={cx('ao-vivo', vivo.conectado && 'on')}>{vivo.conectado ? 'Ao vivo' : 'Reconectando…'}</span>
        </div>
        <button className="icone-btn" onClick={() => { const v = !som; setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }} aria-label={som ? 'Desligar som' : 'Ligar som'}>
          {som ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        {r.papel !== 'garcom' && <Link to="/painel" className="icone-btn" aria-label="Abrir painel"><LayoutDashboard size={20} /></Link>}
        <button className="icone-btn" onClick={() => void s.sair()} aria-label="Sair"><LogOut size={20} /></button>
      </header>

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

      <nav className="garcom__abas">
        {abas.map((a) => (
          <button key={a.id} className={cx('garcom__aba', aba === a.id && 'ativo')} onClick={() => setAba(a.id)}>
            {a.rotulo} <b>{a.qtd}</b>
          </button>
        ))}
      </nav>

      {vivo.carregando ? <Carregando /> : (
        <div className="garcom__lista">
          {aba === 'chamados' ? (
            vivo.chamados.length === 0 ? <Vazio icone={<Bell size={32} />} titulo="Nenhuma mesa chamando" /> : (
              vivo.chamados.map((c) => (
                <div key={c.id} className={cx('garcom__chamado', c.tipo === 'conta' && 'garcom__chamado--conta')}>
                  {c.tipo === 'conta' ? <Receipt size={24} /> : <Bell size={24} />}
                  <div>
                    <strong>{c.mesa_nome}</strong>
                    <small>{c.tipo === 'conta' ? 'Pediu a conta' : 'Chamou o garçom'} · {tempoDesde(c.criado_em, agora)}</small>
                  </div>
                  <button className="btn btn--sucesso" onClick={() => void atender(c)}>Atendido</button>
                </div>
              ))
            )
          ) : lista.length === 0 ? (
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
