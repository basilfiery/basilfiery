// Webhook da Kirvano (processadora dos planos).
// URL configurada na Kirvano: https://<projeto>.supabase.co/functions/v1/kirvano?chave=<KIRVANO_CHAVE>
//
// Venda aprovada / renovada  → assinatura ativa (o cliente cria o acesso em /ativar)
// Atrasada                  → marca como atrasada (o sistema continua funcionando)
// Cancelada / expirada      → suspende a loja quando o período pago acabar
// Reembolso / chargeback    → suspende na hora
import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CHAVE = Deno.env.get('KIRVANO_CHAVE') ?? '';
// Opcional: ids de produto aceitos (separados por vírgula). Vazio = todos.
const PRODUTOS = (Deno.env.get('KIRVANO_PRODUTOS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

/** "R$ 1.249,90" → 1249.9 */
function valorEmReais(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const n = Number(v.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dataValida(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Próximo vencimento: o que a Kirvano mandou ou +1 período a partir de hoje */
function proximoVencimento(p: Record<string, any>): string {
  const informado = dataValida(p.plan?.next_charge_date) ?? dataValida(p.subscription?.next_charge_date);
  if (informado) return informado;
  const freq = String(p.plan?.charge_frequency ?? p.plan?.frequency ?? '').toUpperCase();
  const d = new Date();
  if (freq.includes('ANNUAL') || freq.includes('YEAR')) d.setFullYear(d.getFullYear() + 1);
  else if (freq.includes('SEMI')) d.setMonth(d.getMonth() + 6);
  else if (freq.includes('QUARTER')) d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

const FORMAS: Record<string, string> = { PIX: 'Pix', CREDIT_CARD: 'Cartão de crédito', BANK_SLIP: 'Boleto' };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return resposta({ erro: 'Método não permitido' }, 405);
  const url = new URL(req.url);
  const recebida = url.searchParams.get('chave') ?? req.headers.get('x-kirvano-token') ?? '';
  if (!CHAVE || recebida !== CHAVE) return resposta({ erro: 'Não autorizado' }, 401);

  // deno-lint-ignore no-explicit-any
  let p: Record<string, any>;
  try { p = await req.json(); } catch { return resposta({ erro: 'JSON inválido' }, 400); }

  const evento = String(p.event ?? '').toUpperCase();
  const cliente = p.customer ?? {};
  const email = String(cliente.email ?? '').trim().toLowerCase();
  const produto = Array.isArray(p.products) ? p.products.find((x: any) => !x?.is_order_bump) ?? p.products[0] : null;
  const vendaId = p.sale_id ? String(p.sale_id) : null;

  const { data: log } = await admin.from('assinatura_eventos')
    .insert({ evento, email: email || null, venda_id: vendaId, payload: p }).select('id').single();
  const marcar = () => log && admin.from('assinatura_eventos').update({ tratado: true }).eq('id', log.id);

  if (!email) return resposta({ ok: true, ignorado: 'sem e-mail' });
  if (PRODUTOS.length && produto && !PRODUTOS.includes(String(produto.id))) return resposta({ ok: true, ignorado: 'outro produto' });

  const { data: atual } = await admin.from('assinaturas').select('*').eq('email', email).maybeSingle();

  /** Atualiza a assinatura e o restaurante ligado a ela */
  async function aplicar(campos: Record<string, unknown>, loja?: Record<string, unknown>) {
    const linha = { email, atualizado_em: new Date().toISOString(), ...campos };
    const { error } = atual
      ? await admin.from('assinaturas').update(linha).eq('id', atual.id)
      : await admin.from('assinaturas').insert(linha);
    if (error) throw error;
    if (loja && atual?.restaurante_id) await admin.from('restaurantes').update(loja).eq('id', atual.restaurante_id);
  }

  try {
    switch (evento) {
      case 'SALE_APPROVED':
      case 'SUBSCRIPTION_RENEWED': {
        const vence = proximoVencimento(p);
        const nomePlano = String(produto?.offer_name || p.plan?.name || produto?.name || 'Plano');
        // Mesmo nome dos planos do site (Essencial, Profissional, Rede); senão guarda o nome da oferta
        const plano = (['essencial', 'profissional', 'rede'].find((x) => nomePlano.toLowerCase().includes(x)) ?? nomePlano).slice(0, 60);
        const valor = valorEmReais(p.total_price ?? produto?.price);
        const forma = FORMAS[String(p.payment_method ?? '').toUpperCase()] ?? p.payment_method ?? null;
        await aplicar({
          status: 'ativa', vence_em: vence, plano, valor, forma, venda_id: vendaId,
          produto_id: produto?.id ? String(produto.id) : null, oferta_id: produto?.offer_id ? String(produto.offer_id) : null,
          nome: cliente.name ?? atual?.nome ?? null,
          telefone: String(cliente.phone_number ?? cliente.phone ?? atual?.telefone ?? '').replace(/\D/g, '') || null,
          documento: String(cliente.document ?? atual?.documento ?? '').replace(/\D/g, '') || null,
        }, { ativo: true, plano, plano_valor: valor, plano_vence_em: vence.slice(0, 10), plano_forma: forma });
        break;
      }
      case 'SUBSCRIPTION_OVERDUE':
        if (atual) await aplicar({ status: 'atrasada' });
        break;
      case 'SUBSCRIPTION_CANCELED':
      case 'SUBSCRIPTION_EXPIRED': {
        if (!atual) break;
        // Cancelou: usa até o fim do período já pago
        const acabou = !atual.vence_em || new Date(atual.vence_em).getTime() <= Date.now() || evento === 'SUBSCRIPTION_EXPIRED';
        await aplicar({ status: evento === 'SUBSCRIPTION_EXPIRED' ? 'expirada' : 'cancelada' }, acabou ? { ativo: false } : undefined);
        break;
      }
      case 'SALE_REFUNDED':
      case 'SALE_CHARGEBACK':
        if (atual) await aplicar({ status: 'reembolsada' }, { ativo: false });
        break;
      default:
        return resposta({ ok: true, ignorado: evento || 'sem evento' });
    }
    await marcar();
    return resposta({ ok: true });
  } catch (e) {
    console.error(e);
    return resposta({ erro: 'Falha ao gravar' }, 500);
  }
});
