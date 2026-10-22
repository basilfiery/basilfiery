import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, Bike, Copy, Eye, Layers, ListChecks, MousePointerClick, Pencil, Plus, Rocket, Search, ShoppingBag, Sparkles, Tag, Trash2,
  TrendingUp, UtensilsCrossed, Wand2, X,
} from 'lucide-react';
import { Campo, FotoProduto, Switch } from '../../componentes/Basicos';
import { confirmar } from '../../componentes/Confirmar';
import { Modal } from '../../componentes/Modal';
import { CorpoOrderBump } from '../../componentes/OrderBump';
import { useToast } from '../../componentes/Toast';
import {
  escolherBump, gatilhoCasa, lerPalavras, precoComDesconto, rotuloDesconto, textoDoItem,
  type BumpCardapio, type CanalBump, type DescontoBump, type GatilhoBump,
} from '../../lib/orderBump';
import { msgErro, supabase } from '../../lib/supabase';
import type { Categoria, Produto } from '../../lib/tipos';
import { brl, cx, inicioDoDia, lerPreco, mascaraPreco } from '../../lib/util';
import type { CategoriaMesa, ProdutoMesa } from '../mesa/Mesa';
import { usePainel } from './Painel';
import '../../estilos/alavancar.css';

/* =====================================================================
   Alavancar vendas › Order bump: a oferta que aparece no cardápio logo
   depois que o cliente escolhe um item ("Que tal uma bebida gelada?").
   ===================================================================== */

interface OrderBump {
  id: string;
  restaurante_id: string;
  nome: string;
  titulo: string;
  subtitulo: string | null;
  ativo: boolean;
  prioridade: number;
  gatilho: GatilhoBump;
  gatilho_categorias: string[];
  gatilho_produtos: string[];
  gatilho_palavras: string[];
  ofertas_modo: 'manual' | 'automatico';
  ofertas: string[];
  max_ofertas: number;
  desconto_tipo: DescontoBump;
  desconto_valor: number;
  canais: CanalBump[];
}
interface Resultado { exibicoes: number; pedidos: number; itens: number; receita: number }

type Periodo = '7d' | '30d' | 'mes';
const PERIODOS: { id: Periodo; rotulo: string }[] = [{ id: '7d', rotulo: '7 dias' }, { id: '30d', rotulo: '30 dias' }, { id: 'mes', rotulo: 'Este mês' }];
function inicioPeriodo(p: Periodo) {
  const hoje = new Date(inicioDoDia());
  if (p === 'mes') return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return new Date(hoje.getTime() - (p === '7d' ? 6 : 29) * 86400000);
}

const GATILHOS: { id: GatilhoBump; titulo: string; texto: string; icone: ReactNode }[] = [
  { id: 'automatico', titulo: 'Automático', texto: 'O sistema decide em quais itens a oferta combina', icone: <Wand2 size={18} /> },
  { id: 'categorias', titulo: 'Categorias', texto: 'Em todos os itens das categorias que você escolher', icone: <Layers size={18} /> },
  { id: 'produtos', titulo: 'Itens específicos', texto: 'Só nos itens que você marcar', icone: <ListChecks size={18} /> },
  { id: 'palavras', titulo: 'Palavras-chave', texto: 'Itens com essas palavras no nome, descrição ou categoria', icone: <Tag size={18} /> },
  { id: 'todos', titulo: 'Todos os itens', texto: 'Aparece em qualquer item do cardápio', icone: <UtensilsCrossed size={18} /> },
];

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');

/** Produto do painel no formato do cardápio (preço da subcategoria somado). */
function comoCardapio(p: Produto, cats: Map<string, Categoria>): ProdutoMesa {
  const c = p.categoria_id ? cats.get(p.categoria_id) : undefined;
  const comTamanho = c?.preco_grupo != null;
  const preco = (comTamanho ? Number(c!.preco_grupo) : 0) + Number(p.preco);
  return {
    id: p.id, categoria_id: p.categoria_id ?? '', nome: p.nome, descricao: p.descricao ?? '', preco, preco_de: null,
    emoji: p.emoji, imagem_url: p.imagem_url, video_url: p.video_url, capa: p.capa, vegetariano: p.vegetariano, picancia: p.picancia,
    destaque: p.destaque, novo: p.novo, disponivel: !p.esgotado && !c?.esgotado && preco > 0, estoque_max: null,
    prefixo: comTamanho ? c!.nome : undefined,
  };
}

const paraCardapio = (b: Pick<OrderBump, 'id' | 'titulo' | 'subtitulo' | 'gatilho' | 'gatilho_categorias' | 'gatilho_produtos' | 'gatilho_palavras' | 'ofertas_modo' | 'ofertas' | 'max_ofertas' | 'desconto_tipo' | 'desconto_valor' | 'canais'>): BumpCardapio => ({
  id: b.id, titulo: b.titulo || 'Que tal levar junto?', subtitulo: b.subtitulo, gatilho: b.gatilho, categorias: b.gatilho_categorias, produtos: b.gatilho_produtos,
  palavras: b.gatilho_palavras, ofertas_modo: b.ofertas_modo, ofertas: b.ofertas, max_ofertas: b.max_ofertas, desconto_tipo: b.desconto_tipo,
  desconto_valor: Number(b.desconto_valor), canais: b.canais,
});

export default function AlavancarVendas() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [bumps, setBumps] = useState<OrderBump[] | null>(null);
  const [cats, setCats] = useState<Categoria[]>([]);
  const [prods, setProds] = useState<Produto[]>([]);
  const [obrigatorios, setObrigatorios] = useState<Set<string>>(new Set());
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [resultado, setResultado] = useState<Record<string, Resultado>>({});
  const [editando, setEditando] = useState<Partial<OrderBump> | null>(null);

  const carregar = useCallback(async () => {
    const [b, c, p, pa, g] = await Promise.all([
      supabase.from('order_bumps').select('*').eq('restaurante_id', r.id).order('prioridade').order('criado_em'),
      supabase.from('categorias').select('*').eq('restaurante_id', r.id).eq('ativo', true).order('ordem'),
      supabase.from('produtos').select('*').eq('restaurante_id', r.id).eq('ativo', true).is('grupo_id', null).order('ordem'),
      supabase.from('produto_adicionais').select('produto_id, grupo_id').eq('restaurante_id', r.id),
      supabase.from('adicional_grupos').select('id, minimo').eq('restaurante_id', r.id),
    ]);
    if (b.error) toast(msgErro(b.error), 'erro');
    setBumps((b.data ?? []) as OrderBump[]);
    setCats((c.data ?? []) as Categoria[]);
    setProds(((p.data ?? []) as Produto[]).filter((x) => x.categoria_id));
    const comMinimo = new Set(((g.data ?? []) as { id: string; minimo: number }[]).filter((x) => x.minimo > 0).map((x) => x.id));
    setObrigatorios(new Set(((pa.data ?? []) as { produto_id: string; grupo_id: string }[]).filter((x) => comMinimo.has(x.grupo_id)).map((x) => x.produto_id)));
  }, [r.id, toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    let vivo = true;
    const fim = new Date(inicioDoDia() + 86400000);
    void supabase.rpc('bumps_resumo', { p_rest: r.id, p_inicio: inicioPeriodo(periodo).toISOString(), p_fim: fim.toISOString() })
      .then(({ data }) => { if (vivo && data) setResultado(data as Record<string, Resultado>); });
    return () => { vivo = false; };
  }, [r.id, periodo, bumps]);

  const mapaCats = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const itens = useMemo(() => prods.map((p) => comoCardapio(p, mapaCats)), [prods, mapaCats]);

  async function salvarAtivo(b: OrderBump, ativo: boolean) {
    setBumps((l) => l?.map((x) => (x.id === b.id ? { ...x, ativo } : x)) ?? l);
    const { error } = await supabase.from('order_bumps').update({ ativo, atualizado_em: new Date().toISOString() }).eq('id', b.id);
    if (error) { toast(msgErro(error), 'erro'); void carregar(); } else toast(ativo ? `"${b.nome}" ligado no cardápio.` : `"${b.nome}" pausado.`, 'ok');
  }
  async function mover(i: number, d: -1 | 1) {
    if (!bumps) return;
    const j = i + d;
    if (j < 0 || j >= bumps.length) return;
    const nova = [...bumps];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setBumps(nova.map((x, k) => ({ ...x, prioridade: k })));
    const res = await Promise.all(nova.map((x, k) => supabase.from('order_bumps').update({ prioridade: k }).eq('id', x.id)));
    if (res.some((x) => x.error)) { toast('Não deu para mudar a ordem.', 'erro'); void carregar(); }
  }
  async function duplicar(b: OrderBump) {
    const { id: _id, ...resto } = b;
    void _id;
    const { error } = await supabase.from('order_bumps').insert({ ...resto, nome: `${b.nome} (cópia)`.slice(0, 60), ativo: false, prioridade: (bumps?.length ?? 0) });
    if (error) return toast(msgErro(error), 'erro');
    toast('Cópia criada (pausada). Ajuste e ligue quando quiser.', 'ok');
    void carregar();
  }
  async function excluir(b: OrderBump) {
    if (!(await confirmar(`Excluir o order bump "${b.nome}"? Os resultados dele somem dos relatórios desta tela.`, { titulo: 'Excluir order bump', sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('order_bumps').delete().eq('id', b.id);
    if (error) return toast(msgErro(error), 'erro');
    toast('Order bump excluído.', 'ok');
    void carregar();
  }

  const total = Object.values(resultado).reduce((t, x) => ({
    exibicoes: t.exibicoes + Number(x.exibicoes), pedidos: t.pedidos + Number(x.pedidos), itens: t.itens + Number(x.itens), receita: t.receita + Number(x.receita),
  }), { exibicoes: 0, pedidos: 0, itens: 0, receita: 0 });
  const nomeProduto = (id: string) => itens.find((p) => p.id === id)?.nome;

  function onde(b: OrderBump) {
    switch (b.gatilho) {
      case 'automatico': return 'Automático: o sistema escolhe os itens';
      case 'todos': return 'Em todos os itens';
      case 'categorias': return `Categorias: ${b.gatilho_categorias.map((id) => mapaCats.get(id)?.nome).filter(Boolean).join(', ') || '—'}`;
      case 'produtos': return `${b.gatilho_produtos.length} ${b.gatilho_produtos.length === 1 ? 'item' : 'itens'}: ${b.gatilho_produtos.map(nomeProduto).filter(Boolean).slice(0, 3).join(', ')}${b.gatilho_produtos.length > 3 ? '…' : ''}`;
      case 'palavras': return `Palavras: ${b.gatilho_palavras.join(', ')}`;
    }
  }

  return (
    <div className="pagina ab">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Alavancar vendas</h1>
          <p>Order bump: ofereça o item certo na hora em que o cliente está escolhendo e aumente o valor de cada pedido.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setEditando({})}><Plus size={18} /> Criar order bump</button>
      </div>

      {/* ---------- Resultado ---------- */}
      <section className="card ab-resultado">
        <header className="ab-resultado__cab">
          <div><h2>Resultado das ofertas</h2><small>Vendas que vieram do order bump (mesa e delivery)</small></div>
          <div className="rl-seg" role="tablist" aria-label="Período">
            {PERIODOS.map((p) => (
              <button key={p.id} role="tab" aria-selected={periodo === p.id} className={cx(periodo === p.id && 'ativo')} onClick={() => setPeriodo(p.id)}>{p.rotulo}</button>
            ))}
          </div>
        </header>
        <div className="ab-numeros">
          <Numero icone={<TrendingUp size={18} />} valor={brl(total.receita)} rotulo="Receita extra" dica="Somente os itens aceitos na oferta" destaque />
          <Numero icone={<ShoppingBag size={18} />} valor={String(total.pedidos)} rotulo="Pedidos com oferta" dica={`${total.itens} ${total.itens === 1 ? 'item vendido' : 'itens vendidos'}`} />
          <Numero icone={<MousePointerClick size={18} />} valor={pct(total.pedidos, total.exibicoes)} rotulo="Conversão" dica="Pedidos ÷ vezes que a oferta apareceu" />
          <Numero icone={<Eye size={18} />} valor={total.exibicoes.toLocaleString('pt-BR')} rotulo="Exibições" dica="Vezes que a oferta apareceu" />
        </div>
      </section>

      {/* ---------- Lista ---------- */}
      {!bumps ? <div className="carregando"><div className="spinner" /></div> : bumps.length === 0 ? (
        <section className="card ab-vazio">
          <span className="ab-vazio__icone"><Rocket size={28} /></span>
          <h2>Crie seu primeiro order bump</h2>
          <p>Quando o cliente escolhe uma pizza, por exemplo, aparece “Que tal um refri gelado?” antes de ir para o carrinho. Um toque e o item entra no pedido.</p>
          <ol className="ab-passos">
            <li><b>1</b> Escolha onde a oferta aparece</li>
            <li><b>2</b> Escolha o que oferecer (ou deixe automático)</li>
            <li><b>3</b> Dê um desconto, se quiser, e ligue</li>
          </ol>
        </section>
      ) : (
        <div className="ab-lista">
          {bumps.map((b, i) => {
            const res = resultado[b.id];
            const selo = rotuloDesconto(b.desconto_tipo, Number(b.desconto_valor));
            const ofertas = b.ofertas_modo === 'automatico' ? [] : b.ofertas.map((id) => itens.find((p) => p.id === id)).filter((p): p is ProdutoMesa => !!p);
            return (
              <article key={b.id} className={cx('card ab-bump', !b.ativo && 'ab-bump--pausado')}>
                <div className="ab-bump__ordem">
                  <button className="icone-btn" onClick={() => void mover(i, -1)} disabled={i === 0} aria-label="Subir (mais prioridade)" title="Mais prioridade"><ArrowUp size={16} /></button>
                  <span>{i + 1}</span>
                  <button className="icone-btn" onClick={() => void mover(i, 1)} disabled={i === bumps.length - 1} aria-label="Descer" title="Menos prioridade"><ArrowDown size={16} /></button>
                </div>
                <div className="ab-bump__corpo">
                  <div className="ab-bump__topo">
                    <div className="ab-bump__nomes">
                      <strong>{b.nome}</strong>
                      <span>“{b.titulo}”</span>
                    </div>
                    <Switch marcado={b.ativo} aoMudar={(v) => void salvarAtivo(b, v)}>{b.ativo ? 'Ligado' : 'Pausado'}</Switch>
                  </div>
                  <div className="ab-bump__chips">
                    <span className="ab-chip"><Sparkles size={13} /> {onde(b)}</span>
                    {selo && <span className="ab-chip ab-chip--ok">{selo} na oferta</span>}
                    {b.canais.length < 2 && <span className="ab-chip">{b.canais[0] === 'mesa' ? <><UtensilsCrossed size={13} /> Só na mesa</> : <><Bike size={13} /> Só no delivery</>}</span>}
                  </div>
                  <div className="ab-bump__ofertas">
                    {b.ofertas_modo === 'automatico' ? (
                      <span className="ab-bump__auto"><Wand2 size={15} /> Ofertas automáticas: o que mais sai junto, até {b.max_ofertas}</span>
                    ) : ofertas.map((p) => (
                      <span key={p.id} className="ab-mini" title={p.nome}><FotoProduto p={p} classe="ab-mini__foto" /><em>{p.nome}</em></span>
                    ))}
                  </div>
                  <div className="ab-bump__rodape">
                    <div className="ab-bump__stats">
                      <span><b>{Number(res?.exibicoes ?? 0).toLocaleString('pt-BR')}</b> exibições</span>
                      <span><b>{Number(res?.pedidos ?? 0)}</b> pedidos</span>
                      <span><b>{pct(Number(res?.pedidos ?? 0), Number(res?.exibicoes ?? 0))}</b> conversão</span>
                      <span className="ab-bump__receita"><b>{brl(Number(res?.receita ?? 0))}</b> a mais</span>
                    </div>
                    <div className="acoes-linha">
                      <button className="btn btn--contorno btn--sm" onClick={() => setEditando(b)}><Pencil size={15} /> Editar</button>
                      <button className="icone-btn" onClick={() => void duplicar(b)} title="Duplicar" aria-label="Duplicar"><Copy size={16} /></button>
                      <button className="icone-btn icone-btn--perigo" onClick={() => void excluir(b)} title="Excluir" aria-label="Excluir"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ---------- Modelos prontos ---------- */}
      <section className="ab-modelos">
        <h2>Ideias prontas</h2>
        <div className="ab-modelos__grade">
          {modelos(itens, cats).map((m) => (
            <button key={m.chave} type="button" className="ab-modelo" onClick={() => setEditando(m.bump)}>
              <span className="ab-modelo__icone">{m.icone}</span>
              <b>{m.titulo}</b>
              <small>{m.texto}</small>
              <span className="ab-modelo__usar">Usar modelo <Plus size={14} /></span>
            </button>
          ))}
        </div>
      </section>

      {editando && (
        <EditorBump
          inicial={editando}
          restauranteId={r.id}
          proxima={bumps?.length ?? 0}
          cats={cats}
          itens={itens}
          obrigatorios={obrigatorios}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => { setEditando(null); void carregar(); }}
        />
      )}
    </div>
  );
}

function Numero({ icone, valor, rotulo, dica, destaque }: { icone: ReactNode; valor: string; rotulo: string; dica: string; destaque?: boolean }) {
  return (
    <div className={cx('ab-numero', destaque && 'ab-numero--destaque')}>
      <span className="ab-numero__icone">{icone}</span>
      <div><strong>{valor}</strong><span>{rotulo}</span><small>{dica}</small></div>
    </div>
  );
}

/** Modelos para começar rápido (já com os itens da loja que combinam). */
function modelos(itens: ProdutoMesa[], cats: Categoria[]) {
  const daCategoria = (re: RegExp) => {
    const ids = new Set(cats.filter((c) => re.test(c.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())).map((c) => c.id));
    return itens.filter((p) => p.disponivel && (ids.has(p.categoria_id) || ids.has(cats.find((c) => c.id === p.categoria_id)?.pai_id ?? ''))).slice(0, 3).map((p) => p.id);
  };
  const bebidas = daCategoria(/bebida|refri|suco|drink|cerveja/);
  const doces = daCategoria(/sobremesa|doce|sorvete/);
  const base = { ativo: true, canais: ['mesa', 'delivery'] as CanalBump[], max_ofertas: 3, desconto_tipo: 'nenhum' as DescontoBump, desconto_valor: 0, gatilho_categorias: [], gatilho_produtos: [], gatilho_palavras: [], subtitulo: null };
  return [
    {
      chave: 'auto', icone: <Wand2 size={20} />, titulo: 'Deixe o sistema vender', texto: 'Automático: oferece o que mais sai junto com cada item.',
      bump: { ...base, nome: 'Automático', titulo: 'Combina com o seu pedido ✨', subtitulo: 'Os clientes costumam pedir junto', gatilho: 'automatico' as GatilhoBump, ofertas_modo: 'automatico' as const, ofertas: [] },
    },
    {
      chave: 'bebida', icone: <Sparkles size={20} />, titulo: 'Bebida para acompanhar', texto: 'Em todo prato, oferece uma bebida gelada.',
      bump: { ...base, nome: 'Bebida para acompanhar', titulo: 'Que tal uma bebida gelada? 🥤', gatilho: 'automatico' as GatilhoBump, ofertas_modo: bebidas.length ? 'manual' as const : 'automatico' as const, ofertas: bebidas },
    },
    {
      chave: 'doce', icone: <Tag size={20} />, titulo: 'Sobremesa com desconto', texto: '10% de desconto para fechar o pedido com um doce.',
      bump: { ...base, nome: 'Sobremesa com desconto', titulo: 'Feche com chave de ouro 🍰', subtitulo: 'Sobremesa com 10% de desconto só agora', gatilho: 'automatico' as GatilhoBump, ofertas_modo: doces.length ? 'manual' as const : 'automatico' as const, ofertas: doces, desconto_tipo: 'percentual' as DescontoBump, desconto_valor: 10 },
    },
    {
      chave: 'pizza', icone: <Layers size={20} />, titulo: 'Turbine a pizza', texto: 'Só em itens com "pizza": refri, borda ou porção.',
      bump: { ...base, nome: 'Turbine a pizza', titulo: 'Pizza pede um acompanhamento 🍕', gatilho: 'palavras' as GatilhoBump, gatilho_palavras: ['pizza'], ofertas_modo: 'automatico' as const, ofertas: [] },
    },
  ];
}

/* ---------------- Criar / editar ---------------- */
function EditorBump({ inicial, restauranteId, proxima, cats, itens, obrigatorios, aoFechar, aoSalvar }: {
  inicial: Partial<OrderBump>;
  restauranteId: string;
  proxima: number;
  cats: Categoria[];
  itens: ProdutoMesa[];
  obrigatorios: Set<string>;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    nome: inicial.nome ?? '',
    titulo: inicial.titulo ?? 'Que tal levar junto?',
    subtitulo: inicial.subtitulo ?? '',
    ativo: inicial.ativo ?? true,
    gatilho: inicial.gatilho ?? 'automatico' as GatilhoBump,
    categorias: inicial.gatilho_categorias ?? [],
    produtos: inicial.gatilho_produtos ?? [],
    palavras: (inicial.gatilho_palavras ?? []).join(', '),
    ofertas_modo: inicial.ofertas_modo ?? 'manual' as 'manual' | 'automatico',
    ofertas: inicial.ofertas ?? [],
    max_ofertas: inicial.max_ofertas ?? 3,
    desconto_tipo: inicial.desconto_tipo ?? 'nenhum' as DescontoBump,
    desconto: inicial.desconto_valor ? (inicial.desconto_tipo === 'valor' ? mascaraPreco(String(Math.round(Number(inicial.desconto_valor) * 100))) : String(inicial.desconto_valor)) : '',
    canais: inicial.canais ?? ['mesa', 'delivery'] as CanalBump[],
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const alternar = (k: 'categorias' | 'produtos' | 'ofertas', id: string, max = 99) => setF((x) => {
    const l = x[k];
    if (l.includes(id)) return { ...x, [k]: l.filter((y) => y !== id) };
    if (l.length >= max) return x;
    return { ...x, [k]: [...l, id] };
  });

  const mapaCats = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const catsMesa: CategoriaMesa[] = useMemo(() => cats.map((c) => ({ id: c.id, nome: c.nome, emoji: c.emoji, pai_id: c.pai_id, grupo_id: c.grupo_id, preco_grupo: c.preco_grupo, esgotado: c.esgotado })), [cats]);
  const palavras = lerPalavras(f.palavras);
  const valorDesconto = f.desconto_tipo === 'valor' ? (lerPreco(f.desconto) || 0) : Number(String(f.desconto).replace(',', '.')) || 0;

  const rascunho: BumpCardapio = paraCardapio({
    id: inicial.id ?? 'previa', titulo: f.titulo, subtitulo: f.subtitulo.trim() || null, gatilho: f.gatilho, gatilho_categorias: f.categorias,
    gatilho_produtos: f.produtos, gatilho_palavras: palavras, ofertas_modo: f.ofertas_modo, ofertas: f.ofertas, max_ofertas: f.max_ofertas,
    desconto_tipo: f.desconto_tipo, desconto_valor: valorDesconto, canais: f.canais,
  });
  const produtoGrupos = useMemo(() => Object.fromEntries([...obrigatorios].map((id) => [id, ['obrigatorio']])), [obrigatorios]);
  const ofertaDe = (p: ProdutoMesa) => escolherBump({
    produto: p, bumps: [{ ...rascunho, canais: [] }], produtos: itens, categorias: catsMesa,
    grupos: [{ id: 'obrigatorio', nome: '', minimo: 1, maximo: 1, calculo: 'soma', opcoes: [] }], produtoGrupos, canal: 'mesa', carrinho: [],
  });
  // Em quais itens a oferta aparece (e um deles para a prévia)
  const ondeAparece = itens.filter((p) => p.disponivel && gatilhoCasa(rascunho, p, new Map(catsMesa.map((c) => [c.id, c]))) && ofertaDe(p));
  const exemplo = ondeAparece[0];
  const previa = exemplo ? ofertaDe(exemplo) : null;

  const [buscaGat, setBuscaGat] = useState('');
  const [buscaOf, setBuscaOf] = useState('');
  const filtrar = (t: string) => {
    const q = t.trim().toLowerCase();
    return q ? itens.filter((p) => textoDoItem(p, new Map(catsMesa.map((c) => [c.id, c]))).includes(q.normalize('NFD').replace(/[̀-ͯ]/g, ''))) : itens;
  };
  const nomeCat = (id: string) => {
    const c = mapaCats.get(id);
    const pai = c?.pai_id ? mapaCats.get(c.pai_id) : undefined;
    return pai ? `${pai.nome} › ${c?.nome}` : c?.nome ?? '';
  };
  const motivoNaoOferece = (p: ProdutoMesa) => obrigatorios.has(p.id) ? 'Tem escolha obrigatória' : Number(p.preco) <= 0 ? 'Sem preço' : !p.disponivel ? 'Esgotado agora' : '';

  async function salvar() {
    setErro('');
    if (!f.titulo.trim()) return setErro('Escreva a frase da oferta.');
    if (f.gatilho === 'categorias' && !f.categorias.length) return setErro('Escolha pelo menos uma categoria.');
    if (f.gatilho === 'produtos' && !f.produtos.length) return setErro('Marque pelo menos um item onde a oferta aparece.');
    if (f.gatilho === 'palavras' && !palavras.length) return setErro('Escreva pelo menos uma palavra-chave.');
    if (f.ofertas_modo === 'manual' && !f.ofertas.length) return setErro('Escolha pelo menos um item para oferecer.');
    if (!f.canais.length) return setErro('Escolha onde vale: mesa, delivery ou os dois.');
    if (f.desconto_tipo === 'percentual' && (valorDesconto <= 0 || valorDesconto > 100)) return setErro('O desconto em % precisa ser de 1 a 100.');
    if (f.desconto_tipo === 'valor' && valorDesconto <= 0) return setErro('Informe o valor do desconto.');
    const linha = {
      restaurante_id: restauranteId,
      nome: (f.nome.trim() || f.titulo.trim()).slice(0, 60),
      titulo: f.titulo.trim().slice(0, 90),
      subtitulo: f.subtitulo.trim().slice(0, 160) || null,
      ativo: f.ativo,
      gatilho: f.gatilho,
      gatilho_categorias: f.gatilho === 'categorias' ? f.categorias : [],
      gatilho_produtos: f.gatilho === 'produtos' ? f.produtos : [],
      gatilho_palavras: f.gatilho === 'palavras' ? palavras : [],
      ofertas_modo: f.ofertas_modo,
      ofertas: f.ofertas_modo === 'manual' ? f.ofertas : [],
      max_ofertas: f.max_ofertas,
      desconto_tipo: f.desconto_tipo,
      desconto_valor: f.desconto_tipo === 'nenhum' ? 0 : valorDesconto,
      canais: f.canais,
      atualizado_em: new Date().toISOString(),
    };
    setSalvando(true);
    const { error } = inicial.id
      ? await supabase.from('order_bumps').update(linha).eq('id', inicial.id)
      : await supabase.from('order_bumps').insert({ ...linha, prioridade: proxima });
    setSalvando(false);
    if (error) return setErro(msgErro(error));
    toast(inicial.id ? 'Order bump salvo.' : f.ativo ? 'Order bump criado e já aparece no cardápio!' : 'Order bump criado (pausado).', 'ok');
    aoSalvar();
  }

  const exemploPreco = f.ofertas_modo === 'manual' && f.ofertas[0] ? itens.find((p) => p.id === f.ofertas[0]) : undefined;

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={inicial.id ? 'Editar order bump' : 'Novo order bump'}
      largura={1080}
      classe="ab-editor"
      rodape={
        <>
          {erro && <p className="erro-form ab-editor__erro">{erro}</p>}
          <Switch marcado={f.ativo} aoMudar={(v) => set('ativo', v)}>{f.ativo ? 'Ligado no cardápio' : 'Pausado'}</Switch>
          <button className="btn btn--fantasma" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : inicial.id ? 'Salvar' : 'Criar order bump'}</button>
        </>
      }
    >
      <div className="ab-editor__grade">
        <div className="ab-editor__form">
          {/* 1. Mensagem */}
          <section className="ab-sec">
            <h3><span>1</span> A oferta</h3>
            <Campo rotulo="Frase da oferta (o cliente vê)" dica="Curta e direta. Emojis ajudam: 🥤 🍰 🍟">
              <input className="input" value={f.titulo} maxLength={90} onChange={(e) => set('titulo', e.target.value)} placeholder="Que tal uma bebida gelada? 🥤" />
            </Campo>
            <div className="ab-sec__duas">
              <Campo rotulo="Texto de apoio (opcional)">
                <input className="input" value={f.subtitulo} maxLength={160} onChange={(e) => set('subtitulo', e.target.value)} placeholder="Ex.: Só hoje com 10% de desconto" />
              </Campo>
              <Campo rotulo="Nome interno" dica="Só você vê, para achar na lista">
                <input className="input" value={f.nome} maxLength={60} onChange={(e) => set('nome', e.target.value)} placeholder={f.titulo.slice(0, 40) || 'Ex.: Bebida com pizza'} />
              </Campo>
            </div>
          </section>

          {/* 2. Onde aparece */}
          <section className="ab-sec">
            <h3><span>2</span> Onde a oferta aparece</h3>
            <div className="ab-opcoes" role="radiogroup" aria-label="Onde a oferta aparece">
              {GATILHOS.map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={f.gatilho === g.id} className={cx('ab-opcao', f.gatilho === g.id && 'ativo')} onClick={() => set('gatilho', g.id)}>
                  <span className="ab-opcao__icone">{g.icone}</span>
                  <b>{g.titulo}</b>
                  <small>{g.texto}</small>
                </button>
              ))}
            </div>

            {f.gatilho === 'categorias' && (
              <div className="ab-chips" aria-label="Categorias">
                {cats.map((c) => (
                  <button key={c.id} type="button" className={cx('ab-chip-sel', f.categorias.includes(c.id) && 'ativo', c.pai_id && 'ab-chip-sel--sub')} onClick={() => alternar('categorias', c.id)}>
                    {f.categorias.includes(c.id) && <span aria-hidden="true">✓</span>}{nomeCat(c.id)}
                  </button>
                ))}
              </div>
            )}
            {f.gatilho === 'produtos' && (
              <ListaItens itens={filtrar(buscaGat)} busca={buscaGat} aoBuscar={setBuscaGat} marcados={f.produtos} aoMarcar={(id) => alternar('produtos', id)} nomeCat={(p) => nomeCat(p.categoria_id)} />
            )}
            {f.gatilho === 'palavras' && (
              <Campo rotulo="Palavras-chave, separadas por vírgula" dica="Procura no nome, na descrição e na categoria do item. Ex.: pizza, prato executivo, porção">
                <input className="input" value={f.palavras} onChange={(e) => set('palavras', e.target.value)} placeholder="pizza, prato executivo, porção" />
              </Campo>
            )}
            {f.gatilho === 'automatico' && (
              <p className="ab-nota"><Wand2 size={16} /> O sistema mostra a oferta nos itens em que ela combina e nunca oferece algo da mesma categoria do item escolhido (ex.: não oferece refri para quem está pedindo refri).</p>
            )}

            <div className="ab-alcance">
              <span><b>{ondeAparece.length}</b> {ondeAparece.length === 1 ? 'item mostra' : 'itens mostram'} esta oferta</span>
              {ondeAparece.length > 0 && <small>{ondeAparece.slice(0, 6).map((p) => p.nome).join(' · ')}{ondeAparece.length > 6 ? ` e mais ${ondeAparece.length - 6}` : ''}</small>}
            </div>

            <div className="ab-canais">
              <span>Vale no</span>
              {(['mesa', 'delivery'] as CanalBump[]).map((c) => (
                <button key={c} type="button" className={cx('ab-chip-sel', f.canais.includes(c) && 'ativo')}
                  onClick={() => set('canais', f.canais.includes(c) ? f.canais.filter((x) => x !== c) : [...f.canais, c])}>
                  {c === 'mesa' ? <><UtensilsCrossed size={14} /> Cardápio da mesa</> : <><Bike size={14} /> Delivery</>}
                </button>
              ))}
            </div>
          </section>

          {/* 3. O que oferecer */}
          <section className="ab-sec">
            <h3><span>3</span> O que oferecer</h3>
            <div className="ab-seg2">
              <button type="button" className={cx(f.ofertas_modo === 'manual' && 'ativo')} onClick={() => set('ofertas_modo', 'manual')}><ListChecks size={16} /> Eu escolho os itens</button>
              <button type="button" className={cx(f.ofertas_modo === 'automatico' && 'ativo')} onClick={() => set('ofertas_modo', 'automatico')}><Wand2 size={16} /> Automático</button>
            </div>
            {f.ofertas_modo === 'manual' ? (
              <>
                {f.ofertas.length > 0 && (
                  <ol className="ab-escolhidos">
                    {f.ofertas.map((id) => {
                      const p = itens.find((x) => x.id === id);
                      if (!p) return null;
                      return (
                        <li key={id}>
                          <FotoProduto p={p} classe="ab-escolhidos__foto" />
                          <span>{p.nome}</span>
                          <button type="button" className="icone-btn" onClick={() => alternar('ofertas', id)} aria-label={`Tirar ${p.nome}`}><X size={15} /></button>
                        </li>
                      );
                    })}
                  </ol>
                )}
                <ListaItens itens={filtrar(buscaOf)} busca={buscaOf} aoBuscar={setBuscaOf} marcados={f.ofertas} aoMarcar={(id) => alternar('ofertas', id, 6)}
                  nomeCat={(p) => nomeCat(p.categoria_id)} bloqueio={motivoNaoOferece} limite={6} />
              </>
            ) : (
              <p className="ab-nota"><Sparkles size={16} /> Oferece o que os clientes mais pedem junto com o item escolhido. Sem histórico ainda, usa bebidas, sobremesas e acompanhamentos.</p>
            )}
            <div className="ab-max">
              <span>Mostrar até</span>
              {[1, 2, 3, 4].map((n) => <button key={n} type="button" className={cx(f.max_ofertas === n && 'ativo')} onClick={() => set('max_ofertas', n)}>{n}</button>)}
              <span>{f.max_ofertas === 1 ? 'item' : 'itens'} por vez</span>
            </div>
          </section>

          {/* 4. Desconto */}
          <section className="ab-sec">
            <h3><span>4</span> Desconto na oferta <small>(opcional)</small></h3>
            <div className="ab-seg2 ab-seg2--3">
              <button type="button" className={cx(f.desconto_tipo === 'nenhum' && 'ativo')} onClick={() => set('desconto_tipo', 'nenhum')}>Sem desconto</button>
              <button type="button" className={cx(f.desconto_tipo === 'percentual' && 'ativo')} onClick={() => { set('desconto_tipo', 'percentual'); set('desconto', '10'); }}>% de desconto</button>
              <button type="button" className={cx(f.desconto_tipo === 'valor' && 'ativo')} onClick={() => { set('desconto_tipo', 'valor'); set('desconto', ''); }}>R$ de desconto</button>
            </div>
            {f.desconto_tipo !== 'nenhum' && (
              <div className="ab-desconto">
                <label className="ab-desconto__campo">
                  {f.desconto_tipo === 'valor' && <span>R$</span>}
                  <input className="input" inputMode="decimal" value={f.desconto}
                    onChange={(e) => set('desconto', f.desconto_tipo === 'valor' ? mascaraPreco(e.target.value) : e.target.value.replace(/[^\d,.]/g, '').slice(0, 5))} />
                  {f.desconto_tipo === 'percentual' && <span>%</span>}
                </label>
                {exemploPreco && valorDesconto > 0 && (
                  <small>Ex.: {exemploPreco.nome} sai de <s>{brl(Number(exemploPreco.preco))}</s> por <b>{brl(precoComDesconto(Number(exemploPreco.preco), f.desconto_tipo, valorDesconto))}</b> só na oferta.</small>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Prévia: como o cliente vê */}
        <aside className="ab-previa" aria-label="Prévia">
          <span className="ab-previa__rotulo"><Eye size={14} /> Como o cliente vê</span>
          <div className="ab-celular">
            <div className="ab-celular__tela">
              {previa && exemplo ? (
                <>
                  <CorpoOrderBump oferta={previa} escolhidos={{ [previa.itens[0].p.id]: 1 }} aoMudar={() => undefined} item={{ nome: exemplo.nome, qtd: 1, total: Number(exemplo.preco), foto: exemplo }} />
                  <div className="ab-celular__rodape"><span>Não, obrigado</span><b>Adicionar · {brl(Number(exemplo.preco) + previa.itens[0].preco)}</b></div>
                </>
              ) : (
                <div className="ab-celular__vazio">
                  <Search size={26} />
                  <b>Nenhum item combina ainda</b>
                  <small>Ajuste onde a oferta aparece ou escolha itens para oferecer.</small>
                </div>
              )}
            </div>
          </div>
          {exemplo && <small className="ab-previa__dica">Exemplo com “{exemplo.nome}”. Aparece depois de “Adicionar”, antes do carrinho.</small>}
        </aside>
      </div>
    </Modal>
  );
}

function ListaItens({ itens, busca, aoBuscar, marcados, aoMarcar, nomeCat, bloqueio, limite }: {
  itens: ProdutoMesa[];
  busca: string;
  aoBuscar: (t: string) => void;
  marcados: string[];
  aoMarcar: (id: string) => void;
  nomeCat: (p: ProdutoMesa) => string;
  bloqueio?: (p: ProdutoMesa) => string;
  limite?: number;
}) {
  const cheio = limite !== undefined && marcados.length >= limite;
  return (
    <div className="ab-itens">
      <label className="ab-itens__busca"><Search size={16} /><input value={busca} onChange={(e) => aoBuscar(e.target.value)} placeholder="Buscar item ou categoria" aria-label="Buscar item" /></label>
      <ul>
        {itens.length === 0 && <li className="ab-itens__vazio">Nenhum item encontrado.</li>}
        {itens.map((p) => {
          const marcado = marcados.includes(p.id);
          const motivo = bloqueio?.(p) ?? '';
          const travado = !marcado && (motivo === 'Tem escolha obrigatória' || motivo === 'Sem preço' || cheio);
          return (
            <li key={p.id}>
              <button type="button" className={cx('ab-item', marcado && 'ativo')} disabled={travado} onClick={() => aoMarcar(p.id)}>
                <span className="ab-item__marca">{marcado && '✓'}</span>
                <FotoProduto p={p} classe="ab-item__foto" />
                <span className="ab-item__txt"><b>{p.prefixo ? `${p.prefixo} · ${p.nome}` : p.nome}</b><small>{nomeCat(p)}{motivo && <em> · {motivo}</em>}</small></span>
                <span className="ab-item__preco">{brl(Number(p.preco))}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {limite !== undefined && <small className="ab-itens__limite">{marcados.length}/{limite} escolhidos</small>}
    </div>
  );
}
