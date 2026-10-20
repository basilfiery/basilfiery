import { createContext, useContext } from 'react';
import { SITE } from '../config/site';

/**
 * Endereços do sistema (sempre no domínio oficial, nunca no vercel.app):
 *   Loja principal (endereço "cardapio"):  basilfiery.com.br/cardapio  e /mesa1
 *   Plano Start:                           basilfiery.com.br/assinante/<loja>/cardapio  e /assinante/<loja>/mesa1
 *   Plano Premium com domínio próprio:     fritas.com.br  e fritas.com.br/mesa1
 * Os links antigos (/loja/<codigo>, /mesa/<token> e /<loja>) continuam funcionando.
 */
export const SLUG_PRINCIPAL = 'cardapio';
export const PLANOS_COM_DOMINIO = ['premium', 'rede'];
export const planoPermiteDominio = (plano?: string | null) => PLANOS_COM_DOMINIO.includes(String(plano ?? '').toLowerCase());

export interface DestinoLink {
  codigo?: string;
  token?: string;
  /** Prefixo dos caminhos da loja (pedido: <base>/pedido/<x>) ou caminho da mesa */
  base: string;
  /** Caminho do cardápio */
  inicio?: string;
}
export const LinkCurtoCtx = createContext<DestinoLink | null>(null);
export const useLinkCurto = () => useContext(LinkCurtoCtx);

const ehLocal = (h: string) => h === 'localhost' || /^[\d.]+$/.test(h);

/** Endereço do próprio sistema (painel, apps, cardápios do plano Start)? Senão é o domínio próprio de uma loja. */
export function ehHostSistema(host = typeof window !== 'undefined' ? window.location.hostname : '') {
  const h = host.toLowerCase().replace(/^www\./, '');
  return !h || ehLocal(h) || h.endsWith('vercel.app') || ['basilfiery.com.br', 'basilfiery.com'].some((d) => h === d || h.endsWith(`.${d}`));
}

/** Origem dos links que o sistema mostra e compartilha: sempre o domínio oficial (localhost só em teste) */
export function origemSistema() {
  if (typeof window !== 'undefined' && ehLocal(window.location.hostname)) return window.location.origin;
  return SITE.dominio;
}

/** Caminhos da loja conforme o tipo de endereço */
export function caminhosLoja(slug: string, dominioProprio = false) {
  if (dominioProprio) return { inicio: '/', base: '', mesa: (m: string) => `/${m}` };
  if (slug === SLUG_PRINCIPAL) return { inicio: '/cardapio', base: '/cardapio', mesa: (m: string) => `/${m}` };
  return { inicio: `/assinante/${slug}/cardapio`, base: `/assinante/${slug}`, mesa: (m: string) => `/assinante/${slug}/${m}` };
}

type LojaLink = { codigo: string; slug?: string | null; dominio?: string | null; dominio_status?: string | null };
export const dominioAtivo = (r: LojaLink) => (r.dominio && r.dominio_status === 'ativo' ? r.dominio : null);

/** "Mesa 1" → "mesa1", "Varanda 2" → "varanda2" (o mesmo que o banco usa) */
export const slugMesa = (nome: string) =>
  nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** "Pizzaria do Zé" → "pizzaria-do-ze" */
export const slugLoja = (texto: string) =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40);

/** Link do cardápio digital da loja */
export function linkLoja(r: LojaLink) {
  const d = dominioAtivo(r);
  if (d) return `https://${d}`;
  if (!r.slug) return `${origemSistema()}/loja/${r.codigo}`;
  return `${origemSistema()}${caminhosLoja(r.slug).inicio}`;
}

/** Link da mesa; se duas mesas tiverem o mesmo nome, a repetida fica com o link seguro (token) */
export function linkMesa(r: LojaLink, mesa: { id: string; nome: string; token: string }, mesas: { id: string; nome: string }[] = []) {
  const curto = slugMesa(mesa.nome);
  const repetida = mesas.some((m) => m.id !== mesa.id && slugMesa(m.nome) === curto && m.nome.localeCompare(mesa.nome) <= 0);
  if (!r.slug || !curto || repetida) return `${origemSistema()}/mesa/${mesa.token}`;
  const d = dominioAtivo(r);
  return d ? `https://${d}/${curto}` : `${origemSistema()}${caminhosLoja(r.slug).mesa(curto)}`;
}
