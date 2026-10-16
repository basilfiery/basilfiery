import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, ImagePlus, Pencil, Plus, Trash2, UtensilsCrossed } from 'lucide-react';
import { Campo, FotoProduto, Switch, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { ACEITA_IMAGEM, ACEITA_VIDEO, LIMITE_VIDEO_MB, enviarImagem, enviarVideo, msgErro, supabase } from '../../lib/supabase';
import type { Categoria, Produto } from '../../lib/tipos';
import { brl, cx, lerPreco, ordenarNome, precoParaTexto } from '../../lib/util';
import { usePainel } from './Painel';

export default function Cardapio() {
  const { restaurante } = usePainel();
  const toast = useToast();
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [catSel, setCatSel] = useState<string>('');
  const [busca, setBusca] = useState('');
  const [editCat, setEditCat] = useState<Categoria | 'nova' | null>(null);
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

  const termo = busca.trim().toLowerCase();
  const visiveis = produtos.filter((p) =>
    (!catSel || p.categoria_id === catSel) && (!termo || p.nome.toLowerCase().includes(termo)));
  const nomeCat = (id: string | null) => categorias.find((c) => c.id === id)?.nome ?? 'Sem categoria';

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
            {categorias.map((c) => (
              <div key={c.id} className={cx('cat-item', catSel === c.id && 'ativo', !c.ativo && 'cat-item--inativa')} role="button" tabIndex={0}
                onClick={() => setCatSel(c.id)} onKeyDown={(e) => e.key === 'Enter' && setCatSel(c.id)}>
                <span>{c.emoji} {c.nome}</span>
                <span className="contagem">{produtos.filter((p) => p.categoria_id === c.id).length}</span>
                <button className="icone-btn" style={{ width: 30, height: 30 }} onClick={(e) => { e.stopPropagation(); setEditCat(c); }} aria-label={`Editar ${c.nome}`}>
                  <Pencil size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btn--contorno btn--sm btn--bloco" style={{ marginTop: 12 }} onClick={() => setEditCat('nova')}>
            <Plus size={16} /> Nova categoria
          </button>
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
                      <td className="num">{brl(p.preco)}</td>
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
          proximaOrdem={Math.max(0, ...categorias.map((c) => c.ordem)) + 1}
          aoFechar={() => setEditCat(null)}
          aoSalvar={() => { setEditCat(null); void carregar(); }}
        />
      )}
      {editProd && (
        <ModalProduto
          restauranteId={restaurante.id}
          produto={editProd === 'novo' ? null : editProd}
          categorias={categorias}
          categoriaPadrao={catSel || categorias[0]?.id}
          aoFechar={() => setEditProd(null)}
          aoSalvar={() => { setEditProd(null); void carregar(); }}
        />
      )}
    </div>
  );
}

function ModalCategoria({ restauranteId, categoria, proximaOrdem, aoFechar, aoSalvar }: {
  restauranteId: string;
  categoria: Categoria | null;
  proximaOrdem: number;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [emoji, setEmoji] = useState(categoria?.emoji ?? '');
  const [ordem, setOrdem] = useState(String(categoria?.ordem ?? proximaOrdem));
  const [ativo, setAtivo] = useState(categoria?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    const dados = { nome: nome.trim(), emoji: emoji.trim() || null, ordem: Number(ordem) || 0, ativo };
    const { error } = categoria
      ? await supabase.from('categorias').update(dados).eq('id', categoria.id)
      : await supabase.from('categorias').insert({ ...dados, restaurante_id: restauranteId });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  async function excluir() {
    if (!categoria || !confirm(`Excluir a categoria "${categoria.nome}"? Os produtos dela ficam sem categoria e somem do tablet até você movê-los.`)) return;
    const { error } = await supabase.from('categorias').delete().eq('id', categoria.id);
    if (error) return toast(msgErro(error), 'erro');
    aoSalvar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={categoria ? 'Editar categoria' : 'Nova categoria'}
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
        <Campo rotulo="Ordem" dica="Menor aparece primeiro no tablet"><input className="input" type="number" value={ordem} onChange={(e) => setOrdem(e.target.value)} /></Campo>
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
  const ehBebida = (catId: string) =>
    /bebida|drink|refri|cerveja|suco|vinho|dose/i.test(categorias.find((c) => c.id === catId)?.nome ?? '');
  const [f, setF] = useState({
    precisa_preparo: produto?.precisa_preparo ?? !ehBebida(produto?.categoria_id ?? categoriaPadrao ?? ''),
    nome: produto?.nome ?? '',
    descricao: produto?.descricao ?? '',
    preco: produto ? precoParaTexto(produto.preco) : '',
    categoria_id: produto?.categoria_id ?? categoriaPadrao ?? '',
    emoji: produto?.emoji ?? '',
    imagem_url: produto?.imagem_url ?? null as string | null,
    video_url: produto?.video_url ?? null as string | null,
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
      mudar('video_url', await enviarVideo(restauranteId, arquivo, 'videos'));
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
            {f.video_url && <button className="btn btn--fantasma btn--sm" onClick={() => mudar('video_url', null)}>Remover vídeo</button>}
            <input ref={videoRef} className="input-arquivo" type="file" accept={ACEITA_VIDEO} onChange={(e) => void escolherVideo(e.target.files?.[0])} />
          </div>
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
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.nome}</option>)}
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
