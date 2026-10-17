import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { ConciergeBell, Download, Eye, EyeOff, Lock, LogOut, Mail } from 'lucide-react';
import { Carregando } from '../../componentes/Carregando';
import { useSessao } from '../../lib/sessao';
import { msgErro, supabase } from '../../lib/supabase';
import { ls } from '../../lib/util';
import { useAppInstalavel } from '../../lib/manifesto';
import Garcom from './Garcom';
import '../../estilos/garcom-app.css';

interface Info { id: string; nome: string; logo_url: string | null; cor: string }

const CHAVE = 'bf:app-garcom';

/** Troca o manifesto da página: instalado no celular, o app abre direto no garçom. */
function useManifestoGarcom(nome?: string) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const anterior = link?.getAttribute('href');
    link?.setAttribute('href', '/manifest-garcom.webmanifest');
    const tituloAnterior = document.title;
    document.title = nome ? `Garçom · ${nome}` : 'App do garçom';
    return () => {
      if (link && anterior) link.setAttribute('href', anterior);
      document.title = tituloAnterior;
    };
  }, [nome]);
}

/** /g — atalho do app instalado: volta para o restaurante usado por último. */
export function AppGarcomInicio() {
  const s = useSessao();
  useManifestoGarcom();
  const codigo = ls.ler<string | null>(CHAVE, null);
  if (codigo) return <Navigate to={`/g/${codigo}`} replace />;
  if (s.carregando) return <Carregando />;
  if (s.usuario) return <Navigate to="/garcom" replace />;
  return (
    <div className="app-g">
      <main className="app-g__cartao">
        <span className="app-g__selo"><ConciergeBell size={15} /> App do garçom</span>
        <h1>Abra o link do seu restaurante</h1>
        <p className="app-g__sub">Peça ao gerente o link de acesso dos garçons. Ele chega pelo WhatsApp.</p>
      </main>
    </div>
  );
}

/** /g/:codigo — app do garçom, separado do sistema do caixa. */
export default function AppGarcom() {
  const { codigo = '' } = useParams();
  const s = useSessao();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  // Na tela de início do celular, o atalho abre direto este restaurante (no iPhone o app não vê os dados do Safari)
  useAppInstalavel(info ? { nome: `Garçom · ${info.nome}`, curto: 'Garçom', inicio: `/g/${codigo.toLowerCase()}`, escopo: '/g/' } : null);

  useEffect(() => {
    let vivo = true;
    void supabase.rpc('app_garcom_info', { p_codigo: codigo }).then(({ data }) => {
      if (!vivo) return;
      setInfo((data as Info | null) ?? null);
      if (data) ls.gravar(CHAVE, codigo.toLowerCase());
    });
    return () => { vivo = false; };
  }, [codigo]);

  const membro = info ? s.restaurantes.find((r) => r.id === info.id) : undefined;
  // Quem trabalha em mais de um restaurante: o link escolhe qual abrir
  useEffect(() => {
    if (membro && s.restaurante?.id !== membro.id) s.escolherRestaurante(membro.id);
  }, [membro, s]);

  if (info === undefined || s.carregando) return <Carregando />;
  if (info === null) {
    return (
      <div className="app-g">
        <main className="app-g__cartao">
          <span className="app-g__selo"><ConciergeBell size={15} /> App do garçom</span>
          <h1>Link inválido</h1>
          <p className="app-g__sub">Este link não é de nenhum restaurante ativo. Peça o link certo ao gerente.</p>
        </main>
      </div>
    );
  }
  if (!s.usuario) return <EntrarGarcom info={info} />;
  if (!membro) {
    return (
      <div className="app-g" style={{ '--acento': info.cor } as CSSProperties}>
        <main className="app-g__cartao">
          <Marca info={info} />
          <h1>Conta sem acesso</h1>
          <p className="app-g__sub">
            A conta <b>{s.usuario.email}</b> não faz parte da equipe do {info.nome}. Peça ao gerente para cadastrar você.
          </p>
          <button className="app-g__botao app-g__botao--secundario" onClick={() => void s.sair()}><LogOut size={18} /> Entrar com outra conta</button>
        </main>
      </div>
    );
  }
  if (s.restaurante?.id !== membro.id) return <Carregando />;
  return <Garcom modoApp />;
}

function Marca({ info }: { info: Info }) {
  return (
    <div className="app-g__marca">
      {info.logo_url
        ? <img src={info.logo_url} alt="" />
        : <span>{info.nome.trim().charAt(0).toUpperCase()}</span>}
    </div>
  );
}

type EventoInstalar = Event & { prompt: () => Promise<void> };

function EntrarGarcom({ info }: { info: Info }) {
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
    // Com sucesso, a sessão muda e o app abre sozinho
  }

  return (
    <div className="app-g" style={{ '--acento': info.cor } as CSSProperties}>
      <main className="app-g__cartao">
        <Marca info={info} />
        <span className="app-g__selo"><ConciergeBell size={15} /> App do garçom</span>
        <h1>{info.nome}</h1>
        <p className="app-g__sub">Entre para receber os pedidos e os chamados das mesas no seu celular.</p>

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

        <p className="app-g__ajuda">Esqueceu a senha? Peça uma nova ao gerente.</p>
        {instalar && (
          <button className="app-g__botao app-g__botao--secundario" onClick={() => void instalar.prompt().then(() => setInstalar(null))}>
            <Download size={18} /> Instalar app no celular
          </button>
        )}
      </main>
      <footer className="app-g__rodape">BasilFiery</footer>
    </div>
  );
}
