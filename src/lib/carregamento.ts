// Proteções para o sistema nunca ficar com a tela em branco/preta
// (ex.: logo depois de uma atualização, quando arquivos antigos deixam de existir).

const CHAVE = 'bf:ultima-recarga';
const PARAMETRO = '_v';

/** Erro de "não consegui baixar uma parte do sistema" (típico logo após publicar uma versão nova). */
export function ehErroDeCarregamento(erro: unknown) {
  const msg = erro instanceof Error ? `${erro.name} ${erro.message}` : String(erro);
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Loading chunk|Failed to fetch|MIME type/i.test(msg);
}

/**
 * Recarrega a página buscando tudo do servidor de novo (sem cópias antigas guardadas).
 * No programa para Windows, também limpa o cache dele.
 */
export function recarregarLimpo() {
  try { sessionStorage.setItem(CHAVE, String(Date.now())); } catch { /* sem armazenamento */ }
  const desktop = (window as unknown as { basilfieryDesktop?: { recarregar?: () => Promise<void> } }).basilfieryDesktop;
  if (desktop?.recarregar) {
    void desktop.recarregar().catch(() => irParaVersaoNova());
    return;
  }
  irParaVersaoNova();
}

function irParaVersaoNova() {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAMETRO, String(Date.now())); // força o navegador a pedir a página de novo
  window.location.replace(url.toString());
}

/**
 * Recarrega automaticamente uma única vez (evita ficar em loop se o problema persistir).
 * Devolve true se a recarga foi disparada.
 */
export function recarregarUmaVez() {
  let ultima = 0;
  try { ultima = Number(sessionStorage.getItem(CHAVE) || 0); } catch { /* sem armazenamento */ }
  if (Date.now() - ultima < 30000) return false;
  recarregarLimpo();
  return true;
}

/** Tira o parâmetro de recarga do endereço depois que a página nova abriu. */
export function limparParametroDeRecarga() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAMETRO)) return;
  url.searchParams.delete(PARAMETRO);
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
