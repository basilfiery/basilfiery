import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, Check, ChevronDown, Columns3, LayoutList, Clock, ConciergeBell, LayoutGrid, Minus, Plus, Printer, Receipt, RefreshCw, Search, Smartphone, Tablet, Trash2, Users, Wallet } from 'lucide-react';
import { Suspenso } from '../../componentes/Suspenso';
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
import { STATUS_ROTULO, brl, cx, descreverChamado, ehGestor, hora, ls, ordenarNome, podeCaixa, rotuloForma, tempoDesde, useAgora } from '../../lib/util';
import { usePainel } from './Painel';
import { linkMesa } from '../../lib/linkCurto';
import { confirmar } from '../../componentes/Confirmar';


type Situacao = 'livre' | 'ocupada' | 'pagando' | 'inativa';
type Filtro = 'todas' | 'livre' | 'ocupada' | 'pagando';
const ROTULO_SITUACAO: Record<Situacao, string> = { livre: 'Livre', ocupada: 'Ocupada', pagando: 'Pagando conta', inativa: 'Desativada' };

/** "42 min", "1h 05 min" */
function duracao(desde: string, agora: number) {
  const min = Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')} min`;
}

export default function Mesas() {
  const { restaurante, papel, pedidos: aoVivo, chamados, acessos } = usePainel();
  const toast = useToast();
  const navegar = useNavigate();
  const agora = useAgora(30000);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [abertos, setAbertos] = useState<Pedido[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [selecionada, setSelecionada] = useState<Mesa | null>(null);
  const [trocandoDe, setTrocandoDe] = useState<Mesa | null>(null);
  const [criando, setCriando] = useState(false);
  const [verLinks, setVerLinks] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [busca, setBusca] = useState('');
  const [setor, setSetor] = useState('');
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
  const situacao = (m: Mesa): Situacao => {
    if (!m.ativo) return 'inativa';
    if (!pedidosDa(m.id).length) return 'livre';
    return chamadosDa(m.id).some((c) => c.tipo === 'conta') ? 'pagando' : 'ocupada';
  };

  async function definirPessoas(m: Mesa, n: number | null) {
    setMesas((l) => l.map((x) => (x.id === m.id ? { ...x, pessoas: n } : x)));
    const { error } = await supabase.rpc('mesa_definir_pessoas', { p_mesa: m.id, p_pessoas: n ?? 0 });
    if (error) { toast(msgErro(error), 'erro'); void carregar(); }
  }

  const setores = [...new Set(mesas.map((m) => (m.setor ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const termo = busca.trim().toLowerCase();
  const base = mesas.filter((m) => (!setor || (m.setor ?? '') === setor) && (!termo || m.nome.toLowerCase().includes(termo)));
  const conta = (f: Filtro) => (f === 'todas' ? base.length : base.filter((m) => situacao(m) === f).length);
  const lista = filtro === 'todas' ? base : base.filter((m) => situacao(m) === filtro);
  // Setores na ordem das mesas (o setor da primeira mesa vem primeiro); "Sem setor" por último
  const [agrupar, setAgruparEstado] = useState(() => ls.ler('bf:mesas:agrupar', true));
  const setAgrupar = (v: boolean) => { setAgruparEstado(v); ls.gravar('bf:mesas:agrupar', v); };
  const [organizando, setOrganizando] = useState(false);
  const grupos: { nome: string; mesas: Mesa[] }[] = [];
  for (const m of lista) {
    const nome = (m.setor ?? '').trim();
    const g = grupos.find((x) => x.nome === nome);
    if (g) g.mesas.push(m); else grupos.push({ nome, mesas: [m] });
  }
  grupos.sort((a, b) => (a.nome ? 0 : 1) - (b.nome ? 0 : 1) || mesas.indexOf(a.mesas[0]) - mesas.indexOf(b.mesas[0]));

  const cartao = (m: Mesa) => {
    const ps = pedidosDa(m.id);
    const total = ps.reduce((s, p) => s + Number(p.total), 0);
    const st = situacao(m);
    const cs = chamadosDa(m.id).filter((c) => c.tipo !== 'conta');
    const pedindo = acessos.filter((a) => a.mesa_id === m.id).length;
    const comConta = st === 'ocupada' || st === 'pagando';
    return (
      <article
        key={m.id}
        className={cx('mc', `mc--${st}`)}
        role="button"
        tabIndex={0}
        onClick={() => setSelecionada(m)}
        onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setSelecionada(m); }}
        aria-label={`${m.nome}, ${ROTULO_SITUACAO[st]}`}
      >
        <header className="mc__topo">
          <div className="mc__nome">
            <strong>{m.nome}</strong>
            {m.setor && <small>{m.setor}</small>}
          </div>
          <div className="mc__acoes" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {m.ativo && (
              <button className="mc__pedido" onClick={() => navegar(`/painel/pdv?mesa=${m.id}`)}><Plus size={17} /> Pedido</button>
            )}
            <Suspenso
              largura={268}
              gatilho={(aberto, alternar) => (
                <button className={cx('mc__menu', aberto && 'aberto')} onClick={alternar} aria-label={`Mais opções da ${m.nome}`}><ChevronDown size={18} /></button>
              )}
            >
              {(fechar) => (
                <>
                  <button className="menu-item" onClick={() => { fechar(); setSelecionada(m); }}><Receipt size={17} /> {comConta ? 'Ver conta e fechar' : 'Detalhes da mesa'}</button>
                  {comConta && <button className="menu-item" onClick={() => { fechar(); imprimirConta(m.nome, restaurante.nome, ps); }}><Printer size={17} /> Imprimir conta</button>}
                  {comConta && <button className="menu-item" onClick={() => { fechar(); setTrocandoDe(m); }}><ArrowRightLeft size={17} /> Trocar de mesa</button>}
                  <div className="menu-sep" />
                  <div className="mc-pessoas">
                    <span><Users size={16} /> Pessoas na mesa</span>
                    <div>
                      <button aria-label="Menos uma pessoa" disabled={!m.pessoas} onClick={() => void definirPessoas(m, m.pessoas && m.pessoas > 1 ? m.pessoas - 1 : null)}><Minus size={15} /></button>
                      <b>{m.pessoas ?? '—'}</b>
                      <button aria-label="Mais uma pessoa" onClick={() => void definirPessoas(m, Math.min(99, (m.pessoas ?? 0) + 1))}><Plus size={15} /></button>
                    </div>
                  </div>
                  <div className="menu-sep" />
                  <button className="menu-item" onClick={() => { fechar(); void navigator.clipboard?.writeText(linkMesa(restaurante.slug, m, mesas)).then(() => toast('Link do tablet copiado.', 'ok')); }}><Tablet size={17} /> Copiar link do tablet</button>
                </>
              )}
            </Suspenso>
          </div>
        </header>

        <div className="mc__meio">
          {comConta ? (
            <>
              <span className="mc__dado"><Users size={16} /> {m.pessoas ? `${m.pessoas} ${m.pessoas === 1 ? 'pessoa' : 'pessoas'}` : <em>— pessoas</em>}</span>
              <span className="mc__dado"><Clock size={16} /> {duracao(ps[0].criado_em, agora)}</span>
              <strong className="mc__total">{brl(total)}</strong>
            </>
          ) : null}
          {(cs.length > 0 || pedindo > 0) && (
            <div className="mc__alertas">
              {pedindo > 0 && <span className="badge badge--icone badge--amarelo"><Smartphone size={13} /> Pedindo para abrir</span>}
              {cs.map((c) => (
                <span key={c.id} className="badge badge--icone badge--laranja"><ConciergeBell size={13} /> {descreverChamado(c)} · {tempoDesde(c.criado_em, agora)}</span>
              ))}
            </div>
          )}
        </div>

        <footer className="mc__status"><i aria-hidden="true" /> {ROTULO_SITUACAO[st]}</footer>
      </article>
    );
  };
  const FILTROS: { id: Filtro; rotulo: string }[] = [
    { id: 'todas', rotulo: 'Todas' }, { id: 'livre', rotulo: 'Livres' }, { id: 'ocupada', rotulo: 'Ocupadas' }, { id: 'pagando', rotulo: 'Pagando conta' },
  ];

  return (
    <div className="pagina mesas-pag">
      <div className="mesas-cab">
        <div className="mesas-cab__titulo">
          <h1 className="titulo">Mesas</h1>
          <p>Acompanhe as mesas do seu estabelecimento em tempo real.</p>
        </div>
        <div className="mesas-cab__acoes">
          <label className="mesas-busca">
            <Search size={19} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar mesa..." aria-label="Buscar mesa" />
          </label>
          <span className="mesas-setor">
            <select value={setor} onChange={(e) => setSetor(e.target.value)} aria-label="Setor">
              <option value="">Todos os setores</option>
              {setores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown size={18} />
          </span>
          {mesas.length > 0 && (
            <button className="mesas-icone" onClick={() => setVerLinks(true)} title="Links dos tablets" aria-label="Links dos tablets"><Tablet size={19} /></button>
          )}
          {gestor && mesas.length > 0 && (
            <button className="mesas-icone mesas-icone--texto" onClick={() => setOrganizando(true)} title="Organizar mesas por setor"><Columns3 size={19} /> Setores</button>
          )}
          {gestor && <button className="mesas-nova" onClick={() => setCriando(true)}><Plus size={20} /> Nova mesa</button>}
        </div>
      </div>

      {mesas.length > 0 && (
        <div className="mesas-filtros" role="tablist" aria-label="Filtrar mesas">
          {FILTROS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filtro === f.id} className={cx('mesas-filtro', `mesas-filtro--${f.id}`, filtro === f.id && 'ativo')} onClick={() => setFiltro(f.id)}>
              {f.id !== 'todas' && <i aria-hidden="true" />}
              {f.rotulo}
              <b>{conta(f.id)}</b>
            </button>
          ))}
          {setores.length > 0 && (
            <button className={cx('mesas-visao', agrupar && 'ativo')} onClick={() => setAgrupar(!agrupar)} title={agrupar ? 'Mostrar todas juntas' : 'Separar por setor'}>
              {agrupar ? <LayoutList size={17} /> : <Columns3 size={17} />} {agrupar ? 'Separadas por setor' : 'Todas juntas'}
            </button>
          )}
        </div>
      )}

      {carregado && mesas.length === 0 ? (
        <Vazio icone={<LayoutGrid size={36} />} titulo="Nenhuma mesa cadastrada">
          {gestor ? 'Crie as mesas e abra o link de cada uma no tablet correspondente.' : 'Peça ao gerente para cadastrar as mesas.'}
        </Vazio>
      ) : lista.length === 0 && carregado ? (
        <p className="mesas-nada">Nenhuma mesa {filtro === 'livre' ? 'livre' : filtro === 'ocupada' ? 'ocupada' : filtro === 'pagando' ? 'pagando a conta' : 'encontrada'}{termo ? ` com “${busca.trim()}”` : ''}.</p>
      ) : (
        agrupar && grupos.length > 1 ? (
          <div className="mesas-setores">
            {grupos.map((g) => {
              const livres = g.mesas.filter((m) => situacao(m) === 'livre').length;
              const comConta = g.mesas.filter((m) => situacao(m) === 'ocupada' || situacao(m) === 'pagando');
              const totalSetor = comConta.reduce((s2, m) => s2 + totalDa(m.id), 0);
              return (
                <section key={g.nome || "sem"} className="mesas-setor-bloco">
                  <header className="mesas-setor-bloco__cab">
                    <h2>{g.nome || "Sem setor"}</h2>
                    <span className="mesas-setor-bloco__info">
                      {g.mesas.length} {g.mesas.length === 1 ? 'mesa' : 'mesas'}
                      <i className="livre" />{livres} {livres === 1 ? 'livre' : 'livres'}
                      <i className="ocupada" />{comConta.length} {comConta.length === 1 ? 'ocupada' : 'ocupadas'}
                      {totalSetor > 0 && <b>{brl(totalSetor)}</b>}
                    </span>
                  </header>
                  <div className="mesas-grade2">{g.mesas.map(cartao)}</div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="mesas-grade2">{lista.map(cartao)}</div>
        )
      )}

      {selecionada && (
        <ModalMesa
          mesa={mesas.find((x) => x.id === selecionada.id) ?? selecionada}
          pedidos={pedidosDa(selecionada.id)}
          chamados={chamadosDa(selecionada.id)}
          restauranteNome={restaurante.nome}
          podeFechar={podeCaixa(papel)}
          gestor={gestor}
          mesas={mesas}
          setores={setores}
          totalDa={totalDa}
          aoFechar={() => setSelecionada(null)}
          aoMudar={() => void carregar()}
        />
      )}

      {trocandoDe && (
        <ModalTrocarMesa
          origem={trocandoDe}
          mesas={mesas}
          totalDa={totalDa}
          aoFechar={() => setTrocandoDe(null)}
          aoTrocar={() => { setTrocandoDe(null); void carregar(); }}
        />
      )}

      {organizando && (
        <ModalSetores
          mesas={mesas}
          aoFechar={() => setOrganizando(false)}
          aoMudar={(ids, setorNovo) => setMesas((l) => l.map((x) => (ids.includes(x.id) ? { ...x, setor: setorNovo } : x)))}
        />
      )}

      {verLinks && <ModalLinks mesas={mesas.filter((m) => m.ativo)} aoFechar={() => setVerLinks(false)} />}

      {criando && (
        <ModalNovaMesa
          restauranteId={restaurante.id}
          sugestao={proximoNome(mesas)}
          nomesUsados={mesas.map((m) => m.nome.trim().toLowerCase())}
          ordem={Math.max(0, ...mesas.map((m) => m.ordem)) + 1}
          setores={setores}
          aoFechar={() => setCriando(false)}
          aoCriar={() => { setCriando(false); void carregar(); }}
        />
      )}
    </div>
  );
}

function ModalMesa({ mesa, pedidos, chamados, restauranteNome, podeFechar, gestor, mesas, setores, totalDa, aoFechar, aoMudar }: {
  mesa: Mesa;
  setores: string[];
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
  const [setorMesa, setSetorMesa] = useState(mesa.setor ?? '');
  const [token, setToken] = useState(mesa.token);
  const [ativo, setAtivo] = useState(mesa.ativo);
  const [ocupado, setOcupado] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  const { restaurante } = usePainel();
  const link = linkMesa(restaurante.slug, { ...mesa, token }, mesas);

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
                    <li key={i.id}><span>{i.qtd}× {i.nome}{i.complementos && <small className="muted" style={{ display: 'block' }}>{i.complementos}</small>}</span><span>{brl(i.qtd * i.preco_unit)}</span></li>
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
          <div className="acoes-linha" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <Campo rotulo="Setor" dica="Ex.: Salão, Varanda, Área externa. Serve para filtrar as mesas.">
                <input className="input" list="setores-mesa" value={setorMesa} onChange={(e) => setSetorMesa(e.target.value)} maxLength={40} placeholder="Sem setor" />
                <datalist id="setores-mesa">{setores.map((x) => <option key={x} value={x} />)}</datalist>
              </Campo>
            </div>
            <button
              className="btn btn--contorno"
              disabled={setorMesa.trim() === (mesa.setor ?? '')}
              onClick={() => void salvar({ setor: setorMesa.trim() || null }).then((ok) => ok && toast('Setor atualizado.', 'ok'))}
            >
              Salvar setor
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
  const { restaurante } = usePainel();
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
            <LinkCopiavel link={linkMesa(restaurante.slug, m, mesas)} compacto />
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

function ModalNovaMesa({ restauranteId, sugestao, nomesUsados, ordem, setores, aoFechar, aoCriar }: {
  restauranteId: string;
  setores: string[];
  sugestao: string;
  nomesUsados: string[];
  ordem: number;
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(sugestao);
  const [setor, setSetor] = useState('');
  const [salvando, setSalvando] = useState(false);

  const repetido = nomesUsados.includes(nome.trim().toLowerCase());

  async function criar() {
    if (repetido) return toast(`Já existe uma mesa chamada "${nome.trim()}".`, 'erro');
    setSalvando(true);
    // "Mesa 1" entra na posição 1 da lista (não no fim)
    const numero = /^mesa\s+(\d+)$/i.exec(nome.trim())?.[1];
    const { error } = await supabase.from('mesas').insert({ restaurante_id: restauranteId, nome: nome.trim(), ordem: numero ? Number(numero) : ordem, setor: setor.trim() || null });
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
      <Campo rotulo="Setor (opcional)" dica="Ex.: Salão, Varanda, Área externa.">
        <input className="input" list="setores-nova" value={setor} onChange={(e) => setSetor(e.target.value)} maxLength={40} placeholder="Sem setor" />
        <datalist id="setores-nova">{setores.map((x) => <option key={x} value={x} />)}</datalist>
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

/* ---------------- Organizar mesas por setor ---------------- */
const SUGESTOES_SETOR = ['Salão', 'Área externa', 'Lado de fora', 'Varanda', 'Mezanino', 'Balcão'];

function ModalSetores({ mesas, aoFechar, aoMudar }: { mesas: Mesa[]; aoFechar: () => void; aoMudar: (ids: string[], setor: string | null) => void }) {
  const toast = useToast();
  const existentes = [...new Set(mesas.map((m) => (m.setor ?? '').trim()).filter(Boolean))];
  const [setores, setSetores] = useState<string[]>(existentes.length ? existentes : []);
  const [novo, setNovo] = useState('');
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState(existentes[0] ?? '');
  const [salvando, setSalvando] = useState(false);

  function criarSetor(nome: string) {
    const n = nome.trim().slice(0, 40);
    if (!n) return;
    if (!setores.some((x) => x.toLowerCase() === n.toLowerCase())) setSetores((l) => [...l, n]);
    setDestino(n);
    setNovo('');
  }

  async function mover(ids: string[], setor: string) {
    if (!ids.length) return;
    setSalvando(true);
    const valor = setor.trim() || null;
    const { error } = await supabase.from('mesas').update({ setor: valor }).in('id', ids);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    aoMudar(ids, valor);
    setMarcadas(new Set());
    toast(`${ids.length} ${ids.length === 1 ? 'mesa movida' : 'mesas movidas'} para ${valor ?? 'Sem setor'}.`, 'ok');
  }

  const alternar = (id: string) => setMarcadas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sugestoes = SUGESTOES_SETOR.filter((x) => !setores.some((y) => y.toLowerCase() === x.toLowerCase()));

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Organizar mesas por setor" largura={640} classe="setores-modal">
      <div className="setores">
        <section className="setores__bloco">
          <h3>1. Seus setores</h3>
          <div className="setores__chips">
            {setores.map((x) => (
              <button key={x} type="button" className={cx('setores__chip', destino === x && 'ativo')} onClick={() => setDestino(x)}>{x}</button>
            ))}
            {sugestoes.slice(0, 4).map((x) => (
              <button key={x} type="button" className="setores__chip setores__chip--sugestao" onClick={() => criarSetor(x)}><Plus size={14} /> {x}</button>
            ))}
          </div>
          <form className="setores__novo" onSubmit={(e) => { e.preventDefault(); criarSetor(novo); }}>
            <input className="input" value={novo} onChange={(e) => setNovo(e.target.value)} maxLength={40} placeholder="Outro setor (ex.: Deck, Piscina)" />
            <button className="btn btn--contorno" disabled={!novo.trim()}><Plus size={16} /> Criar</button>
          </form>
        </section>

        <section className="setores__bloco">
          <h3>2. Marque as mesas e mova para o setor</h3>
          <ul className="setores__mesas">
            {mesas.map((m) => (
              <li key={m.id}>
                <button type="button" className={cx('setores__mesa', marcadas.has(m.id) && 'marcada')} onClick={() => alternar(m.id)} aria-pressed={marcadas.has(m.id)}>
                  <span className="setores__check">{marcadas.has(m.id) && <Check size={13} strokeWidth={3} />}</span>
                  <b>{m.nome}</b>
                  <small>{m.setor || 'Sem setor'}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <div className="setores__barra">
        <span>{marcadas.size ? `${marcadas.size} ${marcadas.size === 1 ? 'mesa marcada' : 'mesas marcadas'}` : 'Marque as mesas acima'}</span>
        <select className="select" value={destino} onChange={(e) => setDestino(e.target.value)} aria-label="Setor de destino">
          {!setores.length && <option value="">Crie um setor primeiro</option>}
          {setores.map((x) => <option key={x} value={x}>{x}</option>)}
          <option value="">Sem setor</option>
        </select>
        <button className="btn btn--primario" disabled={!marcadas.size || salvando} onClick={() => void mover([...marcadas], destino)}>
          {salvando ? 'Movendo…' : `Mover para ${destino || 'Sem setor'}`}
        </button>
      </div>
    </Modal>
  );
}
