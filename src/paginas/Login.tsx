import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Logo, Campo } from '../componentes/Basicos';
import { Carregando } from '../componentes/Carregando';
import { destinoInicial, useSessao } from '../lib/sessao';
import { msgErro, supabase } from '../lib/supabase';
import '../estilos/painel.css';

export default function Login() {
  const s = useSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  if (s.carregando) return <Carregando />;
  if (s.usuario) {
    const de = (local.state as { de?: string } | null)?.de;
    return <Navigate to={de && de !== '/login' ? de : destinoInicial(s)} replace />;
  }

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEntrando(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setEntrando(false);
    if (error) setErro(msgErro(error));
    else navegar('/login', { replace: true, state: local.state });
  }

  return (
    <div className="tela-login">
      <form className="login card" onSubmit={entrar}>
        <Link to="/" className="login__logo"><Logo tamanho="lg" /></Link>
        <h1 className="titulo">Entrar no sistema</h1>
        <p className="muted">Use o e-mail e a senha que o seu restaurante cadastrou para você.</p>
        <Campo rotulo="E-mail">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Campo>
        <Campo rotulo="Senha">
          <input className="input" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </Campo>
        {erro && <p className="erro-form">{erro}</p>}
        <button className="btn btn--primario btn--lg btn--bloco" disabled={entrando}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="login__ajuda muted">
          Esqueceu a senha? Peça ao gerente do restaurante para criar uma nova.
        </p>
      </form>
    </div>
  );
}
