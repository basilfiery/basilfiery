import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, BarChart3, CheckCircle2, Eye, EyeOff, Headset, KeyRound, Lock, Mail, ShieldCheck, ShoppingBag, Store, TrendingUp, Wallet,
} from 'lucide-react';
import { Carregando } from '../componentes/Carregando';
import { destinoInicial, useSessao } from '../lib/sessao';
import { msgErro, supabase } from '../lib/supabase';
import { SITE, linkAssinar } from '../config/site';
import '../estilos/painel.css';
import '../estilos/login.css';

type Modo = 'entrar' | 'esqueci' | 'enviado' | 'nova-senha';

const SUPORTE = SITE.whatsappVendas ? `https://wa.me/${SITE.whatsappVendas}?text=${encodeURIComponent(`Olá! Preciso de ajuda para entrar no ${SITE.marca}.`)}` : '';

/** Sessão só até fechar o navegador quando "Manter conectado" está desmarcado (o index.html limpa ao abrir de novo). */
function lembrarSessao(manter: boolean) {
  try {
    if (manter) localStorage.removeItem('bf:sessao-temporaria');
    else { localStorage.setItem('bf:sessao-temporaria', '1'); sessionStorage.setItem('bf:sessao-viva', '1'); }
  } catch { /* sem armazenamento */ }
}

export default function Login() {
  const s = useSessao();
  const local = useLocation();
  const busca = new URLSearchParams(local.search);
  const [modo, setModo] = useState<Modo>(() =>
    busca.get('senha') === 'nova' || local.hash.includes('type=recovery') ? 'nova-senha' : 'entrar');
  const [email, setEmail] = useState(() => busca.get('email') ?? '');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [manter, setManter] = useState(true);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Voltou pelo link de "esqueci minha senha": fica nesta tela para criar a senha nova
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') setModo('nova-senha'); });
    return () => data.subscription.unsubscribe();
  }, []);

  // Conta nova só depois de assinar: o antigo /login?criar vai para "Criar meu acesso"
  if (busca.get('criar') !== null) return <Navigate to="/ativar" replace />;
  if (s.carregando) return <Carregando />;
  if (s.usuario && modo !== 'nova-senha') {
    const de = (local.state as { de?: string } | null)?.de;
    return <Navigate to={de && de !== '/login' ? de : destinoInicial(s)} replace />;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      if (modo === 'esqueci') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/login?senha=nova` });
        if (error) throw error;
        setModo('enviado');
        setOcupado(false);
        return;
      }
      if (modo === 'nova-senha') {
        const { error } = await supabase.auth.updateUser({ password: senha });
        if (error) throw error;
        window.history.replaceState(null, '', '/login');
        setModo('entrar'); // logado: redireciona para o painel
        return;
      }
      lembrarSessao(manter);
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) throw error;
      // A sessão atualiza sozinha e esta tela redireciona para o painel
    } catch (err) {
      setErro(msgErro(err));
      setOcupado(false);
    }
  }

  const trocar = (m: Modo) => { setModo(m); setErro(''); };
  const titulo = { entrar: 'Acesse sua conta', esqueci: 'Esqueceu a senha?', enviado: 'Confira o seu e-mail', 'nova-senha': 'Crie uma nova senha' }[modo];
  const subtitulo = {
    entrar: 'Entre para gerenciar pedidos, cardápio e vendas.',
    esqueci: 'Digite o e-mail da sua conta. Mandamos um link para você criar uma senha nova.',
    enviado: `Se existir uma conta com ${email || 'esse e-mail'}, o link chega em instantes. Olhe também a caixa de spam.`,
    'nova-senha': 'Escolha uma senha com pelo menos 6 caracteres.',
  }[modo];

  return (
    <div className="lg">
      <div className="lg-fundo" aria-hidden="true">
        <svg className="lg-curvas" viewBox="0 0 1600 900" preserveAspectRatio="none">
          <path d="M700 -20 C 760 140, 860 230, 1010 250" />
          <path d="M1390 250 C 1500 300, 1570 380, 1620 520" />
        </svg>
      </div>

      <section className="lg-hero">
        <Marca />
        <h1>Sua gestão<br />de vendas,<br /><em>mais inteligente.</em></h1>
        <p>Acompanhe pedidos, gerencie seu cardápio e tenha o controle total do seu negócio, em um só lugar.</p>
        <ul className="lg-recursos">
          <Recurso icone={<TrendingUp size={24} />} titulo="Pedidos" texto="Em tempo real" />
          <Recurso icone={<ShoppingBag size={24} />} titulo="Cardápio" texto="Fácil de gerenciar" />
          <Recurso icone={<Wallet size={24} />} titulo="Caixa" texto="Completo" />
          <Recurso icone={<BarChart3 size={24} />} titulo="Relatórios" texto="Resultados reais" />
        </ul>
      </section>

      <form className="lg-cartao" onSubmit={enviar}>
        <Marca pequena />
        {modo === 'enviado' || modo === 'esqueci' || modo === 'nova-senha'
          ? <span className="lg-cartao__icone">{modo === 'enviado' ? <CheckCircle2 size={26} /> : <KeyRound size={26} />}</span>
          : null}
        <h2>{titulo}</h2>
        <p className="lg-cartao__sub">{subtitulo}</p>

        {modo !== 'enviado' && (
          <div className="lg-campos">
            {modo !== 'nova-senha' && (
              <Campo rotulo="E-mail" icone={<Mail size={18} />}>
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@restaurante.com.br" autoFocus />
              </Campo>
            )}
            {modo !== 'esqueci' && (
              <Campo rotulo={modo === 'nova-senha' ? 'Nova senha' : 'Senha'} icone={<Lock size={18} />}
                fim={<button type="button" className="lg-campo__olho" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? 'Esconder senha' : 'Ver senha'}>{verSenha ? <EyeOff size={19} /> : <Eye size={19} />}</button>}>
                <input
                  type={verSenha ? 'text' : 'password'} required minLength={modo === 'entrar' ? undefined : 6}
                  autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                  value={senha} onChange={(e) => setSenha(e.target.value)}
                  placeholder={modo === 'entrar' ? 'Sua senha' : 'Mínimo 6 caracteres'}
                  autoFocus={modo === 'nova-senha'}
                />
              </Campo>
            )}
            {modo === 'entrar' && (
              <div className="lg-linha">
                <label className="lg-manter">
                  <input type="checkbox" checked={manter} onChange={(e) => setManter(e.target.checked)} />
                  <span className="lg-manter__caixa" aria-hidden="true" />
                  Manter conectado
                </label>
                <button type="button" className="lg-link" onClick={() => trocar('esqueci')}>Esqueci minha senha</button>
              </div>
            )}
          </div>
        )}

        {erro && <p className="lg-erro">{erro}</p>}

        {modo === 'enviado' ? (
          <button type="button" className="lg-botao" onClick={() => trocar('entrar')}>Voltar para entrar <ArrowRight size={19} /></button>
        ) : (
          <button className="lg-botao" disabled={ocupado}>
            {ocupado
              ? 'Aguarde…'
              : { entrar: 'Entrar no sistema', esqueci: 'Enviar link', 'nova-senha': 'Salvar nova senha' }[modo]}
            {!ocupado && <ArrowRight size={19} />}
          </button>
        )}

        {modo === 'esqueci' && (
          <button type="button" className="lg-voltar" onClick={() => trocar('entrar')}>Voltar para entrar</button>
        )}

        <div className="lg-ou"><span>ou</span></div>
        {modo === 'entrar' && (
          <div className="lg-assinar">
            <span className="lg-assinar__icone"><Store size={20} /></span>
            <div>
              <strong>Ainda não é assinante?</strong>
              <small>Assine e crie seu acesso na hora, sem falar com ninguém.</small>
            </div>
            <BotaoAssinar />
          </div>
        )}
        <div className="lg-ajuda">
          {modo === 'entrar' && <p><BadgeCheck size={17} /> Já pagou a assinatura? <Link className="lg-link" to="/ativar">Criar meu acesso</Link></p>}
          <p>
            <Headset size={17} /> Problemas para acessar?{' '}
            {SUPORTE ? <a className="lg-link" href={SUPORTE} target="_blank" rel="noopener">Falar com suporte</a> : <span>Fale com o suporte</span>}
          </p>
        </div>
        <footer className="lg-seguro"><ShieldCheck size={16} /> {SITE.marca} • Acesso seguro e protegido</footer>
        <nav className="lg-legal"><a href="/termos" target="_blank" rel="noopener">Termos de uso</a><span>·</span><a href="/privacidade" target="_blank" rel="noopener">Política de privacidade</a></nav>
      </form>
    </div>
  );
}

/** "Assinar agora": abre o checkout (no programa do Windows, abre no navegador) */
export function BotaoAssinar({ classe = 'lg-assinar__botao' }: { classe?: string }) {
  const destino = linkAssinar();
  return destino.startsWith('http')
    ? <a className={classe} href={destino} target="_blank" rel="noopener"><span>Assinar agora</span> <ArrowRight size={17} /></a>
    : <a className={classe} href={destino}><span>Assinar agora</span> <ArrowRight size={17} /></a>;
}

export function Marca({ pequena }: { pequena?: boolean }) {
  return (
    <div className={pequena ? 'lg-marca lg-marca--pequena' : 'lg-marca'}>
      <img src="/icone-512.png" alt="" />
      <div><strong>Basil<span>Fiery</span></strong><small>Pizzaria &amp; Conveniência</small></div>
    </div>
  );
}

export function Recurso({ icone, titulo, texto }: { icone: ReactNode; titulo: string; texto: string }) {
  return <li><span>{icone}</span><b>{titulo}</b><small>{texto}</small></li>;
}

export function Campo({ rotulo, icone, fim, children }: { rotulo: string; icone: ReactNode; fim?: ReactNode; children: ReactNode }) {
  return (
    <label className="lg-campo">
      <span className="lg-campo__rotulo">{rotulo}</span>
      <span className="lg-campo__caixa">
        <span className="lg-campo__icone">{icone}</span>
        {children}
        {fim}
      </span>
    </label>
  );
}
