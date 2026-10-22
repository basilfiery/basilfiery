/* =====================================================================
   Order bump (Alavancar vendas): escolhe a oferta que aparece no cardápio
   logo depois que o cliente escolhe um item, antes de ir para o carrinho.
   O preço com desconto é conferido de novo no servidor (privado.precificar).
   ===================================================================== */
import type { CategoriaMesa, Linha, ProdutoMesa } from '../paginas/mesa/Mesa';
import type { GrupoAdicionalMesa } from './adicionais';

export type GatilhoBump = 'todos' | 'categorias' | 'produtos' | 'palavras' | 'automatico';
export type DescontoBump = 'nenhum' | 'percentual' | 'valor';
export type CanalBump = 'mesa' | 'delivery';

/** Oferta como vem no cardápio (só as ativas). */
export interface BumpCardapio {
  id: string;
  titulo: string;
  subtitulo: string | null;
  gatilho: GatilhoBump;
  categorias: string[];
  produtos: string[];
  palavras: string[];
  ofertas_modo: 'manual' | 'automatico';
  ofertas: string[];
  max_ofertas: number;
  desconto_tipo: DescontoBump;
  desconto_valor: number;
  canais: CanalBump[];
}

/** O que mais sai junto com cada item e os mais vendidos (para o modo automático). */
export interface SugestoesBump { juntos?: Record<string, string[]>; mais_vendidos?: string[] }

export interface ItemOferta { p: ProdutoMesa; preco: number; precoDe: number }
export interface OfertaBump { bump: BumpCardapio; itens: ItemOferta[] }
/** Item da oferta que o cliente aceitou */
export interface ExtraBump { p: ProdutoMesa; qtd: number; preco: number; bump_id: string }

export const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** "Pizza, prato executivo, porção" → ['pizza', 'prato executivo', 'porcao'] */
export const lerPalavras = (t: string) => [...new Set(t.split(/[,;\n]/).map(semAcento).filter(Boolean))].slice(0, 30);

export function precoComDesconto(preco: number, tipo: DescontoBump, valor: number) {
  const v = Number(valor) || 0;
  if (tipo === 'percentual') return Math.max(0, Math.round(preco * (1 - Math.min(v, 100) / 100) * 100) / 100);
  if (tipo === 'valor') return Math.max(0, Math.round((preco - v) * 100) / 100);
  return preco;
}

export function rotuloDesconto(tipo: DescontoBump, valor: number) {
  if (tipo === 'percentual' && valor > 0) return `-${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (tipo === 'valor' && valor > 0) return `-R$ ${Number(valor).toFixed(2).replace('.', ',')}`;
  return '';
}

/** Texto que a palavra-chave procura: nome, descrição e categoria (e a categoria "mãe") do item. */
export function textoDoItem(p: Pick<ProdutoMesa, 'nome' | 'descricao' | 'categoria_id' | 'prefixo'>, cats: Map<string, CategoriaMesa>) {
  const c = cats.get(p.categoria_id);
  const pai = c?.pai_id ? cats.get(c.pai_id) : undefined;
  return semAcento([p.nome, p.descricao ?? '', p.prefixo ?? '', c?.nome ?? '', pai?.nome ?? ''].join(' '));
}
export const casaPalavras = (texto: string, palavras: string[]) => palavras.some((w) => w && texto.includes(semAcento(w)));

/** Categoria de cima do item (subcategoria conta como a categoria "mãe"). */
export const categoriaTopo = (catId: string, cats: Map<string, CategoriaMesa>) => cats.get(catId)?.pai_id ?? catId;

/** O item aparece para esta oferta? (gatilho "automático" é decidido depois, olhando as ofertas) */
export function gatilhoCasa(b: Pick<BumpCardapio, 'gatilho' | 'categorias' | 'produtos' | 'palavras'>, p: ProdutoMesa, cats: Map<string, CategoriaMesa>) {
  const id = p.real_id ?? p.id;
  switch (b.gatilho) {
    case 'todos':
    case 'automatico': return true;
    case 'categorias': {
      const c = cats.get(p.categoria_id);
      return b.categorias.includes(p.categoria_id) || (!!c?.pai_id && b.categorias.includes(c.pai_id));
    }
    case 'produtos': return b.produtos.includes(id);
    case 'palavras': return casaPalavras(textoDoItem(p, cats), b.palavras);
    default: return false;
  }
}

// Categorias que costumam "acompanhar" (usadas quando ainda não há histórico de vendas)
const ACOMPANHA = /bebida|refri|suco|drink|cerveja|chopp|agua|sobremesa|doce|acompanha|adiciona|extra|porc|molho|batata|sorvete|cafe/;

interface Contexto {
  produto: ProdutoMesa;
  bumps: BumpCardapio[];
  sugestoes?: SugestoesBump;
  produtos: ProdutoMesa[];
  categorias: CategoriaMesa[];
  grupos?: GrupoAdicionalMesa[];
  produtoGrupos?: Record<string, string[]>;
  canal: CanalBump;
  carrinho: Linha[];
  /** Ofertas que já apareceram nesta visita (não repete) */
  jaVistas?: Set<string>;
}

/** Escolhe a primeira oferta (pela prioridade) que faz sentido para o item que o cliente acabou de escolher. */
export function escolherBump(x: Contexto): OfertaBump | null {
  const { produto, bumps, produtos, categorias, canal } = x;
  if (!bumps.length || !produto.disponivel) return null;
  const cats = new Map(categorias.map((c) => [c.id, c]));
  const porId = new Map(produtos.map((p) => [p.id, p]));
  const obrigatorios = new Set((x.grupos ?? []).filter((g) => g.minimo > 0).map((g) => g.id));
  const noCarrinho = new Set(x.carrinho.map((l) => l.produto_id));
  const topoDoItem = categoriaTopo(produto.categoria_id, cats);
  const idItem = produto.real_id ?? produto.id;

  // Só itens simples entram na oferta: disponíveis e sem escolha obrigatória
  const podeOferecer = (q: ProdutoMesa | undefined): q is ProdutoMesa => !!q && q.disponivel && q.id !== produto.id && q.id !== idItem
    && !q.real_id && !noCarrinho.has(q.id) && Number(q.preco) > 0
    && !(x.produtoGrupos?.[q.id] ?? []).some((g) => obrigatorios.has(g));

  for (const b of bumps) {
    if (x.jaVistas?.has(b.id)) continue;
    if (b.canais?.length && !b.canais.includes(canal)) continue;
    if (!gatilhoCasa(b, produto, cats)) continue;

    let candidatos: ProdutoMesa[];
    if (b.ofertas_modo === 'manual') {
      candidatos = b.ofertas.map((id) => porId.get(id)).filter(podeOferecer);
    } else {
      const ids = [...(x.sugestoes?.juntos?.[idItem] ?? []), ...(x.sugestoes?.mais_vendidos ?? [])];
      const historico = ids.map((id) => porId.get(id));
      const acompanha = produtos.filter((q) => ACOMPANHA.test(semAcento((cats.get(categoriaTopo(q.categoria_id, cats))?.nome ?? '') + ' ' + (cats.get(q.categoria_id)?.nome ?? ''))));
      const destaques = produtos.filter((q) => q.destaque);
      // Automático: nunca oferece algo da mesma categoria do item escolhido
      candidatos = [...historico, ...acompanha, ...destaques].filter(podeOferecer)
        .filter((q) => categoriaTopo(q.categoria_id, cats) !== topoDoItem);
    }
    // Gatilho automático: não mostra a oferta em itens da mesma categoria do que ela oferece
    if (b.gatilho === 'automatico') candidatos = candidatos.filter((q) => categoriaTopo(q.categoria_id, cats) !== topoDoItem);

    const unicos = [...new Map(candidatos.map((q) => [q.id, q])).values()].slice(0, Math.max(1, b.max_ofertas));
    if (!unicos.length) continue;
    return {
      bump: b,
      itens: unicos.map((q) => ({ p: q, precoDe: Number(q.preco), preco: precoComDesconto(Number(q.preco), b.desconto_tipo, b.desconto_valor) })),
    };
  }
  return null;
}

/** Linha do carrinho para o item que veio da oferta (preço com desconto, separado do mesmo item sem oferta). */
export function juntarBump(c: Linha[], e: ExtraBump): Linha[] {
  const chave = `${e.p.id}|bump:${e.bump_id}`;
  return c.some((l) => l.chave === chave)
    ? c.map((l) => (l.chave === chave ? { ...l, qtd: Math.min(20, l.qtd + e.qtd) } : l))
    : [...c, { chave, produto_id: e.p.id, qtd: e.qtd, obs: '', bump_id: e.bump_id, preco_bump: e.preco }];
}

/** Oferta só vale junto com outro item: se sobrou só item de oferta, volta ao preço normal. */
export function soltarBumpsSozinhos(c: Linha[]): Linha[] {
  if (!c.length || c.some((l) => !l.bump_id)) return c;
  return c.map((l) => ({ ...l, bump_id: undefined, preco_bump: undefined, chave: l.chave.replace(/\|bump:.*/, '|') }));
}

// Ofertas já mostradas nesta visita (não aparece de novo a mesma)
const CHAVE_VISTAS = 'bf:bumps-vistos';
export function bumpsVistos(): Set<string> {
  try { return new Set(JSON.parse(sessionStorage.getItem(CHAVE_VISTAS) ?? '[]') as string[]); } catch { return new Set(); }
}
export function marcarBumpVisto(id: string) {
  try {
    const s = bumpsVistos();
    s.add(id);
    sessionStorage.setItem(CHAVE_VISTAS, JSON.stringify([...s]));
  } catch { /* sem armazenamento */ }
}
