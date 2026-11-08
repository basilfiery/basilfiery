import type { FormaPagamento } from './tipos';
import { lerPreco } from './util';

/** Pagamento já recebido de uma mesa ainda aberta (valores em centavos). */
export interface PartePaga { id?: string; forma: FormaPagamento; valor: number; recebido?: number }
/** O que já foi pago (e o desconto/acréscimo combinados) enquanto a mesa não fecha. Fica em mesas.conta_parcial. */
export interface ContaParcial { partes: PartePaga[]; desconto: string; acrescimo: string; pago?: number }

/** "10%" vira porcentagem do subtotal; "5,00" vira R$ 5,00 (tudo em centavos). NaN = inválido. */
export function lerAjuste(t: string, subtotal: number) {
  const s = (t ?? '').trim();
  if (!s) return 0;
  if (s.endsWith('%')) {
    const p = Number(s.slice(0, -1).replace(',', '.'));
    return Number.isFinite(p) && p >= 0 ? Math.round(subtotal * p / 100) : NaN;
  }
  const v = lerPreco(s);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : NaN;
}

/** Resumo em reais: total com desconto/acréscimo, quanto já foi pago e quanto falta. */
export function resumoParcial(parcial: ContaParcial | null | undefined, subtotalReais: number) {
  const sub = Math.round(subtotalReais * 100);
  const d = lerAjuste(parcial?.desconto ?? '', sub);
  const a = lerAjuste(parcial?.acrescimo ?? '', sub);
  const desconto = Number.isFinite(d) && d <= sub ? d : 0;
  const acrescimo = Number.isFinite(a) ? a : 0;
  const devido = sub - desconto + acrescimo;
  const pago = (parcial?.partes ?? []).reduce((s, p) => s + (Number(p.valor) || 0), 0);
  return { desconto: desconto / 100, acrescimo: acrescimo / 100, devido: devido / 100, pago: pago / 100, falta: Math.max(devido - pago, 0) / 100 };
}

/** Formas usadas, sem repetir: "Dinheiro + Pix" */
export const formasPagas = (parcial: ContaParcial | null | undefined, rotulo: (f: FormaPagamento) => string) =>
  [...new Set((parcial?.partes ?? []).map((p) => rotulo(p.forma)))].join(' + ');
