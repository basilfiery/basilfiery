import { supabase } from './supabase';
import { VERSAO_CURTA } from './versao';

/*
 * Registro de erros: qualquer falha numa tela vai para o banco (tabela erros_app),
 * para ser investigada e corrigida — mesmo que ninguém clique em "Detalhes".
 */

const enviados = new Set<string>();
let total = 0;

/** Erros que não são do sistema (extensões do navegador, avisos inofensivos) */
const IGNORAR = /ResizeObserver loop|chrome-extension:|moz-extension:|safari-extension:|Script error\.?$|Non-Error promise rejection captured|AbortError|The user aborted a request/i;

export function registrarErro(erro: unknown, tipo: string, componente?: string) {
  try {
    const e = erro instanceof Error ? erro : new Error(typeof erro === 'string' ? erro : JSON.stringify(erro));
    const mensagem = `${e.name}: ${e.message}`;
    if (IGNORAR.test(mensagem) || IGNORAR.test(e.stack ?? '')) return;
    const chave = `${tipo}|${mensagem}`;
    if (enviados.has(chave) || total >= 15) return; // não repete o mesmo erro nem enche o banco
    enviados.add(chave);
    total += 1;
    void supabase.rpc('registrar_erro', {
      p_url: window.location.pathname + window.location.search,
      p_mensagem: mensagem,
      p_pilha: e.stack ?? null,
      p_componente: componente ?? null,
      p_tipo: tipo,
      p_agente: navigator.userAgent + ('basilfieryDesktop' in window ? ' [programa Windows]' : ''),
      p_versao: VERSAO_CURTA,
    }).then(() => {}, () => {});
  } catch { /* registrar nunca pode causar outro erro */ }
}

/** Erros soltos (fora das telas): só registra, sem atrapalhar o uso */
export function vigiarErrosGlobais() {
  window.addEventListener('error', (ev) => {
    if (ev.error || ev.message) registrarErro(ev.error ?? ev.message, 'global');
  });
  window.addEventListener('unhandledrejection', (ev) => registrarErro(ev.reason, 'promessa'));
}
