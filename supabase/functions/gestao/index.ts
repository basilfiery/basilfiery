// Operações que precisam criar/alterar contas de login (service role).
// Cada ação confere quem está chamando antes de fazer qualquer coisa.
import { createClient, type User } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAPEIS = ['dono', 'gerente', 'caixa', 'garcom'] as const;
type Papel = typeof PAPEIS[number];

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

async function ehAdmin(uid: string) {
  const { data } = await admin.from('plataforma_admins').select('user_id').eq('user_id', uid).maybeSingle();
  return !!data;
}

async function papelEm(uid: string, restauranteId: string): Promise<Papel | null> {
  const { data } = await admin.from('membros').select('papel')
    .eq('user_id', uid).eq('restaurante_id', restauranteId).maybeSingle();
  return (data?.papel as Papel) ?? null;
}

const emailValido = (e: unknown): e is string => typeof e === 'string' && /^\S+@\S+\.\S+$/.test(e.trim());

/** Reaproveita a conta se o e-mail já existir; senão cria (já confirmada). */
async function obterOuCriarUsuario(email: string, senha: unknown, nome: string) {
  const { data: existente, error } = await admin.rpc('usuario_por_email', { p_email: email });
  if (error) throw error;
  if (existente) return { id: existente as string, jaExistia: true };
  if (typeof senha !== 'string' || senha.length < 6) throw new Falha('A senha precisa ter pelo menos 6 caracteres.');
  const { data, error: e2 } = await admin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password: senha,
    email_confirm: true,
    user_metadata: { nome },
  });
  if (e2) throw new Falha(e2.message);
  return { id: data.user.id, jaExistia: false };
}

// deno-lint-ignore no-explicit-any
type Corpo = Record<string, any>;

const acoes: Record<string, (req: Request, c: Corpo) => Promise<unknown>> = {
  // Cria o primeiro administrador da plataforma (só funciona uma vez)
  async bootstrap(_req, c) {
    const { count } = await admin.from('plataforma_admins').select('*', { count: 'exact', head: true });
    if ((count ?? 0) > 0) throw new Falha('A plataforma já tem administrador.', 403);
    if (!c.nome?.trim()) throw new Falha('Informe seu nome.');
    if (!emailValido(c.email)) throw new Falha('E-mail inválido.');
    const u = await obterOuCriarUsuario(c.email, c.senha, c.nome.trim());
    await admin.from('plataforma_admins').insert({ user_id: u.id });
    const { data: demo } = await admin.from('restaurantes').select('id').order('criado_em').limit(1).maybeSingle();
    if (demo) {
      await admin.from('membros').upsert({
        restaurante_id: demo.id, user_id: u.id, papel: 'dono', nome: c.nome.trim(), email: c.email.trim().toLowerCase(),
      });
    }
    return { ok: true };
  },

  async criar_restaurante(req, c) {
    const eu = await usuarioAtual(req);
    if (!(await ehAdmin(eu.id))) throw new Falha('Apenas o administrador da plataforma.', 403);
    if (!c.nome?.trim()) throw new Falha('Informe o nome do restaurante.');
    if (!c.dono?.nome?.trim()) throw new Falha('Informe o nome do dono.');
    if (!emailValido(c.dono?.email)) throw new Falha('E-mail do dono inválido.');
    const qtdMesas = Math.min(Math.max(Number(c.mesas) || 0, 0), 200);

    const u = await obterOuCriarUsuario(c.dono.email, c.dono.senha, c.dono.nome.trim());
    const { data: rest, error } = await admin.from('restaurantes')
      .insert({ nome: c.nome.trim(), plano: c.plano || 'essencial' }).select().single();
    if (error) throw error;
    const { error: e2 } = await admin.from('membros').insert({
      restaurante_id: rest.id, user_id: u.id, papel: 'dono', nome: c.dono.nome.trim(), email: c.dono.email.trim().toLowerCase(),
    });
    if (e2) throw e2;
    if (qtdMesas > 0) {
      await admin.from('mesas').insert(
        Array.from({ length: qtdMesas }, (_, i) => ({ restaurante_id: rest.id, nome: `Mesa ${i + 1}`, ordem: i + 1 })),
      );
    }
    return { restaurante: rest, donoJaTinhaConta: u.jaExistia };
  },

  async atualizar_restaurante(req, c) {
    const eu = await usuarioAtual(req);
    if (!(await ehAdmin(eu.id))) throw new Falha('Apenas o administrador da plataforma.', 403);
    const mudancas: Corpo = {};
    if (typeof c.ativo === 'boolean') mudancas.ativo = c.ativo;
    if (typeof c.plano === 'string') mudancas.plano = c.plano;
    const { error } = await admin.from('restaurantes').update(mudancas).eq('id', c.id);
    if (error) throw error;
    return { ok: true };
  },

  async criar_membro(req, c) {
    const eu = await usuarioAtual(req);
    const souAdmin = await ehAdmin(eu.id);
    const meuPapel = await papelEm(eu.id, c.restaurante_id);
    if (!souAdmin && meuPapel !== 'dono' && meuPapel !== 'gerente') throw new Falha('Sem permissão para gerenciar a equipe.', 403);
    if (!PAPEIS.includes(c.papel)) throw new Falha('Cargo inválido.');
    if (c.papel === 'dono' && !souAdmin && meuPapel !== 'dono') throw new Falha('Só o dono pode adicionar outro dono.', 403);
    if (!c.nome?.trim()) throw new Falha('Informe o nome.');
    if (!emailValido(c.email)) throw new Falha('E-mail inválido.');

    const u = await obterOuCriarUsuario(c.email, c.senha, c.nome.trim());
    const papelAtual = await papelEm(u.id, c.restaurante_id);
    if (papelAtual === 'dono' && !souAdmin && meuPapel !== 'dono') {
      throw new Falha('Esta pessoa é dona do restaurante e não pode ter o cargo alterado.', 403);
    }
    const { error } = await admin.from('membros').upsert({
      restaurante_id: c.restaurante_id, user_id: u.id, papel: c.papel, nome: c.nome.trim(), email: c.email.trim().toLowerCase(),
    });
    if (error) throw error;
    return { ok: true, jaExistia: u.jaExistia };
  },

  async redefinir_senha(req, c) {
    const eu = await usuarioAtual(req);
    if (typeof c.senha !== 'string' || c.senha.length < 6) throw new Falha('A senha precisa ter pelo menos 6 caracteres.');
    if (!(await ehAdmin(eu.id))) {
      // Só pode trocar a senha de quem trabalha APENAS em restaurantes onde eu sou dono/gerente,
      // e nunca de um dono ou administrador.
      if (await ehAdmin(c.user_id)) throw new Falha('Sem permissão.', 403);
      const { data: vinculos } = await admin.from('membros').select('restaurante_id, papel').eq('user_id', c.user_id);
      if (!vinculos?.length) throw new Falha('Pessoa não encontrada.', 404);
      for (const v of vinculos) {
        if (v.papel === 'dono') throw new Falha('A senha do dono só pode ser trocada pelo suporte.', 403);
        const p = await papelEm(eu.id, v.restaurante_id);
        if (p !== 'dono' && p !== 'gerente') throw new Falha('Esta pessoa também trabalha em outro restaurante. Peça ao suporte.', 403);
      }
    }
    const { error } = await admin.auth.admin.updateUserById(c.user_id, { password: c.senha });
    if (error) throw new Falha(error.message);
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
