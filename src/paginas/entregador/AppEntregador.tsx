import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Bike, Download, Eye, EyeOff, Lock, LogOut, Mail } from 'lucide-react';
import { Carregando } from '../../componentes/Carregando';
import { useSessao } from '../../lib/sessao';
import { msgErro, supabase } from '../../lib/supabase';
import { ls } from '../../lib/util';
import { useEscalaApp } from '../../lib/escalaApp';
import Entregador from './Entregador';
import '../../estilos/garcom-app.css';

const CHAVE = 'bf:app-entregador';

/** Instalado no celular, o atalho abre direto no app de entregas. */
function useManifestoEntregador(nome?: string) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const anterior = link?.getAttribute('href');
    link?.setAttribute('href', '/manifest-entregador.webmanifest');
    const tituloAnterior = document.title;
    document.title = nome ? `Entregas · ${nome}` : 'App do entregador';
    return () => {
      if (link && anterior) link.setAttribute('href', anterior);
      document.title = tituloAnterior;
    };
  }, [nome]);
}

/**
 * basilfiery.com.br/appentregador — app do entregador (motoboy).
 * Entra com e-mail e senha; abre a loja onde a pessoa é entregadora.
 */
export default function AppEntregador() {
  const s = useSessao();
  useManifestoEntregador(s.restaurante?.nome);
  useEscalaApp();
  const ultimo = ls.ler<string | null>(CHAVE, null);
  // Loja onde é entregador (a última usada, se trabalhar em mais de uma)
  const deEntrega = s.restaurantes.filter((r) => r.papel === 'entregador');
  const preferido = deEntrega.find((r) => r.codigo === ultimo) ?? deEntrega[0];
  useEffect(() => {
    if (preferido && s.restaurante?.id !== preferido.id) s.escolherRestaurante(preferido.id);
  }, [preferido, s]);
  useEffect(() => { if (s.restaurante) ls.gravar(CHAVE, s.restaurante.codigo); }, [s.restaurante]);

  if (s.carregando) return <Carregando />;
  if (!s.usuario) return <EntrarEntregador />;
  if (!s.restaurante) {
    return (
      <div className="app-g">
        <main className="app-g__cartao">
          <span className="app-g__selo"><Bike size={15} /> App do entregador</span>
          <h1>Conta sem acesso</h1>
          <p className="app-g__sub">A conta <b>{s.usuario.email}</b> não está na equipe de entregas de nenhuma loja. Peça para cadastrarem você em <b>Entregadores</b>.</p>
          <button className="app-g__botao app-g__botao--secundario" onClick={() => void s.sair()}><LogOut size={18} /> Entrar com outra conta</button>
        </main>
      </div>
    );
  }
  if (preferido && s.restaurante.id !== preferido.id) return <Carregando />;
  return <Entregador />;
}

type EventoInstalar = Event & { prompt: () => Promise<void> };

function EntrarEntregador() {
  const local = useLocation();
  const [email, setEmail] = useState(() => new URLSearchParams(local.search).get('email') ?? '');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [instalar, setInstalar] = useState<EventoInstalar | null>(null);

  useEffect(() => {
    const aoPoder = (e: Event) => { e.preventDefault(); setInstalar(e as EventoInstalar); };
    window.addEventListener('beforeinstallprompt', aoPoder);
    return () => window.removeEventListener('beforeinstallprompt', aoPoder);
  }, []);

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

  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <div className="app-g app-e">
      <main className="app-g__cartao">
        <div className="app-e__marca" aria-hidden="true"><Bike size={44} strokeWidth={1.8} /></div>
        <span className="app-g__selo"><Bike size={15} /> App do entregador</span>
        <h1>Bora entregar!</h1>
        <p className="app-g__sub">Entre com o e-mail e a senha que a loja cadastrou para você.</p>
        <form className="app-g__form" onSubmit={entrar}>
          <label className="app-g__campo">
            <span>E-mail</span>
            <div className="app-g__entrada">
              <Mail size={18} aria-hidden="true" />
              <input type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" autoFocus={!email} />
            </div>
          </label>
          <label className="app-g__campo">
            <span>Senha</span>
            <div className="app-g__entrada">
              <Lock size={18} aria-hidden="true" />
              <input type={verSenha ? 'text' : 'password'} autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Sua senha" autoFocus={!!email} />
              <button type="button" className="app-g__olho" onClick={() => setVerSenha((v) => !v)} aria-label={verSenha ? 'Esconder senha' : 'Mostrar senha'}>
                {verSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {erro && <p className="app-g__erro" role="alert">{erro}</p>}
          <button className="app-g__botao" disabled={ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="app-g__ajuda">Esqueceu a senha? Peça uma nova na loja.</p>
        {iphone ? (
          <p className="app-g__dica-ios">No iPhone: toque em <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b> para usar como app.</p>
        ) : instalar && (
          <button className="app-g__botao app-g__botao--secundario" onClick={() => void instalar.prompt().then(() => setInstalar(null))}>
            <Download size={18} /> Instalar app no celular
          </button>
        )}
      </main>
      <footer className="app-g__rodape">BasilFiery</footer>
    </div>
  );
}
