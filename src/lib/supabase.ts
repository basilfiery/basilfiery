import { createClient } from '@supabase/supabase-js';

// A chave publicável foi feita para ficar no navegador: quem protege os dados
// são as regras de acesso (RLS) do banco. Pode ser trocada por variáveis de ambiente.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://bceeeeielhqbtdiaiypi.supabase.co';
export const SUPABASE_CHAVE: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_cv9v7PW8nIJHuX2Jb9tKRA_xyS0sFw5';

export const supabase = createClient(SUPABASE_URL, SUPABASE_CHAVE);

const TRADUCOES: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'E-mail ainda não confirmado.'],
  [/failed to fetch|networkerror|load failed/i, 'Sem conexão com a internet. Verifique o Wi-Fi.'],
  [/jwt expired/i, 'Sua sessão expirou. Entre novamente.'],
  [/row-level security|permission denied/i, 'Você não tem permissão para fazer isso.'],
  [/duplicate key/i, 'Já existe um registro com esses dados.'],
  [/could not find the function|schema cache/i, 'O sistema está em atualização. Tente de novo em alguns minutos.'],
];

/** Mensagem amigável a partir de qualquer erro do Supabase/fetch. */
export function msgErro(e: unknown): string {
  const bruto =
    typeof e === 'string' ? e
      : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
        : 'Algo deu errado. Tente de novo.';
  for (const [re, txt] of TRADUCOES) if (re.test(bruto)) return txt;
  return bruto;
}

/** Chama a edge function "gestao" e transforma a resposta de erro em exceção legível. */
export async function gestao<T = unknown>(acao: string, dados: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('gestao', { body: { acao, ...dados } });
  if (error) {
    let mensagem = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { mensagem = (await ctx.json()).erro ?? mensagem; } catch { /* mantém a mensagem original */ }
    }
    throw new Error(msgErro(mensagem));
  }
  return data as T;
}

/** Envia uma imagem para o Storage e devolve a URL pública. */
export async function enviarImagem(restauranteId: string, arquivo: File, pasta: string): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha um arquivo de imagem.');
  if (arquivo.size > 3 * 1024 * 1024) throw new Error('Imagem muito grande (máximo 3 MB).');
  const ext = (arquivo.name.split('.').pop() || 'jpg').toLowerCase();
  const caminho = `${restauranteId}/${pasta}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('imagens').upload(caminho, arquivo, {
    cacheControl: '31536000',
    contentType: arquivo.type,
  });
  if (error) throw error;
  return supabase.storage.from('imagens').getPublicUrl(caminho).data.publicUrl;
}
