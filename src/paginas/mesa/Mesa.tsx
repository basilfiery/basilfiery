import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  CheckCircle2, ChevronLeft, ChevronRight, Citrus, ConciergeBell, Hourglass, Layers, Lock, Maximize, MessageCircleMore, Play, Plus, Receipt,
  ShieldCheck, ShoppingBag, Sparkles, Star, Trash2, Users, Utensils, UtensilsCrossed, XCircle,
} from 'lucide-react';
import { FotoProduto, Selos, Stepper, VideoCapa } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { descreverAparelho, idDispositivo } from '../../lib/dispositivo';
import { msgErro, supabase } from '../../lib/supabase';
import type { StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, hora, ls } from '../../lib/util';
import { useNovaVersao } from '../../lib/versao';
import { useAppInstalavel } from '../../lib/manifesto';
import '../../estilos/mesa.css';

interface ProdutoMesa {
  id: string;
  categoria_id: string;
  nome: string;
  descricao: string;
  preco: number;
  emoji: string | null;
  imagem_url: string | null;
  video_url: string | null;
  capa: 'imagem' | 'video';
  vegetariano: boolean;
  picancia: number;
  destaque: boolean;
  novo: boolean;
  disponivel: boolean;
  estoque_max: number | null;
}

interface CategoriaMesa { id: string; nome: string; emoji: string | null; pai_id?: string | null }

interface DadosMesa {
  restaurante: { id: string; nome: string; slogan: string | null; logo_url: string | null; cor: string };
  mesa: { id: string; nome: string };
  categorias: CategoriaMesa[];
  produtos: ProdutoMesa[];
}

interface Linha { chave: string; produto_id: string; qtd: number; obs: string }

interface Conta {
  total: number;
  pedidos: { id: string; numero: number; status: StatusPedido; total: number; criado_em: string; itens: { nome: string; qtd: number; preco: number; obs: string | null }[] }[];
}

/** Situação deste aparelho: só pede depois que a equipe libera a mesa. */
type Acesso = 'carregando' | 'equipe' | 'liberado' | 'pendente' | 'recusado' | 'nenhum' | 'em_uso';
const semAcesso = (a: Acesso) => a === 'nenhum' || a === 'em_uso';

interface Secao extends CategoriaMesa { diretos: ProdutoMesa[]; subs: CategoriaMesa[]; total: number }

const INATIVIDADE_MS = 5 * 60 * 1000;
const DESTAQUES = '__destaques';
const ehMesaFechada = (e: unknown) => /MESA_FECHADA/.test(msgErro(e));

/** Altura real da tela (o 100vh dos iPhones antigos passa por baixo da barra do Safari). */
function useAlturaTela() {
  useEffect(() => {
    const aplicar = () => document.documentElement.style.setProperty('--altura-tela', `${window.innerHeight}px`);
    aplicar();
    window.addEventListener('resize', aplicar);
    window.addEventListener('orientationchange', aplicar);
    return () => {
      window.removeEventListener('resize', aplicar);
      window.removeEventListener('orientationchange', aplicar);
    };
  }, []);
}

export default function Mesa() {
  const { token = '' } = useParams();
  const navegar = useNavigate();
  const toast = useToast();
  const dispositivo = useMemo(idDispositivo, []);
  const [dados, setDados] = useState<DadosMesa | null>(null);
  const [erro, setErro] = useState('');
  const [carrinho, setCarrinho] = useState<Linha[]>(() => ls.ler(`bf:carrinho:${token}`, []));
  const [obsPedido, setObsPedido] = useState('');
  const [produtoAberto, setProdutoAberto] = useState<ProdutoMesa | null>(null);
  const [verCarrinho, setVerCarrinho] = useState(false);
  const [verConta, setVerConta] = useState(false);
  const [verChamado, setVerChamado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<number[] | null>(null);
  const [catAtiva, setCatAtiva] = useState('');
  const [subAtiva, setSubAtiva] = useState('');
  const [acesso, setAcesso] = useState<Acesso>('carregando');
  const [verAbrir, setVerAbrir] = useState(false);
  const [pedindoAcesso, setPedindoAcesso] = useState(false);
  const acaoDepois = useRef<(() => void) | null>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const catsRef = useRef<HTMLElement>(null);
  useAlturaTela();
  // "Adicionar à tela de início" guarda esta mesa (e não o painel do sistema)
  useAppInstalavel(dados ? {
    nome: `${dados.mesa.nome} · ${dados.restaurante.nome}`,
    curto: dados.mesa.nome,
    inicio: `/mesa/${token}`,
    escopo: `/mesa/${token}`,
  } : null);

  const podePedir = acesso === 'liberado' || acesso === 'equipe';

  const carregar = useCallback(async (silencioso = false) => {
    const { data, error } = await supabase.rpc('mesa_cardapio', { p_token: token });
    if (error) {
      if (!silencioso) setErro(msgErro(error));
      return;
    }
    setDados(data as DadosMesa);
    setErro('');
  }, [token]);

  useEffect(() => {
    void carregar();
    const i = setInterval(() => void carregar(true), 60000);
    return () => clearInterval(i);
  }, [carregar]);

  useEffect(() => ls.gravar(`bf:carrinho:${token}`, carrinho), [carrinho, token]);

  /* ---------- Liberação da mesa ---------- */
  const acessoRef = useRef<Acesso>('carregando');
  const consultarAcesso = useCallback(async () => {
    const { data, error } = await supabase.rpc('mesa_acesso_status', { p_token: token, p_dispositivo: dispositivo });
    if (error) return;
    // A equipe trocou o cliente de mesa: o cardápio (e o pedido em montagem) seguem para a mesa nova
    if (typeof data === 'string' && data.startsWith('movido:')) {
      const novoToken = data.slice(7);
      ls.gravar(`bf:carrinho:${novoToken}`, carrinhoRef.current);
      acessoRef.current = 'liberado';
      setAcesso('liberado');
      toast('Sua conta foi transferida para a nova mesa. Pode continuar pedindo.', 'ok');
      navegar(`/mesa/${novoToken}`, { replace: true });
      return;
    }
    const novo = data as Acesso;
    const antes = acessoRef.current;
    acessoRef.current = novo;
    setAcesso(novo);
    if (antes === 'carregando' && semAcesso(novo)) setVerAbrir(true); // boas-vindas: solicitar acesso
    if (antes === 'pendente' && novo === 'liberado') {
      toast('Mesa liberada! Já pode fazer seu pedido.', 'ok');
      setVerAbrir(false);
      const acao = acaoDepois.current;
      acaoDepois.current = null;
      acao?.();
    }
    if (antes === 'liberado' && semAcesso(novo)) toast('A conta desta mesa foi fechada. Obrigado pela visita!', 'info');
  }, [token, dispositivo, toast, navegar]);

  useEffect(() => {
    void consultarAcesso();
    // Esperando o garçom: confere rápido; depois, de tempos em tempos (a conta pode ter sido fechada)
    const i = setInterval(() => void consultarAcesso(), acesso === 'pendente' ? 3000 : 20000);
    const aoVoltar = () => document.visibilityState === 'visible' && void consultarAcesso();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(i);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [consultarAcesso, acesso]);

  async function pedirAbertura() {
    setPedindoAcesso(true);
    const { data, error } = await supabase.rpc('mesa_acesso_pedir', {
      p_token: token, p_dispositivo: dispositivo, p_aparelho: descreverAparelho(),
    });
    setPedindoAcesso(false);
    if (error) return toast(msgErro(error), 'erro');
    acessoRef.current = data as Acesso;
    setAcesso(data as Acesso);
    if (data === 'liberado' || data === 'equipe') {
      setVerAbrir(false);
      const acao = acaoDepois.current;
      acaoDepois.current = null;
      acao?.();
    }
  }

  /** Ações que só valem com a mesa liberada (pedir, chamar, ver a conta). */
  function exigirMesaAberta(acao: () => void) {
    if (podePedir) return acao();
    acaoDepois.current = acao;
    setVerAbrir(true);
  }

  const mesaFechou = () => {
    acessoRef.current = 'nenhum';
    setAcesso('nenhum');
    setVerAbrir(true);
  };

  /* ---------- Carrinho ---------- */
  const porId = useMemo(() => new Map((dados?.produtos ?? []).map((p) => [p.id, p])), [dados]);

  // Tira do carrinho o que esgotou ou saiu do cardápio
  const carrinhoRef = useRef(carrinho);
  carrinhoRef.current = carrinho;
  const novaVersao = useNovaVersao();
  const novaVersaoRef = useRef(novaVersao);
  novaVersaoRef.current = novaVersao;
  useEffect(() => {
    if (!dados) return;
    const atual = carrinhoRef.current;
    const validos = atual.filter((l) => porId.get(l.produto_id)?.disponivel);
    if (validos.length !== atual.length) {
      setCarrinho(validos);
      toast('Alguns itens esgotaram e saíram do seu pedido.', 'info');
    }
  }, [dados, porId, toast]);

  // Volta ao estado inicial depois de alguns minutos sem uso (próximo cliente)
  useEffect(() => {
    let ultimo = Date.now();
    const marcar = () => { ultimo = Date.now(); };
    window.addEventListener('pointerdown', marcar);
    window.addEventListener('keydown', marcar);
    window.addEventListener('scroll', marcar, true);
    const i = setInterval(() => {
      // Atualização do sistema: aplica sozinha quando o tablet está parado e sem pedido em montagem
      if (novaVersaoRef.current && Date.now() - ultimo > 60000 && carrinhoRef.current.length === 0) {
        window.location.reload();
        return;
      }
      if (Date.now() - ultimo < INATIVIDADE_MS) return;
      ultimo = Date.now();
      setCarrinho((c) => (c.length ? [] : c));
      setObsPedido('');
      setProdutoAberto(null);
      setVerCarrinho(false);
      setVerConta(false);
      setConfirmar(false);
      setCatAtiva('');
      setSubAtiva('');
      listaRef.current?.scrollTo({ top: 0 });
    }, 30000);
    return () => {
      window.removeEventListener('pointerdown', marcar);
      window.removeEventListener('keydown', marcar);
      window.removeEventListener('scroll', marcar, true);
      clearInterval(i);
    };
  }, []);

  // Mantém a tela do tablet acesa
  useEffect(() => {
    let trava: WakeLockSentinel | null = null;
    const pedir = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') trava = await navigator.wakeLock.request('screen');
      } catch { /* sem suporte */ }
    };
    void pedir();
    document.addEventListener('visibilitychange', pedir);
    window.addEventListener('pointerdown', pedir, { once: true });
    return () => {
      document.removeEventListener('visibilitychange', pedir);
      void trava?.release();
    };
  }, []);

  const total = carrinho.reduce((s, l) => s + (porId.get(l.produto_id)?.preco ?? 0) * l.qtd, 0);
  const qtdItens = carrinho.reduce((s, l) => s + l.qtd, 0);
  const qtdDoProduto = (id: string) => carrinho.filter((l) => l.produto_id === id).reduce((s, l) => s + l.qtd, 0);

  function adicionar(p: ProdutoMesa, qtd: number, obs: string) {
    const chave = `${p.id}|${obs}`;
    setCarrinho((c) => {
      const existe = c.find((l) => l.chave === chave);
      return existe
        ? c.map((l) => (l.chave === chave ? { ...l, qtd: l.qtd + qtd } : l))
        : [...c, { chave, produto_id: p.id, qtd, obs }];
    });
    toast(`${qtd}× ${p.nome} no seu pedido`, 'ok');
  }

  function mudarQtd(chave: string, qtd: number) {
    setCarrinho((c) => (qtd <= 0 ? c.filter((l) => l.chave !== chave) : c.map((l) => (l.chave === chave ? { ...l, qtd } : l))));
  }

  async function enviar() {
    setEnviando(true);
    const { data, error } = await supabase.rpc('mesa_pedido_enviar', {
      p_token: token,
      p_dispositivo: dispositivo,
      p_itens: carrinho.map((l) => ({ produto_id: l.produto_id, qtd: l.qtd, obs: l.obs })),
      p_obs: obsPedido,
    });
    setEnviando(false);
    setConfirmar(false);
    if (error) {
      if (ehMesaFechada(error)) {
        acaoDepois.current = () => setConfirmar(true);
        return mesaFechou();
      }
      toast(msgErro(error), 'erro');
      void carregar(true);
      return;
    }
    setCarrinho([]);
    setObsPedido('');
    setVerCarrinho(false);
    const r = data as { numero: number; numeros?: number[] };
    setSucesso(r.numeros?.length ? r.numeros : [r.numero]);
    void carregar(true);
  }

  async function chamar(tipo: 'garcom' | 'conta', motivo?: string, detalhe?: string) {
    const { error } = await supabase.rpc('mesa_chamado_enviar', {
      p_token: token, p_dispositivo: dispositivo, p_tipo: tipo, p_motivo: motivo ?? null, p_detalhe: detalhe ?? null,
    });
    if (error) {
      if (ehMesaFechada(error)) mesaFechou();
      else toast(msgErro(error), 'erro');
      return false;
    }
    toast(tipo === 'conta' ? 'Pedimos a sua conta! Já já alguém vem até a mesa.' : 'Garçom chamado! Já já alguém vem até você.', 'ok');
    return true;
  }

  function abrirSub(id: string) {
    setSubAtiva(id);
    listaRef.current?.scrollTo({ top: 0 });
  }

  function escolherCategoria(id: string) {
    setCatAtiva(id);
    setSubAtiva('');
    listaRef.current?.scrollTo({ top: 0 });
    // No celular, deixa a categoria escolhida visível na barra
    catsRef.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }

  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (erro && !dados) {
    return (
      <div className="mesa-erro">
        <span className="mesa-erro__icone"><UtensilsCrossed size={44} strokeWidth={1.5} /></span>
        <h1 className="titulo">Ops, este cardápio não abriu</h1>
        <p>{erro}</p>
        <p className="muted">Por favor, chame um atendente.</p>
        <button className="btn btn--primario btn--lg" onClick={() => void carregar()}>Tentar de novo</button>
      </div>
    );
  }
  if (!dados) return <Carregando texto="Carregando cardápio…" />;

  const { restaurante, mesa, categorias, produtos } = dados;
  // Categorias principais; as subcategorias (ex.: Comida › Pratos) aparecem dentro delas
  const principais = categorias.filter((c) => !c.pai_id || !categorias.some((x) => x.id === c.pai_id));
  const produtosDe = (id: string) => produtos.filter((p) => p.categoria_id === id);
  const subsDe = (id: string) => categorias.filter((c) => c.pai_id === id && produtosDe(c.id).length > 0);
  const destaques = produtos.filter((p) => p.destaque);
  const secoes: Secao[] = [
    ...(destaques.length ? [{ id: DESTAQUES, nome: 'Mais pedidos', emoji: null, diretos: destaques, subs: [], total: destaques.length }] : []),
    ...principais
      .map((c) => {
        const subs = subsDe(c.id);
        const diretos = produtosDe(c.id);
        return { ...c, diretos, subs, total: diretos.length + subs.reduce((s, x) => s + produtosDe(x.id).length, 0) };
      })
      .filter((c) => c.total > 0),
  ];
  const secao = secoes.find((c) => c.id === catAtiva) ?? secoes[0];
  const emojiCat = (c: { id: string; emoji: string | null }) =>
    c.id === DESTAQUES ? <Star size={18} fill="currentColor" /> : c.emoji;

  const grade = (lista: ProdutoMesa[]) => (
    <div className="mesa__grade">
      {lista.map((p) => {
        const noCarrinho = qtdDoProduto(p.id);
        return (
          <button
            key={p.id}
            className={cx('prod', !p.disponivel && 'prod--esgotado')}
            disabled={!p.disponivel}
            onClick={() => setProdutoAberto(p)}
          >
            <div className="prod__midia">
              {p.capa === 'video' && p.video_url
                ? <VideoCapa p={{ ...p, video_url: p.video_url }} classe="prod__foto" />
                : <FotoProduto p={p} classe="prod__foto" />}
              {p.video_url && p.capa !== 'video' && <span className="prod__video"><Play size={12} fill="currentColor" /> Vídeo</span>}
              {noCarrinho > 0 && <span className="prod__no-carrinho">{noCarrinho}</span>}
              {!p.disponivel && <span className="prod__esgotado">Esgotado</span>}
            </div>
            <div className="prod__info">
              <h3>{p.nome}</h3>
              {p.descricao && <p>{p.descricao}</p>}
              <Selos p={p} />
              <div className="prod__rodape">
                <strong>{brl(p.preco)}</strong>
                {p.disponivel && <span className="prod__mais" aria-hidden="true"><Plus size={20} /></span>}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  const painelCarrinho = (
    <div className="carrinho">
      <h2 className="carrinho__titulo titulo">Seu pedido</h2>
      {carrinho.length === 0 ? (
        <div className="carrinho__vazio">
          <ShoppingBag size={36} />
          <p>Toque em um prato para adicionar.</p>
        </div>
      ) : (
        <>
          <ul className="carrinho__linhas">
            {carrinho.map((l) => {
              const p = porId.get(l.produto_id);
              if (!p) return null;
              return (
                <li key={l.chave} className="carrinho__linha">
                  <div className="carrinho__info">
                    <strong>{p.nome}</strong>
                    {l.obs && <small>“{l.obs}”</small>}
                    <span>{brl(p.preco * l.qtd)}</span>
                  </div>
                  <div className="carrinho__qtd">
                    <Stepper valor={l.qtd} min={0} max={p.estoque_max ?? 50} aoMudar={(v) => mudarQtd(l.chave, v)} />
                  </div>
                </li>
              );
            })}
          </ul>
          <label className="campo carrinho__obs">
            <span>Observação para a cozinha (opcional)</span>
            <textarea className="textarea" rows={2} maxLength={300} value={obsPedido} onChange={(e) => setObsPedido(e.target.value)} placeholder="Ex.: trazer as bebidas primeiro" />
          </label>
        </>
      )}
      <div className="carrinho__rodape">
        <div className="carrinho__total"><span>Total</span><strong>{brl(total)}</strong></div>
        <button className="btn btn--primario btn--lg btn--bloco" disabled={!carrinho.length} onClick={() => exigirMesaAberta(() => setConfirmar(true))}>
          {podePedir ? 'Enviar pedido' : <><Lock size={18} /> Enviar pedido</>}
        </button>
        {carrinho.length > 0 && (
          <button className="btn btn--fantasma btn--sm btn--bloco" onClick={() => setCarrinho([])}>
            <Trash2 size={16} /> Esvaziar
          </button>
        )}
      </div>
    </div>
  );

  const podeTelaCheia = typeof document !== 'undefined' && !!document.fullscreenEnabled;

  return (
    <div className={cx('mesa', qtdItens > 0 && 'mesa--com-carrinho')} style={{ '--acento': restaurante.cor } as CSSProperties}>
      <header className="mesa__topo">
        <div className="mesa__marca">
          {restaurante.logo_url
            ? <img src={restaurante.logo_url} alt="" className="mesa__logo" />
            : <span className="mesa__logo mesa__logo--letra">{restaurante.nome.charAt(0)}</span>}
          <div>
            <strong>{restaurante.nome}</strong>
            <span>{mesa.nome}</span>
          </div>
        </div>
        <div className="mesa__acoes">
          <button className="btn btn--contorno mesa__acao" onClick={() => exigirMesaAberta(() => setVerChamado(true))} aria-label="Chamar garçom">
            <ConciergeBell size={20} /> <span className="mesa__rotulo">Chamar garçom</span>
          </button>
          <button className="btn btn--contorno mesa__acao" onClick={() => exigirMesaAberta(() => setVerConta(true))} aria-label="Minha conta">
            <Receipt size={20} /> <span className="mesa__rotulo">Minha conta</span>
          </button>
          {podeTelaCheia && (
            <button className="icone-btn mesa__tela-cheia" onClick={telaCheia} aria-label="Tela cheia" title="Tela cheia">
              <Maximize size={20} />
            </button>
          )}
        </div>
      </header>

      <FaixaAcesso acesso={acesso} mesa={mesa.nome} aoAbrir={() => setVerAbrir(true)} />

      <div className="mesa__corpo">
        <nav className="mesa__cats" aria-label="Categorias" ref={catsRef}>
          {secoes.map((c) => (
            <button
              key={c.id}
              data-cat={c.id}
              className={cx('mesa__cat', secao?.id === c.id && 'ativa')}
              onClick={() => escolherCategoria(c.id)}
              aria-current={secao?.id === c.id ? 'true' : undefined}
            >
              <span className="mesa__cat-emoji" aria-hidden="true">{emojiCat(c)}</span>
              <span className="mesa__cat-nome">{c.nome}</span>
              <span className="mesa__cat-qtd">{c.total}</span>
            </button>
          ))}
        </nav>

        <main className="mesa__lista" ref={listaRef}>
          {secao ? (() => {
            const subSel = secao.subs.find((x) => x.id === subAtiva);
            const qtd = subSel ? produtosDe(subSel.id).length : secao.total;
            const i = secoes.findIndex((c) => c.id === secao.id);
            const prox = secoes[i + 1];
            return (
              <section key={`${secao.id}:${subSel?.id ?? ''}`} className="mesa__secao">
                <header className="mesa__secao-cab">
                  {subSel ? (
                    <div className="mesa__trilha">
                      <button className="mesa__voltar" onClick={() => abrirSub('')}>
                        <ChevronLeft size={18} /> {secao.nome}
                      </button>
                      <h2 className="titulo">{subSel.emoji && <span className="mesa__secao-emoji" aria-hidden="true">{subSel.emoji}</span>} {subSel.nome}</h2>
                    </div>
                  ) : (
                    <h2 className="titulo">
                      <span className="mesa__secao-emoji" aria-hidden="true">{emojiCat(secao)}</span> {secao.nome}
                    </h2>
                  )}
                  <span>{qtd} {qtd === 1 ? 'opção' : 'opções'}</span>
                </header>

                {subSel ? grade(produtosDe(subSel.id)) : (
                  <>
                    {/* Subcategorias como cartões: toca e vê o que tem dentro, na mesma tela */}
                    {secao.subs.length > 0 && (
                      <div className="mesa__grade mesa__grade--subs">
                        {secao.subs.map((sub) => {
                          const itens = produtosDe(sub.id);
                          const foto = itens.find((x) => x.imagem_url)?.imagem_url;
                          const menor = Math.min(...itens.map((x) => Number(x.preco)));
                          return (
                            <button key={sub.id} className="subcat" onClick={() => abrirSub(sub.id)}>
                              <div className="subcat__midia">
                                {foto
                                  ? <img src={foto} alt="" loading="lazy" />
                                  : <span className="subcat__emoji" aria-hidden="true">{sub.emoji || <Layers size={40} strokeWidth={1.5} />}</span>}
                              </div>
                              <div className="subcat__info">
                                <h3>{sub.nome}</h3>
                                <p>{itens.length} {itens.length === 1 ? 'opção' : 'opções'}{menor > 0 && ` · a partir de ${brl(menor)}`}</p>
                                <span className="subcat__ver">Ver opções <ChevronRight size={17} /></span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {secao.diretos.length > 0 && (
                      <>
                        {secao.subs.length > 0 && <h3 className="mesa__sub-titulo titulo">Outras opções</h3>}
                        {grade(secao.diretos)}
                      </>
                    )}
                  </>
                )}

                {subSel ? (
                  <button className="mesa__proxima" onClick={() => abrirSub('')}>
                    <ChevronLeft size={20} />
                    <strong>Voltar para {secao.nome}</strong>
                  </button>
                ) : prox ? (
                  /* Próxima categoria: o cliente não fica preso no fim da lista */
                  <button className="mesa__proxima" onClick={() => escolherCategoria(prox.id)}>
                    <span>Ver a seguir</span>
                    <strong>{emojiCat(prox)} {prox.nome}</strong>
                    <ChevronRight size={20} />
                  </button>
                ) : null}
              </section>
            );
          })() : (
            <p className="vazio">O cardápio ainda está sendo preparado. Chame um atendente.</p>
          )}
        </main>

        <aside className="mesa__carrinho">{painelCarrinho}</aside>
      </div>

      {qtdItens > 0 && (
        <button className="mesa__flutuante" onClick={() => setVerCarrinho(true)}>
          <span className="mesa__flutuante-qtd">{qtdItens}</span>
          <span>Ver meu pedido</span>
          <strong>{brl(total)}</strong>
        </button>
      )}

      <Modal aberto={verCarrinho} aoFechar={() => setVerCarrinho(false)} classe="mesa-modal">
        {painelCarrinho}
      </Modal>

      {produtoAberto && (
        <ModalProduto
          key={produtoAberto.id}
          p={produtoAberto}
          aoFechar={() => setProdutoAberto(null)}
          aoAdicionar={(qtd, obs) => {
            adicionar(produtoAberto, qtd, obs);
            setProdutoAberto(null);
          }}
          jaNoCarrinho={qtdDoProduto(produtoAberto.id)}
        />
      )}

      <Modal
        aberto={confirmar}
        aoFechar={() => !enviando && setConfirmar(false)}
        titulo="Confirmar pedido?"
        classe="mesa-modal"
        rodape={
          <>
            <button className="btn btn--contorno btn--lg" onClick={() => setConfirmar(false)} disabled={enviando}>Revisar</button>
            <button className="btn btn--primario btn--lg" onClick={() => void enviar()} disabled={enviando}>
              {enviando ? 'Enviando…' : `Confirmar · ${brl(total)}`}
            </button>
          </>
        }
      >
        <ul className="confirmar">
          {carrinho.map((l) => {
            const p = porId.get(l.produto_id);
            return p ? (
              <li key={l.chave}>
                <span><b>{l.qtd}×</b> {p.nome}{l.obs && <small> “{l.obs}”</small>}</span>
                <span>{brl(p.preco * l.qtd)}</span>
              </li>
            ) : null;
          })}
        </ul>
        {obsPedido && <p className="muted">Obs.: {obsPedido}</p>}
      </Modal>

      {verConta && (
        <ModalConta
          token={token}
          dispositivo={dispositivo}
          aoFechar={() => setVerConta(false)}
          aoPedirConta={() => void chamar('conta')}
          aoMesaFechada={() => { setVerConta(false); mesaFechou(); }}
        />
      )}

      {verChamado && (
        <ModalChamarGarcom
          aoFechar={() => setVerChamado(false)}
          aoChamar={async (motivo, detalhe) => { if (await chamar('garcom', motivo, detalhe)) setVerChamado(false); }}
        />
      )}

      {verAbrir && acesso !== 'carregando' && !podePedir && (
        <ModalAbrirMesa
          acesso={acesso}
          mesa={mesa.nome}
          restaurante={restaurante.nome}
          enviando={pedindoAcesso}
          aoPedir={() => void pedirAbertura()}
          aoFechar={() => { setVerAbrir(false); if (acesso !== 'pendente') acaoDepois.current = null; }}
        />
      )}

      {sucesso !== null && <TelaSucesso numeros={sucesso} aoFechar={() => setSucesso(null)} />}
    </div>
  );
}

/** Faixa no topo enquanto a mesa não está liberada para este aparelho. */
function FaixaAcesso({ acesso, mesa, aoAbrir }: { acesso: Acesso; mesa: string; aoAbrir: () => void }) {
  if (acesso === 'liberado' || acesso === 'equipe' || acesso === 'carregando') return null;
  if (acesso === 'pendente') {
    return (
      <button className="faixa-acesso faixa-acesso--pendente" onClick={aoAbrir}>
        <span className="faixa-acesso__pulso" aria-hidden="true" />
        <span><b>Aguardando o garçom liberar a {mesa}.</b> Enquanto isso, vá escolhendo.</span>
      </button>
    );
  }
  return (
    <button className={cx('faixa-acesso', acesso === 'recusado' && 'faixa-acesso--recusado')} onClick={aoAbrir}>
      <Lock size={16} />
      <span>
        {acesso === 'recusado'
          ? <><b>Acesso não liberado.</b> Se você está no restaurante, chame um atendente.</>
          : acesso === 'em_uso'
            ? <><b>Mesa em uso.</b> Toque para solicitar acesso.</>
            : <><b>Para pedir, solicite o acesso à mesa.</b> O garçom libera em instantes.</>}
      </span>
      <ChevronRight size={18} />
    </button>
  );
}

/** Boas-vindas e liberação: o cliente pede, o garçom confirma que ele está mesmo no restaurante. */
function ModalAbrirMesa({ acesso, mesa, restaurante, enviando, aoPedir, aoFechar }: {
  acesso: Acesso;
  mesa: string;
  restaurante: string;
  enviando: boolean;
  aoPedir: () => void;
  aoFechar: () => void;
}) {
  return (
    <Modal aberto aoFechar={aoFechar} classe="mesa-modal abrir-mesa" largura={460}>
      {acesso === 'pendente' ? (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone abrir-mesa__icone--espera"><Hourglass size={34} /></span>
          <h2 className="titulo">Acesso solicitado</h2>
          <p>Assim que ele liberar a <b>{mesa}</b>, você já pode pedir. Leva só um instante.</p>
          <div className="abrir-mesa__espera" aria-live="polite"><span /><span /><span /></div>
          <button className="btn btn--contorno btn--lg btn--bloco" onClick={aoFechar}>Escolher enquanto espero</button>
        </div>
      ) : acesso === 'recusado' ? (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone abrir-mesa__icone--recusado"><XCircle size={36} /></span>
          <h2 className="titulo">O acesso não foi liberado</h2>
          <p>Se você está no restaurante, chame um atendente para liberar a <b>{mesa}</b>.</p>
          <button className="btn btn--primario btn--lg btn--bloco" onClick={aoPedir} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Solicitar de novo'}
          </button>
          <button className="btn btn--fantasma btn--bloco" onClick={aoFechar}>Só olhar o cardápio</button>
        </div>
      ) : acesso === 'em_uso' ? (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone"><Users size={34} /></span>
          <p className="abrir-mesa__sobre">{restaurante}</p>
          <h2 className="titulo">A {mesa} já está em uso</h2>
          <p>Se você está junto com quem abriu a mesa, solicite o acesso: o garçom libera este celular também.</p>
          <button className="btn btn--primario btn--lg btn--bloco" onClick={aoPedir} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Solicitar acesso à mesa'}
          </button>
          <button className="btn btn--fantasma btn--bloco" onClick={aoFechar}>Só olhar o cardápio</button>
        </div>
      ) : (
        <div className="abrir-mesa__conteudo">
          <span className="abrir-mesa__icone"><ShieldCheck size={36} /></span>
          <p className="abrir-mesa__sobre">{restaurante}</p>
          <h2 className="titulo">Bem-vindo à {mesa}!</h2>
          <p>Para começar a fazer pedidos, solicite o acesso à mesa. O garçom confirma em instantes que você está aqui no restaurante.</p>
          <button className="btn btn--primario btn--lg btn--bloco" onClick={aoPedir} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Solicitar acesso à mesa'}
          </button>
          <button className="btn btn--fantasma btn--bloco" onClick={aoFechar}>Só olhar o cardápio</button>
        </div>
      )}
    </Modal>
  );
}

function ModalProduto({ p, aoFechar, aoAdicionar, jaNoCarrinho }: {
  p: ProdutoMesa;
  aoFechar: () => void;
  aoAdicionar: (qtd: number, obs: string) => void;
  jaNoCarrinho: number;
}) {
  const [qtd, setQtd] = useState(1);
  const [obs, setObs] = useState('');
  const [videoFalhou, setVideoFalhou] = useState(false);
  const max = p.estoque_max !== null ? Math.max(0, p.estoque_max - jaNoCarrinho) : 50;

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      classe="mesa-modal modal-produto"
      largura={620}
      rodape={
        <div className="modal-produto__rodape">
          <Stepper valor={qtd} min={1} max={Math.max(1, max)} aoMudar={setQtd} grande />
          <button className="btn btn--primario btn--lg" disabled={max < 1} onClick={() => aoAdicionar(qtd, obs.trim())}>
            {max < 1 ? 'Sem mais unidades' : `Adicionar · ${brl(p.preco * qtd)}`}
          </button>
        </div>
      }
    >
      {p.video_url && !videoFalhou ? (
        <video
          className="modal-produto__video"
          src={p.video_url}
          poster={p.imagem_url ?? undefined}
          autoPlay
          muted
          loop
          playsInline
          controls
          onError={() => setVideoFalhou(true)}
        />
      ) : (
        <FotoProduto p={p} classe="modal-produto__foto" />
      )}
      <h2 className="titulo modal-produto__nome">{p.nome}</h2>
      <Selos p={p} />
      <p className="modal-produto__desc">{p.descricao}</p>
      <p className="modal-produto__preco">{brl(p.preco)}</p>
      {p.estoque_max !== null && p.estoque_max <= 5 && <p className="modal-produto__aviso">Últimas {p.estoque_max} unidades!</p>}
      <label className="campo">
        <span>Alguma observação?</span>
        <textarea className="textarea" rows={2} maxLength={140} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: sem cebola, bem passado…" />
      </label>
    </Modal>
  );
}

const MOTIVOS_CHAMADO = [
  { icone: Citrus, rotulo: 'Sal e limão' },
  { icone: Utensils, rotulo: 'Pratos ou talheres' },
  { icone: Layers, rotulo: 'Guardanapos' },
  { icone: Sparkles, rotulo: 'Limpar a mesa' },
];

/** Antes de chamar, a mesa diz o que precisa: o garçom já vem com a coisa certa. */
function ModalChamarGarcom({ aoFechar, aoChamar }: { aoFechar: () => void; aoChamar: (motivo: string, detalhe?: string) => Promise<void> }) {
  const [outra, setOutra] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(motivo: string, detalhe?: string) {
    setEnviando(true);
    await aoChamar(motivo, detalhe);
    setEnviando(false);
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo="Do que você precisa?" classe="mesa-modal" largura={620}>
      {!outra ? (
        <div className="motivos">
          {MOTIVOS_CHAMADO.map((m) => (
            <button key={m.rotulo} className="motivo" onClick={() => void enviar(m.rotulo)} disabled={enviando}>
              <span className="motivo__icone" aria-hidden="true"><m.icone size={30} strokeWidth={1.8} /></span>
              <strong>{m.rotulo}</strong>
            </button>
          ))}
          <button className="motivo motivo--outra" onClick={() => setOutra(true)} disabled={enviando}>
            <span className="motivo__icone" aria-hidden="true"><MessageCircleMore size={26} strokeWidth={1.8} /></span>
            <strong>Outra coisa</strong>
          </button>
        </div>
      ) : (
        <div className="form">
          <label className="campo">
            <span>Conte rapidinho (opcional)</span>
            <input
              className="input input--grande-mesa"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              maxLength={140}
              placeholder="Ex.: gelo, canudo, ajuda com o pedido…"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && void enviar('Outra coisa', texto.trim() || undefined)}
            />
          </label>
          <div className="acoes-linha">
            <button className="btn btn--contorno btn--lg" onClick={() => setOutra(false)} disabled={enviando}>Voltar</button>
            <button className="btn btn--primario btn--lg" style={{ flex: 1 }} onClick={() => void enviar('Outra coisa', texto.trim() || undefined)} disabled={enviando}>
              <ConciergeBell size={20} /> {enviando ? 'Chamando…' : 'Chamar garçom'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ModalConta({ token, dispositivo, aoFechar, aoPedirConta, aoMesaFechada }: {
  token: string;
  dispositivo: string;
  aoFechar: () => void;
  aoPedirConta: () => void;
  aoMesaFechada: () => void;
}) {
  const [conta, setConta] = useState<Conta | null>(null);
  const [erro, setErro] = useState('');
  const fechadaRef = useRef(aoMesaFechada);
  fechadaRef.current = aoMesaFechada;

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      const { data, error } = await supabase.rpc('mesa_conta_ver', { p_token: token, p_dispositivo: dispositivo });
      if (!vivo) return;
      if (error) {
        if (ehMesaFechada(error)) fechadaRef.current();
        else setErro(msgErro(error));
      } else setConta(data as Conta);
    };
    void carregar();
    const i = setInterval(() => void carregar(), 10000);
    return () => { vivo = false; clearInterval(i); };
  }, [token, dispositivo]);

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Minha conta"
      classe="mesa-modal"
      rodape={
        <>
          <button className="btn btn--contorno btn--lg" onClick={aoFechar}>Voltar</button>
          <button className="btn btn--primario btn--lg" onClick={() => { aoPedirConta(); aoFechar(); }} disabled={!conta?.pedidos.length}>
            <Receipt size={20} /> Pedir a conta
          </button>
        </>
      }
    >
      {erro && <p className="erro-form">{erro}</p>}
      {!conta && !erro && <Carregando />}
      {conta && conta.pedidos.length === 0 && <p className="vazio">Nenhum pedido ainda nesta mesa.</p>}
      {conta && conta.pedidos.length > 0 && (
        <div className="conta">
          {conta.pedidos.map((p) => (
            <section key={p.id} className="conta__pedido">
              <header>
                <strong>Pedido #{p.numero}</strong>
                <span className="muted">{hora(p.criado_em)}</span>
                <span className={`badge badge--${p.status}`}>{STATUS_ROTULO[p.status]}</span>
              </header>
              <ul>
                {p.itens.map((i, n) => (
                  <li key={n}><span>{i.qtd}× {i.nome}</span><span>{brl(i.qtd * i.preco)}</span></li>
                ))}
              </ul>
            </section>
          ))}
          <div className="conta__total"><span>Total da mesa</span><strong>{brl(conta.total)}</strong></div>
          <p className="muted conta__nota">O pagamento é feito com o garçom ou no caixa.</p>
        </div>
      )}
    </Modal>
  );
}

function TelaSucesso({ numeros, aoFechar }: { numeros: number[]; aoFechar: () => void }) {
  useEffect(() => {
    const t = setTimeout(aoFechar, 8000);
    return () => clearTimeout(t);
  }, [aoFechar]);

  return (
    <div className="sucesso" role="alertdialog" aria-label="Pedido enviado" onClick={aoFechar}>
      <CheckCircle2 size={88} className="sucesso__icone" />
      <h2 className="titulo">{numeros.length > 1 ? `Pedidos ${numeros.map((n) => `#${n}`).join(' e ')} enviados!` : `Pedido #${numeros[0]} enviado!`}</h2>
      <p>
        {numeros.length > 1 ? 'As bebidas saem antes e a cozinha já recebeu o resto.' : 'Já recebemos e o garçom foi avisado.'}
        <br />Acompanhe em “Minha conta”.
      </p>
      <button className="btn btn--primario btn--lg">Voltar ao cardápio</button>
    </div>
  );
}
