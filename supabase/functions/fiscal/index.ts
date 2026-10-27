// Nota fiscal eletrônica (NFC-e modelo 65, NF-e modelo 55 e notas recebidas no CNPJ).
// Quem fala com a SEFAZ é a Nuvem Fiscal (https://nuvemfiscal.com.br): uma conta da plataforma,
// cada restaurante vira uma "empresa" lá, com o próprio certificado A1.
// Segredos: NUVEMFISCAL_CLIENT_ID, NUVEMFISCAL_CLIENT_SECRET (e NUVEMFISCAL_URL opcional).
import { createClient } from 'npm:@supabase/supabase-js@2';

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

class Falha extends Error {
  constructor(mensagem: string, public status = 400) { super(mensagem); }
}

// deno-lint-ignore no-explicit-any
type Obj = Record<string, any>;

/* ======================= Nuvem Fiscal ======================= */
const CLIENT_ID = Deno.env.get('NUVEMFISCAL_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('NUVEMFISCAL_CLIENT_SECRET') ?? '';
const BASE = (Deno.env.get('NUVEMFISCAL_URL') ?? 'https://api.nuvemfiscal.com.br').replace(/\/$/, '');
const provedorPronto = () => !!CLIENT_ID && !!CLIENT_SECRET;

let token: { valor: string; expira: number } | null = null;
async function tokenNuvem() {
  if (token && token.expira > Date.now() + 60_000) return token.valor;
  const r = await fetch('https://auth.nuvemfiscal.com.br/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      scope: 'empresa cep cnpj nfce nfe distribuicao-nfe',
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Falha('Não consegui conectar à Nuvem Fiscal. Confira as credenciais da plataforma.', 502);
  token = { valor: d.access_token, expira: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return token.valor;
}

/** Chamada à API; devolve JSON (ou bytes, quando pedido). */
async function nuvem(metodo: string, caminho: string, corpo?: unknown, opcoes: { bytes?: boolean; aceitar404?: boolean } = {}) {
  if (!provedorPronto()) throw new Falha('A emissão de notas ainda não foi ativada na plataforma (faltam as credenciais da Nuvem Fiscal).', 503);
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await tokenNuvem()}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
  });
  if (opcoes.aceitar404 && r.status === 404) return null;
  if (!r.ok) {
    const t = await r.text();
    let msg = t;
    try {
      const e = JSON.parse(t);
      msg = e?.error?.message ?? e?.message ?? t;
      const det = e?.error?.errors ?? e?.errors;
      if (Array.isArray(det) && det.length) msg += ': ' + det.map((x: Obj) => x.message ?? x.description ?? JSON.stringify(x)).join(' | ');
    } catch { /* texto puro */ }
    throw new Falha(`Nuvem Fiscal: ${String(msg).slice(0, 600)}`, r.status >= 500 ? 502 : 400);
  }
  if (opcoes.bytes) return new Uint8Array(await r.arrayBuffer());
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}

/* ======================= Acesso ======================= */
async function usuario(req: Request) {
  const t = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!t) throw new Falha('Faça login novamente.', 401);
  const { data, error } = await admin.auth.getUser(t);
  if (error || !data.user) throw new Falha('Sessão expirada. Faça login novamente.', 401);
  return data.user;
}
async function exigirPapel(uid: string, rest: string, papeis: string[]) {
  const { data } = await admin.from('membros').select('papel').eq('user_id', uid).eq('restaurante_id', rest).maybeSingle();
  const { data: adm } = await admin.from('plataforma_admins').select('user_id').eq('user_id', uid).maybeSingle();
  if (!adm && (!data || !papeis.includes(data.papel))) throw new Falha('Você não tem permissão para isso.', 403);
}
const GESTOR = ['dono', 'gerente'];
const CAIXA = ['dono', 'gerente', 'caixa'];

async function config(rest: string) {
  const { data } = await admin.from('fiscal_config').select('*').eq('restaurante_id', rest).maybeSingle();
  return data as Obj | null;
}

/* ======================= Montagem da nota ======================= */
const UF_COD: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};
const TPAG: Record<string, string> = { dinheiro: '01', credito: '03', debito: '04', pix: '17' };
const r2 = (n: number) => Math.round(n * 100) / 100;
const so = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const txt = (s: unknown, max: number) => String(s ?? '').replace(/[<>&"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function agoraBrasilia() {
  const d = new Date(Date.now() - 3 * 3600_000);
  return d.toISOString().slice(0, 19) + '-03:00';
}

function imposto(cfg: Obj, p: Obj, vProd: number) {
  const orig = 0;
  const codigo = String(p.csosn ?? (cfg.crt === 3 ? '00' : '102'));
  let ICMS: Obj;
  let vBC = 0, vICMS = 0;
  if (cfg.crt !== 3) {
    if (codigo === '500') ICMS = { ICMSSN500: { orig, CSOSN: '500' } };
    else if (codigo === '900') ICMS = { ICMSSN900: { orig, CSOSN: '900' } };
    else ICMS = { ICMSSN102: { orig, CSOSN: ['102', '103', '300', '400'].includes(codigo) ? codigo : '102' } };
  } else if (codigo === '60') {
    ICMS = { ICMS60: { orig, CST: '60' } };
  } else if (codigo === '40' || codigo === '41') {
    ICMS = { ICMS40: { orig, CST: codigo } };
  } else {
    const aliq = Number(p.icms_aliquota ?? 0);
    vBC = r2(vProd); vICMS = r2(vBC * aliq / 100);
    ICMS = { ICMS00: { orig, CST: '00', modBC: 3, vBC, pICMS: aliq, vICMS } };
  }
  const cst = String(cfg.pis_cofins_cst ?? '49');
  let PIS: Obj, COFINS: Obj, vPIS = 0, vCOFINS = 0;
  if (['04', '05', '06', '07', '08', '09'].includes(cst)) {
    PIS = { PISNT: { CST: cst } }; COFINS = { COFINSNT: { CST: cst } };
  } else if (cst === '01' || cst === '02') {
    vPIS = r2(vProd * 0.0065); vCOFINS = r2(vProd * 0.03);
    PIS = { PISAliq: { CST: cst, vBC: r2(vProd), pPIS: 0.65, vPIS } };
    COFINS = { COFINSAliq: { CST: cst, vBC: r2(vProd), pCOFINS: 3, vCOFINS } };
  } else {
    PIS = { PISOutr: { CST: cst, vBC: 0, pPIS: 0, vPIS: 0 } };
    COFINS = { COFINSOutr: { CST: cst, vBC: 0, pCOFINS: 0, vCOFINS: 0 } };
  }
  return { imposto: { ICMS, PIS, COFINS }, vBC, vICMS, vPIS, vCOFINS };
}

interface ItemNota { nome: string; qtd: number; preco: number; produto: Obj | null }

function montarNota(o: {
  cfg: Obj; modelo: 65 | 55; serie: number; numero: number; itens: ItemNota[];
  desconto: number; outros: number; forma: string; recebido?: number | null;
  dest?: Obj | null; indFinal?: number; infCpl?: string; referencia: string;
}) {
  const { cfg, modelo } = o;
  const homolog = cfg.ambiente === 'homologacao';
  const ufDest = String(o.dest?.uf ?? cfg.uf).toUpperCase();
  const interestadual = modelo === 55 && !!o.dest?.uf && ufDest !== cfg.uf;

  // Rateio do desconto e da taxa de entrega entre os itens (centavo que sobra vai no último)
  const base = o.itens.map((i) => r2(i.qtd * i.preco));
  const totalProd = r2(base.reduce((s, v) => s + v, 0));
  const ratear = (valor: number) => {
    if (valor <= 0 || totalProd <= 0) return base.map(() => 0);
    const partes = base.map((v) => r2(valor * v / totalProd));
    partes[partes.length - 1] = r2(partes[partes.length - 1] + valor - partes.reduce((s, v) => s + v, 0));
    return partes;
  };
  const descs = ratear(r2(o.desconto));
  const outs = ratear(r2(o.outros));

  let vBC = 0, vICMS = 0, vPIS = 0, vCOFINS = 0;
  const det = o.itens.map((i, n) => {
    const p = i.produto ?? {};
    const codigo = String(p.csosn ?? '');
    let cfop = String(p.cfop ?? (codigo === '500' || codigo === '60' ? '5405' : '5102'));
    if (interestadual && cfop.startsWith('5')) cfop = '6' + cfop.slice(1);
    const un = txt(p.unidade_fiscal || 'UN', 6);
    const imp = imposto(cfg, p, base[n] - descs[n]);
    vBC += imp.vBC; vICMS += imp.vICMS; vPIS += imp.vPIS; vCOFINS += imp.vCOFINS;
    const xProd = homolog && n === 0 && modelo === 65 ? 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : txt(i.nome, 120);
    const prod: Obj = {
      cProd: String(p.id ?? `ITEM${n + 1}`).replace(/-/g, '').slice(0, 20).toUpperCase(), cEAN: 'SEM GTIN', xProd,
      NCM: p.ncm, CFOP: cfop, uCom: un, qCom: i.qtd, vUnCom: r2(i.preco), vProd: base[n],
      cEANTrib: 'SEM GTIN', uTrib: un, qTrib: i.qtd, vUnTrib: r2(i.preco), indTot: 1,
    };
    if (p.cest) prod.CEST = p.cest;
    if (descs[n] > 0) prod.vDesc = descs[n];
    if (outs[n] > 0) prod.vOutro = outs[n];
    return { nItem: n + 1, prod, imposto: imp.imposto };
  });

  const vDesc = r2(descs.reduce((s, v) => s + v, 0));
  const vOutro = r2(outs.reduce((s, v) => s + v, 0));
  const vNF = r2(totalProd - vDesc + vOutro);
  const tPag = TPAG[o.forma] ?? '99';
  const detPag: Obj = { indPag: 0, tPag, vPag: r2(Math.max(vNF, o.forma === 'dinheiro' && o.recebido ? o.recebido : vNF)) };
  if (tPag === '99') detPag.xPag = 'Outros';
  if (tPag === '03' || tPag === '04') detPag.card = { tpIntegra: 2 };
  const pag: Obj = { detPag: [detPag] };
  if (o.forma === 'dinheiro' && o.recebido && o.recebido > vNF) pag.vTroco = r2(o.recebido - vNF);

  const enderEmit = {
    xLgr: txt(cfg.logradouro, 60), nro: txt(cfg.numero || 'S/N', 60), ...(cfg.complemento ? { xCpl: txt(cfg.complemento, 60) } : {}),
    xBairro: txt(cfg.bairro, 60), cMun: cfg.codigo_municipio, xMun: txt(cfg.cidade, 60), UF: cfg.uf, CEP: cfg.cep,
    cPais: '1058', xPais: 'BRASIL', ...(cfg.fone ? { fone: so(cfg.fone) } : {}),
  };
  const doc = so(cfg.cpf_cnpj);
  const emit: Obj = {
    ...(doc.length === 14 ? { CNPJ: doc } : { CPF: doc }),
    xNome: txt(cfg.razao_social, 60), ...(cfg.nome_fantasia ? { xFant: txt(cfg.nome_fantasia, 60) } : {}),
    enderEmit, IE: so(cfg.inscricao_estadual) || 'ISENTO', CRT: cfg.crt,
  };

  let dest: Obj | undefined;
  if (o.dest && so(o.dest.cpf_cnpj)) {
    const d = so(o.dest.cpf_cnpj);
    const nomeDest = homolog ? 'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL' : txt(o.dest.nome, 60);
    const ie = so(o.dest.ie);
    dest = {
      ...(d.length === 14 ? { CNPJ: d } : { CPF: d }),
      ...(nomeDest ? { xNome: nomeDest } : {}),
      indIEDest: ie ? 1 : o.dest.ie_isento ? 2 : 9,
      ...(ie ? { IE: ie } : {}),
      ...(o.dest.email ? { email: txt(o.dest.email, 60) } : {}),
    };
    if (modelo === 55 || o.dest.logradouro) {
      dest.enderDest = {
        xLgr: txt(o.dest.logradouro, 60), nro: txt(o.dest.numero || 'S/N', 60), ...(o.dest.complemento ? { xCpl: txt(o.dest.complemento, 60) } : {}),
        xBairro: txt(o.dest.bairro, 60), cMun: so(o.dest.codigo_municipio), xMun: txt(o.dest.cidade, 60), UF: ufDest,
        ...(so(o.dest.cep) ? { CEP: so(o.dest.cep) } : {}), cPais: '1058', xPais: 'BRASIL',
      };
    }
  }

  return {
    ambiente: cfg.ambiente,
    referencia: o.referencia,
    infNFe: {
      versao: '4.00',
      ide: {
        cUF: UF_COD[cfg.uf], natOp: 'VENDA', mod: modelo, serie: o.serie, nNF: o.numero, dhEmi: agoraBrasilia(),
        tpNF: 1, idDest: interestadual ? 2 : 1, cMunFG: cfg.codigo_municipio, tpImp: modelo === 65 ? 4 : 1, tpEmis: 1,
        finNFe: 1, indFinal: modelo === 65 ? 1 : (o.indFinal ?? 1), indPres: 1, procEmi: 0, verProc: 'BasilFiery 1.0',
      },
      emit,
      ...(dest ? { dest } : {}),
      det,
      total: {
        ICMSTot: {
          vBC: r2(vBC), vICMS: r2(vICMS), vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0,
          vProd: totalProd, vFrete: 0, vSeg: 0, vDesc, vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: r2(vPIS), vCOFINS: r2(vCOFINS), vOutro, vNF,
        },
      },
      transp: { modFrete: 9 },
      pag,
      ...(o.infCpl ? { infAdic: { infCpl: txt(o.infCpl, 2000) } } : {}),
    },
  };
}

/** Resultado da Nuvem → linha da nota */
function resultado(r: Obj) {
  const aut = r.autorizacao ?? {};
  return {
    status: r.status ?? 'pendente',
    chave: r.chave ?? aut.chave_acesso ?? null,
    protocolo: aut.numero_protocolo ?? null,
    motivo: aut.motivo_status ? `${aut.codigo_status ?? ''} ${aut.motivo_status}`.trim() : (r.status === 'erro' ? 'Erro ao transmitir. Tente de novo.' : null),
    nuvem_id: r.id ?? null,
    atualizado_em: new Date().toISOString(),
  };
}

const caminhoTipo = (modelo: number) => (modelo === 65 ? 'nfce' : 'nfe');

function base64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ======================= Ações ======================= */
const acoes: Record<string, (uid: string, c: Obj) => Promise<unknown>> = {
  async estado(uid, c) {
    await exigirPapel(uid, c.restaurante_id, CAIXA);
    return { provedor: provedorPronto(), config: await config(c.restaurante_id) };
  },

  /** Salva os dados da empresa e envia para a Nuvem Fiscal (empresa + NFC-e + NF-e + notas recebidas). */
  async salvar(uid, c) {
    await exigirPapel(uid, c.restaurante_id, GESTOR);
    const d = c.dados ?? {};
    const doc = so(d.cpf_cnpj);
    if (doc.length !== 14 && doc.length !== 11) throw new Falha('Informe o CNPJ (ou CPF, se for produtor rural).');
    if (!d.razao_social?.trim()) throw new Falha('Informe a razão social.');
    if (!/^\d{7}$/.test(so(d.codigo_municipio))) throw new Falha('Código do município (IBGE) inválido. Busque pelo CEP.');
    if (!/^[A-Z]{2}$/.test(String(d.uf ?? '').toUpperCase())) throw new Falha('Informe a UF.');
    const linha = {
      restaurante_id: c.restaurante_id,
      ambiente: d.ambiente === 'producao' ? 'producao' : 'homologacao',
      crt: [1, 2, 3, 4].includes(Number(d.crt)) ? Number(d.crt) : 1,
      cpf_cnpj: doc, razao_social: txt(d.razao_social, 120), nome_fantasia: txt(d.nome_fantasia, 120) || null,
      inscricao_estadual: so(d.inscricao_estadual) || null, inscricao_municipal: so(d.inscricao_municipal) || null,
      email: txt(d.email, 120) || null, fone: so(d.fone) || null,
      logradouro: txt(d.logradouro, 60), numero: txt(d.numero, 60) || 'S/N', complemento: txt(d.complemento, 60) || null,
      bairro: txt(d.bairro, 60), cidade: txt(d.cidade, 60), codigo_municipio: so(d.codigo_municipio), uf: String(d.uf).toUpperCase(), cep: so(d.cep),
      csc_id: d.csc_id ? Number(d.csc_id) : null, csc: txt(d.csc, 60) || null,
      nfce_serie: Math.max(1, Number(d.nfce_serie) || 1), nfce_proximo: Math.max(1, Number(d.nfce_proximo) || 1),
      nfe_serie: Math.max(1, Number(d.nfe_serie) || 1), nfe_proximo: Math.max(1, Number(d.nfe_proximo) || 1),
      pis_cofins_cst: /^\d{2}$/.test(String(d.pis_cofins_cst)) ? String(d.pis_cofins_cst) : '49',
      emitir_auto: !!d.emitir_auto,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await admin.from('fiscal_config').upsert(linha);
    if (error) throw new Falha(error.message);
    if (!provedorPronto()) return { enviado: false };

    const empresa = {
      cpf_cnpj: doc, nome_razao_social: linha.razao_social, ...(linha.nome_fantasia ? { nome_fantasia: linha.nome_fantasia } : {}),
      ...(linha.inscricao_estadual ? { inscricao_estadual: linha.inscricao_estadual } : {}),
      ...(linha.inscricao_municipal ? { inscricao_municipal: linha.inscricao_municipal } : {}),
      ...(linha.fone ? { fone: linha.fone } : {}),
      email: linha.email || `fiscal+${doc}@basilfiery.app`,
      endereco: {
        logradouro: linha.logradouro, numero: linha.numero, ...(linha.complemento ? { complemento: linha.complemento } : {}),
        bairro: linha.bairro, codigo_municipio: linha.codigo_municipio, cidade: linha.cidade, uf: linha.uf, codigo_pais: '1058', pais: 'Brasil', cep: linha.cep,
      },
    };
    const existe = await nuvem('GET', `/empresas/${doc}`, undefined, { aceitar404: true });
    if (existe) await nuvem('PUT', `/empresas/${doc}`, empresa);
    else await nuvem('POST', '/empresas', empresa);
    if (linha.csc_id && linha.csc) await nuvem('PUT', `/empresas/${doc}/nfce`, { CRT: linha.crt, ambiente: linha.ambiente, sefaz: { id_csc: linha.csc_id, csc: linha.csc } });
    await nuvem('PUT', `/empresas/${doc}/nfe`, { CRT: linha.crt, ambiente: linha.ambiente });
    if (doc.length === 14) {
      await nuvem('PUT', `/empresas/${doc}/distnfe`, { ambiente: linha.ambiente, distribuicao_automatica: true, distribuicao_intervalo_horas: 6, ciencia_automatica: true });
    }
    await admin.from('fiscal_config').update({ empresa_enviada_em: new Date().toISOString() }).eq('restaurante_id', c.restaurante_id);
    return { enviado: true };
  },

  /** Certificado A1 (.pfx) vai direto para a Nuvem Fiscal; aqui só guardamos validade e titular. */
  async certificado(uid, c) {
    await exigirPapel(uid, c.restaurante_id, GESTOR);
    const cfg = await config(c.restaurante_id);
    if (!cfg?.empresa_enviada_em) throw new Falha('Salve os dados da empresa antes de enviar o certificado.');
    if (!c.arquivo || !c.senha) throw new Falha('Envie o arquivo .pfx e a senha do certificado.');
    const r = await nuvem('PUT', `/empresas/${cfg.cpf_cnpj}/certificado`, { certificado: String(c.arquivo), password: String(c.senha) }) as Obj;
    await admin.from('fiscal_config').update({ certificado_validade: r.not_valid_after ?? null, certificado_titular: r.subject_name ?? r.nome_razao_social ?? null })
      .eq('restaurante_id', c.restaurante_id);
    return { validade: r.not_valid_after, titular: r.subject_name ?? r.nome_razao_social };
  },

  /** Emite NFC-e (65) ou NF-e (55) de um pedido. Com nota_id, tenta de novo a mesma nota (mesmo número). */
  async emitir(uid, c) {
    const rest = String(c.restaurante_id);
    await exigirPapel(uid, rest, CAIXA);
    const cfg = await config(rest);
    if (!cfg?.empresa_enviada_em) throw new Falha('Configure a nota fiscal em Configurações › Nota fiscal.');
    const modelo: 65 | 55 = Number(c.modelo) === 55 ? 55 : 65;
    if (modelo === 65 && (!cfg.csc_id || !cfg.csc)) throw new Falha('Falta o CSC (código de segurança da NFC-e) em Configurações › Nota fiscal.');
    if (!cfg.certificado_validade) throw new Falha('Envie o certificado digital A1 em Configurações › Nota fiscal.');

    const { data: ped } = await admin.from('pedidos').select('*, pedido_itens(*)').eq('id', c.pedido_id).eq('restaurante_id', rest).maybeSingle();
    if (!ped) throw new Falha('Pedido não encontrado.');
    if (ped.status === 'cancelado') throw new Falha('Pedido cancelado não pode ter nota.');
    const ids = [...new Set((ped.pedido_itens as Obj[]).map((i) => i.produto_id).filter(Boolean))];
    const { data: prods } = await admin.from('produtos').select('id, nome, ncm, cfop, csosn, cest, unidade_fiscal, icms_aliquota').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const porId = new Map((prods ?? []).map((p) => [p.id, p]));
    const itens: ItemNota[] = (ped.pedido_itens as Obj[]).map((i) => ({
      nome: i.complementos ? `${i.nome} (${i.complementos})` : i.nome, qtd: Number(i.qtd), preco: Number(i.preco_unit), produto: porId.get(i.produto_id) ?? null,
    }));
    const semNcm = [...new Set(itens.filter((i) => !i.produto?.ncm).map((i) => i.produto?.nome ?? i.nome))];
    if (semNcm.length) throw new Falha(`Falta o NCM de: ${semNcm.slice(0, 5).join(', ')}${semNcm.length > 5 ? '…' : ''}. Preencha em Notas fiscais › Dados fiscais dos produtos.`);

    // Prévia: só monta o JSON, sem reservar número nem gravar nada
    if (c.previa) {
      {
        const dest = c.destinatario ?? (c.cpf ? { cpf_cnpj: so(c.cpf), nome: c.nome ?? null } : null);
        return { payload: montarNota({
          cfg, modelo, serie: modelo === 65 ? cfg.nfce_serie : cfg.nfe_serie, numero: modelo === 65 ? cfg.nfce_proximo : cfg.nfe_proximo, itens,
          desconto: Number(ped.desconto ?? 0), outros: Number(ped.taxa_entrega ?? 0) + Number(ped.acrescimo ?? 0), forma: String(c.forma ?? ped.forma_pagamento ?? 'dinheiro'),
          recebido: null, dest, indFinal: 1, infCpl: `Pedido #${ped.numero}`, referencia: 'previa',
        }) };
      }
    }

    if (!provedorPronto()) throw new Falha('A emissão de notas ainda não foi ativada na plataforma (faltam as credenciais da Nuvem Fiscal).', 503);
    // Mesma nota (tentar de novo) ou nota nova com número reservado
    let nota: Obj | null = null;
    if (c.nota_id) {
      const { data } = await admin.from('notas_fiscais').select('*').eq('id', c.nota_id).eq('restaurante_id', rest).maybeSingle();
      if (!data) throw new Falha('Nota não encontrada.');
      if (data.status === 'autorizado') throw new Falha('Esta nota já está autorizada.');
      nota = data;
    } else {
      const { data: ja } = await admin.from('notas_fiscais').select('id, status').eq('pedido_id', ped.id).in('status', ['autorizado', 'pendente']).maybeSingle();
      if (ja) throw new Falha(ja.status === 'autorizado' ? 'Este pedido já tem nota autorizada.' : 'Já existe uma nota deste pedido sendo processada.');
      const { data: num, error } = await admin.rpc('fiscal_reservar_numero', { p_rest: rest, p_modelo: modelo });
      if (error || !num?.[0]) throw new Falha('Não consegui reservar o número da nota.');
      const { data: nova, error: e2 } = await admin.from('notas_fiscais').insert({
        restaurante_id: rest, pedido_id: ped.id, modelo, ambiente: cfg.ambiente, serie: num[0].serie, numero: num[0].numero,
        valor: Number(ped.total), destinatario: c.destinatario ?? (c.cpf ? { cpf_cnpj: so(c.cpf), nome: c.nome ?? null } : null), criado_por: uid,
      }).select('*').single();
      if (e2) throw new Falha(e2.message);
      nota = nova;
    }

    const payload = montarNota({
      cfg, modelo, serie: nota!.serie, numero: nota!.numero, itens,
      desconto: Number(ped.desconto ?? 0), outros: Number(ped.taxa_entrega ?? 0) + Number(ped.acrescimo ?? 0),
      forma: String(c.forma ?? ped.forma_pagamento ?? 'dinheiro'), recebido: ped.forma_pagamento === 'dinheiro' ? Number(ped.troco_para ?? 0) || null : null,
      dest: nota!.destinatario, indFinal: c.indFinal != null ? Number(c.indFinal) : 1,
      infCpl: `Pedido #${ped.numero}${ped.mesa_nome ? ` - ${ped.mesa_nome}` : ''}`,
      referencia: `${nota!.id}-${Date.now()}`,
    });
    try {
      const r = await nuvem('POST', `/${caminhoTipo(modelo)}`, payload) as Obj;
      const linha = resultado(r);
      await admin.from('notas_fiscais').update(linha).eq('id', nota!.id);
      return { id: nota!.id, ...linha };
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      await admin.from('notas_fiscais').update({ status: 'erro', motivo: motivo.slice(0, 600), atualizado_em: new Date().toISOString() }).eq('id', nota!.id);
      throw e;
    }
  },

  async consultar(uid, c) {
    const { data: n } = await admin.from('notas_fiscais').select('*').eq('id', c.nota_id).maybeSingle();
    if (!n) throw new Falha('Nota não encontrada.');
    await exigirPapel(uid, n.restaurante_id, CAIXA);
    if (!n.nuvem_id) return n;
    const r = await nuvem('GET', `/${caminhoTipo(n.modelo)}/${n.nuvem_id}`) as Obj;
    const linha = resultado(r);
    await admin.from('notas_fiscais').update({ ...linha, ...(linha.status === 'cancelado' && !n.cancelada_em ? { cancelada_em: new Date().toISOString() } : {}) }).eq('id', n.id);
    return { ...n, ...linha };
  },

  async cancelar(uid, c) {
    const { data: n } = await admin.from('notas_fiscais').select('*').eq('id', c.nota_id).maybeSingle();
    if (!n) throw new Falha('Nota não encontrada.');
    await exigirPapel(uid, n.restaurante_id, GESTOR);
    if (n.status !== 'autorizado') throw new Falha('Só dá para cancelar nota autorizada.');
    const just = txt(c.justificativa, 255);
    if (just.length < 15) throw new Falha('A justificativa precisa ter pelo menos 15 letras.');
    const ev = await nuvem('POST', `/${caminhoTipo(n.modelo)}/${n.nuvem_id}/cancelamento`, { justificativa: just }) as Obj;
    if (ev.status === 'rejeitado' || ev.status === 'erro') throw new Falha(`SEFAZ: ${ev.codigo_status ?? ''} ${ev.motivo_status ?? 'cancelamento rejeitado'}`.trim());
    await admin.from('notas_fiscais').update({ status: 'cancelado', cancelada_em: new Date().toISOString(), motivo: `Cancelada: ${just}`, atualizado_em: new Date().toISOString() }).eq('id', n.id);
    return { ok: true };
  },

  /** PDF (DANFE / DANFE NFC-e) ou XML da nota emitida */
  async arquivo(uid, c) {
    const { data: n } = await admin.from('notas_fiscais').select('*').eq('id', c.nota_id).maybeSingle();
    if (!n?.nuvem_id) throw new Falha('Nota sem arquivo ainda.');
    await exigirPapel(uid, n.restaurante_id, CAIXA);
    const xml = c.formato === 'xml';
    const caminho = `/${caminhoTipo(n.modelo)}/${n.nuvem_id}/${xml ? 'xml' : 'pdf'}${!xml && n.modelo === 65 ? `?largura=${Number(c.largura) === 58 ? 58 : 80}` : ''}`;
    const bytes = await nuvem('GET', caminho, undefined, { bytes: true }) as Uint8Array;
    return { nome: `${n.modelo === 65 ? 'NFCe' : 'NFe'}-${n.serie}-${n.numero}.${xml ? 'xml' : 'pdf'}`, tipo: xml ? 'application/xml' : 'application/pdf', base64: base64(bytes) };
  },

  /** Busca na SEFAZ as notas emitidas contra o CNPJ (Distribuição DF-e) */
  async sincronizar(uid, c) {
    await exigirPapel(uid, c.restaurante_id, GESTOR);
    const cfg = await config(c.restaurante_id);
    if (!cfg?.empresa_enviada_em || !cfg.certificado_validade) throw new Falha('Configure a empresa e o certificado em Configurações › Nota fiscal.');
    if (so(cfg.cpf_cnpj).length !== 14) throw new Falha('A busca de notas recebidas funciona para CNPJ.');
    let aviso: string | null = null;
    try {
      const d = await nuvem('POST', '/distribuicao/nfe', { cpf_cnpj: cfg.cpf_cnpj, ambiente: cfg.ambiente, tipo_consulta: 'dist-nsu' }) as Obj;
      if (d.codigo_status === 656) aviso = 'A SEFAZ pede para esperar 1 hora entre as buscas. Mostrando o que já foi baixado.';
    } catch (e) {
      aviso = e instanceof Error ? e.message : String(e);
    }
    const lista = await nuvem('GET', `/distribuicao/nfe/documentos?cpf_cnpj=${cfg.cpf_cnpj}&ambiente=${cfg.ambiente}&tipo_documento=nota&$top=100&$inlinecount=true`) as Obj;
    let novas = 0;
    for (const doc of (lista.data ?? []) as Obj[]) {
      if (!doc.chave_acesso) continue;
      const linha = {
        restaurante_id: c.restaurante_id, chave: doc.chave_acesso, nuvem_documento_id: doc.id, resumo: !!doc.resumo,
        emitente_cnpj: doc.emitente_cpf_cnpj ?? null, emitente_nome: doc.emitente_nome_razao_social ?? null, emitente_ie: doc.emitente_inscricao_estadual ?? null,
        valor: doc.valor_nfe ?? null, data_emissao: doc.data_emissao ?? doc.data_recebimento ?? doc.created_at ?? null,
      };
      const { data: ja } = await admin.from('notas_recebidas').select('id, resumo').eq('restaurante_id', c.restaurante_id).eq('chave', doc.chave_acesso).maybeSingle();
      if (!ja) { await admin.from('notas_recebidas').insert(linha); novas++; }
      else if (ja.resumo && !doc.resumo) await admin.from('notas_recebidas').update({ resumo: false, nuvem_documento_id: doc.id }).eq('id', ja.id);
    }
    return { novas, aviso };
  },

  /** Manifestação do destinatário: 210210 ciência, 210200 confirmação, 210220 desconhecimento, 210240 não realizada */
  async manifestar(uid, c) {
    const { data: n } = await admin.from('notas_recebidas').select('*').eq('id', c.nota_id).maybeSingle();
    if (!n) throw new Falha('Nota não encontrada.');
    await exigirPapel(uid, n.restaurante_id, GESTOR);
    const cfg = await config(n.restaurante_id);
    const tipo = String(c.tipo_evento);
    if (!['210200', '210210', '210220', '210240'].includes(tipo)) throw new Falha('Tipo de manifestação inválido.');
    const ev = await nuvem('POST', '/distribuicao/nfe/manifestacoes', {
      cpf_cnpj: cfg!.cpf_cnpj, ambiente: cfg!.ambiente, chave_acesso: n.chave, tipo_evento: tipo,
      ...(tipo === '210240' ? { justificativa: txt(c.justificativa || 'Operacao nao realizada pelo destinatario', 255) } : {}),
    }) as Obj;
    if (ev.status === 'rejeitado' || ev.status === 'erro') throw new Falha(`SEFAZ: ${ev.codigo_status ?? ''} ${ev.motivo_status ?? 'manifestação rejeitada'}`.trim());
    await admin.from('notas_recebidas').update({ manifestacao: tipo, manifestada_em: new Date().toISOString() }).eq('id', n.id);
    return { ok: true };
  },

  /** XML completo (para ver os itens e dar entrada) ou PDF da nota recebida */
  async arquivo_recebida(uid, c) {
    const { data: n } = await admin.from('notas_recebidas').select('*').eq('id', c.nota_id).maybeSingle();
    if (!n?.nuvem_documento_id) throw new Falha('Nota não encontrada.');
    await exigirPapel(uid, n.restaurante_id, GESTOR);
    if (n.resumo) throw new Falha('A SEFAZ ainda só mandou o resumo. Dê "Ciência" e busque de novo daqui a alguns minutos para baixar a nota completa.');
    const pdf = c.formato === 'pdf';
    const bytes = await nuvem('GET', `/distribuicao/nfe/documentos/${n.nuvem_documento_id}/${pdf ? 'pdf' : 'xml'}`, undefined, { bytes: true }) as Uint8Array;
    return pdf ? { nome: `NFe-${n.chave}.pdf`, tipo: 'application/pdf', base64: base64(bytes) } : { xml: new TextDecoder().decode(bytes) };
  },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const corpo = await req.json().catch(() => ({})) as Obj;
    const acao = acoes[String(corpo.acao)];
    if (!acao) throw new Falha('Ação desconhecida.');
    const u = await usuario(req);
    return json(await acao(u.id, corpo));
  } catch (e) {
    if (e instanceof Falha) return json({ erro: e.message }, e.status);
    console.error(e);
    return json({ erro: 'Erro inesperado na nota fiscal. Tente de novo.' }, 500);
  }
});
