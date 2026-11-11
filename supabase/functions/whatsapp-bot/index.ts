// Bot do WhatsApp do financeiro (WhatsApp Cloud API da Meta).
//   GET  → verificação do webhook (hub.challenge)
//   POST → mensagens recebidas: foto/PDF de comprovante ou texto ("comprei 3 kg de queijo por 120 no pix")
//          viram despesas no financeiro da loja dona do número que mandou.
// Segredos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET (recomendado),
//           ANTHROPIC_API_KEY (ler fotos; sem ela o bot só entende texto simples).
import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.8.0/helpers/zod';
import { z } from 'npm:zod@4.6.7';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const WA_PHONE = Deno.env.get('WHATSAPP_PHONE_ID') ?? '';
const WA_VERIFY = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
const WA_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
const CHAVE_IA = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
const GRAPH = 'https://graph.facebook.com/v21.0';
const MODELO = Deno.env.get('CLAUDE_MODELO_FINANCEIRO') || 'claude-opus-5-5';

const CATEGORIAS = [
  'Mercadorias e insumos', 'Uso e consumo', 'Embalagens', 'Folha de pagamento', 'Aluguel', 'Água, luz e gás',
  'Internet e telefone', 'Impostos e taxas', 'Taxas de cartão e apps', 'Manutenção', 'Marketing',
  'Pró-labore (retirada do dono)', 'Outras despesas', 'Outras receitas',
] as const;
const FORMAS = ['dinheiro', 'pix', 'debito', 'credito', 'boleto', 'transferencia'] as const;
const FORMA_TXT: Record<string, string> = { dinheiro: 'dinheiro', pix: 'Pix', debito: 'débito', credito: 'crédito', boleto: 'boleto', transferencia: 'transferência' };

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');

/* ---------------- Leitura com IA (foto, PDF ou texto) ---------------- */
const Leitura = z.object({
  eh_lancamento: z.boolean().describe('true se a mensagem descreve uma compra, despesa, conta ou receita da empresa'),
  tipo: z.enum(['despesa', 'receita']),
  valor_total: z.number().nullable().describe('valor total em reais; null se não der para saber'),
  descricao: z.string().describe('descrição curta em português, ex.: "Compra de queijo e calabresa"'),
  categoria: z.enum(CATEGORIAS),
  fornecedor: z.string().nullable(),
  data: z.string().nullable().describe('data da compra no formato AAAA-MM-DD, se aparecer'),
  forma: z.enum(FORMAS).nullable(),
  pago: z.boolean().describe('false só se for uma conta/boleto ainda a pagar'),
  vencimento: z.string().nullable().describe('AAAA-MM-DD, só para contas a pagar'),
  itens: z.array(z.object({ nome: z.string(), qtd: z.number().nullable(), valor: z.number().nullable() })),
  duvida: z.string().nullable().describe('pergunta curta ao dono se faltar algo essencial (ex.: o valor)'),
});
type LeituraT = z.infer<typeof Leitura>;

const SISTEMA = `Você lê comprovantes e mensagens do dono de um restaurante/pizzaria no Brasil e transforma em um lançamento financeiro.
- Fotos podem ser cupom fiscal, nota, recibo, boleto, comprovante de Pix ou de cartão. Use o TOTAL pago (não some itens se o total aparecer).
- Texto livre: "comprei 2 caixas de tomate 80 reais no pix" → despesa de R$ 80,00, Mercadorias e insumos, forma pix.
- Categorias: ingredientes e bebidas para revenda = "Mercadorias e insumos"; limpeza, gás de cozinha em botijão, material de escritório = "Uso e consumo"; caixas de pizza, sacolas = "Embalagens"; conta de luz/água/gás encanado = "Água, luz e gás"; vale ou salário de funcionário = "Folha de pagamento".
- Boleto ou conta ainda não paga: pago=false e o vencimento.
- Datas sem ano: use o ano atual. Hoje é ${hojeBR()}.
- Se a mensagem não for sobre dinheiro da empresa (ex.: "oi", "obrigado"), eh_lancamento=false.
- Se não der para saber o valor, valor_total=null e escreva em "duvida" o que falta.`;

async function lerComIA(conteudo: Anthropic.ContentBlockParam[]): Promise<LeituraT | null> {
  const ia = new Anthropic({ apiKey: CHAVE_IA });
  const pedido = {
    model: MODELO,
    max_tokens: 4000,
    system: SISTEMA,
    output_config: { effort: 'low' as const, format: zodOutputFormat(Leitura) },
    messages: [{ role: 'user' as const, content: conteudo }],
  };
  // Se o modelo recusar, o servidor tenta de novo em outro modelo (fallback automático)
  let r;
  try {
    r = await ia.beta.messages.parse({ ...pedido, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as never);
  } catch (e) {
    if (!(e instanceof Anthropic.BadRequestError)) throw e;
    r = await ia.messages.parse(pedido);
  }
  const resp = r as { stop_reason: string | null; parsed_output: LeituraT | null };
  if (resp.stop_reason === 'refusal') return null;
  return resp.parsed_output ?? null;
}

/** Sem IA: entende "queijo 120", "comprei tomate por 25,90 no pix" */
function lerTextoSimples(texto: string): LeituraT | null {
  // O valor é o número com "R$"/"reais", ou depois de "por/de/deu/paguei", ou com centavos; senão, o último número.
  // (o "3" de "3 kg de queijo" é quantidade, não valor)
  const numeros = [...texto.matchAll(/(r\$\s*|\b(?:por|deu|paguei|custou|total|de)\s+)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:reais|real|conto|pila))?(\s*(?:kg|g|un|und|unidades?|caixas?|pacotes?|litros?|l|x)\b)?/gi)]
    .filter((x) => !x[4]);
  if (!numeros.length) return null;
  const m = numeros.find((x) => x[1] || x[3]) ?? numeros.find((x) => /[.,]\d{1,2}$/.test(x[2])) ?? numeros[numeros.length - 1];
  const valor = Number(m[2].includes(',') ? m[2].replace(/\./g, '').replace(',', '.') : m[2]);
  if (!(valor > 0)) return null;
  const t = texto.toLowerCase();
  const forma = (['pix', 'dinheiro', 'debito', 'credito', 'boleto'] as const).find((f) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').includes(f)) ?? null;
  const descricao = texto.replace(m[0], ' ')
    .replace(/\b(no|na|em|por|de|com)\s+(pix|dinheiro|d[ée]bito|cr[ée]dito|cart[ãa]o|boleto)\b/gi, '')
    .replace(/^\s*(comprei|paguei|gastei|compra de|compra)\s+/i, '')
    .replace(/\b(pix|dinheiro|d[ée]bito|cr[ée]dito|boleto)\b/gi, '')
    .replace(/\s+(por|de|no|na)\s*$/i, '').replace(/\s+/g, ' ').trim() || 'Despesa';
  const categoria = /luz|energia|[áa]gua|g[áa]s encanado/i.test(t) ? 'Água, luz e gás'
    : /aluguel/i.test(t) ? 'Aluguel' : /internet|telefone/i.test(t) ? 'Internet e telefone'
      : /caixa de pizza|embalage|sacola/i.test(t) ? 'Embalagens' : /limpeza|detergente|papel|g[áa]s|botij/i.test(t) ? 'Uso e consumo'
        : /vale|sal[áa]rio/i.test(t) ? 'Folha de pagamento' : 'Mercadorias e insumos';
  return { eh_lancamento: true, tipo: 'despesa', valor_total: valor, descricao: descricao[0].toUpperCase() + descricao.slice(1, 120), categoria,
    fornecedor: null, data: null, forma, pago: true, vencimento: null, itens: [], duvida: null };
}

/* ---------------- WhatsApp ---------------- */
async function responder(para: string, texto: string) {
  if (!WA_TOKEN || !WA_PHONE) return;
  const r = await fetch(`${GRAPH}/${WA_PHONE}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'text', text: { body: texto.slice(0, 4000) } }),
  });
  if (!r.ok) console.error('whatsapp envio', r.status, await r.text());
}

async function baixarMidia(id: string): Promise<{ bytes: Uint8Array; tipo: string }> {
  const info = await fetch(`${GRAPH}/${id}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } }).then((r) => r.json());
  if (!info.url) throw new Error('mídia sem url');
  const r = await fetch(info.url, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return { bytes: new Uint8Array(await r.arrayBuffer()), tipo: (info.mime_type as string).split(';')[0] };
}

async function assinaturaOk(corpo: string, assinatura: string | null) {
  if (!WA_SECRET) return true;
  if (!assinatura?.startsWith('sha256=')) return false;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(WA_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  const esperado = assinatura.slice(7);
  if (hex.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ esperado.charCodeAt(i);
  return dif === 0;
}

/** Número do WhatsApp → loja. Celulares antigos chegam sem o 9 (55 11 8765-4321). */
async function acharLoja(de: string) {
  const variantes = [de];
  if (/^55\d{10}$/.test(de)) variantes.push(de.slice(0, 4) + '9' + de.slice(4));
  if (/^55\d{11}$/.test(de)) variantes.push(de.slice(0, 4) + de.slice(5));
  const { data } = await admin.from('fin_bot_numeros').select('restaurante_id, nome, ativo, restaurantes(nome)').in('telefone', variantes).eq('ativo', true).limit(1);
  return (data?.[0] ?? null) as { restaurante_id: string; nome: string; restaurantes: { nome: string } | null } | null;
}

const AJUDA = (loja: string) => `Oi! Sou o assistente financeiro da *${loja}* 📒

Para lançar uma despesa:
📸 Mande a *foto do comprovante* (nota, cupom, recibo, Pix ou boleto)
✍️ Ou escreva: _"comprei 3 kg de queijo por 120 no pix"_

Comandos:
• *resumo*: como está o mês
• *contas*: o que vence nos próximos dias
• *desfazer*: apaga o último lançamento feito por aqui`;

async function resumoMes(rest: string) {
  const hoje = hojeBR();
  const ini = hoje.slice(0, 8) + '01';
  const iniTs = new Date(`${ini}T03:00:00Z`).toISOString();
  const [v, d, p] = await Promise.all([
    admin.from('pedidos').select('total').eq('restaurante_id', rest).neq('status', 'cancelado').gte('criado_em', iniTs),
    admin.from('fin_lancamentos').select('valor').eq('restaurante_id', rest).eq('tipo', 'despesa').eq('pago', true).gte('pago_em', ini),
    admin.from('fin_lancamentos').select('valor, vencimento, data').eq('restaurante_id', rest).eq('tipo', 'despesa').eq('pago', false),
  ]);
  const vendas = (v.data ?? []).reduce((s, x) => s + Number(x.total), 0);
  const despesas = (d.data ?? []).reduce((s, x) => s + Number(x.valor), 0);
  const fimMes = new Date(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0).toISOString().slice(0, 10);
  const aPagar = (p.data ?? []).filter((x) => (x.vencimento ?? x.data) <= fimMes).reduce((s, x) => s + Number(x.valor), 0);
  const vencidas = (p.data ?? []).filter((x) => (x.vencimento ?? x.data) < hoje);
  return `📊 *Resumo do mês* (até ${dataBR(hoje)})

Vendas: *${brl(vendas)}*
Despesas pagas: *${brl(despesas)}*
Resultado: *${brl(vendas - despesas)}*
A pagar até o fim do mês: ${brl(aPagar)}${vencidas.length ? `\n⚠️ ${vencidas.length} conta(s) vencida(s)` : ''}`;
}

async function contasProximas(rest: string) {
  const { data } = await admin.from('fin_lancamentos').select('descricao, valor, vencimento, data').eq('restaurante_id', rest)
    .eq('tipo', 'despesa').eq('pago', false).order('vencimento', { ascending: true }).limit(10);
  if (!data?.length) return '✅ Nenhuma conta a pagar. Tudo em dia!';
  const hoje = hojeBR();
  return `🗓️ *Contas a pagar*\n\n${data.map((c) => {
    const v = c.vencimento ?? c.data;
    return `${v < hoje ? '⚠️' : '•'} ${dataBR(v)} · ${c.descricao}: *${brl(Number(c.valor))}*`;
  }).join('\n')}`;
}

/* ---------------- Uma mensagem ---------------- */
// deno-lint-ignore no-explicit-any
async function tratar(msg: any, nomeContato: string) {
  const de = String(msg.from ?? '').replace(/\D/g, '');
  const tipo = String(msg.type ?? 'text');
  const texto: string = msg.text?.body ?? msg.image?.caption ?? msg.document?.caption ?? '';
  // Não repete a mesma mensagem (a Meta reenvia quando demora)
  const { data: reg, error: eReg } = await admin.from('fin_bot_mensagens')
    .insert({ telefone: de, wa_id: msg.id, tipo, texto: texto.slice(0, 1000) }).select('id').single();
  if (eReg) return; // já tratada
  const loja = await acharLoja(de);
  const marcar = (campos: Record<string, unknown>) => admin.from('fin_bot_mensagens').update(campos).eq('id', reg.id);
  if (!loja) {
    const r = 'Este número ainda não está ligado a nenhuma loja. No BasilFiery, vá em *Financeiro › Bot do WhatsApp* e cadastre este número.';
    await responder(de, r);
    await marcar({ resposta: r });
    return;
  }
  const rest = loja.restaurante_id;
  const nomeLoja = loja.restaurantes?.nome ?? 'sua loja';
  await marcar({ restaurante_id: rest });
  const enviar = async (r: string, lanc?: string) => { await responder(de, r); await marcar({ resposta: r, ...(lanc ? { lancamento_id: lanc } : {}) }); };

  const cmd = texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (tipo === 'text' && /^(oi|ola|ajuda|menu|bom dia|boa tarde|boa noite|\?)$/.test(cmd)) return enviar(AJUDA(nomeLoja));
  if (tipo === 'text' && /^resumo/.test(cmd)) return enviar(await resumoMes(rest));
  if (tipo === 'text' && /^(contas|a pagar|vencimentos?)$/.test(cmd)) return enviar(await contasProximas(rest));
  if (tipo === 'text' && /^(desfazer|apagar|cancelar)$/.test(cmd)) {
    const { data: ult } = await admin.from('fin_bot_mensagens').select('lancamento_id').eq('telefone', de).eq('restaurante_id', rest)
      .not('lancamento_id', 'is', null).gte('criado_em', new Date(Date.now() - 24 * 3600e3).toISOString()).order('criado_em', { ascending: false }).limit(1);
    const id = ult?.[0]?.lancamento_id;
    if (!id) return enviar('Não achei nenhum lançamento feito por aqui nas últimas 24 horas.');
    const { data: l } = await admin.from('fin_lancamentos').delete().eq('id', id).select('descricao, valor, comprovante_path').single();
    if (l?.comprovante_path) await admin.storage.from('financeiro').remove([l.comprovante_path]);
    return enviar(l ? `🗑️ Apaguei: ${l.descricao} (${brl(Number(l.valor))}).` : 'Esse lançamento já tinha sido apagado.');
  }
  if (tipo === 'audio') return enviar('Ainda não consigo ouvir áudio 🙈 Mande a foto do comprovante ou escreva o que comprou e o valor.');
  if (!['text', 'image', 'document'].includes(tipo)) return enviar(AJUDA(nomeLoja));

  // Foto/PDF: guarda o comprovante e lê com IA
  let leitura: LeituraT | null = null;
  let comprovante: string | null = null;
  try {
    if (tipo === 'image' || tipo === 'document') {
      if (!CHAVE_IA) return enviar('Ainda não consigo ler fotos (a leitura automática está sendo ativada). Por enquanto, escreva o que comprou e o valor, ex.: "queijo 120 no pix".');
      const midia = await baixarMidia(msg.image?.id ?? msg.document?.id);
      const pdf = midia.tipo === 'application/pdf';
      if (!pdf && !midia.tipo.startsWith('image/')) return enviar('Esse arquivo eu não consigo ler. Mande uma foto ou um PDF do comprovante.');
      const ext = pdf ? 'pdf' : (midia.tipo.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
      comprovante = `${rest}/comprovantes/wa-${msg.id.replace(/[^a-zA-Z0-9]/g, '').slice(-24)}.${ext}`;
      await admin.storage.from('financeiro').upload(comprovante, midia.bytes, { contentType: midia.tipo, upsert: true });
      const b64 = encodeBase64(midia.bytes);
      const bloco: Anthropic.ContentBlockParam = pdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
        : { type: 'image', source: { type: 'base64', media_type: midia.tipo as 'image/jpeg', data: b64 } };
      leitura = await lerComIA([bloco, { type: 'text', text: texto ? `Mensagem junto: ${texto}` : 'Leia este comprovante.' }]);
    } else {
      leitura = CHAVE_IA ? await lerComIA([{ type: 'text', text: texto }]) : lerTextoSimples(texto);
    }
  } catch (e) {
    console.error('leitura', e);
    return enviar('Não consegui ler agora 😕 Tente de novo em instantes ou escreva o que comprou e o valor.');
  }

  if (!leitura || !leitura.eh_lancamento) return enviar(AJUDA(nomeLoja));
  if (!leitura.valor_total || leitura.valor_total <= 0) {
    return enviar(leitura.duvida ?? 'Não achei o valor 🤔 Me diga quanto foi, ex.: "queijo 120 no pix".');
  }

  const data = /^\d{4}-\d{2}-\d{2}$/.test(leitura.data ?? '') && leitura.data! <= hojeBR() ? leitura.data! : hojeBR();
  const venc = !leitura.pago && /^\d{4}-\d{2}-\d{2}$/.test(leitura.vencimento ?? '') ? leitura.vencimento : null;
  const tipoLanc = leitura.categoria === 'Outras receitas' ? 'receita' : leitura.tipo;
  const { data: lanc, error } = await admin.from('fin_lancamentos').insert({
    restaurante_id: rest, tipo: tipoLanc, categoria: tipoLanc === 'receita' ? 'Outras receitas' : leitura.categoria,
    descricao: leitura.descricao.slice(0, 160) || 'Despesa', valor: Math.round(leitura.valor_total * 100) / 100, data,
    pago: leitura.pago || !venc, pago_em: leitura.pago || !venc ? data : null, vencimento: venc, forma: leitura.forma,
    fornecedor: leitura.fornecedor?.slice(0, 80) || null, itens: leitura.itens.length ? leitura.itens.slice(0, 40) : null,
    comprovante_path: comprovante, origem: 'whatsapp', criado_por_nome: `WhatsApp · ${loja.nome || nomeContato || de}`,
  }).select('id').single();
  if (error) {
    console.error('lançamento', error);
    return enviar('Não consegui salvar agora 😕 Tente de novo em instantes.');
  }
  const linhas = [
    `✅ *${tipoLanc === 'receita' ? 'Receita' : venc ? 'Conta a pagar' : 'Despesa'} lançada*`,
    '',
    `*${brl(leitura.valor_total)}* · ${tipoLanc === 'receita' ? 'Outras receitas' : leitura.categoria}`,
    leitura.descricao,
    [leitura.fornecedor, venc ? `vence ${dataBR(venc)}` : dataBR(data), leitura.forma && !venc ? FORMA_TXT[leitura.forma] : null].filter(Boolean).join(' · '),
    leitura.itens.length ? `${leitura.itens.length} ${leitura.itens.length === 1 ? 'item' : 'itens'} anotados` : '',
    '',
    'Errou algo? Responda *desfazer* ou ajuste no Financeiro.',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0));
  return enviar(linhas.join('\n'), lanc.id);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // Verificação do webhook na Meta
    if (url.searchParams.get('hub.mode') === 'subscribe' && WA_VERIFY && url.searchParams.get('hub.verify_token') === WA_VERIFY) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('ok', { status: 200 });
  }
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405 });
  const corpo = await req.text();
  if (!(await assinaturaOk(corpo, req.headers.get('x-hub-signature-256')))) return new Response('assinatura inválida', { status: 401 });
  let dados;
  try { dados = JSON.parse(corpo); } catch { return new Response('json inválido', { status: 400 }); }
  const tarefas: Promise<void>[] = [];
  for (const entrada of dados.entry ?? []) {
    for (const mud of entrada.changes ?? []) {
      const v = mud.value ?? {};
      const contato = v.contacts?.[0]?.profile?.name ?? '';
      for (const m of v.messages ?? []) tarefas.push(tratar(m, contato).catch((e) => console.error('mensagem', e)));
    }
  }
  // Responde 200 na hora para a Meta e termina o trabalho em segundo plano
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(Promise.all(tarefas)); else await Promise.all(tarefas);
  return new Response('ok', { status: 200 });
});
