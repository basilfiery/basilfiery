import type { Pedido, ResumoCaixa } from './tipos';
import { FORMAS, brl, ls } from './util';

/* =====================================================================
   Impressão térmica (cupom 58/80 mm)
   - Modelos (Cozinha, Pedido completo, Conta da mesa, Caixa…) ficam no
     restaurante: cabeçalho, logo, CNPJ, telefone, mensagens e vias.
   - Impressoras ficam em cada computador: qual impressora do Windows,
     largura do papel e quais modelos ela imprime.
   ===================================================================== */

export type ModeloId = 'cozinha' | 'pedido' | 'conta' | 'caixa' | 'movimento';

export interface ModeloImpressao {
  vias: number;
  cabecalho: boolean;
  mensagem: string;
  logo: boolean;
  cnpj: boolean;
  telefone: boolean;
  site: string;
  rodape: string;
}

/** Guardado em restaurantes.impressao */
export interface ConfigImpressaoLoja {
  logo_url?: string | null;
  cnpj?: string | null;
  telefone?: string | null;
  modelos?: Partial<Record<ModeloId, Partial<ModeloImpressao>>>;
}

export const MODELOS: { id: ModeloId; nome: string; descricao: string }[] = [
  { id: 'cozinha', nome: 'Cozinha', descricao: 'Só os itens, em letra grande, sem preços. Para a produção.' },
  { id: 'pedido', nome: 'Pedido completo', descricao: 'Itens, preços, cliente, endereço e pagamento.' },
  { id: 'conta', nome: 'Conferência e fechamento de mesa', descricao: 'A conta que vai para a mesa.' },
  { id: 'caixa', nome: 'Demonstrativo de fechamento do caixa', descricao: 'Resumo do caixa: recebido por forma e gaveta.' },
  { id: 'movimento', nome: 'Demonstrativo de movimento do caixa', descricao: 'Retirada (sangria) e reforço de troco, com assinatura.' },
];

const PADRAO: Record<ModeloId, ModeloImpressao> = {
  cozinha: { vias: 1, cabecalho: false, mensagem: '', logo: false, cnpj: false, telefone: false, site: '', rodape: '' },
  pedido: { vias: 1, cabecalho: true, mensagem: '', logo: true, cnpj: true, telefone: true, site: '', rodape: 'Obrigado pela preferência!' },
  conta: { vias: 1, cabecalho: true, mensagem: '', logo: true, cnpj: true, telefone: true, site: '', rodape: 'Obrigado pela preferência!\nNão é documento fiscal.' },
  caixa: { vias: 1, cabecalho: true, mensagem: '', logo: false, cnpj: false, telefone: false, site: '', rodape: '' },
  movimento: { vias: 1, cabecalho: true, mensagem: '', logo: false, cnpj: false, telefone: false, site: '', rodape: '' },
};

/* ---------- Impressoras deste computador ---------- */
export interface ImpressoraLocal {
  id: string;
  /** Apelido: "Caixa", "Cozinha"… */
  nome: string;
  /** Impressora do Windows (só no programa); '' = padrão */
  impressora: string;
  largura: 58 | 80;
  modelos: ModeloId[];
}

export interface ConfigImpressao {
  auto: boolean;
  impressoras: ImpressoraLocal[];
  /** Atalhos da primeira impressora (telas antigas) */
  largura: 58 | 80;
  impressora: string;
  copias: number;
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

export const novaImpressora = (parcial: Partial<ImpressoraLocal> = {}): ImpressoraLocal => ({
  id: crypto.randomUUID(), nome: 'Geral', impressora: '', largura: 80, modelos: ['pedido', 'conta', 'caixa', 'movimento'], ...parcial,
});

export function lerConfigImpressao(): ConfigImpressao {
  const salvo = ls.ler<Partial<ConfigImpressao> & { impressoras?: ImpressoraLocal[] }>(CHAVE, {});
  // Configuração antiga (uma impressora só) vira a impressora "Geral"
  const impressoras = salvo.impressoras?.length
    ? salvo.impressoras
    : [novaImpressora({ impressora: salvo.impressora ?? '', largura: salvo.largura === 58 ? 58 : 80 })];
  const p = impressoras[0];
  return { auto: !!salvo.auto, impressoras, largura: p.largura, impressora: p.impressora, copias: 1 };
}

export function gravarConfigImpressao(c: Partial<ConfigImpressao> & { auto: boolean }) {
  const atual = lerConfigImpressao();
  const impressoras = c.impressoras ?? (c.largura || c.impressora !== undefined
    ? atual.impressoras.map((x, i) => (i === 0 ? { ...x, largura: c.largura ?? x.largura, impressora: c.impressora ?? x.impressora } : x))
    : atual.impressoras);
  ls.gravar(CHAVE, { auto: c.auto, impressoras });
  window.dispatchEvent(new Event(EVENTO_CONFIG_IMPRESSAO));
}

/* ---------- Dados do restaurante usados no cabeçalho ---------- */
interface LojaImpressao { nome: string; logo_url: string | null; config: ConfigImpressaoLoja }
let loja: LojaImpressao = { nome: '', logo_url: null, config: {} };

/** O painel avisa qual restaurante está aberto (nome, logo e modelos). */
export function definirLojaImpressao(r: { nome: string; logo_url: string | null; whatsapp?: string | null; impressao?: ConfigImpressaoLoja | null }) {
  const config = r.impressao ?? {};
  loja = { nome: r.nome, logo_url: r.logo_url, config: { ...config, telefone: config.telefone ?? r.whatsapp ?? null } };
  const url = config.logo_url ?? r.logo_url;
  if (url) void prepararLogo(url);
}

export const modeloDe = (id: ModeloId, cfg: ConfigImpressaoLoja = loja.config): ModeloImpressao => ({ ...PADRAO[id], ...(cfg.modelos?.[id] ?? {}) });

/* ---------- Logo em preto e branco (fica guardada neste computador) ---------- */
const CHAVE_LOGO = 'bf:impressao-logo-pb';
let logoPronto: { url: string; data: string } | null = ls.ler(CHAVE_LOGO, null);

export async function prepararLogo(url: string): Promise<string | null> {
  if (logoPronto?.url === url) return logoPronto.data;
  try {
    const blob = await (await fetch(url)).blob();
    const bmp = await createImageBitmap(blob);
    // 320 pontos = 40 mm a 203 dpi (8 pontos por mm): sai 1 para 1, sem borrar
    const escala = Math.min(1, 320 / bmp.width, 180 / bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * escala));
    c.height = Math.max(1, Math.round(bmp.height * escala));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    // Térmica só imprime preto ou nada: converte para preto e branco puro com pontilhado
    // (tons de cinza o driver transforma em pontos falhados)
    const px = g.getImageData(0, 0, c.width, c.height);
    const w = c.width;
    const lum = new Float32Array(w * c.height);
    for (let i = 0; i < lum.length; i++) {
      const k = i * 4;
      const a = px.data[k + 3] / 255;
      const y = 0.299 * px.data[k] + 0.587 * px.data[k + 1] + 0.114 * px.data[k + 2];
      lum[i] = Math.max(0, Math.min(255, ((y * a + 255 * (1 - a)) - 128) * 1.25 + 140));
    }
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const novo = lum[i] < 128 ? 0 : 255;
        const erro = lum[i] - novo;
        lum[i] = novo;
        if (x + 1 < w) lum[i + 1] += (erro * 7) / 16;
        if (y + 1 < c.height) {
          if (x > 0) lum[i + w - 1] += (erro * 3) / 16;
          lum[i + w] += (erro * 5) / 16;
          if (x + 1 < w) lum[i + w + 1] += erro / 16;
        }
      }
    }
    for (let i = 0; i < lum.length; i++) {
      const k = i * 4;
      px.data[k] = px.data[k + 1] = px.data[k + 2] = lum[i];
      px.data[k + 3] = 255;
    }
    g.putImageData(px, 0, 0);
    const data = c.toDataURL('image/png');
    logoPronto = { url, data };
    try { ls.gravar(CHAVE_LOGO, logoPronto); } catch { /* sem espaço: usa só nesta sessão */ }
    return data;
  } catch {
    return null;
  }
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const linhas = (t: string) => esc(t).replace(/\n/g, '<br>');

const agoraTxt = () => new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function cabecalho(m: ModeloImpressao, l: LojaImpressao) {
  if (!m.cabecalho) return '';
  const url = l.config.logo_url ?? l.logo_url;
  const logo = m.logo && url ? `<img class="logo" src="${esc(logoPronto?.url === url ? logoPronto.data : url)}" alt="">` : '';
  const cnpj = m.cnpj && l.config.cnpj ? `<div class="c p">CNPJ: ${esc(l.config.cnpj)}</div>` : '';
  const tel = m.telefone && l.config.telefone ? `<div class="c p">Telefone: ${esc(l.config.telefone)}</div>` : '';
  const site = m.site ? `<div class="c p">${esc(m.site)}</div>` : '';
  const msg = m.mensagem ? `<div class="c p">${linhas(m.mensagem)}</div>` : '';
  return `${logo}<h1>${esc(l.nome)}</h1>${msg}${cnpj}${tel}${site}<hr class="duplo">`;
}

function rodape(m: ModeloImpressao) {
  return `${m.rodape ? `<hr><div class="c p">${linhas(m.rodape)}</div>` : ''}<div class="feito">Feito por: Basil Fiery</div>`;
}

// Fila: impressões em sequência, para não abrir várias ao mesmo tempo
let fila: Promise<void> = Promise.resolve();

function imprimirHTML(corpo: string, largura: 58 | 80, impressora = '') {
  const html = documento(corpo, largura);
  const desktop = programaDesktop();

  // No programa para Windows: direto na impressora, sem janela
  if (desktop) {
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
    }, 150);
  }));
}

/**
 * Cupom para impressora térmica (Epson TM-T20X e parecidas).
 * - O papel de 80 mm só imprime 72 mm (4 mm de margem em cada lado); o de 58 mm, 48 mm.
 *   O texto fica dentro disso, com folga, para nada passar da borda.
 * - A térmica só faz preto: nada de cinza, texto fino ou filtros (o Windows transforma em pontos falhados).
 *   Fonte sem serifa, em negrito, preta.
 */
export function documento(corpo: string, largura: 58 | 80) {
  const margem = largura === 58 ? 5.5 : 5; // mm de cada lado (área morta da cabeça + folga)
  const fonte = largura === 58 ? 11.5 : 13; // px
  const logo = largura === 58 ? 30 : 40; // mm
  return `<!doctype html><html><head><meta charset="utf-8"><style>
      @page { size: ${largura}mm auto; margin: 0; }
      * { box-sizing: border-box; color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; background: #fff; }
      body { width: ${largura}mm; padding: 2mm ${margem}mm 3mm; font: 700 ${fonte}px/1.38 Arial, 'Helvetica Neue', Helvetica, 'Segoe UI', sans-serif; letter-spacing: .01em; -webkit-font-smoothing: none; text-rendering: geometricPrecision; overflow-wrap: anywhere; word-break: break-word; }
      .via { width: 100%; overflow: hidden; }
      .via + .via { page-break-before: always; break-before: page; }
      .logo { display: block; width: auto; max-width: min(${logo}mm, 100%); height: auto; margin: 0 auto 4px; image-rendering: pixelated; }
      h1 { font-size: 1.3em; font-weight: 900; margin: 0; text-align: center; line-height: 1.2; }
      .c { text-align: center; }
      .g { font-size: 1.35em; font-weight: 900; line-height: 1.25; }
      .gg { font-size: 1.6em; font-weight: 900; line-height: 1.2; }
      hr { border: 0; border-top: 1.5px dashed #000; margin: 6px 0; }
      hr.duplo { border-top: 3px double #000; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      td { vertical-align: top; padding: 1.5px 0; }
      td.q { width: 2.4em; font-weight: 900; }
      td.v { width: 6.4em; text-align: right; white-space: nowrap; padding-left: 4px; }
      .cozinha td { font-size: 1.22em; padding: 3px 0; }
      .cozinha td.q { width: 2.2em; }
      .obs { font-style: normal; font-weight: 700; }
      .adic { font-weight: 700; font-size: .95em; }
      .tot { display: flex; justify-content: space-between; gap: 6px; font-weight: 900; font-size: 1.18em; }
      .tot span:last-child { white-space: nowrap; }
      .p { font-size: .9em; font-weight: 700; }
      .feito { margin-top: 8px; padding-top: 5px; border-top: 1.5px dotted #000; text-align: center; font-size: .85em; }
    </style></head><body>${corpo}</body></html>`;
}

/** Imprime um modelo nas impressoras ligadas a ele (manual: se nenhuma estiver ligada, usa a primeira). */
function imprimirModelo(id: ModeloId, corpo: (largura: 58 | 80) => string, manual = true, so?: ImpressoraLocal) {
  const cfg = lerConfigImpressao();
  let alvo = so ? [so] : cfg.impressoras.filter((i) => i.modelos.includes(id));
  if (!alvo.length && manual) alvo = cfg.impressoras.slice(0, 1);
  const m = modeloDe(id);
  for (const imp of alvo) {
    const via = `<div class="via">${cabecalho(m, loja)}${corpo(imp.largura)}${rodape(m)}</div>`;
    imprimirHTML(Array.from({ length: Math.max(1, Math.min(5, m.vias)) }, () => via).join(''), imp.largura, imp.impressora);
  }
  return alvo.length;
}

/* ---------- Conteúdo de cada modelo ---------- */
const FORMA_TXT: Record<string, string> = { pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Cartão de crédito', debito: 'Cartão de débito' };
const rotuloPagamento = (p: Pedido) =>
  `Pagamento: ${FORMA_TXT[p.forma_pagamento ?? ''] ?? '—'}${p.troco_para ? ` · ${p.tipo === 'balcao' ? 'recebido' : 'troco para'} ${brl(Number(p.troco_para))}` : ''}${p.pago_em ? ' · PAGO' : ''}`;

/** Cliente e endereço no cupom de delivery/retirada. */
function htmlCliente(p: Pedido) {
  const e = p.endereco;
  if (p.tipo === 'balcao') return p.cliente_nome || p.cliente_telefone ? `<hr><b>${esc(p.cliente_nome ?? '')}</b>${p.cliente_telefone ? ` · ${esc(p.cliente_telefone)}` : ''}` : '';
  return `<hr>
    <b>${esc(p.cliente_nome ?? '')}</b>${p.cliente_telefone ? ` · ${esc(p.cliente_telefone)}` : ''}
    ${e ? `<div>${esc(e.rua)}, ${esc(e.numero)}${e.complemento ? ` - ${esc(e.complemento)}` : ''}</div><div>${esc(e.bairro)}</div>${e.referencia ? `<div class="obs">Ref.: ${esc(e.referencia)}</div>` : ''}` : '<div>Retirada no balcão</div>'}`;
}

const itemHtml = (i: Pedido['pedido_itens'][number], comPreco: boolean) =>
  `<tr><td class="q">${i.qtd}x</td><td>${esc(i.nome)}${i.complementos ? `<div class="adic">${esc(i.complementos)}</div>` : ''}${i.obs ? `<div class="obs">» ${esc(i.obs)}</div>` : ''}</td>${comPreco ? `<td class="v">${brl(i.qtd * Number(i.preco_unit))}</td>` : ''}</tr>`;

function corpoPedido(p: Pedido) {
  return `<div class="c p">${new Date(p.criado_em).toLocaleString('pt-BR')}</div>
    <div class="c g">PEDIDO #${p.numero}</div>
    <div class="c g">${esc(p.mesa_nome).toUpperCase()}</div>
    ${p.tipo && p.tipo !== 'mesa' ? htmlCliente(p) : ''}
    <hr>
    <table>${p.pedido_itens.map((i) => itemHtml(i, true)).join('')}</table>
    ${p.observacao ? `<hr><b>OBS DO PEDIDO:</b><div class="obs">${esc(p.observacao)}</div>` : ''}
    <hr>
    ${Number(p.taxa_entrega) > 0 ? `<div class="tot" style="font-size:1em"><span>Entrega</span><span>${brl(Number(p.taxa_entrega))}</span></div>` : ''}
    ${Number(p.desconto) > 0 ? `<div class="tot" style="font-size:1em"><span>Desconto</span><span>- ${brl(Number(p.desconto))}</span></div>` : ''}
    <div class="tot"><span>TOTAL</span><span>${brl(p.total)}</span></div>
    ${p.tipo && p.tipo !== 'mesa' ? `<div class="c p">${esc(rotuloPagamento(p))}</div>` : ''}`;
}

function corpoCozinha(p: Pedido) {
  return `<div class="c gg">#${p.numero} · ${esc(p.mesa_nome).toUpperCase()}</div>
    <div class="c p">${new Date(p.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${p.cliente_nome ? ` · ${esc(p.cliente_nome)}` : ''}</div>
    <hr>
    <table class="cozinha">${p.pedido_itens.map((i) => itemHtml(i, false)).join('')}</table>
    ${p.observacao ? `<hr><b>OBS:</b> <span class="obs">${esc(p.observacao)}</span>` : ''}`;
}

function corpoConta(mesaNome: string, pedidos: Pedido[]) {
  // Agrupa itens iguais (mesmo nome, adicionais e preço)
  const ls2 = new Map<string, { nome: string; complementos?: string | null; qtd: number; preco: number }>();
  for (const p of pedidos) {
    for (const i of p.pedido_itens) {
      const k = `${i.nome}|${i.complementos ?? ''}|${i.preco_unit}`;
      const l = ls2.get(k) ?? { nome: i.nome, complementos: i.complementos, qtd: 0, preco: Number(i.preco_unit) };
      l.qtd += i.qtd;
      ls2.set(k, l);
    }
  }
  const total = pedidos.reduce((s, p) => s + Number(p.total), 0);
  return `<div class="c p">${agoraTxt()}</div>
    <div class="c g">CONTA · ${esc(mesaNome).toUpperCase()}</div>
    <hr>
    <table>${[...ls2.values()].map((l) => `<tr><td class="q">${l.qtd}x</td><td>${esc(l.nome)}${l.complementos ? `<div class="adic">${esc(l.complementos)}</div>` : ''}</td><td class="v">${brl(l.qtd * l.preco)}</td></tr>`).join('')}</table>
    <hr>
    <div class="tot"><span>TOTAL</span><span>${brl(total)}</span></div>`;
}

function corpoFechamento(r: ResumoCaixa, parcial: boolean) {
  const dt = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const linha = (rotulo: string, valor: string) => `<tr><td>${esc(rotulo)}</td><td class="v">${valor}</td></tr>`;
  const formas = FORMAS.filter((f) => r.por_forma[f.id]).map((f) => linha(f.rotulo, brl(Number(r.por_forma[f.id])))).join('')
    || linha('Nenhum pagamento', brl(0));
  const conferencia = r.valor_contado !== undefined && r.valor_contado !== null
    ? `${linha('Dinheiro contado', brl(Number(r.valor_contado)))}${linha(Number(r.diferenca) >= 0 ? 'Sobra' : 'Falta', brl(Math.abs(Number(r.diferenca))))}`
    : '';
  return `<div class="c g">${parcial ? 'PARCIAL DO CAIXA' : 'FECHAMENTO DE CAIXA'}</div>
    <hr>
    <table>
      ${linha('Aberto', dt(r.aberto_em))}
      ${r.aberto_por_nome ? linha('Por', esc(r.aberto_por_nome)) : ''}
      ${linha(parcial ? 'Até' : 'Fechado', dt(r.ate))}
      ${r.fechado_por_nome ? linha('Por', esc(r.fechado_por_nome)) : ''}
    </table>
    <hr>
    <b>RECEBIDO POR FORMA</b>
    <table>${formas}</table>
    <div class="tot"><span>TOTAL RECEBIDO</span><span>${brl(Number(r.recebido))}</span></div>
    <div class="p">${r.contas_fechadas} conta(s) fechada(s)</div>
    <hr>
    <b>GAVETA (DINHEIRO)</b>
    <table>
      ${linha('Troco inicial', brl(Number(r.valor_inicial)))}
      ${linha('+ Recebido em dinheiro', brl(Number(r.por_forma.dinheiro ?? 0)))}
      ${Number(r.suprimentos ?? 0) > 0 ? linha('+ Reforços de troco', brl(Number(r.suprimentos))) : ''}
      ${Number(r.retiradas ?? 0) > 0 ? linha('- Retiradas', brl(Number(r.retiradas))) : ''}
      ${linha('= Esperado', brl(Number(r.dinheiro_esperado)))}
      ${conferencia}
    </table>
    <hr>
    <table>
      ${linha(`Vendas (${r.vendas.pedidos} pedidos)`, brl(Number(r.vendas.total)))}
      ${linha(`Cancelados (${r.cancelados.pedidos})`, brl(Number(r.cancelados.total)))}
      ${linha(`Em aberto (${r.em_aberto.mesas} mesas)`, brl(Number(r.em_aberto.total)))}
    </table>
    ${r.observacao ? `<hr><b>OBS:</b> ${esc(r.observacao)}` : ''}
    <div class="c p">Impresso em ${agoraTxt()}</div>`;
}

type Movimento = { tipo: 'retirada' | 'suprimento'; valor: number; motivo: string | null; user_nome: string | null; criado_em: string };
function corpoMovimento(m: Movimento, esperadoDepois: number) {
  return `<div class="c g">${m.tipo === 'retirada' ? 'RETIRADA DE CAIXA' : 'REFORÇO DE TROCO'}</div>
    <div class="c p">${new Date(m.criado_em).toLocaleString('pt-BR')}</div>
    <hr>
    <div class="tot"><span>VALOR</span><span>${brl(Number(m.valor))}</span></div>
    ${m.motivo ? `<div><b>Motivo:</b> ${esc(m.motivo)}</div>` : ''}
    ${m.user_nome ? `<div><b>Por:</b> ${esc(m.user_nome)}</div>` : ''}
    <hr>
    <div>Dinheiro esperado na gaveta agora: <b>${brl(esperadoDepois)}</b></div>
    <br><br>
    <div class="c">______________________________</div>
    <div class="c p">Assinatura</div>`;
}

/* ---------- O que o sistema chama ---------- */

/**
 * Pedido novo (automático): sai a comanda da cozinha e/ou o pedido completo,
 * cada um nas impressoras ligadas. Reimpressão manual: pedido completo.
 */
export function imprimirPedido(p: Pedido, restaurante: string, opcoes: { automatico?: boolean; modelo?: ModeloId } = {}) {
  if (restaurante) loja = { ...loja, nome: restaurante };
  if (opcoes.automatico) {
    const n = imprimirModelo('cozinha', () => corpoCozinha(p), false) + imprimirModelo('pedido', () => corpoPedido(p), false);
    if (!n) imprimirModelo('pedido', () => corpoPedido(p), true);
    return;
  }
  const modelo = opcoes.modelo ?? 'pedido';
  imprimirModelo(modelo, () => (modelo === 'cozinha' ? corpoCozinha(p) : corpoPedido(p)));
}

export function imprimirConta(mesaNome: string, restaurante: string, pedidos: Pedido[]) {
  if (restaurante) loja = { ...loja, nome: restaurante };
  imprimirModelo('conta', () => corpoConta(mesaNome, pedidos));
}

/** Cupom de fechamento (ou parcial) do caixa. */
export function imprimirFechamento(r: ResumoCaixa, restaurante: string, parcial: boolean) {
  if (restaurante) loja = { ...loja, nome: restaurante };
  imprimirModelo('caixa', () => corpoFechamento(r, parcial));
}

/** Comprovante de retirada (sangria) ou reforço de troco, com espaço para assinatura. */
export function imprimirMovimentoCaixa(m: Movimento, restaurante: string, esperadoDepois: number) {
  if (restaurante) loja = { ...loja, nome: restaurante };
  imprimirModelo('movimento', () => corpoMovimento(m, esperadoDepois));
}

/** Teste: numa impressora específica (ou na primeira). */
export function imprimirTeste(restaurante: string, impressora?: ImpressoraLocal, modelo: ModeloId = 'pedido') {
  if (restaurante) loja = { ...loja, nome: restaurante };
  const imp = impressora ?? lerConfigImpressao().impressoras[0];
  imprimirModelo(modelo, (larg) => `<div class="c g">TESTE DE IMPRESSÃO</div><div class="c">${agoraTxt()}</div><hr>
    <div class="c">Impressora: ${esc(imp.nome)}<br>Papel: ${larg} mm<br>Se este texto saiu inteiro e legível, está tudo certo.</div>`, true, imp);
}

/** Lista simples (ex.: lista de compras), com caixinha para marcar à caneta. */
export function imprimirLista(titulo: string, grupos: { grupo: string; itens: string[] }[]) {
  imprimirModelo('caixa', () => `<div class="c g">${esc(titulo)}</div><div class="c p">${agoraTxt()}</div><hr>${grupos
    .map((g) => `<b>${esc(g.grupo.toUpperCase())}</b><table>${g.itens.map((i) => `<tr><td class="q">[ ]</td><td>${esc(i)}</td></tr>`).join('')}</table>`)
    .join('<hr>')}`);
}

/* ---------- Prévia (tela de configuração) ---------- */
const PEDIDO_EXEMPLO = {
  id: 'x', restaurante_id: 'x', mesa_id: null, mesa_nome: 'Mesa 2', numero: 128, status: 'novo', observacao: 'Sem cebola na porção',
  total: 117.8, criado_em: new Date().toISOString(), atualizado_em: '', impresso_em: null, pago_em: null, precisa_preparo: true,
  tipo: 'mesa', cliente_nome: null, cliente_telefone: null, endereco: null, forma_pagamento: null, troco_para: null, taxa_entrega: 0, desconto: 0,
  pedido_itens: [
    { id: '1', pedido_id: 'x', produto_id: null, nome: 'Pizza G', preco_unit: 74.9, qtd: 1, obs: 'Bem assada', complementos: 'Sabores: 1/2 Calabresa, 1/2 Frango' },
    { id: '2', pedido_id: 'x', produto_id: null, nome: 'Batata frita', preco_unit: 25, qtd: 1, obs: null },
    { id: '3', pedido_id: 'x', produto_id: null, nome: 'Coca-Cola 2L', preco_unit: 17.9, qtd: 1, obs: null },
  ],
} as unknown as Pedido;

const RESUMO_EXEMPLO = {
  caixa_id: 'x', aberto_em: new Date(Date.now() - 8 * 3600e3).toISOString(), aberto_por_nome: 'Adriano', valor_inicial: 100,
  ate: new Date().toISOString(), vendas: { pedidos: 42, total: 2380.5 }, cancelados: { pedidos: 1, total: 35 }, recebido: 2380.5,
  contas_fechadas: 31, por_forma: { pix: 1210.5, dinheiro: 640, credito: 380, debito: 150 }, dinheiro_esperado: 640, em_aberto: { mesas: 0, total: 0 },
  retiradas: 100, suprimentos: 0, fechado_por_nome: 'Adriano', valor_contado: 640, diferenca: 0,
} as unknown as ResumoCaixa;

/** HTML completo do cupom de exemplo, com os ajustes que a pessoa está fazendo. */
export function previaModelo(id: ModeloId, m: ModeloImpressao, cfg: ConfigImpressaoLoja, nome: string, logoRestaurante: string | null, largura: 58 | 80) {
  const l: LojaImpressao = { nome, logo_url: logoRestaurante, config: cfg };
  const corpo = id === 'cozinha' ? corpoCozinha(PEDIDO_EXEMPLO)
    : id === 'pedido' ? corpoPedido(PEDIDO_EXEMPLO)
      : id === 'conta' ? corpoConta('Mesa 2', [PEDIDO_EXEMPLO])
        : id === 'caixa' ? corpoFechamento(RESUMO_EXEMPLO, false)
          : corpoMovimento({ tipo: 'retirada', valor: 100, motivo: 'Pagamento do gás', user_nome: 'Adriano', criado_em: new Date().toISOString() }, 540);
  return documento(`<div class="via">${cabecalho(m, l)}${corpo}${rodape(m)}</div>`, largura);
}
