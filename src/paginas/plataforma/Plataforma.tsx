import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Plus, Store } from 'lucide-react';
import { Campo, Logo, Switch, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { useSessao } from '../../lib/sessao';
import { gestao, msgErro, supabase } from '../../lib/supabase';
import type { Restaurante } from '../../lib/tipos';
import { dataHora } from '../../lib/util';
import { SITE } from '../../config/site';
import '../../estilos/painel.css';

export default function Plataforma() {
  const s = useSessao();
  const [temAdmin, setTemAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase.rpc('plataforma_tem_admin').then(({ data, error }) => setTemAdmin(error ? true : !!data));
  }, []);

  if (s.carregando || temAdmin === null) return <Carregando />;
  if (!temAdmin) return <PrimeiroAcesso />;
  if (!s.usuario) return <Navigate to="/login" replace state={{ de: '/plataforma' }} />;
  if (!s.ehAdmin) {
    return (
      <div className="tela-login">
        <div className="login card">
          <Logo tamanho="lg" />
          <h1 className="titulo">Área restrita</h1>
          <p className="muted">Esta área é só para a administração do {SITE.marca}.</p>
          <Link className="btn btn--primario" to="/painel">Ir para o painel</Link>
        </div>
      </div>
    );
  }
  return <Restaurantes />;
}

/** Cria a conta do administrador da plataforma. Só aparece enquanto não existe nenhum. */
function PrimeiroAcesso() {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function criar() {
    setErro('');
    setSalvando(true);
    try {
      await gestao('bootstrap', { nome, email, senha });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) throw error;
      window.location.assign('/plataforma');
    } catch (e) {
      setErro(msgErro(e));
      setSalvando(false);
    }
  }

  return (
    <div className="tela-login">
      <form className="login card" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
        <Logo tamanho="lg" />
        <h1 className="titulo">Configuração inicial</h1>
        <p className="muted">Crie a conta de administrador da plataforma. Esta tela só aparece uma vez.</p>
        <Campo rotulo="Seu nome"><input className="input" required value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
        <Campo rotulo="E-mail"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <Campo rotulo="Senha" dica="Mínimo 6 caracteres"><input className="input" type="password" required minLength={6} value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" /></Campo>
        {erro && <p className="erro-form">{erro}</p>}
        <button className="btn btn--primario btn--lg btn--bloco" disabled={salvando}>{salvando ? 'Criando…' : 'Criar administrador'}</button>
      </form>
    </div>
  );
}

function Restaurantes() {
  const s = useSessao();
  const toast = useToast();
  const [lista, setLista] = useState<Restaurante[] | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('restaurantes').select('*').order('criado_em', { ascending: false });
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as Restaurante[]);
  }, [toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function atualizar(r: Restaurante, mudancas: { ativo?: boolean; plano?: string }) {
    try {
      await gestao('atualizar_restaurante', { id: r.id, ...mudancas });
      void carregar();
      void s.recarregar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    }
  }

  return (
    <div className="plataforma">
      <div className="plataforma__topo">
        <Logo />
        <span className="badge badge--laranja">Administração da plataforma</span>
        <div>
          <Link to="/painel" className="btn btn--contorno btn--sm"><LayoutDashboard size={16} /> Painel</Link>
          <button className="btn btn--fantasma btn--sm" onClick={() => void s.sair()}><LogOut size={16} /> Sair</button>
        </div>
      </div>

      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Restaurantes clientes</h1>
          <p>Crie a conta de cada restaurante que contratar. O dono recebe o login e configura o resto.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setCriando(true)}><Plus size={18} /> Novo restaurante</button>
      </div>

      {!lista ? <Carregando /> : lista.length === 0 ? (
        <Vazio icone={<Store size={36} />} titulo="Nenhum restaurante ainda" />
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Restaurante</th><th>Plano</th><th>Desde</th><th>Ativo</th><th /></tr></thead>
            <tbody>
              {lista.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.nome}</strong></td>
                  <td>
                    <select className="select" style={{ width: 'auto', padding: '6px 10px' }} value={r.plano} onChange={(e) => void atualizar(r, { plano: e.target.value })}>
                      <option value="teste">Sem plano (teste)</option>
                      {SITE.planos.map((p) => <option key={p.nome} value={p.nome.toLowerCase()}>{p.nome}</option>)}
                    </select>
                  </td>
                  <td className="muted">{dataHora(r.criado_em)}</td>
                  <td><Switch marcado={r.ativo} aoMudar={(v) => void atualizar(r, { ativo: v })} /></td>
                  <td className="num">
                    <button className="btn btn--contorno btn--sm" onClick={() => { s.escolherRestaurante(r.id); window.location.assign('/painel'); }}>
                      Abrir painel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {criando && <ModalNovoRestaurante aoFechar={() => setCriando(false)} aoCriar={() => { setCriando(false); void carregar(); void s.recarregar(); }} />}
    </div>
  );
}

function ModalNovoRestaurante({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ nome: '', plano: 'essencial', mesas: '10', donoNome: '', donoEmail: '', donoSenha: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function criar() {
    setErro('');
    setSalvando(true);
    try {
      const r = await gestao<{ donoJaTinhaConta: boolean }>('criar_restaurante', {
        nome: f.nome,
        plano: f.plano,
        mesas: Number(f.mesas),
        dono: { nome: f.donoNome, email: f.donoEmail, senha: f.donoSenha },
      });
      toast(r.donoJaTinhaConta ? 'Restaurante criado. O dono já tinha conta e usa a senha dele.' : 'Restaurante criado! Envie o e-mail e a senha ao dono.', 'ok');
      aoCriar();
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Novo restaurante"
      largura={560}
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={salvando || !f.nome.trim() || !f.donoEmail.trim()} onClick={() => void criar()}>
            {salvando ? 'Criando…' : 'Criar restaurante'}
          </button>
        </>
      }
    >
      <div className="form">
        <Campo rotulo="Nome do restaurante"><input className="input" value={f.nome} onChange={(e) => mudar('nome', e.target.value)} autoFocus /></Campo>
        <div className="form-linha">
          <Campo rotulo="Plano">
            <select className="select" value={f.plano} onChange={(e) => mudar('plano', e.target.value)}>
              {SITE.planos.map((p) => <option key={p.nome} value={p.nome.toLowerCase()}>{p.nome}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Mesas para criar"><input className="input" type="number" min={0} max={200} value={f.mesas} onChange={(e) => mudar('mesas', e.target.value)} /></Campo>
        </div>
        <h3 style={{ margin: '8px 0 0', fontSize: '1rem' }}>Login do dono</h3>
        <Campo rotulo="Nome"><input className="input" value={f.donoNome} onChange={(e) => mudar('donoNome', e.target.value)} /></Campo>
        <div className="form-linha">
          <Campo rotulo="E-mail"><input className="input" type="email" value={f.donoEmail} onChange={(e) => mudar('donoEmail', e.target.value)} /></Campo>
          <Campo rotulo="Senha inicial" dica="Mín. 6 caracteres"><input className="input" type="text" value={f.donoSenha} onChange={(e) => mudar('donoSenha', e.target.value)} autoComplete="new-password" /></Campo>
        </div>
        {erro && <p className="erro-form">{erro}</p>}
      </div>
    </Modal>
  );
}
