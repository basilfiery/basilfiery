import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Eye, EyeOff, KeyRound, LogOut, MailCheck, MapPin, ReceiptText, Trash2, UserRound } from 'lucide-react';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { ACEITA_IMAGEM, enviarFotoPerfil, msgErro } from '../../lib/supabase';
import { AjustarFoto } from '../../componentes/AjustarFoto';
import { supabaseCliente, type ContaCliente } from '../../lib/contaCliente';
import { cx } from '../../lib/util';

export const telefoneFormatado = (t: string) => {
  const d = t.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
};

function LogoGoogle() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function CampoSenha({ valor, aoMudar, autoComplete, placeholder }: { valor: string; aoMudar: (v: string) => void; autoComplete: string; placeholder?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <span className="conta-senha">
      <input className="input" type={ver ? 'text' : 'password'} value={valor} onChange={(e) => aoMudar(e.target.value)} autoComplete={autoComplete} minLength={6} required placeholder={placeholder} />
      <button type="button" onClick={() => setVer((v) => !v)} aria-label={ver ? 'Esconder senha' : 'Ver senha'}>{ver ? <EyeOff size={18} /> : <Eye size={18} />}</button>
    </span>
  );
}

/** Entrar, criar conta, esqueci a senha, nova senha e "Minha conta" — tudo numa janela só. */
export function ModalConta({ conta, nomeLoja, logo, cor, obrigatorio, aoFechar, aoVerPedidos }: {
  conta: ContaCliente;
  nomeLoja: string;
  logo?: string | null;
  cor?: string;
  /** Sem conta não dá para fechar: o cardápio pede o login logo na entrada */
  obrigatorio?: boolean;
  aoFechar: () => void;
  aoVerPedidos: () => void;
}) {
  const toast = useToast();
  const [modo, setModo] = useState<'entrar' | 'criar' | 'esqueci' | 'enviado'>('entrar');
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function rodar(f: () => Promise<{ error: unknown }>, ok?: () => void) {
    setOcupado(true);
    try {
      const { error } = await f();
      if (error) throw error;
      ok?.();
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(false);
    }
  }

  /* ---------- Voltou do e-mail "esqueci minha senha" ---------- */
  if (conta.novaSenha && conta.usuario) {
    return (
      <Modal aberto aoFechar={() => { conta.fecharNovaSenha(); aoFechar(); }} largura={440} classe="mesa-modal conta-modal">
        <form className="conta" onSubmit={(e: FormEvent) => { e.preventDefault(); void rodar(() => conta.trocarSenha(senha), () => { toast('Senha nova salva. Você já está na sua conta.', 'ok'); conta.fecharNovaSenha(); aoFechar(); }); }}>
          <span className="conta__icone"><KeyRound size={28} /></span>
          <h2>Crie uma nova senha</h2>
          <p>Para a conta {conta.usuario.email}.</p>
          <label className="campo"><span>Nova senha</span><CampoSenha valor={senha} aoMudar={setSenha} autoComplete="new-password" placeholder="Pelo menos 6 caracteres" /></label>
          <label className="campo"><span>Repita a nova senha</span><CampoSenha valor={senha2} aoMudar={setSenha2} autoComplete="new-password" placeholder="Digite a mesma senha" />
            {senha2.length > 0 && senha2 !== senha && <small className="conta__confere erro">As senhas ainda não são iguais</small>}
          </label>
          <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado || senha.length < 6 || senha2 !== senha}>{ocupado ? 'Salvando…' : 'Salvar nova senha'}</button>
        </form>
      </Modal>
    );
  }

  /* ---------- Logado: Minha conta ---------- */
  if (conta.usuario) {
    return <MinhaConta conta={conta} aoFechar={aoFechar} aoVerPedidos={aoVerPedidos} />;
  }

  /* ---------- Entrar / criar conta ---------- */
  const criando = modo === 'criar';
  const conteudo = modo === 'enviado' ? (
    <div className="conta">
      <span className="conta__icone conta__icone--ok"><MailCheck size={28} /></span>
      <h2>Confira o seu e-mail</h2>
      <p>Se existir uma conta com <b>{email}</b>, você vai receber um link para criar uma senha nova. Olhe também a caixa de spam.</p>
      <button className="btn btn--contorno btn--lg btn--bloco" onClick={() => setModo('entrar')}>Voltar para entrar</button>
    </div>
  ) : modo === 'esqueci' ? (
    <form className="conta" onSubmit={(e) => { e.preventDefault(); void rodar(() => conta.esqueci(email), () => setModo('enviado')); }}>
      <span className="conta__icone"><KeyRound size={28} /></span>
      <h2>Esqueceu a senha?</h2>
      <p>Digite o e-mail da sua conta. Mandamos um link para você criar uma senha nova.</p>
      <label className="campo"><span>E-mail</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="voce@email.com" /></label>
      <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado || !email.includes('@')}>{ocupado ? 'Enviando…' : 'Enviar link'}</button>
      <button type="button" className="btn btn--fantasma btn--bloco" onClick={() => setModo('entrar')}>Voltar</button>
    </form>
  ) : (
    <div className="conta" key={modo}>
      {!obrigatorio && <span className="conta__icone"><UserRound size={28} /></span>}
      <h2 className={cx(obrigatorio && 'conta__titulo-folha')}>{criando ? 'Crie sua conta' : 'Entre na sua conta'}</h2>
      <p>{criando
        ? 'Leva menos de um minuto. Seus dados ficam salvos para os próximos pedidos.'
        : obrigatorio ? 'Para ver o cardápio e fazer seu pedido. É rápido!' : `Acompanhe seus pedidos na ${nomeLoja} e peça de novo com um toque.`}</p>

      {conta.temGoogle && (
        <>
          <button type="button" className="conta__google" disabled={ocupado} onClick={() => void rodar(() => conta.google())}>
            <LogoGoogle /> Continuar com o Google
          </button>
          <div className="conta__ou"><span>ou</span></div>
        </>
      )}

      <form className="conta__form" onSubmit={(e) => {
        e.preventDefault();
        if (criando) {
          if (nome.trim().length < 2) return toast('Digite o seu nome.', 'erro');
          if (senha !== senha2) return toast('As senhas não são iguais. Digite de novo.', 'erro');
          void rodar(() => conta.cadastrar(nome, telefone, email, senha), () => { toast('Conta criada! Bom apetite 🍕', 'ok'); aoFechar(); });
        } else {
          void rodar(() => conta.entrar(email, senha), () => { toast('Bem-vindo de volta!', 'ok'); aoFechar(); });
        }
      }}>
        {criando && (
          <>
            <label className="campo"><span>Seu nome</span><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" maxLength={80} required placeholder="Como quer ser chamado" /></label>
            <label className="campo"><span>WhatsApp</span><input className="input" inputMode="tel" value={telefoneFormatado(telefone)} onChange={(e) => setTelefone(e.target.value.replace(/\D/g, '').slice(0, 11))} autoComplete="tel" placeholder="(00) 00000-0000" /></label>
          </>
        )}
        <label className="campo"><span>E-mail</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="voce@email.com" /></label>
        <label className="campo">
          <span className="conta__rotulo-senha">Senha {!criando && <button type="button" onClick={() => setModo('esqueci')}>Esqueci minha senha</button>}</span>
          <CampoSenha valor={senha} aoMudar={setSenha} autoComplete={criando ? 'new-password' : 'current-password'} placeholder={criando ? 'Pelo menos 6 caracteres' : 'Sua senha'} />
        </label>
        {criando && (
          <label className="campo">
            <span>Repita a senha</span>
            <CampoSenha valor={senha2} aoMudar={setSenha2} autoComplete="new-password" placeholder="Digite a mesma senha" />
            {senha2.length > 0 && (
              <small className={cx('conta__confere', senha2 === senha ? 'ok' : 'erro')}>
                {senha2 === senha ? '✓ As senhas são iguais' : 'As senhas ainda não são iguais'}
              </small>
            )}
          </label>
        )}
        <button className="btn btn--primario btn--lg btn--bloco conta__enviar" disabled={ocupado || !email || senha.length < 6 || (criando && senha2 !== senha)}>
          {ocupado ? 'Aguarde…' : criando ? 'Criar minha conta' : 'Entrar'}
        </button>
      </form>

      <p className="conta__trocar">
        {criando
          ? <>Já tem uma conta? <button type="button" onClick={() => setModo('entrar')}>Entrar</button></>
          : <>Não tem uma conta? <button type="button" onClick={() => setModo('criar')}>Criar conta agora</button></>}
      </p>
      <p className="conta__legal">
        Ao continuar, você concorda com os <a href="/termos" target="_blank" rel="noopener">Termos de uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>.
      </p>
    </div>
  );

  if (obrigatorio) return <Entrada3D nome={nomeLoja} logo={logo ?? null} cor={cor}>{conteudo}</Entrada3D>;
  return (
    <Modal aberto aoFechar={aoFechar} largura={440} classe="mesa-modal conta-modal">
      {conteudo}
    </Modal>
  );
}

/* ---------- Entrada do cardápio: cena 3D que acompanha o dedo/mouse ---------- */
const ITENS_3D = [
  { e: '🍕', x: -128, y: -64, z: 90, s: 1.25, d: 0 },
  { e: '🍔', x: 124, y: -78, z: 40, s: 1.1, d: -1.2 },
  { e: '🍟', x: -146, y: 58, z: -40, s: 0.95, d: -2.3 },
  { e: '🥤', x: 140, y: 52, z: 110, s: 1.05, d: -0.6 },
  { e: '🧀', x: -60, y: -112, z: -120, s: 0.75, d: -3.1 },
  { e: '🌶️', x: 96, y: 86, z: -80, s: 0.8, d: -1.8 },
  { e: '🍅', x: -108, y: 84, z: 30, s: 0.7, d: -2.7 },
  { e: '🍦', x: 64, y: -122, z: -160, s: 0.7, d: -0.9 },
];

function Entrada3D({ nome, logo, cor, children }: { nome: string; logo: string | null; cor?: string; children: ReactNode }) {
  const cena = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.body.classList.add('travado');
    const el = cena.current;
    let alvoX = 0, alvoY = 0, x = 0, y = 0, quadro = 0;
    const mover = (cx2: number, cy2: number) => {
      alvoY = ((cx2 / window.innerWidth) - 0.5) * 26;
      alvoX = -((cy2 / Math.max(1, window.innerHeight * 0.45)) - 0.5) * 18;
    };
    const ponteiro = (e: PointerEvent) => mover(e.clientX, e.clientY);
    const giro = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      alvoY = Math.max(-14, Math.min(14, e.gamma * 0.5));
      alvoX = Math.max(-12, Math.min(12, (e.beta - 45) * -0.35));
    };
    const animar = (t: number) => {
      // Sem toque, a cena "respira" sozinha
      const auto = Math.sin(t / 2600) * 6;
      x += (alvoX - x) * 0.08;
      y += (alvoY + auto - y) * 0.08;
      el?.style.setProperty('--rx', `${x.toFixed(2)}deg`);
      el?.style.setProperty('--ry', `${y.toFixed(2)}deg`);
      quadro = requestAnimationFrame(animar);
    };
    window.addEventListener('pointermove', ponteiro);
    window.addEventListener('deviceorientation', giro);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) quadro = requestAnimationFrame(animar);
    return () => {
      document.body.classList.remove('travado');
      window.removeEventListener('pointermove', ponteiro);
      window.removeEventListener('deviceorientation', giro);
      cancelAnimationFrame(quadro);
    };
  }, []);

  return createPortal(
    <div className="e3d" style={cor ? ({ '--acento': cor } as CSSProperties) : undefined} role="dialog" aria-modal="true" aria-label={`Entrar · ${nome}`}>
      <div className="e3d__fundo" aria-hidden="true" />
      <div className="e3d__topo">
        <div className="e3d__cena" ref={cena} aria-hidden="true">
          <div className="e3d__palco">
            <div className="e3d__anel" />
            {ITENS_3D.map((it, i) => (
              <span key={i} className="e3d__item" style={{ '--x': `${it.x}px`, '--y': `${it.y}px`, '--z': `${it.z}px`, '--s': it.s, '--d': `${it.d}s`, '--b': `${Math.max(0, -it.z) / 90}px` } as CSSProperties}>
                <i>{it.e}</i>
              </span>
            ))}
            <div className="e3d__logo">
              {logo ? <img src={logo} alt="" /> : <span>{nome.charAt(0)}</span>}
              <i className="e3d__brilho" />
            </div>
          </div>
        </div>
        <div className="e3d__titulo">
          <small>Bem-vindo à</small>
          <h1>{nome}</h1>
        </div>
      </div>
      <div className="e3d__folha">{children}</div>
    </div>,
    document.body,
  );
}

function MinhaConta({ conta, aoFechar, aoVerPedidos }: { conta: ContaCliente; aoFechar: () => void; aoVerPedidos: () => void }) {
  const toast = useToast();
  const p = conta.perfil;
  const [nome, setNome] = useState(p?.nome ?? '');
  const [telefone, setTelefone] = useState(p?.telefone ?? '');
  const [salvando, setSalvando] = useState(false);
  const mudou = (p?.nome ?? '') !== nome || (p?.telefone ?? '') !== telefone;
  const inicial = (nome || conta.usuario?.email || '?').charAt(0).toUpperCase();
  const foto = p?.foto_url ?? null;
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [ajustar, setAjustar] = useState<File | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);

  async function enviarFoto(recorte: Blob) {
    if (!conta.usuario) return;
    setEnviandoFoto(true);
    try {
      const url = await enviarFotoPerfil(conta.usuario.id, recorte, supabaseCliente);
      await conta.salvarPerfil({ foto_url: url });
      toast('Foto atualizada.', 'ok');
      setAjustar(null);
    } catch (er) { toast(msgErro(er), 'erro'); }
    setEnviandoFoto(false);
  }
  /** Reajustar a foto atual (enquadrar de novo) */
  async function reajustar() {
    if (!foto) return;
    try {
      const b = await (await fetch(foto)).blob();
      setAjustar(new File([b], 'foto.jpg', { type: b.type || 'image/jpeg' }));
    } catch { toast('Não consegui abrir a foto. Envie de novo.', 'erro'); }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try { await conta.salvarPerfil({ nome: nome.trim(), telefone: telefone.replace(/\D/g, '') }); toast('Dados salvos.', 'ok'); } catch (er) { toast(msgErro(er), 'erro'); }
    setSalvando(false);
  }

  return (
    <Modal aberto aoFechar={aoFechar} largura={460} classe="mesa-modal conta-modal">
      <div className="conta conta--logada">
        <div className="conta__perfil">
          <button type="button" className="conta__avatar" onClick={() => arquivoRef.current?.click()} aria-label={foto ? 'Trocar foto de perfil' : 'Colocar foto de perfil'} disabled={enviandoFoto}>
            {foto ? <img src={foto} alt="" /> : <span>{inicial}</span>}
            <i className="conta__avatar-camera">{enviandoFoto ? <span className="spinner" /> : <Camera size={15} />}</i>
          </button>
          <div>
            <strong>{p?.nome || 'Minha conta'}</strong>
            <small>{conta.usuario?.email}</small>
            <span className="conta__foto-acoes">
              <button type="button" onClick={() => arquivoRef.current?.click()}>{foto ? 'Trocar foto' : 'Colocar foto'}</button>
              {foto && <><b>·</b><button type="button" onClick={() => void reajustar()}>Ajustar</button><b>·</b><button type="button" className="perigo" onClick={() => void conta.salvarPerfil({ foto_url: null }).then(() => toast('Foto removida.', 'info'))}>Remover</button></>}
            </span>
          </div>
          <input ref={arquivoRef} type="file" accept={ACEITA_IMAGEM} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setAjustar(f); e.target.value = ''; }} />
        </div>
        {ajustar && <AjustarFoto arquivo={ajustar} formato="circulo" titulo="Ajustar foto de perfil" aoConfirmar={enviarFoto} aoCancelar={() => setAjustar(null)} />}

        <button type="button" className="conta__atalho" onClick={() => { aoVerPedidos(); aoFechar(); }}>
          <ReceiptText size={20} /><span>Meus pedidos<small>Acompanhe e peça de novo com um toque</small></span>
        </button>

        <form className="conta__form" onSubmit={salvar}>
          <h3>Meus dados</h3>
          <label className="campo"><span>Nome</span><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} autoComplete="name" /></label>
          <label className="campo"><span>WhatsApp</span><input className="input" inputMode="tel" value={telefoneFormatado(telefone)} onChange={(e) => setTelefone(e.target.value.replace(/\D/g, '').slice(0, 11))} autoComplete="tel" placeholder="(00) 00000-0000" /></label>
          {mudou && <button className="btn btn--primario btn--bloco" disabled={salvando}><Check size={17} /> {salvando ? 'Salvando…' : 'Salvar dados'}</button>}
        </form>

        {!!p?.enderecos.length && (
          <section className="conta__enderecos">
            <h3>Endereços salvos</h3>
            {p.enderecos.map((e, i) => (
              <div key={`${e.rua}${e.numero}${i}`} className="conta__endereco">
                <MapPin size={17} />
                <span>{e.rua}, {e.numero}{e.complemento ? ` · ${e.complemento}` : ''}<small>{e.bairro}</small></span>
                <button type="button" aria-label="Apagar endereço" onClick={() => void conta.salvarPerfil({ enderecos: p.enderecos.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
              </div>
            ))}
          </section>
        )}

        <button type="button" className="btn btn--fantasma btn--bloco conta__sair" onClick={() => { void conta.sair(); toast('Você saiu da sua conta.', 'info'); aoFechar(); }}>
          <LogOut size={17} /> Sair da conta
        </button>
      </div>
    </Modal>
  );
}
