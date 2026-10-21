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
  /** Manifesto fixo do app (ex.: "/manifest-dono.webmanifest"): o iPhone precisa dele desde o carregamento */
  manifesto?: string;
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
  const manifesto = app?.manifesto;

  // iPhone: o "Adicionar à Tela de Início" usa o manifesto lido quando a página carregou.
  // Se a página foi aberta com outro (ex.: aba antiga, de antes de uma atualização), recarrega uma vez.
  useEffect(() => {
    if (!manifesto || !ehIOS()) return;
    const instalado = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const atual = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute('href');
    if (instalado || atual === manifesto) return;
    const chave = `bf:recarga-manifesto:${manifesto}`;
    try {
      if (sessionStorage.getItem(chave)) return; // já tentou nesta aba: não entra em loop
      sessionStorage.setItem(chave, '1');
    } catch { return; }
    window.location.replace(window.location.pathname + window.location.search);
  }, [manifesto]);

  useEffect(() => {
    if (!nome || !curto || !inicio || !escopo) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    // Páginas sem manifesto (cardápio, mesa…): no Android cria um só desta página
    let criado = false;
    if (!link && !ehIOS()) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
      criado = true;
    }
    const hrefOriginal = link?.getAttribute('href') ?? null;
    const pai = link?.parentNode ?? null;
    const proximo = link?.nextSibling ?? null;
    const tituloOriginal = document.title;
    const metaTitulo = meta('apple-mobile-web-app-title');
    const metaTituloOriginal = metaTitulo.content;

    document.title = nome;
    metaTitulo.content = curto;

    if (ehIOS()) {
      // Manifesto próprio do app (dono, garçom) fica; o do sistema sai para o iPhone salvar este endereço
      if (link && !link.hasAttribute('data-fixo')) link.remove();
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
      if (criado) { link?.remove(); return; }
      if (link && hrefOriginal) link.setAttribute('href', hrefOriginal);
      if (link && !link.isConnected && pai) pai.insertBefore(link, proximo);
    };
  }, [nome, curto, inicio, escopo]);
}
