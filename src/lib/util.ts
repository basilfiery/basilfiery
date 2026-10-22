import { useEffect, useState } from 'react';
import type { FormaPagamento, Papel, StatusPedido } from './tipos';

export const FORMAS: { id: FormaPagamento; rotulo: string }[] = [
  { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'pix', rotulo: 'Pix' },
  { id: 'credito', rotulo: 'Crédito' },
  { id: 'debito', rotulo: 'Débito' },
  { id: 'outro', rotulo: 'Outro' },
];
/** Texto curto do chamado da mesa: "Sal e limão", "Pediu a conta", "Chamou o garçom"... */
export function descreverChamado(c: { tipo: string; motivo?: string | null; detalhe?: string | null }) {
  if (c.tipo === 'conta') return 'Pediu a conta';
  if (c.motivo) return c.detalhe ? `${c.motivo}: ${c.detalhe}` : c.motivo;
  return c.detalhe ? `Chamou: ${c.detalhe}` : 'Chamou o garçom';
}

export const rotuloForma =(f: string) => FORMAS.find((x) => x.id === f)?.rotulo ?? f;

export const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Quando foi: "hoje, 14:24", "ontem, 22:10" ou "sex., 17/10 · 14:24". */
export function quando(iso: string) {
  const d = new Date(iso);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (dia === hoje.getTime()) return `hoje, ${h}`;
  if (dia === hoje.getTime() - 86400000) return `ontem, ${h}`;
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })} · ${h}`;
}

/** Tempo corrido: "45 min", "3h 12min", "1 dia e 4h". */
export function duracao(iso: string, agora = Date.now()) {
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h}h ${String(min % 60).padStart(2, '0')}min` : `${h}h`;
  const dias = Math.floor(h / 24);
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}${h % 24 ? ` e ${h % 24}h` : ''}`;
}

export function minutosDesde(iso: string, agora = Date.now()) {
  return Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
}

export function tempoDesde(iso: string, agora = Date.now()) {
  const min = minutosDesde(iso, agora);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/** Converte "49,90" / "49.90" / "1.234,50" em número. */
export function lerPreco(txt: string): number {
  const t = txt.trim().replace(/[^\d.,]/g, '');
  const n = t.includes(',') ? Number(t.replace(/\./g, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const precoParaTexto = (n: number) => n.toFixed(2).replace('.', ',');

/** Máscara de dinheiro (estilo maquininha): digita 4990 e vira "49,90"; apagar tira o último número. */
export function mascaraPreco(txt: string): string {
  const d = txt.replace(/\D/g, '').replace(/^0+/, '').slice(0, 9);
  if (!d) return '';
  const c = d.padStart(3, '0');
  return `${c.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${c.slice(-2)}`;
}

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/** Zoom da página (o painel fica um pouco menor em telas de notebook; ver base.css). */
export function zoomPagina() {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export const ordenarNome = <T extends { nome: string; ordem?: number }>(a: T, b: T) =>
  (a.ordem ?? 0) - (b.ordem ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR', { numeric: true });

/** localStorage com proteção (modo privado, armazenamento bloqueado etc.). */
export const ls = {
  ler<T>(chave: string, padrao: T): T {
    try {
      const v = localStorage.getItem(chave);
      return v === null ? padrao : (JSON.parse(v) as T);
    } catch {
      return padrao;
    }
  },
  gravar(chave: string, valor: unknown) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem armazenamento */ }
  },
};

/** Relógio que atualiza a tela de tempos em tempos (para "há 5 min"). */
export function useAgora(intervalo = 30000) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setAgora(Date.now()), intervalo);
    return () => clearInterval(i);
  }, [intervalo]);
  return agora;
}

export const STATUS_ROTULO: Record<StatusPedido, string> = {
  novo: 'Novo',
  preparando: 'Em preparo',
  pronto: 'Pronto',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
};

export const PROXIMO_STATUS: Partial<Record<StatusPedido, StatusPedido>> = {
  novo: 'preparando',
  preparando: 'pronto',
  pronto: 'entregue',
};

export const ACAO_STATUS: Partial<Record<StatusPedido, string>> = {
  novo: 'Começar preparo',
  preparando: 'Marcar pronto',
  pronto: 'Entregue na mesa',
};

export const PAPEL_ROTULO: Record<Papel, string> = {
  dono: 'Dono',
  gerente: 'Gerente',
  caixa: 'Caixa',
  garcom: 'Garçom',
};

export const ehGestor = (p?: Papel | null) => p === 'dono' || p === 'gerente';
export const podeCaixa = (p?: Papel | null) => p === 'dono' || p === 'gerente' || p === 'caixa';

export function inicioDoDia() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
