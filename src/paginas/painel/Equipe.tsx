import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Trash2, Users } from 'lucide-react';
import { Campo, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { useSessao } from '../../lib/sessao';
import { gestao, msgErro, supabase } from '../../lib/supabase';
import type { Membro, Papel } from '../../lib/tipos';
import { PAPEL_ROTULO } from '../../lib/util';
import { usePainel } from './Painel';

const DESCRICAO_PAPEL: Record<Papel, string> = {
  dono: 'Acesso total, inclusive equipe.',
  gerente: 'Cardápio, mesas, estoque e equipe.',
  caixa: 'Pedidos, mesas, fechar contas e estoque.',
  garcom: 'Pedidos e chamados no celular.',
};

export default function Equipe() {
  const { restaurante, papel } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [membros, setMembros] = useState<Membro[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const [trocandoSenha, setTrocandoSenha] = useState<Membro | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('membros').select('*').eq('restaurante_id', restaurante.id).order('nome');
    if (error) toast(msgErro(error), 'erro');
    setMembros((data ?? []) as Membro[]);
  }, [restaurante.id, toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function mudarPapel(m: Membro, novo: Papel) {
    const { error } = await supabase.from('membros').update({ papel: novo })
      .eq('restaurante_id', m.restaurante_id).eq('user_id', m.user_id);
    if (error) toast(msgErro(error), 'erro');
    void carregar();
  }

  async function remover(m: Membro) {
    if (!confirm(`Remover ${m.nome} da equipe? A pessoa perde o acesso a este restaurante.`)) return;
    const { error } = await supabase.from('membros').delete()
      .eq('restaurante_id', m.restaurante_id).eq('user_id', m.user_id);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${m.nome} removido(a).`, 'ok');
    void carregar();
  }

  const podeAdicionarDono = papel === 'dono' || s.ehAdmin;

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Equipe</h1>
          <p>Cada pessoa entra com o próprio e-mail e senha e vê só o que o cargo permite.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setAdicionando(true)}><Plus size={18} /> Adicionar pessoa</button>
      </div>

      {membros.length === 0 ? (
        <Vazio icone={<Users size={36} />} titulo="Ninguém na equipe ainda" />
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Cargo</th><th /></tr></thead>
            <tbody>
              {membros.map((m) => {
                const souEu = m.user_id === s.usuario?.id;
                const editavel = m.papel !== 'dono' && !souEu;
                return (
                  <tr key={m.user_id}>
                    <td><strong>{m.nome}</strong>{souEu && <span className="muted"> (você)</span>}</td>
                    <td className="muted">{m.email}</td>
                    <td>
                      {editavel ? (
                        <select className="select" style={{ width: 'auto', padding: '6px 10px' }} value={m.papel} onChange={(e) => void mudarPapel(m, e.target.value as Papel)}>
                          {(['gerente', 'caixa', 'garcom'] as Papel[]).map((p) => <option key={p} value={p}>{PAPEL_ROTULO[p]}</option>)}
                        </select>
                      ) : (
                        <span className="badge badge--laranja">{PAPEL_ROTULO[m.papel]}</span>
                      )}
                    </td>
                    <td className="num">
                      {editavel && (
                        <div className="acoes-linha" style={{ justifyContent: 'flex-end' }}>
                          <button className="icone-btn" title="Nova senha" aria-label={`Nova senha para ${m.nome}`} onClick={() => setTrocandoSenha(m)}><KeyRound size={18} /></button>
                          <button className="icone-btn icone-btn--perigo" title="Remover" aria-label={`Remover ${m.nome}`} onClick={() => void remover(m)}><Trash2 size={18} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="card">
        <h2 className="card__titulo">O que cada cargo pode fazer</h2>
        <ul className="historico">
          {(Object.keys(DESCRICAO_PAPEL) as Papel[]).map((p) => (
            <li key={p}><span className="badge badge--laranja" style={{ minWidth: 70, justifyContent: 'center' }}>{PAPEL_ROTULO[p]}</span><div>{DESCRICAO_PAPEL[p]}</div></li>
          ))}
        </ul>
      </section>

      {adicionando && (
        <ModalAdicionar
          restauranteId={restaurante.id}
          podeAdicionarDono={podeAdicionarDono}
          aoFechar={() => setAdicionando(false)}
          aoSalvar={() => { setAdicionando(false); void carregar(); }}
        />
      )}
      {trocandoSenha && <ModalSenha membro={trocandoSenha} aoFechar={() => setTrocandoSenha(null)} />}
    </div>
  );
}

function ModalAdicionar({ restauranteId, podeAdicionarDono, aoFechar, aoSalvar }: {
  restauranteId: string;
  podeAdicionarDono: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const toast = useToast();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [papel, setPapel] = useState<Papel>('garcom');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar() {
    setErro('');
    setSalvando(true);
    try {
      const r = await gestao<{ jaExistia: boolean }>('criar_membro', { restaurante_id: restauranteId, nome, email, senha, papel });
      toast(r.jaExistia ? `${nome} já tinha conta: use a senha que já usa.` : `${nome} adicionado(a). Passe o e-mail e a senha para a pessoa.`, 'ok');
      aoSalvar();
    } catch (e) {
      setErro(msgErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const papeis: Papel[] = podeAdicionarDono ? ['garcom', 'caixa', 'gerente', 'dono'] : ['garcom', 'caixa', 'gerente'];

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Adicionar pessoa"
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={salvando || !nome.trim() || !email.trim()} onClick={() => void salvar()}>
            {salvando ? 'Salvando…' : 'Adicionar'}
          </button>
        </>
      }
    >
      <div className="form">
        <Campo rotulo="Nome"><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus /></Campo>
        <Campo rotulo="E-mail (será o login)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <Campo rotulo="Senha inicial" dica="Mínimo 6 caracteres. Se a pessoa já tiver conta, a senha dela continua a mesma.">
          <input className="input" type="text" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
        </Campo>
        <Campo rotulo="Cargo" dica={DESCRICAO_PAPEL[papel]}>
          <select className="select" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
            {papeis.map((p) => <option key={p} value={p}>{PAPEL_ROTULO[p]}</option>)}
          </select>
        </Campo>
        {erro && <p className="erro-form">{erro}</p>}
      </div>
    </Modal>
  );
}

function ModalSenha({ membro, aoFechar }: { membro: Membro; aoFechar: () => void }) {
  const toast = useToast();
  const [senha, setSenha] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await gestao('redefinir_senha', { user_id: membro.user_id, senha });
      toast(`Senha de ${membro.nome} alterada.`, 'ok');
      aoFechar();
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={`Nova senha para ${membro.nome}`}
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" disabled={senha.length < 6 || salvando} onClick={() => void salvar()}>Salvar senha</button>
        </>
      }
    >
      <Campo rotulo="Nova senha" dica="Mínimo 6 caracteres.">
        <input className="input" type="text" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" autoFocus />
      </Campo>
    </Modal>
  );
}
