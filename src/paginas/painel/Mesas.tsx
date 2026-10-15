import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, ExternalLink, LayoutGrid, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { Campo, Switch, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { imprimirConta } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, Mesa, Pedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, ehGestor, hora, ordenarNome, podeCaixa, tempoDesde, useAgora } from '../../lib/util';
import { usePainel } from './Painel';

const linkMesa = (token: string) => `${window.location.origin}/mesa/${token}`;

export default function Mesas() {
  const { restaurante, papel, pedidos: aoVivo, chamados } = usePainel();
  const toast = useToast();
  const agora = useAgora(30000);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [abertos, setAbertos] = useState<Pedido[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [selecionada, setSelecionada] = useState<Mesa | null>(null);
  const [criando, setCriando] = useState(false);
  const gestor = ehGestor(papel);

  const carregar = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('mesas').select('*').eq('restaurante_id', restaurante.id),
      supabase.from('pedidos').select('*, pedido_itens(*)')
        .eq('restaurante_id', restaurante.id).is('pago_em', null).neq('status', 'cancelado')
        .order('criado_em'),
    ]);
    if (m.error) toast(msgErro(m.error), 'erro');
    setMesas(((m.data ?? []) as Mesa[]).sort(ordenarNome));
    setAbertos((p.data ?? []) as Pedido[]);
    setCarregado(true);
  }, [restaurante.id, toast]);

  // Recarrega quando chega qualquer novidade em tempo real
  useEffect(() => { void carregar(); }, [carregar, aoVivo]);

  const pedidosDa = (mesaId: string) => abertos.filter((p) => p.mesa_id === mesaId);
  const chamadosDa = (mesaId: string) => chamados.filter((c) => c.mesa_id === mesaId);
  const ocupadas = mesas.filter((m) => pedidosDa(m.id).length > 0).length;
  const emAberto = abertos.reduce((s, p) => s + Number(p.total), 0);

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Mesas</h1>
          <p>{ocupadas} de {mesas.filter((m) => m.ativo).length} ocupadas · {brl(emAberto)} em contas abertas</p>
        </div>
        {gestor && <button className="btn btn--primario" onClick={() => setCriando(true)}><Plus size={18} /> Nova mesa</button>}
      </div>

      {carregado && mesas.length === 0 ? (
        <Vazio icone={<LayoutGrid size={36} />} titulo="Nenhuma mesa cadastrada">
          {gestor ? 'Crie as mesas e abra o link de cada uma no tablet correspondente.' : 'Peça ao gerente para cadastrar as mesas.'}
        </Vazio>
      ) : (
        <div className="mesas-grade">
          {mesas.map((m) => {
            const ps = pedidosDa(m.id);
            const total = ps.reduce((s, p) => s + Number(p.total), 0);
            const cs = chamadosDa(m.id);
            return (
              <button key={m.id} className={cx('mesa-card', ps.length > 0 && 'mesa-card--ocupada', !m.ativo && 'mesa-card--inativa')} onClick={() => setSelecionada(m)}>
                <strong>{m.nome}</strong>
                {ps.length > 0 ? (
                  <>
                    <span className="mesa-card__total">{brl(total)}</span>
                    <span className="mesa-card__info">{ps.length} pedido(s) · desde {hora(ps[0].criado_em)}</span>
                  </>
                ) : (
                  <span className="mesa-card__info">{m.ativo ? 'Livre' : 'Desativada'}</span>
                )}
                {cs.length > 0 && (
                  <div className="mesa-card__alertas">
                    {cs.map((c) => (
                      <span key={c.id} className={`badge ${c.tipo === 'conta' ? 'badge--azul' : 'badge--laranja'}`}>
                        {c.tipo === 'conta' ? '🧾 Pediu a conta' : '🔔 Chamou'} · {tempoDesde(c.criado_em, agora)}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selecionada && (
        <ModalMesa
          mesa={selecionada}
          pedidos={pedidosDa(selecionada.id)}
          chamados={chamadosDa(selecionada.id)}
          restauranteNome={restaurante.nome}
          podeFechar={podeCaixa(papel)}
          gestor={gestor}
          aoFechar={() => setSelecionada(null)}
          aoMudar={() => void carregar()}
        />
      )}

      {criando && (
        <ModalNovaMesa
          restauranteId={restaurante.id}
          sugestao={`Mesa ${mesas.length + 1}`}
          ordem={Math.max(0, ...mesas.map((m) => m.ordem)) + 1}
          aoFechar={() => setCriando(false)}
          aoCriar={() => { setCriando(false); void carregar(); }}
        />
      )}
    </div>
  );
}

function ModalMesa({ mesa, pedidos, chamados, restauranteNome, podeFechar, gestor, aoFechar, aoMudar }: {
  mesa: Mesa;
  pedidos: Pedido[];
  chamados: Chamado[];
  restauranteNome: string;
  podeFechar: boolean;
  gestor: boolean;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const toast = useToast();
  const [qr, setQr] = useState('');
  const [nome, setNome] = useState(mesa.nome);
  const [token, setToken] = useState(mesa.token);
  const [ativo, setAtivo] = useState(mesa.ativo);
  const [ocupado, setOcupado] = useState(false);
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  const link = linkMesa(token);

  useEffect(() => {
    void QRCode.toDataURL(link, { width: 360, margin: 1 }).then(setQr);
  }, [link]);

  async function fecharConta() {
    if (!confirm(`Confirmar pagamento de ${brl(total)} e liberar a ${mesa.nome}?`)) return;
    setOcupado(true);
    const { error } = await supabase.rpc('mesa_fechar_conta', { p_mesa: mesa.id });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${mesa.nome} liberada. Conta de ${brl(total)} fechada.`, 'ok');
    aoMudar();
    aoFechar();
  }

  async function salvar(mudancas: Partial<Mesa>) {
    const { error } = await supabase.from('mesas').update(mudancas).eq('id', mesa.id);
    if (error) {
      toast(msgErro(error), 'erro');
      return false;
    }
    aoMudar();
    return true;
  }

  async function novoLink() {
    if (!confirm('Gerar um novo link? O tablet atual desta mesa deixará de funcionar até você abrir o novo link nele.')) return;
    const novo = crypto.randomUUID().replace(/-/g, '');
    if (await salvar({ token: novo })) {
      setToken(novo);
      toast('Novo link gerado.', 'ok');
    }
  }

  async function excluir() {
    if (!confirm(`Excluir a ${mesa.nome}? O histórico de pedidos é mantido.`)) return;
    const { error } = await supabase.from('mesas').delete().eq('id', mesa.id);
    if (error) return toast(msgErro(error), 'erro');
    aoMudar();
    aoFechar();
  }

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copiado!', 'ok');
    } catch {
      toast('Não foi possível copiar. Selecione o link manualmente.', 'erro');
    }
  };

  return (
    <Modal aberto aoFechar={aoFechar} titulo={mesa.nome} largura={560}>
      <section className="bloco">
        <h3>Conta aberta</h3>
        {chamados.map((c) => (
          <span key={c.id} className={`badge ${c.tipo === 'conta' ? 'badge--azul' : 'badge--laranja'}`}>
            {c.tipo === 'conta' ? '🧾 Pediu a conta' : '🔔 Chamou o garçom'}
          </span>
        ))}
        {pedidos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum pedido em aberto.</p>
        ) : (
          <>
            {pedidos.map((p) => (
              <div key={p.id}>
                <div className="acoes-linha" style={{ alignItems: 'center' }}>
                  <strong>#{p.numero}</strong>
                  <span className="muted">{hora(p.criado_em)}</span>
                  <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
                </div>
                <ul className="linhas-conta">
                  {p.pedido_itens.map((i) => (
                    <li key={i.id}><span>{i.qtd}× {i.nome}</span><span>{brl(i.qtd * i.preco_unit)}</span></li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="total-linha"><span>Total</span><strong>{brl(total)}</strong></div>
            <div className="acoes-linha">
              <button className="btn btn--contorno" onClick={() => imprimirConta(mesa.nome, restauranteNome, pedidos)}>
                <Printer size={18} /> Imprimir conta
              </button>
              {podeFechar && (
                <button className="btn btn--sucesso" onClick={() => void fecharConta()} disabled={ocupado}>
                  Fechar conta e liberar mesa
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="bloco">
        <h3>Tablet desta mesa</h3>
        <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>
          Abra este link no tablet da mesa (ou leia o QR code com a câmera dele) e deixe a tela aberta.
        </p>
        <div className="link-mesa">
          <code title={link}>{link}</code>
          <button className="icone-btn" onClick={() => void copiar()} title="Copiar" aria-label="Copiar link"><Copy size={18} /></button>
          <a className="icone-btn" href={link} target="_blank" rel="noopener" title="Abrir" aria-label="Abrir cardápio da mesa"><ExternalLink size={18} /></a>
        </div>
        {qr && <img className="qr" src={qr} alt={`QR code do cardápio da ${mesa.nome}`} />}
      </section>

      {gestor && (
        <section className="bloco">
          <h3>Ajustes</h3>
          <div className="acoes-linha" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <Campo rotulo="Nome da mesa">
                <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} />
              </Campo>
            </div>
            <button
              className="btn btn--contorno"
              disabled={!nome.trim() || nome.trim() === mesa.nome}
              onClick={() => void salvar({ nome: nome.trim() }).then((ok) => ok && toast('Nome atualizado.', 'ok'))}
            >
              Salvar nome
            </button>
          </div>
          <Switch marcado={ativo} aoMudar={(v) => { setAtivo(v); void salvar({ ativo: v }); }}>
            Mesa ativa (desligada, o tablet para de aceitar pedidos)
          </Switch>
          <div className="acoes-linha">
            <button className="btn btn--contorno btn--sm" onClick={() => void novoLink()}><RefreshCw size={16} /> Gerar novo link</button>
            <button className="btn btn--perigo btn--sm" onClick={() => void excluir()}><Trash2 size={16} /> Excluir mesa</button>
          </div>
        </section>
      )}
    </Modal>
  );
}

function ModalNovaMesa({ restauranteId, sugestao, ordem, aoFechar, aoCriar }: {
  restauranteId: string;
  sugestao: string;
  ordem: number;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(sugestao);
  const [salvando, setSalvando] = useState(false);

  async function criar() {
    setSalvando(true);
    const { error } = await supabase.from('mesas').insert({ restaurante_id: restauranteId, nome: nome.trim(), ordem });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Mesa criada.', 'ok');
    aoCriar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Nova mesa"
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={!nome.trim() || salvando} onClick={() => void criar()}>Criar mesa</button>
        </>
      }
    >
      <Campo rotulo="Nome" dica="Ex.: Mesa 12, Varanda 3, Balcão">
        <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} autoFocus />
      </Campo>
    </Modal>
  );
}
