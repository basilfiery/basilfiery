import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  BarChart3, Bell, BellRing, Check, Palette, ChevronDown, ChevronRight, CircleHelp, ClipboardList, DollarSign, Eye, EyeOff, Home, LayoutGrid,
  Lock, LogOut, Radio, Receipt, Settings, ShieldCheck, Store, Target, Trophy, Wallet, XCircle, Zap,
} from 'lucide-react';
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
import { CenaMesa } from './Cena';
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
  useAppInstalavel({ nome: `${MARCA} · Minhas vendas`, curto: 'Minhas vendas', inicio: '/dono', escopo: '/dono' });
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
      <div className="dn dn-boas dn-entra">
        <header className="dn-logo"><img src={ICONE} alt="" /><span>{MARCA}</span></header>
        <h1 className="dn-boas__titulo">Suas vendas<br /><em>na palma da mão.</em></h1>
        <p className="dn-boas__texto">Acompanhe o seu restaurante ao vivo, de onde estiver.</p>
        <div className="dn-espaco" />
        <button className="dn-pilula" onClick={() => { sessao.gravar('bf:dono:viu-boas', '1'); setEtapa('acesso'); }}>
          <Lock size={18} />
          <span>Acessar minha conta</span>
          <ChevronRight size={18} />
        </button>
        <ul className="dn-recursos">
          <li><span><ShieldCheck size={17} /></span><b>Seguro</b><small>Só você, dono, tem acesso.</small></li>
          <li><span><Zap size={17} /></span><b>Ao vivo</b><small>Cada venda na hora em que acontece.</small></li>
          <li><span><BarChart3 size={17} /></span><b>Completo</b><small>Relatórios do dia, semana e mês.</small></li>
        </ul>
        <small className="dn-versao">v{VERSAO_CURTA}</small>
      </div>
    );
  }

  return (
    <div className="dn dn-acesso dn-entra">
      <CenaMesa />
      <div className="dn-acesso__marca">
        <div className="dn-logo dn-logo--grande"><img src={ICONE} alt="" /><span>{MARCA}</span></div>
        <p>Sua gestão de vendas,<br />mais inteligente.</p>
      </div>
      <section className="dn-cartao-acesso">
        <h2>Acesse sua conta</h2>
        <p>Entrar para acompanhar vendas, pedidos e caixa.</p>
        <div className="dn-atalhos">
          {[
            { i: <DollarSign size={22} />, t: 'Vendas' },
            { i: <ClipboardList size={22} />, t: 'Pedidos' },
            { i: <Wallet size={22} />, t: 'Caixa' },
            { i: <BarChart3 size={22} />, t: 'Relatórios' },
          ].map((a, n) => (
            <span key={a.t} style={{ animationDelay: `${0.35 + n * 0.12}s` }}>{a.i}<b>{a.t}</b></span>
          ))}
        </div>
        <button className="dn-botao dn-botao--surge" onClick={() => setLogin(true)}>Acessar conta</button>
        <button className="dn-linha-ajuda" onClick={() => setAjuda(true)}>Precisa de ajuda? <ChevronRight size={16} /></button>
      </section>
      <small className="dn-versao">v{VERSAO_CURTA}</small>
      {login && <FolhaLogin aoFechar={() => setLogin(false)} aoAjuda={() => setAjuda(true)} />}
      {ajuda && <FolhaAjuda aoFechar={() => setAjuda(false)} />}
    </div>
  );
}

/** Folha que sobe de baixo (login, meta, avisos, ajuda). */
function Folha({ aoFechar, children, alta }: { aoFechar: () => void; children: ReactNode; alta?: boolean }) {
  const [saindo, setSaindo] = useState(false);
  const fechar = () => { setSaindo(true); setTimeout(aoFechar, 220); };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fechar();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  });
  return (
    <div className={cx('dn-folha-fundo', saindo && 'saindo')} onMouseDown={(e) => e.target === e.currentTarget && fechar()}>
      <div className={cx('dn-folha', alta && 'dn-folha--alta', saindo && 'saindo')} role="dialog" aria-modal="true">
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
  return (
    <li className={cx('dn-venda', cancelado && 'dn-venda--cancelada')}>
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
            <li key={p.id} className={cx('dn-feed__item', p.status === 'cancelado' && 'cancelado')}>
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
    </div>
  );
}

/* ---------- Relatórios ---------- */
function Relatorios({ rest, valor, versao }: { rest: RestauranteComPapel; valor: (v: number) => string; versao: number }) {
  const [periodo, setPeriodo] = useState<Periodo>('7');
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const { inicio, fim } = intervalo(periodo);
    const { data, error } = await supabase.rpc('relatorio_vendas', { p_rest: rest.id, p_inicio: inicio.toISOString(), p_fim: fim.toISOString() });
    if (error) setErro(msgErro(error));
    else { setErro(''); setDados(data as Relatorio); }
  }, [rest.id, periodo]);
  useEffect(() => { setDados(null); }, [periodo]);
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
