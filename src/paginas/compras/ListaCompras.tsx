import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Clock, Flame, Hourglass, LogOut, Plus, ShoppingCart, Store, X } from 'lucide-react';
import { Carregando } from '../../componentes/Carregando';
import { useToast } from '../../componentes/Toast';
import { useAppInstalavel } from '../../lib/manifesto';
import { msgErro, supabase } from '../../lib/supabase';
import { cx, ls, tempoDesde, useAgora } from '../../lib/util';
import '../../estilos/lista.css';

/* =====================================================================
   Lista de compras da equipe: /lista/<codigo>
   Cada funcionário se cadastra (nome + senha de 4 números), o dono libera,
   e ele manda o que precisa repor para o dia seguinte.
   ===================================================================== */

interface Loja { nome: string; logo_url: string | null; cor: string }
interface Item {
  id: string; nome: string; quantidade: string | null; obs: string | null; setor: string | null; urgente: boolean;
  pedido_por: string | null; meu: boolean; status: 'pendente' | 'comprado'; criado_em: string; comprado_em: string | null;
}
interface Eu { pessoa: { nome: string; setor: string; status: 'pendente' | 'ativo' | 'bloqueado' }; loja: Loja; itens: Item[] }

const SETORES = ['Cozinha', 'Bar', 'Salão', 'Caixa', 'Limpeza', 'Entregas', 'Outro'];
const SUGESTOES: Record<string, string[]> = {
  Cozinha: ['Tomate', 'Cebola', 'Mussarela', 'Pimentão', 'Cheiro-verde', 'Carne', 'Frango', 'Calabresa', 'Presunto', 'Farinha de trigo', 'Óleo', 'Ovos', 'Batata', 'Molho de tomate'],
  Bar: ['Gelo', 'Limão', 'Refrigerante', 'Cerveja', 'Água mineral', 'Açúcar', 'Copo descartável', 'Canudo'],
  Limpeza: ['Detergente', 'Água sanitária', 'Desinfetante', 'Esponja', 'Saco de lixo', 'Papel toalha', 'Papel higiênico', 'Álcool', 'Sabão em pó'],
  Salão: ['Guardanapo', 'Palito', 'Sachê de ketchup', 'Sachê de maionese', 'Vela'],
  Caixa: ['Bobina de impressora', 'Troco (moedas)', 'Sacola', 'Caneta'],
  Entregas: ['Embalagem de pizza', 'Marmitex', 'Sacola térmica', 'Lacre'],
};
const QTDS = ['1 un', '2 un', '1 kg', '2 kg', '5 kg', '1 cx', '1 pct', '1 fardo'];
const sessaoInvalida = (e: unknown) => /SESSAO_INVALIDA/.test(msgErro(e));

export default function ListaCompras() {
  const { codigo = '' } = useParams();
  const chave = `bf:lista:${codigo}`;
  const [token, setToken] = useState<string>(() => ls.ler(chave, ''));
  const [loja, setLoja] = useState<Loja | null | undefined>(undefined);
  const [eu, setEu] = useState<Eu | null>(null);

  // Tela clara, como um app
  useEffect(() => {
    document.documentElement.dataset.tema = 'claro';
    return () => { delete document.documentElement.dataset.tema; };
  }, []);
  useEffect(() => { void supabase.rpc('compras_loja', { p_codigo: codigo }).then(({ data }) => setLoja((data as Loja | null) ?? null)); }, [codigo]);
  useAppInstalavel(loja ? { nome: `Compras · ${loja.nome}`, curto: 'Compras', inicio: `/lista/${codigo}`, escopo: `/lista/${codigo}` } : null);

  const sair = useCallback(() => { ls.gravar(chave, ''); setToken(''); setEu(null); }, [chave]);
  const atualizar = useCallback(async () => {
    if (!token) return;
    const { data, error } = await supabase.rpc('compras_eu', { p_token: token });
    if (error) { if (sessaoInvalida(error)) sair(); return; }
    setEu(data as Eu);
  }, [token, sair]);
  useEffect(() => {
    void atualizar();
    const i = setInterval(() => void atualizar(), 15000);
    const voltar = () => { if (document.visibilityState === 'visible') void atualizar(); };
    document.addEventListener('visibilitychange', voltar);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', voltar); };
  }, [atualizar]);

  const entrar = (t: string) => { ls.gravar(chave, t); setToken(t); };
  const cor = eu?.loja.cor ?? loja?.cor ?? '#ff5a1f';

  if (loja === undefined || (token && !eu)) return <Carregando texto="Abrindo a lista…" />;
  if (loja === null) {
    return (
      <div className="lista lista--centro">
        <span className="lista__icone-grande"><Store size={36} /></span>
        <h1>Link inválido</h1>
        <p>Peça um link novo para o responsável.</p>
      </div>
    );
  }

  return (
    <div className="lista" style={{ '--acento': cor } as CSSProperties}>
      <header className="lista__topo">
        {loja.logo_url ? <img src={loja.logo_url} alt="" /> : <span className="lista__letra">{loja.nome.charAt(0)}</span>}
        <div>
          <strong>{loja.nome}</strong>
          <small>Lista de compras da equipe</small>
        </div>
        {eu && <button className="lista__sair" onClick={sair} aria-label="Sair"><LogOut size={18} /></button>}
      </header>
      {!eu ? <Entrada codigo={codigo} aoEntrar={entrar} /> : eu.pessoa.status === 'ativo'
        ? <Pedir eu={eu} token={token} aoMudar={() => void atualizar()} />
        : (
          <div className="lista__espera">
            <span className="lista__icone-grande">{eu.pessoa.status === 'pendente' ? <Hourglass size={34} /> : <X size={34} />}</span>
            <h1>{eu.pessoa.status === 'pendente' ? `Quase lá, ${eu.pessoa.nome.split(' ')[0]}!` : 'Acesso desligado'}</h1>
            <p>{eu.pessoa.status === 'pendente'
              ? 'Seu cadastro chegou para o responsável. Assim que ele liberar, esta tela muda sozinha e você já pode mandar a lista.'
              : 'O responsável desligou seu acesso à lista de compras. Fale com ele se precisar.'}</p>
            {eu.pessoa.status === 'pendente' && <span className="lista__pulso">Aguardando liberação…</span>}
          </div>
        )}
    </div>
  );
}

function Entrada({ codigo, aoEntrar }: { codigo: string; aoEntrar: (token: string) => void }) {
  const toast = useToast();
  const [modo, setModo] = useState<'cadastro' | 'entrar'>('cadastro');
  const [nome, setNome] = useState('');
  const [setor, setSetor] = useState('Cozinha');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4,6}$/.test(pin)) return toast('A senha precisa ter de 4 a 6 números.', 'erro');
    if (modo === 'cadastro' && pin !== pin2) return toast('As senhas não são iguais.', 'erro');
    setEnviando(true);
    const { data, error } = modo === 'cadastro'
      ? await supabase.rpc('compras_cadastrar', { p_codigo: codigo, p_nome: nome, p_setor: setor, p_pin: pin })
      : await supabase.rpc('compras_entrar', { p_codigo: codigo, p_nome: nome, p_pin: pin });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    aoEntrar(data as string);
  }

  return (
    <form className="lista__entrada" onSubmit={enviar}>
      <div className="lista__boas">
        <span className="lista__icone-grande"><ShoppingCart size={32} /></span>
        <h1>{modo === 'cadastro' ? 'Faça seu cadastro' : 'Entrar'}</h1>
        <p>{modo === 'cadastro' ? 'Uma vez só. Depois é só abrir este link e anotar o que precisa repor.' : 'Use o nome e a senha que você cadastrou.'}</p>
      </div>
      <div className="lista__modos">
        <button type="button" className={cx(modo === 'cadastro' && 'ativo')} onClick={() => setModo('cadastro')}>Primeiro acesso</button>
        <button type="button" className={cx(modo === 'entrar' && 'ativo')} onClick={() => setModo('entrar')}>Já tenho cadastro</button>
      </div>
      <label className="campo"><span>Seu nome</span><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoComplete="name" placeholder="Ex.: Maria Silva" required /></label>
      {modo === 'cadastro' && (
        <div className="campo">
          <span>Onde você trabalha?</span>
          <div className="lista__chips">
            {SETORES.map((x) => <button type="button" key={x} className={cx('lista__chip', setor === x && 'ativo')} onClick={() => setSetor(x)}>{x}</button>)}
          </div>
        </div>
      )}
      <label className="campo"><span>{modo === 'cadastro' ? 'Crie uma senha (4 a 6 números)' : 'Senha'}</span>
        <input className="input lista__pin" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" autoComplete={modo === 'cadastro' ? 'new-password' : 'current-password'} placeholder="••••" required />
      </label>
      {modo === 'cadastro' && (
        <label className="campo"><span>Repita a senha</span>
          <input className="input lista__pin" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" type="password" autoComplete="new-password" placeholder="••••" required />
        </label>
      )}
      <button className="btn btn--primario btn--lg btn--bloco" disabled={enviando || nome.trim().length < 2}>{enviando ? 'Aguarde…' : modo === 'cadastro' ? 'Cadastrar' : 'Entrar'}</button>
    </form>
  );
}

function Pedir({ eu, token, aoMudar }: { eu: Eu; token: string; aoMudar: () => void }) {
  const toast = useToast();
  const agora = useAgora(60000);
  const [nome, setNome] = useState('');
  const [qtd, setQtd] = useState('');
  const [obs, setObs] = useState('');
  const [urgente, setUrgente] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const pendentes = eu.itens.filter((i) => i.status === 'pendente');
  const comprados = eu.itens.filter((i) => i.status === 'comprado');
  const jaTem = (n: string) => pendentes.find((i) => i.nome.trim().toLowerCase() === n.trim().toLowerCase());
  const sugestoes = (SUGESTOES[eu.pessoa.setor] ?? [...SUGESTOES.Cozinha.slice(0, 6), ...SUGESTOES.Limpeza.slice(0, 4)]).filter((x) => !jaTem(x)).slice(0, 12);

  async function enviar(e?: FormEvent) {
    e?.preventDefault();
    if (!nome.trim()) return;
    const igual = jaTem(nome);
    if (igual) return toast(`"${igual.nome}" já está na lista (pedido por ${igual.pedido_por ?? 'alguém'}).`, 'info');
    setEnviando(true);
    const { error } = await supabase.rpc('compras_pedir', { p_token: token, p_nome: nome, p_quantidade: qtd, p_obs: obs, p_urgente: urgente });
    setEnviando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${nome.trim()} anotado na lista.`, 'ok');
    setNome(''); setQtd(''); setObs(''); setUrgente(false);
    aoMudar();
  }

  async function remover(i: Item) {
    const { error } = await supabase.rpc('compras_remover', { p_token: token, p_item: i.id });
    if (error) return toast(msgErro(error), 'erro');
    aoMudar();
  }

  return (
    <main className="lista__corpo">
      <p className="lista__ola">Olá, <b>{eu.pessoa.nome.split(' ')[0]}</b> · {eu.pessoa.setor}</p>
      <form className="lista__form" onSubmit={enviar}>
        <h1>O que precisa repor?</h1>
        <input className="input input--grande" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Ex.: Mussarela" enterKeyHint="next" />
        {sugestoes.length > 0 && !nome && (
          <div className="lista__chips lista__chips--rolar">
            {sugestoes.map((x) => <button type="button" key={x} className="lista__chip" onClick={() => setNome(x)}><Plus size={13} /> {x}</button>)}
          </div>
        )}
        <div className="campo">
          <span>Quantidade</span>
          <div className="lista__chips">
            {QTDS.map((x) => <button type="button" key={x} className={cx('lista__chip', qtd === x && 'ativo')} onClick={() => setQtd(qtd === x ? '' : x)}>{x}</button>)}
          </div>
          <input className="input" value={qtd} onChange={(e) => setQtd(e.target.value)} maxLength={30} placeholder="Ou escreva: 3 kg, 2 caixas…" />
        </div>
        <input className="input" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={200} placeholder="Observação (opcional): marca, tamanho…" />
        <button type="button" className={cx('lista__urgente', urgente && 'ativo')} onClick={() => setUrgente((v) => !v)} aria-pressed={urgente}>
          <Flame size={18} /> {urgente ? 'Urgente: precisa amanhã cedo' : 'Marcar como urgente'}
        </button>
        <button className="btn btn--primario btn--lg btn--bloco" disabled={enviando || !nome.trim()}>{enviando ? 'Anotando…' : 'Colocar na lista'}</button>
      </form>

      <section className="lista__secao">
        <h2>Na lista para comprar <small>{pendentes.length}</small></h2>
        {pendentes.length === 0 ? <p className="lista__vazio">A lista está vazia.</p> : (
          <ul className="lista__itens">
            {pendentes.map((i) => (
              <li key={i.id} className={cx(i.meu && 'meu', i.urgente && 'urgente')}>
                <div>
                  <strong>{i.nome}{i.quantidade && <span>{i.quantidade}</span>}{i.urgente && <em><Flame size={11} /> Urgente</em>}</strong>
                  <small><Clock size={11} /> {i.meu ? 'Você' : i.pedido_por} · {tempoDesde(i.criado_em, agora)}{i.obs ? ` · ${i.obs}` : ''}</small>
                </div>
                {i.meu && <button onClick={() => void remover(i)} aria-label={`Tirar ${i.nome}`}><X size={16} /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {comprados.length > 0 && (
        <section className="lista__secao">
          <h2>Já foram comprados</h2>
          <ul className="lista__itens">
            {comprados.map((i) => (
              <li key={i.id} className="comprado">
                <div><strong><Check size={14} /> {i.nome}{i.quantidade && <span>{i.quantidade}</span>}</strong><small>{i.comprado_em ? `comprado ${tempoDesde(i.comprado_em, agora)}` : ''}</small></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
