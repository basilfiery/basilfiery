import { ls } from './util';

const CHAVE = 'bf:dispositivo';
let emMemoria: string | null = null;

/**
 * Identidade deste aparelho para a liberação da mesa (fica guardada no navegador).
 * Não identifica a pessoa: é só um número aleatório para o garçom liberar "este celular".
 */
export function idDispositivo(): string {
  const salvo = ls.ler<string | null>(CHAVE, null);
  if (salvo && salvo.length >= 16) return salvo;
  if (emMemoria) return emMemoria;
  const novo = crypto.randomUUID().replace(/-/g, '');
  ls.gravar(CHAVE, novo);
  emMemoria = novo;
  return novo;
}

/** Descrição curta para o garçom reconhecer o aparelho: "iPhone", "Android", "iPad"… */
export function descreverAparelho(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Windows/.test(ua)) return 'Computador Windows';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Navegador';
}
