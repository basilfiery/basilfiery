import { prepararImagem, supabase } from './supabase';

/* Financeiro da empresa: tipos, categorias e comprovantes */

export type TipoLanc = 'despesa' | 'receita';

export interface Lancamento {
  id: string;
  restaurante_id: string;
  tipo: TipoLanc;
  categoria: string;
  descricao: string;
  valor: number;
  data: string;
  vencimento: string | null;
  pago: boolean;
  pago_em: string | null;
  forma: string | null;
  fornecedor: string | null;
  funcionario_id: string | null;
  conta_fixa_id: string | null;
  chave_auto: string | null;
  comprovante_path: string | null;
  itens: { nome: string; qtd?: number | null; valor?: number | null }[] | null;
  origem: 'manual' | 'whatsapp' | 'sistema';
  observacao: string | null;
  criado_por_nome: string | null;
  criado_em: string;
}

export interface Funcionario {
  id: string;
  restaurante_id: string;
  nome: string;
  cargo: string | null;
  salario: number;
  dia_pagamento: number;
  admissao: string | null;
  telefone: string | null;
  pix: string | null;
  ativo: boolean;
  observacao: string | null;
}

export interface ContaFixa {
  id: string;
  restaurante_id: string;
  descricao: string;
  categoria: string;
  valor: number;
  dia_vencimento: number;
  ativo: boolean;
}

export interface ResumoFin {
  hoje: string;
  vendas: { total: number; pedidos: number };
  vendas_ate_hoje: number;
  recebido_por_forma: Record<string, number>;
  corridas: number;
  despesas_pagas: number;
  despesas_a_pagar: number;
  vencidas: { total: number; qtd: number };
  receitas: number;
  por_categoria: { categoria: string; total: number; pago: number | null }[];
  por_dia: { dia: string; vendas: number; despesas: number }[];
}

export const CATEGORIAS_DESPESA = [
  'Mercadorias e insumos', 'Uso e consumo', 'Embalagens', 'Folha de pagamento', 'Aluguel', 'Água, luz e gás',
  'Internet e telefone', 'Impostos e taxas', 'Taxas de cartão e apps', 'Manutenção', 'Marketing',
  'Pró-labore (retirada do dono)', 'Outras despesas',
];
export const CATEGORIAS_RECEITA = ['Outras receitas', 'Venda fora do sistema', 'Aporte do dono'];

export const FORMAS_FIN = [
  { id: 'dinheiro', rotulo: 'Dinheiro' }, { id: 'pix', rotulo: 'Pix' }, { id: 'debito', rotulo: 'Débito' },
  { id: 'credito', rotulo: 'Crédito' }, { id: 'boleto', rotulo: 'Boleto' }, { id: 'transferencia', rotulo: 'Transferência' },
];
export const rotuloForma = (id: string | null) => FORMAS_FIN.find((f) => f.id === id)?.rotulo ?? id ?? '';

/** Data local AAAA-MM-DD */
export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const dataBRCurta = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '');
export const dataBRLonga = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** Primeiro e último dia do mês */
export function limitesMes(ano: number, mes: number) {
  const ini = `${ano}-${String(mes + 1).padStart(2, '0')}-01`;
  const ult = new Date(ano, mes + 1, 0).getDate();
  return { ini, fim: `${ano}-${String(mes + 1).padStart(2, '0')}-${String(ult).padStart(2, '0')}`, dias: ult };
}
export const nomeMes = (ano: number, mes: number) =>
  new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());

/** Envia a foto do comprovante (pasta privada da loja) e devolve o caminho */
export async function enviarComprovante(restauranteId: string, arquivo: File): Promise<string> {
  const pdf = arquivo.type === 'application/pdf';
  if (!pdf && !arquivo.type.startsWith('image/')) throw new Error('Envie uma foto ou um PDF do comprovante.');
  const blob = pdf ? arquivo : await prepararImagem(arquivo);
  if (blob.size > 15 * 1024 * 1024) throw new Error('Arquivo muito grande (máximo 15 MB).');
  const tipo = blob.type || (pdf ? 'application/pdf' : 'image/jpeg');
  const ext = pdf ? 'pdf' : (tipo.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
  const caminho = `${restauranteId}/comprovantes/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('financeiro').upload(caminho, blob, { contentType: tipo });
  if (error) throw error;
  return caminho;
}

/** Link temporário (10 min) para ver o comprovante */
export async function linkComprovante(caminho: string) {
  const { data, error } = await supabase.storage.from('financeiro').createSignedUrl(caminho, 600);
  if (error) throw error;
  return data.signedUrl;
}
