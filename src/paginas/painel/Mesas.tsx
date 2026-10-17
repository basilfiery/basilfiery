import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, ConciergeBell, LayoutGrid, Plus, Printer, Receipt, RefreshCw, Smartphone, Tablet, Trash2, Wallet } from 'lucide-react';
import { Campo, Switch, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { SeletorPagamento } from '../../componentes/Pagamento';
import { iconeAparelho, responderAcesso } from '../../componentes/AcessosMesa';
import { LinkCopiavel, QrCartao } from '../../componentes/Link';
import { ModalTrocarMesa } from '../../componentes/TrocarMesa';
import { useToast } from '../../componentes/Toast';
import { imprimirConta } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { Chamado, FormaPagamento, Mesa, MesaAcesso, Pedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, descreverChamado, ehGestor, hora, ordenarNome, podeCaixa, rotuloForma, tempoDesde, useAgora } from '../../lib/util';
import { usePainel } from './Painel';
import { confirmar } from '../../componentes/Confirmar';

const linkMesa = (token: string) => `${window.location.origin}/mesa/${token}`;

export default function Mesas() {
  const { restaurante, papel, pedidos: aoVivo, chamados, acessos } = usePainel();
  const toast = useToast();
  const agora = useAgora(30000);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [abertos, setAbertos] = useState<Pedido[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [selecionada, setSelecionada] = useState<Mesa | null>(null);
  const [criando, setCriando] = useState(false);
  const [verLinks, setVerLinks] = useState(false);
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
  const totalDa = (mesaId: string) => pedidosDa(mesaId).reduce((s, p) => s + Number(p.total), 0);
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
        {mesas.length > 0 && (
          <button className="btn btn--contorno" onClick={() => setVerLinks(true)}><Tablet size={18} /> Links dos tablets</button>
        )}
        {gestor && <button className="btn btn--primario" onClick={() => setCriando(true)}><Plus size={18} /> Nova mesa</button>}
      </div>

      {mesas.length > 0 && (
        <p className="dica-mesas">
          <Tablet size={16} /> Cada mesa tem um link próprio para o tablet. Toque numa mesa para ver o link e o QR code, ou use <b>Links dos tablets</b>.
        </p>
      )}

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
            const pedindo = acessos.filter((a) => a.mesa_id === m.id).length;
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
                {(cs.length > 0 || pedindo > 0) && (
                  <div className="mesa-card__alertas">
                    {pedindo > 0 && (
                      <span className="badge badge--icone badge--amarelo"><Smartphone size={13} /> Pedindo para abrir</span>
                    )}
                    {cs.map((c) => (
                      <span key={c.id} className={`badge badge--icone ${c.tipo === 'conta' ? 'badge--azul' : 'badge--laranja'}`}>
                        {c.tipo === 'conta' ? <Receipt size={13} /> : <ConciergeBell size={13} />} {descreverChamado(c)} · {tempoDesde(c.criado_em, agora)}
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
          mesas={mesas}
          totalDa={totalDa}
          aoFechar={() => setSelecionada(null)}
          aoMudar={() => void carregar()}
        />
      )}

      {verLinks && <ModalLinks mesas={mesas.filter((m) => m.ativo)} aoFechar={() => setVerLinks(false)} />}

      {criando && (
        <ModalNovaMesa
          restauranteId={restaurante.id}
          sugestao={proximoNome(mesas)}
          nomesUsados={mesas.map((m) => m.nome.trim().toLowerCase())}
          ordem={Math.max(0, ...mesas.map((m) => m.ordem)) + 1}
          aoFechar={() => setCriando(false)}
          aoCriar={() => { setCriando(false); void carregar(); }}
        />
      )}
    </div>
  );
}

function ModalMesa({ mesa, pedidos, chamados, restauranteNome, podeFechar, gestor, mesas, totalDa, aoFechar, aoMudar }: {
  mesa: Mesa;
  pedidos: Pedido[];
  chamados: Chamado[];
  restauranteNome: string;
  podeFechar: boolean;
  gestor: boolean;
  mesas: Mesa[];
  totalDa: (mesaId: string) => number;
  aoFechar: () => void;
  aoMudar: () => void;
}) {
  const toast = useToast();
  const { caixa, abrirCaixa, recarregarCaixa } = usePainel();
  const caixaAberto = !!caixa;
  const [nome, setNome] = useState(mesa.nome);
  const [token, setToken] = useState(mesa.token);
  const [ativo, setAtivo] = useState(mesa.ativo);
  const [ocupado, setOcupado] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  const link = linkMesa(token);

  async function fecharConta(forma: FormaPagamento) {
    setOcupado(true);
    const { error } = await supabase.rpc('mesa_fechar_conta', { p_mesa: mesa.id, p_forma: forma });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${mesa.nome} liberada. ${brl(total)} recebido no ${rotuloForma(forma)}.`, 'ok');
    recarregarCaixa();
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
    if (!(await confirmar('Gerar um novo link?\n\nO tablet atual desta mesa deixará de funcionar até você abrir o novo link nele.', { sim: 'Gerar novo link' }))) return;
    const novo = crypto.randomUUID().replace(/-/g, '');
    if (await salvar({ token: novo })) {
      setToken(novo);
      toast('Novo link gerado.', 'ok');
    }
  }

  async function excluir() {
    if (!(await confirmar(`Excluir a ${mesa.nome}?\n\nO histórico de pedidos é mantido.`, { sim: 'Excluir mesa', perigo: true }))) return;
    const { error } = await supabase.from('mesas').delete().eq('id', mesa.id);
    if (error) return toast(msgErro(error), 'erro');
    aoMudar();
    aoFechar();
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={mesa.nome} largura={560}>
      <section className="bloco">
        <h3>Conta aberta</h3>
        {chamados.map((c) => (
          <span key={c.id} className={`badge badge--icone ${c.tipo === 'conta' ? 'badge--azul' : 'badge--laranja'}`}>
            {c.tipo === 'conta' ? <Receipt size={13} /> : <ConciergeBell size={13} />} {descreverChamado(c)}
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
              <button className="btn btn--contorno" onClick={() => setTrocando(true)}>
                <ArrowRightLeft size={18} /> Trocar de mesa
              </button>
            </div>
            {podeFechar && (
              caixaAberto ? (
                <SeletorPagamento total={total} ocupado={ocupado} aoReceber={(f) => void fecharConta(f)} />
              ) : (
                <div className="pagamento pagamento--fechado">
                  <span>O caixa está fechado. Abra o caixa para receber esta conta.</span>
                  <button className="btn btn--primario btn--sm" onClick={abrirCaixa}><Wallet size={16} /> Abrir caixa</button>
                </div>
              )
            )}
          </>
        )}
      </section>

      <AparelhosMesa mesa={mesa} />

      <section className="bloco">
        <h3>Tablet desta mesa</h3>
        <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>
          Abra este link no tablet da mesa (ou leia o QR code com a câmera dele) e deixe a tela aberta.
        </p>
        <LinkCopiavel link={link} />
        <QrCartao link={link} legenda={`Cardápio da ${mesa.nome}`} arquivo={`qr-${mesa.nome.toLowerCase().replace(/\s+/g, '-')}`} />
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
      {trocando && (
        <ModalTrocarMesa
          origem={mesa}
          mesas={mesas}
          totalDa={totalDa}
          aoFechar={() => setTrocando(false)}
          aoTrocar={() => { setTrocando(false); aoMudar(); aoFechar(); }}
        />
      )}
    </Modal>
  );
}

function ModalLinks({ mesas, aoFechar }: { mesas: Mesa[]; aoFechar: () => void }) {
  return (
    <Modal aberto aoFechar={aoFechar} titulo="Links dos tablets" largura={640}>
      <p className="muted" style={{ marginTop: 0 }}>
        Abra o link de cada mesa no tablet correspondente e deixe a tela aberta. Dica: no tablet, use o menu do Chrome →
        <b> Adicionar à tela inicial</b> para abrir em tela cheia.
      </p>
      <ul className="lista-links">
        {mesas.map((m) => (
          <li key={m.id}>
            <strong>{m.nome}</strong>
            <LinkCopiavel link={linkMesa(m.token)} compacto />
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Primeiro número livre: se faltar a Mesa 1, sugere ela; senão, a próxima depois da última. */
function proximoNome(mesas: Mesa[]) {
  const usados = new Set(mesas.map((m) => /^mesa\s+(\d+)$/i.exec(m.nome.trim())?.[1]).filter(Boolean).map(Number));
  let n = 1;
  while (usados.has(n)) n++;
  return `Mesa ${n}`;
}

function ModalNovaMesa({ restauranteId, sugestao, nomesUsados, ordem, aoFechar, aoCriar }: {
  restauranteId: string;
  sugestao: string;
  nomesUsados: string[];
  ordem: number;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(sugestao);
  const [salvando, setSalvando] = useState(false);

  const repetido = nomesUsados.includes(nome.trim().toLowerCase());

  async function criar() {
    if (repetido) return toast(`Já existe uma mesa chamada "${nome.trim()}".`, 'erro');
    setSalvando(true);
    // "Mesa 1" entra na posição 1 da lista (não no fim)
    const numero = /^mesa\s+(\d+)$/i.exec(nome.trim())?.[1];
    const { error } = await supabase.from('mesas').insert({ restaurante_id: restauranteId, nome: nome.trim(), ordem: numero ? Number(numero) : ordem });
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
      <Campo rotulo="Nome" dica={repetido ? 'Já existe uma mesa com esse nome.' : 'Ex.: Mesa 12, Varanda 3, Balcão'}>
        <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} autoFocus />
      </Campo>
    </Modal>
  );
}

/** Aparelhos liberados (ou pedindo) para fazer pedidos nesta mesa. */
function AparelhosMesa({ mesa }: { mesa: Mesa }) {
  const toast = useToast();
  const { acessos: pendentes } = usePainel();
  const [lista, setLista] = useState<MesaAcesso[] | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('mesa_acessos').select('*').eq('mesa_id', mesa.id)
      .in('status', ['liberado', 'pendente']).order('criado_em');
    setLista((data ?? []) as MesaAcesso[]);
  }, [mesa.id]);
  useEffect(() => { void carregar(); }, [carregar, pendentes]);

  async function agir(a: MesaAcesso, acao: 'liberar' | 'fixo' | 'recusar' | 'desconectar') {
    try {
      if (acao === 'desconectar') {
        const { error } = await supabase.rpc('mesa_acesso_encerrar', { p_acesso: a.id });
        if (error) throw error;
      } else {
        await responderAcesso(a.id, acao !== 'recusar', acao === 'fixo');
      }
      void carregar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    }
  }

  return (
    <section className="bloco">
      <h3>Aparelhos que podem pedir</h3>
      <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
        Quem abre o QR code só faz pedidos depois que alguém da equipe libera. Ao fechar a conta, os celulares perdem o acesso; o tablet fixo continua.
      </p>
      {lista && lista.length === 0 && <p className="aparelhos__vazio">Nenhum aparelho liberado. A mesa está fechada para pedidos.</p>}
      {lista && lista.length > 0 && (
        <ul className="aparelhos">
          {lista.map((a) => (
            <li key={a.id}>
              <span className={cx('aparelhos__icone', a.status === 'pendente' && 'aparelhos__icone--pendente')}>{iconeAparelho(a.aparelho, 17)}</span>
              <div className="aparelhos__texto">
                <strong>{a.aparelho ?? 'Aparelho'}{a.fixo && <span className="badge badge--azul">Tablet fixo</span>}</strong>
                <small>
                  {a.status === 'pendente'
                    ? `Pedindo para abrir · ${hora(a.criado_em)}`
                    : `Liberado${a.respondido_por_nome ? ` por ${a.respondido_por_nome}` : ''}${a.respondido_em ? ` às ${hora(a.respondido_em)}` : ''}`}
                </small>
              </div>
              {a.status === 'pendente' ? (
                <div className="acoes-linha">
                  <button className="btn btn--fantasma btn--sm" onClick={() => void agir(a, 'recusar')}>Recusar</button>
                  <button className="btn btn--sucesso btn--sm" onClick={() => void agir(a, 'liberar')}>Liberar</button>
                </div>
              ) : (
                <button className="btn btn--fantasma btn--sm" onClick={() => void agir(a, 'desconectar')}>Desconectar</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
