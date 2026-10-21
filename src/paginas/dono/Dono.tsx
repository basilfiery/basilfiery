import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight, BarChart3, Bell, BellRing, Check, Maximize2, TrendingUp, Palette, ChevronDown, ChevronRight, CircleHelp, ClipboardList, DollarSign, Eye, EyeOff, Home, LayoutGrid,
  Lock, LogOut, Moon, Radio, Receipt, Settings, ShieldCheck, Store, Sun, Target, Trophy, Wallet, XCircle, Zap,
} from 'lucide-react';
import { useAparencia } from '../../lib/aparencia';
import { Avatar } from '../../componentes/Perfil';
import { useToast } from '../../componentes/Toast';
import { useAppInstalavel } from '../../lib/manifesto';
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { tocarVenda } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Pedido, ResumoCaixa, RestauranteComPapel } from '../../lib/tipos';
import { STATUS_ROTULO, brl, cx, duracao, hora, inicioDoDia, lerPreco, ls, mascaraPreco, precoParaTexto, quando } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import { VERSAO_CURTA } from '../../lib/versao';
import { SITE } from '../../config/site';
import '../../estilos/dono.css';

/* =====================================================================
   App do dono (/dono): vendas ao vivo e relatório, no celular.
   ===================================================================== */

const MARCA = 'BasilFiery';
const ICONE = '/icone-512.png';

type ItemVenda = { nome: string; qtd: number; produto: { imagem_url: string | null; emoji: string | null } | null };
type Venda = Omit<Pedido, 'pedido_itens'> & { pedido_itens: ItemVenda[] };
interface Relatorio {
  resumo: { faturamento: number; pedidos: number; ticket_medio: number; itens: number; recebido: number; em_aberto: number };
  cancelados: { pedidos: number; valor: number };
  por_dia: { dia: string; faturamento: number; pedidos: number }[];
  por_hora: { hora: number; faturamento: number; pedidos: number }[];
  top_produtos: { nome: string; qtd: number; faturamento: number }[];
}
interface Lucro {
  receita: number; custo: number; descontos: number; lucro: number; itens_sem_custo: number; produtos_sem_custo: string[];
  por_dia: { dia: string; receita: number; custo: number; lucro: number }[];
}

const SELECT_VENDA = '*, pedido_itens(nome, qtd, produto:produtos(imagem_url, emoji))';
const sessao = {
  ler: (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  gravar: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* sem armazenamento */ } },
};

function useFonte() {
  useEffect(() => {
    if (document.getElementById('fonte-dono')) return;
    const l = document.createElement('link');
    l.id = 'fonte-dono';
    l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
  }, []);
}

/** Número que "corre" até o valor novo (como no app quando entra dinheiro). */
function useContador(valor: number, duracao = 700) {
  const [atual, setAtual] = useState(valor);
  const deRef = useRef(valor);
  useEffect(() => {
    const de = deRef.current;
    if (de === valor) return;
    const inicio = performance.now();
    let quadro = 0;
    const passo = (t: number) => {
      const k = Math.min(1, (t - inicio) / duracao);
      const v = de + (valor - de) * (1 - Math.pow(1 - k, 3));
      setAtual(v);
      if (k < 1) quadro = requestAnimationFrame(passo);
      else deRef.current = valor;
    };
    quadro = requestAnimationFrame(passo);
    return () => { cancelAnimationFrame(quadro); deRef.current = valor; };
  }, [valor, duracao]);
  return atual;
}

const rotuloDia = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date(inicioDoDia());
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (dia === hoje.getTime()) return 'Hoje';
  if (dia === hoje.getTime() - 86400000) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
};
const chaveDia = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/* ---------------------------------------------------------------- */


/* ---------- Cor do app (o dono escolhe; padrão: a cor da loja) ---------- */
const TEMAS = [
  { id: 'loja', nome: 'Da loja' },
  { id: 'verde', nome: 'Verde', cores: ['#12b76a', '#32d583', '#0a8a4f'] },
  { id: 'vermelho', nome: 'Vermelho', cores: ['#e5383b', '#ff6b6b', '#a4161a'] },
  { id: 'laranja', nome: 'Laranja', cores: ['#f76707', '#ff922b', '#b54708'] },
  { id: 'dourado', nome: 'Dourado', cores: ['#d4a017', '#f2c94c', '#8f6b0e'] },
  { id: 'rosa', nome: 'Rosa', cores: ['#e8458b', '#f472b6', '#a61e5d'] },
  { id: 'roxo', nome: 'Roxo', cores: ['#7a5af8', '#a48afb', '#5925dc'] },
  { id: 'azul', nome: 'Azul', cores: ['#2e90fa', '#53b1fd', '#1849a9'] },
] as const;
type TemaId = (typeof TEMAS)[number]['id'];
type Cores = [string, string, string];

function coresDoTema(id: TemaId, corLoja: string | null | undefined): Cores {
  const t = TEMAS.find((x) => x.id === id);
  if (t && 'cores' in t) return [...t.cores];
  const c = /^#[0-9a-f]{6}$/i.test(corLoja ?? '') ? corLoja! : '#12b76a';
  return [c, `color-mix(in srgb, ${c} 72%, #fff)`, `color-mix(in srgb, ${c} 66%, #000)`];
}

/** Aplica a cor em todo o app do dono (inclusive na abertura e no login da próxima vez). */
function aplicarCores(cores: Cores) {
  const r = document.documentElement.style;
  r.setProperty('--tema-dono-1', cores[0]);
  r.setProperty('--tema-dono-2', cores[1]);
  r.setProperty('--tema-dono-3', cores[2]);
  ls.gravar('bf:dono:tema-cores', cores);
}

export default function Dono() {
  const s = useSessao();
  useFonte();
  // O app instalado leva o nome da empresa (é o nome que o celular mostra nas notificações)
  const nomeEmpresa = s.restaurante?.nome?.trim() || MARCA;
  useAppInstalavel({ nome: nomeEmpresa, curto: nomeEmpresa.slice(0, 15), inicio: '/dono', escopo: '/dono' });
  const [abertura, setAbertura] = useState(() => sessao.ler('bf:dono:abertura') !== '1');
  // Última cor escolhida já vale na abertura e no login
  useEffect(() => {
    const salvas = ls.ler<Cores | null>('bf:dono:tema-cores', null);
    if (salvas?.length === 3) aplicarCores(salvas);
    return () => ['--tema-dono-1', '--tema-dono-2', '--tema-dono-3'].forEach((v) => document.documentElement.style.removeProperty(v));
  }, []);

  useEffect(() => {
    const cor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const antes = cor?.content;
    if (cor) cor.content = '#0a0a0a';
    return () => { if (cor && antes) cor.content = antes; };
  }, []);

  if (abertura) {
    return <Abertura aoTerminar={() => { sessao.gravar('bf:dono:abertura', '1'); setAbertura(false); }} />;
  }
  if (s.carregando) return <div className="dn dn-vazio" />;
  if (!s.usuario) return <Entrada />;

  const meus = s.restaurantes.filter((r) => r.papel === 'dono');
  if (!meus.length) return <SemAcesso email={s.usuario.email ?? ''} aoSair={() => void s.sair()} />;
  return <AppDono restaurantes={meus} />;
}

/* ---------- Abertura: nome → ícone com brilho → desliza ---------- */
function Abertura({ aoTerminar }: { aoTerminar: () => void }) {
  useEffect(() => {
    const t = setTimeout(aoTerminar, 2700);
    return () => clearTimeout(t);
  }, [aoTerminar]);
  const letras = MARCA.split('');
  return (
    <div className="dn dn-abertura" onClick={aoTerminar}>
      <div className="dn-abertura__palco">
        <div className="dn-abertura__marca" aria-label={MARCA}>
          {letras.map((l, i) => (
            <span key={i} style={{ '--i': i, '--d': i - (letras.length - 1) / 2 } as CSSProperties}>{l}</span>
          ))}
        </div>
        <span className="dn-abertura__brilho" aria-hidden="true" />
        <img className="dn-abertura__icone" src={ICONE} alt="" />
      </div>
    </div>
  );
}

/* ---------- Entrada (sem login): boas-vindas → acesso → login ---------- */
function Entrada() {
  const [etapa, setEtapa] = useState<'boas' | 'acesso'>(() => (sessao.ler('bf:dono:viu-boas') ? 'acesso' : 'boas'));
  const [login, setLogin] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  if (etapa === 'boas') {
    return (
      <div className="dn dl dl--boas dn-entra">
        <div className="dl-fundo" aria-hidden="true" />
        <MarcaLogin />
        <h1 className="dl-titulo">Suas vendas<br /><em>na palma da mão.</em></h1>
        <p className="dl-texto">Acompanhe o seu restaurante ao<br />vivo, de onde estiver.</p>
        <div className="dl-espaco" />
        <button className="dl-botao" onClick={() => { sessao.gravar('bf:dono:viu-boas', '1'); setEtapa('acesso'); }}>
          <Lock size={21} />
          <span>Acessar minha conta</span>
          <ChevronRight size={22} />
        </button>
        <ul className="dl-recursos">
          <li><span><ShieldCheck size={22} /></span><b>Seguro</b><small>Só você, dono, tem acesso.</small></li>
          <li><span><Zap size={22} fill="currentColor" /></span><b>Ao vivo</b><small>Cada venda na hora em que acontece.</small></li>
          <li><span><BarChart3 size={22} /></span><b>Completo</b><small>Relatórios do dia, semana e mês.</small></li>
        </ul>
        <div className="dl-versao"><i /><small>v{VERSAO_CURTA}</small><i /></div>
      </div>
    );
  }

  return (
    <div className="dn dl dl--acesso dn-entra">
      <div className="dl-fundo" aria-hidden="true" />
      <MarcaLogin espacada />
      <h1 className="dl-titulo dl-titulo--grande">Sua gestão<br />de vendas,<br /><em>mais inteligente.</em></h1>
      <p className="dl-texto">Acompanhe em tempo real<br />tudo que acontece no seu<br />estabelecimento.</p>
      <div className="dl-espaco" />
      <section className="dl-cartao">
        <h2>Acesse sua conta</h2>
        <p>Entrar para acompanhar vendas, pedidos e caixa.</p>
        <div className="dl-atalhos">
          {[
            { i: <BarChart3 size={26} />, t: 'Vendas', d: 'Acompanhe em tempo real' },
            { i: <ClipboardList size={26} />, t: 'Pedidos', d: 'Controle todos os pedidos' },
            { i: <Wallet size={26} />, t: 'Caixa', d: 'Abertura, venda e movimentação' },
            { i: <ClipboardList size={26} />, t: 'Relatórios', d: 'Resultados do dia, semana e mês' },
          ].map((x, n) => (
            <span key={x.t} style={{ animationDelay: `${0.3 + n * 0.1}s` }}>{x.i}<b>{x.t}</b><small>{x.d}</small></span>
          ))}
        </div>
        <button className="dl-botao" onClick={() => setLogin(true)}>
          <Lock size={21} />
          <span>Acessar minha conta</span>
          <ArrowRight size={22} />
        </button>
        <button className="dl-ajuda" onClick={() => setAjuda(true)}><span>Precisa de ajuda?</span><ChevronRight size={18} /></button>
      </section>
      <div className="dl-versao"><i /><small>v{VERSAO_CURTA}</small><i /></div>
      {login && <FolhaLogin aoFechar={() => setLogin(false)} aoAjuda={() => setAjuda(true)} />}
      {ajuda && <FolhaAjuda aoFechar={() => setAjuda(false)} />}
    </div>
  );
}

/** Logo da tela de entrada: mascote + "BasilFiery" + "Pizzaria & Conveniência". */
function MarcaLogin({ espacada }: { espacada?: boolean }) {
  return (
    <header className={cx('dl-marca', espacada && 'dl-marca--espacada')}>
      <img src="/dono-mascote.png" alt="" />
      <div>
        <strong>Basil<span>Fiery</span></strong>
        <small>Pizzaria &amp; Conveniência</small>
      </div>
    </header>
  );
}

/** Folha que sobe de baixo (login, meta, avisos, ajuda). */
function Folha({ aoFechar, children, alta, classe }: { aoFechar: () => void; children: ReactNode; alta?: boolean; classe?: string }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => { setSaindo(true); setTimeout(aoFechar, 220); };
  // Teclado do celular aberto: a folha sobe junto (no iPhone ele cobre a tela sem empurrar nada)
  const [teclado, setTeclado] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const medir = () => setTeclado(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    medir();
    vv.addEventListener('resize', medir);
    vv.addEventListener('scroll', medir);
    return () => { vv.removeEventListener('resize', medir); vv.removeEventListener('scroll', medir); };
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  });
  return (
    <div className={cx('dn-folha-fundo', saindo && 'saindo', teclado > 80 && 'com-teclado')} style={teclado > 80 ? { paddingBottom: teclado } : undefined} onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className={cx('dn-folha', alta && 'dn-folha--alta', classe, saindo && 'saindo')} role="dialog" aria-modal="true">
        <button className="dn-folha__alca" onClick={fechar} aria-label="Fechar" />
        {children}
      </div>
    </div>
  );
}

function FolhaLogin({ aoFechar, aoAjuda }: { aoFechar: () => void; aoAjuda: () => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) {
      setErro(msgErro(error));
      setOcupado(false);
    }
  }

  return (
    <Folha aoFechar={aoFechar} alta>
      <form className="dn-login" onSubmit={entrar}>
        <h2>Acesse sua conta</h2>
        <p>Digite seu e-mail e senha para continuar.</p>
        <label>
          <span>Email</span>
          <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Digite seu e-mail" autoFocus />
        </label>
        <label>
          <span>Senha</span>
          <div className="dn-campo-senha">
            <input type={ver ? 'text' : 'password'} autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Digite sua senha" />
            <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder senha' : 'Mostrar senha'}>{ver ? <Eye size={19} /> : <EyeOff size={19} />}</button>
          </div>
        </label>
        <button type="button" className="dn-link" onClick={aoAjuda}>Não sei minha senha</button>
        {erro && <p className="dn-erro" role="alert">{erro}</p>}
        <button className="dn-botao" disabled={ocupado}>
          {ocupado ? <><span className="dn-giro" /> Entrando</> : 'Entrar'}
        </button>
      </form>
    </Folha>
  );
}

function FolhaAjuda({ aoFechar }: { aoFechar: () => void }) {
  const whats = SITE.whatsappVendas ? `https://wa.me/${SITE.whatsappVendas}?text=${encodeURIComponent('Olá! Preciso de ajuda com o app do dono do BasilFiery.')}` : '';
  return (
    <Folha aoFechar={aoFechar}>
      <div className="dn-folha__centro">
        <span className="dn-folha__icone"><CircleHelp size={26} /></span>
        <h2>Precisa de ajuda?</h2>
        <p>Este app é só para o <b>dono</b> do restaurante. Use o mesmo e-mail e senha do sistema. Esqueceu a senha? Fale com o suporte do {MARCA} para redefinir.</p>
        {whats
          ? <a className="dn-botao" href={whats} target="_blank" rel="noopener">Falar no WhatsApp</a>
          : <button className="dn-botao" onClick={aoFechar}>Entendi</button>}
      </div>
    </Folha>
  );
}

function SemAcesso({ email, aoSair }: { email: string; aoSair: () => void }) {
  return (
    <div className="dn dn-boas dn-entra">
      <header className="dn-logo"><img src={ICONE} alt="" /><span>{MARCA}</span></header>
      <h1 className="dn-boas__titulo">Acesso só<br /><em>do dono.</em></h1>
      <p className="dn-boas__texto">A conta <b>{email}</b> não é dona de nenhum restaurante. Este app mostra as vendas apenas para o dono.</p>
      <div className="dn-espaco" />
      <button className="dn-pilula" onClick={aoSair}><LogOut size={18} /><span>Entrar com outra conta</span><ChevronRight size={18} /></button>
      <small className="dn-versao">v{VERSAO_CURTA}</small>
    </div>
  );
}

/* =====================================================================
   App (logado)
   ===================================================================== */
type Aba = 'inicio' | 'vendas' | 'aovivo' | 'relatorios' | 'ajustes';

function AppDono({ restaurantes }: { restaurantes: RestauranteComPapel[] }) {
  const s = useSessao();
  const toast = useToast();
  const [restId, setRestId] = useState(() => {
    const salvo = ls.ler<string | null>('bf:dono:rest', null);
    return restaurantes.some((r) => r.id === salvo) ? salvo! : restaurantes[0].id;
  });
  const rest = restaurantes.find((r) => r.id === restId) ?? restaurantes[0];
  const [aba, setAba] = useState<Aba>('inicio');
  const [oculto, setOcultoEstado] = useState(() => ls.ler('bf:dono:oculto', false));
  const setOculto = (v: boolean) => { setOcultoEstado(v); ls.gravar('bf:dono:oculto', v); };
  const [aviso, setAviso] = useState<Pedido | null>(null);
  const [perguntaAvisos, setPerguntaAvisos] = useState(false);
  const [versao, setVersao] = useState(0);
  const [tema, setTemaEstado] = useState<TemaId>(() => ls.ler<TemaId>('bf:dono:tema', 'loja'));
  const setTema = (id: TemaId) => { setTemaEstado(id); ls.gravar('bf:dono:tema', id); };
  useEffect(() => { aplicarCores(coresDoTema(tema, rest.cor)); }, [tema, rest.cor]);
  // Claro ou escuro (Ajustes › Modo claro): escolha deste celular
  useAparencia('dono', true);

  const vivo = usePedidosAoVivo(rest.id, {
    aoNovoPedido: (p) => {
      tocarVenda();
      setAviso(p);
      setVersao((v) => v + 1);
    },
  });
  // Qualquer mudança nos pedidos (pago, cancelado…) atualiza os números
  const assinatura = useMemo(() => vivo.pedidos.map((p) => `${p.id}:${p.status}:${p.pago_em ?? ''}`).join('|'), [vivo.pedidos]);
  useEffect(() => { setVersao((v) => v + 1); }, [assinatura]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4500);
    return () => clearTimeout(t);
  }, [aviso]);

  // Pergunta uma vez se quer receber os avisos de venda (como o "Entrar com Face ID?")
  useEffect(() => {
    if (ls.ler('bf:dono:perguntou-avisos', false)) return;
    const t = setTimeout(() => void estadoPush().then((e) => { if (e !== 'ativo' && e !== 'indisponivel') setPerguntaAvisos(true); }), 1600);
    return () => clearTimeout(t);
  }, []);

  const valor = (v: number) => (oculto ? 'R$ ••••' : brl(v));
  const trocar = (id: string) => { setRestId(id); ls.gravar('bf:dono:rest', id); };

  return (
    <div className="dn dn-app">
      <div className="dn-app__tela" key={aba}>
        {aba === 'inicio' && (
          <Inicio
            rest={rest}
            nome={s.nome}
            foto={s.foto}
            oculto={oculto}
            setOculto={setOculto}
            valor={valor}
            versao={versao}
            ir={setAba}
            aoSino={() => setPerguntaAvisos(true)}
          />
        )}
        {aba === 'vendas' && <Vendas rest={rest} valor={valor} versao={versao} />}
        {aba === 'aovivo' && <AoVivo pedidos={vivo.pedidos} conectado={vivo.conectado} valor={valor} />}
        {aba === 'relatorios' && <Relatorios rest={rest} valor={valor} versao={versao} />}
        {aba === 'ajustes' && (
          <Ajustes
            tema={tema}
            setTema={setTema}
            rest={rest}
            restaurantes={restaurantes}
            trocar={trocar}
            oculto={oculto}
            setOculto={setOculto}
            aoSair={() => void s.sair()}
            avisarErro={(m) => toast(m, 'erro')}
          />
        )}
      </div>

      {aviso && (
        <button className="dn-nova-venda" onClick={() => { setAviso(null); setAba('aovivo'); }}>
          <span className="dn-nova-venda__icone"><DollarSign size={20} /></span>
          <span><b>Nova venda!</b><small>{aviso.mesa_nome} · pedido #{aviso.numero}</small></span>
          <strong>+ {valor(Number(aviso.total))}</strong>
        </button>
      )}

      <nav className="dn-abas" aria-label="Navegação">
        <button className={cx(aba === 'inicio' && 'ativa')} onClick={() => setAba('inicio')}><Home size={21} /><span>Início</span></button>
        <button className={cx(aba === 'vendas' && 'ativa')} onClick={() => setAba('vendas')}><DollarSign size={21} /><span>Vendas</span></button>
        <button className={cx('dn-abas__centro', aba === 'aovivo' && 'ativa')} onClick={() => setAba('aovivo')} aria-label="Ao vivo">
          <img src={ICONE} alt="" />
        </button>
        <button className={cx(aba === 'relatorios' && 'ativa')} onClick={() => setAba('relatorios')}><BarChart3 size={21} /><span>Relatórios</span></button>
        <button className={cx(aba === 'ajustes' && 'ativa')} onClick={() => setAba('ajustes')}><Settings size={21} /><span>Ajustes</span></button>
      </nav>

      {perguntaAvisos && (
        <FolhaAvisos
          restId={rest.id}
          aoFechar={() => { ls.gravar('bf:dono:perguntou-avisos', true); setPerguntaAvisos(false); }}
        />
      )}
    </div>
  );
}

/* ---------- Início ---------- */
function Inicio({ rest, nome, foto, oculto, setOculto, valor, versao, ir, aoSino }: {
  rest: RestauranteComPapel;
  nome: string;
  foto: string | null;
  oculto: boolean;
  setOculto: (v: boolean) => void;
  valor: (v: number) => string;
  versao: number;
  ir: (a: Aba) => void;
  aoSino: () => void;
}) {
  const chaveMeta = `bf:dono:meta:${rest.id}`;
  const [meta, setMetaEstado] = useState<number | null>(() => ls.ler<number | null>(chaveMeta, null));
  const [editMeta, setEditMeta] = useState(false);
  const [mes, setMes] = useState<number | null>(null);
  const [caixa, setCaixa] = useState<ResumoCaixa | null | undefined>(undefined);
  const [ultimas, setUltimas] = useState<Venda[] | null>(null);

  const carregar = useCallback(async () => {
    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const amanha = new Date(new Date(inicioDoDia()).getTime() + 86400000);
    const [r, c, u] = await Promise.all([
      supabase.rpc('relatorio_vendas', { p_rest: rest.id, p_inicio: inicioMes.toISOString(), p_fim: amanha.toISOString() }),
      supabase.rpc('caixa_atual', { p_rest: rest.id }),
      supabase.from('pedidos').select(SELECT_VENDA).eq('restaurante_id', rest.id).order('criado_em', { ascending: false }).limit(25),
    ]);
    if (r.data) setMes(Number((r.data as Relatorio).resumo.faturamento));
    setCaixa((c.data as ResumoCaixa | null) ?? null);
    setUltimas((u.data ?? []) as Venda[]);
  }, [rest.id]);
  useEffect(() => { void carregar(); }, [carregar, versao]);

  const fat = useContador(mes ?? 0);
  const pct = meta ? Math.min(100, ((mes ?? 0) / meta) * 100) : 0;
  const falta = meta ? Math.max(0, meta - (mes ?? 0)) : 0;
  const primeiroNome = (nome || 'Dono').split(' ')[0];

  return (
    <div className="dn-pagina dn-inicio">
      <header className="dn-topo">
        <span className="dn-topo__avatar"><Avatar nome={nome || 'Dono'} foto={foto} tamanho={44} /></span>
        <div className="dn-topo__ola">
          <span>Olá, {primeiroNome}</span>
          <small>{rest.nome}</small>
        </div>
        <button className="dn-icone" onClick={() => setOculto(!oculto)} aria-label={oculto ? 'Mostrar valores' : 'Esconder valores'}>
          {oculto ? <EyeOff size={21} /> : <Eye size={21} />}
        </button>
        <button className="dn-icone" onClick={aoSino} aria-label="Avisos de venda"><Bell size={21} /></button>
      </header>

      <section className="dn-faturamento">
        <div className="dn-faturamento__cab">
          <span>Faturamento do mês</span>
          <span className="dn-medalha"><Trophy size={17} /></span>
        </div>
        {mes === null ? <div className="dn-esq dn-esq--valor" /> : (
          <div className="dn-faturamento__linha">
            <div>
              <strong className="dn-faturamento__valor">{oculto ? 'R$ ••••' : brl(fat)}</strong>
              <small>{meta ? `de ${valor(meta)}` : 'sem meta definida'}</small>
            </div>
            {meta && <div className="dn-faturamento__pct"><b>{Math.floor(pct)}%</b><small>da meta</small></div>}
          </div>
        )}
        <div className="dn-barra"><span style={{ width: `${meta ? Math.max(pct, 3) : 0}%` }} /></div>
        <button className="dn-faturamento__rodape" onClick={() => setEditMeta(true)}>
          {meta
            ? falta > 0 ? <span>Faltam <b>{valor(falta)}</b> para a meta do mês</span> : <span><b>Meta batida!</b> Parabéns 🎉</span>
            : <span>Defina uma <b>meta para o mês</b></span>}
          <ChevronRight size={17} />
        </button>
      </section>

      <div className="dn-acoes">
        <button onClick={() => ir('relatorios')}><BarChart3 size={20} /><span>Relatórios</span></button>
        <button onClick={() => ir('vendas')}><Receipt size={20} /><span>Vendas</span></button>
        <button onClick={() => ir('aovivo')}><Radio size={20} /><span>Ao vivo</span></button>
        <a href="/painel"><LayoutGrid size={20} /><span>Sistema</span></a>
      </div>

      {caixa !== undefined && (
        <div className={cx('dn-faixa', caixa && 'dn-faixa--ok')}>
          <span className="dn-faixa__icone">{caixa ? <Wallet size={17} /> : <Lock size={17} />}</span>
          {caixa ? (
            <span><b>Caixa aberto há {duracao(caixa.aberto_em)}</b><small>Desde {quando(caixa.aberto_em)} · {valor(Number(caixa.recebido))} recebido · {valor(Number(caixa.em_aberto.total))} em mesas abertas</small></span>
          ) : (
            <span><b>Caixa fechado</b><small>Abra o caixa no computador para receber as contas.</small></span>
          )}
        </div>
      )}

      <div className="dn-secao-cab">
        <h2>Últimas vendas</h2>
        <button onClick={() => ir('vendas')}>Ver todas</button>
      </div>
      <ListaVendas vendas={ultimas} valor={valor} />

      {editMeta && (
        <FolhaMeta
          atual={meta}
          aoFechar={() => setEditMeta(false)}
          aoSalvar={(v) => { setMetaEstado(v); ls.gravar(chaveMeta, v); setEditMeta(false); }}
        />
      )}
    </div>
  );
}

function ListaVendas({ vendas, valor, vazio = 'Nenhuma venda ainda.' }: { vendas: Venda[] | null; valor: (v: number) => string; vazio?: string }) {
  if (!vendas) return <Esqueleto />;
  if (!vendas.length) return <p className="dn-vazio-lista">{vazio}</p>;
  const grupos: { chave: string; rotulo: string; itens: Venda[] }[] = [];
  for (const v of vendas) {
    const k = chaveDia(v.criado_em);
    const g = grupos.find((x) => x.chave === k);
    if (g) g.itens.push(v);
    else grupos.push({ chave: k, rotulo: rotuloDia(v.criado_em), itens: [v] });
  }
  return (
    <div className="dn-vendas">
      {grupos.map((g) => (
        <div key={g.chave}>
          <h3 className="dn-vendas__dia">{g.rotulo}</h3>
          <ul>{g.itens.map((v) => <LinhaVenda key={v.id} v={v} valor={valor} />)}</ul>
        </div>
      ))}
    </div>
  );
}

function LinhaVenda({ v, valor }: { v: Venda; valor: (v: number) => string }) {
  const itens = v.pedido_itens ?? [];
  const primeiro = itens[0];
  const foto = itens.find((i) => i.produto?.imagem_url)?.produto?.imagem_url;
  const titulo = primeiro ? `${primeiro.qtd > 1 ? `${primeiro.qtd}× ` : ''}${primeiro.nome}${itens.length > 1 ? ` + ${itens.length - 1}` : ''}` : `Pedido #${v.numero}`;
  const cancelado = v.status === 'cancelado';
  const [aberto, setAberto] = useState(false);
  return (
    <li className={cx('dn-venda', cancelado && 'dn-venda--cancelada')} role="button" tabIndex={0} onClick={() => setAberto(true)} onKeyDown={(e) => e.key === 'Enter' && setAberto(true)}>
      <span className="dn-venda__foto">
        {foto ? <img src={foto} alt="" loading="lazy" /> : <span>{primeiro?.produto?.emoji || v.mesa_nome.replace(/\D/g, '').slice(0, 2) || '#'}</span>}
      </span>
      <div className="dn-venda__info">
        <strong>{titulo}</strong>
        <small>{v.mesa_nome} · #{v.numero}{v.pago_em ? ' · pago' : ''}</small>
      </div>
      <div className="dn-venda__valor">
        <small>{hora(v.criado_em)}</small>
        <strong>{cancelado ? 'Cancelado' : `+ ${valor(Number(v.total))}`}</strong>
      </div>
      {aberto && <FolhaVenda id={v.id} aoFechar={() => setAberto(false)} />}
    </li>
  );
}

function Esqueleto({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="dn-esqueleto" aria-label="Carregando">
      <div className="dn-esq dn-esq--dia" />
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="dn-esqueleto__linha">
          <div className="dn-esq dn-esq--bola" />
          <div className="dn-esqueleto__meio"><div className="dn-esq" /><div className="dn-esq dn-esq--curta" /></div>
          <div className="dn-esqueleto__fim"><div className="dn-esq dn-esq--mini" /><div className="dn-esq" /></div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Períodos ---------- */
type Periodo = 'hoje' | '7' | '15' | '30' | 'mes';
const PERIODOS: { id: Periodo; rotulo: string }[] = [
  { id: 'hoje', rotulo: 'Hoje' }, { id: '7', rotulo: '7 D' }, { id: '15', rotulo: '15 D' }, { id: '30', rotulo: '30 D' }, { id: 'mes', rotulo: 'Mês' },
];
function intervalo(p: Periodo) {
  const hoje = new Date(inicioDoDia());
  const fim = new Date(hoje.getTime() + 86400000);
  if (p === 'hoje') return { inicio: hoje, fim };
  if (p === 'mes') return { inicio: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim };
  return { inicio: new Date(hoje.getTime() - (Number(p) - 1) * 86400000), fim };
}
function SeletorPeriodo({ valor, aoMudar }: { valor: Periodo; aoMudar: (p: Periodo) => void }) {
  return (
    <div className="dn-periodo" role="tablist">
      {PERIODOS.map((p) => (
        <button key={p.id} role="tab" aria-selected={valor === p.id} className={cx(valor === p.id && 'ativo')} onClick={() => aoMudar(p.id)}>{p.rotulo}</button>
      ))}
    </div>
  );
}

/* ---------- Vendas ---------- */
type Filtro = 'todas' | 'pagas' | 'abertas' | 'canceladas';
function Vendas({ rest, valor, versao }: { rest: RestauranteComPapel; valor: (v: number) => string; versao: number }) {
  const [periodo, setPeriodo] = useState<Periodo>('hoje');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    const { inicio, fim } = intervalo(periodo);
    const { data } = await supabase.from('pedidos').select(SELECT_VENDA).eq('restaurante_id', rest.id)
      .gte('criado_em', inicio.toISOString()).lt('criado_em', fim.toISOString())
      .order('criado_em', { ascending: false }).limit(600);
    setVendas((data ?? []) as Venda[]);
  }, [rest.id, periodo]);
  useEffect(() => { setVendas(null); }, [periodo]);
  useEffect(() => { void carregar(); }, [carregar, versao]);

  const lista = (vendas ?? []).filter((v) =>
    filtro === 'todas' ? true
      : filtro === 'pagas' ? !!v.pago_em && v.status !== 'cancelado'
        : filtro === 'abertas' ? !v.pago_em && v.status !== 'cancelado'
          : v.status === 'cancelado');
  const validas = (vendas ?? []).filter((v) => v.status !== 'cancelado');
  const total = validas.reduce((s, v) => s + Number(v.total), 0);

  const grupos: { chave: string; rotulo: string; itens: Venda[] }[] = [];
  for (const v of lista) {
    const k = chaveDia(v.criado_em);
    const g = grupos.find((x) => x.chave === k);
    if (g) g.itens.push(v);
    else grupos.push({ chave: k, rotulo: rotuloDia(v.criado_em), itens: [v] });
  }
  const aberto = (k: string, i: number) => abertos.has(k) || (abertos.size === 0 && i === 0);
  const alternar = (k: string, i: number) => setAbertos((x) => {
    const n = new Set(x.size === 0 && i !== 0 && grupos[0] ? [grupos[0].chave] : x);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  return (
    <div className="dn-pagina">
      <h1 className="dn-titulo">Vendas</h1>
      <section className="dn-resumo">
        <div>
          <small>Vendido no período</small>
          <strong>{vendas ? valor(total) : '—'}</strong>
        </div>
        <span className="dn-resumo__selo">{validas.length} {validas.length === 1 ? 'venda' : 'vendas'}</span>
      </section>
      <span className="dn-rotulo">Período</span>
      <SeletorPeriodo valor={periodo} aoMudar={setPeriodo} />
      <div className="dn-filtros">
        {([['pagas', 'Pagas'], ['abertas', 'Em aberto'], ['canceladas', 'Canceladas']] as const).map(([id, r]) => (
          <button key={id} className={cx(filtro === id && 'ativo')} onClick={() => setFiltro(filtro === id ? 'todas' : id)}>{r}</button>
        ))}
      </div>
      {!vendas ? <Esqueleto /> : grupos.length === 0 ? <p className="dn-vazio-lista">Nenhuma venda neste período.</p> : (
        <div className="dn-grupos">
          {grupos.map((g, i) => {
            const pagas = g.itens.filter((v) => v.pago_em && v.status !== 'cancelado').length;
            const abertas = g.itens.filter((v) => !v.pago_em && v.status !== 'cancelado').length;
            const canc = g.itens.filter((v) => v.status === 'cancelado').length;
            const soma = g.itens.filter((v) => v.status !== 'cancelado').reduce((s, v) => s + Number(v.total), 0);
            return (
              <div key={g.chave} className="dn-grupo">
                <button className="dn-grupo__cab" onClick={() => alternar(g.chave, i)} aria-expanded={aberto(g.chave, i)}>
                  <span className="dn-grupo__nome">{g.rotulo}<small>{valor(soma)}</small></span>
                  <span className="dn-grupo__contas">
                    <span className="ok"><Check size={13} />{pagas}</span>
                    <span className="esp"><Radio size={13} />{abertas}</span>
                    <span className="nao"><XCircle size={13} />{canc}</span>
                  </span>
                  {aberto(g.chave, i) ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                {aberto(g.chave, i) && <ul className="dn-grupo__itens">{g.itens.map((v) => <LinhaVenda key={v.id} v={v} valor={valor} />)}</ul>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Ao vivo ---------- */
function AoVivo({ pedidos, conectado, valor }: { pedidos: Pedido[]; conectado: boolean; valor: (v: number) => string }) {
  const hoje = new Date(inicioDoDia()).getTime();
  const doDia = pedidos.filter((p) => new Date(p.criado_em).getTime() >= hoje).sort((a, b) => b.criado_em.localeCompare(a.criado_em));
  const validos = doDia.filter((p) => p.status !== 'cancelado');
  const total = validos.reduce((s, p) => s + Number(p.total), 0);
  const contado = useContador(total);
  const ticket = validos.length ? total / validos.length : 0;
  const mesas = new Set(doDia.filter((p) => !p.pago_em && p.status !== 'cancelado').map((p) => p.mesa_nome)).size;
  const [verId, setVerId] = useState<string | null>(null);

  return (
    <div className="dn-pagina dn-aovivo">
      <div className="dn-aovivo__cab">
        <h1 className="dn-titulo">Ao vivo</h1>
        <span className={cx('dn-pulso', conectado && 'on')}>{conectado ? 'Conectado' : 'Reconectando…'}</span>
      </div>
      <section className="dn-aovivo__total">
        <small>Vendido hoje</small>
        <strong>{valor(contado)}</strong>
        <div className="dn-aovivo__numeros">
          <span><b>{validos.length}</b> pedidos</span>
          <span><b>{valor(ticket)}</b> ticket médio</span>
          <span><b>{mesas}</b> {mesas === 1 ? 'mesa aberta' : 'mesas abertas'}</span>
        </div>
      </section>
      <div className="dn-secao-cab"><h2>Pedidos de hoje</h2></div>
      {doDia.length === 0 ? <p className="dn-vazio-lista">Assim que chegar um pedido, ele aparece aqui na hora.</p> : (
        <ul className="dn-feed">
          {doDia.map((p) => (
            <li key={p.id} className={cx('dn-feed__item', p.status === 'cancelado' && 'cancelado')} role="button" tabIndex={0} onClick={() => setVerId(p.id)} onKeyDown={(e) => e.key === 'Enter' && setVerId(p.id)}>
              <span className={cx('dn-feed__ponto', `st-${p.pago_em ? 'pago' : p.status}`)} />
              <div className="dn-feed__info">
                <strong>{p.mesa_nome} · #{p.numero}</strong>
                <small>{(p.pedido_itens ?? []).map((i) => `${i.qtd}× ${i.nome}`).join(', ') || '—'}</small>
              </div>
              <div className="dn-feed__fim">
                <small>{hora(p.criado_em)} · {p.pago_em ? 'Pago' : STATUS_ROTULO[p.status]}</small>
                <strong>{p.status === 'cancelado' ? '—' : `+ ${valor(Number(p.total))}`}</strong>
              </div>
            </li>
          ))}
        </ul>
      )}
      {verId && <FolhaVenda id={verId} aoFechar={() => setVerId(null)} />}
    </div>
  );
}

/* ---------- Detalhes de uma venda (toque na linha) ---------- */
type ItemDetalhe = { id: string; nome: string; qtd: number; preco_unit: number; obs: string | null; complementos: string | null; produto: { imagem_url: string | null; emoji: string | null; preco: number; preco_de: number | null } | null };
type PedidoDetalhe = Omit<Pedido, 'pedido_itens'> & { cancel_motivo?: string | null; pedido_itens: ItemDetalhe[]; pagamento: { forma: string; valor: number } | null };
type CanceladoDetalhe = { id: string; nome: string; qtd: number; valor: number; motivo: string | null; pedido_inteiro: boolean; por: string | null; criado_em: string };
const FORMA_ROTULO: Record<string, string> = { pix: 'Pix', dinheiro: 'Dinheiro', credito: 'Cartão de crédito', debito: 'Cartão de débito' };
const TIPO_ROTULO: Record<string, string> = { mesa: 'Mesa', delivery: 'Delivery', retirada: 'Retirada no balcão', balcao: 'Balcão (PDV)' };

/** Abre por cima de tudo (fora da linha, que fica apagada quando cancelada) e não deixa o toque voltar para a linha. */
function FolhaVenda(props: { id: string; aoFechar: () => void }) {
  const raiz = document.querySelector('.dn') ?? document.body;
  return createPortal(<div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><DetalheVenda {...props} /></div>, raiz);
}

function DetalheVenda({ id, aoFechar }: { id: string; aoFechar: () => void }) {
  const [p, setP] = useState<PedidoDetalhe | null>(null);
  const [cancelados, setCancelados] = useState<CanceladoDetalhe[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [a, b] = await Promise.all([
        supabase.from('pedidos').select('*, pagamento:pagamentos(forma, valor), pedido_itens(id, nome, qtd, preco_unit, obs, complementos, produto:produtos(imagem_url, emoji, preco, preco_de))').eq('id', id).single(),
        supabase.from('itens_cancelados').select('id, nome, qtd, valor, motivo, pedido_inteiro, por, criado_em').eq('pedido_id', id).order('criado_em'),
      ]);
      if (!vivo) return;
      if (a.error) return setErro(msgErro(a.error));
      const ped = a.data as unknown as PedidoDetalhe;
      setP(ped);
      const canc = (b.data ?? []) as CanceladoDetalhe[];
      setCancelados(canc);
      const ids = [...new Set(canc.map((c) => c.por).filter(Boolean))] as string[];
      if (ids.length) {
        const { data } = await supabase.from('membros').select('user_id, nome').eq('restaurante_id', ped.restaurante_id).in('user_id', ids);
        if (vivo) setNomes(Object.fromEntries((data ?? []).map((m) => [m.user_id as string, (m.nome as string) || 'Equipe'])));
      }
    })();
    return () => { vivo = false; };
  }, [id]);

  const cancelado = p?.status === 'cancelado';
  const itens = p?.pedido_itens ?? [];
  const subtotal = itens.reduce((s, i) => s + Number(i.preco_unit) * i.qtd, 0);
  // Promoção: o produto tem preço "de" maior que o cobrado
  const promo = (i: ItemDetalhe) => {
    const de = Number(i.produto?.preco_de ?? 0);
    return de > Number(i.preco_unit) && !i.complementos ? (de - Number(i.preco_unit)) * i.qtd : 0;
  };
  const economia = itens.reduce((s, i) => s + promo(i), 0);
  const desconto = Number(p?.desconto ?? 0);
  const taxa = Number(p?.taxa_entrega ?? 0);
  const fora = cancelados.filter((c) => !c.pedido_inteiro);
  const inteiro = cancelados.find((c) => c.pedido_inteiro);
  const motivo = p?.cancel_motivo ?? inteiro?.motivo ?? null;
  const quemCancelou = inteiro?.por ? nomes[inteiro.por] : null;
  const forma = p?.pagamento?.forma ?? p?.forma_pagamento ?? null;
  const tel = (p?.cliente_telefone ?? '').replace(/\D/g, '');
  const situacao = !p ? '' : cancelado ? 'Cancelado' : p.pago_em ? 'Pago' : STATUS_ROTULO[p.status];

  return (
    <Folha aoFechar={aoFechar} classe="dn-folha--detalhe">
      {!p ? (
        erro ? <p className="dn-erro">{erro}</p> : <Esqueleto linhas={4} />
      ) : (
        <div className="dn-det">
          <header className="dn-det__cab">
            <div>
              <h2>Pedido #{p.numero}</h2>
              <small>{p.tipo && p.tipo !== 'mesa' ? TIPO_ROTULO[p.tipo] : p.mesa_nome} · {quando(p.criado_em)}</small>
            </div>
            <span className={cx('dn-det__selo', cancelado ? 'cancelado' : p.pago_em ? 'pago' : 'aberto')}>{situacao}</span>
          </header>

          {cancelado && (
            <div className="dn-det__alerta">
              <XCircle size={18} />
              <div>
                <strong>Pedido cancelado{p.atualizado_em ? ` às ${hora(p.atualizado_em)}` : ''}</strong>
                <span>{motivo ? <>Motivo: <b>{motivo}</b></> : 'Sem motivo informado'}{quemCancelou ? ` · por ${quemCancelou}` : ''}</span>
              </div>
            </div>
          )}

          <ul className="dn-det__itens">
            {itens.map((i) => {
              const off = promo(i);
              return (
                <li key={i.id}>
                  <span className="dn-venda__foto">{i.produto?.imagem_url ? <img src={i.produto.imagem_url} alt="" /> : <span>{i.produto?.emoji || '•'}</span>}</span>
                  <div>
                    <strong>{i.qtd}× {i.nome}</strong>
                    {i.complementos && <small>{i.complementos}</small>}
                    {i.obs && <em>“{i.obs}”</em>}
                    {off > 0 && <span className="dn-det__promo">Promoção · de {brl(Number(i.produto!.preco_de))} por {brl(Number(i.preco_unit))}</span>}
                  </div>
                  <b className={cx(cancelado && 'riscado')}>{brl(Number(i.preco_unit) * i.qtd)}</b>
                </li>
              );
            })}
            {cancelado && !itens.length && cancelados.map((c) => (
              <li key={c.id}>
                <span className="dn-venda__foto"><span>•</span></span>
                <div><strong>{c.qtd}× {c.nome}</strong></div>
                <b className="riscado">{brl(Number(c.valor))}</b>
              </li>
            ))}
          </ul>

          {fora.length > 0 && (
            <section className="dn-det__bloco dn-det__fora">
              <span className="dn-rotulo">Itens cancelados</span>
              {fora.map((c) => (
                <div key={c.id} className="dn-det__linha">
                  <span><s>{c.qtd}× {c.nome}</s><small>{c.motivo ? `Motivo: ${c.motivo}` : 'Sem motivo'}{c.por && nomes[c.por] ? ` · por ${nomes[c.por]}` : ''} · {hora(c.criado_em)}</small></span>
                  <b>− {brl(Number(c.valor))}</b>
                </div>
              ))}
            </section>
          )}

          <section className="dn-det__bloco">
            <div className="dn-det__linha"><span>Subtotal</span><b>{brl(subtotal)}</b></div>
            {economia > 0 && <div className="dn-det__linha dn-det__linha--promo"><span>Economia em promoções</span><b>− {brl(economia)}</b></div>}
            {taxa > 0 && <div className="dn-det__linha"><span>Taxa de entrega</span><b>{brl(taxa)}</b></div>}
            {desconto > 0 && <div className="dn-det__linha dn-det__linha--promo"><span>Desconto dado</span><b>− {brl(desconto)}</b></div>}
            <div className="dn-det__linha dn-det__total"><span>{cancelado ? 'Valor cancelado' : 'Total'}</span><b className={cx(cancelado && 'riscado')}>{brl(Number(p.total))}</b></div>
          </section>

          <section className="dn-det__bloco">
            <div className="dn-det__linha"><span>Pagamento</span><b>{p.pago_em ? `${forma ? FORMA_ROTULO[forma] ?? forma : 'Pago'} · ${hora(p.pago_em)}` : cancelado ? '—' : 'Em aberto'}</b></div>
            {p.troco_para && Number(p.troco_para) > 0 && <div className="dn-det__linha"><span>{p.tipo === 'balcao' ? 'Recebido' : 'Troco para'}</span><b>{brl(Number(p.troco_para))}</b></div>}
            {p.cliente_nome && <div className="dn-det__linha"><span>Cliente</span><b>{p.cliente_nome}</b></div>}
            {tel && <div className="dn-det__linha"><span>WhatsApp</span><a href={`https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`} target="_blank" rel="noopener">{tel.replace(/^(\d{2})(\d+)(\d{4})$/, '($1) $2-$3')}</a></div>}
            {p.endereco && <div className="dn-det__linha"><span>Entrega</span><b>{p.endereco.rua}, {p.endereco.numero} · {p.endereco.bairro}</b></div>}
          </section>

          {p.observacao && <p className="dn-det__obs">“{p.observacao}”</p>}
          <button className="dn-botao" onClick={aoFechar}>Fechar</button>
        </div>
      )}
    </Folha>
  );
}

/* ---------- Relatórios ---------- */
function Relatorios({ rest, valor, versao }: { rest: RestauranteComPapel; valor: (v: number) => string; versao: number }) {
  const [periodo, setPeriodo] = useState<Periodo>('7');
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [lucro, setLucro] = useState<Lucro | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const { inicio, fim } = intervalo(periodo);
    const args = { p_rest: rest.id, p_inicio: inicio.toISOString(), p_fim: fim.toISOString() };
    const [a, b] = await Promise.all([supabase.rpc('relatorio_vendas', args), supabase.rpc('relatorio_lucro', args)]);
    if (a.error) setErro(msgErro(a.error));
    else { setErro(''); setDados(a.data as Relatorio); }
    setLucro(b.error ? null : (b.data as Lucro));
  }, [rest.id, periodo]);
  useEffect(() => { setDados(null); setLucro(null); }, [periodo]);
  useEffect(() => { void carregar(); }, [carregar, versao]);

  // Barras: por hora (hoje) ou por dia (demais períodos), com os dias sem venda zerados
  const barras = useMemo(() => {
    if (!dados) return [];
    if (periodo === 'hoje') {
      const mapa = new Map(dados.por_hora.map((h) => [h.hora, Number(h.faturamento)]));
      const horas = dados.por_hora.map((h) => h.hora);
      const de = horas.length ? Math.min(...horas, 11) : 11;
      const ate = horas.length ? Math.max(...horas, 22) : 22;
      return Array.from({ length: ate - de + 1 }, (_, i) => ({ rotulo: `${de + i}h`, v: mapa.get(de + i) ?? 0 }));
    }
    const { inicio, fim } = intervalo(periodo);
    const mapa = new Map(dados.por_dia.map((d) => [d.dia, Number(d.faturamento)]));
    const lista: { rotulo: string; v: number }[] = [];
    for (let t = inicio.getTime(); t < fim.getTime(); t += 86400000) {
      const d = new Date(t);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      lista.push({ rotulo: String(d.getDate()), v: mapa.get(k) ?? 0 });
    }
    return lista;
  }, [dados, periodo]);
  const maior = Math.max(1, ...barras.map((b) => b.v));
  const topMax = Math.max(1, ...(dados?.top_produtos ?? []).map((t) => Number(t.faturamento)));

  return (
    <div className="dn-pagina">
      <h1 className="dn-titulo">Relatórios</h1>
      <SeletorPeriodo valor={periodo} aoMudar={setPeriodo} />
      {erro && <p className="dn-erro">{erro}</p>}
      {!dados ? <Esqueleto linhas={4} /> : (
        <>
          <section className="dn-faturamento dn-faturamento--rel">
            <div className="dn-faturamento__cab"><span>Faturamento</span><span className="dn-medalha"><BarChart3 size={16} /></span></div>
            <strong className="dn-faturamento__valor">{valor(Number(dados.resumo.faturamento))}</strong>
            <div className="dn-grafico" role="img" aria-label="Faturamento no período">
              {barras.map((b, i) => (
                <div key={i} className="dn-grafico__col" title={`${b.rotulo}: ${brl(b.v)}`}>
                  <span style={{ height: `${Math.max(b.v ? 6 : 2, (b.v / maior) * 100)}%`, animationDelay: `${i * 18}ms` }} className={cx(b.v === 0 && 'zero')} />
                  {(barras.length <= 15 || i % Math.ceil(barras.length / 10) === 0) && <small>{b.rotulo}</small>}
                </div>
              ))}
            </div>
          </section>
          <div className="dn-cards">
            <div><small>Pedidos</small><strong>{dados.resumo.pedidos}</strong></div>
            <div><small>Ticket médio</small><strong>{valor(Number(dados.resumo.ticket_medio))}</strong></div>
            <div><small>Recebido</small><strong className="verde">{valor(Number(dados.resumo.recebido))}</strong></div>
            <div><small>Em aberto</small><strong className="ouro">{valor(Number(dados.resumo.em_aberto))}</strong></div>
          </div>
          {dados.cancelados.pedidos > 0 && (
            <p className="dn-nota"><XCircle size={15} /> {dados.cancelados.pedidos} cancelado(s) · {valor(Number(dados.cancelados.valor))} fora do faturamento</p>
          )}
          {lucro && <CartaoLucro lucro={lucro} periodo={periodo} rest={rest} valor={valor} />}
          <div className="dn-secao-cab"><h2>Mais vendidos</h2></div>
          {dados.top_produtos.length === 0 ? <p className="dn-vazio-lista">Sem vendas neste período.</p> : (
            <ul className="dn-top">
              {dados.top_produtos.slice(0, 8).map((t, i) => (
                <li key={t.nome}>
                  <span className="dn-top__pos">{i + 1}</span>
                  <div className="dn-top__info">
                    <div><strong>{t.nome}</strong><b>{valor(Number(t.faturamento))}</b></div>
                    <div className="dn-top__barra"><span style={{ width: `${(Number(t.faturamento) / topMax) * 100}%` }} /></div>
                    <small>{t.qtd} vendido(s)</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Lucro: cartão isolado (bom para print) ---------- */
const ROTULO_PERIODO: Record<Periodo, string> = { hoje: 'Hoje', '7': 'Últimos 7 dias', '15': 'Últimos 15 dias', '30': 'Últimos 30 dias', mes: 'Este mês' };

function CartaoLucro({ lucro, periodo, rest, valor }: { lucro: Lucro; periodo: Periodo; rest: RestauranteComPapel; valor: (v: number) => string }) {
  const [print, setPrint] = useState(false);
  const raiz = typeof document !== 'undefined' ? document.querySelector('.dn') : null;
  return (
    <>
      <PainelLucro lucro={lucro} periodo={periodo} rest={rest} valor={valor} aoPrint={() => setPrint(true)} />
      {lucro.itens_sem_custo > 0 && (
        <p className="dn-nota dn-nota--ouro">
          <TrendingUp size={15} /> {lucro.produtos_sem_custo.length} {lucro.produtos_sem_custo.length === 1 ? 'produto vendido está' : 'produtos vendidos estão'} sem custo cadastrado ({lucro.produtos_sem_custo.slice(0, 3).join(', ')}{lucro.produtos_sem_custo.length > 3 ? '…' : ''}). Cadastre em Estoque › Custos e lucro, no sistema.
        </p>
      )}
      {print && raiz && createPortal(
        <div className="dn-print" onClick={() => setPrint(false)} role="dialog" aria-label="Lucro para print">
          <PainelLucro lucro={lucro} periodo={periodo} rest={rest} valor={valor} grande />
          <small className="dn-print__dica">Tire o print · toque para fechar</small>
        </div>,
        raiz,
      )}
    </>
  );
}

function PainelLucro({ lucro, periodo, rest, valor, aoPrint, grande }: {
  lucro: Lucro; periodo: Periodo; rest: RestauranteComPapel; valor: (v: number) => string; aoPrint?: () => void; grande?: boolean;
}) {
  const { inicio, fim } = intervalo(periodo);
  const receita = Number(lucro.receita);
  const valorLucro = Number(lucro.lucro);
  const margem = receita > 0 ? Math.round((valorLucro / receita) * 100) : 0;
  const mapa = new Map(lucro.por_dia.map((d) => [d.dia, Number(d.lucro)]));
  const barras: { rotulo: string; v: number }[] = [];
  for (let t = inicio.getTime(); t < fim.getTime(); t += 86400000) {
    const d = new Date(t);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    barras.push({ rotulo: String(d.getDate()), v: mapa.get(k) ?? 0 });
  }
  const maior = Math.max(1, ...barras.map((b) => Math.abs(b.v)));
  const datas = periodo === 'hoje'
    ? inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })
    : `${inicio.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${new Date(fim.getTime() - 1).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  return (
    <section className={cx('dn-lucro', grande && 'dn-lucro--grande')} onClick={(e) => grande && e.stopPropagation()}>
      <header className="dn-lucro__cab">
        <span className="dn-lucro__loja">
          {rest.logo_url ? <img src={rest.logo_url} alt="" /> : <i>{rest.nome.charAt(0)}</i>}
          <span><b>{rest.nome}</b><small>{ROTULO_PERIODO[periodo]} · {datas}</small></span>
        </span>
        {aoPrint && <button type="button" className="dn-lucro__print" onClick={aoPrint} aria-label="Abrir em tela cheia para print"><Maximize2 size={16} /></button>}
      </header>
      <small className="dn-lucro__rotulo">Lucro no período</small>
      <strong className={cx('dn-lucro__valor', valorLucro < 0 && 'negativo')}>{valor(valorLucro)}</strong>
      <span className={cx('dn-lucro__margem', margem < 0 && 'negativo')}><TrendingUp size={14} /> Margem de {margem}%</span>
      {barras.length > 1 && (
        <div className="dn-lucro__grafico" role="img" aria-label="Lucro por dia">
          {barras.map((b, i) => (
            <div key={i} className="dn-lucro__col" title={`Dia ${b.rotulo}: ${brl(b.v)}`}>
              <span style={{ height: `${Math.max(b.v ? 6 : 3, (Math.abs(b.v) / maior) * 100)}%`, animationDelay: `${i * 20}ms` }} className={cx(b.v === 0 && 'zero', b.v < 0 && 'negativo')} />
              {(barras.length <= 15 || i % Math.ceil(barras.length / 8) === 0) && <small>{b.rotulo}</small>}
            </div>
          ))}
        </div>
      )}
      <div className="dn-lucro__linhas">
        <div><small>Vendas de produtos</small><b>{valor(receita)}</b></div>
        <div><small>Custo dos produtos</small><b className="menos">− {valor(Number(lucro.custo))}</b></div>
        {Number(lucro.descontos) > 0 && <div><small>Descontos</small><b className="menos">− {valor(Number(lucro.descontos))}</b></div>}
      </div>
      <footer className="dn-lucro__rodape"><img src={ICONE} alt="" /> {MARCA}</footer>
    </section>
  );
}

/* ---------- Ajustes ---------- */
function Ajustes({ tema, setTema, rest, restaurantes, trocar, oculto, setOculto, aoSair, avisarErro }: {
  tema: TemaId;
  setTema: (id: TemaId) => void;
  rest: RestauranteComPapel;
  restaurantes: RestauranteComPapel[];
  trocar: (id: string) => void;
  oculto: boolean;
  setOculto: (v: boolean) => void;
  aoSair: () => void;
  avisarErro: (m: string) => void;
}) {
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [verTemas, setVerTemas] = useState(false);
  const [aparencia, setAparencia] = useAparencia('dono');
  useEffect(() => { void estadoPush().then(setPush); }, []);

  async function alternarAvisos() {
    try {
      if (push === 'ativo') { await desativarPush(); setPush('inativo'); }
      else { await ativarPush(rest.id, 'dono'); setPush('ativo'); }
    } catch (e) {
      avisarErro(msgErro(e));
    }
  }

  return (
    <div className="dn-pagina">
      <h1 className="dn-titulo">Ajustes</h1>
      {restaurantes.length > 1 && (
        <section className="dn-lista">
          <span className="dn-rotulo">Restaurante</span>
          {restaurantes.map((r) => (
            <button key={r.id} className="dn-lista__item" onClick={() => trocar(r.id)}>
              <Store size={19} /><span>{r.nome}</span>{r.id === rest.id && <Check size={18} className="verde" />}
            </button>
          ))}
        </section>
      )}
      <section className="dn-lista">
        <span className="dn-rotulo">Preferências</span>
        <button className="dn-lista__item" onClick={() => void alternarAvisos()}>
          <BellRing size={19} />
          <span>Avisar a cada venda<small>{push === 'ativo' ? 'Ligado neste celular' : push === 'precisa-instalar' ? 'Adicione o app à Tela de Início primeiro' : push === 'bloqueado' ? 'Bloqueado nas configurações do celular' : 'Desligado'}</small></span>
          <span className={cx('dn-chave', push === 'ativo' && 'on')} />
        </button>
        <button className="dn-lista__item" onClick={() => setVerTemas(true)}>
          <Palette size={19} />
          <span>Cor do app<small>{tema === 'loja' ? `A mesma do ${rest.nome}` : TEMAS.find((x) => x.id === tema)?.nome}</small></span>
          <i className="dn-tema-atual" />
        </button>
        <button className="dn-lista__item" onClick={() => setAparencia(aparencia === 'claro' ? 'escuro' : 'claro')}>
          {aparencia === 'claro' ? <Sun size={19} /> : <Moon size={19} />}
          <span>Modo claro<small>{aparencia === 'claro' ? 'App branco, ótimo para usar no sol' : 'Desligado: app escuro'}</small></span>
          <span className={cx('dn-chave', aparencia === 'claro' && 'on')} />
        </button>
        <button className="dn-lista__item" onClick={() => setOculto(!oculto)}>
          {oculto ? <EyeOff size={19} /> : <Eye size={19} />}
          <span>Esconder valores<small>Mostra R$ •••• até você tocar no olho</small></span>
          <span className={cx('dn-chave', oculto && 'on')} />
        </button>
      </section>
      <section className="dn-lista">
        <span className="dn-rotulo">Conta</span>
        <a className="dn-lista__item" href="/painel"><LayoutGrid size={19} /><span>Abrir o sistema completo<small>Pedidos, cardápio, caixa e equipe</small></span><ChevronRight size={18} /></a>
        <button className="dn-lista__item dn-lista__item--perigo" onClick={aoSair}><LogOut size={19} /><span>Sair</span></button>
      </section>
      <small className="dn-versao dn-versao--fixa">{MARCA} · v{VERSAO_CURTA}</small>
      {verTemas && <FolhaTemas atual={tema} corLoja={rest.cor} aoEscolher={setTema} aoFechar={() => setVerTemas(false)} />}
    </div>
  );
}

function FolhaTemas({ atual, corLoja, aoEscolher, aoFechar }: { atual: TemaId; corLoja: string | null | undefined; aoEscolher: (id: TemaId) => void; aoFechar: () => void }) {
  return (
    <Folha aoFechar={aoFechar}>
      <div className="dn-folha__centro">
        <span className="dn-folha__icone"><Palette size={26} /></span>
        <h2>Cor do app</h2>
        <p>Muda na hora. “Da loja” usa a mesma cor do seu cardápio.</p>
        <div className="dn-temas">
          {TEMAS.map((x) => {
            const [c1, c2, c3] = coresDoTema(x.id, corLoja);
            return (
              <button key={x.id} type="button" className={cx(atual === x.id && 'ativo')} onClick={() => aoEscolher(x.id)} aria-pressed={atual === x.id}>
                <i style={{ '--t1': c1, '--t2': c2, '--t3': c3 } as CSSProperties}>
                  {atual === x.id && <Check size={22} strokeWidth={2.6} />}
                  {x.id === 'loja' && <span className="dn-temas__loja"><Store size={11} /></span>}
                </i>
                {x.nome}
              </button>
            );
          })}
        </div>
        <button className="dn-botao" onClick={aoFechar}>Pronto</button>
      </div>
    </Folha>
  );
}

/* ---------- Folhas ---------- */
function FolhaMeta({ atual, aoFechar, aoSalvar }: { atual: number | null; aoFechar: () => void; aoSalvar: (v: number | null) => void }) {
  const [texto, setTexto] = useState(atual ? precoParaTexto(atual) : '');
  const v = texto.trim() ? lerPreco(texto) : null;
  const valido = v === null || (Number.isFinite(v) && v > 0);
  return (
    <Folha aoFechar={aoFechar}>
      <div className="dn-folha__centro">
        <span className="dn-folha__icone"><Target size={26} /></span>
        <h2>Meta do mês</h2>
        <p>Quanto você quer faturar este mês? A barra dourada mostra quanto falta.</p>
        <label className="dn-campo-valor">
          <span>R$</span>
          <input inputMode="decimal" value={texto} onChange={(e) => setTexto(mascaraPreco(e.target.value))} placeholder="10.000,00" autoFocus />
        </label>
        <button className="dn-botao" disabled={!valido} onClick={() => aoSalvar(v)}>Salvar meta</button>
        {atual && <button className="dn-botao dn-botao--contorno" onClick={() => aoSalvar(null)}>Remover meta</button>}
      </div>
    </Folha>
  );
}

function FolhaAvisos({ restId, aoFechar }: { restId: string; aoFechar: () => void }) {
  const toast = useToast();
  const [ocupado, setOcupado] = useState(false);
  async function ativar() {
    setOcupado(true);
    try {
      await ativarPush(restId, 'dono');
      toast('Pronto! Cada venda vai aparecer no seu celular.', 'ok');
      aoFechar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(false);
    }
  }
  return (
    <Folha aoFechar={aoFechar}>
      <div className="dn-folha__centro">
        <span className="dn-folha__icone"><BellRing size={26} /></span>
        <h2>Avisar a cada venda?</h2>
        <p>Receba um aviso no celular sempre que entrar um pedido, mesmo com o app fechado. Você pode desligar depois em Ajustes.</p>
        <button className="dn-botao" onClick={() => void ativar()} disabled={ocupado}>{ocupado ? <><span className="dn-giro" /> Ativando</> : 'Ativar avisos'}</button>
        <button className="dn-botao dn-botao--contorno" onClick={aoFechar}>Agora não</button>
      </div>
    </Folha>
  );
}
