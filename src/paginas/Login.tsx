import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { Logo, Campo } from '../componentes/Basicos';
import { Carregando } from '../componentes/Carregando';
import { destinoInicial, useSessao } from '../lib/sessao';
import { gestao, msgErro, supabase } from '../lib/supabase';
import '../estilos/painel.css';

type Modo = 'entrar' | 'criar';

export default function Login() {
  const s = useSessao();
  const local = useLocation();
  const [modo, setModo] = useState<Modo>(() => (new URLSearchParams(local.search).get('criar') !== null ? 'criar' : 'entrar'));
  const [nome, setNome] = useState('');
  const [restaurante, setRestaurante] = useState('');
  const [email, setEmail] = useState(() => new URLSearchParams(local.search).get('email') ?? '');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  if (s.carregando) return <Carregando />;
  if (s.usuario) {
    const de = (local.state as { de?: string } | null)?.de;
    return <Navigate to={de && de !== '/login' ? de : destinoInicial(s)} replace />;
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      if (modo === 'criar') {
        await gestao('cadastrar', { nome, restaurante, email, senha });
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) throw error;
      // A sessão atualiza sozinha e esta tela redireciona para o painel
    } catch (err) {
      setErro(msgErro(err));
      setOcupado(false);
    }
  }

  const trocar = (m: Modo) => { setModo(m); setErro(''); };
  const criando = modo === 'criar';

  return (
    <div className="tela-login">
      <form className="login card" onSubmit={enviar}>
        <Link to="/" className="login__logo"><Logo tamanho="lg" /></Link>

        <div className="login__abas" role="tablist">
          <button type="button" role="tab" aria-selected={!criando} className={!criando ? 'ativo' : ''} onClick={() => trocar('entrar')}>Entrar</button>
          <button type="button" role="tab" aria-selected={criando} className={criando ? 'ativo' : ''} onClick={() => trocar('criar')}>Criar conta</button>
        </div>

        <h1 className="titulo">{criando ? 'Criar sua conta' : 'Entrar no sistema'}</h1>
        <p className="muted">
          {criando
            ? 'Cadastre seu restaurante e comece a montar o cardápio agora mesmo.'
            : 'Use o e-mail e a senha da sua conta.'}
        </p>

        {criando && (
          <>
            <Campo rotulo="Seu nome">
              <input className="input" required autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
            </Campo>
            <Campo rotulo="Nome do restaurante">
              <input className="input" autoComplete="organization" value={restaurante} onChange={(e) => setRestaurante(e.target.value)} />
            </Campo>
          </>
        )}
        <Campo rotulo="E-mail">
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={!criando} />
        </Campo>
        <Campo rotulo="Senha" dica={criando ? 'Mínimo 6 caracteres' : undefined}>
          <input
            className="input"
            type="password"
            required
            minLength={criando ? 6 : undefined}
            autoComplete={criando ? 'new-password' : 'current-password'}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </Campo>

        {erro && <p className="erro-form">{erro}</p>}
        <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado}>
          {ocupado ? (criando ? 'Criando conta…' : 'Entrando…') : (criando ? 'Criar conta e entrar' : 'Entrar')}
        </button>

        <p className="login__ajuda muted">
          {criando
            ? <>Já tem conta? <button type="button" className="link-botao" onClick={() => trocar('entrar')}>Entrar</button></>
            : <>Não tem conta? <button type="button" className="link-botao" onClick={() => trocar('criar')}>Criar conta</button></>}
        </p>
      </form>
    </div>
  );
}
