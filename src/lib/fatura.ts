import { SITE, linkAssinar } from '../config/site';

/** Dias de tolerância depois do vencimento antes de bloquear (Pix/boleto ou cartão recusado) */
export const DIAS_TOLERANCIA = 5;

type LojaPlano = { ativo: boolean; plano?: string | null; plano_vence_em?: string | null; plano_forma?: string | null };
export type EstadoPlano = 'sem_cobranca' | 'em_dia' | 'perto' | 'vencida' | 'suspensa';

const dia = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`);
const meiaNoite = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const dataBR = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const ehCartao = (forma?: string | null) => /cart|cr[eé]dito|card/i.test(forma ?? '');

/** Situação da mensalidade: vencimento, prazo final para pagar e se está perto/vencida */
export function situacaoPlano(r: LojaPlano) {
  if (!r.ativo) return { estado: 'suspensa' as EstadoPlano, vence: r.plano_vence_em ? dia(r.plano_vence_em) : null, limite: null, dias: 0 };
  if (!r.plano_vence_em) return { estado: 'sem_cobranca' as EstadoPlano, vence: null, limite: null, dias: 0 };
  const vence = dia(r.plano_vence_em);
  const limite = new Date(vence);
  limite.setDate(limite.getDate() + DIAS_TOLERANCIA);
  const hoje = meiaNoite(new Date());
  const dias = Math.round((meiaNoite(vence).getTime() - hoje.getTime()) / 86400000);
  // No cartão a cobrança é automática: só avisa se passou do vencimento (cartão recusado)
  const estado: EstadoPlano = dias < 0 ? 'vencida' : dias <= DIAS_TOLERANCIA && !ehCartao(r.plano_forma) ? 'perto' : 'em_dia';
  return { estado, vence, limite, dias };
}

/** Onde pagar: checkout do plano (Kirvano) ou o "Assinar agora" geral */
export function linkPagarPlano(plano?: string | null) {
  return SITE.planos.find((p) => p.nome.toLowerCase() === String(plano ?? '').toLowerCase())?.checkout || linkAssinar();
}
