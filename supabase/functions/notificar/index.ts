// Envia notificações push para os celulares/computadores da equipe.
//   GET  → devolve a chave pública VAPID (gera o par na primeira chamada)
//   POST → chamado pelo gatilho do banco (header x-segredo) a cada pedido/chamado
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Vapid { publica: string; privada: string }
let vapid: Vapid | null = null;
let segredo: string | null = null;

async function carregarConfig() {
  if (vapid && segredo) return;
  const { data, error } = await admin.rpc('config_push');
  if (error) throw error;
  segredo = data.push_segredo ?? null;
  if (data.vapid) {
    vapid = JSON.parse(data.vapid);
  } else {
    const k = webpush.generateVAPIDKeys();
    const { data: salvo, error: e2 } = await admin.rpc('config_vapid_garantir', {
      p_publica: k.publicKey,
      p_privada: k.privateKey,
    });
    if (e2) throw e2;
    vapid = salvo as Vapid;
  }
  webpush.setVapidDetails('mailto:basilfiery@gmail.com', vapid!.publica, vapid!.privada);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    await carregarConfig();
    if (req.method === 'GET') return json({ chave: vapid!.publica });
    if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
    if (!segredo || req.headers.get('x-segredo') !== segredo) return json({ erro: 'Não autorizado' }, 401);

    const p = await req.json();
    const { data: todas, error } = await admin
      .from('push_inscricoes')
      .select('id, endpoint, p256dh, auth, app, user_id, criado_em')
      .eq('restaurante_id', p.restaurante_id)
      .order('criado_em', { ascending: false });
    if (error) throw error;

    // Um aviso por pessoa e app: inscrições antigas do mesmo app (reinstalou, trocou de aparelho) não repetem o aviso
    const vistos = new Set<string>();
    const inscricoes = (todas ?? []).filter((s) => {
      const chave = `${s.user_id ?? s.id}|${s.app ?? 'garcom'}`;
      if (vistos.has(chave)) return false;
      vistos.add(chave);
      return true;
    });

    const mensagem = JSON.stringify({ titulo: p.titulo, corpo: p.corpo, tag: p.tag, url: p.url });
    // App do dono: pedido novo e venda (conta paga); o toque abre o app do dono
    const mensagemDono = JSON.stringify({
      titulo: p.evento === 'venda' ? p.titulo : `Novo pedido · ${p.mesa ?? ''}`,
      corpo: p.evento === 'venda' ? p.corpo : `${p.valor ?? ''} · toque para ver`,
      tag: p.tag,
      url: '/dono',
    });
    let enviados = 0;
    await Promise.all(inscricoes.map(async (s) => {
      const doDono = s.app === 'dono';
      // App do dono (celular): pedido novo e venda. O app da equipe: o resto (pedido, pronto, chamados)
      if (doDono && p.evento !== 'venda' && p.evento !== 'pedido') return;
      // Venda (conta paga) só interessa ao dono
      if (!doDono && p.evento === 'venda') return;
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          doDono ? mensagemDono : mensagem,
          { TTL: 600, urgency: 'high' },
        );
        enviados++;
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode;
        if (codigo === 404 || codigo === 410) {
          // aparelho cancelou a inscrição
          await admin.from('push_inscricoes').delete().eq('id', s.id);
        } else {
          console.error('Falha ao enviar push', codigo, (e as Error).message);
        }
      }
    }));
    return json({ enviados });
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});
