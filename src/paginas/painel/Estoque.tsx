import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { Boxes, CircleDollarSign, Minus, Package, Plus, TrendingUp } from 'lucide-react';
import { Campo, Switch, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { msgErro, supabase } from '../../lib/supabase';
import type { MovimentoEstoque, Produto } from '../../lib/tipos';
import { brl, cx, dataHora, ehGestor, lerPreco, mascaraPreco, ordenarNome, precoParaTexto } from '../../lib/util';
import { usePainel } from './Painel';

function situacao(p: Produto) {
  if (p.estoque <= 0) return { rotulo: 'Esgotado', classe: 'badge--vermelho' };
  if (p.estoque <= p.estoque_minimo) return { rotulo: 'Baixo', classe: 'badge--amarelo' };
  return { rotulo: 'OK', classe: 'badge--verde' };
}

export default function Estoque() {
  const { restaurante, papel, pedidos } = usePainel();
  const toast = useToast();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movs, setMovs] = useState<MovimentoEstoque[]>([]);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [ajustando, setAjustando] = useState<{ p: Produto; tipo: 'entrada' | 'saida' } | null>(null);
  const gestor = ehGestor(papel);
  const [aba, setAba] = useState<'quantidades' | 'custos'>('quantidades');

  const carregar = useCallback(async () => {
    const [p, m] = await Promise.all([
      supabase.from('produtos').select('*').eq('restaurante_id', restaurante.id),
      supabase.from('movimentos_estoque').select('*, produto:produtos(nome)')
        .eq('restaurante_id', restaurante.id).order('criado_em', { ascending: false }).limit(40),
    ]);
    if (p.error) toast(msgErro(p.error), 'erro');
    setProdutos(((p.data ?? []) as Produto[]).sort(ordenarNome));
    setMovs((m.data ?? []) as MovimentoEstoque[]);
  }, [restaurante.id, toast]);

  // Pedidos novos baixam estoque: recarrega junto com o tempo real
  useEffect(() => { void carregar(); }, [carregar, pedidos.length]);

  async function alternarControle(p: Produto, v: boolean) {
    const { error } = await supabase.from('produtos').update({ controla_estoque: v }).eq('id', p.id);
    if (error) return toast(msgErro(error), 'erro');
    void carregar();
  }

  const controlados = produtos.filter((p) => p.controla_estoque);
  const lista = mostrarTodos ? produtos : controlados;
  const baixos = controlados.filter((p) => p.estoque > 0 && p.estoque <= p.estoque_minimo).length;
  const esgotados = controlados.filter((p) => p.estoque <= 0).length;

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Estoque</h1>
          <p>Cada pedido dá baixa automática. Zerou, o item aparece como “Esgotado” no tablet.</p>
        </div>
        {gestor && aba === 'quantidades' && <Switch marcado={mostrarTodos} aoMudar={setMostrarTodos}>Mostrar todos os produtos</Switch>}
      </div>

      {gestor && (
        <nav className="rl-abas estoque-abas" role="tablist">
          <button role="tab" aria-selected={aba === 'quantidades'} className={cx(aba === 'quantidades' && 'ativo')} onClick={() => setAba('quantidades')}><Boxes size={16} /> Quantidades</button>
          <button role="tab" aria-selected={aba === 'custos'} className={cx(aba === 'custos' && 'ativo')} onClick={() => setAba('custos')}><CircleDollarSign size={16} /> Custos e lucro</button>
        </nav>
      )}

      {aba === 'custos' && gestor ? (
        <CustosProdutos produtos={produtos} aoMudar={(id, custo) => setProdutos((l) => l.map((x) => (x.id === id ? { ...x, custo } : x)))} />
      ) : (
      <>

      <div className="kpis">
        <div className="kpi"><span>Produtos controlados</span><strong>{controlados.length}</strong></div>
        <div className={cx('kpi', baixos > 0 && 'kpi--alerta')}><span>Estoque baixo</span><strong>{baixos}</strong></div>
        <div className={cx('kpi', esgotados > 0 && 'kpi--perigo')}><span>Esgotados</span><strong>{esgotados}</strong></div>
      </div>

      {lista.length === 0 ? (
        <Vazio icone={<Package size={36} />} titulo="Nenhum produto com controle de estoque">
          {gestor ? 'Ligue “Mostrar todos os produtos” e ative o controle nos itens que quiser acompanhar.' : 'Peça ao gerente para ativar o controle de estoque nos produtos.'}
        </Vazio>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Produto</th>
                {mostrarTodos && <th>Controlar</th>}
                <th className="num">Estoque</th>
                <th className="num">Mínimo</th>
                <th>Situação</th>
                <th className="num">Movimentar</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => {
                const s = situacao(p);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.emoji} {p.nome}</strong></td>
                    {mostrarTodos && <td><Switch marcado={p.controla_estoque} aoMudar={(v) => void alternarControle(p, v)} /></td>}
                    <td className="num estoque-qtd">{p.controla_estoque ? p.estoque : '—'}</td>
                    <td className="num">{p.controla_estoque ? p.estoque_minimo : '—'}</td>
                    <td>{p.controla_estoque ? <span className={`badge ${s.classe}`}>{s.rotulo}</span> : <span className="muted">Livre</span>}</td>
                    <td className="num">
                      {p.controla_estoque && (
                        <div className="acoes-linha" style={{ justifyContent: 'flex-end' }}>
                          <div className="mov-par">
                            <button className="mov-par__saida" onClick={() => setAjustando({ p, tipo: 'saida' })} aria-label={`Saída de ${p.nome}`} title="Saída (perda, uso)"><Minus size={16} /></button>
                            <button className="mov-par__entrada" onClick={() => setAjustando({ p, tipo: 'entrada' })}><Plus size={16} /> Entrada</button>
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="card">
        <h2 className="card__titulo">Últimas movimentações</h2>
        {movs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="historico">
            {movs.map((m) => (
              <li key={m.id}>
                <span className={cx('delta', m.delta > 0 ? 'mais' : 'menos')}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                <div>
                  <strong>{m.produto?.nome ?? 'Produto removido'}</strong>
                  <small>{m.motivo}</small>
                </div>
                <small className="muted">{dataHora(m.criado_em)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      </>
      )}

      {ajustando && (
        <ModalAjuste
          produto={ajustando.p}
          tipoInicial={ajustando.tipo}
          aoFechar={() => setAjustando(null)}
          aoSalvar={() => { setAjustando(null); void carregar(); }}
        />
      )}
    </div>
  );
}

function ModalAjuste({ produto, tipoInicial, aoFechar, aoSalvar }: {
  produto: Produto;
  tipoInicial: 'entrada' | 'saida';
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [tipo, setTipo] = useState(tipoInicial);
  const [qtd, setQtd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const n = Math.floor(Number(qtd) || 0);

  async function salvar() {
    setSalvando(true);
    const { data, error } = await supabase.rpc('estoque_ajustar', {
      p_produto: produto.id,
      p_delta: tipo === 'entrada' ? n : -n,
      p_motivo: motivo || (tipo === 'entrada' ? 'Entrada' : 'Saída'),
    });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${produto.nome}: estoque agora é ${data}.`, 'ok');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={`${produto.emoji ?? ''} ${produto.nome}`}
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className={cx('btn', tipo === 'entrada' ? 'btn--sucesso' : 'btn--primario')} disabled={n < 1 || salvando} onClick={() => void salvar()}>
            {tipo === 'entrada' ? `Adicionar ${n || ''}` : `Retirar ${n || ''}`}
          </button>
        </>
      }
    >
      <div className="form">
        <p className="muted" style={{ margin: 0 }}>Estoque atual: <b>{produto.estoque}</b></p>
        <div className="segmentado">
          <button className={cx(tipo === 'entrada' && 'ativo')} onClick={() => setTipo('entrada')}>Entrada (compra)</button>
          <button className={cx(tipo === 'saida' && 'ativo')} onClick={() => setTipo('saida')}>Saída (perda, uso)</button>
        </div>
        <Campo rotulo="Quantidade">
          <input className="input" type="number" min={1} value={qtd} onChange={(e) => setQtd(e.target.value)} autoFocus />
        </Campo>
        <Campo rotulo="Motivo (opcional)">
          <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={80} placeholder={tipo === 'entrada' ? 'Ex.: compra do fornecedor' : 'Ex.: quebra, validade'} />
        </Campo>
      </div>
    </Modal>
  );
}

/* ---------------- Custos: quanto cada produto custa e quanto sobra ---------------- */
function CustosProdutos({ produtos, aoMudar }: { produtos: Produto[]; aoMudar: (id: string, custo: number | null) => void }) {
  const comCusto = produtos.filter((p) => p.custo != null);
  const margens = comCusto.filter((p) => Number(p.preco) > 0).map((p) => (Number(p.preco) - Number(p.custo)) / Number(p.preco));
  const margemMedia = margens.length ? margens.reduce((s, m) => s + m, 0) / margens.length : null;
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Com custo cadastrado</span><strong>{comCusto.length} <small className="muted">de {produtos.length}</small></strong></div>
        <div className={cx('kpi', produtos.length - comCusto.length > 0 && 'kpi--alerta')}><span>Sem custo</span><strong>{produtos.length - comCusto.length}</strong></div>
        <div className="kpi"><span>Margem média</span><strong>{margemMedia == null ? '—' : `${Math.round(margemMedia * 100)}%`}</strong></div>
      </div>
      <p className="custos-dica"><TrendingUp size={16} /> Coloque quanto cada produto custa para você (ingredientes, embalagem, compra). O lucro aparece nos Relatórios e no app do dono. Vendas antigas usam o custo de quando foram feitas.</p>
      <div className="tabela-wrap">
        <table className="tabela custos-tabela">
          <thead><tr><th>Produto</th><th className="num">Preço de venda</th><th className="num">Custo</th><th className="num">Lucro por unidade</th><th className="num">Margem</th></tr></thead>
          <tbody>{produtos.map((p) => <LinhaCusto key={p.id} p={p} aoMudar={aoMudar} />)}</tbody>
        </table>
      </div>
    </>
  );
}

function LinhaCusto({ p, aoMudar }: { p: Produto; aoMudar: (id: string, custo: number | null) => void }) {
  const toast = useToast();
  const [texto, setTexto] = useState(p.custo != null ? precoParaTexto(Number(p.custo)) : '');
  const [estado, setEstado] = useState<'' | 'salvando' | 'salvo'>('');
  const preco = Number(p.preco);
  const custo = texto.trim() ? lerPreco(texto) : null;
  const lucro = custo != null && Number.isFinite(custo) ? preco - custo : null;
  const margem = lucro != null && preco > 0 ? lucro / preco : null;

  async function salvar() {
    const novo = custo != null && Number.isFinite(custo) ? custo : null;
    if (novo === (p.custo == null ? null : Number(p.custo))) return;
    setEstado('salvando');
    const { error } = await supabase.from('produtos').update({ custo: novo }).eq('id', p.id);
    if (error) { setEstado(''); return toast(msgErro(error), 'erro'); }
    aoMudar(p.id, novo);
    setEstado('salvo');
    setTimeout(() => setEstado(''), 1500);
  }

  return (
    <tr>
      <td><strong>{p.emoji} {p.nome}</strong></td>
      <td className="num">{brl(preco)}</td>
      <td className="num">
        <span className={cx('custo-campo', estado === 'salvo' && 'salvo')}>
          <span>R$</span>
          <input
            inputMode="decimal" value={texto} placeholder="0,00" aria-label={`Custo de ${p.nome}`}
            onChange={(e) => setTexto(mascaraPreco(e.target.value))}
            onBlur={() => void salvar()}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </span>
      </td>
      <td className={cx('num', lucro != null && lucro < 0 && 'texto-perigo')}>{lucro == null ? <span className="muted">—</span> : <b>{brl(lucro)}</b>}</td>
      <td className="num">{margem == null ? <span className="muted">—</span> : <span className={cx('badge', margem < 0 ? 'badge--vermelho' : margem < 0.3 ? 'badge--amarelo' : 'badge--verde')}>{Math.round(margem * 100)}%</span>}</td>
    </tr>
  );
}
