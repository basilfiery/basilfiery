import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CircleAlert, CircleCheck, ImagePlus, MoreVertical, Pencil, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { AjustarFoto } from '../../../componentes/AjustarFoto';
import { Campo, Stepper, Switch } from '../../../componentes/Basicos';
import { confirmar } from '../../../componentes/Confirmar';
import { Modal } from '../../../componentes/Modal';
import { Suspenso } from '../../../componentes/Suspenso';
import { useToast } from '../../../componentes/Toast';
import {
  EVENTO_CONFIG_IMPRESSAO, MODELOS, gravarConfigImpressao, imprimirTeste, lerConfigImpressao, modeloDe, novaImpressora, prepararLogo,
  previaModelo, programaDesktop, type ConfigImpressaoLoja, type ImpressoraLocal, type ModeloId, type ModeloImpressao,
} from '../../../lib/impressao';
import { useSessao } from '../../../lib/sessao';
import { enviarImagem, msgErro, supabase } from '../../../lib/supabase';
import { cx, ehGestor } from '../../../lib/util';
import { usePainel } from '../Painel';
import { mascaraTelefone } from './Estabelecimento';
import { origemSistema } from '../../../lib/linkCurto';
import { OpcaoChave, PaginaConfig, usePasso, type Passo } from './Layout';

const PASSOS: Passo[] = [
  { id: 'impressoras', rotulo: 'Lista de impressoras', dica: 'As impressoras deste computador e o que cada uma imprime' },
  { id: 'modelos', rotulo: 'Modelos de impressão', dica: 'Como sai cada cupom: logo, CNPJ, mensagens e vias' },
  { id: 'direto', rotulo: 'Imprimir direto', dica: 'Sem a janela de confirmação do navegador' },
];
const nomeModelo = (id: ModeloId) => MODELOS.find((m) => m.id === id)?.nome ?? id;
const mascaraCnpj = (t: string) => t.replace(/\D/g, '').slice(0, 14).replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');

/** Impressoras do Windows (só no programa) — para saber se está conectada. */
function useImpressorasSistema() {
  const desktop = programaDesktop();
  const [lista, setLista] = useState<{ nome: string; padrao: boolean }[] | null>(null);
  useEffect(() => { if (desktop) void desktop.impressoras().then(setLista).catch(() => setLista([])); }, [desktop]);
  return { desktop, lista };
}

export default function PaginaImpressora() {
  const [passo, ir] = usePasso(PASSOS);
  const [editando, setEditando] = useState<ModeloId | null>(null);
  if (editando) return <EditorModelo id={editando} aoVoltar={() => setEditando(null)} />;
  return (
    <PaginaConfig titulo="Impressora" passos={PASSOS} atual={passo} aoPasso={ir}>
      {passo.id === 'impressoras' && <ListaImpressoras />}
      {passo.id === 'modelos' && <ListaModelos aoEditar={setEditando} />}
      {passo.id === 'direto' && <ImprimirDireto />}
    </PaginaConfig>
  );
}

/* ---------- 1. Lista de impressoras (deste computador) ---------- */
function ListaImpressoras() {
  const { restaurante } = usePainel();
  const [cfg, setCfg] = useState(lerConfigImpressao());
  const [editar, setEditar] = useState<ImpressoraLocal | 'nova' | null>(null);
  const { desktop, lista } = useImpressorasSistema();
  useEffect(() => {
    const atualizar = () => setCfg(lerConfigImpressao());
    window.addEventListener(EVENTO_CONFIG_IMPRESSAO, atualizar);
    return () => window.removeEventListener(EVENTO_CONFIG_IMPRESSAO, atualizar);
  }, []);
  const salvar = (impressoras: ImpressoraLocal[], auto = cfg.auto) => gravarConfigImpressao({ auto, impressoras });

  const conectada = (i: ImpressoraLocal) => {
    if (!desktop) return null;
    if (!lista) return undefined;
    return i.impressora ? lista.some((x) => x.nome === i.impressora) : lista.length > 0;
  };

  async function excluir(i: ImpressoraLocal) {
    if (cfg.impressoras.length === 1) return;
    if (!(await confirmar(`Tirar a impressora "${i.nome}" deste computador?`, { sim: 'Tirar', perigo: true }))) return;
    salvar(cfg.impressoras.filter((x) => x.id !== i.id));
  }

  return (
    <div className="imp">
      <OpcaoChave
        titulo="Imprimir pedidos novos automaticamente"
        dica="Ligue só no computador que fica com a impressora. Cada pedido sai uma vez só, mesmo com outros computadores abertos."
        marcado={cfg.auto}
        aoMudar={(v) => salvar(cfg.impressoras, v)}
      />
      {cfg.impressoras.map((i) => {
        const c = conectada(i);
        return (
          <div key={i.id} className="imp-cartao">
            <div className="imp-cartao__topo">
              <div className="imp-cartao__nome">
                <small>Impressora</small>
                <strong>{i.nome}</strong>
                <span>{desktop ? (i.impressora || 'Impressora padrão do Windows') : 'Pela janela de impressão do navegador'} · papel {i.largura} mm</span>
              </div>
              <div className="imp-cartao__acoes">
                {c === true && <span className="imp-selo imp-selo--ok"><CircleCheck size={13} /> Conectada</span>}
                {c === false && <span className="imp-selo imp-selo--erro"><CircleAlert size={13} /> Não encontrada</span>}
                <button className="btn btn--contorno btn--sm" onClick={() => imprimirTeste(restaurante.nome, i)}><Printer size={15} /> Testar</button>
                <Suspenso largura={200} gatilho={(_, alternar) => <button className="icone-btn" onClick={alternar} aria-label={`Opções de ${i.nome}`}><MoreVertical size={18} /></button>}>
                  {(fechar) => (
                    <>
                      <button className="menu-item" onClick={() => { fechar(); setEditar(i); }}><Pencil size={17} /> Editar</button>
                      {cfg.impressoras.length > 1 && <button className="menu-item menu-item--perigo" onClick={() => { fechar(); void excluir(i); }}><Trash2 size={17} /> Tirar</button>}
                    </>
                  )}
                </Suspenso>
              </div>
            </div>
            <div className="imp-cartao__modelos">
              <small>Modelos vinculados</small>
              <span>{i.modelos.length ? i.modelos.map(nomeModelo).join(', ') : 'Nenhum — esta impressora não imprime nada sozinha'}</span>
            </div>
          </div>
        );
      })}
      <div className="imp-adicionar">
        <span>Tem outra impressora (ex.: na cozinha)?</span>
        <button className="btn btn--contorno btn--acento" onClick={() => setEditar('nova')}><Plus size={17} /> Adicionar impressora</button>
      </div>
      {!desktop && <p className="cfg-nota">No navegador todas usam a impressora escolhida na janela de impressão. Para mandar cada cupom para uma impressora diferente, use o programa BasilFiery para Windows.</p>}
      {editar && (
        <ModalImpressora
          impressora={editar === 'nova' ? null : editar}
          sistema={lista}
          aoFechar={() => setEditar(null)}
          aoSalvar={(nova) => {
            salvar(editar === 'nova' ? [...cfg.impressoras, nova] : cfg.impressoras.map((x) => (x.id === nova.id ? nova : x)));
            setEditar(null);
          }}
        />
      )}
    </div>
  );
}

function ModalImpressora({ impressora, sistema, aoFechar, aoSalvar }: {
  impressora: ImpressoraLocal | null;
  sistema: { nome: string; padrao: boolean }[] | null;
  aoFechar: () => void;
  aoSalvar: (i: ImpressoraLocal) => void;
}) {
  const [f, setF] = useState<ImpressoraLocal>(impressora ?? novaImpressora({ nome: 'Cozinha', modelos: ['cozinha'] }));
  const desktop = programaDesktop();
  const alternar = (m: ModeloId) => setF((x) => ({ ...x, modelos: x.modelos.includes(m) ? x.modelos.filter((y) => y !== m) : [...x.modelos, m] }));
  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={impressora ? 'Editar impressora' : 'Adicionar impressora'}
      largura={520}
      rodape={<><button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button><button className="btn btn--primario" disabled={!f.nome.trim()} onClick={() => aoSalvar({ ...f, nome: f.nome.trim() })}>Salvar</button></>}
    >
      <div className="form">
        <Campo rotulo="Nome da impressora" dica="Só para você saber qual é. Ex.: Caixa, Cozinha, Bar.">
          <input className="input" value={f.nome} maxLength={30} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus />
        </Campo>
        {desktop && (
          <Campo rotulo="Impressora do Windows">
            <select className="select" value={f.impressora} onChange={(e) => setF({ ...f, impressora: e.target.value })}>
              <option value="">Padrão do Windows</option>
              {(sistema ?? []).map((p) => <option key={p.nome} value={p.nome}>{p.nome}{p.padrao ? ' (padrão)' : ''}</option>)}
            </select>
          </Campo>
        )}
        <Campo rotulo="Largura do papel">
          <div className="segmentado">
            {([80, 58] as const).map((l) => <button key={l} type="button" className={cx(f.largura === l && 'ativo')} onClick={() => setF({ ...f, largura: l })}>{l} mm</button>)}
          </div>
        </Campo>
        <div className="campo">
          <span>O que esta impressora imprime</span>
          <div className="imp-modelos-escolha">
            {MODELOS.map((m) => (
              <label key={m.id} className={cx('imp-modelo-check', f.modelos.includes(m.id) && 'ativo')}>
                <input type="checkbox" checked={f.modelos.includes(m.id)} onChange={() => alternar(m.id)} />
                <span><strong>{m.nome}</strong><small>{m.descricao}</small></span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- 2. Modelos de impressão ---------- */
function ListaModelos({ aoEditar }: { aoEditar: (id: ModeloId) => void }) {
  const { restaurante, papel } = usePainel();
  const cfg = lerConfigImpressao();
  const gestor = ehGestor(papel);
  return (
    <div className="imp-modelos">
      {MODELOS.map((m) => {
        const ligadas = cfg.impressoras.filter((i) => i.modelos.includes(m.id));
        return (
          <div key={m.id} className="imp-modelo">
            <div className="imp-modelo__topo">
              <strong>{m.nome}</strong>
              {gestor && <button className="icone-btn" onClick={() => aoEditar(m.id)} aria-label={`Editar ${m.nome}`} title="Editar modelo"><Pencil size={17} /></button>}
            </div>
            <p>{m.descricao}</p>
            <div className="imp-modelo__base">
              <div>
                <small>Impressoras vinculadas</small>
                <div className="imp-modelo__chips">
                  {ligadas.length ? ligadas.map((i) => <span key={i.id} className="imp-selo imp-selo--ok"><CircleCheck size={12} /> {i.nome}</span>)
                    : <span className="imp-selo">Modelo não vinculado</span>}
                </div>
              </div>
              <button className="btn btn--contorno btn--sm" onClick={() => imprimirTeste(restaurante.nome, ligadas[0], m.id)}><Printer size={15} /> Testar</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditorModelo({ id, aoVoltar }: { id: ModeloId; aoVoltar: () => void }) {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const base: ConfigImpressaoLoja = r.impressao ?? {};
  const [loja, setLoja] = useState({ logo_url: base.logo_url ?? null, cnpj: base.cnpj ?? '', telefone: base.telefone ?? r.whatsapp ?? '' });
  const [m, setM] = useState<ModeloImpressao>(() => modeloDe(id, base));
  const [cfgLocal, setCfgLocal] = useState(lerConfigImpressao());
  const [salvando, setSalvando] = useState(false);
  const [ajustarLogo, setAjustarLogo] = useState<File | null>(null);
  const [, setLogoPronto] = useState(0);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const info = MODELOS.find((x) => x.id === id)!;
  const set = <K extends keyof ModeloImpressao>(k: K, v: ModeloImpressao[K]) => setM((x) => ({ ...x, [k]: v }));
  const logoUsada = loja.logo_url ?? r.logo_url;

  // CNPJ cadastrado em Estabelecimento entra sozinho
  useEffect(() => {
    if (loja.cnpj) return;
    void supabase.from('restaurante_dados').select('cnpj').eq('restaurante_id', r.id).maybeSingle().then(({ data }) => {
      const c = (data as { cnpj: string | null } | null)?.cnpj;
      if (c) setLoja((x) => ({ ...x, cnpj: x.cnpj || mascaraCnpj(c) }));
    });
  }, [r.id, loja.cnpj]);
  useEffect(() => { if (logoUsada) void prepararLogo(logoUsada).then(() => setLogoPronto((n) => n + 1)); }, [logoUsada]);

  const largura = cfgLocal.impressoras.find((i) => i.modelos.includes(id))?.largura ?? cfgLocal.impressoras[0]?.largura ?? 80;
  const cfgPrevia: ConfigImpressaoLoja = { ...base, logo_url: loja.logo_url, cnpj: loja.cnpj || null, telefone: loja.telefone ? mascaraTelefone(loja.telefone) : null };
  const html = useMemo(() => previaModelo(id, m, cfgPrevia, r.nome, r.logo_url, largura), [id, m, JSON.stringify(cfgPrevia), r.nome, r.logo_url, largura]); // eslint-disable-line react-hooks/exhaustive-deps

  const ligar = (imp: ImpressoraLocal, v: boolean) => setCfgLocal((c) => ({
    ...c, impressoras: c.impressoras.map((x) => (x.id === imp.id ? { ...x, modelos: v ? [...new Set([...x.modelos, id])] : x.modelos.filter((y) => y !== id) } : x)),
  }));

  async function enviarLogo(recorte: Blob) {
    try {
      const url = await enviarImagem(r.id, recorte, 'impressao');
      setLoja((x) => ({ ...x, logo_url: url }));
      set('logo', true);
      setAjustarLogo(null);
    } catch (e) { toast(msgErro(e), 'erro'); }
  }

  async function salvar() {
    setSalvando(true);
    const nova: ConfigImpressaoLoja = {
      ...base,
      logo_url: loja.logo_url,
      cnpj: loja.cnpj.trim() || null,
      telefone: loja.telefone ? mascaraTelefone(loja.telefone) : null,
      modelos: { ...(base.modelos ?? {}), [id]: { ...m, vias: Math.max(1, Math.min(5, m.vias)), mensagem: m.mensagem.slice(0, 200), rodape: m.rodape.slice(0, 300), site: m.site.slice(0, 80) } },
    };
    const { error } = await supabase.from('restaurantes').update({ impressao: nova }).eq('id', r.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    gravarConfigImpressao({ auto: cfgLocal.auto, impressoras: cfgLocal.impressoras });
    toast('Modelo salvo.', 'ok');
    await s.recarregar();
    aoVoltar();
  }

  return (
    <PaginaConfig titulo={`Modelo: ${info.nome}`} salvar={{ sujo: true, salvando, aoSalvar: () => void salvar(), rotulo: 'Salvar alterações' }}>
      <button className="btn btn--fantasma btn--sm imp-voltar" onClick={aoVoltar}><ArrowLeft size={16} /> Voltar aos modelos</button>
      <div className="imp-editor">
        <div className="imp-editor__form">
          <section className="imp-bloco">
            <div className="imp-bloco__linha">
              <Campo rotulo="Modelo"><div className="input input--leitura">{info.nome}</div></Campo>
              <Campo rotulo="Número de vias" dica="Quantas cópias saem de cada vez">
                <Stepper valor={m.vias} min={1} max={5} aoMudar={(v) => set('vias', v)} />
              </Campo>
            </div>
            <div className="campo">
              <span>Impressoras deste computador</span>
              <div className="imp-ligar">
                {cfgLocal.impressoras.map((i) => (
                  <div key={i.id} className="imp-ligar__item">
                    <Switch marcado={i.modelos.includes(id)} aoMudar={(v) => ligar(i, v)}>
                      <span><strong>{i.nome}</strong><small>{i.impressora || 'Padrão'} · {i.largura} mm</small></span>
                    </Switch>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="imp-bloco">
            <h3>Cabeçalho</h3>
            <label className="imp-check"><input type="checkbox" checked={m.cabecalho} onChange={(e) => set('cabecalho', e.target.checked)} /> Exibir cabeçalho</label>
            {m.cabecalho && (
              <div className="imp-cab">
                <Campo rotulo="Mensagem personalizada do cabeçalho">
                  <input className="input" value={m.mensagem} maxLength={200} onChange={(e) => set('mensagem', e.target.value)} placeholder="Ex.: Delivery até 23h · peça pelo nosso cardápio digital" />
                </Campo>
                <div className="imp-cab__grade">
                  <div className="imp-logo">
                    <label className="imp-check"><input type="checkbox" checked={m.logo} onChange={(e) => set('logo', e.target.checked)} /> Imprimir logo</label>
                    <div className={cx('imp-logo__foto', !m.logo && 'apagada')}>
                      {logoUsada ? <img src={logoUsada} alt="Logo" /> : <span>Sem logo</span>}
                    </div>
                    <div className="imp-logo__acoes">
                      <button type="button" className="btn-quadrado" onClick={() => arquivoRef.current?.click()} title="Trocar logo da impressão"><RefreshCw size={16} /></button>
                      {loja.logo_url && <button type="button" className="btn-quadrado" onClick={() => setLoja((x) => ({ ...x, logo_url: null }))} title="Voltar para a logo do restaurante"><Trash2 size={16} /></button>}
                      {!logoUsada && <button type="button" className="btn btn--contorno btn--sm" onClick={() => arquivoRef.current?.click()}><ImagePlus size={15} /> Enviar logo</button>}
                    </div>
                    <small>Sai em preto e branco. Logo de fundo branco fica melhor.</small>
                    <input ref={arquivoRef} className="input-arquivo" type="file" accept="image/*" onChange={(e) => { const x = e.target.files?.[0]; if (x) setAjustarLogo(x); e.target.value = ''; }} />
                  </div>
                  <div className="imp-cab__dados">
                    <label className="imp-check"><input type="checkbox" checked={m.cnpj} onChange={(e) => set('cnpj', e.target.checked)} /> Incluir CNPJ</label>
                    {m.cnpj && <input className="input" value={loja.cnpj} onChange={(e) => setLoja({ ...loja, cnpj: mascaraCnpj(e.target.value) })} placeholder="00.000.000/0000-00" />}
                    <label className="imp-check"><input type="checkbox" checked={m.telefone} onChange={(e) => set('telefone', e.target.checked)} /> Incluir telefone de contato</label>
                    {m.telefone && <input className="input" value={mascaraTelefone(loja.telefone)} onChange={(e) => setLoja({ ...loja, telefone: e.target.value.replace(/\D/g, '') })} placeholder="(00) 00000-0000" />}
                    <Campo rotulo="Site ou Instagram"><input className="input" value={m.site} maxLength={80} onChange={(e) => set('site', e.target.value)} placeholder="Ex.: @basilfiery" /></Campo>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="imp-bloco">
            <h3>Rodapé</h3>
            <Campo rotulo="Mensagem personalizada do rodapé">
              <textarea className="textarea" rows={2} maxLength={300} value={m.rodape} onChange={(e) => set('rodape', e.target.value)} placeholder="Ex.: Obrigado pela preferência!" />
            </Campo>
            <p className="cfg-nota">Toda impressão termina com <b>“Feito por: Basil Fiery”</b>.</p>
          </section>
        </div>

        <aside className="imp-previa">
          <small>Prévia · papel {largura} mm</small>
          <div className="imp-papel" style={{ width: largura === 58 ? 250 : 320 }}>
            <iframe title="Prévia do cupom" srcDoc={html} onLoad={(e) => { const f = e.currentTarget; f.style.height = `${(f.contentDocument?.documentElement.scrollHeight ?? 600) + 4}px`; }} />
          </div>
        </aside>
      </div>
      {ajustarLogo && <AjustarFoto arquivo={ajustarLogo} formato="quadrado" titulo="Logo da impressão" aoConfirmar={enviarLogo} aoCancelar={() => setAjustarLogo(null)} />}
    </PaginaConfig>
  );
}

/* ---------- 3. Imprimir direto ---------- */
function ImprimirDireto() {
  return programaDesktop() ? (
    <p className="muted aviso-ok" style={{ margin: 0, fontSize: '.92rem' }}>
      <CircleCheck size={16} /> Você está no <b>programa BasilFiery para Windows</b>: a impressão já sai direto na impressora escolhida.
    </p>
  ) : (
    <div className="form">
      <ol className="passos-lista">
        <li>No Windows, defina a impressora térmica como <b>impressora padrão</b>.</li>
        <li>Crie um atalho do Google Chrome na área de trabalho.</li>
        <li>Clique com o botão direito → Propriedades → no campo <b>Destino</b>, adicione no final:<br />
          <code>--kiosk-printing {origemSistema()}/painel</code></li>
        <li>Feche todas as janelas do Chrome e abra pelo atalho. Os pedidos saem direto na impressora.</li>
        <li>Nas preferências da impressora, ajuste margens para “nenhuma” se o cupom sair cortado.</li>
      </ol>
      <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Mais fácil: instale o <b>programa BasilFiery para Windows</b>, que já imprime direto e em várias impressoras.</p>
    </div>
  );
}
