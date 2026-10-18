// API de integração do restaurante (chave gerada em Configurações › Integrações).
//   GET  /api/loja                    dados da loja
//   GET  /api/cardapio                categorias, produtos e sabores
//   GET  /api/pedidos?desde=&status=  pedidos (padrão: últimas 24 h, até 200)
//   GET  /api/pedidos/<id>            um pedido
//   POST /api/pedidos/<id>/status     { "status": "preparando" | "pronto" | "entregue" }
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATUS_PERMITIDOS = ['preparando', 'pronto', 'entregue'];
const CAMPOS_PEDIDO = 'id, numero, status, tipo, mesa_nome, cliente_nome, cliente_telefone, endereco, observacao, total, desconto, taxa_entrega, forma_pagamento, troco_para, criado_em, atualizado_em, pago_em, pedido_itens(nome, qtd, preco_unit, obs)';

async function sha256(texto: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const chave = (req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '').trim();
    if (!/^bf_[0-9a-f]{48}$/.test(chave)) return json({ erro: 'Envie a chave de integração no cabeçalho x-api-key.' }, 401);
    const { data: registro } = await admin.from('api_chaves').select('id, restaurante_id')
      .eq('hash', await sha256(chave)).is('revogada_em', null).maybeSingle();
    if (!registro) return json({ erro: 'Chave inválida ou revogada.' }, 401);
    const rest = registro.restaurante_id as string;
    void admin.from('api_chaves').update({ ultimo_uso: new Date().toISOString() }).eq('id', registro.id);

    const url = new URL(req.url);
    const partes = url.pathname.split('/').filter(Boolean);
    const i = partes.indexOf('api');
    const [recurso, id, acao] = partes.slice(i + 1);

    if (req.method === 'GET' && recurso === 'loja') {
      const { data, error } = await admin.from('restaurantes')
        .select('id, nome, codigo, cor, logo_url, whatsapp, endereco, delivery_ativo, delivery_taxa, delivery_minimo, delivery_tempo')
        .eq('id', rest).single();
      if (error) throw error;
      return json(data);
    }
    if (req.method === 'GET' && recurso === 'cardapio') {
      const { data, error } = await admin.rpc('api_cardapio', { p_rest: rest });
      if (error) throw error;
      return json(data);
    }
    if (recurso === 'pedidos' && req.method === 'GET' && !id) {
      const desde = url.searchParams.get('desde') ?? new Date(Date.now() - 864e5).toISOString();
      if (Number.isNaN(Date.parse(desde))) return json({ erro: 'Parâmetro "desde" inválido (use data ISO).' }, 400);
      let q = admin.from('pedidos').select(CAMPOS_PEDIDO).eq('restaurante_id', rest)
        .gte('criado_em', desde).order('criado_em', { ascending: false }).limit(200);
      const status = url.searchParams.get('status');
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return json({ pedidos: data });
    }
    if (recurso === 'pedidos' && id && /^[0-9a-f-]{36}$/.test(id)) {
      if (req.method === 'GET' && !acao) {
        const { data } = await admin.from('pedidos').select(CAMPOS_PEDIDO).eq('restaurante_id', rest).eq('id', id).maybeSingle();
        return data ? json(data) : json({ erro: 'Pedido não encontrado.' }, 404);
      }
      if (req.method === 'POST' && acao === 'status') {
        const corpo = await req.json().catch(() => ({}));
        if (!STATUS_PERMITIDOS.includes(corpo.status)) return json({ erro: `Status deve ser: ${STATUS_PERMITIDOS.join(', ')}.` }, 400);
        const { data, error } = await admin.from('pedidos').update({ status: corpo.status, atualizado_em: new Date().toISOString() })
          .eq('restaurante_id', rest).eq('id', id).neq('status', 'cancelado').select('id, numero, status').maybeSingle();
        if (error) throw error;
        return data ? json(data) : json({ erro: 'Pedido não encontrado ou cancelado.' }, 404);
      }
    }
    return json({ erro: 'Rota não encontrada. Use /loja, /cardapio ou /pedidos.' }, 404);
  } catch (e) {
    console.error(e);
    return json({ erro: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
