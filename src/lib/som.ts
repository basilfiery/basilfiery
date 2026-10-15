import { ls } from './util';

let ctx: AudioContext | null = null;

/** O navegador só libera áudio depois de um toque/clique na página. */
export function destravarSom() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* sem áudio */ }
}

export const somLigado = () => ls.ler('bf:som', true);
export const definirSom = (v: boolean) => ls.gravar('bf:som', v);

const MELODIAS = {
  pedido: [880, 1175, 1568],
  chamado: [988, 740, 988, 740],
  pronto: [1319, 1568],
};

export function tocarAlerta(tipo: keyof typeof MELODIAS = 'pedido') {
  if (!somLigado()) return;
  destravarSom();
  if (!ctx) return;
  const c = ctx;
  MELODIAS[tipo].forEach((freq, i) => {
    const osc = c.createOscillator();
    const ganho = c.createGain();
    const t = c.currentTime + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = freq;
    ganho.gain.setValueAtTime(0.0001, t);
    ganho.gain.exponentialRampToValueAtTime(0.45, t + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(ganho).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
  if ('vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
}

/** Notificação do sistema quando a aba está em segundo plano (PC do caixa). */
export function notificarLocal(titulo: string, corpo = '') {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(titulo, { body: corpo, icon: '/icone-192.png' });
  } catch { /* Android exige service worker: lá usamos o push */ }
}
