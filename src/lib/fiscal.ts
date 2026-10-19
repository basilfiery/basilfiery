import { msgErro, supabase } from './supabase';

/* =====================================================================
   Nota fiscal: chamadas à função "fiscal" (que fala com a Nuvem Fiscal / SEFAZ)
   ===================================================================== */

export interface ConfigFiscal {
  restaurante_id: string;
  ambiente: 'homologacao' | 'producao';
  crt: 1 | 2 | 3 | 4;
  cpf_cnpj: string | null; razao_social: string | null; nome_fantasia: string | null;
  inscricao_estadual: string | null; inscricao_municipal: string | null; email: string | null; fone: string | null;
  logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null;
  cidade: string | null; codigo_municipio: string | null; uf: string | null; cep: string | null;
  csc_id: number | null; csc: string | null;
  nfce_serie: number; nfce_proximo: number; nfe_serie: number; nfe_proximo: number;
  pis_cofins_cst: string;
  certificado_validade: string | null; certificado_titular: string | null;
  empresa_enviada_em: string | null;
}

export interface NotaFiscal {
  id: string; restaurante_id: string; pedido_id: string | null; modelo: 55 | 65; ambiente: string;
  status: 'pendente' | 'autorizado' | 'rejeitado' | 'denegado' | 'cancelado' | 'erro';
  serie: number | null; numero: number | null; chave: string | null; protocolo: string | null; nuvem_id: string | null;
  valor: number; destinatario: { cpf_cnpj?: string; nome?: string } | null; motivo: string | null; criado_em: string;
}

export interface NotaRecebida {
  id: string; chave: string; resumo: boolean; emitente_cnpj: string | null; emitente_nome: string | null;
  valor: number | null; data_emissao: string | null; manifestacao: string | null; entrada_em: string | null; criado_em: string;
}

export async function fiscal<T = unknown>(acao: string, dados: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('fiscal', { body: { acao, ...dados } });
  if (error) {
    let mensagem = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { mensagem = (await ctx.json()).erro ?? mensagem; } catch { /* mantém */ }
    }
    throw new Error(msgErro(mensagem));
  }
  return data as T;
}

/** Abre (PDF) ou baixa (XML) o arquivo que veio em base64 */
export function abrirArquivo(a: { nome: string; tipo: string; base64: string }, baixar = false) {
  const bin = atob(a.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: a.tipo }));
  if (baixar || a.tipo !== 'application/pdf') {
    const l = document.createElement('a');
    l.href = url; l.download = a.nome; l.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const STATUS_NOTA: Record<string, { rotulo: string; classe: string }> = {
  pendente: { rotulo: 'Processando', classe: 'badge--amarelo' },
  autorizado: { rotulo: 'Autorizada', classe: 'badge--verde' },
  rejeitado: { rotulo: 'Rejeitada', classe: 'badge--vermelho' },
  denegado: { rotulo: 'Denegada', classe: 'badge--vermelho' },
  cancelado: { rotulo: 'Cancelada', classe: 'badge--cancelado' },
  erro: { rotulo: 'Erro', classe: 'badge--vermelho' },
};

export const MANIFESTACOES: Record<string, string> = {
  '210210': 'Ciência da operação',
  '210200': 'Confirmação da operação',
  '210220': 'Desconhecimento da operação',
  '210240': 'Operação não realizada',
};

/**
 * Sugestão de NCM/CSOSN/CFOP pelo nome do produto (restaurante).
 * É só um ponto de partida: o contador deve confirmar.
 */
const SUGESTOES: { re: RegExp; ncm: string; csosn: string; cfop: string; rotulo: string }[] = [
  { re: /refri|coca|guaran|fanta|sprite|pepsi|soda|sukita|kuat|schweppes|t[oô]nica/i, ncm: '22021000', csosn: '500', cfop: '5405', rotulo: 'Refrigerante' },
  { re: /[aá]gua\s*(mineral|com g[aá]s|sem g[aá]s)?|crystal|bonafont/i, ncm: '22011000', csosn: '500', cfop: '5405', rotulo: 'Água mineral' },
  { re: /cerveja|chopp?|heineken|brahma|skol|budweiser|stella|amstel|original|corona|spaten|eisenbahn/i, ncm: '22030000', csosn: '500', cfop: '5405', rotulo: 'Cerveja / chopp' },
  { re: /energ[eé]tico|red ?bull|monster|tnt/i, ncm: '22029900', csosn: '500', cfop: '5405', rotulo: 'Energético' },
  { re: /vinho/i, ncm: '22042100', csosn: '500', cfop: '5405', rotulo: 'Vinho' },
  { re: /caipirinha|drink|whisky|vodka|cacha[cç]a|gin\b|dose/i, ncm: '22089000', csosn: '500', cfop: '5405', rotulo: 'Bebida destilada / drink' },
  { re: /suco|limonada|vitamina|polpa/i, ncm: '22029900', csosn: '102', cfop: '5102', rotulo: 'Suco / bebida não alcoólica' },
  { re: /sorvete|a[cç]a[ií]|picol[eé]|milk ?shake/i, ncm: '21050010', csosn: '500', cfop: '5405', rotulo: 'Sorvete / açaí' },
  { re: /chocolate|bombom|kit ?kat|snickers|trufa/i, ncm: '18069000', csosn: '500', cfop: '5405', rotulo: 'Chocolate' },
  { re: /pizza|calzone|esfiha|esfirra/i, ncm: '19059090', csosn: '102', cfop: '5102', rotulo: 'Pizza / massa assada' },
  { re: /p[aã]o|hamb[uú]rguer|burger|lanche|sandu[ií]che|x-|cachorro|hot ?dog|beirute|bauru/i, ncm: '19059090', csosn: '102', cfop: '5102', rotulo: 'Lanche' },
  { re: /bolo|torta|doce|brigadeiro|pudim|brownie|cookie/i, ncm: '19059090', csosn: '102', cfop: '5102', rotulo: 'Doce / sobremesa' },
  { re: /batata|frita|por[cç][aã]o|isca|fritas|nuggets/i, ncm: '20052000', csosn: '102', cfop: '5102', rotulo: 'Porção' },
  { re: /macarr[aã]o|lasanha|espaguete|nhoque|massa/i, ncm: '19022000', csosn: '102', cfop: '5102', rotulo: 'Massa' },
  { re: /prato|marmita|refei[cç][aã]o|executivo|almo[cç]o|janta|feijoada|fil[eé]|frango|carne|peixe/i, ncm: '21069090', csosn: '102', cfop: '5102', rotulo: 'Refeição pronta' },
];

export function sugerirFiscal(nome: string) {
  return SUGESTOES.find((s) => s.re.test(nome)) ?? { ncm: '21069090', csosn: '102', cfop: '5102', rotulo: 'Preparação alimentícia (genérico)', re: /./ };
}

export const soDigitos = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '');
export const mascaraDoc = (t: string) => {
  const d = soDigitos(t).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};
export const mascaraNcm = (t: string) => soDigitos(t).slice(0, 8).replace(/^(\d{4})(\d)/, '$1.$2').replace(/^(\d{4})\.(\d{2})(\d)/, '$1.$2.$3');

/** CEP → endereço com o código IBGE do município (ViaCEP) */
export async function buscarCepIbge(cep: string) {
  const r = await fetch(`https://viacep.com.br/ws/${soDigitos(cep)}/json/`);
  const j = await r.json();
  if (!r.ok || j.erro) throw new Error('CEP não encontrado.');
  return { logradouro: j.logradouro as string, bairro: j.bairro as string, cidade: j.localidade as string, uf: j.uf as string, codigo_municipio: j.ibge as string };
}

/** Dados de uma empresa pela Receita (BrasilAPI) para preencher o destinatário da NF-e */
export async function buscarEmpresaCnpj(cnpj: string) {
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${soDigitos(cnpj)}`);
  if (!r.ok) throw new Error(r.status === 404 ? 'CNPJ não encontrado na Receita.' : 'Não consegui consultar a Receita agora.');
  const j = await r.json();
  return {
    nome: j.razao_social as string, email: (j.email ?? '') as string,
    logradouro: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '), numero: String(j.numero ?? ''),
    complemento: (j.complemento ?? '') as string, bairro: j.bairro as string, cidade: j.municipio as string, uf: j.uf as string,
    cep: soDigitos(j.cep), codigo_municipio: String(j.codigo_municipio_ibge ?? ''),
  };
}
