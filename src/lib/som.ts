import { ls } from './util';
import { programaDesktop } from './impressao';

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

/** Vibra o celular — só depois que a pessoa já tocou na tela (antes disso o navegador bloqueia e reclama no console). */
export function vibrar(padrao: number | number[]) {
  const ativo = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
  if (ativo && 'vibrate' in navigator) navigator.vibrate?.(padrao);
}
export const definirSom = (v: boolean) => ls.gravar('bf:som', v);

const MELODIAS = {
  pedido: [880, 1175, 1568, 0, 880, 1175, 1568],
  chamado: [988, 740, 988, 740],
  pronto: [1319, 1568],
};

export function tocarAlerta(tipo: keyof typeof MELODIAS = 'pedido') {
  if (!somLigado()) return;
  destravarSom();
  if (!ctx) return;
  const c = ctx;
  const pedido = tipo === 'pedido';
  MELODIAS[tipo].forEach((freq, i) => {
    if (!freq) return; // pausa
    const osc = c.createOscillator();
    const ganho = c.createGain();
    const t = c.currentTime + i * (pedido ? 0.2 : 0.18);
    const dur = pedido ? 0.32 : 0.16;
    osc.type = pedido ? 'triangle' : 'sine';
    osc.frequency.value = freq;
    ganho.gain.setValueAtTime(0.0001, t);
    ganho.gain.exponentialRampToValueAtTime(pedido ? 0.7 : 0.45, t + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(ganho).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  });
  vibrar([200, 100, 200]);
}

/** Confirmação discreta de "pedido enviado" (cliente): duas notas suaves, curtinhas. */
export function tocarEnviado() {
  destravarSom();
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime + 0.02;
  nota(c, t, 1046.5, 0.32, 'sine', 0.22, [[2, 0.03]]);
  nota(c, t + 0.12, 1568, 0.55, 'sine', 0.2, [[2, 0.025]]);
  vibrar(35);
}

/** Aviso ao cliente (ex.: item cancelado): duas notas descendo, suaves, chamam a atenção sem assustar. */
export function tocarAviso() {
  destravarSom();
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime + 0.02;
  nota(c, t, 1318.5, 0.4, 'sine', 0.22, [[2, 0.03]]);
  nota(c, t + 0.16, 987.8, 0.6, 'sine', 0.2, [[2, 0.025]]);
  vibrar([120, 80, 120]);
}

/* ---------- Toques do "chamar garçom" (escolhidos pelo restaurante) ---------- */
export type SomChamado = 'campainha' | 'sino' | 'alerta' | 'marimba';

export const SONS_CHAMADO: { id: SomChamado; nome: string; descricao: string }[] = [
  { id: 'campainha', nome: 'Sino de garçom', descricao: 'O clássico “ding” da campainha de balcão de restaurante' },
  { id: 'sino', nome: 'Sino suave', descricao: 'Três notas que sobem, discreto' },
  { id: 'alerta', nome: 'Alerta duplo', descricao: 'Bipes fortes, bom para ambiente barulhento' },
  { id: 'marimba', nome: 'Marimba', descricao: 'Melodia curta e alegre' },
];

/** Uma nota com envelope curto (ataque rápido, decaimento natural) e harmônicos opcionais. */
function nota(c: AudioContext, inicio: number, freq: number, dur: number, tipo: OscillatorType, vol: number, harmonicos: [number, number][] = []) {
  for (const [mult, v] of [[1, vol] as [number, number], ...harmonicos]) {
    const osc = c.createOscillator();
    const ganho = c.createGain();
    osc.type = tipo;
    osc.frequency.value = freq * mult;
    ganho.gain.setValueAtTime(0.0001, inicio);
    ganho.gain.exponentialRampToValueAtTime(v, inicio + 0.008);
    ganho.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    osc.connect(ganho).connect(c.destination);
    osc.start(inicio);
    osc.stop(inicio + dur + 0.02);
  }
}

/**
 * Uma batida da campainha de balcão: o "tec" do martelo + o corpo metálico do sino,
 * com parciais inarmônicas que somem em tempos diferentes (é isso que dá o som de sino de verdade).
 */
function sinoDeBalcao(c: AudioContext, inicio: number, forca: number) {
  // Batida do martelo: ruído curtinho e agudo
  const ruido = c.createBuffer(1, Math.floor(c.sampleRate * 0.02), c.sampleRate);
  const dados = ruido.getChannelData(0);
  for (let i = 0; i < dados.length; i++) dados[i] = (Math.random() * 2 - 1) * (1 - i / dados.length);
  const fonte = c.createBufferSource();
  fonte.buffer = ruido;
  const filtro = c.createBiquadFilter();
  filtro.type = 'bandpass';
  filtro.frequency.value = 4200;
  const ganhoRuido = c.createGain();
  ganhoRuido.gain.value = 0.25 * forca;
  fonte.connect(filtro).connect(ganhoRuido).connect(c.destination);
  fonte.start(inicio);

  // Corpo do sino: fundamental + parciais (com leve batimento para "brilhar")
  const base = 1830;
  const parciais: [number, number, number][] = [
    [1, 0.42, 2.4], [1.0035, 0.18, 2.2], [2.32, 0.2, 1.4], [4.25, 0.1, 0.8], [6.63, 0.05, 0.5],
  ];
  for (const [mult, vol, dur] of parciais) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = base * mult;
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(vol * forca, inicio + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    osc.connect(g).connect(c.destination);
    osc.start(inicio);
    osc.stop(inicio + dur + 0.05);
  }
}

/**
 * Toca o som do chamado da mesa. `teste` toca mesmo com o som desligado
 * (para ouvir a opção nas Configurações).
 */
export function tocarChamado(som: SomChamado | string | null | undefined = 'campainha', teste = false) {
  if (!teste && !somLigado()) return;
  destravarSom();
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime + 0.02;
  switch (som) {
    case 'sino':
      [1046.5, 1318.5, 1568].forEach((f, i) => nota(c, t + i * 0.18, f, 1.3, 'triangle', 0.5));
      break;
    case 'alerta':
      [0, 0.16, 0.42, 0.58].forEach((d, i) => nota(c, t + d, i % 2 ? 784 : 988, 0.13, 'square', 0.16));
      break;
    case 'marimba':
      [784, 1046.5, 1318.5, 1568].forEach((f, i) => nota(c, t + i * 0.12, f, 0.4, 'sine', 0.55, [[4, 0.08]]));
      break;
    default: // sino de garçom (campainha de balcão): um "ding"
      sinoDeBalcao(c, t, 1);
  }
  if (!teste) vibrar([200, 100, 200, 100, 300]);
}

/**
 * Toca o chamado UMA vez mesmo com o sistema aberto em várias abas/janelas deste navegador:
 * a primeira que pegar a "chave" toca, as outras ficam quietas (Web Locks).
 */
export function tocarChamadoUmaVez(chave: string, som: SomChamado | string | null | undefined) {
  tocarUmaVez(chave, () => tocarChamado(som));
}
/** Som de pedido novo, uma vez só mesmo com várias abas abertas. */
export function tocarPedidoUmaVez(chave: string) {
  tocarUmaVez(chave, () => tocarAlerta('pedido'));
}
function tocarUmaVez(chave: string, tocar: () => void) {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) { tocar(); return; }
  void locks.request(`bf-som-${chave}`, { ifAvailable: true }, async (trava) => {
    if (!trava) return;
    tocar();
    await new Promise((r) => setTimeout(r, 4000)); // segura a chave enquanto as outras abas recebem o mesmo aviso
  });
}

/** Intervalo do toque repetido enquanto ninguém marca "Atendido". */
export const REPETIR_CHAMADO_MS = 8000;

/**
 * Notificação na área de trabalho (canto da tela do Windows).
 * No programa BasilFiery aparece sempre, como no Anota AI; no navegador, quando a aba não está na frente.
 */
export function notificarLocal(titulo: string, corpo = '', tag?: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const desktop = !!programaDesktop();
  if (!desktop && !document.hidden && document.hasFocus()) return;
  try {
    // silent: o próprio sistema já toca o som escolhido (evita dois sons juntos)
    const n = new Notification(titulo, { body: corpo, icon: '/icone-192.png', tag, silent: true });
    n.onclick = () => {
      const desktop = programaDesktop();
      if (desktop) void desktop.mostrar();
      else window.focus();
    };
  } catch { /* Android exige service worker: lá usamos o push */ }
}

/** "Tlim" de moedas: nova venda no app do dono. */
export function tocarVenda() {
  if (!somLigado()) return;
  destravarSom();
  if (!ctx) return;
  const c = ctx;
  const t = c.currentTime + 0.02;
  nota(c, t, 1975.5, 0.5, 'sine', 0.35, [[2.01, 0.08]]);
  nota(c, t + 0.09, 2637, 0.7, 'sine', 0.3, [[2.01, 0.06]]);
  vibrar([60, 40, 60]);
}
