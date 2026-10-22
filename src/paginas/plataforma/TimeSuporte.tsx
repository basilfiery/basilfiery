import { useCallback, useEffect, useState } from 'react';
import { Star, Trash2, UserPlus, Users } from 'lucide-react';
import { Campo, Vazio } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { confirmar } from '../../componentes/Confirmar';
import { useToast } from '../../componentes/Toast';
import { msgErro, supabase } from '../../lib/supabase';
import { dataHora } from '../../lib/util';

interface Resumo {
  media: number | null;
  total: number;
  ultimas: { nota: number; comentario: string | null; atendente_nome: string | null; loja: string; criado_em: string }[];
}

/** Nota média do suporte e as últimas avaliações das lojas. */
export function ResumoAvaliacoes() {
  const [r, setR] = useState<Resumo | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => { void supabase.rpc('suporte_avaliacoes_resumo').then(({ data }) => { if (data) setR(data as Resumo); }); }, []);
  if (!r || !r.total) return null;
  return (
    <div className="plat-notas">
      <button type="button" className="plat-notas__cab" onClick={() => setAberto((v) => !v)}>
        <Star size={16} className="plat-notas__estrela" /> <b>{Number(r.media).toLocaleString('pt-BR')}</b> de 5 · {r.total} {r.total === 1 ? 'avaliação' : 'avaliações'}
        <span className="plat-notas__ver">{aberto ? 'Esconder' : 'Ver últimas'}</span>
      </button>
      {aberto && (
        <ul className="plat-notas__lista">
          {r.ultimas.map((a, i) => (
            <li key={i}>
              <span className="plat-notas__nota">{'★'.repeat(a.nota)}<i>{'★'.repeat(5 - a.nota)}</i></span>
              <span className="plat-notas__txt"><b>{a.loja}</b>{a.atendente_nome ? ` · atendido por ${a.atendente_nome}` : ''}{a.comentario && <em>“{a.comentario}”</em>}</span>
              <small>{dataHora(a.criado_em)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Atendente { user_id: string; nome: string; email: string }

/** Quem do time pode atender na central (hq.basilfiery.com.br). */
export function TimeSuporte() {
  const toast = useToast();
  const [lista, setLista] = useState<Atendente[] | null>(null);
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('suporte_atendentes');
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as Atendente[]);
  }, [toast]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function adicionar() {
    if (!email.trim()) return;
    setSalvando(true);
    const { error } = await supabase.rpc('suporte_atendente_adicionar', { p_email: email.trim(), p_nome: nome.trim() });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    setEmail('');
    setNome('');
    toast('Pessoa adicionada ao time de suporte.', 'ok');
    void carregar();
  }
  async function remover(a: Atendente) {
    if (!(await confirmar(`Tirar ${a.nome} do time de suporte?`, { sim: 'Tirar', perigo: true }))) return;
    const { error } = await supabase.rpc('suporte_atendente_remover', { p_user: a.user_id });
    if (error) return toast(msgErro(error), 'erro');
    void carregar();
  }

  return (
    <div className="plat-time">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Time de suporte</h1>
          <p>Quem entra em <b>hq.basilfiery.com.br</b> e responde as lojas. A pessoa precisa ter uma conta (e-mail e senha) no BasilFiery.</p>
        </div>
      </div>
      <div className="card plat-time__novo">
        <Campo rotulo="E-mail da conta"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@email.com" /></Campo>
        <Campo rotulo="Nome que a loja vê"><input className="input" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Ana" /></Campo>
        <button className="btn btn--primario" onClick={() => void adicionar()} disabled={salvando || !email.trim()}><UserPlus size={17} /> Adicionar</button>
      </div>
      {!lista ? <Carregando /> : lista.length === 0 ? (
        <Vazio icone={<Users size={32} />} titulo="Só você atende por enquanto">Adicione pessoas do seu time para responder as lojas.</Vazio>
      ) : (
        <ul className="plat-time__lista">
          {lista.map((a) => (
            <li key={a.user_id} className="card">
              <span className="plat-time__avatar">{a.nome.slice(0, 1).toUpperCase()}</span>
              <span className="plat-time__txt"><b>{a.nome}</b><small>{a.email}</small></span>
              <button className="icone-btn icone-btn--perigo" onClick={() => void remover(a)} aria-label={`Tirar ${a.nome}`}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
