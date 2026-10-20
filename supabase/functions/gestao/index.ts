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

/** Assinatura paga e ainda sem acesso criado, conferida pelo e-mail + CPF/CNPJ da compra */
async function assinaturaDaCompra(c: Corpo) {
  if (!emailValido(c.email)) throw new Falha('Digite o e-mail usado no pagamento.');
  const email = c.email.trim().toLowerCase();
  const doc = String(c.documento ?? '').replace(/\D/g, '');
  const { data: a } = await admin.from('assinaturas').select('*').eq('email', email).maybeSingle();
  // Mesma resposta para "não existe" e "documento errado": não revela quem comprou
  if (!a || (a.documento && a.documento !== doc)) {
    throw new Falha('Não encontramos um pagamento com esse e-mail e CPF/CNPJ. Confira os dados usados na compra ou aguarde alguns minutos se acabou de pagar.', 404);
  }
  if (a.restaurante_id) throw new Falha('O acesso desta assinatura já foi criado. Entre com seu e-mail e senha (ou use "Esqueci minha senha").', 409);
  if (a.status !== 'ativa' && a.status !== 'atrasada') throw new Falha('Esta assinatura não está ativa. Fale com o suporte.', 403);
  return a as { id: string; email: string; nome: string | null; telefone: string | null; plano: string | null; valor: number | null; forma: string | null; vence_em: string | null; venda_id: string | null };
}

const acoes: Record<string, (req: Request, c: Corpo) => Promise<unknown>> = {
  // Cadastro aberto pela tela de login. A primeira conta da plataforma vira
  // administradora e dona do restaurante de demonstração; as demais ganham
  // um restaurante próprio, sem plano.
  async cadastrar(_req, c) {
    const nome = String(c.nome ?? '').trim();
    const nomeRestaurante = String(c.restaurante ?? '').trim();
    if (!nome) throw new Falha('Informe seu nome.');
    if (!emailValido(c.email)) throw new Falha('E-mail inválido.');
    const email = c.email.trim().toLowerCase();
    const { data: existente } = await admin.rpc('usuario_por_email', { p_email: email });
    if (existente) throw new Falha('Já existe uma conta com este e-mail. Use "Entrar".', 409);

    const { count } = await admin.from('plataforma_admins').select('*', { count: 'exact', head: true });
    const primeiraConta = (count ?? 0) === 0;
    // Conta nova só depois de assinar (Kirvano → /ativar)
    if (!primeiraConta) throw new Falha('Para criar sua conta, assine um plano. Já pagou? Use "Criar meu acesso".', 403);
    if (!nomeRestaurante) throw new Falha('Informe o nome do restaurante.');

    const u = await obterOuCriarUsuario(email, c.senha, nome);

    if (primeiraConta) {
      await admin.from('plataforma_admins').insert({ user_id: u.id });
      const { data: demo } = await admin.from('restaurantes').select('id').order('criado_em').limit(1).maybeSingle();
      if (demo) {
        await admin.from('membros').upsert({ restaurante_id: demo.id, user_id: u.id, papel: 'dono', nome, email });
        return { ok: true, admin: true };
      }
    }

    const { data: rest, error } = await admin.from('restaurantes')
      .insert({ nome: nomeRestaurante || 'Meu restaurante', plano: 'teste' }).select('id').single();
    if (error) throw error;
    const { error: e2 } = await admin.from('membros').insert({ restaurante_id: rest.id, user_id: u.id, papel: 'dono', nome, email });
    if (e2) throw e2;
    await admin.from('mesas').insert(
      Array.from({ length: 5 }, (_, i) => ({ restaurante_id: rest.id, nome: `Mesa ${i + 1}`, ordem: i + 1 })),
    );
    return { ok: true, admin: primeiraConta };
  },

  // Depois de pagar na Kirvano: confere a compra pelo e-mail + CPF/CNPJ usados no pagamento
  async assinatura_verificar(_req, c) {
    const a = await assinaturaDaCompra(c);
    const { data: existente } = await admin.rpc('usuario_por_email', { p_email: a.email });
    return { ok: true, nome: a.nome ?? '', plano: a.plano ?? '', telefone: a.telefone ?? '', contaExiste: !!existente };
  },

  // Cria o login e a loja do assinante (ele mesmo, sem suporte)
  async assinatura_ativar(req, c) {
    const a = await assinaturaDaCompra(c);
    const nome = String(c.nome ?? '').trim().slice(0, 80);
    const nomeLoja = String(c.restaurante ?? '').trim().slice(0, 80);
    const whatsapp = String(c.whatsapp ?? '').replace(/\D/g, '').slice(0, 13) || null;
    if (nome.length < 2) throw new Falha('Informe seu nome.');
    if (nomeLoja.length < 2) throw new Falha('Informe o nome do seu estabelecimento.');

    // E-mail que já tem login (ex.: conta de cliente do cardápio): só com a senha dele
    const { data: existente } = await admin.rpc('usuario_por_email', { p_email: a.email });
    let uid: string;
    if (existente) {
      const eu = await usuarioAtual(req).catch(() => null);
      if (!eu || eu.id !== existente) throw new Falha('conta_existente', 409);
      uid = eu.id;
    } else {
      uid = (await obterOuCriarUsuario(a.email, c.senha, nome)).id;
    }

    const vence = a.vence_em ? String(a.vence_em).slice(0, 10) : null;
    const { data: rest, error } = await admin.from('restaurantes').insert({
      nome: nomeLoja, plano: a.plano ?? 'assinatura', plano_valor: a.valor, plano_vence_em: vence, plano_forma: a.forma, whatsapp, ativo: true,
    }).select('id').single();
    if (error) throw error;
    const { error: e2 } = await admin.from('membros').insert({ restaurante_id: rest.id, user_id: uid, papel: 'dono', nome, email: a.email });
    if (e2) throw e2;
    await admin.from('mesas').insert(Array.from({ length: 5 }, (_, i) => ({ restaurante_id: rest.id, nome: `Mesa ${i + 1}`, ordem: i + 1 })));
    await admin.from('assinaturas').update({ restaurante_id: rest.id, user_id: uid, atualizado_em: new Date().toISOString() }).eq('id', a.id);
    // Primeira fatura (a compra que liberou o acesso) já entra no histórico como paga
    const agora = new Date();
    await admin.from('faturas').insert({
      restaurante_id: rest.id, referencia: `Mensalidade ${String(agora.getMonth() + 1).padStart(2, '0')}/${agora.getFullYear()}`,
      valor: a.valor ?? 0, vencimento: agora.toISOString().slice(0, 10), pago_em: agora.toISOString(), forma: a.forma, plano: a.plano, venda_id: a.venda_id,
    });
    return { ok: true, email: a.email };
  },

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
    // Cobrança do plano (aparece para o dono em Minha conta)
    if ('plano_valor' in c) mudancas.plano_valor = c.plano_valor === null || c.plano_valor === '' ? null : Number(c.plano_valor);
    if ('plano_vence_em' in c) mudancas.plano_vence_em = c.plano_vence_em || null;
    if ('plano_forma' in c) mudancas.plano_forma = typeof c.plano_forma === 'string' && c.plano_forma.trim() ? c.plano_forma.trim().slice(0, 40) : null;
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
