import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ImagePlus, Link2, ListPlus, Pencil, Plus, Trash2, Unlink, X } from 'lucide-react';
import { Stepper, Switch } from '../../componentes/Basicos';
import { confirmar } from '../../componentes/Confirmar';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { regraGrupo, ROTULO_CALCULO, type CalculoGrupo } from '../../lib/adicionais';
import { ACEITA_IMAGEM, enviarImagem, msgErro, supabase } from '../../lib/supabase';
import { brl, cx, lerPreco, mascaraPreco, precoParaTexto } from '../../lib/util';

/* =====================================================================
   Grupos de adicionais (como no Anota AI): "Sabores", "Bordas", "Extras"…
   Cadastra uma vez e liga em quantos itens quiser (Pizza P, M e G).
   ===================================================================== */

export interface AdicionalOpcao {
  id: string;
  grupo_id: string;
  restaurante_id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  imagem_url: string | null;
  repetir: boolean;
  esgotado: boolean;
  ordem: number;
}

export interface GrupoAdicional {
  id: string;
  restaurante_id: string;
  nome: string;
  identificador: string | null;
  minimo: number;
  maximo: number;
  calculo: CalculoGrupo;
  esgotado: boolean;
  ordem: number;
  opcoes: AdicionalOpcao[];
}

export interface VinculoAdicional { produto_id: string; grupo_id: string; ordem: number }

/** Carrega grupos (com as opções) e vínculos do restaurante. */
export async function carregarAdicionais(restauranteId: string) {
  const [g, a, v] = await Promise.all([
    supabase.from('adicional_grupos').select('*').eq('restaurante_id', restauranteId).order('ordem').order('nome'),
    supabase.from('adicionais').select('*').eq('restaurante_id', restauranteId).order('ordem').order('nome'),
    supabase.from('produto_adicionais').select('produto_id, grupo_id, ordem').eq('restaurante_id', restauranteId),
  ]);
  const opcoes = (a.data ?? []) as AdicionalOpcao[];
  const grupos = ((g.data ?? []) as Omit<GrupoAdicional, 'opcoes'>[]).map((x) => ({ ...x, opcoes: opcoes.filter((o) => o.grupo_id === x.id) }));
  return { grupos, vinculos: (v.data ?? []) as VinculoAdicional[] };
}

interface OpcaoForm { id: string; nome: string; descricao: string; preco: string; imagem_url: string | null; repetir: boolean; esgotado: boolean }
const opcaoVazia = (): OpcaoForm => ({ id: crypto.randomUUID(), nome: '', descricao: '', preco: '', imagem_url: null, repetir: false, esgotado: false });

/** Criar/editar um grupo de adicionais e as opções dele. */
export function ModalGrupoAdicionais({ restauranteId, grupo, usadoEm, nomeSugerido, aoFechar, aoSalvar }: {
  restauranteId: string;
  grupo: GrupoAdicional | null;
  /** Itens que usam este grupo */
  usadoEm: string[];
  nomeSugerido?: string;
  aoFechar: () => void;
  aoSalvar: (id: string | null) => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState(grupo?.nome ?? nomeSugerido ?? '');
  const [identificador, setIdentificador] = useState(grupo?.identificador ?? '');
  const [minimo, setMinimo] = useState(grupo?.minimo ?? 1);
  const [maximo, setMaximo] = useState(grupo?.maximo ?? 1);
  const [calculo, setCalculo] = useState<CalculoGrupo>(grupo?.calculo ?? 'soma');
  const [esgotado, setEsgotado] = useState(grupo?.esgotado ?? false);
  const [opcoes, setOpcoes] = useState<OpcaoForm[]>(() => (grupo?.opcoes.length
    ? grupo.opcoes.map((o) => ({ id: o.id, nome: o.nome, descricao: o.descricao ?? '', preco: precoParaTexto(Number(o.preco)), imagem_url: o.imagem_url, repetir: o.repetir, esgotado: o.esgotado }))
    : [opcaoVazia()]));
  const [colar, setColar] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoFoto, setEnviandoFoto] = useState<string | null>(null);
  const fotoRef = useRef<HTMLInputElement>(null);
  const fotoPara = useRef<string>('');
  const obrigatorio = minimo > 0;
  const listaRef = useRef<HTMLDivElement>(null);

  const mudar = (id: string, m: Partial<OpcaoForm>) => setOpcoes((l) => l.map((o) => (o.id === id ? { ...o, ...m } : o)));
  const mover = (i: number, d: -1 | 1) => setOpcoes((l) => {
    const n = [...l];
    const j = i + d;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  function novaOpcao() {
    setOpcoes((l) => [...l, opcaoVazia()]);
    requestAnimationFrame(() => {
      const campos = listaRef.current?.querySelectorAll<HTMLInputElement>('.adic-form__nome');
      campos?.[campos.length - 1]?.focus();
    });
  }
  function adicionarVarios() {
    const nomes = (colar ?? '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 60);
    if (!nomes.length) return setColar(null);
    setOpcoes((l) => [...l.filter((o) => o.nome.trim()), ...nomes.map((n) => ({ ...opcaoVazia(), nome: n.slice(0, 80) }))]);
    setColar(null);
  }
  function tornar(obrig: boolean) {
    if (obrig) setMinimo((m) => Math.max(1, m));
    else setMinimo(0);
  }

  async function enviarFoto(arquivo?: File) {
    const id = fotoPara.current;
    if (!arquivo || !id) return;
    setEnviandoFoto(id);
    try { mudar(id, { imagem_url: await enviarImagem(restauranteId, arquivo, 'adicionais') }); } catch (e) { toast(msgErro(e), 'erro'); }
    setEnviandoFoto(null);
    if (fotoRef.current) fotoRef.current.value = '';
  }

  async function salvar() {
    const validas = opcoes.filter((o) => o.nome.trim());
    if (!nome.trim()) return toast('Dê um nome ao grupo (ex.: Sabores).', 'erro');
    if (!validas.length) return toast('Cadastre pelo menos uma opção.', 'erro');
    const precos = validas.map((o) => (o.preco.trim() ? lerPreco(o.preco) : 0));
    if (precos.some((x) => !Number.isFinite(x) || x < 0)) return toast('Confira os preços das opções.', 'erro');
    if (minimo > maximo) return toast('O mínimo não pode ser maior que o máximo.', 'erro');
    setSalvando(true);
    const dadosGrupo = {
      nome: nome.trim().slice(0, 60), identificador: identificador.trim() || null,
      minimo, maximo, calculo: maximo > 1 ? calculo : 'soma', esgotado,
    };
    let id = grupo?.id;
    if (id) {
      const { error } = await supabase.from('adicional_grupos').update(dadosGrupo).eq('id', id);
      if (error) { setSalvando(false); return toast(msgErro(error), 'erro'); }
    } else {
      const { data, error } = await supabase.from('adicional_grupos').insert({ ...dadosGrupo, restaurante_id: restauranteId }).select('id').single();
      if (error) { setSalvando(false); return toast(msgErro(error), 'erro'); }
      id = data.id as string;
    }
    const linhas = validas.map((o, i) => ({
      id: o.id, grupo_id: id, restaurante_id: restauranteId, nome: o.nome.trim().slice(0, 80),
      descricao: o.descricao.trim().slice(0, 200) || null, preco: precos[i], imagem_url: o.imagem_url,
      repetir: maximo > 1 && o.repetir, esgotado: o.esgotado, ordem: i,
    }));
    const { error: e1 } = await supabase.from('adicionais').upsert(linhas);
    if (e1) { setSalvando(false); return toast(msgErro(e1), 'erro'); }
    const removidas = (grupo?.opcoes ?? []).map((o) => o.id).filter((x) => !linhas.some((l) => l.id === x));
    if (removidas.length) await supabase.from('adicionais').delete().in('id', removidas);
    setSalvando(false);
    toast('Grupo de adicionais salvo.', 'ok');
    aoSalvar(id);
  }

  async function excluir() {
    if (!grupo) return;
    const aviso = usadoEm.length ? `\n\nEle sai de: ${usadoEm.slice(0, 6).join(', ')}${usadoEm.length > 6 ? '…' : ''}.` : '';
    if (!(await confirmar(`Excluir o grupo "${grupo.nome}" e todas as opções dele?${aviso}`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('adicional_grupos').delete().eq('id', grupo.id);
    if (error) return toast(msgErro(error), 'erro');
    toast('Grupo excluído.', 'ok');
    aoSalvar(null);
  }

  return (
    <Modal
      aberto
      aoFechar={() => !salvando && aoFechar()}
      titulo={grupo ? 'Editar grupo de adicionais' : 'Novo grupo de adicionais'}
      largura={760}
      classe="modal-adic"
      rodape={
        <>
          {grupo && <button className="btn btn--perigo" style={{ marginRight: 'auto' }} onClick={() => void excluir()}><Trash2 size={16} /> Excluir grupo</button>}
          <button className="btn btn--contorno" onClick={aoFechar} disabled={salvando}>Cancelar</button>
          <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </>
      }
    >
      <div className="adic-form">
        <div className="adic-form__linha">
          <label className="campo"><span>Nome do grupo *</span>
            <input className="input" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Sabores, Borda, Adicionais" autoFocus={!grupo} />
          </label>
          <label className="campo"><span>Identificador interno <small className="muted">(só você vê)</small></span>
            <input className="input" value={identificador} maxLength={60} onChange={(e) => setIdentificador(e.target.value)} placeholder="Ex.: Sabores pizza salgada" />
          </label>
        </div>

        <div className="adic-tipo" role="radiogroup" aria-label="O cliente precisa escolher?">
          <button type="button" role="radio" aria-checked={!obrigatorio} className={cx(!obrigatorio && 'ativo')} onClick={() => tornar(false)}>
            <i>{!obrigatorio && <Check size={14} strokeWidth={3} />}</i>
            <span><strong>Opcional</strong><small>O cliente pode não escolher nada</small></span>
          </button>
          <button type="button" role="radio" aria-checked={obrigatorio} className={cx(obrigatorio && 'ativo')} onClick={() => tornar(true)}>
            <i>{obrigatorio && <Check size={14} strokeWidth={3} />}</i>
            <span><strong>Obrigatório</strong><small>O cliente precisa escolher para pedir</small></span>
          </button>
        </div>

        <div className="adic-qtds">
          <p>Quantas opções o cliente pode escolher?</p>
          <div className="adic-qtds__linha">
            <label className="campo"><span>Mínimo</span><Stepper valor={minimo} min={obrigatorio ? 1 : 0} max={obrigatorio ? maximo : 0} aoMudar={setMinimo} /></label>
            <label className="campo"><span>Máximo</span><Stepper valor={maximo} min={Math.max(1, minimo)} max={50} aoMudar={setMaximo} /></label>
            <span className="adic-qtds__resumo">{regraGrupo({ minimo, maximo })}</span>
          </div>
        </div>

        {maximo > 1 && (
          <div className="adic-calculo">
            <p>Como cobrar quando escolher mais de uma?</p>
            <div className="adic-calculo__opcoes">
              {(['soma', 'maior', 'media'] as CalculoGrupo[]).map((c) => (
                <button key={c} type="button" className={cx(calculo === c && 'ativo')} onClick={() => setCalculo(c)}>
                  <strong>{c === 'soma' ? 'Somar' : c === 'maior' ? 'Mais caro' : 'Média'}</strong>
                  <small>{ROTULO_CALCULO[c]}</small>
                </button>
              ))}
            </div>
            {calculo === 'soma' && /sabor/i.test(nome) && <p className="adic-dica">Pizza meio a meio? Use “Mais caro”: o cliente paga o valor do sabor mais caro.</p>}
          </div>
        )}

        <Switch marcado={esgotado} aoMudar={setEsgotado}>Esgotar o grupo inteiro agora</Switch>

        <div className="adic-form__opcoes-cab">
          <h3>Opções <small>{opcoes.filter((o) => o.nome.trim()).length}</small></h3>
          <button type="button" className="btn btn--fantasma btn--sm" onClick={() => setColar(colar === null ? '' : null)}><ListPlus size={16} /> Colar vários</button>
        </div>
        {colar !== null && (
          <div className="adic-colar">
            <textarea className="textarea" rows={5} value={colar} onChange={(e) => setColar(e.target.value)} placeholder={'Um por linha, ex.:\nCalabresa\nFrango com Catupiry\nPortuguesa'} autoFocus />
            <div className="acoes-linha"><button type="button" className="btn btn--primario btn--sm" onClick={adicionarVarios}>Adicionar à lista</button><button type="button" className="btn btn--fantasma btn--sm" onClick={() => setColar(null)}>Cancelar</button></div>
          </div>
        )}

        <div className="adic-form__lista" ref={listaRef}>
          {opcoes.map((o, i) => (
            <div key={o.id} className={cx('adic-form__opcao', o.esgotado && 'esgotada')}>
              <div className="adic-form__foto">
                <button type="button" onClick={() => { fotoPara.current = o.id; fotoRef.current?.click(); }} title={o.imagem_url ? 'Trocar foto' : 'Colocar foto'}>
                  {o.imagem_url ? <img src={o.imagem_url} alt="" /> : enviandoFoto === o.id ? <span className="spinner" /> : <ImagePlus size={20} />}
                </button>
                {o.imagem_url && <button type="button" className="adic-form__foto-tirar" onClick={() => mudar(o.id, { imagem_url: null })} aria-label="Tirar foto"><X size={12} /></button>}
              </div>
              <div className="adic-form__campos">
                <div className="adic-form__linha adic-form__linha--preco">
                  <label className="campo"><span>Nome *</span><input className="input adic-form__nome" value={o.nome} maxLength={80} onChange={(e) => mudar(o.id, { nome: e.target.value })} placeholder="Ex.: Calabresa" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (i === opcoes.length - 1) novaOpcao(); } }} /></label>
                  <label className="campo"><span>Preço</span><input className="input" inputMode="decimal" value={o.preco} onChange={(e) => mudar(o.id, { preco: mascaraPreco(e.target.value) })} placeholder="0,00" /></label>
                </div>
                <label className="campo"><span>Descrição</span><input className="input" value={o.descricao} maxLength={200} onChange={(e) => mudar(o.id, { descricao: e.target.value })} placeholder="Ex.: mussarela, calabresa fatiada e cebola" /></label>
                <div className="adic-form__chaves">
                  {maximo > 1 && <Switch marcado={o.repetir} aoMudar={(v) => mudar(o.id, { repetir: v })}>Pode escolher mais de 1</Switch>}
                  <Switch marcado={o.esgotado} aoMudar={(v) => mudar(o.id, { esgotado: v })}>Esgotado</Switch>
                </div>
              </div>
              <div className="adic-form__acoes">
                <button type="button" className="icone-btn" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp size={16} /></button>
                <button type="button" className="icone-btn" disabled={i === opcoes.length - 1} onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown size={16} /></button>
                <button type="button" className="icone-btn icone-btn--perigo" onClick={() => setOpcoes((l) => (l.length > 1 ? l.filter((x) => x.id !== o.id) : [opcaoVazia()]))} aria-label="Remover opção"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn--contorno btn--acento adic-form__nova" onClick={novaOpcao}><Plus size={17} /> Adicionar opção</button>
        <input ref={fotoRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => void enviarFoto(e.target.files?.[0])} />
        {usadoEm.length > 0 && <p className="adic-dica">Usado em: <b>{usadoEm.join(', ')}</b>. Mudou aqui, muda em todos.</p>}
      </div>
    </Modal>
  );
}

/** Dentro do "Editar produto": grupos ligados ao item, vincular existente ou criar novo. */
export function AdicionaisDoProduto({ grupos, vinculados, aoMudar, aoCriar, aoEditar }: {
  grupos: GrupoAdicional[];
  vinculados: string[];
  aoMudar: (ids: string[]) => void;
  aoCriar: () => void;
  aoEditar: (g: GrupoAdicional) => void;
}) {
  const [escolhendo, setEscolhendo] = useState(false);
  const ligados = vinculados.map((id) => grupos.find((g) => g.id === id)).filter((g): g is GrupoAdicional => !!g);
  const livres = grupos.filter((g) => !vinculados.includes(g.id));
  const mover = (i: number, d: -1 | 1) => {
    const n = [...vinculados];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    aoMudar(n);
  };

  return (
    <section className="adic-produto">
      <header className="adic-produto__cab">
        <div>
          <strong>Adicionais do item</strong>
          <small>Grupos que o cliente escolhe ao pedir (ex.: sabores, borda, extras)</small>
        </div>
      </header>

      {ligados.length === 0 ? (
        <p className="adic-produto__vazio">Nenhum grupo ligado a este item.</p>
      ) : (
        <ul className="adic-produto__lista">
          {ligados.map((g, i) => (
            <li key={g.id} className={cx('adic-produto__grupo', g.esgotado && 'esgotado')}>
              <div className="adic-produto__info">
                <strong>{g.nome}{g.minimo > 0 && <span className="adic-produto__obrig">Obrigatório</span>}{g.esgotado && <span className="selo-esgotado">Esgotado</span>}</strong>
                <small>{regraGrupo(g)} · {g.opcoes.length} {g.opcoes.length === 1 ? 'opção' : 'opções'}{g.maximo > 1 && g.calculo !== 'soma' ? ` · ${g.calculo === 'maior' ? 'cobra o mais caro' : 'cobra a média'}` : ''}</small>
                <span className="adic-produto__opcoes">
                  {g.opcoes.slice(0, 6).map((o) => <em key={o.id}>{o.nome}{Number(o.preco) > 0 ? ` +${brl(Number(o.preco))}` : ''}</em>)}
                  {g.opcoes.length > 6 && <em>+{g.opcoes.length - 6}</em>}
                </span>
              </div>
              <div className="adic-produto__acoes">
                {ligados.length > 1 && (
                  <>
                    <button type="button" className="icone-btn" disabled={i === 0} onClick={() => mover(i, -1)} aria-label="Subir"><ArrowUp size={16} /></button>
                    <button type="button" className="icone-btn" disabled={i === ligados.length - 1} onClick={() => mover(i, 1)} aria-label="Descer"><ArrowDown size={16} /></button>
                  </>
                )}
                <button type="button" className="btn btn--contorno btn--sm" onClick={() => aoEditar(g)}><Pencil size={15} /> Editar grupo</button>
                <button type="button" className="icone-btn icone-btn--perigo" onClick={() => aoMudar(vinculados.filter((x) => x !== g.id))} title="Tirar deste item" aria-label="Tirar deste item"><Unlink size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {escolhendo && (
        <div className="adic-produto__escolher">
          {livres.length === 0 ? <p className="muted">Todos os grupos já estão neste item.</p> : livres.map((g) => (
            <button key={g.id} type="button" className="adic-produto__livre" onClick={() => { aoMudar([...vinculados, g.id]); setEscolhendo(false); }}>
              <Link2 size={15} /> <span><strong>{g.nome}</strong>{g.identificador && <small> · {g.identificador}</small>}<small> · {regraGrupo(g)}</small></span>
            </button>
          ))}
        </div>
      )}
      <div className="acoes-linha">
        {grupos.length > 0 && (
          <button type="button" className={cx('btn btn--contorno btn--sm', escolhendo && 'ativo')} onClick={() => setEscolhendo((v) => !v)} disabled={!livres.length && !escolhendo}>
            <Link2 size={15} /> Usar grupo existente
          </button>
        )}
        <button type="button" className="btn btn--contorno btn--acento btn--sm" onClick={aoCriar}><Plus size={15} /> Criar grupo de adicionais</button>
      </div>
    </section>
  );
}
