import { useEffect } from 'react';

interface AppInstalavel {
  /** Nome completo (ex.: "Basil Fiery · Mesa 3") */
  nome: string;
  /** Nome curto que aparece embaixo do ícone (ex.: "Mesa 3") */
  curto: string;
  /** Endereço que o atalho abre (ex.: "/mesa/abc123") */
  inicio: string;
  /** Até onde o app vale (ex.: "/mesa/abc123") */
  escopo: string;
}

const ehIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

function meta(nome: string) {
  let m = document.querySelector<HTMLMetaElement>(`meta[name="${nome}"]`);
  if (!m) {
    m = document.createElement('meta');
    m.name = nome;
    document.head.appendChild(m);
  }
  return m;
}

/**
 * "Adicionar à tela de início" abre exatamente esta página (a mesa escaneada, o app do garçom
 * do restaurante) e não o painel do sistema.
 * - iPhone/iPad: sem manifesto, o Safari salva o endereço atual e usa o título da página.
 * - Android/Chrome: manifesto próprio desta página, com o endereço de início certo.
 */
export function useAppInstalavel(app: AppInstalavel | null) {
  const nome = app?.nome;
  const curto = app?.curto;
  const inicio = app?.inicio;
  const escopo = app?.escopo;

  useEffect(() => {
    if (!nome || !curto || !inicio || !escopo) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const hrefOriginal = link?.getAttribute('href') ?? null;
    const pai = link?.parentNode ?? null;
    const proximo = link?.nextSibling ?? null;
    const tituloOriginal = document.title;
    const metaTitulo = meta('apple-mobile-web-app-title');
    const metaTituloOriginal = metaTitulo.content;

    document.title = nome;
    metaTitulo.content = curto;

    if (ehIOS()) {
      link?.remove();
    } else if (link) {
      const origem = window.location.origin;
      const manifesto = {
        id: origem + inicio,
        name: nome,
        short_name: curto,
        start_url: origem + inicio,
        scope: origem + escopo,
        display: 'standalone',
        background_color: '#121010',
        theme_color: '#121010',
        lang: 'pt-BR',
        icons: [
          { src: `${origem}/icone-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${origem}/icone-512.png`, sizes: '512x512', type: 'image/png' },
        ],
      };
      link.setAttribute('href', `data:application/manifest+json;charset=utf-8,${encodeURIComponent(JSON.stringify(manifesto))}`);
    }

    return () => {
      document.title = tituloOriginal;
      metaTitulo.content = metaTituloOriginal;
      if (link && hrefOriginal) link.setAttribute('href', hrefOriginal);
      if (link && !link.isConnected && pai) pai.insertBefore(link, proximo);
    };
  }, [nome, curto, inicio, escopo]);
}
