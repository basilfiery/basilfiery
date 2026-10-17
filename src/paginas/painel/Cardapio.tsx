import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CornerDownRight, Film, GripVertical, ImagePlus, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { Campo, FotoProduto, Switch, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { ACEITA_IMAGEM, ACEITA_VIDEO, LIMITE_VIDEO_MB, enviarImagem, enviarVideo, msgErro, supabase } from '../../lib/supabase';
import type { Categoria, Produto } from '../../lib/tipos';
import { cx, lerPreco, ordenarNome, precoParaTexto } from '../../lib/util';
import { usePainel } from './Painel';

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

  const carregar = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from('categorias').select('*').eq('restaurante_id', restaurante.id),
      supabase.from('produtos').select('*').eq('restaurante_id', restaurante.id),
    ]);
    if (c.error || p.error) toast(msgErro(c.error ?? p.error), 'erro');
    setCategorias(((c.data ?? []) as Categoria[]).sort(ordenarNome));
    setProdutos(((p.data ?? []) as Produto[]).sort(ordenarNome));
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

  /* ---------- Arrastar categorias para mudar a ordem (igual à do tablet) ---------- */
  // Estado para o visual + ref para a lógica (a ref já vale no evento seguinte, mesmo num arrasto rápido)
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<{ id: string; depois: boolean } | null>(null);
  const arrastandoRef = useRef<string | null>(null);
  const alvoRef = useRef<{ id: string; depois: boolean } | null>(null);
  const limparArrasto = () => {
    arrastandoRef.current = null;
    alvoRef.current = null;
    setArrastando(null);
    setAlvo(null);
  };

  async function moverCategoria(origemId: string, destinoId: string, depois: boolean) {
    if (origemId === destinoId) return;
    const origem = categorias.find((c) => c.id === origemId);
    if (!origem) return;
    // A ordem vale entre "irmãs": principais entre si, subcategorias dentro da mesma mãe
    const lista = categorias.filter((c) => c.id !== origemId && c.pai_id === origem.pai_id);
    const idx = lista.findIndex((c) => c.id === destinoId);
    if (idx < 0) return;
    lista.splice(depois ? idx + 1 : idx, 0, origem);
    const novas = lista.map((c, i) => ({ ...c, ordem: i + 1 }));
    const mudaram = novas.filter((c) => categorias.find((x) => x.id === c.id)?.ordem !== c.ordem);
    setCategorias((todas) => todas.map((c) => novas.find((n) => n.id === c.id) ?? c).sort(ordenarNome));
    const resultados = await Promise.all(mudaram.map((c) => supabase.from('categorias').update({ ordem: c.ordem }).eq('id', c.id)));
    const falha = resultados.find((r) => r.error);
    if (falha) {
      toast(msgErro(falha.error), 'erro');
      void carregar();
    } else {
      toast('Ordem do cardápio salva. Os tablets atualizam em até 1 minuto.', 'ok');
    }
  }

  const termo = busca.trim().toLowerCase();
  // Árvore: principais na ordem, cada uma seguida das suas subcategorias
  const principais = categorias.filter((c) => !c.pai_id || !categorias.some((x) => x.id === c.pai_id));
  const filhasDe = (id: string) => categorias.filter((c) => c.pai_id === id);
  const arvore = principais.flatMap((c) => [c, ...filhasDe(c.id)]);
  const ordemCat = new Map(arvore.map((c, i) => [c.id, i]));
  const idsDe = (id: string) => [id, ...filhasDe(id).map((c) => c.id)];
  const contagem = (id: string) => produtos.filter((p) => p.categoria_id && idsDe(id).includes(p.categoria_id)).length;
  const selecionadas = catSel ? idsDe(catSel) : [];
  const catSelecionada = categorias.find((c) => c.id === catSel);
  const visiveis = produtos
    .filter((p) => (!catSel || selecionadas.includes(p.categoria_id ?? '')) && (!termo || p.nome.toLowerCase().includes(termo)))
    // Em "Todos os produtos", segue a ordem das categorias (como no tablet)
    .sort((a, b) => (ordemCat.get(a.categoria_id ?? '') ?? 999) - (ordemCat.get(b.categoria_id ?? '') ?? 999) || ordenarNome(a, b));
  const nomeCat = (id: string | null) => {
    const c = categorias.find((x) => x.id === id);
    if (!c) return 'Sem categoria';
    const pai = categorias.find((x) => x.id === c.pai_id);
    return pai ? `${pai.nome} › ${c.nome}` : c.nome;
  };

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Cardápio</h1>
          <p>O que você mudar aqui aparece nos tablets em até 1 minuto.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setEditProd('novo')} disabled={!categorias.length}>
          <Plus size={18} /> Novo produto
        </button>
      </div>

      <div className="cardapio">
        <aside className="card">
          <h2 className="card__titulo">Categorias</h2>
          <div className="cats-lista">
            <button className={cx('cat-item', !catSel && 'ativo')} onClick={() => setCatSel('')}>
              <span>Todos os produtos</span><span className="contagem">{produtos.length}</span>
            </button>
            {arvore.map((c) => (
              <div
                key={c.id}
                className={cx(
                  'cat-item', c.pai_id && 'cat-item--sub', catSel === c.id && 'ativo', !c.ativo && 'cat-item--inativa',
                  arrastando === c.id && 'arrastando',
                  alvo?.id === c.id && arrastando !== c.id && (alvo.depois ? 'alvo-depois' : 'alvo-antes'),
                )}
                role="button"
                tabIndex={0}
                draggable
                onClick={() => setCatSel(c.id)}
                onKeyDown={(e) => e.key === 'Enter' && setCatSel(c.id)}
                onDragStart={(e) => {
                  arrastandoRef.current = c.id;
                  setArrastando(c.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', c.id);
                }}
                onDragOver={(e) => {
                  if (!arrastandoRef.current) return;
                  // Só reordena entre irmãs (não muda a categoria de lugar na árvore)
                  if (categorias.find((x) => x.id === arrastandoRef.current)?.pai_id !== c.pai_id) return;
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  const novo = { id: c.id, depois: e.clientY > r.top + r.height / 2 };
                  alvoRef.current = novo;
                  setAlvo(novo);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const origem = arrastandoRef.current;
                  const destino = alvoRef.current;
                  if (origem && destino) void moverCategoria(origem, destino.id, destino.depois);
                  limparArrasto();
                }}
                onDragEnd={limparArrasto}
                title="Arraste para mudar a ordem"
              >
                <GripVertical size={16} className="cat-item__alca" aria-hidden="true" />
                {c.pai_id && <CornerDownRight size={14} className="cat-item__seta" aria-hidden="true" />}
                <span>{c.emoji} {c.nome}</span>
                <span className="contagem">{contagem(c.id)}</span>
                <button className="icone-btn" style={{ width: 30, height: 30 }} onClick={(e) => { e.stopPropagation(); setEditCat(c); }} aria-label={`Editar ${c.nome}`}>
                  <Pencil size={14} />
                </button>
              </div>
            ))}
          </div>
          {categorias.length > 1 && <p className="cats-dica">Arraste pela alça <GripVertical size={13} /> para mudar a ordem no tablet.</p>}
          <button className="btn btn--contorno btn--sm btn--bloco" style={{ marginTop: 12 }} onClick={() => { setNovaPai(null); setEditCat('nova'); }}>
            <Plus size={16} /> Nova categoria
          </button>
          {catSelecionada && !catSelecionada.pai_id && (
            <button className="btn btn--fantasma btn--sm btn--bloco" style={{ marginTop: 6 }} onClick={() => { setNovaPai(catSelecionada.id); setEditCat('nova'); }}>
              <CornerDownRight size={16} /> Subcategoria em {catSelecionada.nome}
            </button>
          )}
        </aside>

        <section className="pagina" style={{ gap: 12 }}>
          <input className="input" placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          {categorias.length === 0 ? (
            <Vazio icone={<UtensilsCrossed size={36} />} titulo="Comece criando uma categoria">Ex.: Entradas, Pizzas, Bebidas.</Vazio>
          ) : visiveis.length === 0 ? (
            <Vazio icone={<UtensilsCrossed size={36} />} titulo="Nenhum produto aqui" />
          ) : (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr><th>Produto</th><th className="num">Preço</th><th>No tablet</th><th /></tr>
                </thead>
                <tbody>
                  {visiveis.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="prod-linha">
                          <FotoProduto p={p} />
                          <div>
                            <strong>{p.nome}</strong>
                            <small>
                              {nomeCat(p.categoria_id)}
                              {p.video_url && ' · 🎬 vídeo'}
                              {p.controla_estoque && ` · estoque ${p.estoque}`}
                              {p.vegetariano && ' · 🌿'}
                              {!p.precisa_preparo && ' · sem preparo'}
                              {p.picancia > 0 && ` · ${'🌶️'.repeat(p.picancia)}`}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="num">
                        <PrecoEditavel
                          produto={p}
                          aoSalvar={(preco) => setProdutos((l) => l.map((x) => (x.id === p.id ? { ...x, preco } : x)))}
                        />
                      </td>
                      <td><Switch marcado={p.ativo} aoMudar={(v) => void alternarAtivo(p, v)} /></td>
                      <td className="num">
                        <button className="icone-btn" onClick={() => setEditProd(p)} aria-label={`Editar ${p.nome}`}><Pencil size={18} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
          categoriaPadrao={catSel || arvore[0]?.id}
          aoFechar={() => setEditProd(null)}
          aoSalvar={() => { setEditProd(null); void carregar(); }}
        />
      )}
    </div>
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
        onChange={(e) => setTexto(e.target.value)}
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
  const [ordem, setOrdem] = useState(String(categoria?.ordem ?? proximaOrdem(paiInicial)));
  const [ativo, setAtivo] = useState(categoria?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const temFilhas = !!categoria && categorias.some((c) => c.pai_id === categoria.id);
  const opcoesPai = categorias.filter((c) => !c.pai_id && c.id !== categoria?.id);

  function mudarPai(novo: string) {
    setPai(novo);
    // Ao mudar de lugar, vai para o fim da lista nova
    if ((categoria?.pai_id ?? '') !== novo) setOrdem(String(proximaOrdem(novo || null)));
    else if (categoria) setOrdem(String(categoria.ordem));
  }

  async function salvar() {
    setSalvando(true);
    const dados = { nome: nome.trim(), emoji: emoji.trim() || null, ordem: Number(ordem) || 0, ativo, pai_id: pai || null };
    const { error } = categoria
      ? await supabase.from('categorias').update(dados).eq('id', categoria.id)
      : await supabase.from('categorias').insert({ ...dados, restaurante_id: restauranteId });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  async function excluir() {
    const aviso = temFilhas ? ' As subcategorias dela viram categorias principais.' : '';
    if (!categoria || !confirm(`Excluir a categoria "${categoria.nome}"? Os produtos dela ficam sem categoria e somem do tablet até você movê-los.${aviso}`)) return;
    const { error } = await supabase.from('categorias').delete().eq('id', categoria.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={categoria ? 'Editar categoria' : pai ? 'Nova subcategoria' : 'Nova categoria'}
      rodape={
        <>
          {categoria && <button className="btn btn--perigo" style={{ marginRight: 'auto' }} onClick={() => void excluir()}><Trash2 size={16} /> Excluir</button>}
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={!nome.trim() || salvando} onClick={() => void salvar()}>Salvar</button>
        </>
      }
    >
      <div className="form">
        <div className="form-linha">
          <Campo rotulo="Nome"><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} autoFocus /></Campo>
          <Campo rotulo="Emoji" dica="Opcional. Ex.: 🍕"><input className="input" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} /></Campo>
        </div>
        <Campo
          rotulo="Fica dentro de"
          dica={temFilhas
            ? 'Esta categoria já tem subcategorias, por isso fica como principal.'
            : 'Ex.: “Pratos” e “Porções” dentro de “Comida”. No tablet aparecem agrupadas.'}
        >
          <select className="select" value={pai} onChange={(e) => mudarPai(e.target.value)} disabled={temFilhas}>
            <option value="">Nenhuma (categoria principal)</option>
            {opcoesPai.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Ordem" dica={pai ? 'Ordem dentro da categoria principal' : 'Menor aparece primeiro no tablet'}><input className="input" type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} /></Campo>
        <Switch marcado={ativo} aoMudar={setAtivo}>Mostrar no tablet</Switch>
      </div>
    </Modal>
  );
}

function ModalProduto({ restauranteId, produto, categorias, categoriaPadrao, aoFechar, aoSalvar }: {
  restauranteId: string;
  produto: Produto | null;
  categorias: Categoria[];
  categoriaPadrao?: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
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
    const preco = lerPreco(f.preco);
    if (!f.nome.trim()) return toast('Informe o nome.', 'erro');
    if (!Number.isFinite(preco) || preco < 0) return toast('Preço inválido. Ex.: 49,90', 'erro');
    setSalvando(true);
    const dados = {
      nome: f.nome.trim(),
      descricao: f.descricao.trim(),
      preco,
      categoria_id: f.categoria_id || null,
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
      setSalvando(false);
      if (error) return toast(msgErro(error), 'erro');
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
      setSalvando(false);
    }
    toast('Produto salvo.', 'ok');
    aoSalvar();
  }

  async function excluir() {
    if (!produto || !confirm(`Excluir "${produto.nome}"? Se quiser só tirar do tablet, desligue "Mostrar no tablet".`)) return;
    const { error } = await supabase.from('produtos').delete().eq('id', produto.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={produto ? 'Editar produto' : 'Novo produto'}
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
          <Campo rotulo="Preço (R$)"><input className="input" inputMode="decimal" value={f.preco} onChange={(e) => mudar('preco', e.target.value)} placeholder="49,90" /></Campo>
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
        </div>
        <div className="form-linha">
          <Campo rotulo="Emoji (sem foto)"><input className="input" value={f.emoji} onChange={(e) => mudar('emoji', e.target.value)} maxLength={4} placeholder="🍕" /></Campo>
          <Campo rotulo="Picância">
            <select className="select" value={f.picancia} onChange={(e) => mudar('picancia', Number(e.target.value))}>
              <option value={0}>Não picante</option>
              <option value={1}>🌶️ Leve</option>
              <option value={2}>🌶️🌶️ Média</option>
              <option value={3}>🌶️🌶️🌶️ Forte</option>
            </select>
          </Campo>
          <Campo rotulo="Ordem"><input className="input" type="number" value={f.ordem} onChange={(e) => mudar('ordem', e.target.value)} /></Campo>
        </div>
        <div className="form-linha">
          <Switch marcado={f.ativo} aoMudar={(v) => mudar('ativo', v)}>Mostrar no tablet</Switch>
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
