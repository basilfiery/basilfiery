import type { Pedido } from './tipos';
import { brl, ls } from './util';

export interface ConfigImpressao {
  auto: boolean;
  largura: 58 | 80;
  copias: number;
  impressora: string; // só no programa para Windows ('' = padrão do Windows)
}

/** Ponte com o programa BasilFiery para Windows (não existe no navegador). */
interface ProgramaDesktop {
  imprimir: (html: string, larguraMm: number, impressora?: string) => Promise<void>;
  impressoras: () => Promise<{ nome: string; padrao: boolean }[]>;
  mostrar: () => Promise<void>;
}
export const programaDesktop = (): ProgramaDesktop | undefined =>
  (window as unknown as { basilfieryDesktop?: ProgramaDesktop }).basilfieryDesktop;

const CHAVE = 'bf:impressao';
export const EVENTO_CONFIG_IMPRESSAO = 'bf:impressao-mudou';
export const EVENTO_ERRO_IMPRESSAO = 'bf:impressao-erro';

export function lerConfigImpressao(): ConfigImpressao {
  return { auto: false, largura: 80, copias: 1, impressora: '', ...ls.ler<Partial<ConfigImpressao>>(CHAVE, {}) };
}

export function gravarConfigImpressao(c: ConfigImpressao) {
  ls.gravar(CHAVE, c);
  window.dispatchEvent(new Event(EVENTO_CONFIG_IMPRESSAO));
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const agoraTxt = () => new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// Fila: impressões em sequência, para não abrir várias ao mesmo tempo
let fila: Promise<void> = Promise.resolve();

function imprimirHTML(corpo: string, largura: 58 | 80) {
  const html = documento(corpo, largura);
  const desktop = programaDesktop();

  // No programa para Windows: direto na impressora, sem janela
  if (desktop) {
    const { impressora } = lerConfigImpressao();
    fila = fila.then(() => desktop.imprimir(html, largura, impressora || undefined).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e);
      window.dispatchEvent(new CustomEvent(EVENTO_ERRO_IMPRESSAO, { detail: msg }));
    }));
    return;
  }

  // No navegador: janela de impressão (ou direto, com o Chrome em --kiosk-printing)
  fila = fila.then(() => new Promise<void>((resolver) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    const win = iframe.contentWindow!;
    const terminar = () => {
      setTimeout(() => iframe.remove(), 500);
      resolver();
    };
    win.addEventListener('afterprint', terminar, { once: true });
    setTimeout(() => {
      win.focus();
      win.print();
      // Se o "afterprint" não vier (alguns navegadores), segue a fila mesmo assim
      setTimeout(terminar, 1500);
    }, 80);
  }));
}

function documento(corpo: string, largura: 58 | 80) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${largura}mm auto; margin: 0; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 2mm 3mm; width: ${largura}mm; font: ${largura === 58 ? 11 : 12}px/1.35 'Courier New', monospace; color: #000; }
      .via + .via { page-break-before: always; }
      h1 { font-size: 1.35em; margin: 0; text-align: center; }
      .c { text-align: center; }
      .g { font-size: 1.4em; font-weight: 700; }
      hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; }
      td { vertical-align: top; padding: 1px 0; }
      td.q { width: 2.6em; font-weight: 700; }
      td.v { text-align: right; white-space: nowrap; padding-left: 4px; }
      .obs { font-style: italic; }
      .tot { display: flex; justify-content: space-between; font-weight: 700; font-size: 1.2em; }
      .p { font-size: .85em; }
    </style></head><body>${corpo}</body></html>`;
}

function htmlPedido(p: Pedido, restaurante: string) {
  const itens = p.pedido_itens
    .map((i) => `<tr><td class="q">${i.qtd}x</td><td>${esc(i.nome)}${i.obs ? `<div class="obs">» ${esc(i.obs)}</div>` : ''}</td></tr>`)
    .join('');
  return `<div class="via">
    <h1>${esc(restaurante)}</h1>
    <div class="c p">${new Date(p.criado_em).toLocaleString('pt-BR')}</div>
    <hr>
    <div class="c g">PEDIDO #${p.numero}</div>
    <div class="c g">${esc(p.mesa_nome).toUpperCase()}</div>
    <hr>
    <table>${itens}</table>
    ${p.observacao ? `<hr><b>OBS DO PEDIDO:</b><div class="obs">${esc(p.observacao)}</div>` : ''}
    <hr>
    <div class="tot"><span>TOTAL</span><span>${brl(p.total)}</span></div>
  </div>`;
}

export function imprimirPedido(p: Pedido, restaurante: string) {
  const c = lerConfigImpressao();
  const vias = Array.from({ length: Math.max(1, c.copias) }, () => htmlPedido(p, restaurante)).join('');
  imprimirHTML(vias, c.largura);
}

export function imprimirConta(mesaNome: string, restaurante: string, pedidos: Pedido[]) {
  const c = lerConfigImpressao();
  // Agrupa itens iguais (mesmo nome e preço)
  const linhas = new Map<string, { nome: string; qtd: number; preco: number }>();
  for (const p of pedidos) {
    for (const i of p.pedido_itens) {
      const k = `${i.nome}|${i.preco_unit}`;
      const l = linhas.get(k) ?? { nome: i.nome, qtd: 0, preco: i.preco_unit };
      l.qtd += i.qtd;
      linhas.set(k, l);
    }
  }
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  const corpo = `<div class="via">
    <h1>${esc(restaurante)}</h1>
    <div class="c p">${agoraTxt()}</div>
    <hr>
    <div class="c g">CONTA · ${esc(mesaNome).toUpperCase()}</div>
    <hr>
    <table>${[...linhas.values()].map((l) => `<tr><td class="q">${l.qtd}x</td><td>${esc(l.nome)}</td><td class="v">${brl(l.qtd * l.preco)}</td></tr>`).join('')}</table>
    <hr>
    <div class="tot"><span>TOTAL</span><span>${brl(total)}</span></div>
    <hr>
    <div class="c p">Obrigado pela preferência!<br>Não é documento fiscal.</div>
  </div>`;
  imprimirHTML(corpo, c.largura);
}

export function imprimirTeste(restaurante: string) {
  const c = lerConfigImpressao();
  imprimirHTML(`<div class="via"><h1>${esc(restaurante)}</h1><hr><div class="c g">TESTE DE IMPRESSÃO</div><div class="c">${agoraTxt()}</div><hr><div class="c">Papel: ${c.largura} mm<br>Se este texto saiu inteiro e legível, está tudo certo.</div></div>`, c.largura);
}
