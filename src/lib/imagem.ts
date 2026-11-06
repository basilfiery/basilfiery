import { useEffect } from 'react';

/** Larguras usadas no sistema (poucas, para o navegador reaproveitar o que já baixou). */
export const TAM = { mini: 200, card: 600, grande: 1200 } as const;

const PUBLICO = '/storage/v1/object/public/';
const RENDER = '/storage/v1/render/image/public/';

/**
 * Foto do armazenamento no tamanho certo para a tela (o servidor reduz e entrega em WebP).
 * Foto do card: ~30 KB em vez de ~300 KB. SVG, GIF e links de outros sites ficam como estão.
 */
export function imgTam(url: string | null | undefined, largura: number): string {
  if (!url) return '';
  if (!url.includes(PUBLICO) || /\.(svg|gif)(\?|$)/i.test(url)) return url;
  return `${url.replace(PUBLICO, RENDER)}${url.includes('?') ? '&' : '?'}width=${largura}&quality=75`;
}

const jaPedidas = new Set<string>();

/** Baixa as fotos em segundo plano (uma de cada vez, sem atrapalhar a tela) para abrirem na hora. */
export function preCarregar(urls: string[]) {
  const fila = urls.filter((u) => u && !jaPedidas.has(u));
  fila.forEach((u) => jaPedidas.add(u));
  if (!fila.length) return;
  const ocioso = (fn: () => void) =>
    'requestIdleCallback' in window ? window.requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200);
  const proxima = () => {
    const u = fila.shift();
    if (!u) return;
    const img = new Image();
    img.decoding = 'async';
    img.onload = img.onerror = () => ocioso(proxima);
    img.src = u;
  };
  // 3 em paralelo: rápido sem engarrafar a internet do cliente
  ocioso(() => { proxima(); proxima(); proxima(); });
}

type ComFotos = { imagem_url: string | null; galeria?: { tipo: string; url: string }[] | null };

/** Assim que o cardápio carrega, deixa a foto ampliada de cada produto pronta (o toque abre na hora). */
export function usePreCarregarFotos(produtos: ComFotos[] | undefined) {
  useEffect(() => {
    if (!produtos?.length) return;
    const t = setTimeout(() => {
      const principais = produtos.map((p) => imgTam(p.imagem_url, TAM.grande));
      const extras = produtos.flatMap((p) => (p.galeria ?? []).filter((g) => g.tipo === 'imagem').map((g) => imgTam(g.url, TAM.grande)));
      preCarregar([...principais, ...extras]);
    }, 1200); // depois das fotos dos cards
    return () => clearTimeout(t);
  }, [produtos]);
}
