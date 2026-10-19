import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, BadgeCheck, CheckCircle2, FileKey2, LoaderCircle, ShieldCheck, Upload } from 'lucide-react';
import { useToast } from '../../../componentes/Toast';
import { supabase } from '../../../lib/supabase';
import { buscarCepIbge, fiscal, mascaraDoc, soDigitos, type ConfigFiscal } from '../../../lib/fiscal';
import { cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, OpcaoChave, PaginaConfig, usePasso, type Passo } from './Layout';

const PASSOS: Passo[] = [
  { id: 'empresa', rotulo: 'Empresa', dica: 'Os dados que vão impressos na nota, iguais ao cadastro na SEFAZ' },
  { id: 'endereco', rotulo: 'Endereço fiscal', dica: 'Endereço da inscrição estadual. O código IBGE vem pelo CEP' },
  { id: 'certificado', rotulo: 'Certificado digital', dica: 'Certificado A1 (arquivo .pfx ou .p12) da empresa' },
  { id: 'nfce', rotulo: 'NFC-e (consumidor)', dica: 'Nota do cupom para o cliente final (pessoa física)' },
  { id: 'nfe', rotulo: 'NF-e (empresas)', dica: 'Nota para empresas e para quem pedir nota completa' },
  { id: 'ambiente', rotulo: 'Ambiente', dica: 'Teste (homologação) ou valendo (produção)' },
];

const CRTS = [
  { v: 1, t: 'Simples Nacional' },
  { v: 4, t: 'MEI' },
  { v: 2, t: 'Simples Nacional (excesso de sublimite)' },
  { v: 3, t: 'Regime normal (Lucro Presumido / Real)' },
];

type Form = Omit<ConfigFiscal, 'restaurante_id' | 'certificado_validade' | 'certificado_titular' | 'empresa_enviada_em'>;

export default function NotaFiscal() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [passo, ir] = usePasso(PASSOS);
  const [estado, setEstado] = useState<{ provedor: boolean; config: ConfigFiscal | null } | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [inicial, setInicial] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);

  async function carregar() {
    const e = await fiscal<{ provedor: boolean; config: ConfigFiscal | null }>('estado', { restaurante_id: r.id }).catch((er) => { toast(er.message, 'erro'); return null; });
    if (!e) return;
    setEstado(e);
    let base: Form;
    if (e.config) {
      const { restaurante_id: _a, certificado_validade: _b, certificado_titular: _c, empresa_enviada_em: _d, ...resto } = e.config;
      base = resto;
    } else {
      // Primeira vez: usa o que já está no cadastro do estabelecimento
      const { data: dd } = await supabase.from('restaurante_dados').select('cnpj, razao_social').eq('restaurante_id', r.id).maybeSingle();
      const end = (r as unknown as { endereco_info?: Record<string, string> | null }).endereco_info ?? {};
      base = {
        ambiente: 'homologacao', crt: 1, cpf_cnpj: dd?.cnpj ?? '', razao_social: dd?.razao_social ?? '', nome_fantasia: r.nome,
        inscricao_estadual: '', inscricao_municipal: '', email: '', fone: r.whatsapp ?? '',
        logradouro: end.rua ?? '', numero: end.numero ?? '', complemento: end.complemento ?? '', bairro: end.bairro ?? '',
        cidade: end.cidade ?? '', codigo_municipio: '', uf: end.uf ?? '', cep: end.cep ?? '',
        csc_id: null, csc: '', nfce_serie: 1, nfce_proximo: 1, nfe_serie: 1, nfe_proximo: 1, pis_cofins_cst: '49',
      };
      if (base.cep && base.cep.length === 8) {
        try { const c = await buscarCepIbge(base.cep); base.codigo_municipio = c.codigo_municipio; base.cidade ||= c.cidade; base.uf ||= c.uf; } catch { /* preenche depois */ }
      }
    }
    setF(base);
    setInicial(JSON.stringify(base));
  }
  useEffect(() => { void carregar(); }, [r.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f || !estado) return <div className="carregando"><div className="spinner" /></div>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const sujo = JSON.stringify(f) !== inicial;
  const cfg = estado.config;

  async function salvar() {
    setSalvando(true);
    try {
      const r2 = await fiscal<{ enviado: boolean }>('salvar', { restaurante_id: r.id, dados: f });
      toast(r2.enviado ? 'Dados salvos e enviados para a SEFAZ (Nuvem Fiscal).' : 'Dados salvos. O envio acontece quando a emissão for ativada na plataforma.', 'ok');
      await carregar();
    } catch (e) { toast((e as Error).message, 'erro'); }
    setSalvando(false);
  }

  async function mudarCep(cep: string) {
    set('cep', soDigitos(cep).slice(0, 8));
    if (soDigitos(cep).length !== 8) return;
    setBuscandoCep(true);
    try {
      const c = await buscarCepIbge(cep);
      setF((x) => (x ? { ...x, codigo_municipio: c.codigo_municipio, cidade: c.cidade, uf: c.uf, logradouro: x.logradouro || c.logradouro, bairro: x.bairro || c.bairro } : x));
    } catch (e) { toast((e as Error).message, 'erro'); }
    setBuscandoCep(false);
  }

  const pronto = {
    empresa: !!(cfg?.cpf_cnpj && cfg.razao_social),
    endereco: !!cfg?.codigo_municipio,
    certificado: !!cfg?.certificado_validade,
    nfce: !!(cfg?.csc_id && cfg.csc),
  };

  return (
    <PaginaConfig titulo="Configurações Nota fiscal" passos={PASSOS} atual={passo} aoPasso={ir} salvar={passo.id === 'certificado' ? undefined : { sujo, salvando, aoSalvar: () => void salvar() }}>
      {!estado.provedor && (
        <p className="nf-aviso"><AlertTriangle size={18} /> <span><b>A emissão ainda não foi ativada na plataforma.</b> Você já pode preencher tudo; os dados são enviados para a SEFAZ assim que a ativação for concluída.</span></p>
      )}
      <ul className="nf-checklist">
        {[['Empresa', pronto.empresa], ['Endereço', pronto.endereco], ['Certificado', pronto.certificado], ['CSC da NFC-e', pronto.nfce], [cfg?.ambiente === 'producao' ? 'Produção' : 'Homologação (teste)', cfg?.ambiente === 'producao']].map(([t, ok]) => (
          <li key={String(t)} className={cx(ok && 'ok')}>{ok ? <CheckCircle2 size={15} /> : <span />} {t}</li>
        ))}
      </ul>

      {passo.id === 'empresa' && (
        <div className="form">
          <div className="cfg-linha">
            <CampoAjuda rotulo="CNPJ" ajuda="Pessoa física sem CNPJ não emite NF-e/NFC-e (só MEI ou empresa). Produtor rural usa o CPF.">
              <input className="input" inputMode="numeric" value={mascaraDoc(f.cpf_cnpj ?? '')} onChange={(e) => set('cpf_cnpj', soDigitos(e.target.value).slice(0, 14))} placeholder="00.000.000/0000-00" />
            </CampoAjuda>
            <CampoAjuda rotulo="Regime tributário (CRT)" ajuda="Confira com o seu contador.">
              <select className="select" value={f.crt} onChange={(e) => set('crt', Number(e.target.value) as Form['crt'])}>
                {CRTS.map((c) => <option key={c.v} value={c.v}>{c.t}</option>)}
              </select>
            </CampoAjuda>
          </div>
          <CampoAjuda rotulo="Razão social"><input className="input" maxLength={120} value={f.razao_social ?? ''} onChange={(e) => set('razao_social', e.target.value)} /></CampoAjuda>
          <CampoAjuda rotulo="Nome fantasia"><input className="input" maxLength={120} value={f.nome_fantasia ?? ''} onChange={(e) => set('nome_fantasia', e.target.value)} /></CampoAjuda>
          <div className="cfg-linha">
            <CampoAjuda rotulo="Inscrição estadual (IE)" ajuda="Obrigatória para emitir. Está no cadastro da SEFAZ do seu estado.">
              <input className="input" inputMode="numeric" value={f.inscricao_estadual ?? ''} onChange={(e) => set('inscricao_estadual', soDigitos(e.target.value).slice(0, 20))} />
            </CampoAjuda>
            <CampoAjuda rotulo="Inscrição municipal (opcional)"><input className="input" inputMode="numeric" value={f.inscricao_municipal ?? ''} onChange={(e) => set('inscricao_municipal', soDigitos(e.target.value).slice(0, 20))} /></CampoAjuda>
          </div>
          <div className="cfg-linha">
            <CampoAjuda rotulo="E-mail fiscal" ajuda="Recebe cópias e avisos das notas."><input className="input" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} /></CampoAjuda>
            <CampoAjuda rotulo="Telefone"><input className="input" inputMode="tel" value={f.fone ?? ''} onChange={(e) => set('fone', soDigitos(e.target.value).slice(0, 11))} /></CampoAjuda>
          </div>
        </div>
      )}

      {passo.id === 'endereco' && (
        <div className="form">
          <div className="cfg-linha">
            <CampoAjuda rotulo="CEP" ajuda={buscandoCep ? <span className="cfg-buscando"><LoaderCircle size={13} className="girando" /> Buscando…</span> : 'Preenche cidade, UF e código IBGE.'}>
              <input className="input" inputMode="numeric" value={(f.cep ?? '').replace(/(\d{5})(\d)/, '$1-$2')} onChange={(e) => void mudarCep(e.target.value)} placeholder="00000-000" />
            </CampoAjuda>
            <CampoAjuda rotulo="Código do município (IBGE)"><input className="input input--leitura" readOnly value={f.codigo_municipio ?? ''} placeholder="Vem pelo CEP" /></CampoAjuda>
          </div>
          <div className="cfg-linha cfg-linha--rua">
            <CampoAjuda rotulo="Rua"><input className="input" maxLength={60} value={f.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} /></CampoAjuda>
            <CampoAjuda rotulo="Número"><input className="input" maxLength={60} value={f.numero ?? ''} onChange={(e) => set('numero', e.target.value)} /></CampoAjuda>
          </div>
          <div className="cfg-linha">
            <CampoAjuda rotulo="Bairro"><input className="input" maxLength={60} value={f.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} /></CampoAjuda>
            <CampoAjuda rotulo="Complemento"><input className="input" maxLength={60} value={f.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} /></CampoAjuda>
          </div>
          <div className="cfg-linha cfg-linha--rua">
            <CampoAjuda rotulo="Cidade"><input className="input input--leitura" readOnly value={f.cidade ?? ''} /></CampoAjuda>
            <CampoAjuda rotulo="UF"><input className="input input--leitura" readOnly value={f.uf ?? ''} /></CampoAjuda>
          </div>
        </div>
      )}

      {passo.id === 'certificado' && <Certificado cfg={cfg} provedor={estado.provedor} restId={r.id} aoEnviar={() => void carregar()} />}

      {passo.id === 'nfce' && (
        <div className="form">
          <p className="nf-dica">O <b>CSC</b> (código de segurança do contribuinte) e o <b>ID do CSC</b> são gerados no site da SEFAZ do seu estado, na área da NFC-e, com o certificado digital. Cada ambiente (homologação e produção) tem o seu.</p>
          <div className="cfg-linha">
            <CampoAjuda rotulo="ID do CSC"><input className="input" inputMode="numeric" value={f.csc_id ?? ''} onChange={(e) => set('csc_id', soDigitos(e.target.value) ? Number(soDigitos(e.target.value).slice(0, 6)) : null)} placeholder="Ex.: 1" /></CampoAjuda>
            <CampoAjuda rotulo="CSC (código)"><input className="input" value={f.csc ?? ''} onChange={(e) => set('csc', e.target.value.trim())} placeholder="Código alfanumérico" autoComplete="off" /></CampoAjuda>
          </div>
          <div className="cfg-linha">
            <CampoAjuda rotulo="Série da NFC-e"><input className="input" inputMode="numeric" value={f.nfce_serie} onChange={(e) => set('nfce_serie', Number(soDigitos(e.target.value)) || 1)} /></CampoAjuda>
            <CampoAjuda rotulo="Próximo número" ajuda="Se já emitia em outro sistema, continue a numeração de onde parou.">
              <input className="input" inputMode="numeric" value={f.nfce_proximo} onChange={(e) => set('nfce_proximo', Number(soDigitos(e.target.value)) || 1)} />
            </CampoAjuda>
          </div>
        </div>
      )}

      {passo.id === 'nfe' && (
        <div className="form">
          <div className="cfg-linha">
            <CampoAjuda rotulo="Série da NF-e"><input className="input" inputMode="numeric" value={f.nfe_serie} onChange={(e) => set('nfe_serie', Number(soDigitos(e.target.value)) || 1)} /></CampoAjuda>
            <CampoAjuda rotulo="Próximo número"><input className="input" inputMode="numeric" value={f.nfe_proximo} onChange={(e) => set('nfe_proximo', Number(soDigitos(e.target.value)) || 1)} /></CampoAjuda>
          </div>
          <CampoAjuda rotulo="CST de PIS/COFINS" ajuda="Simples Nacional normalmente usa 49 (ou 99). Confirme com o seu contador.">
            <select className="select" value={f.pis_cofins_cst} onChange={(e) => set('pis_cofins_cst', e.target.value)}>
              <option value="49">49 – Outras operações de saída (Simples Nacional)</option>
              <option value="99">99 – Outras operações</option>
              <option value="07">07 – Operação isenta</option>
              <option value="04">04 – Monofásica (revenda a alíquota zero)</option>
              <option value="01">01 – Tributável (alíquota básica, Lucro Presumido)</option>
            </select>
          </CampoAjuda>
        </div>
      )}

      {passo.id === 'ambiente' && (
        <div className="form">
          <OpcaoChave
            titulo="Emitir valendo (produção)"
            dica="Desligado = homologação: as notas vão para a SEFAZ de teste, sem valor fiscal. Teste primeiro, depois ligue."
            marcado={f.ambiente === 'producao'}
            aoMudar={(v) => set('ambiente', v ? 'producao' : 'homologacao')}
          />
          {f.ambiente === 'producao' && <p className="nf-aviso nf-aviso--perigo"><AlertTriangle size={18} /> <span>Em produção as notas têm valor fiscal e geram imposto. Cancelamentos só em até 24 horas (NF-e) ou 30 minutos (NFC-e, na maioria dos estados).</span></p>}
        </div>
      )}
    </PaginaConfig>
  );
}

function Certificado({ cfg, provedor, restId, aoEnviar }: { cfg: ConfigFiscal | null; provedor: boolean; restId: string; aoEnviar: () => void }) {
  const toast = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const validade = cfg?.certificado_validade ? new Date(cfg.certificado_validade) : null;
  const dias = validade ? Math.ceil((validade.getTime() - Date.now()) / 86400000) : null;

  async function enviar() {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const buf = new Uint8Array(await arquivo.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const r = await fiscal<{ validade: string; titular: string }>('certificado', { restaurante_id: restId, arquivo: btoa(s), senha });
      toast(`Certificado aceito. Válido até ${new Date(r.validade).toLocaleDateString('pt-BR')}.`, 'ok');
      setArquivo(null); setSenha('');
      aoEnviar();
    } catch (e) { toast((e as Error).message, 'erro'); }
    setEnviando(false);
  }

  return (
    <div className="form">
      {validade && (
        <div className={cx('nf-cert', dias !== null && dias < 30 && 'nf-cert--alerta')}>
          <BadgeCheck size={22} />
          <div>
            <strong>Certificado instalado</strong>
            <small>{cfg?.certificado_titular}</small>
            <small>Válido até {validade.toLocaleDateString('pt-BR')}{dias !== null && (dias < 0 ? ' · VENCIDO' : ` · faltam ${dias} dias`)}</small>
          </div>
        </div>
      )}
      <p className="nf-dica"><ShieldCheck size={16} /> O arquivo vai direto e criptografado para a Nuvem Fiscal (quem assina e transmite as notas). O BasilFiery não guarda o certificado nem a senha.</p>
      {!cfg?.empresa_enviada_em && <p className="nf-aviso"><AlertTriangle size={18} /> <span>Salve primeiro os dados da empresa{provedor ? '' : ' (e aguarde a ativação na plataforma)'}.</span></p>}
      <button type="button" className={cx('nf-upload', arquivo && 'ok')} onClick={() => arquivoRef.current?.click()}>
        {arquivo ? <FileKey2 size={22} /> : <Upload size={22} />}
        <span><b>{arquivo ? arquivo.name : 'Escolher certificado A1'}</b><small>{arquivo ? `${Math.round(arquivo.size / 1024)} KB` : 'Arquivo .pfx ou .p12'}</small></span>
      </button>
      <input ref={arquivoRef} type="file" accept=".pfx,.p12,application/x-pkcs12" className="input-arquivo" onChange={(e) => { setArquivo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
      <CampoAjuda rotulo="Senha do certificado"><input className="input" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="off" /></CampoAjuda>
      <button className="btn btn--primario" disabled={!arquivo || !senha || enviando || !cfg?.empresa_enviada_em} onClick={() => void enviar()}>
        {enviando ? 'Enviando…' : validade ? 'Trocar certificado' : 'Enviar certificado'}
      </button>
    </div>
  );
}
