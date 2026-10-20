import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Search, Star } from 'lucide-react';
import { FotoProduto, Stepper, Switch } from '../../../componentes/Basicos';
import { linkLoja, slugLoja } from '../../../lib/linkCurto';
import { LinkCopiavel, QrCartao } from '../../../componentes/Link';
import { useToast } from '../../../componentes/Toast';
import { useSessao } from '../../../lib/sessao';
import { msgErro, supabase } from '../../../lib/supabase';
import type { Categoria, Produto } from '../../../lib/tipos';
import { brl, cx, lerPreco, mascaraPreco, precoParaTexto } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, OpcaoChave, PaginaConfig, mudou, usePasso, type Passo } from './Layout';

const PASSOS: Passo[] = [
  { id: 'configuracoes', rotulo: 'Configurações', dica: 'Configurações do seu cardápio' },
  { id: 'destaques', rotulo: 'Produtos em destaque', dica: 'Aparecem primeiro, na aba “Mais pedidos”' },
  { id: 'esgotados', rotulo: 'Produtos esgotados', dica: 'O que acabou por agora não pode ser pedido' },
  { id: 'fidelidade', rotulo: 'Cartão fidelidade', dica: 'A cada tantos pedidos, o cliente ganha um prêmio' },
  { id: 'link', rotulo: 'Link do cardápio', dica: 'Divulgue no WhatsApp, Instagram e na porta da loja' },
];

type ProdutoLista = Pick<Produto, 'id' | 'nome' | 'preco' | 'imagem_url' | 'emoji' | 'destaque' | 'esgotado' | 'categoria_id' | 'grupo_id'>;

export default function CardapioDigitalConfig() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [passo, irPasso] = usePasso(PASSOS);
  const inicial = () => ({
    ativo: r.delivery_ativo, obs: r.loja_obs ?? true, cor: r.cor, capa: r.loja_capa_url,
    descricao: r.loja_descricao ?? '', slogan: r.slogan ?? '', rodape: r.loja_rodape ?? '',
    fid_ativo: !!r.fidelidade?.ativo, fid_meta: Number(r.fidelidade?.meta ?? 10), fid_premio: r.fidelidade?.premio ?? '',
    fid_minimo: r.fidelidade?.minimo ? precoParaTexto(Number(r.fidelidade.minimo)) : '',
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
      fidelidade: { ativo: f.fid_ativo, meta: f.fid_meta, premio: f.fid_premio.trim().slice(0, 120), minimo: f.fid_minimo.trim() ? lerPreco(f.fid_minimo) : 0 },
    }).eq('id', r.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Cardápio digital atualizado.', 'ok');
    setBase(f);
    void s.recarregar();
  }

  return (
    <PaginaConfig
      titulo="Cardápio Digital"
      passos={PASSOS}
      atual={passo}
      aoPasso={irPasso}
      salvar={['configuracoes', 'fidelidade'].includes(passo.id) || mudou(f, base) ? { sujo: mudou(f, base), salvando, aoSalvar: () => void salvar() } : undefined}
    >
      {passo.id === 'configuracoes' && (
        <div className="form">
          <OpcaoChave titulo="Cardápio ativado" dica="Você receberá pedidos do cardápio digital." marcado={f.ativo} aoMudar={(v) => set('ativo', v)} />
          <OpcaoChave titulo="Observação do pedido" dica="O campo de observações será exibido no final do pedido e em cada item." marcado={f.obs} aoMudar={(v) => set('obs', v)} />
          <p className="cfg-nota">Logo, cor, capa (vídeo ou foto) e textos ficam em <Link to="/painel/cardapio/aparencia"><b>Gestor de cardápio › Aparência do cardápio</b></Link>.</p>
          {r.horarios_ativos && <p className="cfg-nota">Os horários automáticos estão ligados: mesmo ativado, o cardápio só aceita pedidos dentro do horário (Estabelecimento › Horários).</p>}
        </div>
      )}

      {(passo.id === 'destaques' || passo.id === 'esgotados') && <ListaProdutos modo={passo.id} />}

      {passo.id === 'fidelidade' && (
        <div className="form">
          <OpcaoChave titulo="Cartão fidelidade ligado" dica="Aparece na aba “Fidelidade” do cardápio digital. Conta os pedidos pelo WhatsApp do cliente." marcado={f.fid_ativo} aoMudar={(v) => set('fid_ativo', v)} />
          <div className={cx('cfg-linha', !f.fid_ativo && 'cfg-apagado')}>
            <CampoAjuda rotulo="A cada quantos pedidos?" ajuda="Ex.: 10 pedidos = 1 prêmio.">
              <Stepper valor={f.fid_meta} min={2} max={30} aoMudar={(v) => set('fid_meta', v)} />
            </CampoAjuda>
            <CampoAjuda rotulo="Valor mínimo do pedido (R$)" ajuda="Pedidos abaixo disso não contam. Vazio = todos contam.">
              <input className="input" inputMode="decimal" value={f.fid_minimo} onChange={(e) => set('fid_minimo', mascaraPreco(e.target.value))} placeholder="0,00" />
            </CampoAjuda>
          </div>
          <CampoAjuda rotulo="Prêmio" ajuda="O que o cliente ganha ao completar o cartão. Você entrega e marca em Configurações › Meus clientes.">
            <input className="input" value={f.fid_premio} maxLength={120} onChange={(e) => set('fid_premio', e.target.value)} placeholder="Ex.: Uma pizza broto grátis" />
          </CampoAjuda>
        </div>
      )}

      {passo.id === 'link' && (
        <div className="cfg-link">
          <div className="form">
            <EnderecoCardapio />
            <CampoAjuda rotulo="Link do seu cardápio digital" ajuda="Quem abrir este link pede para entrega ou retirada.">
              <LinkCopiavel link={linkLoja(r)} />
            </CampoAjuda>
            <a className="btn btn--contorno" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`Peça pelo nosso cardápio digital: ${linkLoja(r)}`)}`}>Enviar pelo WhatsApp</a>
          </div>
          <QrCartao link={linkLoja(r)} legenda="Aponte a câmera e peça" arquivo={`qr-cardapio-${r.codigo}`} />
        </div>
      )}
    </PaginaConfig>
  );
}

/** Endereço curto do cardápio: basilfiery.com.br/<slug> (e /<slug>/mesa1 nas mesas) */
function EnderecoCardapio() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [slug, setSlug] = useState(r.slug);
  const [salvando, setSalvando] = useState(false);
  const limpo = slug.replace(/-+$/, '');
  const alterado = limpo !== r.slug;

  async function salvar() {
    if (limpo.length < 3) return toast('Use pelo menos 3 letras ou números.', 'erro');
    setSalvando(true);
    const { error } = await supabase.from('restaurantes').update({ slug: limpo }).eq('id', r.id);
    setSalvando(false);
    if (error) {
      if (error.code === '23505') return toast('Esse endereço já é de outra loja. Tente outro.', 'erro');
      if (error.code === '23514') return toast('Esse endereço é reservado pelo sistema. Tente outro.', 'erro');
      return toast(msgErro(error), 'erro');
    }
    setSlug(limpo);
    await s.recarregar();
    toast('Endereço do cardápio atualizado.', 'ok');
  }

  return (
    <CampoAjuda rotulo="Endereço do cardápio" ajuda={`As mesas usam o mesmo endereço: ${window.location.host}/${limpo || 'sua-loja'}/mesa1. Ao trocar, QR codes já impressos param de funcionar.`}>
      <div className="cfg-endereco">
        <label className="cfg-endereco__campo">
          <span>{window.location.host}/</span>
          <input value={slug} maxLength={40} onChange={(e) => setSlug(slugLoja(e.target.value))} placeholder="sua-loja" spellCheck={false} autoCapitalize="none" aria-label="Endereço do cardápio" />
        </label>
        <button className="btn btn--primario" disabled={!alterado || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </CampoAjuda>
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
