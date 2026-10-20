// Domínio próprio da loja (planos Premium e Rede).
// adicionar → coloca o domínio (e o www) no projeto da Vercel e libera o login (Supabase)
// verificar → confere o DNS; quando estiver certo, o domínio fica ativo
// remover   → tira da Vercel e do Supabase
import { createClient, type User } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const URL_SUPABASE = Deno.env.get('SUPABASE_URL')!;
const admin = createClient(URL_SUPABASE, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const VERCEL_TOKEN = Deno.env.get('VERCEL_TOKEN') ?? '';
const VERCEL_PROJETO = Deno.env.get('VERCEL_PROJETO') ?? '';
const VERCEL_TIME = Deno.env.get('VERCEL_TIME') ?? '';
const SB_TOKEN = Deno.env.get('SB_ACCESS_TOKEN') ?? '';
const PROJETO_SB = new URL(URL_SUPABASE).hostname.split('.')[0];

const PLANOS_COM_DOMINIO = ['premium', 'rede'];
/** Registros que o cliente cria no provedor do domínio (Registro.br, Hostinger, GoDaddy…) */
const REGISTROS = (d: string) => [
  { tipo: 'A', nome: '@', valor: '216.198.79.1', dominio: d },
  { tipo: 'CNAME', nome: 'www', valor: 'cname.vercel-dns.com', dominio: `www.${d}` },
];
const NOSSOS = ['basilfiery.com.br', 'basilfiery.com', 'vercel.app', 'supabase.co', 'localhost'];

class Falha extends Error {
  constructor(mensagem: string, public status = 400) { super(mensagem); }
}

async function usuarioAtual(req: Request): Promise<User> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Falha('Faça login novamente.', 401);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Falha('Sessão expirada. Faça login novamente.', 401);
  return data.user;
}

/** Loja que a pessoa gerencia (dono/gerente) e que tem plano com domínio próprio */
async function lojaPermitida(req: Request, restauranteId: unknown) {
  if (typeof restauranteId !== 'string') throw new Falha('Loja não informada.');
  const eu = await usuarioAtual(req);
  const [{ data: membro }, { data: adm }, { data: loja }] = await Promise.all([
    admin.from('membros').select('papel').eq('user_id', eu.id).eq('restaurante_id', restauranteId).maybeSingle(),
    admin.from('plataforma_admins').select('user_id').eq('user_id', eu.id).maybeSingle(),
    admin.from('restaurantes').select('id, plano, dominio, dominio_status').eq('id', restauranteId).maybeSingle(),
  ]);
  if (!loja) throw new Falha('Loja não encontrada.', 404);
  const gestor = membro && ['dono', 'gerente'].includes(membro.papel);
  if (!gestor && !adm) throw new Falha('Só o dono ou o gerente podem mudar o domínio.', 403);
  if (!adm && !PLANOS_COM_DOMINIO.includes(String(loja.plano ?? '').toLowerCase())) {
    throw new Falha('O domínio próprio faz parte do plano Premium.', 403);
  }
  return loja as { id: string; plano: string; dominio: string | null; dominio_status: string | null };
}

/** "https://www.Fritas.com.br/cardapio" → "fritas.com.br" */
function normalizar(v: unknown) {
  const d = String(v ?? '').trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '').replace(/\.$/, '');
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d) || d.length > 120) {
    throw new Falha('Domínio inválido. Digite assim: suapizzaria.com.br');
  }
  if (NOSSOS.some((n) => d === n || d.endsWith(`.${n}`))) throw new Falha('Use um domínio que seja seu.');
  return d;
}

async function vercel(caminho: string, init: RequestInit = {}) {
  if (!VERCEL_TOKEN || !VERCEL_PROJETO) throw new Falha('Domínio próprio ainda não configurado na plataforma. Fale com o suporte.', 503);
  const sep = caminho.includes('?') ? '&' : '?';
  const r = await fetch(`https://api.vercel.com${caminho}${VERCEL_TIME ? `${sep}teamId=${VERCEL_TIME}` : ''}`, {
    ...init,
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const corpo = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, corpo: corpo as Record<string, any> };
}

/** Libera (ou tira) o domínio na lista de retornos do login (Google, esqueci a senha) */
async function allowList(d: string, incluir: boolean) {
  if (!SB_TOKEN) return;
  const base = `https://api.supabase.com/v1/projects/${PROJETO_SB}/config/auth`;
  const h = { Authorization: `Bearer ${SB_TOKEN}`, 'Content-Type': 'application/json' };
  const atual = await fetch(base, { headers: h }).then((r) => r.json()).catch(() => null);
  if (!atual) return;
  const lista = String(atual.uri_allow_list ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);
  const meus = [`https://${d}/**`, `https://www.${d}/**`];
  const nova = incluir ? [...new Set([...lista, ...meus])] : lista.filter((u) => !meus.includes(u));
  if (nova.join(',') === lista.join(',')) return;
  await fetch(base, { method: 'PATCH', headers: h, body: JSON.stringify({ uri_allow_list: nova.join(',') }) });
}

async function conferir(d: string) {
  const [raiz, www] = await Promise.all([vercel(`/v6/domains/${d}/config`), vercel(`/v6/domains/www.${d}/config`)]);
  return { raiz: raiz.ok && raiz.corpo.misconfigured === false, www: www.ok && www.corpo.misconfigured === false };
}

async function tirarDaVercel(d: string) {
  await vercel(`/v9/projects/${VERCEL_PROJETO}/domains/www.${d}`, { method: 'DELETE' });
  await vercel(`/v9/projects/${VERCEL_PROJETO}/domains/${d}`, { method: 'DELETE' });
}

// deno-lint-ignore no-explicit-any
type Corpo = Record<string, any>;

const acoes: Record<string, (req: Request, c: Corpo) => Promise<unknown>> = {
  async adicionar(req, c) {
    const loja = await lojaPermitida(req, c.restaurante_id);
    const d = normalizar(c.dominio);
    const { data: outra } = await admin.from('restaurantes').select('id').eq('dominio', d).neq('id', loja.id).maybeSingle();
    if (outra) throw new Falha('Esse domínio já está ligado a outra loja.', 409);
    if (loja.dominio && loja.dominio !== d) { await tirarDaVercel(loja.dominio); await allowList(loja.dominio, false); }

    const raiz = await vercel(`/v10/projects/${VERCEL_PROJETO}/domains`, { method: 'POST', body: JSON.stringify({ name: d }) });
    if (!raiz.ok && raiz.corpo?.error?.code !== 'domain_already_in_use_by_project' && raiz.status !== 409) {
      const msg = String(raiz.corpo?.error?.message ?? '');
      if (raiz.corpo?.error?.code === 'domain_already_in_use' || /already in use/i.test(msg)) throw new Falha('Esse domínio já está em uso em outra conta da Vercel.', 409);
      if (raiz.status === 403) throw new Falha('A plataforma está sem permissão para adicionar domínios. Fale com o suporte.', 503);
      throw new Falha(msg || 'Não foi possível conectar o domínio. Tente de novo.');
    }
    await vercel(`/v10/projects/${VERCEL_PROJETO}/domains`, { method: 'POST', body: JSON.stringify({ name: `www.${d}`, redirect: d, redirectStatusCode: 308 }) });
    await allowList(d, true);

    const ok = await conferir(d);
    const status = ok.raiz ? 'ativo' : 'pendente';
    const { error } = await admin.from('restaurantes').update({
      dominio: d, dominio_status: status, dominio_verificado_em: ok.raiz ? new Date().toISOString() : null,
    }).eq('id', loja.id);
    if (error) throw error;
    return { ok: true, dominio: d, status, registros: REGISTROS(d), www: ok.www };
  },

  async verificar(req, c) {
    const loja = await lojaPermitida(req, c.restaurante_id);
    if (!loja.dominio) return { ok: true, dominio: null };
    const ok = await conferir(loja.dominio);
    const status = ok.raiz ? 'ativo' : 'pendente';
    if (status !== loja.dominio_status) {
      await admin.from('restaurantes').update({ dominio_status: status, dominio_verificado_em: ok.raiz ? new Date().toISOString() : null }).eq('id', loja.id);
    }
    return { ok: true, dominio: loja.dominio, status, registros: REGISTROS(loja.dominio), www: ok.www };
  },

  async remover(req, c) {
    const loja = await lojaPermitida(req, c.restaurante_id);
    if (loja.dominio) { await tirarDaVercel(loja.dominio); await allowList(loja.dominio, false); }
    const { error } = await admin.from('restaurantes').update({ dominio: null, dominio_status: null, dominio_verificado_em: null }).eq('id', loja.id);
    if (error) throw error;
    return { ok: true };
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Método não permitido' }, 405);
  try {
    const corpo = (await req.json()) as Corpo;
    const acao = acoes[corpo.acao];
    if (!acao) throw new Falha('Ação desconhecida.');
    return json(await acao(req, corpo));
  } catch (e) {
    if (e instanceof Falha) return json({ erro: e.message }, e.status);
    console.error(e);
    return json({ erro: 'Erro inesperado. Tente de novo.' }, 500);
  }
});
