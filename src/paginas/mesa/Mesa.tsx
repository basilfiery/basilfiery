import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ConciergeBell, Maximize, Plus, Receipt, ShoppingBag, Trash2 } from 'lucide-react';
import { FotoProduto, Selos, Stepper } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { msgErro, supabase } from '../../lib/supabase';
import type { StatusPedido } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, hora, ls } from '../../lib/util';
import '../../estilos/mesa.css';

interface ProdutoMesa {
  id: string;
  categoria_id: string;
  nome: string;
  descricao: string;
  preco: number;
  emoji: string | null;
  imagem_url: string | null;
  vegetariano: boolean;
  picancia: number;
  destaque: boolean;
  novo: boolean;
  disponivel: boolean;
  estoque_max: number | null;
}

interface DadosMesa {
  restaurante: { id: string; nome: string; slogan: string | null; logo_url: string | null; cor: string };
  mesa: { id: string; nome: string };
  categorias: { id: string; nome: string; emoji: string | null }[];
  produtos: ProdutoMesa[];
}

interface Linha { chave: string; produto_id: string; qtd: number; obs: string }

interface Conta {
  total: number;
  pedidos: { id: string; numero: number; status: StatusPedido; total: number; criado_em: string; itens: { nome: string; qtd: number; preco: number; obs: string | null }[] }[];
}

const INATIVIDADE_MS = 5 * 60 * 1000;

export default function Mesa() {
  const { token = '' } = useParams();
  const toast = useToast();
  const [dados, setDados] = useState<DadosMesa | null>(null);
  const [erro, setErro] = useState('');
  const [carrinho, setCarrinho] = useState<Linha[]>(() => ls.ler(`bf:carrinho:${token}`, []));
  const [obsPedido, setObsPedido] = useState('');
  const [produtoAberto, setProdutoAberto] = useState<ProdutoMesa | null>(null);
  const [verCarrinho, setVerCarrinho] = useState(false);
  const [verConta, setVerConta] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<number | null>(null);
  const [catAtiva, setCatAtiva] = useState('');
  const listaRef = useRef<HTMLDivElement>(null);

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

  const porId = useMemo(() => new Map((dados?.produtos ?? []).map((p) => [p.id, p])), [dados]);

  // Tira do carrinho o que esgotou ou saiu do cardápio
  const carrinhoRef = useRef(carrinho);
  carrinhoRef.current = carrinho;
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
      if (Date.now() - ultimo < INATIVIDADE_MS) return;
      ultimo = Date.now();
      setCarrinho((c) => (c.length ? [] : c));
      setObsPedido('');
      setProdutoAberto(null);
      setVerCarrinho(false);
      setVerConta(false);
      setConfirmar(false);
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
    const { data, error } = await supabase.rpc('mesa_criar_pedido', {
      p_token: token,
      p_itens: carrinho.map((l) => ({ produto_id: l.produto_id, qtd: l.qtd, obs: l.obs })),
      p_obs: obsPedido,
    });
    setEnviando(false);
    setConfirmar(false);
    if (error) {
      toast(msgErro(error), 'erro');
      void carregar(true);
      return;
    }
    setCarrinho([]);
    setObsPedido('');
    setVerCarrinho(false);
    setSucesso((data as { numero: number }).numero);
    void carregar(true);
  }

  async function chamar(tipo: 'garcom' | 'conta') {
    const { error } = await supabase.rpc('mesa_chamar', { p_token: token, p_tipo: tipo });
    if (error) toast(msgErro(error), 'erro');
    else toast(tipo === 'conta' ? 'Pedimos a sua conta! Já já alguém vem até a mesa.' : 'Garçom chamado! Já já alguém vem até você.', 'ok');
  }

  function irPara(catId: string) {
    const lista = listaRef.current;
    const alvo = document.getElementById(`cat-${catId}`);
    if (lista && alvo) lista.scrollTo({ top: alvo.offsetTop - 12, behavior: 'smooth' });
  }

  function aoRolar() {
    const lista = listaRef.current;
    if (!lista) return;
    const secoes = lista.querySelectorAll<HTMLElement>('[data-cat]');
    const limite = lista.getBoundingClientRect().top + 120;
    let atual = secoes[0]?.dataset.cat ?? '';
    secoes.forEach((s) => { if (s.getBoundingClientRect().top <= limite) atual = s.dataset.cat!; });
    if (atual !== catAtiva) setCatAtiva(atual);
  }

  const telaCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  if (erro && !dados) {
    return (
      <div className="mesa-erro">
        <span className="mesa-erro__icone">🍽️</span>
        <h1 className="titulo">Ops, este tablet não está pronto</h1>
        <p>{erro}</p>
        <p className="muted">Por favor, chame um atendente.</p>
        <button className="btn btn--primario btn--lg" onClick={() => void carregar()}>Tentar de novo</button>
      </div>
    );
  }
  if (!dados) return <Carregando texto="Carregando cardápio…" />;

  const { restaurante, mesa, categorias, produtos } = dados;
  const ativa = catAtiva || categorias[0]?.id;

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
        <button className="btn btn--primario btn--lg btn--bloco" disabled={!carrinho.length} onClick={() => setConfirmar(true)}>
          Enviar pedido
        </button>
        {carrinho.length > 0 && (
          <button className="btn btn--fantasma btn--sm btn--bloco" onClick={() => setCarrinho([])}>
            <Trash2 size={16} /> Esvaziar
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="mesa" style={{ '--acento': restaurante.cor } as CSSProperties}>
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
          <button className="btn btn--contorno" onClick={() => void chamar('garcom')}>
            <ConciergeBell size={20} /> <span className="mesa__rotulo">Chamar garçom</span>
          </button>
          <button className="btn btn--contorno" onClick={() => setVerConta(true)}>
            <Receipt size={20} /> <span className="mesa__rotulo">Minha conta</span>
          </button>
          <button className="icone-btn" onClick={telaCheia} aria-label="Tela cheia" title="Tela cheia">
            <Maximize size={20} />
          </button>
        </div>
      </header>

      <div className="mesa__corpo">
        <nav className="mesa__cats" aria-label="Categorias">
          {categorias.map((c) => (
            <button key={c.id} className={cx('mesa__cat', ativa === c.id && 'ativa')} onClick={() => irPara(c.id)}>
              <span className="mesa__cat-emoji">{c.emoji}</span> {c.nome}
            </button>
          ))}
        </nav>

        <main className="mesa__lista" ref={listaRef} onScroll={aoRolar}>
          {restaurante.slogan && <p className="mesa__slogan">{restaurante.slogan}</p>}
          {categorias.map((c) => {
            const lista = produtos.filter((p) => p.categoria_id === c.id);
            if (!lista.length) return null;
            return (
              <section key={c.id} id={`cat-${c.id}`} data-cat={c.id} className="mesa__secao">
                <h2 className="titulo">{c.emoji} {c.nome}</h2>
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
                        <FotoProduto p={p} classe="prod__foto" />
                        {noCarrinho > 0 && <span className="prod__no-carrinho">{noCarrinho}</span>}
                        {!p.disponivel && <span className="prod__esgotado">Esgotado</span>}
                        <div className="prod__info">
                          <h3>{p.nome}</h3>
                          <p>{p.descricao}</p>
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
              </section>
            );
          })}
          {produtos.length === 0 && <p className="vazio">O cardápio ainda está sendo preparado. Chame um atendente.</p>}
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

      {verConta && <ModalConta token={token} aoFechar={() => setVerConta(false)} aoPedirConta={() => void chamar('conta')} />}

      {sucesso !== null && <TelaSucesso numero={sucesso} aoFechar={() => setSucesso(null)} />}
    </div>
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
      <FotoProduto p={p} classe="modal-produto__foto" />
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

function ModalConta({ token, aoFechar, aoPedirConta }: { token: string; aoFechar: () => void; aoPedirConta: () => void }) {
  const [conta, setConta] = useState<Conta | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    const carregar = async () => {
      const { data, error } = await supabase.rpc('mesa_conta', { p_token: token });
      if (!vivo) return;
      if (error) setErro(msgErro(error));
      else setConta(data as Conta);
    };
    void carregar();
    const i = setInterval(() => void carregar(), 10000);
    return () => { vivo = false; clearInterval(i); };
  }, [token]);

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

function TelaSucesso({ numero, aoFechar }: { numero: number; aoFechar: () => void }) {
  useEffect(() => {
    const t = setTimeout(aoFechar, 8000);
    return () => clearTimeout(t);
  }, [aoFechar]);

  return (
    <div className="sucesso" role="alertdialog" aria-label="Pedido enviado" onClick={aoFechar}>
      <CheckCircle2 size={88} className="sucesso__icone" />
      <h2 className="titulo">Pedido #{numero} enviado!</h2>
      <p>A cozinha já recebeu e o garçom foi avisado.<br />Acompanhe em “Minha conta”.</p>
      <button className="btn btn--primario btn--lg">Voltar ao cardápio</button>
    </div>
  );
}
