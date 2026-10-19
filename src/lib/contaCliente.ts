import { useCallback, useEffect, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';
import { SUPABASE_CHAVE, SUPABASE_URL } from './supabase';

/**
 * Conta do cliente no cardápio digital (e-mail/senha ou Google).
 * Sessão separada da equipe: quem usa o painel no mesmo aparelho não vira "cliente" e vice-versa.
 */
export const supabaseCliente = createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: { storageKey: 'bf-cliente-auth', flowType: 'pkce', detectSessionInUrl: true },
});

export interface EnderecoSalvo { rua: string; numero: string; bairro: string; complemento: string; referencia: string }
export interface PerfilCliente { nome: string; telefone: string; enderecos: EnderecoSalvo[]; foto_url?: string | null }

const PERFIL_VAZIO: PerfilCliente = { nome: '', telefone: '', enderecos: [], foto_url: null };

/** O login com o Google só aparece quando estiver ligado no Supabase (Authentication › Providers › Google). */
let googleAtivo: Promise<boolean> | null = null;
function verificarGoogle() {
  googleAtivo ??= fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_CHAVE } })
    .then((r) => r.json())
    .then((d: { external?: { google?: boolean } }) => !!d.external?.google)
    .catch(() => false);
  return googleAtivo;
}

export function useContaCliente() {
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);
  const [perfil, setPerfil] = useState<PerfilCliente | null>(null);
  const [novaSenha, setNovaSenha] = useState(false);
  const [temGoogle, setTemGoogle] = useState(false);
  useEffect(() => { void verificarGoogle().then(setTemGoogle); }, []);

  useEffect(() => {
    let vivo = true;
    void supabaseCliente.auth.getSession().then(({ data }) => { if (vivo) setSessao(data.session); });
    const { data } = supabaseCliente.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      if (evento === 'PASSWORD_RECOVERY') setNovaSenha(true);
    });
    // Voltou do link "esqueci minha senha"
    if (new URLSearchParams(window.location.search).get('conta') === 'senha') setNovaSenha(true);
    return () => { vivo = false; data.subscription.unsubscribe(); };
  }, []);

  const usuario = sessao?.user ?? null;

  const carregarPerfil = useCallback(async () => {
    if (!usuario) { setPerfil(null); return; }
    const { data } = await supabaseCliente.from('clientes_perfis').select('nome, telefone, enderecos, foto_url').eq('user_id', usuario.id).maybeSingle();
    if (data) {
      setPerfil({ nome: data.nome ?? '', telefone: data.telefone ?? '', enderecos: (data.enderecos as EnderecoSalvo[]) ?? [], foto_url: data.foto_url ?? null });
      return;
    }
    // Primeira vez (ex.: entrou com o Google): cria o perfil com o nome da conta
    const meta = usuario.user_metadata as { nome?: string; full_name?: string; name?: string; telefone?: string; avatar_url?: string };
    const novo = { ...PERFIL_VAZIO, nome: (meta.nome || meta.full_name || meta.name || '').slice(0, 80), telefone: meta.telefone ?? '', foto_url: meta.avatar_url ?? null };
    await supabaseCliente.from('clientes_perfis').upsert({ user_id: usuario.id, ...novo });
    setPerfil(novo);
  }, [usuario?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void carregarPerfil(); }, [carregarPerfil]);

  async function salvarPerfil(mudancas: Partial<PerfilCliente>) {
    if (!usuario) return;
    const atual = { ...(perfil ?? PERFIL_VAZIO), ...mudancas };
    const { error } = await supabaseCliente.from('clientes_perfis').upsert({ user_id: usuario.id, ...atual, atualizado_em: new Date().toISOString() });
    if (error) throw error;
    setPerfil(atual);
  }

  /** Guarda o endereço usado (o mais recente primeiro, até 5). */
  async function lembrarEndereco(e: EnderecoSalvo) {
    if (!usuario || !e.rua.trim()) return;
    const chave = (x: EnderecoSalvo) => `${x.rua.trim().toLowerCase()}|${x.numero.trim()}`;
    const lista = [e, ...(perfil?.enderecos ?? []).filter((x) => chave(x) !== chave(e))].slice(0, 5);
    await salvarPerfil({ enderecos: lista }).catch(() => {});
  }

  return {
    carregando: sessao === undefined,
    temGoogle,
    usuario,
    perfil,
    novaSenha,
    fecharNovaSenha: () => {
      setNovaSenha(false);
      const url = new URL(window.location.href);
      if (url.searchParams.has('conta')) { url.searchParams.delete('conta'); window.history.replaceState(null, '', url.toString()); }
    },
    entrar: (email: string, senha: string) => supabaseCliente.auth.signInWithPassword({ email: email.trim(), password: senha }),
    cadastrar: (nome: string, telefone: string, email: string, senha: string) =>
      supabaseCliente.auth.signUp({ email: email.trim(), password: senha, options: { data: { nome: nome.trim(), telefone: telefone.replace(/\D/g, '') } } }),
    google: (codigo: string) =>
      supabaseCliente.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/loja/${codigo}`, queryParams: { prompt: 'select_account' } } }),
    esqueci: (email: string, codigo: string) =>
      supabaseCliente.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/loja/${codigo}?conta=senha` }),
    trocarSenha: (senha: string) => supabaseCliente.auth.updateUser({ password: senha }),
    sair: () => supabaseCliente.auth.signOut({ scope: 'local' }),
    salvarPerfil,
    lembrarEndereco,
  };
}

export type ContaCliente = ReturnType<typeof useContaCliente>;
