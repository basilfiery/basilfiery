import { confirmar } from './Confirmar';
import type { useToast } from './Toast';
import { msgErro, supabase } from '../lib/supabase';
import type { Mesa } from '../lib/tipos';

/**
 * Cliente abriu a mesa (QR code) e foi embora sem pedir: deixa a mesa livre de novo.
 * Desconecta os celulares, atende os chamados e limpa cliente e pessoas. Devolve true se fechou.
 */
export async function fecharMesaSemPedido(mesa: Mesa, toast: ReturnType<typeof useToast>): Promise<boolean> {
  const ok = await confirmar(`Fechar a ${mesa.nome}?\n\nUse quando o cliente foi embora sem pedir. Os celulares conectados saem da mesa e ela fica livre.`, { sim: 'Fechar mesa' });
  if (!ok) return false;
  const { error } = await supabase.rpc('mesa_liberar', { p_mesa: mesa.id });
  if (error) { toast(msgErro(error), 'erro'); return false; }
  toast(`${mesa.nome} livre de novo.`, 'ok');
  return true;
}
