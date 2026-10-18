import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Clock, ImagePlus, Search, Star, Trash2 } from 'lucide-react';
import { FotoProduto, Switch } from '../../../componentes/Basicos';
import { linkLoja } from '../../../componentes/CardapioDigital';
import { LinkCopiavel, QrCartao } from '../../../componentes/Link';
import { useToast } from '../../../componentes/Toast';
import { useSessao } from '../../../lib/sessao';
import { ACEITA_IMAGEM, enviarImagem, msgErro, supabase } from '../../../lib/supabase';
import type { Categoria, Produto } from '../../../lib/tipos';
import { brl, cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, OpcaoChave, PaginaConfig, mudou, usePasso, type Passo } from './Layout';

const PASSOS: Passo[] = [
  { id: 'configuracoes', rotulo: 'Configurações', dica: 'Configurações do seu cardápio' },
  { id: 'cor', rotulo: 'Cor e capa da loja', dica: 'A cara do seu cardápio digital' },
  { id: 'descricao', rotulo: 'Descrição e rodapé', dica: 'Textos que o cliente lê no cardápio' },
  { id: 'destaques', rotulo: 'Produtos em destaque', dica: 'Aparecem primeiro, na aba “Mais pedidos”' },
  { id: 'esgotados', rotulo: 'Produtos esgotados', dica: 'O que acabou por agora não pode ser pedido' },
  { id: 'link', rotulo: 'Link do cardápio', dica: 'Divulgue no WhatsApp, Instagram e na porta da loja' },
];
const CORES = ['#ff5a1f', '#e63946', '#d6336c', '#7048e8', '#1c7ed6', '#0b7285', '#0ca678', '#5c940d', '#f08c00', '#212529'];

type ProdutoLista = Pick<Produto, 'id' | 'nome' | 'preco' | 'imagem_url' | 'emoji' | 'destaque' | 'esgotado' | 'categoria_id' | 'grupo_id'>;

export default function CardapioDigitalConfig() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [passo, irPasso] = usePasso(PASSOS);
  const capaRef = useRef<HTMLInputElement>(null);
  const inicial = () => ({
    ativo: r.delivery_ativo, obs: r.loja_obs ?? true, cor: r.cor, capa: r.loja_capa_url,
    descricao: r.loja_descricao ?? '', slogan: r.slogan ?? '', rodape: r.loja_rodape ?? '',
  });
  const [base, setBase] = useState(inicial);
  const [f, setF] = useState(base);
  const [salvando, setSalvando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.from('restaurantes').update({
      delivery_ativo: f.ativo, loja_obs: f.obs, cor: f.cor, loja_capa_url: f.capa,
      loja_descricao: f.descricao.trim() || null, slogan: f.slogan.trim() || null, loja_rodape: f.rodape.trim() || null,
    }).eq('id', r.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Cardápio digital atualizado.', 'ok');
    setBase(f);
    void s.recarregar();
  }

  async function enviarCapa(arquivo?: File) {
    if (!arquivo) return;
    try { set('capa', await enviarImagem(r.id, arquivo, 'capa')); } catch (e) { toast(msgErro(e), 'erro'); }
  }

  const previa = (passo.id === 'cor' || passo.id === 'descricao') && (
    <div className="cfg-previa" style={{ '--cor-previa': f.cor } as CSSProperties}>
      <small>Prévia no celular</small>
      <div className="cfg-previa__cel">
        <div className="cfg-previa__capa">{f.capa ? <img src={f.capa} alt="" /> : null}</div>
        <div className="cfg-previa__loja">
          <span className="cfg-previa__logo">{r.logo_url ? <img src={r.logo_url} alt="" /> : r.nome.charAt(0)}</span>
          <strong>{r.nome}</strong>
          <em><Clock size={10} /> {r.delivery_tempo}</em>
        </div>
        {f.descricao && <p className="cfg-previa__desc">{f.descricao}</p>}
        <div className="cfg-previa__abas"><i className="ativa" /><i /><i /></div>
        <div className="cfg-previa__itens">
          {[0, 1, 2].map((i) => <div key={i}><b /><span><i /><i /></span><em>+</em></div>)}
        </div>
        {f.rodape && <p className="cfg-previa__rodape">{f.rodape}</p>}
      </div>
    </div>
  );

  return (
    <PaginaConfig
      titulo="Cardápio Digital"
      passos={PASSOS}
      atual={passo}
      aoPasso={irPasso}
      salvar={['configuracoes', 'cor', 'descricao'].includes(passo.id) || mudou(f, base) ? { sujo: mudou(f, base), salvando, aoSalvar: () => void salvar() } : undefined}
      lateral={previa || undefined}
    >
      {passo.id === 'configuracoes' && (
        <div className="form">
          <OpcaoChave titulo="Cardápio ativado" dica="Você receberá pedidos do cardápio digital." marcado={f.ativo} aoMudar={(v) => set('ativo', v)} />
          <OpcaoChave titulo="Observação do pedido" dica="O campo de observações será exibido no final do pedido e em cada item." marcado={f.obs} aoMudar={(v) => set('obs', v)} />
          {r.horarios_ativos && <p className="cfg-nota">Os horários automáticos estão ligados: mesmo ativado, o cardápio só aceita pedidos dentro do horário (Estabelecimento › Horários).</p>}
        </div>
      )}

      {passo.id === 'cor' && (
        <div className="form">
          <CampoAjuda rotulo="Cor de destaque" ajuda="Botões, categoria ativa e preços usam esta cor.">
            <div className="cores">
              {CORES.map((c) => (
                <button key={c} type="button" className={cx('cor', f.cor === c && 'ativo')} style={{ background: c }} onClick={() => set('cor', c)} aria-label={`Cor ${c}`} />
              ))}
              <span className={cx('cor cor--livre', !CORES.includes(f.cor) && 'ativo')} title="Outra cor" style={{ background: CORES.includes(f.cor) ? undefined : f.cor }}>
                <input type="color" value={f.cor} onChange={(e) => set('cor', e.target.value)} aria-label="Escolher outra cor" />
              </span>
            </div>
          </CampoAjuda>
          <div className="campo cfg-campo">
            <span>Capa da loja</span>
            <div className={cx('cfg-capa', f.capa && 'com-imagem')} onClick={() => !f.capa && capaRef.current?.click()} role={f.capa ? undefined : 'button'}>
              {f.capa ? <img src={f.capa} alt="Capa" /> : <span><ImagePlus size={26} /> Enviar imagem de capa<small>Recomendado: 1200 × 400, foto do salão ou do prato mais famoso</small></span>}
            </div>
            {f.capa && (
              <div className="acoes-linha">
                <button type="button" className="btn btn--contorno btn--sm" onClick={() => capaRef.current?.click()}><ImagePlus size={16} /> Trocar capa</button>
                <button type="button" className="btn btn--fantasma btn--sm" onClick={() => set('capa', null)}><Trash2 size={16} /> Remover</button>
              </div>
            )}
            <input ref={capaRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => { void enviarCapa(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
        </div>
      )}

      {passo.id === 'descricao' && (
        <div className="form">
          <CampoAjuda rotulo="Descrição da loja" ajuda={`Aparece embaixo do nome, no cardápio de delivery. ${f.descricao.length}/300`}>
            <textarea className="textarea" rows={3} maxLength={300} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Pizzas artesanais no forno a lenha desde 2010." />
          </CampoAjuda>
          <CampoAjuda rotulo="Frase de boas-vindas da mesa" ajuda="Aparece no cardápio do tablet/QR code da mesa.">
            <input className="input" maxLength={100} value={f.slogan} onChange={(e) => set('slogan', e.target.value)} placeholder="Ex.: Seja bem-vindo! Peça pelo tablet." />
          </CampoAjuda>
          <CampoAjuda rotulo="Rodapé" ajuda={`Texto no fim do cardápio (ex.: CNPJ, aviso de alergênicos). ${f.rodape.length}/300`}>
            <textarea className="textarea" rows={3} maxLength={300} value={f.rodape} onChange={(e) => set('rodape', e.target.value)} placeholder="Ex.: Imagens ilustrativas. Consulte alergênicos com o atendente." />
          </CampoAjuda>
        </div>
      )}

      {(passo.id === 'destaques' || passo.id === 'esgotados') && <ListaProdutos modo={passo.id} />}

      {passo.id === 'link' && (
        <div className="cfg-link">
          <div className="form">
            <CampoAjuda rotulo="Link do seu cardápio digital" ajuda="Quem abrir este link pede para entrega ou retirada.">
              <LinkCopiavel link={linkLoja(r.codigo)} />
            </CampoAjuda>
            <a className="btn btn--contorno" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`Peça pelo nosso cardápio digital: ${linkLoja(r.codigo)}`)}`}>Enviar pelo WhatsApp</a>
          </div>
          <QrCartao link={linkLoja(r.codigo)} legenda="Aponte a câmera e peça" arquivo={`qr-cardapio-${r.codigo}`} />
        </div>
      )}
    </PaginaConfig>
  );
}

/** Lista de produtos para marcar destaque (estrela) ou esgotado (chave). Salva na hora. */
function ListaProdutos({ modo }: { modo: 'destaques' | 'esgotados' }) {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [produtos, setProdutos] = useState<ProdutoLista[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [busca, setBusca] = useState('');
  const [so, setSo] = useState(true);

  useEffect(() => {
    void Promise.all([
      supabase.from('produtos').select('id, nome, preco, imagem_url, emoji, destaque, esgotado, categoria_id, grupo_id').eq('restaurante_id', r.id).eq('ativo', true).order('nome'),
      supabase.from('categorias').select('*').eq('restaurante_id', r.id).eq('ativo', true),
    ]).then(([p, c]) => { setProdutos((p.data ?? []) as ProdutoLista[]); setCategorias((c.data ?? []) as Categoria[]); });
  }, [r.id]);

  const nomeCat = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias]);
  const marcado = (p: ProdutoLista) => (modo === 'destaques' ? p.destaque : p.esgotado);
  const termo = busca.trim().toLowerCase();
  const lista = (produtos ?? []).filter((p) => (modo === 'destaques' ? !p.grupo_id : true))
    .filter((p) => !termo || p.nome.toLowerCase().includes(termo))
    .filter((p) => !so || termo || marcado(p));
  const qtdMarcados = (produtos ?? []).filter(marcado).length;
  const catsEsgotadas = categorias.filter((c) => c.esgotado);

  async function alternar(p: ProdutoLista, v: boolean) {
    setProdutos((l) => l?.map((x) => (x.id === p.id ? { ...x, [modo === 'destaques' ? 'destaque' : 'esgotado']: v } : x)) ?? null);
    const { error } = modo === 'destaques'
      ? await supabase.from('produtos').update({ destaque: v }).eq('id', p.id)
      : await supabase.rpc('produto_esgotar', { p_produto: p.id, p_esgotado: v });
    if (error) {
      toast(msgErro(error), 'erro');
      setProdutos((l) => l?.map((x) => (x.id === p.id ? { ...x, [modo === 'destaques' ? 'destaque' : 'esgotado']: !v } : x)) ?? null);
    }
  }

  async function reativarCategoria(c: Categoria) {
    const { error } = await supabase.rpc('categoria_esgotar', { p_categoria: c.id, p_esgotado: false });
    if (error) return toast(msgErro(error), 'erro');
    setCategorias((l) => l.map((x) => (x.id === c.id ? { ...x, esgotado: false } : x)));
    toast(`${c.nome} voltou a ser vendida.`, 'ok');
  }

  if (!produtos) return <div className="spinner" style={{ margin: '30px auto' }} />;
  return (
    <div className="cfg-produtos">
      <div className="cfg-produtos__barra">
        <label className="cfg-busca"><Search size={16} /><input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto para marcar…" /></label>
        <div className="segmentado">
          <button type="button" className={cx(so && 'ativo')} onClick={() => setSo(true)}>{modo === 'destaques' ? 'Em destaque' : 'Esgotados'} ({qtdMarcados})</button>
          <button type="button" className={cx(!so && 'ativo')} onClick={() => setSo(false)}>Todos</button>
        </div>
      </div>
      {modo === 'esgotados' && catsEsgotadas.length > 0 && (
        <div className="cfg-produtos__cats">
          {catsEsgotadas.map((c) => (
            <div key={c.id} className="cfg-produto">
              <span className="cfg-produto__foto cfg-produto__foto--cat">{c.emoji ?? '—'}</span>
              <span className="cfg-produto__nome"><strong>{c.nome}</strong><small>Subcategoria inteira esgotada</small></span>
              <button type="button" className="btn btn--contorno btn--sm" onClick={() => void reativarCategoria(c)}>Voltar a vender</button>
            </div>
          ))}
        </div>
      )}
      {lista.length === 0 ? (
        <p className="cfg-vazio">{so && !termo ? (modo === 'destaques' ? 'Nenhum produto em destaque. Toque em “Todos” e marque a estrela.' : 'Nada esgotado agora.') : 'Nenhum produto encontrado.'}</p>
      ) : (
        <ul className="cfg-produtos__lista">
          {lista.map((p) => (
            <li key={p.id} className={cx('cfg-produto', marcado(p) && 'marcado')}>
              <FotoProduto p={p} classe="cfg-produto__foto" />
              <span className="cfg-produto__nome">
                <strong>{p.nome}</strong>
                <small>{p.grupo_id ? 'Sabor' : nomeCat.get(p.categoria_id ?? '') ?? 'Sem categoria'} · {brl(Number(p.preco))}</small>
              </span>
              {modo === 'destaques' ? (
                <button type="button" className={cx('cfg-estrela', p.destaque && 'ativa')} onClick={() => void alternar(p, !p.destaque)} aria-pressed={p.destaque} title={p.destaque ? 'Tirar do destaque' : 'Colocar em destaque'}>
                  <Star size={18} fill={p.destaque ? 'currentColor' : 'none'} />
                </button>
              ) : (
                <Switch marcado={p.esgotado} aoMudar={(v) => void alternar(p, v)}><span className="cfg-produto__chave">{p.esgotado ? 'Esgotado' : 'À venda'}</span></Switch>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
