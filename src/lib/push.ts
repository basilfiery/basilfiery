import { supabase, SUPABASE_URL } from './supabase';

export type EstadoPush = 'ativo' | 'inativo' | 'bloqueado' | 'indisponivel' | 'precisa-instalar';

const ehIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

export async function estadoPush(): Promise<EstadoPush> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return ehIOS() && !instalado() ? 'precisa-instalar' : 'indisponivel';
  }
  if (Notification.permission === 'denied') return 'bloqueado';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'ativo' : 'inativo';
}

function base64UrlParaBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Pede permissão, inscreve este aparelho e liga ao restaurante. */
export async function ativarPush(restauranteId: string) {
  const estado = await estadoPush();
  if (estado === 'precisa-instalar') {
    throw new Error('No iPhone/iPad: toque em Compartilhar → "Adicionar à Tela de Início", abra o app por lá e ative de novo.');
  }
  if (estado === 'indisponivel') throw new Error('Este navegador não suporta notificações. Use o Chrome.');

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    throw new Error('As notificações foram bloqueadas. Libere nas configurações do navegador para este site.');
  }

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/notificar`);
  if (!resp.ok) throw new Error('Serviço de notificações indisponível. Tente mais tarde.');
  const { chave } = (await resp.json()) as { chave: string };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlParaBytes(chave),
    });
  }
  const j = sub.toJSON();
  const { error } = await supabase.rpc('push_inscrever', {
    p_rest: restauranteId,
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
  });
  if (error) throw error;
}

export async function desativarPush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_inscricoes').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
