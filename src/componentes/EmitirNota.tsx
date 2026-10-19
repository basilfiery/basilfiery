import { useState } from 'react';
import { Building2, CheckCircle2, FileText, LoaderCircle, Receipt, UserRound } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { abrirArquivo, buscarCepIbge, buscarEmpresaCnpj, fiscal, mascaraDoc, soDigitos } from '../lib/fiscal';
import type { Pedido } from '../lib/tipos';
import { brl, cx } from '../lib/util';

interface Dest {
  cpf_cnpj: string; nome: string; ie: string; ie_isento: boolean; email: string;
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; codigo_municipio: string;
}
const VAZIO: Dest = { cpf_cnpj: '', nome: '', ie: '', ie_isento: false, email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '', codigo_municipio: '' };

/** Emite NFC-e (consumidor, CPF opcional) ou NF-e (empresa/pessoa com endereço) de um pedido. */
export function ModalEmitirNota({ pedido: p, restauranteId, aoFechar, aoEmitir }: { pedido: Pedido; restauranteId: string; aoFechar: () => void; aoEmitir?: () => void }) {
  const toast = useToast();
  const [modelo, setModelo] = useState<65 | 55>(65);
  const [cpf, setCpf] = useState('');
  const [nomeCpf, setNomeCpf] = useState(p.cliente_nome ?? '');
  const [d, setD] = useState<Dest>(VAZIO);
  const [buscando, setBuscando] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [feito, setFeito] = useState<{ id: string; status: string; motivo: string | null; numero?: number } | null>(null);
  const set = <K extends keyof Dest>(k: K, v: Dest[K]) => setD((x) => ({ ...x, [k]: v }));

  async function mudarDoc(v: string) {
    const doc = soDigitos(v).slice(0, 14);
    set('cpf_cnpj', doc);
    if (doc.length !== 14) return;
    setBuscando('cnpj');
    try { const e = await buscarEmpresaCnpj(doc); setD((x) => ({ ...x, ...e, cpf_cnpj: doc })); } catch (er) { toast((er as Error).message, 'erro'); }
    setBuscando('');
  }
  async function mudarCep(v: string) {
    const c = soDigitos(v).slice(0, 8);
    set('cep', c);
    if (c.length !== 8) return;
    setBuscando('cep');
    try { const e = await buscarCepIbge(c); setD((x) => ({ ...x, cidade: e.cidade, uf: e.uf, codigo_municipio: e.codigo_municipio, logradouro: x.logradouro || e.logradouro, bairro: x.bairro || e.bairro })); } catch (er) { toast((er as Error).message, 'erro'); }
    setBuscando('');
  }

  const docOk = modelo === 65 ? (!cpf || cpf.length === 11 || cpf.length === 14) : (d.cpf_cnpj.length === 11 || d.cpf_cnpj.length === 14);
  const endOk = modelo === 65 || (d.nome.trim() && d.logradouro.trim() && d.bairro.trim() && /^\d{7}$/.test(d.codigo_municipio));

  async function emitir() {
    setEnviando(true);
    try {
      const r = await fiscal<{ id: string; status: string; motivo: string | null }>('emitir', {
        restaurante_id: restauranteId, pedido_id: p.id, modelo,
        ...(modelo === 65 ? { cpf: cpf || undefined, nome: nomeCpf || undefined } : { destinatario: d }),
      });
      let res = r;
      // Se ficou processando, consulta de novo algumas vezes
      for (let i = 0; i < 4 && res.status === 'pendente'; i++) {
        await new Promise((ok) => setTimeout(ok, 2500));
        res = await fiscal('consultar', { nota_id: r.id });
      }
      setFeito(res);
      if (res.status === 'autorizado') { toast('Nota autorizada pela SEFAZ.', 'ok'); aoEmitir?.(); }
    } catch (e) { toast((e as Error).message, 'erro'); }
    setEnviando(false);
  }

  async function abrir(formato: 'pdf' | 'xml') {
    if (!feito) return;
    try { abrirArquivo(await fiscal('arquivo', { nota_id: feito.id, formato }), formato === 'xml'); } catch (e) { toast((e as Error).message, 'erro'); }
  }

  if (feito) {
    const ok = feito.status === 'autorizado';
    return (
      <Modal aberto aoFechar={aoFechar} largura={460} titulo={`Pedido #${p.numero}`}>
        <div className="nf-resultado">
          <span className={cx('nf-resultado__icone', !ok && 'nf-resultado__icone--erro')}>{ok ? <CheckCircle2 size={34} /> : <FileText size={30} />}</span>
          <h2>{ok ? `${modelo === 65 ? 'NFC-e' : 'NF-e'} autorizada` : feito.status === 'pendente' ? 'A SEFAZ ainda está processando' : 'A nota não foi autorizada'}</h2>
          {feito.motivo && <p>{feito.motivo}</p>}
          {!ok && feito.status !== 'pendente' && <p className="muted">Corrija o que a SEFAZ apontou e use “Tentar de novo” em Notas fiscais.</p>}
          {ok && (
            <div className="nf-resultado__acoes">
              <button className="btn btn--primario" onClick={() => void abrir('pdf')}><Receipt size={17} /> {modelo === 65 ? 'Imprimir DANFE NFC-e' : 'Abrir DANFE'}</button>
              <button className="btn btn--contorno" onClick={() => void abrir('xml')}>Baixar XML</button>
            </div>
          )}
          <button className="btn btn--fantasma" onClick={aoFechar}>Fechar</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      aberto
      aoFechar={() => !enviando && aoFechar()}
      largura={600}
      titulo={`Emitir nota · Pedido #${p.numero}`}
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar} disabled={enviando}>Cancelar</button>
          <button className="btn btn--primario" disabled={enviando || !docOk || !endOk} onClick={() => void emitir()}>
            {enviando ? <><LoaderCircle size={17} className="girando" /> Enviando para a SEFAZ…</> : `Emitir ${modelo === 65 ? 'NFC-e' : 'NF-e'} · ${brl(Number(p.total))}`}
          </button>
        </>
      }
    >
      <div className="nf-emitir">
        <div className="nf-modelos" role="radiogroup">
          <button type="button" role="radio" aria-checked={modelo === 65} className={cx(modelo === 65 && 'ativo')} onClick={() => setModelo(65)}>
            <UserRound size={20} /><span><b>NFC-e</b><small>Consumidor final · cupom</small></span>
          </button>
          <button type="button" role="radio" aria-checked={modelo === 55} className={cx(modelo === 55 && 'ativo')} onClick={() => setModelo(55)}>
            <Building2 size={20} /><span><b>NF-e</b><small>Empresa (CNPJ) ou pessoa com endereço</small></span>
          </button>
        </div>

        {modelo === 65 ? (
          <div className="form">
            <label className="campo"><span>CPF ou CNPJ na nota (opcional)</span>
              <input className="input" inputMode="numeric" value={mascaraDoc(cpf)} onChange={(e) => setCpf(soDigitos(e.target.value).slice(0, 14))} placeholder="Deixe em branco se o cliente não quiser" />
            </label>
            {cpf && <label className="campo"><span>Nome (opcional)</span><input className="input" maxLength={60} value={nomeCpf} onChange={(e) => setNomeCpf(e.target.value)} /></label>}
          </div>
        ) : (
          <div className="form">
            <div className="cfg-linha">
              <label className="campo"><span>CNPJ ou CPF {buscando === 'cnpj' && <LoaderCircle size={13} className="girando" />}</span>
                <input className="input" inputMode="numeric" value={mascaraDoc(d.cpf_cnpj)} onChange={(e) => void mudarDoc(e.target.value)} placeholder="CNPJ preenche sozinho pela Receita" />
              </label>
              <label className="campo"><span>Inscrição estadual</span>
                <input className="input" inputMode="numeric" value={d.ie} disabled={d.ie_isento} onChange={(e) => set('ie', soDigitos(e.target.value))} placeholder="Se for contribuinte do ICMS" />
              </label>
            </div>
            <label className="nf-check"><input type="checkbox" checked={d.ie_isento} onChange={(e) => setD((x) => ({ ...x, ie_isento: e.target.checked, ie: '' }))} /> Isento de inscrição estadual</label>
            <label className="campo"><span>Nome / razão social</span><input className="input" maxLength={60} value={d.nome} onChange={(e) => set('nome', e.target.value)} /></label>
            <div className="cfg-linha">
              <label className="campo"><span>CEP {buscando === 'cep' && <LoaderCircle size={13} className="girando" />}</span>
                <input className="input" inputMode="numeric" value={d.cep.replace(/(\d{5})(\d)/, '$1-$2')} onChange={(e) => void mudarCep(e.target.value)} />
              </label>
              <label className="campo"><span>Cidade / UF</span><input className="input input--leitura" readOnly value={d.cidade ? `${d.cidade} / ${d.uf}` : ''} placeholder="Vem pelo CEP" /></label>
            </div>
            <div className="cfg-linha cfg-linha--rua">
              <label className="campo"><span>Rua</span><input className="input" maxLength={60} value={d.logradouro} onChange={(e) => set('logradouro', e.target.value)} /></label>
              <label className="campo"><span>Número</span><input className="input" maxLength={20} value={d.numero} onChange={(e) => set('numero', e.target.value)} /></label>
            </div>
            <div className="cfg-linha">
              <label className="campo"><span>Bairro</span><input className="input" maxLength={60} value={d.bairro} onChange={(e) => set('bairro', e.target.value)} /></label>
              <label className="campo"><span>E-mail (recebe o XML)</span><input className="input" type="email" value={d.email} onChange={(e) => set('email', e.target.value)} /></label>
            </div>
          </div>
        )}
        <ul className="nf-itens">
          {p.pedido_itens.map((i) => <li key={i.id}><span>{i.qtd}× {i.nome}</span><b>{brl(i.qtd * Number(i.preco_unit))}</b></li>)}
          {Number(p.taxa_entrega) > 0 && <li><span>Taxa de entrega</span><b>{brl(Number(p.taxa_entrega))}</b></li>}
          {Number(p.desconto) > 0 && <li><span>Desconto</span><b>− {brl(Number(p.desconto))}</b></li>}
        </ul>
      </div>
    </Modal>
  );
}
