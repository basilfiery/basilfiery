/** Motivos prontos de cancelamento e como o cliente lê cada um. */
export const MOTIVOS_CANCELAMENTO = [
  { rotulo: 'Acabou', frase: 'porque acabou' },
  { rotulo: 'Em falta hoje', frase: 'porque está em falta hoje' },
  { rotulo: 'Cozinha fechada', frase: 'porque a cozinha já fechou' },
  { rotulo: 'Pedido em dobro', frase: 'porque foi pedido em dobro' },
  { rotulo: 'Cliente pediu', frase: 'a seu pedido' },
] as const;

/** "O item Chopp foi cancelado porque acabou." (texto livre vira "… Motivo: …") */
export function fraseCancelamento(nome: string, motivo: string | null) {
  const pronto = MOTIVOS_CANCELAMENTO.find((m) => m.rotulo === motivo);
  if (pronto) return `O item ${nome} foi cancelado ${pronto.frase}.`;
  return motivo ? `O item ${nome} foi cancelado. Motivo: ${motivo}.` : `O item ${nome} foi cancelado.`;
}
