import { useEffect, useMemo, useState } from 'react';
import {
  Ban, Check, ChefHat, ClipboardList, Clock, ConciergeBell, ExternalLink, Eye, GlassWater, LayoutGrid, List, MoreVertical, Plus, Printer,
  SlidersHorizontal, UtensilsCrossed, X,
} from 'lucide-react';
import { FotoProduto, Switch, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { Suspenso } from '../../componentes/Suspenso';
import { useToast } from '../../componentes/Toast';
import { imprimirPedido } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { Mesa, Pedido, StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, hora, minutosDesde, ordenarNome, tempoDesde, useAgora } from '../../lib/util';
import { usePainel } from './Painel';

type Coluna = 'novo' | 'preparando' | 'pronto' | 'entregue';
type Aba = 'todos' | Coluna | 'finalizados';
type Vista = 'quadro' | 'lista';
interface FotoInfo { imagem_url: string | null; emoji: string | null }

const COLUNAS: { id: Coluna; titulo: string }[] = [
  { id: 'novo', titulo: 'Novos' },
  { id: 'preparando', titulo: 'Em preparo' },
  { id: 'pronto', titulo: 'Prontos' },
  { id: 'entregue', titulo: 'Entregues' },
];
const ENTREGUES_RECENTES_MIN = 60;
const ATRASO_MIN = 15;

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------------- Ações de status (compartilhadas) ---------------- */
function useMudarStatus() {
  const { atualizarPedido } = usePainel();
  const toast = useToast();
  return async (p: Pedido, status: StatusPedido) => {
    if (status === 'cancelado' && !confirm(`Cancelar o pedido #${p.numero} (${p.mesa_nome})? Os itens voltam para o estoque.`)) return;
    const antes = p.status;
    atualizarPedido(p.id, { status, atualizado_em: new Date().toISOString() });
    const { error } = await supabase.rpc('pedido_mudar_status', { p_pedido: p.id, p_status: status });
    if (error) {
      atualizarPedido(p.id, { status: antes });
      toast(msgErro(error), 'erro');
    }
  };
}

/** Ação principal de cada estágio (nada inventado: só os status que existem). */
function acaoPrincipal(p: Pedido) {
  switch (p.status) {
    // rotulo: curto, para o cartão do quadro · longo: painel de detalhes e lista
    case 'novo':
      // Só bebidas/itens prontos: ao aceitar, já fica pronto para servir
      return p.precisa_preparo === false
        ? { rotulo: 'Aceitar', longo: 'Aceitar e servir', proximo: 'pronto' as const, classe: 'btn--primario', icone: null }
        : { rotulo: 'Aceitar', longo: 'Aceitar pedido', proximo: 'preparando' as const, classe: 'btn--primario', icone: null };
    case 'preparando': return { rotulo: 'Marcar pronto', longo: 'Marcar como pronto', proximo: 'pronto' as const, classe: 'btn--pronto', icone: <Check size={16} /> };
    case 'pronto': return { rotulo: 'Marcar entregue', longo: 'Entregue na mesa', proximo: 'entregue' as const, classe: 'btn--entregar', icone: <ConciergeBell size={16} /> };
    default: return null;
  }
}

export default function Pedidos() {
  const { pedidos, restaurante, carregando, conectado, busca } = usePainel();
  const mudar = useMudarStatus();
  const agora = useAgora(20000);
  const [aba, setAba] = useState<Aba>('todos');
  const [vista, setVista] = useState<Vista>('quadro');
  const [selId, setSelId] = useState<string | null>(null);
  const [filtroMesa, setFiltroMesa] = useState('');
  const [soAtrasados, setSoAtrasados] = useState(false);
  const [novoPedido, setNovoPedido] = useState(false);
  const [fotos, setFotos] = useState<Map<string, FotoInfo>>(new Map());

  // Fotos/emojis dos produtos para o painel de detalhes
  useEffect(() => {
    void supabase.from('produtos').select('id, imagem_url, emoji').eq('restaurante_id', restaurante.id)
      .then(({ data }) => setFotos(new Map((data ?? []).map((p) => [p.id as string, p as FotoInfo]))));
  }, [restaurante.id]);

  // Esc fecha o painel de detalhes
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.modal-fundo')) setSelId(null); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, []);

  /* ---------- Filtros (busca da barra superior + mesa + atrasados) ---------- */
  const termo = normalizar(busca.trim().replace(/^#/, ''));
  const filtrados = useMemo(() => pedidos.filter((p) => {
    if (filtroMesa && p.mesa_nome !== filtroMesa) return false;
    if (soAtrasados && !((p.status === 'novo' || p.status === 'preparando') && minutosDesde(p.criado_em, agora) >= ATRASO_MIN)) return false;
    if (!termo) return true;
    return String(p.numero) === termo
      || normalizar(p.mesa_nome).includes(termo)
      || p.pedido_itens.some((i) => normalizar(i.nome).includes(termo));
  }), [pedidos, filtroMesa, soAtrasados, termo, agora]);

  const porColuna = useMemo(() => {
    const m: Record<Coluna, Pedido[]> = { novo: [], preparando: [], pronto: [], entregue: [] };
    for (const p of filtrados) {
      if (p.status === 'entregue') {
        if (minutosDesde(p.atualizado_em, agora) <= ENTREGUES_RECENTES_MIN) m.entregue.push(p);
      } else if (p.status !== 'cancelado') {
        m[p.status].push(p);
      }
    }
    m.entregue.reverse(); // mais recentes primeiro
    return m;
  }, [filtrados, agora]);

  const finalizados = useMemo(
    () => filtrados.filter((p) => p.status === 'entregue' || p.status === 'cancelado').slice().reverse(),
    [filtrados],
  );
  const totalTodos = COLUNAS.reduce((s, c) => s + porColuna[c.id].length, 0);
  const mesasComPedido = useMemo(() => [...new Set(pedidos.map((p) => p.mesa_nome))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })), [pedidos]);
  const filtrosAtivos = (filtroMesa ? 1 : 0) + (soAtrasados ? 1 : 0);
  const selecionado = pedidos.find((p) => p.id === selId) ?? null;

  if (carregando) return <Carregando />;

  const colunasVisiveis = aba === 'todos' ? COLUNAS : COLUNAS.filter((c) => c.id === aba);
  const listaDaAba: Pedido[] = aba === 'finalizados'
    ? finalizados
    : aba === 'todos' ? COLUNAS.flatMap((c) => porColuna[c.id]) : porColuna[aba as Coluna];
  const mostrarLista = vista === 'lista' || aba === 'finalizados';

  return (
    <div className="pedidos">
      <div className="pedidos__cab">
        <h1>Pedidos</h1>
        <span className={cx('ao-vivo', conectado && 'on')}>{conectado ? 'Ao vivo' : 'Reconectando…'}</span>
        <button className="btn btn--primario btn--novo" onClick={() => setNovoPedido(true)}>
          <Plus size={20} /> Novo pedido
        </button>
      </div>

      <div className="pedidos__barra">
        <div className="pedidos__abas" role="tablist" aria-label="Filtrar por status">
          <AbaStatus ativa={aba === 'todos'} onClick={() => setAba('todos')} rotulo="Todos" qtd={totalTodos} />
          {COLUNAS.map((c) => (
            <AbaStatus key={c.id} ativa={aba === c.id} onClick={() => setAba(c.id)} rotulo={c.titulo} qtd={porColuna[c.id].length} tipo={c.id} />
          ))}
          <AbaStatus ativa={aba === 'finalizados'} onClick={() => setAba('finalizados')} rotulo="Finalizados" />
        </div>

        <div className="pedidos__ferramentas">
          <div className="alternar-vista" role="group" aria-label="Visualização">
            <button className={cx(mostrarLista && 'ativo')} onClick={() => setVista('lista')} title="Lista" aria-label="Ver em lista"><List size={18} /></button>
            <button className={cx(!mostrarLista && 'ativo')} onClick={() => { setVista('quadro'); if (aba === 'finalizados') setAba('todos'); }} title="Quadro" aria-label="Ver em quadro"><LayoutGrid size={18} /></button>
          </div>
          <Suspenso
            largura={280}
            gatilho={(_, alternar) => (
              <button className={cx('btn btn--contorno btn-filtros', filtrosAtivos > 0 && 'ativo')} onClick={alternar}>
                <SlidersHorizontal size={18} /> Filtros {filtrosAtivos > 0 && <b>{filtrosAtivos}</b>}
              </button>
            )}
          >
            {() => (
              <div className="filtros-pop">
                <label className="campo">
                  <span>Mesa</span>
                  <select className="select" value={filtroMesa} onChange={(e) => setFiltroMesa(e.target.value)}>
                    <option value="">Todas as mesas</option>
                    {mesasComPedido.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <Switch marcado={soAtrasados} aoMudar={setSoAtrasados}>Só atrasados (mais de {ATRASO_MIN} min)</Switch>
                {filtrosAtivos > 0 && (
                  <button className="btn btn--fantasma btn--sm" onClick={() => { setFiltroMesa(''); setSoAtrasados(false); }}>Limpar filtros</button>
                )}
              </div>
            )}
          </Suspenso>
        </div>
      </div>

      <div className="pedidos__corpo">
        {mostrarLista ? (
          <ListaPedidos pedidos={listaDaAba} agora={agora} selId={selId} aoSelecionar={setSelId} aoMudar={mudar} finalizados={aba === 'finalizados'} />
        ) : (
          <div className="quadro">
            {colunasVisiveis.map((c) => (
              <section key={c.id} className={`coluna coluna--${c.id}`}>
                <header className="coluna__topo">
                  <h2>{c.titulo}</h2>
                  <span className="coluna__qtd">{porColuna[c.id].length}</span>
                </header>
                <div className="coluna__lista">
                  {porColuna[c.id].map((p) => (
                    <CartaoPedido
                      key={p.id}
                      pedido={p}
                      agora={agora}
                      selecionado={p.id === selId}
                      aoSelecionar={() => setSelId(p.id === selId ? null : p.id)}
                      aoMudar={(st) => void mudar(p, st)}
                      aoImprimir={() => imprimirPedido(p, restaurante.nome)}
                    />
                  ))}
                  {porColuna[c.id].length === 0 && (
                    <p className="coluna__vazia">
                      {c.id === 'entregue' ? `Nada entregue na última hora` : termo || filtrosAtivos ? 'Nenhum pedido com esse filtro' : 'Nenhum pedido'}
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}

        {selecionado && (
          <PainelDetalhes
            pedido={selecionado}
            fotos={fotos}
            agora={agora}
            aoFechar={() => setSelId(null)}
            aoMudar={(st) => void mudar(selecionado, st)}
            aoImprimir={() => imprimirPedido(selecionado, restaurante.nome)}
          />
        )}
      </div>

      {novoPedido && <ModalNovoPedido restauranteId={restaurante.id} aoFechar={() => setNovoPedido(false)} />}
    </div>
  );
}

function AbaStatus({ ativa, onClick, rotulo, qtd, tipo }: { ativa: boolean; onClick: () => void; rotulo: string; qtd?: number; tipo?: Coluna }) {
  return (
    <button role="tab" aria-selected={ativa} className={cx('aba-status', tipo && `aba-status--${tipo}`, ativa && 'ativo')} onClick={onClick}>
      {rotulo}
      {qtd !== undefined && <b>{qtd}</b>}
    </button>
  );
}

/* ---------------- Cartão do quadro ---------------- */
function TempoPedido({ p, agora }: { p: Pedido; agora: number }) {
  if (p.status === 'entregue') return <span className="cp__tempo ok"><Check size={14} /> {hora(p.atualizado_em)}</span>;
  if (p.status === 'cancelado') return <span className="cp__tempo">{hora(p.atualizado_em)}</span>;
  const min = minutosDesde(p.criado_em, agora);
  const texto = min < 1 ? 'Agora' : tempoDesde(p.criado_em, agora);
  return (
    <span className={cx('cp__tempo', (p.status === 'novo' || min >= 20) && 'urgente')} title={`Pedido feito às ${hora(p.criado_em)}`}>
      <Clock size={14} /> {texto}
    </span>
  );
}

function MenuPedido({ p, aoVer, aoImprimir, aoMudar }: { p: Pedido; aoVer?: () => void; aoImprimir: () => void; aoMudar: (s: StatusPedido) => void }) {
  return (
    <Suspenso
      largura={220}
      gatilho={(_, alternar) => (
        <button className="icone-quadro" onClick={alternar} aria-label={`Mais ações do pedido #${p.numero}`}><MoreVertical size={18} /></button>
      )}
    >
      {(fechar) => (
        <>
          {aoVer && <button className="menu-item" onClick={() => { aoVer(); fechar(); }}><Eye size={18} /> Ver detalhes</button>}
          <button className="menu-item" onClick={() => { aoImprimir(); fechar(); }}><Printer size={18} /> Imprimir pedido</button>
          {p.status !== 'entregue' && p.status !== 'cancelado' && (
            <>
              <div className="menu-sep" />
              <button className="menu-item menu-item--perigo" onClick={() => { fechar(); aoMudar('cancelado'); }}><Ban size={18} /> Cancelar pedido</button>
            </>
          )}
        </>
      )}
    </Suspenso>
  );
}

function CartaoPedido({ pedido: p, agora, selecionado, aoSelecionar, aoMudar, aoImprimir }: {
  pedido: Pedido;
  agora: number;
  selecionado: boolean;
  aoSelecionar: () => void;
  aoMudar: (s: StatusPedido) => void;
  aoImprimir: () => void;
}) {
  const acao = acaoPrincipal(p);
  const mostrar = p.pedido_itens.slice(0, 3);
  const resto = p.pedido_itens.length - mostrar.length;

  return (
    <article
      className={cx('cp', selecionado && 'selecionado')}
      onClick={aoSelecionar}
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) aoSelecionar(); }}
      aria-label={`Pedido ${p.numero}, ${p.mesa_nome}, ${STATUS_ROTULO[p.status]}`}
    >
      <header className="cp__topo">
        <strong className="cp__num">#{p.numero}</strong>
        <TempoPedido p={p} agora={agora} />
        <span className="cp__tipo"><UtensilsCrossed size={13} /> Mesa</span>
      </header>
      <div className="cp__cliente">
        {p.mesa_nome}
        {p.precisa_preparo === false && <span className="cp__selo" title="Bebidas ou itens prontos: não passa pela cozinha"><GlassWater size={13} /> Sem preparo</span>}
      </div>
      <ul className="cp__itens">
        {mostrar.map((i) => <li key={i.id}><span>{i.qtd}x</span><span>{i.nome}</span></li>)}
        {resto > 0 && <li className="cp__mais">+ {resto} {resto === 1 ? 'item' : 'itens'}</li>}
        {p.pedido_itens.length === 0 && <li className="cp__mais">Carregando itens…</li>}
      </ul>
      {(p.observacao || p.pedido_itens.some((i) => i.obs)) && <div className="cp__obs">Tem observação</div>}
      <div className="cp__total">{brl(p.total)}</div>
      {p.status === 'preparando' && <div className="cp__info">Em preparo há {tempoDesde(p.atualizado_em, agora)}</div>}

      <footer className="cp__acoes">
        {p.status === 'novo' && (
          <button className="icone-quadro" onClick={(e) => { e.stopPropagation(); aoImprimir(); }} title="Imprimir" aria-label="Imprimir pedido"><Printer size={18} /></button>
        )}
        {acao && (
          <button className={cx('btn btn--sm', acao.classe)} onClick={(e) => { e.stopPropagation(); aoMudar(acao.proximo); }}>
            {acao.icone} {acao.rotulo}
          </button>
        )}
        {p.status === 'entregue' && <span className="cp__info" style={{ flex: 1 }}>Entregue há {tempoDesde(p.atualizado_em, agora)}</span>}
        <MenuPedido p={p} aoVer={aoSelecionar} aoImprimir={aoImprimir} aoMudar={aoMudar} />
      </footer>
    </article>
  );
}

/* ---------------- Visualização em lista ---------------- */
function ListaPedidos({ pedidos, agora, selId, aoSelecionar, aoMudar, finalizados }: {
  pedidos: Pedido[];
  agora: number;
  selId: string | null;
  aoSelecionar: (id: string | null) => void;
  aoMudar: (p: Pedido, s: StatusPedido) => void;
  finalizados: boolean;
}) {
  if (!pedidos.length) {
    return (
      <div className="pedidos__lista">
        <Vazio icone={<ClipboardList size={32} />} titulo={finalizados ? 'Nenhum pedido finalizado ainda' : 'Nenhum pedido aqui'} />
      </div>
    );
  }
  return (
    <div className="pedidos__lista tabela-wrap">
      <table className="tabela">
        <thead>
          <tr><th>Pedido</th><th>Mesa</th><th>Itens</th><th>Tempo</th><th>Status</th><th className="num">Total</th><th /></tr>
        </thead>
        <tbody>
          {pedidos.map((p) => {
            const acao = acaoPrincipal(p);
            return (
              <tr key={p.id} className={cx('linha-clicavel', p.id === selId && 'linha-selecionada')} onClick={() => aoSelecionar(p.id === selId ? null : p.id)}>
                <td><b>#{p.numero}</b></td>
                <td>{p.mesa_nome}</td>
                <td className="muted lista-itens">{p.pedido_itens.map((i) => `${i.qtd}x ${i.nome}`).join(', ')}</td>
                <td><TempoPedido p={p} agora={agora} /></td>
                <td><span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span></td>
                <td className="num"><b>{brl(p.total)}</b></td>
                <td className="num">
                  {acao && (
                    <button className={cx('btn btn--sm', acao.classe)} onClick={(e) => { e.stopPropagation(); aoMudar(p, acao.proximo); }}>
                      {acao.longo}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Painel lateral de detalhes ---------------- */
function PainelDetalhes({ pedido: p, fotos, agora, aoFechar, aoMudar, aoImprimir }: {
  pedido: Pedido;
  fotos: Map<string, FotoInfo>;
  agora: number;
  aoFechar: () => void;
  aoMudar: (s: StatusPedido) => void;
  aoImprimir: () => void;
}) {
  const [aba, setAba] = useState<'detalhes' | 'historico'>('detalhes');
  useEffect(() => { setAba('detalhes'); }, [p.id]);
  const acao = acaoPrincipal(p);
  const subtotal = p.pedido_itens.reduce((s, i) => s + i.qtd * Number(i.preco_unit), 0);
  const qtdItens = p.pedido_itens.reduce((s, i) => s + i.qtd, 0);

  const historico: { titulo: string; detalhe: string; quando: string; feito: boolean }[] = [
    { titulo: 'Pedido recebido', detalhe: `Pelo tablet da ${p.mesa_nome}`, quando: p.criado_em, feito: true },
  ];
  if (p.impresso_em) historico.push({ titulo: 'Impresso na cozinha', detalhe: 'Impressão automática do caixa', quando: p.impresso_em, feito: true });
  if (p.status !== 'novo') {
    historico.push({
      titulo: p.status === 'cancelado' ? 'Pedido cancelado' : `Status: ${STATUS_ROTULO[p.status]}`,
      detalhe: p.precisa_preparo === false && p.status !== 'cancelado'
        ? 'Sem preparo: aceito direto para servir'
        : 'Última atualização do pedido',
      quando: p.atualizado_em,
      feito: p.status !== 'cancelado',
    });
  }
  if (p.pago_em) historico.push({ titulo: 'Conta fechada', detalhe: 'Pagamento registrado no caixa', quando: p.pago_em, feito: true });

  return (
    <aside className="dp" aria-label={`Detalhes do pedido ${p.numero}`}>
      <header className="dp__topo">
        <h2>Pedido #{p.numero}</h2>
        <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
        <button className="icone-btn" onClick={aoFechar} aria-label="Fechar detalhes"><X size={20} /></button>
      </header>

      <nav className="dp__abas" role="tablist">
        <button role="tab" aria-selected={aba === 'detalhes'} className={cx(aba === 'detalhes' && 'ativo')} onClick={() => setAba('detalhes')}>Detalhes</button>
        <button role="tab" aria-selected={aba === 'historico'} className={cx(aba === 'historico' && 'ativo')} onClick={() => setAba('historico')}>Histórico</button>
      </nav>

      <div className="dp__corpo">
        {aba === 'detalhes' ? (
          <>
            <section>
              <h3 className="dp__titulo">Itens do pedido</h3>
              <div className="dp__itens">
                {p.pedido_itens.map((i) => {
                  const f = (i.produto_id && fotos.get(i.produto_id)) || { imagem_url: null, emoji: null };
                  return (
                    <div key={i.id} className="dp__item">
                      <FotoProduto p={{ imagem_url: f.imagem_url, emoji: f.emoji, nome: i.nome }} />
                      <div>
                        <strong>{i.nome}</strong>
                        <small>{i.qtd}x · {brl(i.preco_unit)}</small>
                        {i.obs && <em>» {i.obs}</em>}
                      </div>
                      <b>{brl(i.qtd * Number(i.preco_unit))}</b>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="dp__totais">
              <div><span>Subtotal ({qtdItens} {qtdItens === 1 ? 'item' : 'itens'})</span><span>{brl(subtotal)}</span></div>
              <div className="dp__total"><span>Total</span><span>{brl(p.total)}</span></div>
            </section>

            <section className="dp__linha">
              <span>Tipo de pedido</span>
              <span className="dp__chip"><UtensilsCrossed size={15} /> Mesa · {p.mesa_nome}</span>
            </section>
            <section className="dp__linha">
              <span>Preparo</span>
              {p.precisa_preparo === false
                ? <span className="dp__chip"><GlassWater size={15} /> Sem preparo</span>
                : <span className="dp__chip"><ChefHat size={15} /> Cozinha</span>}
            </section>
            <section className="dp__linha">
              <span>Conta</span>
              {p.pago_em
                ? <span className="badge badge--verde">Paga às {hora(p.pago_em)}</span>
                : <span className="badge badge--amarelo">Em aberto</span>}
            </section>
            <section className="dp__linha">
              <span>Feito às</span>
              <span>{hora(p.criado_em)} · há {tempoDesde(p.criado_em, agora)}</span>
            </section>

            <section>
              <h3 className="dp__titulo">Observações</h3>
              <div className={cx('dp__obs', !p.observacao && 'vazia')}>{p.observacao || 'Sem observações'}</div>
            </section>
          </>
        ) : (
          <ol className="dp__historico">
            {historico.map((h, n) => (
              <li key={n} className={cx(h.feito && 'feito')}>
                <strong>{h.titulo}</strong>
                <small>{h.detalhe} · {new Date(h.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small>
              </li>
            ))}
          </ol>
        )}
      </div>

      <footer className="dp__acoes">
        <button className="icone-quadro icone-quadro--lg" onClick={aoImprimir} title="Imprimir" aria-label="Imprimir pedido"><Printer size={19} /></button>
        <MenuPedido p={p} aoImprimir={aoImprimir} aoMudar={aoMudar} />
        {acao ? (
          <button className={cx('btn', acao.classe)} onClick={() => aoMudar(acao.proximo)}>{acao.icone} {acao.longo}</button>
        ) : (
          <span className="dp__final">{p.status === 'entregue' ? 'Pedido entregue' : 'Pedido cancelado'}</span>
        )}
      </footer>
    </aside>
  );
}

/* ---------------- Novo pedido (lançado pela equipe) ---------------- */
function ModalNovoPedido({ restauranteId, aoFechar }: { restauranteId: string; aoFechar: () => void }) {
  const [mesas, setMesas] = useState<Mesa[] | null>(null);
  useEffect(() => {
    void supabase.from('mesas').select('*').eq('restaurante_id', restauranteId).eq('ativo', true)
      .then(({ data }) => setMesas(((data ?? []) as Mesa[]).sort(ordenarNome)));
  }, [restauranteId]);

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Novo pedido" largura={560}>
      <p className="muted" style={{ marginTop: 0 }}>
        Escolha a mesa. O cardápio dela abre numa nova janela para você lançar o pedido; ele chega aqui como qualquer pedido do tablet.
      </p>
      {!mesas ? <Carregando /> : mesas.length === 0 ? (
        <Vazio titulo="Nenhuma mesa ativa">Cadastre as mesas em Mesas.</Vazio>
      ) : (
        <div className="novo-pedido__mesas">
          {mesas.map((m) => (
            <a key={m.id} className="novo-pedido__mesa" href={`/mesa/${m.token}`} target="_blank" rel="noopener" onClick={aoFechar}>
              <UtensilsCrossed size={18} /> {m.nome} <ExternalLink size={14} />
            </a>
          ))}
        </div>
      )}
    </Modal>
  );
}
