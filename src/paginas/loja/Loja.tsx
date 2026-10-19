import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactElement } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AtSign, BadgePercent, Ban, Banknote, Bike, Gift, House, Info, ReceiptText, RotateCcw, UserRound, Check, Clock, CreditCard, MapPin, MessageCircle, Play, Plus, Receipt, ShoppingBag, Star, Store, Trash2, UtensilsCrossed,
} from 'lucide-react';
import { FotoProduto, Selos, Stepper, VideoCapa } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { useAppInstalavel } from '../../lib/manifesto';
import { msgErro, supabase } from '../../lib/supabase';
import { brl, cx, hora, lerPreco, ls, mascaraPreco, useAgora } from '../../lib/util';
import { CapaCardapio, ModalProduto, capaEmVideo, juntarNoCarrinho, nomeItem, precoLinha, type AdicionaisEscolhidos, type Linha, type CategoriaMesa, type ProdutoMesa, type SaborMesa } from '../mesa/Mesa';
import { calcularAdicionais, gruposDoProduto, type GrupoAdicionalMesa } from '../../lib/adicionais';
import { supabaseCliente, useContaCliente, type ContaCliente } from '../../lib/contaCliente';
import { ModalConta } from './ContaCliente';
import { destravarSom, tocarEnviado } from '../../lib/som';
import { fraseCancelamento } from '../../lib/cancelamento';
import { useCardapioAoVivo } from '../../lib/cardapioAoVivo';
import { buscarEndereco, distanciaKm, minhaLocalizacao, taxaPorRaio, type FaixaRaio, type Ponto } from '../../lib/mapa';
import '../../estilos/mesa.css';
import '../../estilos/loja.css';

/* =====================================================================
   Cardápio digital para DELIVERY: /loja/<codigo>
   Mesmo visual do cardápio da mesa; no fim, entrega ou retirada.
   ===================================================================== */

interface Loja {
  id: string; nome: string; slogan: string | null; logo_url: string | null; cor: string;
  aberto: boolean; taxa: number; minimo: number; tempo: string; retirada: boolean; whatsapp: string | null; endereco: string | null;
  /** Chave "Cardápio ativado" (aberto = ligado e dentro do horário) */
  ligado?: boolean; entrega?: boolean; segmento?: string | null; instagram?: string | null; mapa_url?: string | null; capa_url?: string | null; capa_video_url?: string | null;
  descricao?: string | null; rodape?: string | null; obs?: boolean; formas?: Forma[];
  horarios?: { aberto: boolean; de: string; ate: string }[] | null;
  ads?: { pixel?: string; ga4?: string; gads?: string };
  fidelidade?: { meta: number; premio: string | null; minimo: number } | null;
  /** Taxa: fixa, por distância (raio) ou por bairro */
  entrega_modo?: 'fixa' | 'raio' | 'bairro'; lat?: number | null; lng?: number | null; cidade?: string | null;
  raios?: FaixaRaio[] | null; bairros?: { nome: string; taxa: number }[] | null;
}

/** "Entrega R$ 5" / "a partir de R$ 3" / "grátis" para o topo e a sacola. */
function rotuloEntrega(l: Loja) {
  const valores = l.entrega_modo === 'raio' ? (l.raios ?? []).map((x) => Number(x.taxa))
    : l.entrega_modo === 'bairro' ? (l.bairros ?? []).map((x) => Number(x.taxa)) : [Number(l.taxa)];
  const menor = valores.length ? Math.min(...valores) : 0;
  if (l.entrega_modo === 'raio' || l.entrega_modo === 'bairro') return menor > 0 ? `Entrega a partir de ${brl(menor)}` : 'Entrega grátis em parte da cidade';
  return menor > 0 ? `Entrega ${brl(menor)}` : 'Entrega grátis';
}

type AbaLoja = 'inicio' | 'promocoes' | 'fidelidade' | 'pedidos';
const ABAS_LOJA: { id: AbaLoja; rotulo: string }[] = [
  { id: 'inicio', rotulo: 'Início' }, { id: 'promocoes', rotulo: 'Promoções' },
  { id: 'fidelidade', rotulo: 'Fidelidade' }, { id: 'pedidos', rotulo: 'Pedidos' },
];
const iconeAba = (id: AbaLoja, n = 22) =>
  id === 'inicio' ? <House size={n} /> : id === 'promocoes' ? <BadgePercent size={n} /> : id === 'fidelidade' ? <Gift size={n} /> : <ReceiptText size={n} />;

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Quando a loja abre de novo (pelos horários cadastrados). */
function dataAbertura(h: NonNullable<Loja['horarios']>, agora = new Date()): Date | null {
  for (let i = 0; i < 8; i++) {
    const dia = new Date(agora);
    dia.setDate(agora.getDate() + i);
    const x = h[dia.getDay()];
    if (!x?.aberto || !/^\d{1,2}:\d{2}/.test(x.de)) continue;
    const [hh, mm] = x.de.split(':').map(Number);
    dia.setHours(hh, mm, 0, 0);
    if (dia.getTime() > agora.getTime()) return dia;
  }
  return null;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** "Abre hoje às 18:00", "Abre amanhã às 18:00", "Abre sexta às 18:00" */
function proximaAbertura(h: NonNullable<Loja['horarios']>): string | null {
  const agora = new Date();
  const d = dataAbertura(h, agora);
  if (!d) return null;
  const dias = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(agora).setHours(0, 0, 0, 0)) / 864e5);
  return dias === 0 ? `Abre hoje às ${hhmm(d)}` : dias === 1 ? `Abre amanhã às ${hhmm(d)}` : `Abre ${DIAS[d.getDay()]} às ${hhmm(d)}`;
}

/** Cabeçalho da loja fechada: "Abre às 18:00 · faltam 45 min" (atualiza sozinho). */
function StatusLoja({ loja }: { loja: Loja }) {
  const agora = useAgora(20000);
  if (loja.aberto) return <span className="loja-status aberta">Aberto agora</span>;
  const d = loja.ligado && loja.horarios ? dataAbertura(loja.horarios, new Date(agora)) : null;
  if (!d) return <span className="loja-status fechada">Fechado agora</span>;
  const min = Math.max(1, Math.ceil((d.getTime() - agora) / 60000));
  const amanha = new Date(d).setHours(0, 0, 0, 0) !== new Date(agora).setHours(0, 0, 0, 0);
  const falta = min < 60 ? `${min} min` : min < 24 * 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ''}` : null;
  return (
    <>
      <span className="loja-status fechada">Fechado agora</span>
      <small className="loja-status__abre">
        Abre {amanha ? (falta ? 'amanhã ' : `${DIAS[d.getDay()]} `) : ''}às {hhmm(d)}{falta && <> · <b>faltam {falta}</b></>}
      </small>
    </>
  );
}

/* ---------- Anúncios: Pixel do Facebook, Google Analytics 4 e Google Ads ---------- */
type Janela = Window & { fbq?: any; _fbq?: any; gtag?: any; dataLayer?: unknown[] };
function iniciarAnuncios(ads: Loja['ads']) {
  const w = window as Janela;
  if (ads?.pixel && /^\d{5,20}$/.test(ads.pixel) && !w.fbq) {
        const f: any = function (...a: unknown[]) { if (f.callMethod) f.callMethod(...a); else f.queue.push(a); };
    f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    w.fbq = f; w._fbq = f;
    const sc = document.createElement('script');
    sc.async = true; sc.src = 'https://connect.facebook.net/en_US/fbevents.js';
    document.head.appendChild(sc);
    w.fbq('init', ads.pixel);
    w.fbq('track', 'PageView');
  }
  const ga4 = ads?.ga4 && /^G-[A-Z0-9]{4,15}$/.test(ads.ga4) ? ads.ga4 : '';
  const gads = ads?.gads && /^AW-\d{5,15}$/.test(ads.gads) ? ads.gads : '';
  if ((ga4 || gads) && !w.gtag) {
    w.dataLayer = w.dataLayer || [];
    // O gtag precisa receber o objeto "arguments" (não um array)
    w.gtag = function () { (w.dataLayer as unknown[]).push(arguments); }; // eslint-disable-line prefer-rest-params
    const sc = document.createElement('script');
    sc.async = true; sc.src = `https://www.googletagmanager.com/gtag/js?id=${ga4 || gads}`;
    document.head.appendChild(sc);
    w.gtag('js', new Date());
    if (ga4) w.gtag('config', ga4);
    if (gads) w.gtag('config', gads);
  }
}
function rastrear(evento: 'AddToCart' | 'InitiateCheckout' | 'Purchase', valor: number, id?: string) {
  const w = window as Janela;
  const dados = { value: Number(valor.toFixed(2)), currency: 'BRL' };
  if (w.fbq) w.fbq('track', evento, dados, id ? { eventID: id } : undefined);
  if (w.gtag) {
    const ga = { AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', Purchase: 'purchase' }[evento];
    w.gtag('event', ga, { ...dados, ...(id ? { transaction_id: id } : {}) });
  }
}
interface Dados {
  restaurante: Loja; categorias: CategoriaMesa[]; produtos: ProdutoMesa[]; sabores?: SaborMesa[];
  adicionais_grupos?: GrupoAdicionalMesa[]; produto_grupos?: Record<string, string[]>;
}
interface Cliente {
  nome: string; telefone: string;
  endereco: { rua: string; numero: string; bairro: string; complemento: string; referencia: string };
}
type Forma = 'pix' | 'dinheiro' | 'credito' | 'debito';

const DESTAQUES = '__destaques';
const OUTRAS = '__outras';
const CLIENTE_VAZIO: Cliente = { nome: '', telefone: '', endereco: { rua: '', numero: '', bairro: '', complemento: '', referencia: '' } };
const FORMAS: { id: Forma; rotulo: string; icone: ReactElement }[] = [
  { id: 'pix', rotulo: 'Pix', icone: <span className="loja-pix">◆</span> },
  { id: 'dinheiro', rotulo: 'Dinheiro', icone: <Banknote size={18} /> },
  { id: 'credito', rotulo: 'Crédito', icone: <CreditCard size={18} /> },
  { id: 'debito', rotulo: 'Débito', icone: <CreditCard size={18} /> },
];
const telefoneFormatado = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
};

function useAlturaTela() {
  useEffect(() => {
    const aplicar = () => document.documentElement.style.setProperty('--altura-tela', `${window.innerHeight}px`);
    aplicar();
    window.addEventListener('resize', aplicar);
    return () => window.removeEventListener('resize', aplicar);
  }, []);
}

export default function LojaCardapio() {
  const { codigo = '' } = useParams();
  const navegar = useNavigate();
  const toast = useToast();
  useAlturaTela();
  const [verSobre, setVerSobre] = useState(false);
  const conta = useContaCliente();
  const [verConta, setVerConta] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [carrinho, setCarrinho] = useState<Linha[]>(() => ls.ler(`bf:loja:carrinho:${codigo}`, []));
  const [catAtiva, setCatAtiva] = useState('');
  const [subAtiva, setSubAtiva] = useState('');
  const [produtoAberto, setProdutoAberto] = useState<ProdutoMesa | null>(null);
  const [verCarrinho, setVerCarrinho] = useState(false);
  const [finalizar, setFinalizar] = useState(false);
  const listaRef = useRef<HTMLElement>(null);
  const [params, setParams] = useSearchParams();
  const abaLoja = (ABAS_LOJA.some((a) => a.id === params.get('aba')) ? params.get('aba') : 'inicio') as AbaLoja;
  const irAba = (id: AbaLoja) => { setParams(id === 'inicio' ? {} : { aba: id }); window.scrollTo({ top: 0 }); };

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('loja_cardapio', { p_codigo: codigo });
    if (error) return setErro(msgErro(error));
    setDados(data as Dados);
  }, [codigo]);
  useEffect(() => {
    void carregar();
    const i = setInterval(() => void carregar(), 60000);
    return () => clearInterval(i);
  }, [carregar]);
  // Mudou algo no painel (banner, preço, esgotado…): atualiza na hora
  useCardapioAoVivo(dados?.restaurante.id, () => void carregar());
  useEffect(() => ls.gravar(`bf:loja:carrinho:${codigo}`, carrinho), [carrinho, codigo]);
  const ads = dados?.restaurante.ads;
  useEffect(() => { if (ads) iniciarAnuncios(ads); }, [ads]);
  useAppInstalavel(dados ? { nome: dados.restaurante.nome, curto: dados.restaurante.nome.slice(0, 12), inicio: `/loja/${codigo}`, escopo: `/loja/${codigo}` } : null);

  // Sabores de grupo e preço de subcategoria: igual ao cardápio da mesa
  const { produtosLoja, saboresPorCategoria } = useMemo(() => {
    const cats = new Map((dados?.categorias ?? []).map((c) => [c.id, c]));
    const produtosLoja = (dados?.produtos ?? []).map((p) => {
      const c = cats.get(p.categoria_id);
      return c?.preco_grupo != null ? { ...p, preco: Number(c.preco_grupo) + Number(p.preco), prefixo: c.nome } : p;
    });
    const saboresPorCategoria = new Map<string, ProdutoMesa[]>();
    for (const c of dados?.categorias ?? []) {
      if (!c.grupo_id) continue;
      saboresPorCategoria.set(c.id, (dados?.sabores ?? []).filter((x) => x.grupo_id === c.grupo_id).map((x) => ({
        ...x, id: `${c.id}:${x.id}`, categoria_id: c.id, disponivel: x.disponivel && !c.esgotado,
        preco: Number(c.preco_grupo ?? 0) + Number(x.preco), real_id: x.id, tamanho_id: c.id, prefixo: c.nome,
      })));
    }
    return { produtosLoja, saboresPorCategoria };
  }, [dados]);
  const porId = useMemo(() => new Map([
    ...produtosLoja.map((p) => [p.id, p] as const),
    ...[...saboresPorCategoria.values()].flat().map((p) => [p.id, p] as const),
  ]), [produtosLoja, saboresPorCategoria]);

  if (erro && !dados) {
    return (
      <div className="mesa-erro">
        <span className="mesa-erro__icone"><Store size={40} strokeWidth={1.5} /></span>
        <h1 className="titulo">Loja não encontrada</h1>
        <p>{erro}</p>
        <p className="muted">Confira o link que você recebeu.</p>
      </div>
    );
  }
  if (!dados) return <Carregando texto="Carregando cardápio…" />;

  const loja = dados.restaurante;
  const categorias = dados.categorias;
  const produtosDe = (id: string) => [...(saboresPorCategoria.get(id) ?? []), ...produtosLoja.filter((p) => p.categoria_id === id)];
  const principais = categorias.filter((c) => !c.pai_id || !categorias.some((x) => x.id === c.pai_id));
  const subsDe = (id: string) => categorias.filter((c) => c.pai_id === id && produtosDe(c.id).length > 0);
  const destaques = produtosLoja.filter((p) => p.destaque);
  const secoes = [
    ...(destaques.length ? [{ id: DESTAQUES, nome: 'Mais pedidos', emoji: null as string | null, diretos: destaques, subs: [] as CategoriaMesa[], total: destaques.length }] : []),
    ...principais.map((c) => {
      const subs = subsDe(c.id);
      const diretos = produtosDe(c.id);
      return { ...c, diretos, subs, total: diretos.length + subs.reduce((s, x) => s + produtosDe(x.id).length, 0) };
    }).filter((c) => c.total > 0),
  ];
  const secao = secoes.find((c) => c.id === catAtiva) ?? secoes[0];
  const abas = secao ? [
    ...secao.subs.map((sub) => {
      const precos = produtosDe(sub.id).map((x) => Number(x.preco));
      return { id: sub.id, nome: sub.nome, emoji: sub.emoji, preco: precos.length ? Math.min(...precos) : 0 };
    }),
    ...(secao.subs.length && secao.diretos.length ? [{ id: OUTRAS, nome: 'Outras opções', emoji: null, preco: 0 }] : []),
  ] : [];
  const abaAtual = abas.some((a) => a.id === subAtiva) ? subAtiva : abas[0]?.id ?? '';
  const lista = !secao ? [] : abaAtual === OUTRAS || !secao.subs.length ? secao.diretos : produtosDe(abaAtual);

  const subtotal = carrinho.reduce((s, l) => s + precoLinha(l, porId.get(l.produto_id)) * l.qtd, 0);
  const qtdItens = carrinho.reduce((s, l) => s + l.qtd, 0);
  const qtdDoProduto = (id: string) => carrinho.filter((l) => l.produto_id === id).reduce((s, l) => s + l.qtd, 0);
  const faltaMinimo = Math.max(0, Number(loja.minimo) - subtotal);

  /** Coloca de novo na sacola os itens de um pedido antigo (o que ainda existe e está disponível). */
  function pedirDeNovo(itens: ItemAnterior[]) {
    let novo = carrinho;
    let faltou = 0;
    for (const i of itens) {
      const p = (i.produto_id && (porId.get(i.produto_id) ?? produtosLoja.find((x) => x.real_id === i.produto_id))) || null;
      if (!p || !p.disponivel) { faltou++; continue; }
      const grupos = gruposDoProduto(p.real_id ?? p.id, dados?.adicionais_grupos, dados?.produto_grupos);
      const escolhas = (i.adicionais ?? [])
        .filter((e) => grupos.some((g) => g.opcoes.some((o) => o.id === e.id && o.disponivel)))
        .map((e) => ({ id: e.id, qtd: e.qtd }));
      const calc = calcularAdicionais(grupos, escolhas);
      if (calc.faltando) { faltou++; continue; }
      novo = juntarNoCarrinho(novo, p, i.qtd, i.obs ?? '', grupos.length ? { escolhas, extra: calc.extra, texto: calc.texto } : undefined);
    }
    if (novo === carrinho) return toast('Esses itens não estão disponíveis agora.', 'erro');
    setCarrinho(novo);
    irAba('inicio');
    setVerCarrinho(true);
    toast(faltou ? `Itens na sacola. ${faltou} ${faltou === 1 ? 'item não está' : 'itens não estão'} disponível agora.` : 'Pronto! Seu pedido está na sacola.', faltou ? 'info' : 'ok');
  }

  function adicionar(p: ProdutoMesa, qtd: number, obs: string, a?: AdicionaisEscolhidos) {
    setCarrinho((c) => juntarNoCarrinho(c, p, qtd, obs, a));
    toast(`${qtd}× ${nomeItem(p)} na sacola`, 'ok');
    rastrear('AddToCart', (Number(p.preco) + (a?.extra ?? 0)) * qtd);
  }
  const mudarQtd = (chave: string, qtd: number) =>
    setCarrinho((c) => (qtd <= 0 ? c.filter((l) => l.chave !== chave) : c.map((l) => (l.chave === chave ? { ...l, qtd } : l))));
  const escolher = (id: string, sub = '') => { setCatAtiva(id); setSubAtiva(sub); listaRef.current?.scrollTo({ top: 0 }); };

  const sacola = (
    <div className="carrinho">
      <h2 className="carrinho__titulo titulo">Sua sacola</h2>
      {carrinho.length === 0 ? (
        <div className="carrinho__vazio"><ShoppingBag size={36} /><p>Toque em um prato para adicionar.</p></div>
      ) : (
        <ul className="carrinho__linhas">
          {carrinho.map((l) => {
            const p = porId.get(l.produto_id);
            if (!p) return null;
            return (
              <li key={l.chave} className="carrinho__linha">
                <div className="carrinho__info">
                  <strong>{nomeItem(p)}</strong>
                  {l.texto && <small className="carrinho__adic">{l.texto}</small>}
                  {l.obs && <small>“{l.obs}”</small>}
                  <span>{brl(precoLinha(l, p) * l.qtd)}</span>
                </div>
                <div className="carrinho__qtd"><Stepper valor={l.qtd} min={0} max={p.estoque_max ?? 50} aoMudar={(v) => mudarQtd(l.chave, v)} /></div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="carrinho__rodape">
        <div className="loja-totais">
          <div><span>Subtotal</span><span>{brl(subtotal)}</span></div>
          {(loja.entrega_modo ?? 'fixa') === 'fixa' ? Number(loja.taxa) > 0 && <div><span>Entrega</span><span>{brl(Number(loja.taxa))}</span></div>
            : <div><span>Entrega</span><span>calculada no endereço</span></div>}
        </div>
        {faltaMinimo > 0 && carrinho.length > 0 && <p className="loja-aviso">Pedido mínimo {brl(Number(loja.minimo))}. Faltam {brl(faltaMinimo)}.</p>}
        <button className="btn btn--primario btn--lg btn--bloco" disabled={!carrinho.length || !loja.aberto || faltaMinimo > 0} onClick={() => { setVerCarrinho(false); setFinalizar(true); rastrear('InitiateCheckout', subtotal); }}>
          {loja.aberto ? 'Continuar' : 'Loja fechada agora'}
        </button>
        {carrinho.length > 0 && <button className="btn btn--fantasma btn--sm btn--bloco" onClick={() => setCarrinho([])}><Trash2 size={16} /> Esvaziar</button>}
      </div>
    </div>
  );

  const grade = (itens: ProdutoMesa[]) => (
    <div className="mesa__grade">
      {itens.map((p) => {
        const n = qtdDoProduto(p.id);
        return (
          <button key={p.id} className={cx('prod', !p.disponivel && 'prod--esgotado')} disabled={!p.disponivel} onClick={() => setProdutoAberto(p)}>
            <div className="prod__midia">
              {capaEmVideo(p) ? <VideoCapa p={{ ...p, video_url: p.video_url! }} classe="prod__foto" /> : <FotoProduto p={p} classe="prod__foto" />}
              {p.video_url && !capaEmVideo(p) && <span className="prod__video"><Play size={12} fill="currentColor" /> Vídeo</span>}
              {n > 0 && <span className="prod__no-carrinho">{n}</span>}
              {!p.disponivel && <span className="prod__esgotado">Esgotado</span>}
            </div>
            <div className="prod__info">
              <h3>{p.nome}</h3>
              {p.descricao && <p>{p.descricao}</p>}
              <Selos p={p} />
              <div className="prod__rodape">
                <span className="prod__precos">{p.preco_de ? <s>{brl(Number(p.preco_de))}</s> : null}<strong>{brl(p.preco)}</strong></span>
                {p.disponivel && <span className="prod__mais" aria-hidden="true"><Plus size={20} /></span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={cx('mesa loja', qtdItens > 0 && 'mesa--com-carrinho')} style={{ '--acento': loja.cor } as CSSProperties}>
      <header className="mesa__topo">
        <div className="mesa__marca">
          {loja.logo_url ? <img src={loja.logo_url} alt="" className="mesa__logo" /> : <span className="mesa__logo mesa__logo--letra">{loja.nome.charAt(0)}</span>}
          <div>
            <strong>{loja.nome}</strong>
            <StatusLoja loja={loja} />
          </div>
        </div>
        <div className="mesa__acoes">
          <button type="button" className={cx('btn btn--contorno mesa__acao loja-conta-btn', conta.usuario && 'logado')} onClick={() => setVerConta(true)} aria-label={conta.usuario ? 'Minha conta' : 'Entrar na minha conta'}>
            {conta.usuario
              ? <span className="loja-conta-btn__inicial">{(conta.perfil?.nome || conta.usuario.email || '?').charAt(0).toUpperCase()}</span>
              : <UserRound size={20} />}
            <span className="mesa__rotulo">{conta.usuario ? (conta.perfil?.nome?.split(' ')[0] || 'Minha conta') : 'Entrar'}</span>
          </button>
          {loja.instagram && (
            <a className="btn btn--contorno mesa__acao" href={`https://instagram.com/${loja.instagram.replace(/^@/, '')}`} target="_blank" rel="noopener" aria-label="Instagram da loja">
              <AtSign size={20} /> <span className="mesa__rotulo">Instagram</span>
            </a>
          )}
          {(loja.endereco || loja.mapa_url || loja.horarios || loja.rodape) && (
            <button type="button" className="btn btn--contorno mesa__acao" onClick={() => setVerSobre(true)} aria-label="Sobre a loja: endereço e horários">
              <Info size={20} /> <span className="mesa__rotulo">Sobre a loja</span>
            </button>
          )}
        </div>
      </header>

      <div className="loja-info">
        <span><Clock size={15} /> {loja.tempo}</span>
        {loja.entrega !== false && <span><Bike size={15} /> {rotuloEntrega(loja)}</span>}
        {Number(loja.minimo) > 0 && <span><Receipt size={15} /> Mínimo {brl(Number(loja.minimo))}</span>}
        {loja.retirada && <span><Store size={15} /> Retirada no balcão</span>}
      </div>
      {!loja.aberto && (
        <div className="faixa-acesso faixa-acesso--recusado loja-fechada">
          <Clock size={16} />
          <span><b>A loja está fechada agora.</b> {loja.ligado && loja.horarios ? `${proximaAbertura(loja.horarios) ?? 'Volte mais tarde'}.` : 'Você pode olhar o cardápio; os pedidos voltam quando abrir.'}</span>
        </div>
      )}

      {abaLoja !== 'inicio' ? (
        <main className="loja-aba">
          {abaLoja === 'promocoes' && (() => {
            const promo = produtosLoja.filter((p) => p.preco_de && p.disponivel);
            return (
              <section className="mesa__secao">
                <header className="mesa__secao-cab"><h2 className="titulo"><BadgePercent size={22} /> Promoções</h2><span>{promo.length} {promo.length === 1 ? 'oferta' : 'ofertas'}</span></header>
                {promo.length ? grade(promo) : <AbaVazia icone={<BadgePercent size={30} />} titulo="Nenhuma promoção hoje" texto="Volte mais tarde: as ofertas da loja aparecem aqui." />}
              </section>
            );
          })()}
          {abaLoja === 'fidelidade' && <AbaFidelidade codigo={codigo} loja={loja} />}
          {abaLoja === 'pedidos' && <AbaPedidos codigo={codigo} loja={loja} conta={conta} aoEntrar={() => setVerConta(true)} aoPedirDeNovo={pedirDeNovo} />}
        </main>
      ) : (
      <>
      <CapaCardapio imagem={loja.capa_url} video={loja.capa_video_url} />
      <div className="mesa__corpo">
        <nav className="mesa__cats" aria-label="Categorias">
          {secoes.map((c) => (
            <button key={c.id} className={cx('mesa__cat', secao?.id === c.id && 'ativa')} onClick={() => escolher(c.id)}>
              <span className="mesa__cat-emoji" aria-hidden="true">{c.id === DESTAQUES ? <Star size={18} fill="currentColor" /> : c.emoji}</span>
              <span className="mesa__cat-nome">{c.nome}</span>
              <span className="mesa__cat-qtd">{c.total}</span>
            </button>
          ))}
        </nav>
        <main className="mesa__lista" ref={listaRef}>
          {secao?.id === secoes[0]?.id && loja.descricao && (
            <div className="loja-hero">
              <p className="loja-hero__desc">{loja.descricao}</p>
            </div>
          )}
          {secao ? (
            <section key={`${secao.id}:${abaAtual}`} className="mesa__secao">
              <header className="mesa__secao-cab">
                <h2 className="titulo"><span className="mesa__secao-emoji" aria-hidden="true">{secao.id === DESTAQUES ? <Star size={18} fill="currentColor" /> : secao.emoji}</span> {secao.nome}</h2>
                <span>{lista.length} {lista.length === 1 ? 'opção' : 'opções'}</span>
              </header>
              {abas.length > 1 && (
                <div className="mesa__abas" role="tablist">
                  {abas.map((a) => (
                    <button key={a.id} role="tab" aria-selected={abaAtual === a.id} className={cx('mesa__aba', abaAtual === a.id && 'ativa')} onClick={() => setSubAtiva(a.id)}>
                      <span>{a.emoji} {a.nome}</span>
                    </button>
                  ))}
                </div>
              )}
              {grade(lista)}
            </section>
          ) : <p className="vazio">O cardápio ainda está sendo preparado.</p>}
        </main>
        <aside className="mesa__carrinho">{sacola}</aside>
      </div>
      </>
      )}

      {verSobre && <ModalSobreLoja loja={loja} aoFechar={() => setVerSobre(false)} />}
      {(verConta || (conta.novaSenha && !!conta.usuario)) && (
        <ModalConta conta={conta} codigo={codigo} nomeLoja={loja.nome} aoFechar={() => setVerConta(false)} aoVerPedidos={() => irAba('pedidos')} />
      )}

      {/* Barra de baixo, como nos apps de delivery */}
      <nav className="loja-nav" aria-label="Menu da loja">
        {ABAS_LOJA.map((a) => (
          <button key={a.id} type="button" className={cx('loja-nav__item', abaLoja === a.id && 'ativo')} onClick={() => irAba(a.id)} aria-current={abaLoja === a.id ? 'page' : undefined}>
            {iconeAba(a.id)}
            <span>{a.rotulo}</span>
          </button>
        ))}
      </nav>

      {qtdItens > 0 && (
        <button className="mesa__flutuante" onClick={() => setVerCarrinho(true)}>
          <span className="mesa__flutuante-qtd">{qtdItens}</span>
          <span>Ver sacola</span>
          <strong>{brl(subtotal)}</strong>
        </button>
      )}
      <Modal aberto={verCarrinho} aoFechar={() => setVerCarrinho(false)} classe="mesa-modal">{sacola}</Modal>

      {produtoAberto && (
        <ModalProduto
          key={produtoAberto.id}
          p={produtoAberto}
          aoFechar={() => setProdutoAberto(null)}
          aoAdicionar={(qtd, obs, a) => { adicionar(produtoAberto, qtd, obs, a); setProdutoAberto(null); }}
          jaNoCarrinho={qtdDoProduto(produtoAberto.id)}
          grupos={gruposDoProduto(produtoAberto.real_id ?? produtoAberto.id, dados.adicionais_grupos, dados.produto_grupos)}
          semObs={loja.obs === false}
        />
      )}

      {finalizar && (
        <ModalFinalizar
          codigo={codigo}
          loja={loja}
          carrinho={carrinho}
          porId={porId}
          subtotal={subtotal}
          conta={conta}
          aoEntrar={() => setVerConta(true)}
          aoFechar={() => setFinalizar(false)}
          aoEnviar={(acompanhar) => {
            setCarrinho([]);
            const ultimos = ls.ler<string[]>(`bf:loja:pedidos:${codigo}`, []);
            ls.gravar(`bf:loja:pedidos:${codigo}`, [acompanhar, ...ultimos].slice(0, 30));
            navegar(`/loja/${codigo}/pedido/${acompanhar}`);
          }}
        />
      )}
    </div>
  );
}

function AbaVazia({ icone, titulo, texto, children }: { icone: ReactElement; titulo: string; texto: string; children?: ReactElement }) {
  return (
    <div className="loja-vazio">
      <span>{icone}</span>
      <strong>{titulo}</strong>
      <p>{texto}</p>
      {children}
    </div>
  );
}

/** Cartão de fidelidade: a cada N pedidos, um prêmio. Conta pelo telefone usado nos pedidos. */
function AbaFidelidade({ codigo, loja }: { codigo: string; loja: Loja }) {
  const toast = useToast();
  const salvo = ls.ler<Cliente>('bf:loja:cliente', CLIENTE_VAZIO).telefone;
  const [tel, setTel] = useState(salvo);
  const [res, setRes] = useState<{ pontos: number; resgates: number } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const f = loja.fidelidade;

  const consultar = useCallback(async (telefone: string) => {
    if (telefone.replace(/\D/g, '').length < 10) return;
    setCarregando(true);
    const { data, error } = await supabase.rpc('loja_fidelidade', { p_codigo: codigo, p_telefone: telefone });
    setCarregando(false);
    if (error) return toast(msgErro(error), 'erro');
    const d = data as { ativo: boolean; pontos?: number; resgates?: number };
    if (d.ativo) setRes({ pontos: d.pontos ?? 0, resgates: d.resgates ?? 0 });
  }, [codigo, toast]);
  useEffect(() => { if (f && salvo) void consultar(salvo); }, [f, salvo, consultar]);

  if (!f) return <AbaVazia icone={<Gift size={30} />} titulo="Programa de fidelidade" texto="Esta loja ainda não tem cartão fidelidade." />;
  const pontos = Math.min(res?.pontos ?? 0, f.meta);
  const completo = (res?.pontos ?? 0) >= f.meta;

  return (
    <section className="fid">
      <div className="fid__cartao">
        <div className="fid__topo">
          {loja.logo_url ? <img src={loja.logo_url} alt="" /> : <span className="fid__letra">{loja.nome.charAt(0)}</span>}
          <div><small>Cartão fidelidade</small><strong>{loja.nome}</strong></div>
        </div>
        <p className="fid__regra">A cada <b>{f.meta} pedidos</b>{Number(f.minimo) > 0 ? ` acima de ${brl(Number(f.minimo))}` : ''}, você ganha:</p>
        <p className="fid__premio"><Gift size={18} /> {f.premio || 'um prêmio da casa'}</p>
        <div className="fid__selos" style={{ gridTemplateColumns: `repeat(${f.meta <= 10 ? 5 : 6}, 1fr)` }}>
          {Array.from({ length: f.meta }, (_, i) => (
            <span key={i} className={cx('fid__selo', i < pontos && 'ok', i === f.meta - 1 && 'ultimo')}>
              {i < pontos ? <Check size={16} strokeWidth={3} /> : i === f.meta - 1 ? <Gift size={15} /> : i + 1}
            </span>
          ))}
        </div>
        {res && (
          <p className="fid__status">
            {completo ? <><b>Parabéns!</b> Você completou o cartão. Avise a loja no próximo pedido para receber o prêmio.</>
              : <>Faltam <b>{f.meta - pontos} {f.meta - pontos === 1 ? 'pedido' : 'pedidos'}</b> para o prêmio.</>}
            {res.resgates > 0 && <small> Você já ganhou {res.resgates} {res.resgates === 1 ? 'vez' : 'vezes'}.</small>}
          </p>
        )}
      </div>
      <form className="fid__tel" onSubmit={(e) => { e.preventDefault(); void consultar(tel); }}>
        <label className="campo"><span>Seu WhatsApp (o mesmo dos pedidos)</span>
          <input className="input" inputMode="tel" value={telefoneFormatado(tel)} onChange={(e) => setTel(e.target.value.replace(/\D/g, ''))} placeholder="(11) 98765-4321" />
        </label>
        <button className="btn btn--primario" disabled={carregando || tel.replace(/\D/g, '').length < 10}>{carregando ? 'Consultando…' : res ? 'Atualizar' : 'Ver meus pontos'}</button>
      </form>
    </section>
  );
}

const ROTULO_STATUS: Record<string, string> = { novo: 'Pedido recebido', preparando: 'Em preparo', pronto: 'Pronto', entregue: 'Entregue', cancelado: 'Cancelado' };

interface ItemAnterior { produto_id: string | null; nome: string; qtd: number; preco: number; obs: string | null; complementos?: string | null; adicionais: { id: string; qtd: number }[] | null }
interface PedidoAnterior { numero: number; status: string; tipo: string; total: number; criado_em: string; acompanhar: string; itens: ItemAnterior[] | null }

/** Meus pedidos: com conta, todos os pedidos dela (em qualquer celular) e "Pedir de novo"; sem conta, os deste celular. */
function AbaPedidos({ codigo, loja, conta, aoEntrar, aoPedirDeNovo }: {
  codigo: string;
  loja: Loja;
  conta: ContaCliente;
  aoEntrar: () => void;
  aoPedirDeNovo: (itens: ItemAnterior[]) => void;
}) {
  const [lista, setLista] = useState<PedidoAnterior[] | null>(null);
  const logado = !!conta.usuario;
  useEffect(() => {
    if (conta.carregando) return;
    let vivo = true;
    setLista(null);
    void (async () => {
      if (logado) {
        const { data } = await supabaseCliente.rpc('cliente_meus_pedidos', { p_codigo: codigo });
        if (vivo) setLista((data ?? []) as PedidoAnterior[]);
        return;
      }
      const tokens = ls.ler<string[]>(`bf:loja:pedidos:${codigo}`, []);
      const l = await Promise.all(tokens.map(async (a): Promise<PedidoAnterior | null> => {
        const { data } = await supabase.rpc('loja_pedido_status', { p_acompanhar: a });
        const d = data as (StatusPedido | null);
        return d ? { numero: d.numero, status: d.status, tipo: d.tipo, total: d.total, criado_em: d.criado_em, acompanhar: a, itens: d.itens.map((i) => ({ produto_id: null, nome: i.nome, qtd: i.qtd, preco: i.preco, obs: null, adicionais: null })) } : null;
      }));
      if (vivo) setLista(l.filter((x): x is PedidoAnterior => !!x));
    })();
    return () => { vivo = false; };
  }, [codigo, logado, conta.carregando]);

  const convite = !logado && !conta.carregando && (
    <button type="button" className="loja-conta-convite loja-conta-convite--grande" onClick={aoEntrar}>
      <UserRound size={22} />
      <span><b>Entre na sua conta</b> para ver seus pedidos em qualquer celular e pedir de novo com um toque.</span>
      <em>Entrar</em>
    </button>
  );

  if (!lista) return <div className="spinner" style={{ margin: '50px auto' }} />;
  if (!lista.length) {
    return (
      <>
        {convite}
        <AbaVazia icone={<ReceiptText size={30} />} titulo="Você ainda não fez pedidos" texto={logado ? 'Os pedidos que você fizer com a sua conta aparecem aqui.' : 'Os pedidos feitos neste celular aparecem aqui para você acompanhar.'} />
      </>
    );
  }
  return (
    <section className="mesa__secao">
      {convite}
      <header className="mesa__secao-cab"><h2 className="titulo"><ReceiptText size={22} /> Meus pedidos</h2><span>{lista.length}</span></header>
      <ul className="meus-pedidos">
        {lista.map((p) => {
          const itens = p.itens ?? [];
          const podeRepetir = logado && itens.some((i) => i.produto_id);
          return (
            <li key={p.acompanhar} className="meu-pedido">
              <div className="meu-pedido__topo">
                {loja.logo_url ? <img src={loja.logo_url} alt="" /> : <span className="mesa__logo mesa__logo--letra">{loja.nome.charAt(0)}</span>}
                <div>
                  <strong>{loja.nome}</strong>
                  <small>{new Date(p.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
                </div>
              </div>
              <p className="meu-pedido__linha">
                <span className={cx('meu-pedido__ponto', `meu-pedido__ponto--${p.status}`)} />
                {p.status === 'entregue' ? (p.tipo === 'delivery' ? 'Entrega realizada' : 'Retirado') : ROTULO_STATUS[p.status] ?? p.status} · Pedido #{p.numero}
              </p>
              <p className="meu-pedido__itens">{itens.map((i) => `${i.qtd}× ${i.nome}`).join(', ')}</p>
              <div className="meu-pedido__base">
                <span>Total: <b>{brl(Number(p.total))}</b></span>
                <div className="meu-pedido__acoes">
                  <Link className="btn btn--contorno btn--sm" to={`/loja/${codigo}/pedido/${p.acompanhar}`}>Detalhes</Link>
                  {podeRepetir && <button type="button" className="btn btn--primario btn--sm" onClick={() => aoPedirDeNovo(itens)}><RotateCcw size={15} /> Pedir de novo</button>}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ModalFinalizar({ codigo, loja, carrinho, porId, subtotal, conta, aoEntrar, aoFechar, aoEnviar }: {
  codigo: string;
  conta: ContaCliente;
  aoEntrar: () => void;
  loja: Loja;
  carrinho: Linha[];
  porId: Map<string, ProdutoMesa>;
  subtotal: number;
  aoFechar: () => void;
  aoEnviar: (acompanhar: string) => void;
}) {
  const toast = useToast();
  const fazEntrega = loja.entrega !== false;
  const [tipo, setTipo] = useState<'delivery' | 'retirada'>(fazEntrega ? 'delivery' : 'retirada');
  const formas = FORMAS.filter((f) => !loja.formas || loja.formas.includes(f.id));
  const [cli, setCli] = useState<Cliente>(() => ({ ...CLIENTE_VAZIO, ...ls.ler<Cliente>('bf:loja:cliente', CLIENTE_VAZIO) }));
  // Logado: nome, WhatsApp e último endereço já vêm da conta
  useEffect(() => {
    const pf = conta.perfil;
    if (!pf) return;
    setCli((c) => ({
      ...c,
      nome: c.nome || pf.nome,
      telefone: c.telefone || pf.telefone,
      endereco: c.endereco.rua || !pf.enderecos[0] ? c.endereco : { ...CLIENTE_VAZIO.endereco, ...pf.enderecos[0] },
    }));
  }, [conta.perfil]);
  const [forma, setForma] = useState<Forma | null>(null);
  const [troco, setTroco] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const modo = loja.entrega_modo ?? 'fixa';
  const end = (k: keyof Cliente['endereco'], v: string) => setCli((c) => ({ ...c, endereco: { ...c.endereco, [k]: v } }));
  // Por distância: acha o endereço no mapa (ou usa o GPS) e calcula a taxa
  const [local, setLocal] = useState<{ ponto: Ponto; km: number; taxa: number | null } | null>(null);
  const [localizando, setLocalizando] = useState(false);
  const [erroLocal, setErroLocal] = useState('');
  const lojaPonto = loja.lat != null && loja.lng != null ? { lat: Number(loja.lat), lng: Number(loja.lng) } : null;
  const aplicarPonto = (p: Ponto) => {
    if (!lojaPonto) return;
    const km = distanciaKm(lojaPonto, p);
    setLocal({ ponto: p, km, taxa: taxaPorRaio(loja.raios ?? [], km) });
    setErroLocal('');
  };
  async function localizarEndereco() {
    const e = cli.endereco;
    if (!e.rua.trim() || !e.bairro.trim()) return setErroLocal('Preencha rua e bairro.');
    setLocalizando(true);
    const cidade = loja.cidade ?? '';
    const p = await buscarEndereco(`${e.rua}, ${e.numero}, ${e.bairro}, ${cidade}`) ?? await buscarEndereco(`${e.rua}, ${e.bairro}, ${cidade}`) ?? await buscarEndereco(`${e.bairro}, ${cidade}`);
    setLocalizando(false);
    if (!p) { setLocal(null); return setErroLocal('Não achei esse endereço no mapa. Use “Minha localização”.'); }
    aplicarPonto(p);
  }
  async function usarGps() {
    setLocalizando(true);
    try { aplicarPonto(await minhaLocalizacao()); } catch (e) { setErroLocal(msgErro(e)); }
    setLocalizando(false);
  }
  // Endereço mudou: precisa calcular de novo
  useEffect(() => { if (modo === 'raio') setLocal(null); }, [cli.endereco.rua, cli.endereco.numero, cli.endereco.bairro, modo]);
  const bairroEscolhido = modo === 'bairro' ? (loja.bairros ?? []).find((b) => b.nome.toLowerCase() === cli.endereco.bairro.trim().toLowerCase()) : undefined;
  const taxa = tipo !== 'delivery' ? 0
    : modo === 'bairro' ? Number(bairroEscolhido?.taxa ?? 0)
      : modo === 'raio' ? Number(local?.taxa ?? 0)
        : Number(loja.taxa);
  const total = subtotal + taxa;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    destravarSom(); // ainda dentro do toque: libera o áudio do celular
    if (!forma) return toast('Escolha a forma de pagamento.', 'erro');
    if (tipo === 'delivery' && modo === 'bairro' && !bairroEscolhido) return toast('Escolha o seu bairro na lista.', 'erro');
    if (tipo === 'delivery' && modo === 'raio' && !local) return toast('Toque em “Calcular entrega” para confirmar o endereço.', 'erro');
    if (tipo === 'delivery' && modo === 'raio' && local?.taxa == null) return toast('Esse endereço fica fora da área de entrega.', 'erro');
    setEnviando(true);
    ls.gravar('bf:loja:cliente', cli);
    // Pelo cliente: com conta, o pedido fica ligado a ela (Meus pedidos / Pedir de novo)
    const { data, error } = await supabaseCliente.rpc('loja_pedido_enviar', {
      p_codigo: codigo,
      p_tipo: tipo,
      p_itens: carrinho.map((l) => {
        const p = porId.get(l.produto_id);
        return { produto_id: p?.real_id ?? l.produto_id, categoria_id: p?.tamanho_id ?? null, qtd: l.qtd, obs: l.obs, adicionais: l.adicionais ?? [] };
      }),
      p_cliente: {
        nome: cli.nome, telefone: cli.telefone, pagamento: forma,
        troco: forma === 'dinheiro' && troco.trim() ? String(lerPreco(troco)) : '',
        endereco: tipo === 'delivery' ? { ...cli.endereco, ...(modo === 'raio' && local ? { lat: local.ponto.lat, lng: local.ponto.lng } : {}) } : null,
        ua: navigator.userAgent, url: window.location.href,
      },
      p_obs: obs,
    });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    const feito = data as { acompanhar: string; total: number };
    if (conta.usuario) {
      void conta.salvarPerfil({ nome: cli.nome.trim(), telefone: cli.telefone.replace(/\D/g, '') }).catch(() => {});
      if (tipo === 'delivery') void conta.lembrarEndereco(cli.endereco);
    }
    rastrear('Purchase', Number(feito.total), feito.acompanhar);
    tocarEnviado();
    aoEnviar(feito.acompanhar);
  }

  return (
    <Modal aberto aoFechar={() => !enviando && aoFechar()} titulo="Finalizar pedido" classe="mesa-modal loja-finalizar" largura={560}>
      <form className="loja-form" onSubmit={enviar} id="form-finalizar">
        {!conta.usuario && !conta.carregando && (
          <button type="button" className="loja-conta-convite" onClick={aoEntrar}>
            <UserRound size={18} />
            <span><b>Tem conta?</b> Entre e seus dados já vêm preenchidos.</span>
            <em>Entrar</em>
          </button>
        )}
        {loja.retirada && fazEntrega && (
          <div className="loja-segmento" role="radiogroup" aria-label="Como receber">
            <button type="button" role="radio" aria-checked={tipo === 'delivery'} className={cx(tipo === 'delivery' && 'ativo')} onClick={() => setTipo('delivery')}>
              <Bike size={20} /><span>Entrega<small>{loja.tempo}</small></span>
            </button>
            <button type="button" role="radio" aria-checked={tipo === 'retirada'} className={cx(tipo === 'retirada' && 'ativo')} onClick={() => setTipo('retirada')}>
              <Store size={20} /><span>Retirar no balcão<small>sem taxa</small></span>
            </button>
          </div>
        )}

        <fieldset>
          <legend>Seus dados</legend>
          <label className="campo"><span>Nome</span><input className="input" required maxLength={80} value={cli.nome} onChange={(e) => setCli({ ...cli, nome: e.target.value })} autoComplete="name" /></label>
          <label className="campo"><span>WhatsApp</span><input className="input" required inputMode="tel" autoComplete="tel" value={telefoneFormatado(cli.telefone)} onChange={(e) => setCli({ ...cli, telefone: e.target.value.replace(/\D/g, '') })} placeholder="(11) 98765-4321" /></label>
        </fieldset>

        {tipo === 'delivery' ? (
          <fieldset>
            <legend><MapPin size={16} /> Endereço de entrega</legend>
            {!!conta.perfil?.enderecos.length && (
              <div className="loja-enderecos" role="group" aria-label="Endereços salvos">
                {conta.perfil.enderecos.map((e, i) => {
                  const igual = e.rua === cli.endereco.rua && e.numero === cli.endereco.numero;
                  return (
                    <button key={`${e.rua}${e.numero}${i}`} type="button" className={cx('loja-endereco', igual && 'ativo')} onClick={() => setCli((c) => ({ ...c, endereco: { ...CLIENTE_VAZIO.endereco, ...e } }))}>
                      <MapPin size={15} /><span>{e.rua}, {e.numero}<small>{e.bairro}</small></span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="loja-linha">
              <label className="campo loja-linha__grande"><span>Rua</span><input className="input" required maxLength={120} value={cli.endereco.rua} onChange={(e) => end('rua', e.target.value)} autoComplete="address-line1" /></label>
              <label className="campo"><span>Número</span><input className="input" required maxLength={20} value={cli.endereco.numero} onChange={(e) => end('numero', e.target.value)} inputMode="numeric" /></label>
            </div>
            {modo === 'bairro' ? (
              <label className="campo"><span>Bairro</span>
                <select className="select" required value={bairroEscolhido?.nome ?? ''} onChange={(e) => end('bairro', e.target.value)}>
                  <option value="">Escolha o seu bairro</option>
                  {(loja.bairros ?? []).map((b) => <option key={b.nome} value={b.nome}>{b.nome} — {Number(b.taxa) > 0 ? brl(Number(b.taxa)) : 'grátis'}</option>)}
                </select>
                <small className="loja-dica">Seu bairro não está na lista? A loja ainda não entrega aí.</small>
              </label>
            ) : (
              <label className="campo"><span>Bairro</span><input className="input" required maxLength={80} value={cli.endereco.bairro} onChange={(e) => end('bairro', e.target.value)} /></label>
            )}
            {modo === 'raio' && (
              <div className={cx('loja-distancia', local && (local.taxa == null ? 'fora' : 'ok'))}>
                {local ? (
                  <p>{local.taxa == null
                    ? <><MapPin size={16} /> Fica a {String(local.km).replace('.', ',')} km: fora da área de entrega.</>
                    : <><MapPin size={16} /> {String(local.km).replace('.', ',')} km da loja · entrega <b>{local.taxa > 0 ? brl(local.taxa) : 'grátis'}</b></>}</p>
                ) : <p>{erroLocal || 'Confirme o endereço para calcular a entrega.'}</p>}
                <div className="loja-distancia__botoes">
                  <button type="button" className="btn btn--contorno btn--sm" disabled={localizando} onClick={() => void localizarEndereco()}>{localizando ? 'Calculando…' : 'Calcular entrega'}</button>
                  <button type="button" className="btn btn--fantasma btn--sm" disabled={localizando} onClick={() => void usarGps()}><MapPin size={15} /> Minha localização</button>
                </div>
              </div>
            )}
            <div className="loja-linha">
              <label className="campo"><span>Complemento</span><input className="input" maxLength={80} value={cli.endereco.complemento} onChange={(e) => end('complemento', e.target.value)} placeholder="Apto, bloco…" /></label>
              <label className="campo"><span>Referência</span><input className="input" maxLength={120} value={cli.endereco.referencia} onChange={(e) => end('referencia', e.target.value)} placeholder="Perto de…" /></label>
            </div>
          </fieldset>
        ) : loja.endereco ? (
          <p className="loja-retirada"><Store size={18} /> Retire em: <b>{loja.endereco}</b></p>
        ) : null}

        <fieldset>
          <legend>Pagamento {tipo === 'delivery' ? 'na entrega' : 'na retirada'}</legend>
          <div className="loja-formas">
            {formas.map((f) => (
              <button key={f.id} type="button" className={cx(forma === f.id && 'ativo')} onClick={() => setForma(f.id)} aria-pressed={forma === f.id}>
                {f.icone}<span>{f.rotulo}</span>{forma === f.id && <Check size={15} className="loja-formas__ok" />}
              </button>
            ))}
          </div>
          {forma === 'dinheiro' && (
            <label className="campo"><span>Troco para quanto? (opcional)</span><input className="input" inputMode="decimal" value={troco} onChange={(e) => setTroco(mascaraPreco(e.target.value))} placeholder={`Ex.: ${brl(Math.ceil(total / 50) * 50)}`} /></label>
          )}
        </fieldset>

        {loja.obs !== false && <label className="campo"><span>Observação (opcional)</span><textarea className="textarea" rows={2} maxLength={300} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: sem cebola, tocar o interfone" /></label>}

        <div className="loja-resumo">
          {carrinho.map((l) => {
            const p = porId.get(l.produto_id);
            return p ? <div key={l.chave}><span>{l.qtd}× {nomeItem(p)}{l.texto && <small className="carrinho__adic">{l.texto}</small>}</span><span>{brl(precoLinha(l, p) * l.qtd)}</span></div> : null;
          })}
          {taxa > 0 && <div><span>Taxa de entrega</span><span>{brl(taxa)}</span></div>}
          <div className="loja-resumo__total"><span>Total</span><strong>{brl(total)}</strong></div>
        </div>
        <button className="btn btn--primario btn--lg btn--bloco" disabled={enviando}>{enviando ? 'Enviando…' : `Fazer pedido · ${brl(total)}`}</button>
        <p className="loja-legal">Ao fazer o pedido, você concorda com os <a href="/termos" target="_blank" rel="noopener">Termos de uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>.</p>
      </form>
    </Modal>
  );
}

/* ---------- Acompanhar o pedido ---------- */
interface StatusPedido {
  numero: number; status: 'novo' | 'preparando' | 'pronto' | 'entregue' | 'cancelado'; tipo: 'delivery' | 'retirada';
  total: number; taxa: number; criado_em: string; pago: boolean; forma: Forma; troco: number | null; cliente: string;
  endereco: Cliente['endereco'] | null; itens: { nome: string; qtd: number; preco: number; complementos?: string | null }[];
  motivo?: string | null; cancelados?: { nome: string; qtd: number; motivo: string | null }[] | null;
  loja: { nome: string; logo_url: string | null; cor: string; whatsapp: string | null; endereco: string | null; codigo: string; tempo: string };
}

export function LojaPedido() {
  const { codigo = '', acompanhar = '' } = useParams();
  const [p, setP] = useState<StatusPedido | null | undefined>(undefined);
  useAlturaTela();

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      const { data } = await supabase.rpc('loja_pedido_status', { p_acompanhar: acompanhar });
      if (vivo) setP((data as StatusPedido | null) ?? null);
    };
    void ler();
    const i = setInterval(() => void ler(), 8000);
    return () => { vivo = false; clearInterval(i); };
  }, [acompanhar]);

  if (p === undefined) return <Carregando texto="Carregando seu pedido…" />;
  if (p === null) {
    return (
      <div className="mesa-erro">
        <span className="mesa-erro__icone"><Receipt size={40} strokeWidth={1.5} /></span>
        <h1 className="titulo">Pedido não encontrado</h1>
        <Link className="btn btn--primario btn--lg" to={`/loja/${codigo}`}>Ver o cardápio</Link>
      </div>
    );
  }

  const entrega = p.tipo === 'delivery';
  const etapas = [
    { id: 'novo', rotulo: 'Pedido recebido', dica: 'A loja já viu o seu pedido.' },
    { id: 'preparando', rotulo: 'Em preparo', dica: 'Está sendo preparado agora.' },
    { id: 'pronto', rotulo: entrega ? 'Saiu para entrega' : 'Pronto para retirar', dica: entrega ? 'Está a caminho.' : 'Pode vir buscar no balcão.' },
    { id: 'entregue', rotulo: entrega ? 'Entregue' : 'Retirado', dica: 'Bom apetite!' },
  ];
  const atual = etapas.findIndex((e) => e.id === p.status);
  const whats = p.loja.whatsapp ? `https://wa.me/${p.loja.whatsapp.replace(/\D/g, '').replace(/^(?!55)/, '55')}?text=${encodeURIComponent(`Olá! Sobre o meu pedido #${p.numero}.`)}` : '';

  return (
    <div className="loja-pedido" style={{ '--acento': p.loja.cor } as CSSProperties}>
      <header className="loja-pedido__topo">
        {p.loja.logo_url ? <img src={p.loja.logo_url} alt="" /> : <span className="mesa__logo mesa__logo--letra">{p.loja.nome.charAt(0)}</span>}
        <div><strong>{p.loja.nome}</strong><small>Pedido #{p.numero} · {hora(p.criado_em)}</small></div>
      </header>

      {p.status === 'cancelado' ? (
        <section className="loja-pedido__cartao loja-pedido__cancelado">
          <h1>Pedido cancelado</h1>
          <p>{p.motivo ? <>A loja cancelou este pedido. <b>Motivo: {p.motivo}.</b></> : 'A loja cancelou este pedido. Fale com ela para saber mais.'}</p>
        </section>
      ) : (
        <section className="loja-pedido__cartao">
          <span className="loja-pedido__selo">{entrega ? <Bike size={16} /> : <Store size={16} />} {entrega ? 'Entrega' : 'Retirada'} · {p.loja.tempo}</span>
          <h1>{etapas[Math.max(0, atual)].rotulo}</h1>
          <p>{etapas[Math.max(0, atual)].dica}</p>
          <ol className="loja-etapas">
            {etapas.map((e, i) => (
              <li key={e.id} className={cx(i < atual && 'feita', i === atual && 'atual')}>
                <span>{i < atual ? <Check size={14} /> : i + 1}</span>{e.rotulo}
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.status !== 'cancelado' && !!p.cancelados?.length && (
        <section className="loja-pedido__cartao loja-pedido__cancelado loja-pedido__itens-fora">
          <h2><Ban size={18} /> {p.cancelados.length === 1 ? 'Um item saiu do pedido' : 'Alguns itens saíram do pedido'}</h2>
          <ul>{p.cancelados.map((c, i) => <li key={i}><b>{c.qtd}×</b> {fraseCancelamento(c.nome, c.motivo)}</li>)}</ul>
          <p>O valor já foi descontado do total.</p>
        </section>
      )}

      <section className="loja-pedido__cartao">
        <h2>Resumo</h2>
        <div className="loja-resumo">
          {p.itens.map((i, n) => <div key={n}><span>{i.qtd}× {i.nome}{i.complementos && <small className="carrinho__adic">{i.complementos}</small>}</span><span>{brl(i.qtd * Number(i.preco))}</span></div>)}
          {Number(p.taxa) > 0 && <div><span>Taxa de entrega</span><span>{brl(Number(p.taxa))}</span></div>}
          <div className="loja-resumo__total"><span>Total</span><strong>{brl(Number(p.total))}</strong></div>
        </div>
        <p className="loja-pedido__linha"><Banknote size={16} /> {FORMAS.find((f) => f.id === p.forma)?.rotulo} {entrega ? 'na entrega' : 'na retirada'}{p.troco ? ` · troco para ${brl(Number(p.troco))}` : ''}{p.pago ? ' · pago' : ''}</p>
        {entrega && p.endereco && <p className="loja-pedido__linha"><MapPin size={16} /> {p.endereco.rua}, {p.endereco.numero} · {p.endereco.bairro}{p.endereco.complemento ? ` · ${p.endereco.complemento}` : ''}</p>}
        {!entrega && p.loja.endereco && <p className="loja-pedido__linha"><Store size={16} /> Retirada em {p.loja.endereco}</p>}
      </section>

      <div className="loja-pedido__acoes">
        {whats && <a className="btn btn--contorno btn--lg" href={whats} target="_blank" rel="noopener"><MessageCircle size={18} /> Falar com a loja</a>}
        <Link className="btn btn--primario btn--lg" to={`/loja/${codigo}`}><UtensilsCrossed size={18} /> Fazer outro pedido</Link>
      </div>
      <p className="loja-pedido__nota">Esta página se atualiza sozinha.</p>
    </div>
  );
}

/* ---------- Sobre a loja (endereço, Instagram, horários): fica no topo, ao lado da logo ---------- */
function ModalSobreLoja({ loja, aoFechar }: { loja: Loja; aoFechar: () => void }) {
  const hoje = new Date().getDay();
  const mapa = loja.mapa_url || (loja.endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loja.endereco)}` : '');
  return (
    <Modal aberto aoFechar={aoFechar} largura={460} classe="mesa-modal sobre-loja">
      <div className="sobre-loja__topo">
        {loja.logo_url ? <img src={loja.logo_url} alt="" className="mesa__logo" /> : <span className="mesa__logo mesa__logo--letra">{loja.nome.charAt(0)}</span>}
        <div>
          <strong>{loja.nome}</strong>
          <StatusLoja loja={loja} />
        </div>
      </div>
      <ul className="sobre-loja__lista">
        {(loja.endereco || loja.mapa_url) && (
          <li>
            <span className="sobre-loja__icone"><MapPin size={18} /></span>
            <div><small>Endereço</small>{loja.endereco && <span>{loja.endereco}</span>}{mapa && <a href={mapa} target="_blank" rel="noopener">Ver no mapa</a>}</div>
          </li>
        )}
        {loja.instagram && (
          <li>
            <span className="sobre-loja__icone"><AtSign size={18} /></span>
            <div><small>Instagram</small><a href={`https://instagram.com/${loja.instagram}`} target="_blank" rel="noopener">@{loja.instagram.replace(/^@/, '')}</a></div>
          </li>
        )}
        {loja.horarios && (
          <li>
            <span className="sobre-loja__icone"><Clock size={18} /></span>
            <div>
              <small>Horários</small>
              <ul className="sobre-loja__horarios">
                {loja.horarios.map((h, i) => (
                  <li key={i} className={cx(i === hoje && 'hoje')}>
                    <span>{i === hoje ? 'Hoje' : DIAS[i]}</span>
                    <b>{h.aberto ? `${h.de} – ${h.ate}` : 'Fechado'}</b>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        )}
      </ul>
      {loja.rodape && <p className="sobre-loja__rodape">{loja.rodape}</p>}
      <p className="sobre-loja__legal"><a href="/termos" target="_blank" rel="noopener">Termos de uso</a> · <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a></p>
    </Modal>
  );
}
