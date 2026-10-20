import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// A chave publicável foi feita para ficar no navegador: quem protege os dados
// são as regras de acesso (RLS) do banco. Pode ser trocada por variáveis de ambiente.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://bceeeeielhqbtdiaiypi.supabase.co';
export const SUPABASE_CHAVE: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_cv9v7PW8nIJHuX2Jb9tKRA_xyS0sFw5';

// A sessão da equipe só lê retorno de login na tela /login (nova senha). Nos cardápios quem lê é a sessão do cliente.
export const supabase = createClient(SUPABASE_URL, SUPABASE_CHAVE, {
  auth: { detectSessionInUrl: typeof window === 'undefined' || window.location.pathname.startsWith('/login') },
});

const TRADUCOES: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/user already registered|already been registered/i, 'Este e-mail já tem conta. Entre com a sua senha.'],
  [/provider is not enabled|unsupported provider/i, 'O login com o Google ainda não foi ativado. Use e-mail e senha.'],
  [/password should be at least|weak password/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/rate limit|too many requests|security purposes/i, 'Muitas tentativas seguidas. Espere um pouco e tente de novo.'],
  [/unable to validate email|invalid email|email address .* is invalid/i, 'Confira o e-mail digitado.'],
  [/new password should be different/i, 'A nova senha precisa ser diferente da anterior.'],
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
  return funcao<T>('gestao', acao, dados);
}

/** Chama uma função do servidor ({ acao, ...dados }) e devolve a mensagem de erro amigável */
export async function funcao<T = unknown>(nome: string, acao: string, dados: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: { acao, ...dados } });
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

const EXT_IMAGEM = /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif|svg|tiff?)$/i;
const EXT_VIDEO = /\.(mp4|m4v|mov|qt|webm|ogv|ogg|avi|mkv|3gp)$/i;
export const ACEITA_IMAGEM = 'image/*,.heic,.heif';
export const ACEITA_VIDEO = 'video/*,.mov,.qt,.m4v,.webm,.mkv,.avi,.3gp';
export const LIMITE_VIDEO_MB = 50;

export const ehImagem = (f: File) => f.type.startsWith('image/') || EXT_IMAGEM.test(f.name);
const ehVideo = (f: File) => f.type.startsWith('video/') || EXT_VIDEO.test(f.name);

async function subir(caminho: string, conteudo: Blob, contentType: string, cliente: SupabaseClient = supabase) {
  const { error } = await cliente.storage.from('imagens').upload(caminho, conteudo, {
    cacheControl: '31536000',
    contentType,
  });
  if (error) {
    if (/exceeded|too large|payload/i.test(error.message)) throw new Error('Arquivo grande demais para o armazenamento.');
    throw error;
  }
  return cliente.storage.from('imagens').getPublicUrl(caminho).data.publicUrl;
}

const ehHeic = (f: Blob & { name?: string }) => /hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name ?? '');

/** O navegador consegue desenhar esta imagem? */
async function navegadorLe(blob: Blob) {
  try {
    const bmp = await createImageBitmap(blob);
    bmp.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Deixa a foto num formato que todo navegador mostra. HEIC do iPhone: primeiro
 * tenta o próprio navegador (Safari lê; às vezes o arquivo é JPEG com nome .heic),
 * depois o conversor (libheif nova, que lê as fotos dos iPhones recentes).
 */
export async function imagemExibivel(arquivo: Blob & { name?: string }): Promise<Blob> {
  if (!ehHeic(arquivo) || (await navegadorLe(arquivo))) return arquivo;
  try {
    const { heicTo } = await import('heic-to');
    return await heicTo({ blob: arquivo, type: 'image/jpeg', quality: 0.92 });
  } catch {
    throw new Error('Não foi possível ler esta foto do iPhone (HEIC). Tire um print da foto ou salve como JPG e envie de novo.');
  }
}

/** Converte qualquer foto e reduz para no máximo 1600 px — carrega rápido no tablet. */
async function prepararImagem(arquivo: Blob & { name?: string }): Promise<Blob> {
  const blob = await imagemExibivel(arquivo);
  if (/svg|gif/i.test(blob.type)) return blob; // mantém vetor e animação
  try {
    const bmp = await createImageBitmap(blob);
    const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const saida = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.85));
    return saida ?? blob;
  } catch {
    return blob; // formato que o navegador não decodifica: envia como veio
  }
}

/** Envia uma imagem (qualquer formato) e devolve a URL pública. */
export async function enviarImagem(restauranteId: string, arquivo: Blob, pasta: string): Promise<string> {
  if (arquivo instanceof File && !ehImagem(arquivo)) throw new Error('Escolha um arquivo de imagem.');
  const blob = await prepararImagem(arquivo);
  if (blob.size > 15 * 1024 * 1024) throw new Error('Imagem muito grande (máximo 15 MB).');
  const tipo = blob.type || 'image/jpeg';
  const ext = tipo.split('/')[1]?.replace('jpeg', 'jpg').replace('svg+xml', 'svg') || 'jpg';
  return subir(`${restauranteId}/${pasta}/${crypto.randomUUID()}.${ext}`, blob, tipo);
}

/** Foto de perfil da própria pessoa (fica em avatars/<id da pessoa>/). */
export async function enviarFotoPerfil(userId: string, arquivo: Blob, cliente?: SupabaseClient): Promise<string> {
  if (arquivo instanceof File && !ehImagem(arquivo)) throw new Error('Escolha uma foto.');
  const blob = await prepararImagem(arquivo);
  if (blob.size > 15 * 1024 * 1024) throw new Error('Foto muito grande (máximo 15 MB).');
  const tipo = blob.type || 'image/jpeg';
  const ext = tipo.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return subir(`avatars/${userId}/${crypto.randomUUID()}.${ext}`, blob, tipo, cliente);
}

/** Envia um vídeo (MP4, MOV, WEBM…) e devolve a URL pública. */
export async function enviarVideo(restauranteId: string, arquivo: File, pasta: string): Promise<string> {
  if (!ehVideo(arquivo)) throw new Error('Escolha um arquivo de vídeo.');
  if (arquivo.size > LIMITE_VIDEO_MB * 1024 * 1024) {
    throw new Error(`Vídeo muito grande (máximo ${LIMITE_VIDEO_MB} MB). Envie um trecho mais curto.`);
  }
  const ext = (arquivo.name.split('.').pop() || 'mp4').toLowerCase();
  // MOV do iPhone (H.264) toca no Chrome/Android quando servido como MP4
  const tipo = /^(mov|qt)$/.test(ext) || arquivo.type === 'video/quicktime' ? 'video/mp4' : arquivo.type || 'video/mp4';
  return subir(`${restauranteId}/${pasta}/${crypto.randomUUID()}.${ext}`, arquivo, tipo);
}
