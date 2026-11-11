import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { ClipboardList, Download, Eye, EyeOff, Lock, LogOut, Mail } from 'lucide-react';
import { Carregando } from '../../componentes/Carregando';
import { useSessao } from '../../lib/sessao';
import { msgErro, supabase } from '../../lib/supabase';
import { ls } from '../../lib/util';
import { useEscalaApp } from '../../lib/escalaApp';
import type { Papel } from '../../lib/tipos';
import Atendente from './Atendente';
import '../../estilos/garcom-app.css';

const CHAVE = 'bf:app-pedidos';
/** Quem pode usar o app de pedidos (atendente primeiro; dono, gerente e caixa também) */
const PODE: Papel[] = ['atendente', 'dono', 'gerente', 'caixa'];

/** Instalado no celular/tablet, o atalho abre direto no app de pedidos. */
function useManifestoPedidos(nome?: string) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const anterior = link?.getAttribute('href');
    link?.setAttribute('href', '/manifest-pedidos.webmanifest');
    const tituloAnterior = document.title;
    document.title = nome ? `Pedidos · ${nome}` : 'App de pedidos';
    return () => {
      if (link && anterior) link.setAttribute('href', anterior);
      document.title = tituloAnterior;
    };
  }, [nome]);
}

/**
 * basilfiery.com.br/apppedidos — app de quem recebe os pedidos do cardápio digital,
 * anota e leva para a cozinha. Entra com e-mail e senha.
 */
export default function AppPedidos() {
  const s = useSessao();
  useManifestoPedidos(s.restaurante?.nome);
  useEscalaApp();
  const ultimo = ls.ler<string | null>(CHAVE, null);
  const lojas = s.restaurantes.filter((r) => PODE.includes(r.papel));
  const preferido = lojas.find((r) => r.codigo === ultimo)
    ?? lojas.find((r) => r.papel === 'atendente') ?? lojas[0];
  useEffect(() => {
    if (preferido && s.restaurante?.id !== preferido.id) s.escolherRestaurante(preferido.id);
  }, [preferido, s]);
  useEffect(() => { if (s.restaurante) ls.gravar(CHAVE, s.restaurante.codigo); }, [s.restaurante]);

  if (s.carregando) return <Carregando />;
  if (!s.usuario) return <EntrarPedidos />;
  if (!s.restaurante || !preferido) {
    return (
      <div className="app-g">
        <main className="app-g__cartao">
          <span className="app-g__selo"><ClipboardList size={15} /> App de pedidos</span>
          <h1>Conta sem acesso</h1>
          <p className="app-g__sub">A conta <b>{s.usuario.email}</b> não recebe pedidos em nenhuma loja. Peça para cadastrarem você como <b>Atendente</b> em Equipe.</p>
          <button className="app-g__botao app-g__botao--secundario" onClick={() => void s.sair()}><LogOut size={18} /> Entrar com outra conta</button>
        </main>
      </div>
    );
  }
  if (s.restaurante.id !== preferido.id) return <Carregando />;
  return <Atendente />;
}

type EventoInstalar = Event & { prompt: () => Promise<void> };

function EntrarPedidos() {
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
        <div className="app-e__marca" aria-hidden="true"><ClipboardList size={44} strokeWidth={1.8} /></div>
        <span className="app-g__selo"><ClipboardList size={15} /> App de pedidos</span>
        <h1>Chegou pedido?</h1>
        <p className="app-g__sub">Receba os pedidos do cardápio digital, anote e mande para a cozinha. Entre com o e-mail e a senha que a loja criou para você.</p>
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
          <p className="app-g__dica-ios">No iPhone/iPad: toque em <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b> para usar como app.</p>
        ) : instalar && (
          <button className="app-g__botao app-g__botao--secundario" onClick={() => void instalar.prompt().then(() => setInstalar(null))}>
            <Download size={18} /> Instalar app
          </button>
        )}
      </main>
      <footer className="app-g__rodape">BasilFiery</footer>
    </div>
  );
}
