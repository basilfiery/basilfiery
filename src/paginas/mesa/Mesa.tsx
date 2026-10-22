import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLinkCurto } from '../../lib/linkCurto';
import {
  Ban, Check, CheckCircle2, ChevronRight, Citrus, ConciergeBell, Gamepad2, Hourglass, Layers, Lock, Maximize, MessageCircleMore, Minus, Play, Plus, Receipt,
  ShieldCheck, ShoppingBag, Star, Trash2, Users, Utensils, UtensilsCrossed, XCircle,
} from 'lucide-react';
import { FotoProduto, Selos, Stepper, VideoCapa } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { descreverAparelho, idDispositivo } from '../../lib/dispositivo';
import { msgErro, rpcSeguro, supabase } from '../../lib/supabase';
import type { StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, hora, ls } from '../../lib/util';
import { useNovaVersao } from '../../lib/versao';
import { useAppInstalavel } from '../../lib/manifesto';
import { sugerirObs } from '../../lib/sugestoes';
import { destravarSom, tocarAviso, tocarEnviado } from '../../lib/som';
import { fraseCancelamento } from '../../lib/cancelamento';
import { useCardapioAoVivo } from '../../lib/cardapioAoVivo';
import { calcularAdicionais, chaveEscolhas, gruposDoProduto, regraGrupo, type Escolha, type GrupoAdicionalMesa, type OpcaoAdicional } from '../../lib/adicionais';
import { JogoMemoria } from './JogoMemoria';
import { telefoneFormatado } from '../loja/ContaCliente';
import { manterAbaVisivel, useNavegacaoCardapio } from '../../lib/navegacaoCardapio';
import { bumpsVistos, escolherBump, juntarBump, marcarBumpVisto, soltarBumpsSozinhos, type BumpCardapio, type EscopoBump, type ExtraBump, type OfertaBump, type SugestoesBump } from '../../lib/orderBump';
import { CorpoOrderBump } from '../../componentes/OrderBump';
import '../../estilos/mesa.css';

/** Jogo da memória no topo do cardápio da mesa (para tirar: false). */
const JOGO_NA_MESA = true;

export interface ProdutoMesa {
  id: string;
  categoria_id: string;
  /** Por que não está disponível: sem preço (R$ 0) ou esgotado */
  motivo?: 'sem_preco' | 'esgotado' | null;
  nome: string;
  descricao: string;
  preco: number;
  /** Preço "de" (riscado) quando está em promoção */
  preco_de?: number | null;
  /** Mais fotos e vídeos do produto */
  galeria?: { tipo: 'imagem' | 'video'; url: string }[];
  /** Sugestão do campo de observação (se vazio, o sistema sugere pelo nome) */
  dica_obs?: string | null;
  emoji: string | null;
  imagem_url: string | null;
  video_url: string | null;
  capa: 'imagem' | 'video';
  vegetariano: boolean;
  picancia: number;
  destaque: boolean;
  novo: boolean;
  disponivel: boolean;
  estoque_max: number | null;
  /** Sabor dentro de um tamanho (ex.: Calabresa na Pizza P): id real do sabor, id do tamanho e nome do tamanho */
  real_id?: string;
  tamanho_id?: string;
  prefixo?: string;
}

export interface SaborMesa extends ProdutoMesa { grupo_id: string }

/** O que o cliente escolheu nos grupos de adicionais de um item. */
export interface AdicionaisEscolhidos { escolhas: Escolha[]; extra: number; texto: string }

/** O cartão roda o vídeo quando ele é a capa escolhida ou quando o produto não tem foto. */
export const capaEmVideo = (p: { video_url: string | null; imagem_url: string | null; capa: string }) =>
  !!p.video_url && (p.capa === 'video' || !p.imagem_url);

/** Nome do item no pedido: "Pizza P · Calabresa" quando é sabor de um tamanho. */
export const nomeItem = (p: ProdutoMesa) => (p.prefixo ? `${p.prefixo} · ${p.nome}` : p.nome);

export interface CategoriaMesa { id: string; nome: string; emoji: string | null; pai_id?: string | null; grupo_id?: string | null; preco_grupo?: number | null; esgotado?: boolean }

interface DadosMesa {
  restaurante: { id: string; nome: string; slogan: string | null; logo_url: string | null; cor: string; capa_url?: string | null; capa_video_url?: string | null };
  mesa: { id: string; nome: string };
  categorias: CategoriaMesa[];
  produtos: ProdutoMesa[];
  sabores?: SaborMesa[];
  adicionais_grupos?: GrupoAdicionalMesa[];
  produto_grupos?: Record<string, string[]>;
  /** A loja escolheu esconder os esgotados (Configurações › Cardápio digital) */
  ocultar_esgotados?: boolean;
  /** Ofertas do Alavancar vendas (order bump) */
  bumps?: BumpCardapio[];
  bump_auto?: SugestoesBump;
}

/** Linha do carrinho. Com adicionais, guarda a escolha, o acréscimo e o texto para mostrar. */
export interface Linha {
  chave: string; produto_id: string; qtd: number; obs: string; adicionais?: Escolha[]; extra?: number; texto?: string;
  /** Veio de uma oferta (order bump): preço com o desconto dela */
  bump_id?: string; preco_bump?: number;
  /** Até quantas unidades a oferta vale */
  max_bump?: number;
}

/** Preço de uma unidade da linha (produto + adicionais; com o preço da oferta quando veio do order bump). */
export const precoLinha = (l: Linha, p?: ProdutoMesa) => (p ? (l.preco_bump ?? Number(p.preco)) + (l.extra ?? 0) : 0);

/** Ofertas do order bump para um item (mesa e delivery usam a mesma regra). */
export function ofertaPara(p: ProdutoMesa, d: { bumps?: BumpCardapio[]; bump_auto?: SugestoesBump; categorias: CategoriaMesa[]; adicionais_grupos?: GrupoAdicionalMesa[]; produto_grupos?: Record<string, string[]> } | null,
  produtos: ProdutoMesa[], carrinho: Linha[], canal: 'mesa' | 'delivery', escopo: EscopoBump): OfertaBump | null {
  if (!d?.bumps?.length) return null;
  const o = escolherBump({
    produto: p, bumps: d.bumps, sugestoes: d.bump_auto, produtos, categorias: d.categorias,
    grupos: d.adicionais_grupos, produtoGrupos: d.produto_grupos, canal, carrinho, jaVistas: bumpsVistos(escopo),
  });
  return o && { ...o, escopo };
}

/** Nova linha (ou soma na igual): mesma combinação de item, observação e adicionais. */
export function juntarNoCarrinho(c: Linha[], p: ProdutoMesa, qtd: number, obs: string, a?: AdicionaisEscolhidos): Linha[] {
  const chave = `${p.id}|${obs}|${chaveEscolhas(a?.escolhas)}`;
  return c.some((l) => l.chave === chave)
    ? c.map((l) => (l.chave === chave ? { ...l, qtd: l.qtd + qtd } : l))
    : [...c, { chave, produto_id: p.id, qtd, obs, ...(a ? { adicionais: a.escolhas, extra: a.extra, texto: a.texto } : {}) }];
}

interface Conta {
  total: number;
  pedidos: { id: string; numero: number; status: StatusPedido; total: number; criado_em: string; itens: { nome: string; qtd: number; preco: number; obs: string | null; complementos?: string | null }[] }[];
}

/** Situação deste aparelho: só pede depois que a equipe libera a mesa. */
type Acesso = 'carregando' | 'equipe' | 'liberado' | 'pendente' | 'recusado' | 'nenhum' | 'em_uso';
const semAcesso = (a: Acesso) => a === 'nenhum' || a === 'em_uso';

interface Secao extends CategoriaMesa { diretos: ProdutoMesa[]; subs: CategoriaMesa[]; total: number }

const INATIVIDADE_MS = 5 * 60 * 1000;
const DESTAQUES = '__destaques';
const OUTRAS = '__outras';
const ehMesaFechada = (e: unknown) => /MESA_FECHADA/.test(msgErro(e));

/** Altura real da tela (o 100vh dos iPhones antigos passa por baixo da barra do Safari). */
function useAlturaTela() {
  useEffect(() => {
    const aplicar = () => document.documentElement.style.setProperty('--altura-tela', `${window.innerHeight}px`);
    aplicar();
    window.addEventListener('resize', aplicar);
    window.addEventListener('orientationchange', aplicar);
    return () => {
      window.removeEventListener('resize', aplicar);
      window.removeEventListener('orientationchange', aplicar);
    };
  }, []);
}

export default function Mesa() {
  const curto = useLinkCurto();
  const params = useParams();
  const token = curto?.token ?? params.token ?? '';
  const base = curto?.base ?? `/mesa/${token}`;
  const navegar = useNavigate();
  const toast = useToast();
  const dispositivo = useMemo(idDispositivo, []);
  const [dados, setDados] = useState<DadosMesa | null>(null);
  const [erro, setErro] = useState('');
  const [carrinho, setCarrinho] = useState<Linha[]>(() => ls.ler(`bf:carrinho:${token}`, []));
  const [obsPedido, setObsPedido] = useState('');
  const [produtoAberto, setProdutoAberto] = useState<ProdutoMesa | null>(null);
  const [verCarrinho, setVerCarrinho] = useState(false);
  const [verConta, setVerConta] = useState(false);
  const [verChamado, setVerChamado] = useState(false);
  const [verJogo, setVerJogo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<number[] | null>(null);
  const [acesso, setAcesso] = useState<Acesso>('carregando');
  const [visita, setVisita] = useState<string | null>(null);
  const [verAbrir, setVerAbrir] = useState(false);
  const [pedindoAcesso, setPedindoAcesso] = useState(false);
  const acaoDepois = useRef<(() => void) | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  // Lembra a subcategoria e a posição de cada categoria (voltar não recomeça do topo)
  const { catAtiva, subAtiva, escolherCategoria: irCategoria, abrirSub, zerar: zerarNavegacao, atual: navAtual } = useNavegacaoCardapio(listaRef);
  const catsRef = useRef<HTMLElement>(null);
  useAlturaTela();
  const cancelados = useAvisosCancelamento(token, dispositivo, acesso === 'liberado' || acesso === 'equipe');
  // "Adicionar à tela de início" guarda esta mesa (e não o painel do sistema)
  useAppInstalavel(dados ? {
    nome: `${dados.mesa.nome} · ${dados.restaurante.nome}`,
    curto: dados.mesa.nome,
    inicio: base,
    escopo: base,
  } : null);

  const podePedir = acesso === 'liberado' || acesso === 'equipe';

  const carregar = useCallback(async (silencioso = false) => {
    const { data, error } = await supabase.rpc('mesa_cardapio', { p_token: token });
    if (error) {
      if (!silencioso) setErro(msgErro(error));
      return;
    }
    setDados(data as DadosMesa);
    setErro('');
  }, [token]);

  useEffect(() => {
    void carregar();
    const i = setInterval(() => void carregar(true), 60000);
    return () => clearInterval(i);
  }, [carregar]);
  // Mudou algo no painel (banner, preço, esgotado…): atualiza na hora
  useCardapioAoVivo(dados?.restaurante.id, () => void carregar(true));

  useEffect(() => ls.gravar(`bf:carrinho:${token}`, carrinho), [carrinho, token]);

  /* ---------- Liberação da mesa ---------- */
  const acessoRef = useRef<Acesso>('carregando');
  const consultarAcesso = useCallback(async () => {
    const { data, error } = await supabase.rpc('mesa_acesso_status', { p_token: token, p_dispositivo: dispositivo });
    if (error) return;
    // A equipe trocou o cliente de mesa: o cardápio (e o pedido em montagem) seguem para a mesa nova
    if (typeof data === 'string' && data.startsWith('movido:')) {
      const novoToken = data.slice(7);
      ls.gravar(`bf:carrinho:${novoToken}`, carrinhoRef.current);
      acessoRef.current = 'liberado';
      setAcesso('liberado');
      toast('Sua conta foi transferida para a nova mesa. Pode continuar pedindo.', 'ok');
      navegar(`/mesa/${novoToken}`, { replace: true });
      return;
    }
    const novo = data as Acesso;
    const antes = acessoRef.current;
    acessoRef.current = novo;
    setAcesso(novo);
    // Visita desta mesa (order bump): muda quando a mesa é liberada de novo ou a conta é fechada
    if (novo === 'liberado' || novo === 'equipe') {
      void supabase.rpc('mesa_visita', { p_token: token, p_dispositivo: dispositivo })
        .then(({ data: v }) => { if (typeof v === 'string') setVisita(v); });
    }
    if (antes === 'carregando' && semAcesso(novo)) setVerAbrir(true); // boas-vindas: solicitar acesso
    if (antes === 'pendente' && novo === 'liberado') {
      toast('Mesa liberada! Já pode fazer seu pedido.', 'ok');
      setVerAbrir(false);
      const acao = acaoDepois.current;
      acaoDepois.current = null;
      acao?.();
    }
    if (antes === 'liberado' && semAcesso(novo)) toast('A conta desta mesa foi fechada. Obrigado pela visita!', 'info');
  }, [token, dispositivo, toast, navegar]);

  useEffect(() => {
    void consultarAcesso();
    // Esperando o garçom: confere rápido; depois, de tempos em tempos (a conta pode ter sido fechada)
    const i = setInterval(() => void consultarAcesso(), acesso === 'pendente' ? 3000 : 20000);
    const aoVoltar = () => document.visibilityState === 'visible' && void consultarAcesso();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(i);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [consultarAcesso, acesso]);

  async function pedirAbertura(cliente?: { nome: string; telefone: string }) {
    setPedindoAcesso(true);
    const salvo = ls.ler<{ nome: string; telefone: string }>('bf:cliente-mesa', { nome: '', telefone: '' });
    const quem = cliente ?? salvo;
    if (cliente) ls.gravar('bf:cliente-mesa', cliente);
    const { data, error } = await supabase.rpc('mesa_acesso_pedir', {
      p_token: token, p_dispositivo: dispositivo, p_aparelho: descreverAparelho(),
      p_nome: quem.nome.trim() || null, p_telefone: quem.telefone.replace(/\D/g, '') || null,
    });
    setPedindoAcesso(false);
    if (error) return toast(msgErro(error), 'erro');
    acessoRef.current = data as Acesso;
    setAcesso(data as Acesso);
    if (data === 'liberado' || data === 'equipe') {
      setVerAbrir(false);
      const acao = acaoDepois.current;
      acaoDepois.current = null;
      acao?.();
    }
  }

  /** Ações que só valem com a mesa liberada (pedir, chamar, ver a conta). */
  function exigirMesaAberta(acao: () => void) {
    if (podePedir) return acao();
    acaoDepois.current = acao;
    setVerAbrir(true);
  }

  const mesaFechou = () => {
    acessoRef.current = 'nenhum';
    setAcesso('nenhum');
    setVerAbrir(true);
  };

  /* ---------- Carrinho ---------- */
  // Tamanhos ligados a um grupo mostram os sabores do grupo com o preço do tamanho (+ acréscimo do sabor)
  const saboresPorCategoria = useMemo(() => {
    const mapa = new Map<string, ProdutoMesa[]>();
    for (const c of dados?.categorias ?? []) {
      if (!c.grupo_id) continue;
      mapa.set(c.id, (dados?.sabores ?? []).filter((x) => x.grupo_id === c.grupo_id && (!dados?.ocultar_esgotados || (x.disponivel && !c.esgotado))).map((x) => ({
        ...x,
        id: `${c.id}:${x.id}`,
        categoria_id: c.id,
        disponivel: x.disponivel && !c.esgotado,
        preco: Number(c.preco_grupo ?? 0) + Number(x.preco),
        real_id: x.id,
        tamanho_id: c.id,
        prefixo: c.nome,
      })));
    }
    return mapa;
  }, [dados]);
  // Subcategoria com preço (ex.: Pizza P R$ 50): o item custa o preço dela + o acréscimo dele
  const produtosMesa = useMemo(() => {
    const cats = new Map((dados?.categorias ?? []).map((c) => [c.id, c]));
    // Esgotados escondidos quando a loja escolheu "Ocultar do cardápio"
    return (dados?.produtos ?? []).filter((p) => !dados?.ocultar_esgotados || p.disponivel).map((p) => {
      const c = cats.get(p.categoria_id);
      return c?.preco_grupo != null ? { ...p, preco: Number(c.preco_grupo) + Number(p.preco), prefixo: c.nome } : p;
    });
  }, [dados]);
  const porId = useMemo(() => new Map([
    ...produtosMesa.map((p) => [p.id, p] as const),
    ...[...saboresPorCategoria.values()].flat().map((p) => [p.id, p] as const),
  ]), [produtosMesa, saboresPorCategoria]);

  // Tira do carrinho o que esgotou ou saiu do cardápio
  const carrinhoRef = useRef(carrinho);
  carrinhoRef.current = carrinho;
  const novaVersao = useNovaVersao();
  const novaVersaoRef = useRef(novaVersao);
  novaVersaoRef.current = novaVersao;
  useEffect(() => {
    if (!dados) return;
    const atual = carrinhoRef.current;
    const validos = atual.filter((l) => porId.get(l.produto_id)?.disponivel);
    if (validos.length !== atual.length) {
      setCarrinho(validos);
      toast('Alguns itens esgotaram e saíram do seu pedido.', 'info');
    }
  }, [dados, porId, toast]);

  // Volta ao estado inicial depois de alguns minutos sem uso (próximo cliente)
  useEffect(() => {
    let ultimo = Date.now();
    const marcar = () => { ultimo = Date.now(); };
    window.addEventListener('pointerdown', marcar);
    window.addEventListener('keydown', marcar);
    window.addEventListener('scroll', marcar, true);
    const i = setInterval(() => {
      // Atualização do sistema: aplica sozinha quando o tablet está parado e sem pedido em montagem
      if (novaVersaoRef.current && Date.now() - ultimo > 60000 && carrinhoRef.current.length === 0) {
        window.location.reload();
        return;
      }
      if (Date.now() - ultimo < INATIVIDADE_MS) return;
      ultimo = Date.now();
      setCarrinho((c) => (c.length ? [] : c));
      setObsPedido('');
      setProdutoAberto(null);
      setVerCarrinho(false);
      setVerConta(false);
      setVerJogo(false);
      setConfirmar(false);
      zerarNavegacao();
    }, 30000);
    return () => {
      window.removeEventListener('pointerdown', marcar);
      window.removeEventListener('keydown', marcar);
      window.removeEventListener('scroll', marcar, true);
      clearInterval(i);
    };
  }, []);

  // Mantém a tela do tablet acesa
  useEffect(() => {
    let trava: WakeLockSentinel | null = null;
    const pedir = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') trava = await navigator.wakeLock.request('screen');
      } catch { /* sem suporte */ }
    };
    void pedir();
    document.addEventListener('visibilitychange', pedir);
    window.addEventListener('pointerdown', pedir, { once: true });
    return () => {
      document.removeEventListener('visibilitychange', pedir);
      void trava?.release();
    };
  }, []);

  const total = carrinho.reduce((s, l) => s + precoLinha(l, porId.get(l.produto_id)) * l.qtd, 0);
  const qtdItens = carrinho.reduce((s, l) => s + l.qtd, 0);
  const qtdDoProduto = (id: string) => carrinho.filter((l) => l.produto_id === id).reduce((s, l) => s + l.qtd, 0);
  // Order bump: escolhida quando o item abre (não muda enquanto a janela está aberta)
  const ofertaAberta = useMemo(
    () => (produtoAberto ? ofertaPara(produtoAberto, dados, produtosMesa, carrinho, 'mesa', { grupo: `mesa:${token}`, visita: visita ?? `antes:${dispositivo}` }) : null),
    [produtoAberto?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );

  function adicionar(p: ProdutoMesa, qtd: number, obs: string, a?: AdicionaisEscolhidos, extras: ExtraBump[] = []) {
    if (!p.disponivel) return; // esgotado: só para ver
    setCarrinho((c) => extras.reduce(juntarBump, juntarNoCarrinho(c, p, qtd, obs, a)));
    const n = extras.reduce((s, e) => s + e.qtd, 0);
    toast(`${qtd}× ${nomeItem(p)}${n ? ` + ${n} da oferta` : ''} no seu pedido`, 'ok');
  }
  // Oferta só vale junto com outro item: se sobrar só ela, volta ao preço normal
  useEffect(() => {
    const ok = soltarBumpsSozinhos(carrinho);
    if (ok !== carrinho) setCarrinho(ok);
  }, [carrinho]);

  function mudarQtd(chave: string, qtd: number) {
    setCarrinho((c) => (qtd <= 0 ? c.filter((l) => l.chave !== chave) : c.map((l) => (l.chave === chave ? { ...l, qtd } : l))));
  }

  async function enviar() {
    destravarSom(); // ainda dentro do toque: libera o áudio do celular
    setEnviando(true);
    const { data, error } = await rpcSeguro(supabase, 'mesa_pedido_enviar', {
      p_token: token,
      p_dispositivo: dispositivo,
      p_itens: carrinho.map((l) => {
        const p = porId.get(l.produto_id);
        return { produto_id: p?.real_id ?? l.produto_id, categoria_id: p?.tamanho_id ?? null, qtd: l.qtd, obs: l.obs, adicionais: l.adicionais ?? [], bump_id: l.bump_id ?? null };
      }),
      p_obs: obsPedido,
    });
    setEnviando(false);
    setConfirmar(false);
    if (error) {
      if (ehMesaFechada(error)) {
        acaoDepois.current = () => setConfirmar(true);
        return mesaFechou();
      }
      toast(msgErro(error), 'erro');
      void carregar(true);
      return;
    }
    setCarrinho([]);
    setObsPedido('');
    setVerCarrinho(false);
    const r = data as { numero: number; numeros?: number[] };
    setSucesso(r.numeros?.length ? r.numeros : [r.numero]);
    tocarEnviado();
    void carregar(true);
  }

  async function chamar(tipo: 'garcom' | 'conta', motivo?: string, detalhe?: string) {
    const { error } = await supabase.rpc('mesa_chamado_enviar', {
      p_token: token, p_dispositivo: dispositivo, p_tipo: tipo, p_motivo: motivo ?? null, p_detalhe: detalhe ?? null,
    });
    if (error) {
      if (ehMesaFechada(error)) mesaFechou();
      else toast(msgErro(error), 'erro');
      return false;
    }
    toast(tipo === 'conta' ? 'Pedimos a sua conta! Já já alguém vem até a mesa.' : 'Garçom chamado! Já já alguém vem até você.', 'ok');
    return true;
  }

  function escolherCategoria(id: string, sub = '', doInicio = false) {
    irCategoria(id, sub, doInicio);
    // No celular, deixa a categoria escolhida visível na barra
    catsRef.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (erro && !dados) {
    return (
      <div className="mesa-erro">
        <span className="mesa-erro__icone"><UtensilsCrossed size={44} strokeWidth={1.5} /></span>
        <h1 className="titulo">Ops, este cardápio não abriu</h1>
        <p>{erro}</p>
        <p className="muted">Por favor, chame um atendente.</p>
        <button className="btn btn--primario btn--lg" onClick={() => void carregar()}>Tentar de novo</button>
      </div>
    );
  }
  if (!dados) return <Carregando texto="Carregando cardápio…" />;

  const { restaurante, mesa, categorias } = dados;
  const produtos = produtosMesa;
  // Categorias principais; as subcategorias (ex.: Comida › Pratos) aparecem dentro delas
  const principais = categorias.filter((c) => !c.pai_id || !categorias.some((x) => x.id === c.pai_id));
  const produtosDe = (id: string) => [...(saboresPorCategoria.get(id) ?? []), ...produtos.filter((p) => p.categoria_id === id)];
  const subsDe = (id: string) => categorias.filter((c) => c.pai_id === id && produtosDe(c.id).length > 0);
  const destaques = produtos.filter((p) => p.destaque);
  const secoes: Secao[] = [
    ...(destaques.length ? [{ id: DESTAQUES, nome: 'Mais pedidos', emoji: null, diretos: destaques, subs: [], total: destaques.length }] : []),
    ...principais
      .map((c) => {
        const subs = subsDe(c.id);
        const diretos = produtosDe(c.id);
        return { ...c, diretos, subs, total: diretos.length + subs.reduce((s, x) => s + produtosDe(x.id).length, 0) };
      })
      .filter((c) => c.total > 0),
  ];
  const secao = secoes.find((c) => c.id === catAtiva) ?? secoes[0];
  const abas = secao ? [
    ...secao.subs.map((sub) => {
      const itens = produtosDe(sub.id);
      const precos = itens.map((x) => Number(x.preco));
      const menor = precos.length ? Math.min(...precos) : 0;
      return { id: sub.id, nome: sub.nome, emoji: sub.emoji, preco: menor, aPartir: precos.some((x) => x !== menor) };
    }),
    ...(secao.subs.length && secao.diretos.length ? [{ id: OUTRAS, nome: 'Outras opções', emoji: null, preco: 0, aPartir: false }] : []),
  ] : [];
  // Ao abrir a categoria, a primeira subcategoria já aparece (um toque só)
  const abaAtual = abas.some((a) => a.id === subAtiva) ? subAtiva : abas[0]?.id ?? '';
  navAtual.current = { cat: secao?.id ?? '', sub: abaAtual };
  const emojiCat = (c: { id: string; emoji: string | null }) =>
    c.id === DESTAQUES ? <Star size={18} fill="currentColor" /> : c.emoji;

  const grade = (lista: ProdutoMesa[]) => (
    <div className="mesa__grade">
      {lista.map((p) => {
        const noCarrinho = qtdDoProduto(p.id);
        return (
          <button
            key={p.id}
            className={cx('prod', !p.disponivel && 'prod--esgotado')}
            onClick={() => setProdutoAberto(p)}
          >
            <div className="prod__midia">
              {capaEmVideo(p)
                ? <VideoCapa p={{ ...p, video_url: p.video_url! }} classe="prod__foto" />
                : <FotoProduto p={p} classe="prod__foto" />}
              {p.video_url && !capaEmVideo(p) && <span className="prod__video"><Play size={12} fill="currentColor" /> Vídeo</span>}
              {noCarrinho > 0 && <span className="prod__no-carrinho">{noCarrinho}</span>}
              {!p.disponivel && <span className="prod__esgotado">{p.motivo === 'sem_preco' ? 'Indisponível' : 'Esgotado'}</span>}
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

  const painelCarrinho = (
    <div className="carrinho">
      <h2 className="carrinho__titulo titulo">Seu pedido</h2>
      {carrinho.length === 0 ? (
        <div className="carrinho__vazio">
          <ShoppingBag size={36} />
          <p>Toque em um prato para adicionar.</p>
        </div>
      ) : (
        <>
          <ul className="carrinho__linhas">
            {carrinho.map((l) => {
              const p = porId.get(l.produto_id);
              if (!p) return null;
              return (
                <li key={l.chave} className="carrinho__linha">
                  <div className="carrinho__info">
                    <strong>{nomeItem(p)}{l.bump_id && <em className="carrinho__oferta">Oferta</em>}</strong>
                    {l.texto && <small className="carrinho__adic">{l.texto}</small>}
                    {l.obs && <small>“{l.obs}”</small>}
                    <span>{brl(precoLinha(l, p) * l.qtd)}</span>
                  </div>
                  <div className="carrinho__qtd">
                    <Stepper valor={l.qtd} min={0} max={l.bump_id ? (l.max_bump ?? 1) : p.estoque_max ?? 50} aoMudar={(v) => mudarQtd(l.chave, v)} />
                  </div>
                </li>
              );
            })}
          </ul>
          <label className="campo carrinho__obs">
            <span>Observação para a cozinha (opcional)</span>
            <textarea className="textarea" rows={2} maxLength={300} value={obsPedido} onChange={(e) => setObsPedido(e.target.value)} placeholder="Ex.: trazer as bebidas primeiro" />
          </label>
        </>
      )}
      <div className="carrinho__rodape">
        <div className="carrinho__total"><span>Total</span><strong>{brl(total)}</strong></div>
        <button className="btn btn--primario btn--lg btn--bloco" disabled={!carrinho.length} onClick={() => exigirMesaAberta(() => setConfirmar(true))}>
          {podePedir ? 'Enviar pedido' : <><Lock size={18} /> Enviar pedido</>}
        </button>
        {carrinho.length > 0 && (
          <button className="btn btn--fantasma btn--sm btn--bloco" onClick={() => setCarrinho([])}>
            <Trash2 size={16} /> Esvaziar
          </button>
        )}
      </div>
    </div>
  );

  const podeTelaCheia = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  return (
    <div className={cx('mesa', qtdItens > 0 && 'mesa--com-carrinho')} style={{ '--acento': restaurante.cor } as CSSProperties}>
      <header className="mesa__topo">
        <div className="mesa__marca">
          {restaurante.logo_url
            ? <img src={restaurante.logo_url} alt="" className="mesa__logo" />
            : <span className="mesa__logo mesa__logo--letra">{restaurante.nome.charAt(0)}</span>}
          <div>
            <strong>{restaurante.nome}</strong>
            <span>{mesa.nome}</span>
          </div>
        </div>
        <div className="mesa__acoes">
          {JOGO_NA_MESA && (
            <button className="btn btn--contorno mesa__acao mesa__jogar" onClick={() => setVerJogo(true)} aria-label="Jogar enquanto espera">
              <Gamepad2 size={20} /> <span className="mesa__rotulo">Jogar</span>
            </button>
          )}
          <button className="btn btn--contorno mesa__acao" onClick={() => exigirMesaAberta(() => setVerChamado(true))} aria-label="Chamar garçom">
            <ConciergeBell size={20} /> <span className="mesa__rotulo">Chamar garçom</span>
          </button>
          <button className="btn btn--contorno mesa__acao" onClick={() => exigirMesaAberta(() => setVerConta(true))} aria-label="Minha conta">
            <Receipt size={20} /> <span className="mesa__rotulo">Minha conta</span>
          </button>
          {podeTelaCheia && (
            <button className="icone-btn mesa__tela-cheia" onClick={telaCheia} aria-label="Tela cheia" title="Tela cheia">
              <Maximize size={20} />
            </button>
          )}
        </div>
      </header>

      <FaixaAcesso acesso={acesso} mesa={mesa.nome} aoAbrir={() => setVerAbrir(true)} />

      <CapaCardapio imagem={restaurante.capa_url} video={restaurante.capa_video_url} />

      <div className="mesa__corpo">
        <nav className="mesa__cats" aria-label="Categorias" ref={catsRef}>
          {/* Só as categorias; as subcategorias aparecem como abas no conteúdo */}
          {secoes.map((c) => (
            <Fragment key={c.id}>
              <button
                data-cat={c.id}
                className={cx('mesa__cat', secao?.id === c.id && 'ativa')}
                onClick={() => escolherCategoria(c.id)}
                aria-current={secao?.id === c.id ? 'true' : undefined}
              >
                <span className="mesa__cat-emoji" aria-hidden="true">{emojiCat(c)}</span>
                <span className="mesa__cat-nome">{c.nome}</span>
                <span className="mesa__cat-qtd">{c.total}</span>
              </button>
            </Fragment>
          ))}
        </nav>

        <main className="mesa__lista" ref={listaRef}>
          {secao ? (() => {
            const lista = abaAtual === OUTRAS || !secao.subs.length ? secao.diretos : produtosDe(abaAtual);
            const iAba = abas.findIndex((a) => a.id === abaAtual);
            const proximaAba = iAba >= 0 ? abas[iAba + 1] : undefined;
            const i = secoes.findIndex((c) => c.id === secao.id);
            const prox = secoes[i + 1];
            return (
              <section key={secao.id} className="mesa__secao">
                <header className="mesa__secao-cab">
                  <h2 className="titulo">
                    <span className="mesa__secao-emoji" aria-hidden="true">{emojiCat(secao)}</span> {secao.nome}
                  </h2>
                  <span>{lista.length} {lista.length === 1 ? 'opção' : 'opções'}</span>
                </header>

                {/* Subcategorias lado a lado (ex.: Pizza P | Pizza M | Pizza G) */}
                {abas.length > 1 && (
                  <div className="mesa__abas" role="tablist" ref={(el) => manterAbaVisivel(el, abaAtual)} aria-label={`Opções de ${secao.nome}`}>
                    {abas.map((a) => (
                      <button key={a.id} role="tab" aria-selected={abaAtual === a.id} className={cx('mesa__aba', abaAtual === a.id && 'ativa')} onClick={() => abrirSub(a.id)}>
                        <span>{a.emoji} {a.nome}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div key={abaAtual} className="mesa__troca">{grade(lista)}</div>

                {proximaAba ? (
                  <button className="mesa__proxima" onClick={() => abrirSub(proximaAba.id, true)}>
                    <span>Ver a seguir</span>
                    <strong>{proximaAba.emoji} {proximaAba.nome}</strong>
                    <ChevronRight size={20} />
                  </button>
                ) : prox ? (
                  /* Próxima categoria: o cliente não fica preso no fim da lista */
                  <button className="mesa__proxima" onClick={() => escolherCategoria(prox.id, '', true)}>
                    <span>Ver a seguir</span>
                    <strong>{emojiCat(prox)} {prox.nome}</strong>
                    <ChevronRight size={20} />
                  </button>
                ) : null}
              </section>
            );
          })() : (
            <p className="vazio">O cardápio ainda está sendo preparado. Chame um atendente.</p>
          )}
        </main>

        <aside className="mesa__carrinho">{painelCarrinho}</aside>
      </div>

      {qtdItens > 0 && (
        <button className="mesa__flutuante" onClick={() => setVerCarrinho(true)}>
          <span className="mesa__flutuante-qtd">{qtdItens}</span>
          <span>Ver meu pedido</span>
          <strong>{brl(total)}</strong>
        </button>
      )}

      <Modal aberto={verCarrinho} aoFechar={() => setVerCarrinho(false)} classe="mesa-modal">
        {painelCarrinho}
      </Modal>

      {produtoAberto && (
        <ModalProduto
          key={produtoAberto.id}
          p={produtoAberto}
          aoFechar={() => setProdutoAberto(null)}
          aoAdicionar={(qtd, obs, a, extras) => {
            adicionar(produtoAberto, qtd, obs, a, extras);
            setProdutoAberto(null);
          }}
          oferta={ofertaAberta}
          jaNoCarrinho={qtdDoProduto(produtoAberto.id)}
          grupos={gruposDoProduto(produtoAberto.real_id ?? produtoAberto.id, dados?.adicionais_grupos, dados?.produto_grupos)}
        />
      )}

      <Modal
        aberto={confirmar}
        aoFechar={() => !enviando && setConfirmar(false)}
        titulo="Confirmar pedido?"
        classe="mesa-modal"
        rodape={
          <>
            <button className="btn btn--contorno btn--lg" onClick={() => setConfirmar(false)} disabled={enviando}>Revisar</button>
            <button className="btn btn--primario btn--lg" onClick={() => void enviar()} disabled={enviando}>
              {enviando ? 'Enviando…' : `Confirmar · ${brl(total)}`}
            </button>
          </>
        }
      >
        <ul className="confirmar">
          {carrinho.map((l) => {
            const p = porId.get(l.produto_id);
            return p ? (
              <li key={l.chave}>
                <span><b>{l.qtd}×</b> {nomeItem(p)}{l.texto && <small> {l.texto}</small>}{l.obs && <small> “{l.obs}”</small>}</span>
                <span>{brl(precoLinha(l, p) * l.qtd)}</span>
              </li>
            ) : null;
          })}
        </ul>
        {obsPedido && <p className="muted">Obs.: {obsPedido}</p>}
      </Modal>

      {verConta && (
        <ModalConta
          token={token}
          dispositivo={dispositivo}
          aoFechar={() => setVerConta(false)}
          aoPedirConta={() => void chamar('conta')}
          aoMesaFechada={() => { setVerConta(false); mesaFechou(); }}
        />
      )}

      {verChamado && (
        <ModalChamarGarcom
          aoFechar={() => setVerChamado(false)}
          aoChamar={async (motivo, detalhe) => { if (await chamar('garcom', motivo, detalhe)) setVerChamado(false); }}
        />
      )}

      {verAbrir && acesso !== 'carregando' && !podePedir && (
        <ModalAbrirMesa
          acesso={acesso}
          mesa={mesa.nome}
          restaurante={restaurante.nome}
          enviando={pedindoAcesso}
          aoPedir={(cliente) => void pedirAbertura(cliente)}
          aoFechar={() => { setVerAbrir(false); if (acesso !== 'pendente') acaoDepois.current = null; }}
        />
      )}

      {sucesso !== null && <TelaSucesso numeros={sucesso} aoFechar={() => setSucesso(null)} aoJogar={JOGO_NA_MESA ? () => { setSucesso(null); setVerJogo(true); } : undefined} />}

      {verJogo && <JogoMemoria aoFechar={() => setVerJogo(false)} />}

      {cancelados.avisos.length > 0 && <AvisoCancelamento avisos={cancelados.avisos} aoFechar={cancelados.entendi} />}
    </div>
  );
}

/* ---------- Aviso de item cancelado pela equipe ---------- */
interface AvisoCancelado { id: string; nome: string; qtd: number; motivo: string | null; numero: number; pedido_inteiro: boolean; quando: string }

/** Confere de tempos em tempos se a equipe cancelou algo desta mesa (tablet e celulares liberados). */
function useAvisosCancelamento(token: string, dispositivo: string, ativo: boolean) {
  const chave = `bf:cancelados:${token}`;
  const [avisos, setAvisos] = useState<AvisoCancelado[]>([]);
  const mostrados = useRef(new Set<string>());

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    const ler = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data, error } = await supabase.rpc('mesa_cancelamentos', { p_token: token, p_dispositivo: dispositivo });
      if (error || !vivo) return;
      const lista = (data ?? []) as AvisoCancelado[];
      const vistos = ls.ler<string[] | null>(chave, null);
      // Primeira vez neste aparelho: o que já tinha acontecido não vira aviso
      if (vistos === null) { ls.gravar(chave, lista.map((x) => x.id)); return; }
      const novos = lista.filter((x) => !vistos.includes(x.id) && !mostrados.current.has(x.id));
      if (!novos.length) return;
      novos.forEach((x) => mostrados.current.add(x.id));
      tocarAviso();
      setAvisos((a) => [...a, ...novos]);
    };
    void ler();
    const i = setInterval(() => void ler(), 8000);
    const aoVoltar = () => void ler();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      vivo = false;
      clearInterval(i);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [token, dispositivo, ativo, chave]);

  const entendi = useCallback(() => {
    setAvisos((a) => {
      const vistos = ls.ler<string[]>(chave, []);
      ls.gravar(chave, [...new Set([...vistos, ...a.map((x) => x.id)])].slice(-200));
      return [];
    });
  }, [chave]);

  return { avisos, entendi };
}

function AvisoCancelamento({ avisos, aoFechar }: { avisos: AvisoCancelado[]; aoFechar: () => void }) {
  const varios = avisos.length > 1;
  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      largura={460}
      classe="mesa-modal aviso-cancel"
      rodape={<button className="btn btn--primario btn--lg btn--bloco" onClick={aoFechar} autoFocus>Entendi</button>}
    >
      <div className="aviso-cancel__topo">
        <span className="aviso-cancel__icone" aria-hidden="true"><Ban size={30} strokeWidth={1.8} /></span>
        <h2>{varios ? `${avisos.length} itens foram cancelados` : 'Um item foi cancelado'}</h2>
        <p>{varios ? 'Eles não serão cobrados na sua conta.' : 'Ele não será cobrado na sua conta.'}</p>
      </div>
      <ul className="aviso-cancel__lista">
        {avisos.map((a) => (
          <li key={a.id}>
            <span className="aviso-cancel__qtd">{a.qtd}×</span>
            <span>{fraseCancelamento(a.nome, a.motivo)}</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Faixa no topo enquanto a mesa não está liberada para este aparelho. */
function FaixaAcesso({ acesso, mesa, aoAbrir }: { acesso: Acesso; mesa: string; aoAbrir: () => void }) {
  if (acesso === 'liberado' || acesso === 'equipe' || acesso === 'carregando') return null;
  if (acesso === 'pendente') {
    return (
      <button className="faixa-acesso faixa-acesso--pendente" onClick={aoAbrir}>
        <span className="faixa-acesso__pulso" aria-hidden="true" />
        <span><b>Aguardando o garçom liberar a {mesa}.</b> Enquanto isso, vá escolhendo.</span>
      </button>
    );
  }
  return (
    <button className={cx('faixa-acesso', acesso === 'recusado' && 'faixa-acesso--recusado')} onClick={aoAbrir}>
      <Lock size={16} />
      <span>
        {acesso === 'recusado'
          ? <><b>Acesso não liberado.</b> Se você está no restaurante, chame um atendente.</>
          : acesso === 'em_uso'
            ? <><b>Mesa em uso.</b> Toque para solicitar acesso.</>
            : <><b>Para pedir, solicite o acesso à mesa.</b> O garçom libera em instantes.</>}
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

/** Boas-vindas e liberação: o cliente pede, o garçom confirma que ele está mesmo no restaurante. */
function ModalAbrirMesa({ acesso, mesa, restaurante, enviando, aoPedir, aoFechar }: {
  acesso: Acesso;
  mesa: string;
  restaurante: string;
  enviando: boolean;
  aoPedir: (cliente?: { nome: string; telefone: string }) => void;
  aoFechar: () => void;
}) {
  // Nome e WhatsApp são opcionais: o garçom vê quem está pedindo e a loja ganha o contato
  const [cliente, setCliente] = useState(() => ls.ler('bf:cliente-mesa', { nome: '', telefone: '' }));
  const telDigitos = cliente.telefone.replace(/\D/g, '');
  const telInvalido = telDigitos.length > 0 && (telDigitos.length < 10 || telDigitos.length > 11);
  const camposCliente = (
    <div className="abrir-mesa__quem">
      <label className="campo">
        <span>Seu nome <small>(opcional)</small></span>
        <input className="input" value={cliente.nome} maxLength={60} autoComplete="given-name" placeholder="Como podemos te chamar"
          onChange={(e) => setCliente({ ...cliente, nome: e.target.value })} />
      </label>
      <label className="campo">
        <span>WhatsApp <small>(opcional)</small></span>
        <input className="input" value={telefoneFormatado(cliente.telefone)} inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000"
          onChange={(e) => setCliente({ ...cliente, telefone: e.target.value.replace(/\D/g, '').slice(0, 11) })} />
      </label>
      {telInvalido && <small className="abrir-mesa__aviso">Confira o WhatsApp com DDD, ou deixe em branco.</small>}
    </div>
  );
  return (
    <Modal aberto aoFechar={aoFechar} classe="mesa-modal abrir-mesa" largura={460}>
      {acesso === 'pendente' ? (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone abrir-mesa__icone--espera"><Hourglass size={34} /></span>
          <h2 className="titulo">Acesso solicitado</h2>
          <p>Assim que ele liberar a <b>{mesa}</b>, você já pode pedir. Leva só um instante.</p>
          <div className="abrir-mesa__espera" aria-live="polite"><span /><span /><span /></div>
          <button className="btn btn--contorno btn--lg btn--bloco" onClick={aoFechar}>Escolher enquanto espero</button>
        </div>
      ) : acesso === 'recusado' ? (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone abrir-mesa__icone--recusado"><XCircle size={36} /></span>
          <h2 className="titulo">O acesso não foi liberado</h2>
          <p>Se você está no restaurante, chame um atendente para liberar a <b>{mesa}</b>.</p>
          <button className="btn btn--primario btn--lg btn--bloco" onClick={() => aoPedir()} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Solicitar de novo'}
          </button>
          <button className="btn btn--fantasma btn--bloco" onClick={aoFechar}>Só olhar o cardápio</button>
        </div>
      ) : acesso === 'em_uso' ? (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone"><Users size={34} /></span>
          <p className="abrir-mesa__sobre">{restaurante}</p>
          <h2 className="titulo">A {mesa} já está em uso</h2>
          <p>Se você está junto com quem abriu a mesa, solicite o acesso: o garçom libera este celular também.</p>
          {camposCliente}
          <button className="btn btn--primario btn--lg btn--bloco" onClick={() => aoPedir(cliente)} disabled={enviando || telInvalido}>
            {enviando ? 'Enviando…' : 'Solicitar acesso à mesa'}
          </button>
          <button className="btn btn--fantasma btn--bloco" onClick={aoFechar}>Só olhar o cardápio</button>
        </div>
      ) : (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone"><ShieldCheck size={36} /></span>
          <p className="abrir-mesa__sobre">{restaurante}</p>
          <h2 className="titulo">Bem-vindo à {mesa}!</h2>
          <p>Para começar a fazer pedidos, solicite o acesso à mesa. O garçom confirma em instantes que você está aqui no restaurante.</p>
          {camposCliente}
          <button className="btn btn--primario btn--lg btn--bloco" onClick={() => aoPedir(cliente)} disabled={enviando || telInvalido}>
            {enviando ? 'Enviando…' : 'Solicitar acesso à mesa'}
          </button>
          <button className="btn btn--fantasma btn--bloco" onClick={aoFechar}>Só olhar o cardápio</button>
        </div>
      )}
    </Modal>
  );
}

export function ModalProduto({ p, aoFechar, aoAdicionar, jaNoCarrinho, semObs, grupos = [], oferta }: {
  p: ProdutoMesa;
  aoFechar: () => void;
  aoAdicionar: (qtd: number, obs: string, adicionais?: AdicionaisEscolhidos, extras?: ExtraBump[]) => void;
  jaNoCarrinho: number;
  /** Loja desligou o campo de observação */
  semObs?: boolean;
  /** Grupos de adicionais ligados ao produto (ex.: Sabores) */
  grupos?: GrupoAdicionalMesa[];
  /** Order bump: oferta que aparece depois de "Adicionar", antes de ir para o carrinho */
  oferta?: OfertaBump | null;
}) {
  const [naOferta, setNaOferta] = useState(false);
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState('');
  const [escolhas, setEscolhas] = useState<Escolha[]>([]);
  const [tentou, setTentou] = useState(false);
  const max = p.estoque_max !== null ? Math.max(0, p.estoque_max - jaNoCarrinho) : 50;
  const calc = calcularAdicionais(grupos, escolhas);
  const unitario = Number(p.preco) + calc.extra;

  const qtdDe = (id: string) => escolhas.find((e) => e.id === id)?.qtd ?? 0;
  const totalGrupo = (g: GrupoAdicionalMesa) => g.opcoes.reduce((s, o) => s + qtdDe(o.id), 0);
  // Adicionais em etapas (funil): um grupo por vez, na ordem cadastrada
  const [etapa, setEtapa] = useState(0);
  const passos = grupos.length;
  const ultima = passos === 0 || etapa >= passos - 1;
  const gAtual = passos ? grupos[Math.min(etapa, passos - 1)] : null;
  const subir = () => requestAnimationFrame(() => document.querySelector('.modal-produto .modal__corpo')?.scrollTo({ top: 0, behavior: 'smooth' }));
  function irPara(i: number) {
    setTentou(false);
    setEtapa(i);
    subir();
  }
  function avancar() {
    if (gAtual && totalGrupo(gAtual) < gAtual.minimo) { setTentou(true); return; }
    irPara(etapa + 1);
  }

  function mudar(g: GrupoAdicionalMesa, o: OpcaoAdicional, nova: number) {
    setEscolhas((atual) => {
      let l = atual;
      // Grupo de uma escolha só: trocar de opção substitui a anterior
      if (g.maximo === 1 && nova > 0) l = l.filter((e) => !g.opcoes.some((x) => x.id === e.id));
      l = l.filter((e) => e.id !== o.id);
      return nova > 0 ? [...l, { id: o.id, qtd: nova }] : l;
    });
  }

  function confirmar() {
    if (calc.faltando) {
      // Volta para a etapa que ficou sem escolha
      const i = grupos.findIndex((g) => totalGrupo(g) < g.minimo);
      if (i >= 0 && i !== etapa) setEtapa(i);
      setTentou(true);
      subir();
      return;
    }
    // Order bump: antes de ir para o carrinho, mostra a oferta (uma vez por visita)
    if (oferta && !naOferta) {
      setNaOferta(true);
      if (oferta.escopo) marcarBumpVisto(oferta.bump.id, oferta.escopo);
      void supabase.rpc('bump_exibido', { p_bump: oferta.bump.id }).then(() => undefined);
      subir();
      return;
    }
    finalizar(false);
  }

  function finalizar(comOferta: boolean, escolha = extras) {
    const lista: ExtraBump[] = comOferta && oferta
      ? oferta.itens.filter((i) => escolha[i.p.id] > 0).map((i) => ({ p: i.p, qtd: escolha[i.p.id], preco: i.preco, bump_id: oferta.bump.id, max: oferta.bump.max_qtd ?? 1 }))
      : [];
    aoAdicionar(qtd, obs.trim(), grupos.length ? { escolhas, extra: calc.extra, texto: calc.texto } : undefined, lista);
  }
  const totalExtras = oferta ? oferta.itens.reduce((s, i) => s + i.preco * (extras[i.p.id] ?? 0), 0) : 0;
  const qtdExtras = Object.values(extras).reduce((s, n) => s + n, 0);

  const grupo = (g: GrupoAdicionalMesa) => {
    const total = totalGrupo(g);
    const cheio = total >= g.maximo;
    const falta = total < g.minimo;
    return (
      <section key={g.id} className={cx('adic-grupo', 'funil-entra', tentou && falta && 'falta')}>
        <header className="adic-grupo__cab">
          <div>
            <strong>{g.nome}</strong>
            <small>{regraGrupo(g)}{g.calculo !== 'soma' && g.maximo > 1 ? ` · ${g.calculo === 'maior' ? 'vale o preço do mais caro' : 'vale a média dos preços'}` : ''}</small>
          </div>
          <span className="adic-grupo__contagem">{total}/{g.maximo}</span>
          {g.minimo > 0 && <span className={cx('adic-grupo__selo', !falta && 'ok')}>{falta ? 'Obrigatório' : <><Check size={13} /> Pronto</>}</span>}
        </header>
        <ul className="adic-opcoes">
          {g.opcoes.map((o) => {
            const n = qtdDe(o.id);
            const bloqueada = !o.disponivel || (cheio && n === 0 && g.maximo > 1);
            const unico = g.maximo === 1;
            return (
              <li key={o.id} className={cx('adic-opcao', n > 0 && 'marcada', bloqueada && 'bloqueada')}>
                <button
                  type="button"
                  className="adic-opcao__toque"
                  disabled={bloqueada && n === 0}
                  onClick={() => (unico ? mudar(g, o, n ? 0 : 1) : o.repetir ? (!cheio && mudar(g, o, n + 1)) : mudar(g, o, n ? 0 : 1))}
                >
                  {o.imagem_url && <img src={o.imagem_url} alt="" className="adic-opcao__foto" />}
                  <span className="adic-opcao__texto">
                    <strong>{o.nome}</strong>
                    {o.descricao && <small>{o.descricao}</small>}
                    {!o.disponivel ? <em className="adic-opcao__esgotado">Esgotado</em> : Number(o.preco) > 0 && <em>+ {brl(Number(o.preco))}</em>}
                  </span>
                  {!(o.repetir && n > 0 && !unico) && <span className={cx('adic-opcao__marca', unico && 'radio')}>{n > 0 && <Check size={14} strokeWidth={3} />}</span>}
                </button>
                {o.repetir && n > 0 && !unico && (
                  <div className="adic-opcao__qtd">
                    <button type="button" onClick={() => mudar(g, o, n - 1)} aria-label={`Menos ${o.nome}`}><Minus size={15} /></button>
                    <span>{n}</span>
                    <button type="button" disabled={cheio} onClick={() => mudar(g, o, n + 1)} aria-label={`Mais ${o.nome}`}><Plus size={15} /></button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  const faltaAqui = !!gAtual && totalGrupo(gAtual) < gAtual.minimo;
  const pular = !!gAtual && gAtual.minimo === 0 && totalGrupo(gAtual) === 0;

  return (
    <Modal
      aberto
      // Fechou na tela da oferta: o item que ele já escolheu vai para o carrinho mesmo assim
      aoFechar={naOferta ? () => finalizar(false) : aoFechar}
      classe={cx('mesa-modal modal-produto', naOferta && 'modal-produto--oferta')}
      largura={620}
      rodape={
        <div className="modal-produto__rodape">
          {naOferta && oferta ? (
            <>
              <button type="button" className="btn btn--contorno btn--lg obump__nao" onClick={() => finalizar(false)}>Não, obrigado</button>
              {qtdExtras > 0 ? (
                <button type="button" className="btn btn--primario btn--lg obump__sim" onClick={() => finalizar(true)}>
                  Adicionar · {brl(unitario * qtd + totalExtras)}
                </button>
              ) : oferta.itens.length === 1 ? (
                // Uma oferta só: um toque e já entra no pedido
                <button type="button" className="btn btn--primario btn--lg obump__sim" onClick={() => finalizar(true, { [oferta.itens[0].p.id]: 1 })}>
                  {oferta.itens[0].preco === 0 ? 'Quero, é grátis!' : `Quero por ${brl(oferta.itens[0].preco)}`}
                </button>
              ) : (
                <button type="button" className="btn btn--primario btn--lg obump__sim" disabled>Toque em uma oferta</button>
              )}
            </>
          ) : !p.disponivel ? (
            // Esgotado/indisponível: dá para ver tudo do item, mas não para pedir
            <div className="modal-produto__indisponivel" role="status">
              <Ban size={18} />
              <span><b>{p.motivo === 'sem_preco' ? 'Indisponível no momento' : 'Esgotado no momento'}</b> Não dá para pedir este item agora.</span>
            </div>
          ) : !ultima ? (
            <>
              {etapa > 0 && (
                <button type="button" className="btn btn--contorno btn--lg funil-voltar" onClick={() => irPara(etapa - 1)} aria-label="Voltar para a etapa anterior">
                  <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
                </button>
              )}
              <button className={cx('btn btn--primario btn--lg funil-seguir', faltaAqui && 'btn--esperando')} onClick={avancar}>
                {pular ? `Pular ${gAtual!.nome.toLowerCase()}` : 'Continuar'}
                <small className="funil-seguir__prox">Próximo: {grupos[etapa + 1].nome}</small>
              </button>
            </>
          ) : (
            <>
              <Stepper valor={qtd} min={1} max={Math.max(1, max)} aoMudar={setQtd} grande />
              <button className={cx('btn btn--primario btn--lg', calc.faltando && 'btn--esperando')} disabled={max < 1} onClick={confirmar}>
                {max < 1 ? 'Sem mais unidades' : `Adicionar · ${brl(unitario * qtd)}`}
              </button>
            </>
          )}
        </div>
      }
    >
      {naOferta && oferta ? (
        <CorpoOrderBump
          oferta={oferta}
          escolhidos={extras}
          aoMudar={(id, n) => setExtras((e) => ({ ...e, [id]: n }))}
          item={{ nome: nomeItem(p) + (calc.texto ? ` (${calc.texto})` : ''), qtd, total: unitario * qtd, foto: p }}
        />
      ) : <>
      {etapa === 0 ? (
        <>
          <GaleriaProduto p={p} />
          {p.prefixo && <p className="modal-produto__tamanho">{p.prefixo}</p>}
          <h2 className="titulo modal-produto__nome">{p.nome}</h2>
          <Selos p={p} />
          <p className="modal-produto__desc">{p.descricao}</p>
          {p.motivo !== 'sem_preco' && <p className="modal-produto__preco">{brl(p.preco)}{calc.extra > 0 && <small> + {brl(calc.extra)} em adicionais</small>}</p>}
          {p.estoque_max !== null && p.estoque_max <= 5 && <p className="modal-produto__aviso">Últimas {p.estoque_max} unidades!</p>}
        </>
      ) : (
        /* Etapas seguintes: o produto fica resumido no topo, com o que já foi escolhido */
        <div className="funil-produto">
          <FotoProduto p={p} classe="funil-produto__foto" />
          <div className="funil-produto__info">
            <strong>{p.prefixo ? `${p.prefixo} · ${p.nome}` : p.nome}</strong>
            {calc.texto && <small>{calc.texto}</small>}
          </div>
          <b>{brl(unitario)}</b>
        </div>
      )}

      {passos > 1 && (
        <ol className="funil-passos" aria-label="Etapas">
          {grupos.map((g, i) => (
            <li key={g.id} className={cx(i < etapa && 'feito', i === etapa && 'atual')}>
              <button type="button" disabled={i > etapa} onClick={() => irPara(i)} aria-current={i === etapa ? 'step' : undefined}>
                <span>{i < etapa ? <Check size={12} strokeWidth={3} /> : i + 1}</span><em className="funil-passos__nome">{g.nome}</em>
              </button>
            </li>
          ))}
        </ol>
      )}

      {gAtual && grupo(gAtual)}
      {tentou && faltaAqui && <p className="adic-falta">{gAtual!.minimo === 1 ? `Escolha 1 opção em "${gAtual!.nome}" para continuar` : `Escolha pelo menos ${gAtual!.minimo} em "${gAtual!.nome}" para continuar`}</p>}
      {tentou && ultima && !faltaAqui && calc.faltando && <p className="adic-falta">{calc.faltando}</p>}

      {ultima && !semObs && p.disponivel && (
        <label className="campo">
          <span>Alguma observação?</span>
          <textarea className="textarea" rows={2} maxLength={140} value={obs} onChange={(e) => setObs(e.target.value)} placeholder={p.dica_obs || sugerirObs(p.nome, p.prefixo, p.descricao)} />
        </label>
      )}
      </>}
    </Modal>
  );
}

/** Capa do estabelecimento (vídeo ou foto deitada) em cima das categorias; recolhe ao rolar os produtos. */
export function CapaCardapio({ imagem, video }: { imagem?: string | null; video?: string | null }) {
  if (!imagem && !video) return null;
  return (
    <div className="capa-cardapio" aria-hidden="true">
      {video
        ? <video src={video} poster={imagem ?? undefined} autoPlay muted loop playsInline ref={(v) => { if (v) { v.muted = true; v.setAttribute('muted', ''); } }} />
        : <img src={imagem!} alt="" />}
    </div>
  );
}

/** Cor do fundo da foto: média das bordas (foto de fundo branco fica com fundo branco). */
const coresFundo = new Map<string, string>();
function useCorDeFundo(url: string | null) {
  const [cor, setCor] = useState(() => (url && coresFundo.get(url)) || '#ffffff');
  useEffect(() => {
    if (!url) return;
    if (coresFundo.has(url)) { setCor(coresFundo.get(url)!); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const n = 24;
        const c = document.createElement('canvas');
        c.width = n; c.height = n;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0, n, n);
        const d = g.getImageData(0, 0, n, n).data;
        let r = 0, gg = 0, b = 0, k = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          if (x > 1 && x < n - 2 && y > 1 && y < n - 2) continue; // só a moldura
          const i = (y * n + x) * 4;
          r += d[i]; gg += d[i + 1]; b += d[i + 2]; k++;
        }
        r /= k; gg /= k; b /= k;
        const v = r + gg + b > 690 ? '#ffffff' : `rgb(${Math.round(r)}, ${Math.round(gg)}, ${Math.round(b)})`;
        coresFundo.set(url, v);
        setCor(v);
      } catch { /* imagem de outro site sem permissão: fica branco */ }
    };
    img.src = url;
  }, [url]);
  return cor;
}

function SlideGaleria({ item, ativo, p }: { item: { tipo: 'imagem' | 'video'; url: string }; ativo: boolean; p: ProdutoMesa }) {
  const cor = useCorDeFundo(item.tipo === 'imagem' ? item.url : p.imagem_url);
  const ref = useRef<HTMLVideoElement>(null);
  const [larga, setLarga] = useState(() => midiasLargas.get(item.url) ?? false);
  const medir = (w: number, h: number) => {
    const v = h > 0 && w / h >= 1.5;
    midiasLargas.set(item.url, v);
    setLarga(v);
  };
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (ativo) void v.play().catch(() => {}); else v.pause();
  }, [ativo]);
  return (
    <div className={cx('galeria__item', larga && 'larga')} style={{ background: item.tipo === 'video' ? '#000' : cor }}>
      {item.tipo === 'video'
        ? <video ref={ref} src={item.url} poster={p.imagem_url ?? undefined} muted loop playsInline controls autoPlay={ativo} onLoadedMetadata={(e) => medir(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} />
        : <img src={item.url} alt={p.nome} draggable={false} onLoad={(e) => medir(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />}
    </div>
  );
}

/** Fotos/vídeos deitados (16:9) preenchem o quadro; quadrados ou em pé aparecem inteiros. */
const midiasLargas = new Map<string, boolean>();

/** Fotos e vídeos do produto, inteiros (sem cortar), deslizando para o lado. */
function GaleriaProduto({ p }: { p: ProdutoMesa }) {
  const itens = useMemo(() => {
    const capa = p.video_url && p.capa === 'video' ? [{ tipo: 'video' as const, url: p.video_url }] : [];
    const foto = p.imagem_url ? [{ tipo: 'imagem' as const, url: p.imagem_url }] : [];
    const video = p.video_url && p.capa !== 'video' ? [{ tipo: 'video' as const, url: p.video_url }] : [];
    const todos = [...capa, ...foto, ...video, ...(p.galeria ?? [])];
    return todos.filter((x, i) => todos.findIndex((y) => y.url === x.url) === i);
  }, [p]);
  const [atual, setAtual] = useState(0);
  const trilho = useRef<HTMLDivElement>(null);
  if (!itens.length) return <FotoProduto p={p} classe="modal-produto__foto" />;
  const ir = (i: number) => trilho.current?.scrollTo({ left: i * trilho.current.clientWidth, behavior: 'smooth' });
  return (
    <div className="galeria">
      <div className="galeria__trilho" ref={trilho} onScroll={(e) => setAtual(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {itens.map((x, i) => <SlideGaleria key={x.url} item={x} ativo={i === atual} p={p} />)}
      </div>
      {itens.length > 1 && (
        <>
          <button type="button" className="galeria__seta galeria__seta--esq" onClick={() => ir(Math.max(0, atual - 1))} disabled={atual === 0} aria-label="Anterior"><ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} /></button>
          <button type="button" className="galeria__seta galeria__seta--dir" onClick={() => ir(Math.min(itens.length - 1, atual + 1))} disabled={atual === itens.length - 1} aria-label="Próxima"><ChevronRight size={20} /></button>
          <div className="galeria__pontos">{itens.map((x, i) => <button key={x.url} type="button" className={cx(i === atual && 'ativo')} onClick={() => ir(i)} aria-label={`Ver ${i + 1}`} />)}</div>
        </>
      )}
    </div>
  );
}

/** Mesa com brilho de limpeza (não existe um ícone pronto que diga "limpar a mesa"). */
function IconeLimparMesa({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* tampo e pés da mesa */}
      <path d="M2.5 14h19" />
      <path d="M5 14v7" />
      <path d="M19 14v7" />
      <path d="M8.5 17.5h7" />
      {/* brilhos de limpo */}
      <path d="M11 3.5 12.1 6.4 15 7.5 12.1 8.6 11 11.5 9.9 8.6 7 7.5 9.9 6.4Z" />
      <path d="M18 3v3" />
      <path d="M16.5 4.5h3" />
    </svg>
  );
}

type IconeMotivo = (p: { size?: number; strokeWidth?: number }) => ReactElement;

const MOTIVOS_CHAMADO: { icone: IconeMotivo; rotulo: string; quantidades?: boolean }[] = [
  { icone: (p) => <Citrus {...p} />, rotulo: 'Sal e limão' },
  { icone: (p) => <Utensils {...p} />, rotulo: 'Pratos e talheres', quantidades: true },
  { icone: (p) => <Layers {...p} />, rotulo: 'Guardanapos' },
  { icone: (p) => <IconeLimparMesa {...p} />, rotulo: 'Limpar a mesa' },
];

/** O que dá para pedir em "Pratos e talheres", com a quantidade de cada um. */
const ITENS_MESA = [
  { id: 'pratos', um: 'prato', varios: 'pratos', rotulo: 'Pratos', icone: <IconePrato /> },
  { id: 'talheres', um: 'garfo e faca', varios: 'garfos e facas', rotulo: 'Garfo e faca', icone: <Utensils size={24} strokeWidth={1.8} /> },
  { id: 'colheres', um: 'colher', varios: 'colheres', rotulo: 'Colher', icone: <IconeColher /> },
] as const;

function IconePrato() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
    </svg>
  );
}

function IconeColher() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="7" rx="3.5" ry="4.5" />
      <path d="M12 11.5V21" />
    </svg>
  );
}

/** Antes de chamar, a mesa diz o que precisa: o garçom já vem com a coisa certa. */
function ModalChamarGarcom({ aoFechar, aoChamar }: { aoFechar: () => void; aoChamar: (motivo: string, detalhe?: string) => Promise<void> }) {
  const [etapa, setEtapa] = useState<'motivos' | 'talheres' | 'outra'>('motivos');
  const [texto, setTexto] = useState('');
  const [qtd, setQtd] = useState<Record<string, number>>({ pratos: 0, talheres: 0, colheres: 0 });
  const [enviando, setEnviando] = useState(false);
  const totalItens = Object.values(qtd).reduce((s, n) => s + n, 0);

  async function enviar(motivo: string, detalhe?: string) {
    setEnviando(true);
    await aoChamar(motivo, detalhe);
    setEnviando(false);
  }

  // "2 pratos, 2 garfos e facas e 1 colher": o garçom já sabe o que levar
  const resumo = () => {
    const partes = ITENS_MESA.filter((i) => qtd[i.id] > 0).map((i) => `${qtd[i.id]} ${qtd[i.id] === 1 ? i.um : i.varios}`);
    return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0] ?? '';
  };

  const titulo = etapa === 'talheres' ? 'Pratos e talheres' : etapa === 'outra' ? 'Outra coisa' : 'Do que você precisa?';

  return (
    <Modal aberto aoFechar={aoFechar} titulo={titulo} classe="mesa-modal" largura={620}>
      {etapa === 'motivos' && (
        <div className="motivos">
          {MOTIVOS_CHAMADO.map((m) => (
            <button
              key={m.rotulo}
              className="motivo"
              onClick={() => (m.quantidades ? setEtapa('talheres') : void enviar(m.rotulo))}
              disabled={enviando}
            >
              <span className="motivo__icone" aria-hidden="true"><m.icone size={30} strokeWidth={1.8} /></span>
              <strong>{m.rotulo}</strong>
            </button>
          ))}
          <button className="motivo motivo--outra" onClick={() => setEtapa('outra')} disabled={enviando}>
            <span className="motivo__icone" aria-hidden="true"><MessageCircleMore size={26} strokeWidth={1.8} /></span>
            <strong>Outra coisa</strong>
          </button>
        </div>
      )}

      {etapa === 'talheres' && (
        <div className="form">
          <p className="muted" style={{ margin: 0 }}>Escolha quantos de cada um:</p>
          <ul className="itens-mesa">
            {ITENS_MESA.map((i) => (
              <li key={i.id} className={cx(qtd[i.id] > 0 && 'ativo')}>
                <span className="itens-mesa__icone">{i.icone}</span>
                <strong>{i.rotulo}</strong>
                <Stepper valor={qtd[i.id]} min={0} max={20} aoMudar={(v) => setQtd((x) => ({ ...x, [i.id]: v }))} />
              </li>
            ))}
          </ul>
          <p className={cx('itens-mesa__resumo', totalItens > 0 && 'ativo')}>
            {totalItens ? <>O garçom vai trazer: <b>{resumo()}</b></> : 'Toque no + para escolher a quantidade.'}
          </p>
          <div className="acoes-modal">
            <button className="btn btn--contorno btn--lg" onClick={() => setEtapa('motivos')} disabled={enviando}>Voltar</button>
            <button className="btn btn--primario btn--lg" onClick={() => void enviar('Pratos e talheres', resumo())} disabled={enviando || totalItens === 0}>
              <ConciergeBell size={20} /> {enviando ? 'Chamando…' : 'Chamar garçom'}
            </button>
          </div>
        </div>
      )}

      {etapa === 'outra' && (
        <div className="form">
          <label className="campo">
            <span>Conte rapidinho (opcional)</span>
            <input
              className="input input--grande-mesa"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={140}
              placeholder="Ex.: gelo, canudo, ajuda com o pedido…"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void enviar('Outra coisa', texto.trim() || undefined)}
            />
          </label>
          <div className="acoes-linha">
            <button className="btn btn--contorno btn--lg" onClick={() => setEtapa('motivos')} disabled={enviando}>Voltar</button>
            <button className="btn btn--primario btn--lg" style={{ flex: 1 }} onClick={() => void enviar('Outra coisa', texto.trim() || undefined)} disabled={enviando}>
              <ConciergeBell size={20} /> {enviando ? 'Chamando…' : 'Chamar garçom'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ModalConta({ token, dispositivo, aoFechar, aoPedirConta, aoMesaFechada }: {
  token: string;
  dispositivo: string;
  aoFechar: () => void;
  aoPedirConta: () => void;
  aoMesaFechada: () => void;
}) {
  const [conta, setConta] = useState<Conta | null>(null);
  const [erro, setErro] = useState('');
  const fechadaRef = useRef(aoMesaFechada);
  fechadaRef.current = aoMesaFechada;

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      const { data, error } = await supabase.rpc('mesa_conta_ver', { p_token: token, p_dispositivo: dispositivo });
      if (!vivo) return;
      if (error) {
        if (ehMesaFechada(error)) fechadaRef.current();
        else setErro(msgErro(error));
      } else setConta(data as Conta);
    };
    void carregar();
    const i = setInterval(() => void carregar(), 10000);
    return () => { vivo = false; clearInterval(i); };
  }, [token, dispositivo]);

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Minha conta"
      classe="mesa-modal"
      rodape={
        <>
          <button className="btn btn--contorno btn--lg" onClick={aoFechar}>Voltar</button>
          <button className="btn btn--primario btn--lg" onClick={() => { aoPedirConta(); aoFechar(); }} disabled={!conta?.pedidos.length}>
            <Receipt size={20} /> Pedir a conta
          </button>
        </>
      }
    >
      {erro && <p className="erro-form">{erro}</p>}
      {!conta && !erro && <Carregando />}
      {conta && conta.pedidos.length === 0 && <p className="vazio">Nenhum pedido ainda nesta mesa.</p>}
      {conta && conta.pedidos.length > 0 && (
        <div className="conta">
          {conta.pedidos.map((p) => (
            <section key={p.id} className="conta__pedido">
              <header>
                <strong>Pedido #{p.numero}</strong>
                <span className="muted">{hora(p.criado_em)}</span>
                <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
              </header>
              <ul>
                {p.itens.map((i, n) => (
                  <li key={n}><span>{i.qtd}× {i.nome}{i.complementos && <small className="conta__adic">{i.complementos}</small>}</span><span>{brl(i.qtd * i.preco)}</span></li>
                ))}
              </ul>
            </section>
          ))}
          <div className="conta__total"><span>Total da mesa</span><strong>{brl(conta.total)}</strong></div>
          <p className="muted conta__nota">O pagamento é feito com o garçom ou no caixa.</p>
        </div>
      )}
    </Modal>
  );
}

function TelaSucesso({ numeros, aoFechar, aoJogar }: { numeros: number[]; aoFechar: () => void; aoJogar?: () => void }) {
  useEffect(() => {
    const t = setTimeout(aoFechar, 8000);
    return () => clearTimeout(t);
  }, [aoFechar]);

  return (
    <div className="sucesso" role="alertdialog" aria-label="Pedido enviado" onClick={aoFechar}>
      <CheckCircle2 size={88} className="sucesso__icone" />
      <h2 className="titulo">{numeros.length > 1 ? `Pedidos ${numeros.map((n) => `#${n}`).join(' e ')} enviados!` : `Pedido #${numeros[0]} enviado!`}</h2>
      <p>
        {numeros.length > 1 ? 'As bebidas saem antes e a cozinha já recebeu o resto.' : 'Já recebemos e o garçom foi avisado.'}
        <br />Acompanhe em “Minha conta”.
      </p>
      <button className="btn btn--primario btn--lg">Voltar ao cardápio</button>
      {aoJogar && (
        <button className="btn btn--contorno btn--lg sucesso__jogar" onClick={(e) => { e.stopPropagation(); aoJogar(); }}>
          <Gamepad2 size={20} /> Jogar enquanto espera
        </button>
      )}
    </div>
  );
}
