import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { AtSign, Bike, Check, Copy, ImagePlus, LoaderCircle, MapPin, Phone, Plus, Radius, RefreshCw, Store, Trash2, X } from 'lucide-react';
import { bairroDoPonto, buscarEndereco, type Ponto } from '../../../lib/mapa';
import { AjustarFoto } from '../../../componentes/AjustarFoto';
import { useToast } from '../../../componentes/Toast';
import { IconeForma } from '../../../componentes/Pagamento';
import { useSessao } from '../../../lib/sessao';
import { ACEITA_IMAGEM, enviarImagem, msgErro, supabase } from '../../../lib/supabase';
import type { EnderecoLoja, HorarioDia, RestauranteDados } from '../../../lib/tipos';
import { cx, lerPreco, mascaraPreco, precoParaTexto } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, OpcaoChave, PaginaConfig, mudou, usePasso, type Passo } from './Layout';

const MapaEntrega = lazy(() => import('../../../componentes/MapaEntrega'));
type ModoEntrega = 'fixa' | 'raio' | 'bairro';

const PASSOS: Passo[] = [
  { id: 'informacoes', rotulo: 'Informações', dica: 'Preencha as informações sobre o seu estabelecimento' },
  { id: 'endereco', rotulo: 'Endereço', dica: 'Onde fica a loja. Aparece no cardápio digital e no pedido de retirada' },
  { id: 'horarios', rotulo: 'Horários', dica: 'Dias e horários em que o cardápio digital aceita pedidos' },
  { id: 'tempo', rotulo: 'Tempo de entrega', dica: 'Quanto tempo o pedido leva para chegar na casa do cliente' },
  { id: 'formas', rotulo: 'Formas de entrega', dica: 'Como o cliente pode receber o pedido' },
  { id: 'minimo', rotulo: 'Pedido mínimo', dica: 'Valor mínimo dos itens para pedir pelo cardápio digital' },
  { id: 'taxa', rotulo: 'Taxa de entrega', dica: 'Valor cobrado pela entrega' },
  { id: 'pagamento', rotulo: 'Pagamento na entrega', dica: 'Formas de pagamento que o cliente pode escolher' },
];

export const SEGMENTOS = ['Pizzaria', 'Hamburgueria', 'Restaurante', 'Lanchonete', 'Bar', 'Japonesa', 'Marmitaria', 'Açaí e sorvetes', 'Cafeteria', 'Doceria', 'Padaria', 'Pastelaria', 'Churrascaria', 'Outro'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const HORARIO_PADRAO: HorarioDia = { aberto: true, de: '18:00', ate: '23:00' };
const END_VAZIO: EnderecoLoja = { cep: '', rua: '', numero: '', bairro: '', cidade: '', uf: '', complemento: '' };
const FORMAS = [
  { id: 'pix', rotulo: 'Pix' }, { id: 'dinheiro', rotulo: 'Dinheiro' },
  { id: 'credito', rotulo: 'Cartão de crédito' }, { id: 'debito', rotulo: 'Cartão de débito' },
] as const;

const digitos = (t: string) => t.replace(/\D/g, '');
export const mascaraTelefone = (t: string) => {
  const d = digitos(t).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
};
const mascaraCpf = (t: string) => digitos(t).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
const mascaraCnpj = (t: string) => digitos(t).slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
const mascaraCep = (t: string) => digitos(t).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); return ((s * 10) % 11) % 10; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((t, p, i) => t + p * Number(c[i]), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/** Consulta pública na Receita Federal (BrasilAPI; se cair, cnpj.ws). */
interface DadosReceita { razao: string; fantasia: string; situacao: string; socios: { nome: string; cpf: string }[] }
async function consultarReceita(cnpj: string): Promise<DadosReceita | 'nao-existe'> {
  const r1 = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (r1.ok) {
    const j = await r1.json();
    return {
      razao: j.razao_social ?? '', fantasia: j.nome_fantasia ?? '', situacao: j.descricao_situacao_cadastral ?? '',
      socios: (j.qsa ?? []).map((x: { nome_socio: string; cnpj_cpf_do_socio: string }) => ({ nome: x.nome_socio, cpf: x.cnpj_cpf_do_socio ?? '' })),
    };
  }
  if (r1.status === 404) return 'nao-existe';
  const r2 = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`);
  if (r2.status === 404) return 'nao-existe';
  if (!r2.ok) throw new Error('indisponível');
  const j = await r2.json();
  return {
    razao: j.razao_social ?? '', fantasia: j.estabelecimento?.nome_fantasia ?? '', situacao: j.estabelecimento?.situacao_cadastral ?? '',
    socios: (j.socios ?? []).map((x: { nome: string; cpf_cnpj_socio: string }) => ({ nome: x.nome, cpf: x.cpf_cnpj_socio ?? '' })),
  };
}
/** A Receita mostra o CPF do sócio mascarado (***123456**): confere os 6 do meio. */
const cpfDoSocio = (cpf: string, mascarado: string) => {
  const meio = mascarado.replace(/\D/g, '');
  return meio.length === 6 && cpf.slice(3, 9) === meio;
};

/** "40 a 60 min" → [40, 60] */
function lerTempo(t: string): [string, string] {
  const m = t.match(/(\d+)\D+(\d+)/);
  return m ? [m[1], m[2]] : ['40', '60'];
}

export default function Estabelecimento() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [passo, irPasso] = usePasso(PASSOS);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [tempoDe, tempoAte] = lerTempo(r.delivery_tempo ?? '');

  const inicial = () => ({
    nome: r.nome, segmento: r.segmento ?? '', instagram: r.instagram ?? '', whatsapp: r.whatsapp ?? '', logo_url: r.logo_url,
    end: { ...END_VAZIO, ...(r.endereco_info ?? {}) },
    horarios: Array.from({ length: 7 }, (_, i) => r.horarios?.[i] ?? HORARIO_PADRAO),
    horarios_ativos: r.horarios_ativos ?? false,
    tempoDe, tempoAte,
    entrega_ativa: r.entrega_ativa ?? true, retirada_ativa: r.retirada_ativa ?? true,
    minimo: precoParaTexto(Number(r.delivery_minimo ?? 0)), taxa: precoParaTexto(Number(r.delivery_taxa ?? 0)),
    formas: [...(r.formas_pagamento ?? ['pix', 'dinheiro', 'credito', 'debito'])] as string[],
    modo: (r.entrega_modo ?? 'fixa') as ModoEntrega,
    raios: (r.entrega_raios?.length ? r.entrega_raios : [{ ate_km: 3, taxa: 5 }, { ate_km: 6, taxa: 8 }]).map((x) => ({ km: String(x.ate_km).replace('.', ','), taxa: precoParaTexto(Number(x.taxa)) })),
    bairros: (r.entrega_bairros ?? []).map((x) => ({ nome: x.nome, taxa: precoParaTexto(Number(x.taxa)), lat: x.lat, lng: x.lng })),
    lat: r.lat ?? null as number | null, lng: r.lng ?? null as number | null,
  });
  const [base, setBase] = useState(inicial);
  const [f, setF] = useState(base);
  const dadosVazios = { responsavel_nome: '', responsavel_cpf: '', responsavel_whatsapp: '', cnpj: '', razao_social: '' };
  const [dadosBase, setDadosBase] = useState(dadosVazios);
  const [d, setD] = useState(dadosVazios);
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [receita, setReceita] = useState<{ estado: 'buscando' | 'erro' | 'nao-existe' } | ({ estado: 'ok' } & DadosReceita) | null>(null);

  async function buscarCnpj(c: string) {
    setReceita({ estado: 'buscando' });
    try {
      const r = await consultarReceita(c);
      if (r === 'nao-existe') { setReceita({ estado: 'nao-existe' }); return; }
      setReceita({ estado: 'ok', ...r });
      setD((x) => (x.cnpj === c ? {
        ...x,
        razao_social: r.razao.toUpperCase().slice(0, 120),
        // Responsável vazio: puxa o sócio cujo CPF bate (ou o único sócio)
        responsavel_nome: x.responsavel_nome || (r.socios.find((so) => cpfDoSocio(x.responsavel_cpf, so.cpf)) ?? (r.socios.length === 1 ? r.socios[0] : null))?.nome || '',
      } : x));
    } catch {
      setReceita({ estado: 'erro' });
    }
  }
  function mudarCnpj(valor: string) {
    const c = digitos(valor).slice(0, 14);
    setD((x) => ({ ...x, cnpj: c, razao_social: c === x.cnpj ? x.razao_social : '' }));
    if (c.length === 14 && cnpjValido(c)) void buscarCnpj(c);
    else setReceita(null);
  }
  const socioDoCpf = receita?.estado === 'ok' && d.responsavel_cpf.length === 11 ? receita.socios.find((so) => cpfDoSocio(d.responsavel_cpf, so.cpf)) : undefined;

  useEffect(() => {
    void supabase.from('restaurante_dados').select('*').eq('restaurante_id', r.id).maybeSingle().then(({ data }) => {
      const x = data as RestauranteDados | null;
      const v = {
        responsavel_nome: x?.responsavel_nome ?? '', responsavel_cpf: x?.responsavel_cpf ?? '', responsavel_whatsapp: x?.responsavel_whatsapp ?? '',
        cnpj: x?.cnpj ?? '', razao_social: x?.razao_social ?? '',
      };
      setDadosBase(v);
      setD(v);
    });
  }, [r.id]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const setEnd = (k: keyof EnderecoLoja, v: string) => setF((x) => ({ ...x, end: { ...x.end, [k]: v } }));
  const setHorario = (i: number, h: Partial<HorarioDia>) => setF((x) => ({ ...x, horarios: x.horarios.map((y, n) => (n === i ? { ...y, ...h } : y)) }));
  const sujo = mudou(f, base) || mudou(d, dadosBase);

  async function buscarCep(cep: string) {
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await resp.json();
      if (j.erro) toast('CEP não encontrado. Preencha o endereço à mão.', 'erro');
      else setF((x) => ({ ...x, end: { ...x.end, rua: j.logradouro || x.end.rua, bairro: j.bairro || x.end.bairro, cidade: j.localidade || x.end.cidade, uf: j.uf || x.end.uf } }));
    } catch {
      toast('Não foi possível buscar o CEP agora.', 'erro');
    } finally {
      setBuscandoCep(false);
    }
  }

  const [ajustarLogo, setAjustarLogo] = useState<File | null>(null);
  async function enviarLogo(recorte: Blob) {
    try { set('logo_url', await enviarImagem(r.id, recorte, 'logo')); setAjustarLogo(null); } catch (e) { toast(msgErro(e), 'erro'); }
  }

  async function salvar() {
    const erro = (msg: string, p: string) => { irPasso(p); toast(msg, 'erro'); };
    if (!f.nome.trim()) return erro('Informe o nome do estabelecimento.', 'informacoes');
    if (d.responsavel_cpf && d.responsavel_cpf.length < 11) return erro('CPF incompleto: são 11 números.', 'informacoes');
    if (d.responsavel_cpf && !cpfValido(d.responsavel_cpf)) return erro('CPF do responsável inválido. Confira os números.', 'informacoes');
    if (d.cnpj && d.cnpj.length < 14) return erro('CNPJ incompleto: são 14 números.', 'informacoes');
    if (d.cnpj && !cnpjValido(d.cnpj)) return erro('CNPJ inválido. Confira os números.', 'informacoes');
    if (receita?.estado === 'nao-existe') return erro('Este CNPJ não existe na Receita Federal.', 'informacoes');
    if (d.cnpj && !d.razao_social.trim()) return erro('Aguarde a consulta do CNPJ na Receita Federal (ou toque em “Consultar de novo”).', 'informacoes');
    const de = Number(f.tempoDe), ate = Number(f.tempoAte);
    if (!(de > 0) || !(ate >= de) || ate > 600) return erro('Tempo de entrega inválido. Ex.: de 40 a 60 minutos.', 'tempo');
    if (!f.entrega_ativa && !f.retirada_ativa) return erro('Deixe pelo menos uma forma de entrega ligada.', 'formas');
    const minimo = f.minimo.trim() ? lerPreco(f.minimo) : 0;
    const taxa = f.taxa.trim() ? lerPreco(f.taxa) : 0;
    if (!Number.isFinite(minimo) || minimo < 0) return erro('Pedido mínimo inválido. Ex.: 20,00', 'minimo');
    if (!Number.isFinite(taxa) || taxa < 0) return erro('Taxa de entrega inválida. Ex.: 5,00', 'taxa');
    const raios = f.raios.map((x) => ({ ate_km: Number(x.km.replace(',', '.')), taxa: x.taxa.trim() ? lerPreco(x.taxa) : 0 })).filter((x) => x.ate_km > 0).sort((a, b) => a.ate_km - b.ate_km);
    const bairros = f.bairros.filter((x) => x.nome.trim()).map((x) => ({ nome: x.nome.trim().slice(0, 60), taxa: x.taxa.trim() ? lerPreco(x.taxa) : 0, ...(x.lat != null ? { lat: x.lat, lng: x.lng } : {}) }));
    if (f.modo === 'raio' && (f.lat == null || !raios.length)) return erro('Marque a loja no mapa e cadastre pelo menos uma faixa de distância.', 'taxa');
    if (f.modo === 'raio' && raios.some((x) => !Number.isFinite(x.taxa) || x.taxa < 0 || x.ate_km > 100)) return erro('Confira as faixas: até 100 km e taxa válida.', 'taxa');
    if (f.modo === 'bairro' && !bairros.length) return erro('Cadastre pelo menos um bairro com a taxa.', 'taxa');
    if (f.modo === 'bairro' && bairros.some((x) => !Number.isFinite(x.taxa) || x.taxa < 0)) return erro('Confira a taxa dos bairros.', 'taxa');
    if (!f.formas.length) return erro('Escolha pelo menos uma forma de pagamento.', 'pagamento');
    for (const h of f.horarios) if (h.aberto && (!h.de || !h.ate)) return erro('Preencha os horários dos dias abertos.', 'horarios');

    const e = f.end;
    const temEndereco = e.rua.trim() && e.numero.trim();
    const enderecoTexto = temEndereco
      ? `${e.rua.trim()}, ${e.numero.trim()}${e.complemento.trim() ? ` - ${e.complemento.trim()}` : ''}${e.bairro.trim() ? ` - ${e.bairro.trim()}` : ''}${e.cidade.trim() ? `, ${e.cidade.trim()}${e.uf ? `/${e.uf.toUpperCase()}` : ''}` : ''}`.slice(0, 200)
      : r.endereco;

    setSalvando(true);
    const [r1, r2] = await Promise.all([
      supabase.from('restaurantes').update({
        nome: f.nome.trim(), segmento: f.segmento || null, instagram: f.instagram.trim().replace(/^@/, '') || null,
        whatsapp: digitos(f.whatsapp) || null, logo_url: f.logo_url,
        endereco_info: temEndereco ? { ...e, uf: e.uf.toUpperCase() } : r.endereco_info, endereco: enderecoTexto,
        horarios: f.horarios, horarios_ativos: f.horarios_ativos,
        delivery_tempo: `${de} a ${ate} min`, entrega_ativa: f.entrega_ativa, retirada_ativa: f.retirada_ativa,
        delivery_minimo: minimo, delivery_taxa: taxa, formas_pagamento: f.formas,
        entrega_modo: f.modo, entrega_raios: raios, entrega_bairros: bairros, lat: f.lat, lng: f.lng,
      }).eq('id', r.id),
      mudou(d, dadosBase)
        ? supabase.from('restaurante_dados').upsert({
          restaurante_id: r.id,
          responsavel_nome: d.responsavel_nome.trim() || null, responsavel_cpf: d.responsavel_cpf || null,
          responsavel_whatsapp: digitos(d.responsavel_whatsapp) || null, cnpj: d.cnpj || null,
          razao_social: d.razao_social.trim() || null, atualizado_em: new Date().toISOString(),
        })
        : Promise.resolve({ error: null }),
    ]);
    setSalvando(false);
    const falha = r1.error ?? r2.error;
    if (falha) return toast(msgErro(falha), 'erro');
    toast('Alterações salvas.', 'ok');
    setBase(f);
    setDadosBase(d);
    void s.recarregar();
  }

  return (
    <PaginaConfig
      titulo="Configurações Estabelecimento"
      passos={PASSOS}
      atual={passo}
      aoPasso={irPasso}
      salvar={{ sujo, salvando, aoSalvar: () => void salvar() }}
    >
      {passo.id === 'informacoes' && (
        <div className="cfg-info">
          <div className="form">
            <CampoAjuda rotulo="Nome do estabelecimento *">
              <input className="input" value={f.nome} maxLength={60} onChange={(e) => set('nome', e.target.value)} />
            </CampoAjuda>
            <CampoAjuda rotulo="Segmento">
              <select className="select" value={f.segmento} onChange={(e) => set('segmento', e.target.value)}>
                <option value="">Escolha o segmento</option>
                {SEGMENTOS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </CampoAjuda>
            <CampoAjuda rotulo="Nome do responsável legal">
              <input className="input" value={d.responsavel_nome} maxLength={80} onChange={(e) => setD({ ...d, responsavel_nome: e.target.value })} />
            </CampoAjuda>
            <div className="cfg-linha cfg-linha--estreita">
              <CampoAjuda
                rotulo="CPF do responsável legal"
                ajuda={d.responsavel_cpf.length === 11 ? (cpfValido(d.responsavel_cpf)
                  ? <span className="cfg-ok"><Check size={13} /> {socioDoCpf ? `Sócio na Receita: ${socioDoCpf.nome}` : 'CPF válido'}</span>
                  : <span className="cfg-erro">CPF inválido. Confira os números.</span>) : undefined}
              >
                <input className={cx('input', d.responsavel_cpf.length === 11 && !cpfValido(d.responsavel_cpf) && 'input--erro', d.responsavel_cpf.length === 11 && cpfValido(d.responsavel_cpf) && 'input--ok')} inputMode="numeric" placeholder="000.000.000-00" value={mascaraCpf(d.responsavel_cpf)} onChange={(e) => setD({ ...d, responsavel_cpf: digitos(e.target.value).slice(0, 11) })} />
              </CampoAjuda>
              <CampoAjuda rotulo="WhatsApp do responsável legal" ajuda="Usado pelo suporte do BasilFiery para falar com você.">
                <input className="input" inputMode="tel" placeholder="(00) 00000-0000" value={mascaraTelefone(d.responsavel_whatsapp)} onChange={(e) => setD({ ...d, responsavel_whatsapp: digitos(e.target.value) })} />
              </CampoAjuda>
            </div>
            <div className="cfg-linha cfg-linha--estreita">
              <CampoAjuda
                rotulo="CNPJ"
                ajuda={d.cnpj.length === 14 && !cnpjValido(d.cnpj) ? <span className="cfg-erro">CNPJ inválido. Confira os números.</span>
                  : receita?.estado === 'buscando' ? <span className="cfg-buscando"><LoaderCircle size={13} className="girando" /> Consultando a Receita Federal…</span>
                    : receita?.estado === 'nao-existe' ? <span className="cfg-erro">CNPJ não encontrado na Receita Federal.</span>
                      : receita?.estado === 'erro' ? <span className="cfg-erro">Não deu para consultar agora. <button type="button" className="link-botao" onClick={() => void buscarCnpj(d.cnpj)}>Consultar de novo</button></span>
                        : receita?.estado === 'ok' ? <span className={receita.situacao.toUpperCase() === 'ATIVA' ? 'cfg-ok' : 'cfg-erro'}><Check size={13} /> Situação na Receita: {receita.situacao || '—'}</span>
                          : undefined}
              >
                <input className={cx('input', d.cnpj.length === 14 && !cnpjValido(d.cnpj) && 'input--erro', receita?.estado === 'ok' && 'input--ok')} inputMode="numeric" placeholder="00.000.000/0000-00" value={mascaraCnpj(d.cnpj)} onChange={(e) => mudarCnpj(e.target.value)} />
              </CampoAjuda>
              <CampoAjuda rotulo="Razão social" ajuda="Preenchida automaticamente pela Receita Federal.">
                <input className="input input--leitura" value={d.razao_social} readOnly tabIndex={-1} placeholder="Digite o CNPJ ao lado" />
              </CampoAjuda>
            </div>
            <div className="cfg-linha">
              <CampoAjuda rotulo="Contato da loja" ajuda="WhatsApp que o cliente vê no cardápio digital.">
                <span className="input-icone"><Phone size={17} /><input className="input" inputMode="tel" placeholder="(00) 00000-0000" value={mascaraTelefone(f.whatsapp)} onChange={(e) => set('whatsapp', digitos(e.target.value))} /></span>
              </CampoAjuda>
              <CampoAjuda rotulo="Instagram da sua loja">
                <span className="input-icone"><AtSign size={17} /><input className="input" placeholder="sualoja" maxLength={40} value={f.instagram} onChange={(e) => set('instagram', e.target.value.replace(/\s/g, ''))} /></span>
              </CampoAjuda>
            </div>
          </div>

          <div className="cfg-logo">
            <div className="cfg-logo__foto">
              {f.logo_url ? <img src={f.logo_url} alt="Logo" /> : <span><Store size={40} strokeWidth={1.5} /></span>}
            </div>
            <div className="cfg-logo__acoes">
              <button type="button" className="btn-quadrado" onClick={() => arquivoRef.current?.click()} title={f.logo_url ? 'Trocar logo' : 'Enviar logo'} aria-label="Trocar logo">
                {f.logo_url ? <RefreshCw size={17} /> : <ImagePlus size={17} />}
              </button>
              {f.logo_url && <button type="button" className="btn-quadrado" onClick={() => set('logo_url', null)} title="Remover logo" aria-label="Remover logo"><Trash2 size={17} /></button>}
              <input ref={arquivoRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => { const x = e.target.files?.[0]; if (x) setAjustarLogo(x); e.target.value = ''; }} />
              {ajustarLogo && <AjustarFoto arquivo={ajustarLogo} formato="quadrado" titulo="Ajustar logo" aoConfirmar={enviarLogo} aoCancelar={() => setAjustarLogo(null)} />}
            </div>
            <strong>{f.nome || 'Seu estabelecimento'}</strong>
            <small>{f.segmento || 'Segmento'}</small>
          </div>
        </div>
      )}

      {passo.id === 'endereco' && (
        <div className="form">
          <div className="cfg-linha cfg-linha--cep">
            <CampoAjuda rotulo="CEP" ajuda="Digite o CEP e o endereço se completa sozinho.">
              <span className="input-icone input-icone--fim">
                <input className="input" inputMode="numeric" placeholder="00000-000" value={mascaraCep(f.end.cep)} onChange={(e) => { const c = digitos(e.target.value).slice(0, 8); setEnd('cep', c); void buscarCep(c); }} />
                {buscandoCep && <LoaderCircle size={17} className="girando" />}
              </span>
            </CampoAjuda>
          </div>
          <div className="cfg-linha cfg-linha--rua">
            <CampoAjuda rotulo="Rua"><input className="input" maxLength={120} value={f.end.rua} onChange={(e) => setEnd('rua', e.target.value)} /></CampoAjuda>
            <CampoAjuda rotulo="Número"><input className="input" maxLength={20} value={f.end.numero} onChange={(e) => setEnd('numero', e.target.value)} /></CampoAjuda>
          </div>
          <div className="cfg-linha">
            <CampoAjuda rotulo="Bairro"><input className="input" maxLength={80} value={f.end.bairro} onChange={(e) => setEnd('bairro', e.target.value)} /></CampoAjuda>
            <CampoAjuda rotulo="Complemento"><input className="input" maxLength={80} placeholder="Sala, loja, ponto de referência…" value={f.end.complemento} onChange={(e) => setEnd('complemento', e.target.value)} /></CampoAjuda>
          </div>
          <div className="cfg-linha cfg-linha--rua">
            <CampoAjuda rotulo="Cidade"><input className="input" maxLength={80} value={f.end.cidade} onChange={(e) => setEnd('cidade', e.target.value)} /></CampoAjuda>
            <CampoAjuda rotulo="UF"><input className="input" maxLength={2} value={f.end.uf} onChange={(e) => setEnd('uf', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} /></CampoAjuda>
          </div>
        </div>
      )}

      {passo.id === 'horarios' && (
        <div className="form">
          <OpcaoChave
            titulo="Abrir e fechar sozinho nestes horários"
            dica="Fora do horário o cardápio digital mostra “Fechado” e não aceita pedidos. A chave “Cardápio ativado” continua fechando na hora."
            marcado={f.horarios_ativos}
            aoMudar={(v) => set('horarios_ativos', v)}
          />
          <div className={cx('cfg-horarios', !f.horarios_ativos && 'apagado')}>
            {f.horarios.map((h, i) => (
              <div key={DIAS[i]} className={cx('cfg-horario', !h.aberto && 'fechado')}>
                <label className="switch cfg-horario__dia">
                  <input type="checkbox" checked={h.aberto} onChange={(e) => setHorario(i, { aberto: e.target.checked })} />
                  <span>{DIAS[i]}</span>
                </label>
                {h.aberto ? (
                  <div className="cfg-horario__horas">
                    <input className="input" type="time" value={h.de} onChange={(e) => setHorario(i, { de: e.target.value })} aria-label={`${DIAS[i]}: abre às`} />
                    <span>às</span>
                    <input className="input" type="time" value={h.ate} onChange={(e) => setHorario(i, { ate: e.target.value })} aria-label={`${DIAS[i]}: fecha às`} />
                  </div>
                ) : <span className="cfg-horario__fechado">Fechado</span>}
                <button type="button" className="btn btn--fantasma btn--sm cfg-horario__copiar" title="Usar este horário em todos os dias" onClick={() => set('horarios', f.horarios.map(() => ({ ...h })))}>
                  <Copy size={14} /> <span>Copiar para todos</span>
                </button>
              </div>
            ))}
          </div>
          <p className="cfg-nota">Se fechar depois da meia-noite (ex.: 18:00 às 02:00), o sistema entende que vira o dia.</p>
        </div>
      )}

      {passo.id === 'tempo' && (
        <div className="form">
          <div className="cfg-tempo">
            <CampoAjuda rotulo="De (minutos)"><input className="input" type="number" min={1} max={600} value={f.tempoDe} onChange={(e) => set('tempoDe', e.target.value)} /></CampoAjuda>
            <span>a</span>
            <CampoAjuda rotulo="Até (minutos)"><input className="input" type="number" min={1} max={600} value={f.tempoAte} onChange={(e) => set('tempoAte', e.target.value)} /></CampoAjuda>
          </div>
          <p className="cfg-nota">O cliente vê: <b>{f.tempoDe || '?'} a {f.tempoAte || '?'} min</b></p>
        </div>
      )}

      {passo.id === 'formas' && (
        <div className="form">
          <OpcaoChave titulo="Entrega (delivery)" dica="O pedido vai até a casa do cliente, com a taxa de entrega." marcado={f.entrega_ativa} aoMudar={(v) => set('entrega_ativa', v)} />
          <OpcaoChave titulo="Retirada no balcão" dica="O cliente busca o pedido na loja, sem taxa." marcado={f.retirada_ativa} aoMudar={(v) => set('retirada_ativa', v)} />
        </div>
      )}

      {passo.id === 'minimo' && (
        <div className="form cfg-estreito">
          <CampoAjuda rotulo="Pedido mínimo (R$)" ajuda="Deixe 0,00 para não ter mínimo. A taxa de entrega não entra na conta.">
            <span className="input-icone"><b>R$</b><input className="input" inputMode="decimal" value={f.minimo} onChange={(e) => set('minimo', mascaraPreco(e.target.value))} /></span>
          </CampoAjuda>
        </div>
      )}

      {passo.id === 'taxa' && <TaxaEntrega f={f} setF={setF} enderecoTexto={[f.end.rua, f.end.numero, f.end.bairro, f.end.cidade, f.end.uf].filter(Boolean).join(', ') || r.endereco || ''} />}

      {passo.id === 'pagamento' && (
        <div className="cfg-formas">
          {FORMAS.map((x) => {
            const ligado = f.formas.includes(x.id);
            return (
              <button
                key={x.id}
                type="button"
                className={cx('cfg-forma', ligado && 'ativo')}
                aria-pressed={ligado}
                onClick={() => set('formas', ligado ? f.formas.filter((y) => y !== x.id) : [...f.formas, x.id])}
              >
                <IconeForma forma={x.id} tamanho={20} />
                <span>{x.rotulo}</span>
                <i className="cfg-forma__marca">{ligado && <Check size={14} strokeWidth={3} />}</i>
              </button>
            );
          })}
        </div>
      )}
    </PaginaConfig>
  );
}

/* ---------- Taxa de entrega: fixa, por distância (raio) ou por bairro ---------- */
type FormTaxa = {
  taxa: string; modo: ModoEntrega; lat: number | null; lng: number | null;
  raios: { km: string; taxa: string }[];
  bairros: { nome: string; taxa: string; lat?: number; lng?: number }[];
};

function TaxaEntrega<T extends FormTaxa>({ f, setF, enderecoTexto }: { f: T; setF: (fn: (x: T) => T) => void; enderecoTexto: string }) {
  const toast = useToast();
  const [buscando, setBuscando] = useState(false);
  const mudar = (m: Partial<FormTaxa>) => setF((x) => ({ ...x, ...m }));
  const loja: Ponto | null = f.lat != null && f.lng != null ? { lat: f.lat, lng: f.lng } : null;

  async function acharLoja() {
    if (!enderecoTexto) return toast('Cadastre o endereço da loja no passo 2 (Endereço).', 'erro');
    setBuscando(true);
    const p = await buscarEndereco(enderecoTexto) ?? await buscarEndereco(enderecoTexto.split(',').slice(-3).join(','));
    setBuscando(false);
    if (!p) return toast('Não achei no mapa. Clique no mapa ou arraste o pino até a loja.', 'erro');
    mudar({ lat: p.lat, lng: p.lng });
  }
  // Primeira vez em raio/bairro: tenta achar a loja sozinho
  useEffect(() => {
    if (f.modo !== 'fixa' && f.lat == null && enderecoTexto) void acharLoja();
  }, [f.modo]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cliqueNoMapa(p: Ponto) {
    if (f.lat == null) return mudar({ lat: p.lat, lng: p.lng });
    if (f.modo !== 'bairro') return;
    const nome = await bairroDoPonto(p);
    if (!nome) {
      mudar({ bairros: [...f.bairros, { nome: '', taxa: '', lat: p.lat, lng: p.lng }] });
      toast('O mapa não tem o nome desse bairro. Digite o nome na lista ao lado.', 'info');
      requestAnimationFrame(() => { const l = document.querySelectorAll<HTMLInputElement>('.taxa-linha__nome'); l[l.length - 1]?.focus(); });
      return;
    }
    if (f.bairros.some((b) => b.nome.trim().toLowerCase() === nome.toLowerCase())) return toast(`${nome} já está na lista.`, 'info');
    mudar({ bairros: [...f.bairros, { nome, taxa: '', lat: p.lat, lng: p.lng }] });
    toast(`${nome} adicionado. Coloque a taxa.`, 'ok');
  }

  const raiosNum = f.raios.map((x) => ({ ate_km: Number(x.km.replace(',', '.')) || 0, taxa: x.taxa.trim() ? lerPreco(x.taxa) : 0 }));
  const bairrosNum = f.bairros.map((x) => ({ nome: x.nome || '?', taxa: x.taxa.trim() ? lerPreco(x.taxa) : 0, lat: x.lat, lng: x.lng }));

  return (
    <div className="form taxa">
      <div className="taxa-modos" role="radiogroup" aria-label="Como cobrar a entrega">
        {([
          ['fixa', Bike, 'Taxa fixa', 'O mesmo valor para todo lugar'],
          ['raio', Radius, 'Por distância', 'Faixas em km a partir da loja'],
          ['bairro', MapPin, 'Por bairro', 'Cada bairro com o seu valor'],
        ] as const).map(([id, Icone, titulo, dica]) => (
          <button key={id} type="button" role="radio" aria-checked={f.modo === id} className={cx('taxa-modo', f.modo === id && 'ativo')} onClick={() => mudar({ modo: id })}>
            <Icone size={20} />
            <span><strong>{titulo}</strong><small>{dica}</small></span>
          </button>
        ))}
      </div>

      {f.modo === 'fixa' ? (
        <div className="cfg-estreito">
          <CampoAjuda rotulo="Taxa de entrega (R$)" ajuda="Deixe 0,00 para entrega grátis.">
            <span className="input-icone"><Bike size={17} /><input className="input" inputMode="decimal" value={f.taxa} onChange={(e) => mudar({ taxa: mascaraPreco(e.target.value) })} /></span>
          </CampoAjuda>
        </div>
      ) : (
        <div className="taxa-mapa">
          <div className="taxa-mapa__mapa">
            <div className="taxa-mapa__topo">
              <span>{loja ? <><MapPin size={14} /> Arraste o pino “Loja” se não estiver no lugar certo.</> : 'Clique no mapa onde fica a loja, ou:'}</span>
              <button type="button" className="btn btn--contorno btn--sm" disabled={buscando} onClick={() => void acharLoja()}>{buscando ? <LoaderCircle size={15} className="girando" /> : <MapPin size={15} />} Achar pelo endereço</button>
            </div>
            <Suspense fallback={<div className="mapa-entrega mapa-entrega--carregando"><div className="spinner" /></div>}>
              <MapaEntrega
                loja={loja}
                raios={f.modo === 'raio' ? raiosNum : []}
                bairros={f.modo === 'bairro' ? bairrosNum : []}
                aoMoverLoja={(p) => mudar({ lat: p.lat, lng: p.lng })}
                aoClicar={(p) => void cliqueNoMapa(p)}
              />
            </Suspense>
            {f.modo === 'bairro' && loja && <p className="cfg-nota">Dica: clique no mapa em cima de um bairro para colocá-lo na lista.</p>}
          </div>

          <div className="taxa-lista">
            {f.modo === 'raio' ? (
              <>
                <h3>Faixas de distância</h3>
                {f.raios.map((x, i) => (
                  <div key={i} className="taxa-linha">
                    <span>Até</span>
                    <input className="input taxa-linha__km" inputMode="decimal" value={x.km} onChange={(e) => mudar({ raios: f.raios.map((y, n) => (n === i ? { ...y, km: e.target.value.replace(/[^\d,]/g, '').slice(0, 5) } : y)) })} aria-label="Até quantos km" />
                    <span>km</span>
                    <span className="input-icone taxa-linha__valor"><b>R$</b><input className="input" inputMode="decimal" value={x.taxa} onChange={(e) => mudar({ raios: f.raios.map((y, n) => (n === i ? { ...y, taxa: mascaraPreco(e.target.value) } : y)) })} placeholder="0,00" aria-label="Taxa" /></span>
                    <button type="button" className="icone-btn icone-btn--perigo" onClick={() => mudar({ raios: f.raios.filter((_, n) => n !== i) })} aria-label="Tirar faixa"><X size={16} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn--contorno btn--acento btn--sm" onClick={() => {
                  const ult = Number(f.raios[f.raios.length - 1]?.km.replace(',', '.') || 0);
                  mudar({ raios: [...f.raios, { km: String(ult + 2).replace('.', ','), taxa: '' }] });
                }}><Plus size={15} /> Adicionar faixa</button>
                <p className="cfg-nota">Mais longe que a maior faixa, o cardápio avisa que não entrega. A distância é em linha reta a partir da loja.</p>
              </>
            ) : (
              <>
                <h3>Bairros atendidos <small>{f.bairros.length}</small></h3>
                {f.bairros.length === 0 && <p className="cfg-nota">Clique no mapa ou adicione abaixo.</p>}
                {f.bairros.map((x, i) => (
                  <div key={i} className="taxa-linha">
                    <input className="input taxa-linha__nome" value={x.nome} maxLength={60} onChange={(e) => mudar({ bairros: f.bairros.map((y, n) => (n === i ? { ...y, nome: e.target.value } : y)) })} placeholder="Nome do bairro" />
                    <span className="input-icone taxa-linha__valor"><b>R$</b><input className="input" inputMode="decimal" value={x.taxa} onChange={(e) => mudar({ bairros: f.bairros.map((y, n) => (n === i ? { ...y, taxa: mascaraPreco(e.target.value) } : y)) })} placeholder="0,00" aria-label="Taxa" /></span>
                    <button type="button" className="icone-btn icone-btn--perigo" onClick={() => mudar({ bairros: f.bairros.filter((_, n) => n !== i) })} aria-label="Tirar bairro"><X size={16} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn--contorno btn--acento btn--sm" onClick={() => mudar({ bairros: [...f.bairros, { nome: '', taxa: '' }] })}><Plus size={15} /> Adicionar bairro</button>
                <p className="cfg-nota">No cardápio, o cliente escolhe o bairro numa lista e a taxa entra sozinha.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
