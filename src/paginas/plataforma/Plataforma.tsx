import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { LayoutDashboard, LogOut, MessagesSquare, Plus, Receipt, Store, Trash2, Users } from 'lucide-react';
import { ResumoAvaliacoes, TimeSuporte } from './TimeSuporte';
import { CaixaSuporte, useCaixaSuporte } from '../../componentes/ChatSuporte';
import { notificarLocal, somLigado, tocarChamado } from '../../lib/som';
import { confirmar } from '../../componentes/Confirmar';
import { Campo, Logo, Switch, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { useSessao } from '../../lib/sessao';
import { gestao, msgErro, supabase } from '../../lib/supabase';
import type { Fatura, Restaurante } from '../../lib/tipos';
import { brl, dataHora, lerPreco, mascaraPreco } from '../../lib/util';
import { SITE } from '../../config/site';
import '../../estilos/painel.css';

export default function Plataforma() {
  const s = useSessao();
  const [temAdmin, setTemAdmin] = useState<boolean | null>(null);
  // Time de suporte (atendentes) entra só na central de atendimento
  const [atendente, setAtendente] = useState<boolean | null>(null);

  useEffect(() => {
    void supabase.rpc('plataforma_tem_admin').then(({ data, error }) => setTemAdmin(error ? true : !!data));
  }, []);
  useEffect(() => {
    if (!s.usuario) { setAtendente(false); return; }
    void supabase.rpc('eh_atendente').then(({ data }) => setAtendente(!!data));
  }, [s.usuario]);

  if (s.carregando || temAdmin === null || (s.usuario && atendente === null)) return <Carregando />;
  if (!temAdmin) return <PrimeiroAcesso />;
  if (!s.usuario) return <Navigate to="/login" replace state={{ de: `/plataforma${window.location.search}` }} />;
  if (!s.ehAdmin && atendente) return <Restaurantes admin={false} />;
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
  return <Restaurantes admin />;
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

function Restaurantes({ admin }: { admin: boolean }) {
  const s = useSessao();
  const toast = useToast();
  const [lista, setLista] = useState<Restaurante[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [cobranca, setCobranca] = useState<Restaurante | null>(null);
  const [params, setParams] = useSearchParams();
  const pedida = params.get('aba');
  const aba = !admin ? 'suporte' : pedida === 'suporte' || pedida === 'equipe' ? pedida : 'lojas';
  const suporte = useCaixaSuporte(true, (m) => {
    if (somLigado()) tocarChamado('sino');
    notificarLocal('Suporte · nova mensagem', m.texto, 'suporte-admin');
  });

  const carregar = useCallback(async () => {
    if (!admin) { setLista([]); return; }
    const { data, error } = await supabase.from('restaurantes').select('*').order('criado_em', { ascending: false });
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as Restaurante[]);
  }, [toast, admin]);

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
        <span className="badge badge--laranja">{admin ? 'Administração da plataforma' : 'Central de atendimento'}</span>
        <div>
          {admin && <Link to="/painel" className="btn btn--contorno btn--sm"><LayoutDashboard size={16} /> Painel</Link>}
          <button className="btn btn--fantasma btn--sm" onClick={() => void s.sair()}><LogOut size={16} /> Sair</button>
        </div>
      </div>

      <div className="plat-abas" role="tablist">
        {admin && <button type="button" role="tab" aria-selected={aba === 'lojas'} className={aba === 'lojas' ? 'ativo' : ''} onClick={() => setParams({})}><Store size={17} /> Restaurantes</button>}
        <button type="button" role="tab" aria-selected={aba === 'suporte'} className={aba === 'suporte' ? 'ativo' : ''} onClick={() => setParams({ aba: 'suporte' })}>
          <MessagesSquare size={17} /> Atendimento {suporte.naoLidas + suporte.esperando > 0 && <span className="plat-abas__selo">{suporte.naoLidas + suporte.esperando}</span>}
        </button>
        {admin && <button type="button" role="tab" aria-selected={aba === 'equipe'} className={aba === 'equipe' ? 'ativo' : ''} onClick={() => setParams({ aba: 'equipe' })}><Users size={17} /> Time de suporte</button>}
      </div>

      {aba === 'suporte' ? <><ResumoAvaliacoes /><CaixaSuporte conversas={suporte.conversas} /></> : aba === 'equipe' ? <TimeSuporte /> : <>
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
                    <div className="acoes-linha" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn btn--contorno btn--sm" onClick={() => setCobranca(r)}><Receipt size={15} /> Cobrança</button>
                      <button className="btn btn--contorno btn--sm" onClick={() => { s.escolherRestaurante(r.id); window.location.assign('/painel'); }}>
                        Abrir painel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}

      {criando && <ModalNovoRestaurante aoFechar={() => setCriando(false)} aoCriar={() => { setCriando(false); void carregar(); void s.recarregar(); }} />}
      {cobranca && <ModalCobranca restaurante={cobranca} aoFechar={() => setCobranca(null)} aoSalvar={() => { void carregar(); void s.recarregar(); }} />}
    </div>
  );
}

const FORMAS_PLANO = ['Pix', 'Boleto', 'Pix ou boleto', 'Cartão de crédito'];

/** Cobrança de um restaurante: valor, vencimento e forma do plano + faturas (aparecem para o dono em Minha conta). */
function ModalCobranca({ restaurante: r, aoFechar, aoSalvar }: { restaurante: Restaurante; aoFechar: () => void; aoSalvar: () => void }) {
  const toast = useToast();
  const [plano, setPlano] = useState({
    valor: r.plano_valor != null ? String(r.plano_valor).replace('.', ',') : '',
    vence: r.plano_vence_em ?? '',
    forma: r.plano_forma ?? 'Pix ou boleto',
  });
  const [faturas, setFaturas] = useState<Fatura[] | null>(null);
  const [nova, setNova] = useState({ referencia: '', valor: '', vencimento: '', link: '' });
  const [salvando, setSalvando] = useState(false);

  const carregarFaturas = useCallback(async () => {
    const { data } = await supabase.from('faturas').select('*').eq('restaurante_id', r.id).order('vencimento', { ascending: false });
    setFaturas((data ?? []) as Fatura[]);
  }, [r.id]);
  useEffect(() => { void carregarFaturas(); }, [carregarFaturas]);

  async function salvarPlano() {
    setSalvando(true);
    try {
      await gestao('atualizar_restaurante', {
        id: r.id,
        plano_valor: plano.valor.trim() ? lerPreco(plano.valor) : null,
        plano_vence_em: plano.vence || null,
        plano_forma: plano.forma,
      });
      toast('Cobrança salva.', 'ok');
      aoSalvar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  async function lancar() {
    const valor = lerPreco(nova.valor);
    if (!nova.referencia.trim() || !Number.isFinite(valor) || !nova.vencimento) return toast('Preencha referência, valor e vencimento.', 'erro');
    const { error } = await supabase.from('faturas').insert({
      restaurante_id: r.id, referencia: nova.referencia.trim(), valor, vencimento: nova.vencimento, link: nova.link.trim() || null,
    });
    if (error) return toast(msgErro(error), 'erro');
    setNova({ referencia: '', valor: '', vencimento: '', link: '' });
    void carregarFaturas();
  }

  async function marcarPaga(f: Fatura, paga: boolean) {
    const { error } = await supabase.from('faturas').update({ pago_em: paga ? new Date().toISOString() : null }).eq('id', f.id);
    if (error) return toast(msgErro(error), 'erro');
    void carregarFaturas();
  }

  async function excluir(f: Fatura) {
    if (!(await confirmar(`Excluir a fatura "${f.referencia}"?`, { sim: 'Excluir', perigo: true }))) return;
    const { error } = await supabase.from('faturas').delete().eq('id', f.id);
    if (error) return toast(msgErro(error), 'erro');
    void carregarFaturas();
  }

  return (
    <Modal aberto aoFechar={aoFechar} titulo={`Cobrança · ${r.nome}`} largura={680}>
      <div className="form">
        <h3 style={{ margin: 0, fontSize: '1rem' }}>Plano</h3>
        <div className="form-linha">
          <Campo rotulo="Valor mensal (R$)"><input className="input" inputMode="decimal" value={plano.valor} onChange={(e) => setPlano({ ...plano, valor: mascaraPreco(e.target.value) })} placeholder="149,00" /></Campo>
          <Campo rotulo="Vencimento do plano"><input className="input" type="date" value={plano.vence} onChange={(e) => setPlano({ ...plano, vence: e.target.value })} /></Campo>
          <Campo rotulo="Forma de pagamento">
            <select className="select" value={plano.forma} onChange={(e) => setPlano({ ...plano, forma: e.target.value })}>
              {FORMAS_PLANO.map((x) => <option key={x}>{x}</option>)}
            </select>
          </Campo>
        </div>
        <div className="acoes-linha" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--primario btn--sm" disabled={salvando} onClick={() => void salvarPlano()}>Salvar plano</button>
        </div>

        <h3 style={{ margin: '10px 0 0', fontSize: '1rem' }}>Faturas</h3>
        {faturas && faturas.length > 0 && (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Referência</th><th>Vencimento</th><th className="num">Valor</th><th>Paga</th><th /></tr></thead>
              <tbody>
                {faturas.map((f) => (
                  <tr key={f.id}>
                    <td>{f.referencia}</td>
                    <td>{new Date(`${f.vencimento}T12:00:00`).toLocaleDateString('pt-BR')}</td>
                    <td className="num">{brl(Number(f.valor))}</td>
                    <td><Switch marcado={!!f.pago_em} aoMudar={(v) => void marcarPaga(f, v)} /></td>
                    <td className="num"><button className="icone-btn icone-btn--perigo" onClick={() => void excluir(f)} aria-label="Excluir fatura"><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="form-linha">
          <Campo rotulo="Referência"><input className="input" value={nova.referencia} onChange={(e) => setNova({ ...nova, referencia: e.target.value })} placeholder="Novembro/2026" /></Campo>
          <Campo rotulo="Valor (R$)"><input className="input" inputMode="decimal" value={nova.valor} onChange={(e) => setNova({ ...nova, valor: mascaraPreco(e.target.value) })} /></Campo>
          <Campo rotulo="Vencimento"><input className="input" type="date" value={nova.vencimento} onChange={(e) => setNova({ ...nova, vencimento: e.target.value })} /></Campo>
        </div>
        <Campo rotulo="Link para pagar (opcional)" dica="Link do boleto ou do Pix"><input className="input" value={nova.link} onChange={(e) => setNova({ ...nova, link: e.target.value })} placeholder="https://…" /></Campo>
        <div className="acoes-linha" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn--contorno btn--sm" onClick={() => void lancar()}><Plus size={15} /> Lançar fatura</button>
        </div>
      </div>
    </Modal>
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
