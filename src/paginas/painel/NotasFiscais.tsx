import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Ban, CheckCircle2, Download, FileDown, FileText, Inbox, PackagePlus, RefreshCw, RotateCcw, Settings, Sparkles, Wand2,
} from 'lucide-react';
import { Modal } from '../../componentes/Modal';
import { Vazio } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { msgErro, supabase } from '../../lib/supabase';
import {
  MANIFESTACOES, STATUS_NOTA, abrirArquivo, fiscal, mascaraDoc, mascaraNcm, soDigitos, sugerirFiscal,
  type ConfigFiscal, type NotaFiscal, type NotaRecebida,
} from '../../lib/fiscal';
import type { Produto } from '../../lib/tipos';
import { brl, cx, ehGestor, ordenarNome } from '../../lib/util';
import { usePainel } from './Painel';

type Aba = 'emitidas' | 'recebidas' | 'produtos';

export default function NotasFiscais() {
  const { restaurante: r, papel } = usePainel();
  const gestor = ehGestor(papel);
  const [aba, setAba] = useState<Aba>('emitidas');
  const [estado, setEstado] = useState<{ provedor: boolean; config: ConfigFiscal | null } | null>(null);
  useEffect(() => { void fiscal<{ provedor: boolean; config: ConfigFiscal | null }>('estado', { restaurante_id: r.id }).then(setEstado).catch(() => setEstado({ provedor: false, config: null })); }, [r.id]);
  const cfg = estado?.config;
  const falta = !cfg?.empresa_enviada_em ? 'empresa' : !cfg.certificado_validade ? 'certificado' : null;

  return (
    <div className="pagina nf-pag">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Notas fiscais</h1>
          <p>NFC-e e NF-e emitidas pela loja e notas que fornecedores emitiram no seu CNPJ.</p>
        </div>
        {gestor && <Link className="btn btn--contorno" to="/painel/config/nota-fiscal"><Settings size={17} /> Configurar</Link>}
      </div>

      {estado && (falta || !estado.provedor || cfg?.ambiente === 'homologacao') && (
        <div className={cx('nf-faixa', cfg?.ambiente === 'homologacao' && !falta && estado.provedor && 'nf-faixa--teste')}>
          <AlertTriangle size={18} />
          <span>
            {!estado.provedor ? <><b>Emissão ainda não ativada na plataforma.</b> Configure a empresa enquanto isso.</>
              : falta === 'empresa' ? <><b>Falta configurar a empresa.</b> Preencha CNPJ, IE, endereço e regime.</>
                : falta === 'certificado' ? <><b>Falta o certificado digital A1.</b> Sem ele a SEFAZ não aceita as notas.</>
                  : <><b>Modo de teste (homologação).</b> As notas não têm valor fiscal. Quando estiver tudo certo, mude para produção.</>}
          </span>
          {gestor && <Link className="btn btn--sm btn--contorno" to={`/painel/config/nota-fiscal?passo=${falta ?? 'ambiente'}`}>Abrir configuração</Link>}
        </div>
      )}

      <nav className="rl-abas nf-abas" role="tablist">
        <button role="tab" aria-selected={aba === 'emitidas'} className={cx(aba === 'emitidas' && 'ativo')} onClick={() => setAba('emitidas')}><FileText size={16} /> Emitidas</button>
        {gestor && <button role="tab" aria-selected={aba === 'recebidas'} className={cx(aba === 'recebidas' && 'ativo')} onClick={() => setAba('recebidas')}><Inbox size={16} /> Recebidas (entrada)</button>}
        {gestor && <button role="tab" aria-selected={aba === 'produtos'} className={cx(aba === 'produtos' && 'ativo')} onClick={() => setAba('produtos')}><Wand2 size={16} /> Dados fiscais dos produtos</button>}
      </nav>

      {aba === 'emitidas' && <Emitidas restId={r.id} gestor={gestor} />}
      {aba === 'recebidas' && gestor && <Recebidas restId={r.id} />}
      {aba === 'produtos' && gestor && <ProdutosFiscais restId={r.id} crt={cfg?.crt ?? 1} />}
    </div>
  );
}

/* ---------------- Emitidas ---------------- */
function Emitidas({ restId, gestor }: { restId: string; gestor: boolean }) {
  const toast = useToast();
  const [notas, setNotas] = useState<(NotaFiscal & { pedido: { numero: number } | null })[] | null>(null);
  const [cancelando, setCancelando] = useState<NotaFiscal | null>(null);
  const [ocupado, setOcupado] = useState('');

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('notas_fiscais').select('*, pedido:pedidos(numero)').eq('restaurante_id', restId).order('criado_em', { ascending: false }).limit(200);
    if (error) toast(msgErro(error), 'erro');
    setNotas((data ?? []) as never);
  }, [restId, toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function acao(n: NotaFiscal, f: () => Promise<unknown>) {
    setOcupado(n.id);
    try { await f(); } catch (e) { toast((e as Error).message, 'erro'); }
    setOcupado('');
    void carregar();
  }

  const autorizadas = (notas ?? []).filter((n) => n.status === 'autorizado');
  const total = autorizadas.reduce((s, n) => s + Number(n.valor), 0);

  if (!notas) return <div className="carregando"><div className="spinner" /></div>;
  if (!notas.length) return <Vazio icone={<FileText size={34} />} titulo="Nenhuma nota emitida ainda">Abra um pedido (em Pedidos) e use <b>Emitir nota</b>.</Vazio>;
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Notas autorizadas</span><strong>{autorizadas.length}</strong></div>
        <div className="kpi"><span>Valor autorizado</span><strong>{brl(total)}</strong></div>
        <div className={cx('kpi', notas.some((n) => n.status === 'rejeitado' || n.status === 'erro') && 'kpi--perigo')}><span>Com problema</span><strong>{notas.filter((n) => n.status === 'rejeitado' || n.status === 'erro').length}</strong></div>
      </div>
      <div className="tabela-wrap">
        <table className="tabela nf-tabela">
          <thead><tr><th>Nota</th><th>Pedido</th><th>Destinatário</th><th>Situação</th><th className="num">Valor</th><th /></tr></thead>
          <tbody>
            {notas.map((n) => {
              const st = STATUS_NOTA[n.status] ?? { rotulo: n.status, classe: '' };
              return (
                <tr key={n.id}>
                  <td><b>{n.modelo === 65 ? 'NFC-e' : 'NF-e'} {n.numero}</b><small className="muted"> · série {n.serie}{n.ambiente === 'homologacao' ? ' · teste' : ''}</small><br /><small className="muted">{new Date(n.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></td>
                  <td>{n.pedido ? `#${n.pedido.numero}` : '—'}</td>
                  <td>{n.destinatario?.cpf_cnpj ? <>{n.destinatario.nome || 'Consumidor'}<br /><small className="muted">{mascaraDoc(n.destinatario.cpf_cnpj)}</small></> : <span className="muted">Consumidor não identificado</span>}</td>
                  <td><span className={`badge ${st.classe}`}>{st.rotulo}</span>{n.motivo && n.status !== 'autorizado' && <small className="nf-motivo">{n.motivo}</small>}</td>
                  <td className="num"><b>{brl(Number(n.valor))}</b></td>
                  <td className="num">
                    <div className="acoes-linha" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {ocupado === n.id && <span className="spinner" style={{ width: 18, height: 18 }} />}
                      {(n.status === 'autorizado' || n.status === 'cancelado') && (
                        <>
                          <button className="btn btn--contorno btn--sm" title="DANFE (PDF)" onClick={() => void acao(n, async () => abrirArquivo(await fiscal('arquivo', { nota_id: n.id, formato: 'pdf' })))}><FileDown size={15} /> PDF</button>
                          <button className="btn btn--contorno btn--sm" title="XML" onClick={() => void acao(n, async () => abrirArquivo(await fiscal('arquivo', { nota_id: n.id, formato: 'xml' }), true))}><Download size={15} /> XML</button>
                        </>
                      )}
                      {n.status === 'pendente' && <button className="btn btn--contorno btn--sm" onClick={() => void acao(n, () => fiscal('consultar', { nota_id: n.id }))}><RefreshCw size={15} /> Atualizar</button>}
                      {(n.status === 'rejeitado' || n.status === 'erro') && n.pedido_id && (
                        <button className="btn btn--primario btn--sm" onClick={() => void acao(n, () => fiscal('emitir', { restaurante_id: restId, pedido_id: n.pedido_id, modelo: n.modelo, nota_id: n.id }))}><RotateCcw size={15} /> Tentar de novo</button>
                      )}
                      {n.status === 'autorizado' && gestor && <button className="btn btn--perigo btn--sm" onClick={() => setCancelando(n)}><Ban size={15} /> Cancelar</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {cancelando && <ModalCancelarNota nota={cancelando} aoFechar={() => setCancelando(null)} aoCancelar={() => { setCancelando(null); void carregar(); }} />}
    </>
  );
}

function ModalCancelarNota({ nota, aoFechar, aoCancelar }: { nota: NotaFiscal; aoFechar: () => void; aoCancelar: () => void }) {
  const toast = useToast();
  const [just, setJust] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function cancelar() {
    setEnviando(true);
    try { await fiscal('cancelar', { nota_id: nota.id, justificativa: just }); toast('Nota cancelada na SEFAZ.', 'ok'); aoCancelar(); } catch (e) { toast((e as Error).message, 'erro'); }
    setEnviando(false);
  }
  return (
    <Modal aberto aoFechar={aoFechar} largura={480} titulo={`Cancelar ${nota.modelo === 65 ? 'NFC-e' : 'NF-e'} ${nota.numero}`}
      rodape={<><button className="btn btn--contorno" onClick={aoFechar}>Voltar</button><button className="btn btn--perigo-cheio" disabled={just.trim().length < 15 || enviando} onClick={() => void cancelar()}>{enviando ? 'Cancelando…' : 'Cancelar nota'}</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>O cancelamento é enviado para a SEFAZ e não pode ser desfeito. Prazo: até 24 horas para NF-e; para NFC-e, em geral 30 minutos (depende do estado).</p>
      <label className="campo"><span>Justificativa (mínimo 15 letras)</span>
        <textarea className="textarea" rows={3} maxLength={255} value={just} onChange={(e) => setJust(e.target.value)} placeholder="Ex.: Pedido cancelado a pedido do cliente" />
      </label>
    </Modal>
  );
}

/* ---------------- Recebidas (entrada) ---------------- */
interface ItemXml { nome: string; ncm: string; un: string; qtd: number; valorUn: number; total: number }

function lerItensXml(xml: string): ItemXml[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagName('det')].map((det) => {
    const p = det.getElementsByTagName('prod')[0];
    const v = (t: string) => p?.getElementsByTagName(t)[0]?.textContent ?? '';
    return { nome: v('xProd'), ncm: v('NCM'), un: v('uCom'), qtd: Number(v('qCom')) || 0, valorUn: Number(v('vUnCom')) || 0, total: Number(v('vProd')) || 0 };
  });
}

function Recebidas({ restId }: { restId: string }) {
  const toast = useToast();
  const [notas, setNotas] = useState<NotaRecebida[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [ocupado, setOcupado] = useState('');
  const [entrada, setEntrada] = useState<{ nota: NotaRecebida; itens: ItemXml[] } | null>(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('notas_recebidas').select('*').eq('restaurante_id', restId).order('data_emissao', { ascending: false, nullsFirst: false }).limit(300);
    setNotas((data ?? []) as NotaRecebida[]);
  }, [restId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function sincronizar() {
    setBuscando(true);
    try {
      const r = await fiscal<{ novas: number; aviso: string | null }>('sincronizar', { restaurante_id: restId });
      toast(r.aviso ?? (r.novas ? `${r.novas} nota(s) nova(s) encontrada(s).` : 'Nenhuma nota nova na SEFAZ.'), r.aviso ? 'info' : 'ok');
    } catch (e) { toast((e as Error).message, 'erro'); }
    setBuscando(false);
    void carregar();
  }

  async function manifestar(n: NotaRecebida, tipo: string) {
    setOcupado(n.id);
    try { await fiscal('manifestar', { nota_id: n.id, tipo_evento: tipo }); toast(`${MANIFESTACOES[tipo]} registrada na SEFAZ.`, 'ok'); } catch (e) { toast((e as Error).message, 'erro'); }
    setOcupado('');
    void carregar();
  }

  async function abrirEntrada(n: NotaRecebida) {
    setOcupado(n.id);
    try {
      const r = await fiscal<{ xml: string }>('arquivo_recebida', { nota_id: n.id, formato: 'xml' });
      setEntrada({ nota: n, itens: lerItensXml(r.xml) });
    } catch (e) { toast((e as Error).message, 'erro'); }
    setOcupado('');
  }

  return (
    <>
      <div className="nf-recebidas__topo">
        <p className="muted">Notas que fornecedores emitiram no seu CNPJ, direto da SEFAZ. A “ciência” é registrada sozinha para liberar o XML completo.</p>
        <button className="btn btn--primario" disabled={buscando} onClick={() => void sincronizar()}><RefreshCw size={17} className={cx(buscando && 'girando')} /> {buscando ? 'Buscando na SEFAZ…' : 'Buscar notas'}</button>
      </div>
      {!notas ? <div className="carregando"><div className="spinner" /></div> : !notas.length ? (
        <Vazio icone={<Inbox size={34} />} titulo="Nenhuma nota recebida ainda">Toque em <b>Buscar notas</b>. A SEFAZ libera uma nova busca a cada hora.</Vazio>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela nf-tabela">
            <thead><tr><th>Fornecedor</th><th>Emissão</th><th>Manifestação</th><th className="num">Valor</th><th /></tr></thead>
            <tbody>
              {notas.map((n) => (
                <tr key={n.id}>
                  <td><b>{n.emitente_nome ?? 'Fornecedor'}</b><br /><small className="muted">{n.emitente_cnpj ? mascaraDoc(n.emitente_cnpj) : ''} · chave …{n.chave.slice(-8)}</small></td>
                  <td>{n.data_emissao ? new Date(n.data_emissao).toLocaleDateString('pt-BR') : '—'}{n.resumo && <><br /><small className="muted">só resumo</small></>}</td>
                  <td>
                    <select className="select nf-manif" value={n.manifestacao ?? ''} disabled={ocupado === n.id} onChange={(e) => e.target.value && void manifestar(n, e.target.value)}>
                      <option value="">{n.manifestacao ? MANIFESTACOES[n.manifestacao] : 'Sem manifestação'}</option>
                      {Object.entries(MANIFESTACOES).filter(([k]) => k !== n.manifestacao).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                  <td className="num"><b>{n.valor != null ? brl(Number(n.valor)) : '—'}</b></td>
                  <td className="num">
                    <div className="acoes-linha" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {ocupado === n.id && <span className="spinner" style={{ width: 18, height: 18 }} />}
                      {!n.resumo && <button className="btn btn--contorno btn--sm" onClick={() => void fiscal('arquivo_recebida', { nota_id: n.id, formato: 'pdf' }).then((a) => abrirArquivo(a as never)).catch((e) => toast(e.message, 'erro'))}><FileDown size={15} /> DANFE</button>}
                      {n.entrada_em
                        ? <span className="badge badge--verde"><CheckCircle2 size={13} /> Entrada feita</span>
                        : <button className="btn btn--primario btn--sm" disabled={n.resumo} title={n.resumo ? 'Aguarde a SEFAZ liberar a nota completa' : undefined} onClick={() => void abrirEntrada(n)}><PackagePlus size={15} /> Dar entrada</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entrada && <ModalEntrada restId={restId} nota={entrada.nota} itens={entrada.itens} aoFechar={() => setEntrada(null)} aoConcluir={() => { setEntrada(null); void carregar(); }} />}
    </>
  );
}

function ModalEntrada({ restId, nota, itens, aoFechar, aoConcluir }: { restId: string; nota: NotaRecebida; itens: ItemXml[]; aoFechar: () => void; aoConcluir: () => void }) {
  const toast = useToast();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [ligacoes, setLigacoes] = useState<{ produto_id: string; qtd: number; custo: boolean }[]>(() => itens.map((i) => ({ produto_id: '', qtd: Math.round(i.qtd), custo: false })));
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    void supabase.from('produtos').select('*').eq('restaurante_id', restId).then(({ data }) => {
      const lista = ((data ?? []) as Produto[]).sort(ordenarNome);
      setProdutos(lista);
      // Liga sozinho quando o nome da nota parece com o do produto
      const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      setLigacoes((l) => l.map((x, i) => {
        if (x.produto_id) return x;
        const nome = norm(itens[i].nome);
        const achado = lista.find((p) => nome.includes(norm(p.nome)) || norm(p.nome).includes(nome.slice(0, 14)));
        return achado ? { ...x, produto_id: achado.id } : x;
      }));
    });
  }, [restId, itens]);

  async function salvar() {
    setSalvando(true);
    const { data, error } = await supabase.rpc('nota_recebida_entrada', {
      p_nota: nota.id,
      p_itens: ligacoes.map((l, i) => ({ produto_id: l.produto_id || null, qtd: l.qtd, custo: l.custo && l.qtd > 0 ? itens[i].total / l.qtd : null })),
    });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(`Entrada feita em ${data} produto(s).`, 'ok');
    aoConcluir();
  }

  return (
    <Modal aberto aoFechar={aoFechar} largura={820} titulo={`Dar entrada · ${nota.emitente_nome ?? 'Nota'}`}
      rodape={<><button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button><button className="btn btn--primario" disabled={salvando || !ligacoes.some((l) => l.produto_id)} onClick={() => void salvar()}>{salvando ? 'Salvando…' : 'Dar entrada no estoque'}</button></>}>
      <p className="muted" style={{ marginTop: 0 }}>Ligue cada item da nota a um produto do seu estoque. Itens sem produto (ex.: insumos que você não controla) são ignorados. Marque “usar como custo” para atualizar o custo do produto com o valor da nota.</p>
      <div className="tabela-wrap">
        <table className="tabela nf-entrada">
          <thead><tr><th>Item da nota</th><th className="num">Qtd. na nota</th><th>Produto no estoque</th><th className="num">Entrar</th><th>Custo</th></tr></thead>
          <tbody>
            {itens.map((i, n) => (
              <tr key={n}>
                <td><b>{i.nome}</b><br /><small className="muted">NCM {mascaraNcm(i.ncm)} · {brl(i.valorUn)}/{i.un}</small></td>
                <td className="num">{i.qtd} {i.un}</td>
                <td>
                  <select className="select" value={ligacoes[n].produto_id} onChange={(e) => setLigacoes((l) => l.map((x, j) => (j === n ? { ...x, produto_id: e.target.value } : x)))}>
                    <option value="">Ignorar este item</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </td>
                <td className="num"><input className="input nf-qtd" inputMode="numeric" value={ligacoes[n].qtd} onChange={(e) => setLigacoes((l) => l.map((x, j) => (j === n ? { ...x, qtd: Number(soDigitos(e.target.value)) || 0 } : x)))} /></td>
                <td><label className="nf-check"><input type="checkbox" checked={ligacoes[n].custo} disabled={!ligacoes[n].produto_id} onChange={(e) => setLigacoes((l) => l.map((x, j) => (j === n ? { ...x, custo: e.target.checked } : x)))} /> usar como custo</label></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/* ---------------- Dados fiscais dos produtos ---------------- */
function ProdutosFiscais({ restId, crt }: { restId: string; crt: number }) {
  const toast = useToast();
  const [produtos, setProdutos] = useState<(Produto & { ncm?: string | null; cfop?: string | null; csosn?: string | null; unidade_fiscal?: string | null })[] | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [mudados, setMudados] = useState<Set<string>>(new Set());
  useEffect(() => {
    void supabase.from('produtos').select('*').eq('restaurante_id', restId).then(({ data }) => setProdutos(((data ?? []) as never[] as Produto[]).sort(ordenarNome) as never));
  }, [restId]);
  const simples = crt !== 3;
  const sem = useMemo(() => (produtos ?? []).filter((p) => !p.ncm).length, [produtos]);

  const mudar = (id: string, campo: 'ncm' | 'cfop' | 'csosn' | 'unidade_fiscal', valor: string) => {
    setProdutos((l) => l!.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)));
    setMudados((s) => new Set(s).add(id));
  };
  function sugerirTodos() {
    setProdutos((l) => l!.map((p) => {
      if (p.ncm) return p;
      const s = sugerirFiscal(p.nome);
      setMudados((m) => new Set(m).add(p.id));
      return { ...p, ncm: s.ncm, csosn: simples ? s.csosn : (s.csosn === '500' ? '60' : '00'), cfop: s.cfop, unidade_fiscal: p.unidade_fiscal || 'UN' };
    }));
  }
  async function salvar() {
    setSalvando(true);
    const erros: string[] = [];
    for (const p of (produtos ?? []).filter((x) => mudados.has(x.id))) {
      const ncm = soDigitos(p.ncm);
      if (ncm && ncm.length !== 8) { erros.push(`${p.nome}: NCM precisa de 8 números`); continue; }
      const { error } = await supabase.from('produtos').update({
        ncm: ncm || null, cfop: soDigitos(p.cfop) || null, csosn: soDigitos(p.csosn) || null, unidade_fiscal: (p.unidade_fiscal ?? '').trim().toUpperCase() || null,
      }).eq('id', p.id);
      if (error) erros.push(`${p.nome}: ${msgErro(error)}`);
    }
    setSalvando(false);
    if (erros.length) return toast(erros.slice(0, 3).join(' · '), 'erro');
    setMudados(new Set());
    toast('Dados fiscais salvos.', 'ok');
  }

  if (!produtos) return <div className="carregando"><div className="spinner" /></div>;
  return (
    <>
      <div className="nf-recebidas__topo">
        <p className="muted">Cada produto precisa de <b>NCM</b>, <b>CFOP</b> e <b>{simples ? 'CSOSN' : 'CST do ICMS'}</b>. A sugestão automática é um ponto de partida: confirme com o seu contador. {sem > 0 && <b className="texto-perigo">{sem} sem NCM.</b>}</p>
        <div className="acoes-linha">
          <button className="btn btn--contorno" onClick={sugerirTodos} disabled={!sem}><Sparkles size={16} /> Sugerir para os {sem} sem NCM</button>
          <button className="btn btn--primario" disabled={!mudados.size || salvando} onClick={() => void salvar()}>{salvando ? 'Salvando…' : `Salvar${mudados.size ? ` (${mudados.size})` : ''}`}</button>
        </div>
      </div>
      <div className="tabela-wrap">
        <table className="tabela nf-produtos">
          <thead><tr><th>Produto</th><th>NCM</th><th>CFOP</th><th>{simples ? 'CSOSN' : 'CST ICMS'}</th><th>Unid.</th></tr></thead>
          <tbody>
            {produtos.map((p) => (
              <tr key={p.id} className={cx(mudados.has(p.id) && 'mudado')}>
                <td><b>{p.emoji} {p.nome}</b>{!p.ncm && <small className="nf-motivo">sugestão: {sugerirFiscal(p.nome).rotulo}</small>}</td>
                <td><input className="input" inputMode="numeric" value={mascaraNcm(p.ncm ?? '')} onChange={(e) => mudar(p.id, 'ncm', soDigitos(e.target.value).slice(0, 8))} placeholder="0000.00.00" /></td>
                <td>
                  <select className="select" value={p.cfop ?? ''} onChange={(e) => mudar(p.id, 'cfop', e.target.value)}>
                    <option value="">Automático</option>
                    <option value="5102">5102 – Venda (tributado)</option>
                    <option value="5405">5405 – Venda com ICMS-ST</option>
                    <option value="5101">5101 – Venda de produção própria</option>
                  </select>
                </td>
                <td>
                  <select className="select" value={p.csosn ?? ''} onChange={(e) => mudar(p.id, 'csosn', e.target.value)}>
                    <option value="">Padrão ({simples ? '102' : '00'})</option>
                    {simples ? (
                      <>
                        <option value="102">102 – Sem crédito (normal)</option>
                        <option value="500">500 – ICMS por substituição (bebidas)</option>
                        <option value="103">103 – Isento (faixa de receita)</option>
                        <option value="300">300 – Imune</option>
                        <option value="400">400 – Não tributado</option>
                      </>
                    ) : (
                      <>
                        <option value="00">00 – Tributado integralmente</option>
                        <option value="60">60 – ICMS cobrado por substituição</option>
                        <option value="40">40 – Isento</option>
                        <option value="41">41 – Não tributado</option>
                      </>
                    )}
                  </select>
                </td>
                <td><input className="input nf-un" value={p.unidade_fiscal ?? ''} onChange={(e) => mudar(p.id, 'unidade_fiscal', e.target.value.toUpperCase().slice(0, 6))} placeholder="UN" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
