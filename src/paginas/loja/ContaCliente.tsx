import { useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, KeyRound, LogOut, MailCheck, MapPin, ReceiptText, Trash2, UserRound } from 'lucide-react';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { msgErro } from '../../lib/supabase';
import type { ContaCliente } from '../../lib/contaCliente';
import { cx } from '../../lib/util';

const telefoneFormatado = (t: string) => {
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
export function ModalConta({ conta, codigo, nomeLoja, logo, obrigatorio, aoFechar, aoVerPedidos }: {
  conta: ContaCliente;
  codigo: string;
  nomeLoja: string;
  logo?: string | null;
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
          <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado || senha.length < 6}>{ocupado ? 'Salvando…' : 'Salvar nova senha'}</button>
        </form>
      </Modal>
    );
  }

  /* ---------- Logado: Minha conta ---------- */
  if (conta.usuario) {
    return <MinhaConta conta={conta} aoFechar={aoFechar} aoVerPedidos={aoVerPedidos} />;
  }

  /* ---------- Entrar / criar conta ---------- */
  return (
    <Modal aberto aoFechar={obrigatorio ? () => {} : aoFechar} largura={440} classe={cx('mesa-modal conta-modal', obrigatorio && 'conta-modal--obrigatorio')}>
      {modo === 'enviado' ? (
        <div className="conta">
          <span className="conta__icone conta__icone--ok"><MailCheck size={28} /></span>
          <h2>Confira o seu e-mail</h2>
          <p>Se existir uma conta com <b>{email}</b>, você vai receber um link para criar uma senha nova. Olhe também a caixa de spam.</p>
          <button className="btn btn--contorno btn--lg btn--bloco" onClick={() => setModo('entrar')}>Voltar para entrar</button>
        </div>
      ) : modo === 'esqueci' ? (
        <form className="conta" onSubmit={(e) => { e.preventDefault(); void rodar(() => conta.esqueci(email, codigo), () => setModo('enviado')); }}>
          <span className="conta__icone"><KeyRound size={28} /></span>
          <h2>Esqueceu a senha?</h2>
          <p>Digite o e-mail da sua conta. Mandamos um link para você criar uma senha nova.</p>
          <label className="campo"><span>E-mail</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="voce@email.com" /></label>
          <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado || !email.includes('@')}>{ocupado ? 'Enviando…' : 'Enviar link'}</button>
          <button type="button" className="btn btn--fantasma btn--bloco" onClick={() => setModo('entrar')}>Voltar</button>
        </form>
      ) : (
        <div className="conta">
          {obrigatorio && logo ? <img className="conta__logo" src={logo} alt="" /> : <span className="conta__icone"><UserRound size={28} /></span>}
          <h2>{obrigatorio ? `Bem-vindo à ${nomeLoja}` : modo === 'criar' ? 'Crie sua conta' : 'Entre na sua conta'}</h2>
          <p>{obrigatorio
            ? (modo === 'criar' ? 'Crie sua conta em segundos para ver o cardápio e fazer seu pedido.' : 'Entre na sua conta para ver o cardápio e fazer seu pedido. É rápido!')
            : `Acompanhe seus pedidos na ${nomeLoja} e peça de novo com um toque. Seus dados já vêm preenchidos.`}</p>

          {conta.temGoogle && (
            <>
              <button type="button" className="conta__google" disabled={ocupado} onClick={() => void rodar(() => conta.google(codigo))}>
                <LogoGoogle /> Continuar com o Google
              </button>
              <div className="conta__ou"><span>ou</span></div>
            </>
          )}

          <div className="conta__abas" role="tablist">
            <button type="button" role="tab" aria-selected={modo === 'entrar'} className={cx(modo === 'entrar' && 'ativo')} onClick={() => setModo('entrar')}>Entrar</button>
            <button type="button" role="tab" aria-selected={modo === 'criar'} className={cx(modo === 'criar' && 'ativo')} onClick={() => setModo('criar')}>Criar conta</button>
          </div>

          <form className="conta__form" onSubmit={(e) => {
            e.preventDefault();
            if (modo === 'criar') {
              if (nome.trim().length < 2) return toast('Digite o seu nome.', 'erro');
              void rodar(() => conta.cadastrar(nome, telefone, email, senha), () => { toast('Conta criada! Você já está dentro.', 'ok'); aoFechar(); });
            } else {
              void rodar(() => conta.entrar(email, senha), () => { toast('Bem-vindo de volta!', 'ok'); aoFechar(); });
            }
          }}>
            {modo === 'criar' && (
              <>
                <label className="campo"><span>Seu nome</span><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" maxLength={80} required placeholder="Como quer ser chamado" /></label>
                <label className="campo"><span>WhatsApp</span><input className="input" inputMode="tel" value={telefoneFormatado(telefone)} onChange={(e) => setTelefone(e.target.value.replace(/\D/g, '').slice(0, 11))} autoComplete="tel" placeholder="(00) 00000-0000" /></label>
              </>
            )}
            <label className="campo"><span>E-mail</span><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="voce@email.com" /></label>
            <label className="campo">
              <span className="conta__rotulo-senha">Senha {modo === 'entrar' && <button type="button" onClick={() => setModo('esqueci')}>Esqueci minha senha</button>}</span>
              <CampoSenha valor={senha} aoMudar={setSenha} autoComplete={modo === 'criar' ? 'new-password' : 'current-password'} placeholder={modo === 'criar' ? 'Pelo menos 6 caracteres' : undefined} />
            </label>
            <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado || !email || senha.length < 6}>
              {ocupado ? 'Aguarde…' : modo === 'criar' ? 'Criar minha conta' : 'Entrar'}
            </button>
            <p className="conta__legal">
              Ao continuar, você concorda com os <a href="/termos" target="_blank" rel="noopener">Termos de uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a>.
            </p>
          </form>
        </div>
      )}
    </Modal>
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
  const foto = (conta.usuario?.user_metadata as { avatar_url?: string } | undefined)?.avatar_url;

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
          {foto ? <img src={foto} alt="" /> : <span>{inicial}</span>}
          <div><strong>{p?.nome || 'Minha conta'}</strong><small>{conta.usuario?.email}</small></div>
        </div>

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
