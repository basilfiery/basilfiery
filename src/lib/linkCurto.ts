import { createContext, useContext } from 'react';

/**
 * Links curtos e organizados:
 *   basilfiery.com.br/<loja>          → cardápio digital (delivery/retirada)
 *   basilfiery.com.br/<loja>/<mesa>   → cardápio da mesa (ex.: /basilfiery/mesa1)
 * Os links antigos (/loja/<codigo> e /mesa/<token>) continuam funcionando.
 */
export interface DestinoLink { codigo?: string; token?: string; base: string }

export const LinkCurtoCtx = createContext<DestinoLink | null>(null);
export const useLinkCurto = () => useContext(LinkCurtoCtx);

/** "Mesa 1" → "mesa1", "Varanda 2" → "varanda2" (o mesmo que o banco usa) */
export const slugMesa = (nome: string) =>
  nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** "Pizzaria do Zé" → "pizzaria-do-ze" */
export const slugLoja = (texto: string) =>
  texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40);

export function linkLoja(r: { codigo: string; slug?: string | null }) {
  return `${window.location.origin}/${r.slug || `loja/${r.codigo}`}`;
}

/** Link da mesa; se duas mesas tiverem o mesmo nome, a repetida fica com o link seguro (token) */
export function linkMesa(slug: string | null | undefined, mesa: { id: string; nome: string; token: string }, mesas: { id: string; nome: string }[] = []) {
  const curto = slugMesa(mesa.nome);
  const repetida = mesas.some((m) => m.id !== mesa.id && slugMesa(m.nome) === curto && m.nome.localeCompare(mesa.nome) <= 0);
  if (!slug || !curto || repetida) return `${window.location.origin}/mesa/${mesa.token}`;
  return `${window.location.origin}/${slug}/${curto}`;
}
