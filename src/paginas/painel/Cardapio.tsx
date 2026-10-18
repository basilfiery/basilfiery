import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  Check, ChevronRight, Copy, ListChecks, Eye, EyeOff, Film, GripVertical, ImagePlus, Layers, MoreVertical, Pencil, Plus, Search, Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import { Campo, FotoProduto, ImagemComida, Switch, Vazio } from '../../componentes/Basicos';
import { Suspenso } from '../../componentes/Suspenso';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { ACEITA_IMAGEM, ACEITA_VIDEO, LIMITE_VIDEO_MB, enviarImagem, enviarVideo, msgErro, supabase } from '../../lib/supabase';
import type { Categoria, Grupo, Produto } from '../../lib/tipos';
import { brl, cx, lerPreco, mascaraPreco, ordenarNome, precoParaTexto } from '../../lib/util';
import { usePainel } from './Painel';
import { AdicionaisDoProduto, ModalGrupoAdicionais, carregarAdicionais, type GrupoAdicional, type VinculoAdicional } from './Adicionais';
import { regraGrupo } from '../../lib/adicionais';
import { confirmar } from '../../componentes/Confirmar';

type Alvo = { id: string; depois: boolean } | null;

/**
 * Arrastar para mudar a ordem de uma lista (categorias, subcategorias ou itens).
 * Cada lista tem o seu: não dá para soltar um item numa lista diferente.
 */
function useArrastar(aoSoltar: (origem: string, destino: string, depois: boolean) => void) {
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<Alvo>(null);
  // A ref já vale no evento seguinte, mesmo num arrasto rápido
  const arrastandoRef = useRef<string | null>(null);
  const alvoRef = useRef<Alvo>(null);
  const limpar = () => {
    arrastandoRef.current = null;
    alvoRef.current = null;
    setArrastando(null);
    setAlvo(null);
  };
  const props = (id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.stopPropagation();
      arrastandoRef.current = id;
      setArrastando(id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!arrastandoRef.current) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const novo = { id, depois: e.clientY > r.top + r.height / 2 };
      alvoRef.current = novo;
      setAlvo(novo);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      const origem = arrastandoRef.current;
      const destino = alvoRef.current;
      if (origem && destino && origem !== destino.id) aoSoltar(origem, destino.id, destino.depois);
      limpar();
    },
    onDragEnd: limpar,
  });
  const classe = (id: string) =>
    cx(arrastando === id && 'arrastando', alvo?.id === id && arrastando !== id && (alvo.depois ? 'alvo-depois' : 'alvo-antes'));
  return { props, classe };
}

/** Nova ordem (1, 2, 3…) depois de mover `origem` para antes/depois de `destino`. */
function reordenar<T extends { id: string; ordem: number }>(lista: T[], origem: string, destino: string, depois: boolean) {
  const item = lista.find((x) => x.id === origem);
  const resto = lista.filter((x) => x.id !== origem);
  const idx = resto.findIndex((x) => x.id === destino);
  if (!item || idx < 0) return null;
  resto.splice(depois ? idx + 1 : idx, 0, item);
  const novas = resto.map((x, i) => ({ ...x, ordem: i + 1 }));
  return { novas, mudaram: novas.filter((x) => lista.find((y) => y.id === x.id)?.ordem !== x.ordem) };
}

export default function Cardapio() {
  const { restaurante } = usePainel();
  const toast = useToast();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [catSel, setCatSel] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [editCat, setEditCat] = useState<Categoria | 'nova' | null>(null);
  const [novaPai, setNovaPai] = useState<string | null>(null);
  const [editProd, setEditProd] = useState<Produto | 'novo' | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [editGrupo, setEditGrupo] = useState<Grupo | 'novo' | null>(null);
  const [adic, setAdic] = useState<{ grupos: GrupoAdicional[]; vinculos: VinculoAdicional[] }>({ grupos: [], vinculos: [] });
  const [editAdic, setEditAdic] = useState<GrupoAdicional | 'novo' | null>(null);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    const [c, p, g] = await Promise.all([
      supabase.from('categorias').select('*').eq('restaurante_id', restaurante.id),
      supabase.from('produtos').select('*').eq('restaurante_id', restaurante.id),
      supabase.from('grupos').select('*').eq('restaurante_id', restaurante.id),
    ]);
    if (c.error || p.error) toast(msgErro(c.error ?? p.error), 'erro');
    setGrupos(((g.data ?? []) as Grupo[]).sort(ordenarNome));
    const cats = ((c.data ?? []) as Categoria[]).sort(ordenarNome);
    setCategorias(cats);
    setProdutos(((p.data ?? []) as Produto[]).sort(ordenarNome));
    setAdic(await carregarAdicionais(restaurante.id));
    setCarregado(true);
    // Abre direto na primeira categoria (como no gestor do Anota AI)
    setCatSel((atual) => atual || (cats.find((x) => !x.pai_id)?.id ?? ''));
  }, [restaurante.id, toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function alternarAtivo(p: Produto, ativo: boolean) {
    setProdutos((l) => l.map((x) => (x.id === p.id ? { ...x, ativo } : x)));
    const { error } = await supabase.from('produtos').update({ ativo }).eq('id', p.id);
    if (error) {
      toast(msgErro(error), 'erro');
      void carregar();
    }
  }

  /** Esgotar / voltar a vender: no tablet aparece "Esgotado" e ninguém consegue pedir. */
  async function esgotar(p: Produto, esgotado: boolean) {
    setProdutos((l) => l.map((x) => (x.id === p.id ? { ...x, esgotado } : x)));
    const { error } = await supabase.rpc('produto_esgotar', { p_produto: p.id, p_esgotado: esgotado });
    if (error) {
      toast(msgErro(error), 'erro');
      void carregar();
    } else toast(esgotado ? `${p.nome} esgotado.${p.grupo_id ? ' Vale para todos os tamanhos.' : ''}` : `${p.nome} voltou ao cardápio.`, esgotado ? 'info' : 'ok');
  }

  async function duplicarProduto(p: Produto) {
    const { data, error } = await supabase.rpc('produto_duplicar', { p_produto: p.id });
    if (error) return toast(msgErro(error), 'erro');
    toast(`Cópia de "${p.nome}" criada. Ajuste o que mudar.`, 'ok');
    const [{ data: copia }] = await Promise.all([supabase.from('produtos').select('*').eq('id', data as string).single(), carregar()]);
    if (copia) setEditProd(copia as Produto);
  }

  async function duplicarCategoria(c: Categoria) {
    const { data, error } = await supabase.rpc('categoria_duplicar', { p_categoria: c.id });
    if (error) return toast(msgErro(error), 'erro');
    toast(`Cópia de "${c.nome}" criada${c.pai_id ? '' : ' com os itens e subcategorias'}.`, 'ok');
    await carregar();
    if (!c.pai_id) setCatSel(data as string);
  }

  async function excluirProduto(p: Produto) {
    if (!(await confirmar(`Excluir "${p.nome}"?\n\nSe for só por um tempo, use Esgotar.`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('produtos').delete().eq('id', p.id);
    if (error) return toast(msgErro(error), 'erro');
    setProdutos((l) => l.filter((x) => x.id !== p.id));
    toast(`${p.nome} excluído.`, 'ok');
  }

  /** Esgota (ou volta) todos os itens de uma lista de uma vez: o "Esgotar" do topo da categoria. */
  async function esgotarTodos(lista: Produto[], esgotado: boolean) {
    if (!lista.length) return;
    const ids = new Set(lista.map((p) => p.id));
    setProdutos((l) => l.map((x) => (ids.has(x.id) ? { ...x, esgotado } : x)));
    const r = await Promise.all(lista.map((p) => supabase.rpc('produto_esgotar', { p_produto: p.id, p_esgotado: esgotado })));
    if (r.some((x) => x.error)) {
      toast('Não deu para esgotar todos. Tente de novo.', 'erro');
      void carregar();
    } else toast(esgotado ? `${lista.length} ${lista.length === 1 ? 'item esgotado' : 'itens esgotados'}.` : 'Itens de volta ao cardápio.', esgotado ? 'info' : 'ok');
  }

  async function esgotarCategoria(c: Categoria, esgotado: boolean) {
    setCategorias((l) => l.map((x) => (x.id === c.id ? { ...x, esgotado } : x)));
    const { error } = await supabase.rpc('categoria_esgotar', { p_categoria: c.id, p_esgotado: esgotado });
    if (error) {
      toast(msgErro(error), 'erro');
      void carregar();
    } else toast(esgotado ? `${c.nome} esgotada: nada dela pode ser pedido.` : `${c.nome} voltou ao cardápio.`, esgotado ? 'info' : 'ok');
  }

  async function precoCategoria(c: Categoria, preco: number | null) {
    const { error } = await supabase.from('categorias').update({ preco_grupo: preco }).eq('id', c.id);
    if (error) {
      toast(msgErro(error), 'erro');
      return false;
    }
    setCategorias((l) => l.map((x) => (x.id === c.id ? { ...x, preco_grupo: preco } : x)));
    return true;
  }

  async function excluirCategoria(c: Categoria) {
    const filhas = categorias.some((x) => x.pai_id === c.id);
    if (!(await confirmar(`Excluir "${c.nome}"?\n\nOs itens dela ficam sem categoria e somem do tablet até você movê-los.${filhas ? ' As subcategorias viram categorias principais.' : ''}`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('categorias').delete().eq('id', c.id);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${c.nome} excluída.`, 'ok');
    if (catSel === c.id) setCatSel(c.pai_id ?? '');
    void carregar();
  }

  async function alternarCategoria(c: Categoria, ativo: boolean) {
    setCategorias((l) => l.map((x) => (x.id === c.id ? { ...x, ativo } : x)));
    const { error } = await supabase.from('categorias').update({ ativo }).eq('id', c.id);
    if (error) {
      toast(msgErro(error), 'erro');
      void carregar();
    } else toast(ativo ? `${c.nome} aparece no tablet.` : `${c.nome} saiu do tablet.`, 'ok');
  }

  /** Salva a nova ordem de categorias (irmãs) ou de itens de uma categoria. */
  async function salvarOrdem(tabela: 'categorias' | 'produtos', mudaram: { id: string; ordem: number }[]) {
    const resultados = await Promise.all(mudaram.map((x) => supabase.from(tabela).update({ ordem: x.ordem }).eq('id', x.id)));
    const falha = resultados.find((r) => r.error);
    if (falha) {
      toast(msgErro(falha.error), 'erro');
      void carregar();
    } else toast('Ordem salva. Os tablets atualizam em até 1 minuto.', 'ok');
  }

  function moverCategoria(origem: string, destino: string, depois: boolean) {
    const pai = categorias.find((c) => c.id === origem)?.pai_id ?? null;
    const irmas = categorias.filter((c) => (c.pai_id ?? null) === pai);
    const r = reordenar(irmas, origem, destino, depois);
    if (!r) return;
    setCategorias((todas) => todas.map((c) => r.novas.find((n) => n.id === c.id) ?? c).sort(ordenarNome));
    void salvarOrdem('categorias', r.mudaram);
  }

  function moverProduto(origem: string, destino: string, depois: boolean) {
    const cat = produtos.find((p) => p.id === origem)?.categoria_id;
    const daCategoria = produtos.filter((p) => p.categoria_id === cat);
    const r = reordenar(daCategoria, origem, destino, depois);
    if (!r) return;
    setProdutos((todos) => todos.map((p) => r.novas.find((n) => n.id === p.id) ?? p).sort(ordenarNome));
    void salvarOrdem('produtos', r.mudaram);
  }

  const arrastoCats = useArrastar(moverCategoria);
  const arrastoSubs = useArrastar(moverCategoria);
  const arrastoItens = useArrastar(moverProduto);

  // Árvore: principais na ordem, cada uma seguida das suas subcategorias
  const principais = categorias.filter((c) => !c.pai_id || !categorias.some((x) => x.id === c.pai_id));
  const filhasDe = (id: string) => categorias.filter((c) => c.pai_id === id);
  const arvore = principais.flatMap((c) => [c, ...filhasDe(c.id)]);
  const saboresDe = (grupoId: string | null) => (grupoId ? produtos.filter((p) => p.grupo_id === grupoId) : []);
  const itensDe = (id: string) => produtos.filter((p) => p.categoria_id === id);
  const totalDe = (c: Categoria) => itensDe(c.id).length + saboresDe(c.grupo_id).length;
  const contagem = (id: string) => {
    const c = categorias.find((x) => x.id === id);
    return (c ? totalDe(c) : 0) + filhasDe(id).reduce((s, f) => s + totalDe(f), 0);
  };
  const grupoSel = catSel.startsWith('g:') ? grupos.find((g) => g.id === catSel.slice(2)) ?? null : null;
  const cat = categorias.find((c) => c.id === catSel) ?? null;
  const grupoDe = (id: string | null) => grupos.find((g) => g.id === id) ?? null;
  const usamGrupo = (id: string) => categorias.filter((c) => c.grupo_id === id);
  const nomeCompleto = (c: Categoria) => {
    const p = categorias.find((x) => x.id === c.pai_id);
    return p ? `${p.nome} › ${c.nome}` : c.nome;
  };
  const pai = cat?.pai_id ? categorias.find((c) => c.id === cat.pai_id) ?? null : null;
  const principalAberta = pai ?? cat;
  const termo = busca.trim().toLowerCase();
  const filtrar = (lista: Produto[]) => (termo ? lista.filter((p) => p.nome.toLowerCase().includes(termo)) : lista);

  const nomeCat = (id: string | null) => {
    const c = categorias.find((x) => x.id === id);
    if (!c) return 'Sem categoria';
    const p = categorias.find((x) => x.id === c.pai_id);
    return p ? `${p.nome} › ${c.nome}` : c.nome;
  };
  const detalhes = (p: Produto, comCategoria: boolean) => [
    comCategoria && (p.grupo_id ? `Sabor · ${grupoDe(p.grupo_id)?.nome ?? 'grupo'}` : nomeCat(p.categoria_id)),
    p.descricao && !comCategoria && p.descricao,
    adic.vinculos.some((v) => v.produto_id === p.id) && `adicionais: ${adic.vinculos.filter((v) => v.produto_id === p.id).sort((a, b) => a.ordem - b.ordem).map((v) => adic.grupos.find((g) => g.id === v.grupo_id)?.nome).filter(Boolean).join(', ')}`,
    p.preco_de && Number(p.preco_de) > Number(p.preco) && `promoção (de ${brl(Number(p.preco_de))})`,
    p.video_url && 'vídeo',
    p.controla_estoque && `estoque ${p.estoque}`,
    !p.precisa_preparo && 'sem preparo',
  ].filter(Boolean).join(' · ');

  function abrir(id: string) {
    setCatSel(id);
    setBusca('');
  }
  function novoItem() {
    setEditProd('novo');
  }

  /** Linha de um item: Esgotar, preço, menu e abrir (como no gestor do Anota AI). */
  const linhaItem = (p: Produto, arrastavel: boolean, comCategoria = false) => (
    <li
      key={p.id}
      className={cx('item-linha', !p.ativo && 'item-linha--oculto', p.esgotado && 'item-linha--esgotado', arrastavel && arrastoItens.classe(p.id))}
      {...(arrastavel ? arrastoItens.props(p.id) : {})}
    >
      {arrastavel && <GripVertical size={18} className="item-linha__alca" aria-hidden="true" />}
      <FotoProduto p={p} classe="item-linha__foto" />
      <button className="item-linha__nome" onClick={() => setEditProd(p)} title="Editar item">
        <strong>
          {p.nome}
          {p.esgotado && <span className="selo-esgotado">Esgotado</span>}
          {!p.ativo && <span className="selo-oculto">Fora do tablet</span>}
        </strong>
        {detalhes(p, comCategoria) && <small>{detalhes(p, comCategoria)}</small>}
      </button>
      <div className="item-linha__controles">
        <div className="chave-esgotar" title={p.esgotado ? 'Esgotado: no tablet aparece como esgotado' : 'Marcar como esgotado'}>
          <span>Esgotar</span>
          <Switch marcado={p.esgotado} aoMudar={(v) => void esgotar(p, v)} />
        </div>
        <div className="item-linha__preco">
          <PrecoEditavel produto={p} aoSalvar={(preco) => setProdutos((l) => l.map((x) => (x.id === p.id ? { ...x, preco } : x)))} />
          {(p.grupo_id || categorias.find((c) => c.id === p.categoria_id)?.preco_grupo != null) && <small>acréscimo</small>}
        </div>
        <Suspenso
          largura={220}
          gatilho={(aberto, alternar) => (
            <button className={cx('btn-quadrado', aberto && 'ativo')} onClick={alternar} aria-label={`Mais opções de ${p.nome}`}><MoreVertical size={18} /></button>
          )}
        >
          {(fechar) => (
            <>
              <button className="menu-item" onClick={() => { fechar(); setEditProd(p); }}><Pencil size={17} /> Editar</button>
              <button className="menu-item" onClick={() => { fechar(); void duplicarProduto(p); }}><Copy size={17} /> Duplicar</button>
              <button className="menu-item" onClick={() => { fechar(); void alternarAtivo(p, !p.ativo); }}>
                {p.ativo ? <><EyeOff size={17} /> Tirar do tablet</> : <><Eye size={17} /> Mostrar no tablet</>}
              </button>
              <div className="menu-sep" />
              <button className="menu-item menu-item--perigo" onClick={() => { fechar(); void excluirProduto(p); }}><Trash2 size={17} /> Excluir</button>
            </>
          )}
        </Suspenso>
        <button className="btn-quadrado" onClick={() => setEditProd(p)} aria-label={`Abrir ${p.nome}`}><ChevronRight size={18} /></button>
      </div>
    </li>
  );

  /** "Esgotar" do topo + menu ⋮ da categoria (ou do grupo). */
  const topoAcoes = (lista: Produto[], menu: (fechar: () => void) => ReactNode) => {
    const todosEsgotados = lista.length > 0 && lista.every((p) => p.esgotado);
    return (
      <div className="cat-painel__acoes">
        {lista.length > 0 && (
          <div className="chave-esgotar" title="Esgota (ou volta) todos os itens desta lista">
            <span>Esgotar</span>
            <Switch marcado={todosEsgotados} aoMudar={(v) => void esgotarTodos(lista, v)} />
          </div>
        )}
        <Suspenso
          largura={230}
          gatilho={(aberto, alternar) => (
            <button className={cx('btn-quadrado btn-quadrado--cheio', aberto && 'ativo')} onClick={alternar} aria-label="Mais opções"><MoreVertical size={18} /></button>
          )}
        >
          {menu}
        </Suspenso>
      </div>
    );
  };

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Cardápio</h1>
          <p>O que você mudar aqui aparece nos tablets em até 1 minuto.</p>
        </div>
      </div>

      <div className="cardapio">
        <aside className="card cardapio__cats">
          <div className="cardapio__cats-cab">
            <h2 className="card__titulo">Categorias</h2>
            <button className="btn btn--primario btn--sm" onClick={() => { setNovaPai(null); setEditCat('nova'); }}>
              <Plus size={16} /> Nova
            </button>
          </div>
          <div className="cats-lista">
            <button className={cx('cat-item', !catSel && 'ativo')} onClick={() => abrir('')}>
              <span>Todos os produtos</span><span className="contagem">{produtos.length}</span>
            </button>
            {principais.map((c) => (
              <div key={c.id} className="cats-grupo">
                <div
                  className={cx('cat-item', principalAberta?.id === c.id && 'ativo', !c.ativo && 'cat-item--inativa', arrastoCats.classe(c.id))}
                  role="button"
                  tabIndex={0}
                  onClick={() => abrir(c.id)}
                  onKeyDown={(e) => e.key === 'Enter' && abrir(c.id)}
                  title="Arraste para mudar a ordem"
                  {...arrastoCats.props(c.id)}
                >
                  <GripVertical size={16} className="cat-item__alca" aria-hidden="true" />
                  <span>{c.emoji} {c.nome}</span>
                  <span className="contagem">{contagem(c.id)}</span>
                </div>
              </div>
            ))}
          </div>
          {principais.length > 1 && <p className="cats-dica">Arraste pela alça <GripVertical size={13} /> para mudar a ordem no tablet.</p>}

          <div className="cardapio__cats-cab cardapio__cats-cab--grupos">
            <h2 className="card__titulo">Grupos de adicionais</h2>
            <button className="btn btn--contorno btn--sm" onClick={() => setEditAdic('novo')}><Plus size={16} /> Novo</button>
          </div>
          {adic.grupos.length === 0 ? (
            <p className="cats-dica cats-dica--bloco">Sabores, bordas, extras… Crie o grupo uma vez e ligue em vários itens (ex.: Pizza P, M e G).</p>
          ) : (
            <div className="cats-lista">
              {adic.grupos.map((g) => (
                <button key={g.id} className="cat-item cat-item--adic" onClick={() => setEditAdic(g)} title={regraGrupo(g)}>
                  <ListChecks size={15} className="cat-item__seta" aria-hidden="true" />
                  <span>{g.nome}{g.identificador && <small> · {g.identificador}</small>}</span>
                  <span className="contagem" title="Itens que usam">{adic.vinculos.filter((v) => v.grupo_id === g.id).length}</span>
                </button>
              ))}
            </div>
          )}

        </aside>

        {/* ---------- A "guia" da categoria aberta ---------- */}
        {!carregado ? null : categorias.length === 0 ? (
          <section className="card cat-painel">
            <Vazio icone={<UtensilsCrossed size={36} />} titulo="Comece criando uma categoria">
              Ex.: Pizzas, Porções, Bebidas. Depois você coloca os itens dentro dela.
            </Vazio>
            <button className="btn btn--primario" style={{ justifySelf: 'center' }} onClick={() => { setNovaPai(null); setEditCat('nova'); }}>
              <Plus size={18} /> Nova categoria
            </button>
          </section>
        ) : grupoSel ? (
          <section className="card cat-painel" key={grupoSel.id}>
            <header className="cat-painel__cab">
              <div className="cat-painel__titulo">
                <span className="cat-painel__tipo"><Layers size={14} /> Grupo de sabores</span>
                <h2>{grupoSel.nome}</h2>
              </div>
            </header>
            <div className="usado-em">
              <span>Aparece em</span>
              {usamGrupo(grupoSel.id).length === 0 ? (
                <em>nenhum tamanho ainda. Abra a subcategoria (ex.: Pizza P), toque em ⋮ › Editar e escolha “Grupo de sabores”.</em>
              ) : usamGrupo(grupoSel.id).map((c) => (
                <button key={c.id} className="usado-em__chip" onClick={() => abrir(c.id)}>
                  {nomeCompleto(c)} <b>{brl(Number(c.preco_grupo ?? 0))}</b>
                </button>
              ))}
            </div>
            <div className="cat-painel__barra">
              <div className="cat-painel__criar">
                <button className="btn btn--contorno btn--acento" onClick={novoItem}><Plus size={17} /> Adicionar sabor</button>
              </div>
              <label className="cat-painel__busca"><Search size={16} /><input placeholder="Pesquisar" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
              {topoAcoes(saboresDe(grupoSel.id), (fechar) => (
                <button className="menu-item" onClick={() => { fechar(); setEditGrupo(grupoSel); }}><Pencil size={17} /> Renomear ou excluir grupo</button>
              ))}
            </div>
            {filtrar(saboresDe(grupoSel.id)).length === 0 ? (
              <div className="cat-painel__vazio"><Layers size={26} /><p>{termo ? 'Nenhum sabor com esse nome.' : 'Nenhum sabor ainda. Ex.: Calabresa, Frango com Catupiry, Portuguesa.'}</p></div>
            ) : (
              <ul className="itens-lista">{filtrar(saboresDe(grupoSel.id)).map((p) => linhaItem(p, !termo))}</ul>
            )}
          </section>
        ) : !cat ? (
          <section className="card cat-painel">
            <header className="cat-painel__cab">
              <div className="cat-painel__titulo"><h2>Todos os produtos</h2><span className="muted">{produtos.length} itens</span></div>
            </header>
            <div className="cat-painel__barra">
              <label className="cat-painel__busca"><Search size={16} /><input placeholder="Buscar em todo o cardápio…" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
            </div>
            {filtrar(produtos).length === 0 ? <Vazio icone={<Search size={30} />} titulo="Nada encontrado" /> : (
              <ul className="itens-lista">
                {filtrar([...produtos].sort((a, b) => arvore.findIndex((c) => c.id === a.categoria_id) - arvore.findIndex((c) => c.id === b.categoria_id) || ordenarNome(a, b)))
                  .map((p) => linhaItem(p, false, true))}
              </ul>
            )}
          </section>
        ) : (() => {
          const subs = !cat.pai_id && !termo ? filhasDe(cat.id) : [];
          const itens = filtrar(itensDe(cat.id));
          const grupo = grupoDe(cat.grupo_id);
          const vazio = !subs.length && !itens.length && !grupo;
          return (
          <section className="card cat-painel" key={cat.id}>
            <header className="cat-painel__cab">
              <div className="cat-painel__titulo">
                {pai && (
                  <nav className="cat-painel__trilha" aria-label="Caminho">
                    <button onClick={() => abrir(pai.id)}>{pai.emoji} {pai.nome}</button>
                    <ChevronRight size={15} />
                  </nav>
                )}
                <h2>{cat.emoji} {cat.nome}</h2>
                {!cat.ativo && <span className="badge">Oculta no tablet</span>}
              </div>
            </header>

            {/* Uma barra só: criar (item ou subcategoria), buscar; à direita, Esgotar e ⋮ */}
            <div className="cat-painel__barra">
              <div className="cat-painel__criar">
                <button className="btn btn--contorno btn--acento" onClick={novoItem}><Plus size={17} /> Adicionar item</button>
                {!cat.pai_id && (
                  <button className="btn btn--contorno btn--acento" onClick={() => { setNovaPai(cat.id); setEditCat('nova'); }}>
                    <Plus size={17} /> Nova subcategoria
                  </button>
                )}
              </div>
              <label className="cat-painel__busca"><Search size={16} /><input placeholder="Pesquisar" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
              {topoAcoes(itensDe(cat.id), (fechar) => (
                <>
                  <button className="menu-item" onClick={() => { fechar(); setEditCat(cat); }}><Pencil size={17} /> Editar {cat.pai_id ? 'subcategoria' : 'categoria'}</button>
                  <button className="menu-item" onClick={() => { fechar(); void duplicarCategoria(cat); }}><Copy size={17} /> Duplicar {cat.pai_id ? 'subcategoria' : 'categoria'}</button>
                  <button className="menu-item" onClick={() => { fechar(); void alternarCategoria(cat, !cat.ativo); }}>
                    {cat.ativo ? <><EyeOff size={17} /> Tirar do tablet</> : <><Eye size={17} /> Mostrar no tablet</>}
                  </button>
                  <div className="menu-sep" />
                  <button className="menu-item menu-item--perigo" onClick={() => { fechar(); void excluirCategoria(cat); }}><Trash2 size={17} /> Excluir</button>
                </>
              ))}
            </div>

            {grupo && !termo && (
              <div className="grupo-ligado">
                <span className="grupo-ligado__icone"><Layers size={20} /></span>
                <div>
                  <strong>Sabores do grupo “{grupo.nome}”</strong>
                  <small>Preço {cat.pai_id ? 'deste tamanho' : ''}: <b>{brl(Number(cat.preco_grupo ?? 0))}</b> · {saboresDe(cat.grupo_id).length} sabores. Esgotar um sabor vale para todos os tamanhos.</small>
                </div>
                <button className="btn btn--contorno btn--sm" onClick={() => abrir(`g:${cat.grupo_id}`)}>Abrir grupo <ChevronRight size={15} /></button>
              </div>
            )}

            {vazio ? (
              <div className="cat-painel__vazio">
                <UtensilsCrossed size={26} />
                <p>{termo ? 'Nenhum item com esse nome aqui.' : cat.pai_id ? 'Nada aqui ainda. Toque em “Adicionar item”.' : 'Nada aqui ainda. Toque em “Adicionar item” ou, se tiver tamanhos (P, M, G), em “Nova subcategoria”.'}</p>
              </div>
            ) : (
              <ul className="itens-lista">
                {/* Subcategorias e itens na mesma lista, como no Anota AI */}
                {subs.map((f) => {
                  const itensF = itensDe(f.id);
                  const g = grupoDe(f.grupo_id);
                  const qtd = itensF.length + saboresDe(f.grupo_id).length;
                  const foto = [...itensF, ...saboresDe(f.grupo_id)].find((x) => x.imagem_url)?.imagem_url;
                  return (
                    <li
                      key={f.id}
                      className={cx('item-linha sub-linha', !f.ativo && 'item-linha--oculto', f.esgotado && 'item-linha--esgotado', arrastoSubs.classe(f.id))}
                      {...arrastoSubs.props(f.id)}
                    >
                      <GripVertical size={18} className="item-linha__alca" aria-hidden="true" />
                      <span className={cx('sub-linha__icone', !foto && !f.emoji && 'sub-linha__icone--vazia')}>
                        {foto ? <img src={foto} alt="" /> : f.emoji || <ImagemComida />}
                      </span>
                      <button className="sub-linha__nome" onClick={() => abrir(f.id)}>
                        <strong>
                          {f.nome}
                          {f.esgotado && <span className="selo-esgotado">Esgotado</span>}
                          {!f.ativo && <span className="selo-oculto">Fora do tablet</span>}
                        </strong>
                        <small>{qtd} {qtd === 1 ? 'opção' : 'opções'}{g ? ` · sabores de “${g.nome}”` : ''}</small>
                      </button>
                      <div className="item-linha__controles">
                        <div className="chave-esgotar" title="Esgota tudo desta subcategoria (ex.: acabou a massa deste tamanho)">
                          <span>Esgotar</span>
                          <Switch marcado={f.esgotado} aoMudar={(v) => void esgotarCategoria(f, v)} />
                        </div>
                        <div className="item-linha__preco">
                          <PrecoCategoria valor={f.preco_grupo} aoSalvar={(v) => precoCategoria(f, v)} />
                        </div>
                        <Suspenso
                          largura={230}
                          gatilho={(aberto, alternar) => (
                            <button className={cx('btn-quadrado', aberto && 'ativo')} onClick={alternar} aria-label={`Mais opções de ${f.nome}`}><MoreVertical size={18} /></button>
                          )}
                        >
                          {(fechar) => (
                            <>
                              <button className="menu-item" onClick={() => { fechar(); setEditCat(f); }}><Pencil size={17} /> Editar</button>
                              <button className="menu-item" onClick={() => { fechar(); void duplicarCategoria(f); }}><Copy size={17} /> Duplicar</button>
                              <button className="menu-item" onClick={() => { fechar(); void alternarCategoria(f, !f.ativo); }}>
                                {f.ativo ? <><EyeOff size={17} /> Tirar do tablet</> : <><Eye size={17} /> Mostrar no tablet</>}
                              </button>
                              <div className="menu-sep" />
                              <button className="menu-item menu-item--perigo" onClick={() => { fechar(); void excluirCategoria(f); }}><Trash2 size={17} /> Excluir</button>
                            </>
                          )}
                        </Suspenso>
                        <button className="btn-quadrado" onClick={() => abrir(f.id)} aria-label={`Abrir ${f.nome}`}><ChevronRight size={18} /></button>
                      </div>
                    </li>
                  );
                })}
                {grupo && !termo && saboresDe(cat.grupo_id).map((p) => linhaItem(p, false))}
                {itens.map((p) => linhaItem(p, !termo))}
              </ul>
            )}
          </section>
          );
        })()}
      </div>

      {editCat && (
        <ModalCategoria
          restauranteId={restaurante.id}
          categoria={editCat === 'nova' ? null : editCat}
          categorias={categorias}
          paiInicial={editCat === 'nova' ? novaPai : editCat.pai_id}
          aoFechar={() => setEditCat(null)}
          aoSalvar={() => { setEditCat(null); void carregar(); }}
        />
      )}
      {editProd && (
        <ModalProduto
          restauranteId={restaurante.id}
          produto={editProd === 'novo' ? null : editProd}
          categorias={arvore}
          categoriaPadrao={(cat?.id ?? '') || arvore[0]?.id}
          grupo={editProd === 'novo' ? grupoSel : grupoDe((editProd as Produto).grupo_id)}
          adicionais={adic.grupos}
          vinculosIniciais={editProd === 'novo' ? [] : adic.vinculos.filter((v) => v.produto_id === (editProd as Produto).id).sort((a, b) => a.ordem - b.ordem).map((v) => v.grupo_id)}
          nomesDoGrupo={(id) => adic.vinculos.filter((v) => v.grupo_id === id).map((v) => produtos.find((x) => x.id === v.produto_id)?.nome).filter((x): x is string => !!x)}
          aoRecarregarAdicionais={async () => { const r = await carregarAdicionais(restaurante.id); setAdic(r); return r.grupos; }}
          aoFechar={() => setEditProd(null)}
          aoSalvar={() => { setEditProd(null); void carregar(); }}
        />
      )}
      {editAdic && (
        <ModalGrupoAdicionais
          restauranteId={restaurante.id}
          grupo={editAdic === 'novo' ? null : editAdic}
          usadoEm={editAdic === 'novo' ? [] : adic.vinculos.filter((v) => v.grupo_id === editAdic.id).map((v) => produtos.find((x) => x.id === v.produto_id)?.nome).filter((x): x is string => !!x)}
          aoFechar={() => setEditAdic(null)}
          aoSalvar={() => { setEditAdic(null); void carregarAdicionais(restaurante.id).then(setAdic); }}
        />
      )}
      {editGrupo && (
        <ModalGrupo
          restauranteId={restaurante.id}
          grupo={editGrupo === 'novo' ? null : editGrupo}
          usadoEm={editGrupo === 'novo' ? [] : usamGrupo(editGrupo.id).map(nomeCompleto)}
          aoFechar={() => setEditGrupo(null)}
          aoSalvar={(id) => {
            setEditGrupo(null);
            if (id) setCatSel(`g:${id}`);
            else setCatSel('');
            void carregar();
          }}
        />
      )}
    </div>
  );
}

/** Preço da subcategoria direto na lista (vazio = sem preço: cada item vale o preço dele). */
function PrecoCategoria({ valor, aoSalvar }: { valor: number | null; aoSalvar: (preco: number | null) => Promise<boolean> }) {
  const toast = useToast();
  const texto0 = valor == null ? '' : precoParaTexto(valor);
  const [texto, setTexto] = useState(texto0);
  const [estado, setEstado] = useState<'parado' | 'salvando' | 'salvo'>('parado');
  const focado = useRef(false);
  useEffect(() => { if (!focado.current) setTexto(valor == null ? '' : precoParaTexto(valor)); }, [valor]);

  async function salvar() {
    focado.current = false;
    const novo = texto.trim() ? lerPreco(texto) : null;
    if (novo !== null && (!Number.isFinite(novo) || novo < 0)) {
      toast('Preço inválido. Ex.: 50,00', 'erro');
      return setTexto(texto0);
    }
    if (novo !== null) setTexto(precoParaTexto(novo));
    if ((novo ?? -1) === (valor == null ? -1 : Number(valor))) return;
    setEstado('salvando');
    const ok = await aoSalvar(novo);
    if (!ok) {
      setEstado('parado');
      return setTexto(texto0);
    }
    setEstado('salvo');
    setTimeout(() => setEstado('parado'), 1800);
  }

  return (
    <label className={cx('preco-editavel', estado === 'salvo' && 'salvo')} title="Preço desta subcategoria (os itens dentro custam isso + o acréscimo deles)">
      <span className="preco-editavel__rs">R$</span>
      <input
        value={texto}
        inputMode="decimal"
        placeholder="0,00"
        aria-label="Preço da subcategoria"
        onFocus={(e) => { focado.current = true; e.currentTarget.select(); }}
        onChange={(e) => setTexto(mascaraPreco(e.target.value))}
        onBlur={() => void salvar()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setTexto(texto0); e.currentTarget.blur(); }
        }}
        disabled={estado === 'salvando'}
      />
      <span className="preco-editavel__ok" aria-hidden="true"><Check size={15} /></span>
    </label>
  );
}

/** Preço editável direto na lista: clica, digita e pronto (salva ao sair do campo ou com Enter). */
function PrecoEditavel({ produto, aoSalvar }: { produto: Produto; aoSalvar: (preco: number) => void }) {
  const toast = useToast();
  const [texto, setTexto] = useState(precoParaTexto(produto.preco));
  const [estado, setEstado] = useState<'parado' | 'salvando' | 'salvo'>('parado');
  const focado = useRef(false);
  const cancelou = useRef(false);

  // Acompanha mudanças vindas de fora (ex.: editado no formulário)
  useEffect(() => {
    if (!focado.current) setTexto(precoParaTexto(produto.preco));
  }, [produto.preco]);

  async function salvar() {
    focado.current = false;
    if (cancelou.current) {
      cancelou.current = false;
      setTexto(precoParaTexto(produto.preco));
      return;
    }
    const novo = lerPreco(texto);
    if (!Number.isFinite(novo) || novo < 0) {
      toast('Preço inválido. Ex.: 49,90', 'erro');
      setTexto(precoParaTexto(produto.preco));
      return;
    }
    setTexto(precoParaTexto(novo));
    if (Math.abs(novo - Number(produto.preco)) < 0.005) return;
    setEstado('salvando');
    const { error } = await supabase.from('produtos').update({ preco: novo }).eq('id', produto.id);
    if (error) {
      setEstado('parado');
      setTexto(precoParaTexto(produto.preco));
      return toast(msgErro(error), 'erro');
    }
    aoSalvar(novo);
    setEstado('salvo');
    setTimeout(() => setEstado('parado'), 1800);
  }

  return (
    <label className={cx('preco-editavel', estado === 'salvo' && 'salvo')} title="Clique para alterar o preço">
      <span className="preco-editavel__rs">R$</span>
      <input
        value={texto}
        inputMode="decimal"
        aria-label={`Preço de ${produto.nome}`}
        onFocus={(e) => { focado.current = true; e.currentTarget.select(); }}
        onChange={(e) => setTexto(mascaraPreco(e.target.value))}
        onBlur={() => void salvar()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { cancelou.current = true; e.currentTarget.blur(); }
        }}
        disabled={estado === 'salvando'}
      />
      <span className="preco-editavel__ok" aria-hidden="true"><Check size={15} /></span>
    </label>
  );
}

const EMOJIS_SUGERIDOS = ['🍕', '🍔', '🍟', '🥗', '🍝', '🍣', '🥩', '🍗', '🍤', '🥟', '🌮', '🍰', '🍨', '☕', '🥤', '🍺', '🍷', '🍹'];

function ModalCategoria({ restauranteId, categoria, categorias, paiInicial, aoFechar, aoSalvar }: {
  restauranteId: string;
  categoria: Categoria | null;
  categorias: Categoria[];
  paiInicial: string | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const proximaOrdem = (pai: string | null) =>
    Math.max(0, ...categorias.filter((c) => c.pai_id === pai && c.id !== categoria?.id).map((c) => c.ordem)) + 1;
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [emoji, setEmoji] = useState(categoria?.emoji ?? '');
  const [pai, setPai] = useState<string>(paiInicial ?? '');
  const [ativo, setAtivo] = useState(categoria?.ativo ?? true);
  // Grupo de sabores antigo: só mantém o que já existia (o novo jeito são os grupos de adicionais)
  const usaGrupo = !!categoria?.grupo_id;
  const grupoId = categoria?.grupo_id ?? '';
  const [precoGrupo, setPrecoGrupo] = useState(categoria?.preco_grupo != null ? precoParaTexto(categoria.preco_grupo) : '');
  const novoGrupo = '';
  const [salvando, setSalvando] = useState(false);
  const temFilhas = !!categoria && categorias.some((c) => c.pai_id === categoria.id);
  const opcoesPai = categorias.filter((c) => !c.pai_id && c.id !== categoria?.id);
  const ehSub = !!pai;

  async function salvar() {
    let grupo: string | null = null;
    let preco: number | null = null;
    if (!usaGrupo && ehSub && precoGrupo.trim()) {
      preco = lerPreco(precoGrupo);
      if (!Number.isFinite(preco) || preco < 0) return toast('Preço inválido. Ex.: 50,00', 'erro');
    }
    if (usaGrupo) {
      preco = lerPreco(precoGrupo);
      if (!Number.isFinite(preco) || preco < 0) return toast(`Informe o preço ${ehSub ? 'deste tamanho' : 'desta categoria'}. Ex.: 50,00`, 'erro');
      grupo = grupoId || null;
      setSalvando(true);
      // Ainda não há grupo: cria agora, com o nome digitado
      if (!grupo) {
        if (!novoGrupo.trim()) {
          setSalvando(false);
          return toast('Dê um nome ao grupo de sabores. Ex.: Sabores de pizza', 'erro');
        }
        const { data, error } = await supabase.from('grupos').insert({ restaurante_id: restauranteId, nome: novoGrupo.trim() }).select('id').single();
        if (error) {
          setSalvando(false);
          return toast(msgErro(error), 'erro');
        }
        grupo = data.id as string;
      }
    }
    setSalvando(true);
    const mudouDeLugar = (categoria?.pai_id ?? '') !== pai;
    const dados = {
      nome: nome.trim(),
      emoji: emoji.trim() || null,
      ativo,
      pai_id: pai || null,
      grupo_id: grupo,
      preco_grupo: preco,
      ordem: categoria && !mudouDeLugar ? categoria.ordem : proximaOrdem(pai || null),
    };
    const { error } = categoria
      ? await supabase.from('categorias').update(dados).eq('id', categoria.id)
      : await supabase.from('categorias').insert({ ...dados, restaurante_id: restauranteId });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  async function excluir() {
    const aviso = temFilhas ? ' As subcategorias dela viram categorias principais.' : '';
    if (!categoria || !(await confirmar(`Excluir a categoria "${categoria.nome}"?\n\nOs produtos dela ficam sem categoria e somem do tablet até você movê-los.${aviso}`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('categorias').delete().eq('id', categoria.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={categoria ? (ehSub ? 'Editar subcategoria' : 'Editar categoria') : ehSub ? 'Nova subcategoria' : 'Nova categoria'}
      largura={560}
      rodape={
        <>
          {categoria && <button className="btn btn--perigo" style={{ marginRight: 'auto' }} onClick={() => void excluir()}><Trash2 size={16} /> Excluir</button>}
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={!nome.trim() || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <div className="form cat-form">
        <div className="cat-form__nome">
          <label className="campo">
            <span>Ícone</span>
            <input className="input cat-form__emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} placeholder="—" aria-label="Emoji da categoria" />
          </label>
          <label className="campo">
            <span>Nome</span>
            <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} autoFocus placeholder={ehSub ? 'Ex.: Pizza P' : 'Ex.: Pizzas'} />
          </label>
        </div>
        <div className="cat-form__sugestoes" aria-label="Sugestões de ícone">
          {EMOJIS_SUGERIDOS.map((e) => (
            <button key={e} type="button" className={cx(emoji === e && 'ativo')} onClick={() => setEmoji(emoji === e ? '' : e)}>{e}</button>
          ))}
        </div>

        <Campo
          rotulo="Fica dentro de"
          dica={temFilhas ? 'Esta categoria já tem subcategorias, por isso fica como principal.' : 'Ex.: “Pizza P”, “Pizza M” e “Pizza G” dentro de “Pizzas”.'}
        >
          <select className="select" value={pai} onChange={(e) => setPai(e.target.value)} disabled={temFilhas}>
            <option value="">Nenhuma (categoria principal)</option>
            {opcoesPai.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>)}
          </select>
        </Campo>

        {ehSub ? (
          <Campo rotulo="Preço da subcategoria (opcional)" dica="Ex.: Pizza P R$ 50,00. Os itens dentro custam isso; o preço de cada item vira acréscimo. Vazio = cada item com o seu preço.">
            <div className="input-preco">
              <span>R$</span>
              <input className="input" inputMode="decimal" value={precoGrupo} onChange={(e) => setPrecoGrupo(mascaraPreco(e.target.value))} placeholder="0,00" />
            </div>
          </Campo>
        ) : (
          <p className="cat-form__ajuda">Você cadastra os itens desta categoria, cada um com o seu preço. Sabores, bordas e extras ficam nos <b>grupos de adicionais</b> de cada item.</p>
        )}

        <Switch marcado={ativo} aoMudar={setAtivo}>Mostrar no tablet</Switch>
      </div>
    </Modal>
  );
}

/** Nome (e exclusão) de um grupo de sabores. */
function ModalGrupo({ restauranteId, grupo, usadoEm, aoFechar, aoSalvar }: {
  restauranteId: string;
  grupo: Grupo | null;
  usadoEm: string[];
  aoFechar: () => void;
  aoSalvar: (id?: string) => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(grupo?.nome ?? '');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const r = grupo
      ? await supabase.from('grupos').update({ nome: nome.trim() }).eq('id', grupo.id).select('id').single()
      : await supabase.from('grupos').insert({ restaurante_id: restauranteId, nome: nome.trim() }).select('id').single();
    setSalvando(false);
    if (r.error) return toast(msgErro(r.error), 'erro');
    aoSalvar(r.data.id as string);
  }

  async function excluir() {
    if (!grupo || !(await confirmar(`Excluir o grupo "${grupo.nome}" e todos os sabores dele?${usadoEm.length ? `\n\nEle deixa de aparecer em: ${usadoEm.join(', ')}.` : ''}`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('grupos').delete().eq('id', grupo.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={grupo ? 'Editar grupo de sabores' : 'Novo grupo de sabores'}
      largura={480}
      rodape={
        <>
          {grupo && <button className="btn btn--perigo" style={{ marginRight: 'auto' }} onClick={() => void excluir()}><Trash2 size={16} /> Excluir</button>}
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={!nome.trim() || salvando} onClick={() => void salvar()}>Salvar</button>
        </>
      }
    >
      <div className="form">
        <Campo rotulo="Nome do grupo" dica="Ex.: Sabores de pizza, Sabores de açaí, Recheios de pastel.">
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus />
        </Campo>
        <p className="cat-form__ajuda">
          Depois, abra cada tamanho (ex.: Pizza P) e escolha <b>Grupo de sabores</b> em “O que aparece dentro”, com o preço do tamanho.
        </p>
      </div>
    </Modal>
  );
}

function ModalProduto({ restauranteId, produto, categorias, categoriaPadrao, grupo, adicionais, vinculosIniciais, nomesDoGrupo, aoRecarregarAdicionais, aoFechar, aoSalvar }: {
  restauranteId: string;
  produto: Produto | null;
  categorias: Categoria[];
  categoriaPadrao?: string;
  /** Novo sabor deste grupo (ou edição de um sabor) */
  grupo?: Grupo | null;
  /** Grupos de adicionais do restaurante e os ligados a este item */
  adicionais: GrupoAdicional[];
  vinculosIniciais: string[];
  nomesDoGrupo: (grupoId: string) => string[];
  aoRecarregarAdicionais: () => Promise<GrupoAdicional[]>;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [vinculos, setVinculos] = useState<string[]>(vinculosIniciais);
  const [gruposAdic, setGruposAdic] = useState(adicionais);
  const [editAdic, setEditAdic] = useState<GrupoAdicional | 'novo' | null>(null);

  /** Liga/desliga os grupos de adicionais deste item (só o que mudou). */
  async function salvarVinculos(produtoId: string) {
    if (vinculos.join() === vinculosIniciais.join()) return null;
    const tirar = vinculosIniciais.filter((id) => !vinculos.includes(id));
    if (tirar.length) {
      const { error } = await supabase.from('produto_adicionais').delete().eq('produto_id', produtoId).in('grupo_id', tirar);
      if (error) return error;
    }
    if (vinculos.length) {
      const { error } = await supabase.from('produto_adicionais').upsert(
        vinculos.map((grupo_id, ordem) => ({ produto_id: produtoId, grupo_id, restaurante_id: restauranteId, ordem })),
      );
      if (error) return error;
    }
    return null;
  }
  const arquivoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  // Produto novo em categoria de bebidas já começa "sem preparo"
  const ehBebida = (catId: string) => {
    const c = categorias.find((x) => x.id === catId);
    const pai = categorias.find((x) => x.id === c?.pai_id);
    return /bebida|drink|refri|cerveja|suco|vinho|dose/i.test(`${c?.nome ?? ''} ${pai?.nome ?? ''}`);
  };
  const [f, setF] = useState({
    precisa_preparo: produto?.precisa_preparo ?? !ehBebida(produto?.categoria_id ?? categoriaPadrao ?? ''),
    nome: produto?.nome ?? '',
    descricao: produto?.descricao ?? '',
    preco: produto ? precoParaTexto(produto.preco) : '',
    preco_de: produto?.preco_de ? precoParaTexto(Number(produto.preco_de)) : '',
    categoria_id: produto?.categoria_id ?? categoriaPadrao ?? '',
    emoji: produto?.emoji ?? '',
    imagem_url: produto?.imagem_url ?? null as string | null,
    video_url: produto?.video_url ?? null as string | null,
    capa: (produto?.capa ?? 'imagem') as 'imagem' | 'video',
    vegetariano: produto?.vegetariano ?? false,
    picancia: produto?.picancia ?? 0,
    destaque: produto?.destaque ?? false,
    novo: produto?.novo ?? false,
    ativo: produto?.ativo ?? true,
    ordem: String(produto?.ordem ?? 0),
    controla_estoque: produto?.controla_estoque ?? false,
    estoque_minimo: String(produto?.estoque_minimo ?? 0),
    estoque_inicial: '',
  });
  const ehSabor = !!(grupo || produto?.grupo_id);
  const [esgotado, setEsgotado] = useState(produto?.esgotado ?? false);
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const [enviandoVideo, setEnviandoVideo] = useState(false);
  const mudar = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function escolherFoto(arquivo?: File) {
    if (!arquivo) return;
    setEnviandoFoto(true);
    try {
      mudar('imagem_url', await enviarImagem(restauranteId, arquivo, 'produtos'));
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviandoFoto(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  async function escolherVideo(arquivo?: File) {
    if (!arquivo) return;
    setEnviandoVideo(true);
    try {
      const url = await enviarVideo(restauranteId, arquivo, 'videos');
      // Sem foto? O vídeo vira a capa automaticamente (dá para trocar abaixo)
      setF((x) => ({ ...x, video_url: url, capa: x.imagem_url ? x.capa : 'video' }));
      toast('Vídeo enviado.', 'ok');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviandoVideo(false);
      if (videoRef.current) videoRef.current.value = '';
    }
  }

  async function salvar() {
    // Sabor: o preço é só o acréscimo (vazio = R$ 0,00)
    const preco = ehSabor && !f.preco.trim() ? 0 : lerPreco(f.preco);
    const precoDe = f.preco_de.trim() ? lerPreco(f.preco_de) : null;
    if (precoDe !== null && (!Number.isFinite(precoDe) || precoDe <= preco)) return toast('O preço "de" precisa ser maior que o preço atual (ex.: de 59,90 por 49,90).', 'erro');
    if (!f.nome.trim()) return toast('Informe o nome.', 'erro');
    if (!Number.isFinite(preco) || preco < 0) return toast('Preço inválido. Ex.: 49,90', 'erro');
    setSalvando(true);
    const dados = {
      nome: f.nome.trim(),
      descricao: f.descricao.trim(),
      preco,
      preco_de: ehSabor ? null : precoDe,
      categoria_id: ehSabor ? null : f.categoria_id || null,
      grupo_id: ehSabor ? grupo?.id ?? produto?.grupo_id ?? null : null,
      esgotado,
      emoji: f.emoji.trim() || null,
      imagem_url: f.imagem_url,
      video_url: f.video_url,
      capa: f.capa === 'video' && f.video_url ? 'video' : 'imagem',
      vegetariano: f.vegetariano,
      picancia: f.picancia,
      destaque: f.destaque,
      novo: f.novo,
      ativo: f.ativo,
      ordem: Number(f.ordem) || 0,
      controla_estoque: f.controla_estoque,
      precisa_preparo: f.precisa_preparo,
      estoque_minimo: Math.max(0, Number(f.estoque_minimo) || 0),
    };
    if (produto) {
      const { error } = await supabase.from('produtos').update(dados).eq('id', produto.id);
      const e2 = error ? null : await salvarVinculos(produto.id);
      setSalvando(false);
      if (error || e2) return toast(msgErro(error ?? e2), 'erro');
    } else {
      const { data, error } = await supabase.from('produtos').insert({ ...dados, restaurante_id: restauranteId }).select('id').single();
      if (error) {
        setSalvando(false);
        return toast(msgErro(error), 'erro');
      }
      const inicial = Math.max(0, Math.floor(Number(f.estoque_inicial) || 0));
      if (f.controla_estoque && inicial > 0) {
        await supabase.rpc('estoque_ajustar', { p_produto: data.id, p_delta: inicial, p_motivo: 'Estoque inicial' });
      }
      const e2 = await salvarVinculos(data.id as string);
      setSalvando(false);
      if (e2) toast(`Item salvo, mas os adicionais não foram ligados: ${msgErro(e2)}`, 'erro');
    }
    toast('Produto salvo.', 'ok');
    aoSalvar();
  }

  async function excluir() {
    if (!produto || !(await confirmar(`Excluir "${produto.nome}"?\n\nSe quiser só tirar do tablet por um tempo, use Esgotar ou desligue "Mostrar no tablet".`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('produtos').delete().eq('id', produto.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={produto ? (ehSabor ? 'Editar sabor' : 'Editar produto') : ehSabor ? `Novo sabor · ${grupo?.nome ?? ''}` : 'Novo produto'}
      largura={640}
      rodape={
        <>
          {produto && <button className="btn btn--perigo" style={{ marginRight: 'auto' }} onClick={() => void excluir()}><Trash2 size={16} /> Excluir</button>}
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={salvando || enviandoFoto || enviandoVideo} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <div className="form">
        <div className="foto-editor">
          <FotoProduto p={{ imagem_url: f.imagem_url, emoji: f.emoji || null, nome: f.nome }} />
          <div className="acoes-linha">
            <button className="btn btn--contorno btn--sm" onClick={() => arquivoRef.current?.click()} disabled={enviandoFoto}>
              <ImagePlus size={16} /> {enviandoFoto ? 'Enviando…' : f.imagem_url ? 'Trocar foto' : 'Enviar foto'}
            </button>
            {f.imagem_url && <button className="btn btn--fantasma btn--sm" onClick={() => mudar('imagem_url', null)}>Remover foto</button>}
            <input ref={arquivoRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => void escolherFoto(e.target.files?.[0])} />
          </div>
        </div>

        <div className="midia-editor">
          <span className="midia-editor__rotulo"><Film size={16} /> Vídeo do prato <small>(opcional)</small></span>
          {f.video_url ? (
            <video className="midia-editor__video" src={f.video_url} poster={f.imagem_url ?? undefined} controls muted playsInline preload="metadata" />
          ) : (
            <p className="muted midia-editor__dica">
              MP4, MOV (iPhone), WEBM e outros, até {LIMITE_VIDEO_MB} MB. Vídeos curtos, de 5 a 15 segundos, ficam melhores. No tablet o vídeo toca sozinho, sem som, quando o cliente abre o prato.
            </p>
          )}
          <div className="acoes-linha">
            <button className="btn btn--contorno btn--sm" onClick={() => videoRef.current?.click()} disabled={enviandoVideo}>
              <Film size={16} /> {enviandoVideo ? 'Enviando vídeo…' : f.video_url ? 'Trocar vídeo' : 'Enviar vídeo'}
            </button>
            {f.video_url && <button className="btn btn--fantasma btn--sm" onClick={() => setF((x) => ({ ...x, video_url: null, capa: 'imagem' }))}>Remover vídeo</button>}
            <input ref={videoRef} className="input-arquivo" type="file" accept={ACEITA_VIDEO} onChange={(e) => void escolherVideo(e.target.files?.[0])} />
          </div>
        </div>

        <div className="capa-escolha">
          <span className="midia-editor__rotulo">Capa no cardápio do tablet</span>
          <div className="segmentado" role="radiogroup" aria-label="Capa no cardápio">
            <button type="button" role="radio" aria-checked={f.capa !== 'video'} className={cx(f.capa !== 'video' && 'ativo')} onClick={() => mudar('capa', 'imagem')}>
              <ImagePlus size={16} /> Foto
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={f.capa === 'video'}
              className={cx(f.capa === 'video' && 'ativo')}
              onClick={() => mudar('capa', 'video')}
              disabled={!f.video_url}
              title={f.video_url ? undefined : 'Envie um vídeo para usar como capa'}
            >
              <Film size={16} /> Vídeo
            </button>
          </div>
          <small className="muted">
            {f.capa === 'video' && f.video_url
              ? 'O vídeo roda sozinho no cartão do produto, sem som, assim que o cliente abre o cardápio.'
              : f.video_url
                ? 'A foto aparece no cartão; o vídeo toca quando o cliente abre o produto.'
                : 'Envie um vídeo acima para poder usá-lo como capa.'}
          </small>
        </div>

        <Campo rotulo="Nome"><input className="input" value={f.nome} onChange={(e) => mudar('nome', e.target.value)} maxLength={60} autoFocus={!produto} /></Campo>
        <Campo rotulo="Descrição"><textarea className="textarea" rows={2} value={f.descricao} onChange={(e) => mudar('descricao', e.target.value)} maxLength={240} /></Campo>
        <div className="form-linha">
          <Campo rotulo={ehSabor ? 'Acréscimo (opcional)' : 'Preço (R$)'} dica={ehSabor ? 'Somado ao preço do tamanho. Ex.: 5,00 para sabor especial.' : undefined}>
            <input className="input" inputMode="decimal" value={f.preco} onChange={(e) => mudar('preco', mascaraPreco(e.target.value))} placeholder={ehSabor ? '0,00' : '49,90'} />
          </Campo>
          {!ehSabor && (
            <Campo rotulo="Preço antes (promoção)" dica="Opcional. Ex.: de 59,90 por 49,90. Vazio = sem promoção.">
              <input className="input" inputMode="decimal" value={f.preco_de} onChange={(e) => mudar('preco_de', mascaraPreco(e.target.value))} placeholder="0,00" />
            </Campo>
          )}
          {ehSabor ? (
            <Campo rotulo="Grupo" dica="O preço vem de cada tamanho que usa este grupo.">
              <div className="input input--leitura"><Layers size={16} /> {grupo?.nome ?? 'Grupo de sabores'}</div>
            </Campo>
          ) : (
          <Campo rotulo="Categoria">
            <select
              className="select"
              value={f.categoria_id}
              onChange={(e) => {
                const cat = e.target.value;
                // Em produto novo, acompanha a categoria (bebidas = sem preparo)
                setF((x) => ({ ...x, categoria_id: cat, precisa_preparo: produto ? x.precisa_preparo : !ehBebida(cat) }));
              }}
            >
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>{c.pai_id ? '\u00a0\u00a0\u00a0↳ ' : ''}{c.emoji} {c.nome}</option>
              ))}
            </select>
          </Campo>
          )}
        </div>
        {!ehSabor && (
          <AdicionaisDoProduto
            grupos={gruposAdic}
            vinculados={vinculos}
            aoMudar={setVinculos}
            aoCriar={() => setEditAdic('novo')}
            aoEditar={setEditAdic}
          />
        )}
        {editAdic && (
          <ModalGrupoAdicionais
            restauranteId={restauranteId}
            grupo={editAdic === 'novo' ? null : editAdic}
            usadoEm={editAdic === 'novo' ? [] : nomesDoGrupo(editAdic.id)}
            nomeSugerido={editAdic === 'novo' && /pizza/i.test(f.nome) ? 'Sabores' : undefined}
            aoFechar={() => setEditAdic(null)}
            aoSalvar={(id) => {
              setEditAdic(null);
              void aoRecarregarAdicionais().then((g) => {
                setGruposAdic(g);
                if (id && !g.some((x) => x.id === id)) return;
                if (!id) setVinculos((v) => v.filter((x) => g.some((y) => y.id === x)));
                else setVinculos((v) => (v.includes(id) ? v : [...v, id]));
              });
            }}
          />
        )}
        <div className="form-linha">
          <Campo rotulo="Emoji (sem foto)"><input className="input" value={f.emoji} onChange={(e) => mudar('emoji', e.target.value)} maxLength={4} placeholder="🍕" /></Campo>
          <Campo rotulo="Picância">
            <select className="select" value={f.picancia} onChange={(e) => mudar('picancia', Number(e.target.value))}>
              <option value={0}>Não picante</option>
              <option value={1}>Leve</option>
              <option value={2}>Média</option>
              <option value={3}>Forte</option>
            </select>
          </Campo>
          <Campo rotulo="Ordem"><input className="input" type="number" value={f.ordem} onChange={(e) => mudar('ordem', e.target.value)} /></Campo>
        </div>
        <div className="form-linha">
          <Switch marcado={f.ativo} aoMudar={(v) => mudar('ativo', v)}>Mostrar no tablet</Switch>
          <Switch marcado={esgotado} aoMudar={setEsgotado}>Esgotado</Switch>
          <Switch marcado={f.vegetariano} aoMudar={(v) => mudar('vegetariano', v)}>Vegetariano</Switch>
          <Switch marcado={f.destaque} aoMudar={(v) => mudar('destaque', v)}>Mais pedido</Switch>
          <Switch marcado={f.novo} aoMudar={(v) => mudar('novo', v)}>Novidade</Switch>
        </div>

        <div className="card" style={{ padding: 14, background: 'var(--bg-2)', display: 'grid', gap: 6 }}>
          <Switch marcado={f.precisa_preparo} aoMudar={(v) => mudar('precisa_preparo', v)}>Vai para a cozinha (precisa de preparo)</Switch>
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
            {f.precisa_preparo
              ? 'O pedido passa por “Em preparo” antes de ser servido.'
              : 'Bebida ou item pronto: ao aceitar, o pedido vai direto para “Prontos” para levar à mesa. Em pedidos com comida, ele é separado para não esperar a cozinha.'}
          </p>
        </div>

        <div className="card" style={{ padding: 14, background: 'var(--bg-2)' }}>
          <Switch marcado={f.controla_estoque} aoMudar={(v) => mudar('controla_estoque', v)}>Controlar estoque deste produto</Switch>
          {f.controla_estoque && (
            <div className="form-linha" style={{ marginTop: 12 }}>
              {!produto && (
                <Campo rotulo="Estoque inicial"><input className="input" type="number" min={0} value={f.estoque_inicial} onChange={(e) => mudar('estoque_inicial', e.target.value)} /></Campo>
              )}
              <Campo rotulo="Avisar quando chegar a"><input className="input" type="number" min={0} value={f.estoque_minimo} onChange={(e) => mudar('estoque_minimo', e.target.value)} /></Campo>
              {produto && <p className="muted" style={{ margin: 0, alignSelf: 'end' }}>Estoque atual: <b>{produto.estoque}</b>. Ajuste na tela Estoque.</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
