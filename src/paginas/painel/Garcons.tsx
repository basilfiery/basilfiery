import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, MessageCircle, Plus, Send, Trash2, UserRound, Wand2 } from 'lucide-react';
import { Campo, Vazio } from '../../componentes/Basicos';
import { Modal } from '../../componentes/Modal';
import { Avatar } from '../../componentes/Perfil';
import { LinkCopiavel, QrCartao } from '../../componentes/Link';
import { useToast } from '../../componentes/Toast';
import { gestao, msgErro, supabase } from '../../lib/supabase';
import type { Membro } from '../../lib/tipos';
import { usePainel } from './Painel';
import { origemSistema } from '../../lib/linkCurto';
import { confirmar } from '../../componentes/Confirmar';

interface Acesso { nome: string; email: string; senha?: string; telefone?: string; jaTinhaConta?: boolean }

/** Link do app do garçom: separado do sistema (não passa pela tela de login do caixa). */
const linkApp = (codigo: string, email?: string) =>
  `${origemSistema()}/g/${codigo}${email ? `?email=${encodeURIComponent(email)}` : ''}`;

/** Senha fácil de ditar/digitar no celular (sem letras confusas como l/1, O/0). */
function gerarSenha() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const numeros = '23456789';
  const pega = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 4 }, () => pega(letras)).join('') + Array.from({ length: 4 }, () => pega(numeros)).join('');
}

const copiar = async (texto: string) => { await navigator.clipboard.writeText(texto); };

export default function Garcons() {
  const { restaurante } = usePainel();
  const toast = useToast();
  const [lista, setLista] = useState<Membro[] | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  const [acesso, setAcesso] = useState<Acesso | null>(null);
  const [trocandoSenha, setTrocandoSenha] = useState<Membro | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('membros').select('*')
      .eq('restaurante_id', restaurante.id).eq('papel', 'garcom').order('nome');
    if (error) toast(msgErro(error), 'erro');
    setLista((data ?? []) as Membro[]);
  }, [restaurante.id, toast]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function remover(m: Membro) {
    if (!(await confirmar(`Remover ${m.nome}?\n\nA pessoa perde o acesso a este restaurante.`, { sim: 'Remover', perigo: true }))) return;
    const { error } = await supabase.from('membros').delete().eq('restaurante_id', m.restaurante_id).eq('user_id', m.user_id);
    if (error) return toast(msgErro(error), 'erro');
    toast(`${m.nome} removido(a).`, 'ok');
    void carregar();
  }

  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Garçons</h1>
          <p>Cadastre os garçons e envie o acesso. No celular eles recebem os pedidos e os chamados das mesas.</p>
        </div>
        <button className="btn btn--primario" onClick={() => setCadastrando(true)}><Plus size={18} /> Cadastrar garçom</button>
      </div>

      <div className="garcons">
        <section className="card garcons__lista">
          <h2 className="card__titulo">Equipe de salão <small>{lista?.length ?? ''}</small></h2>
          {!lista ? null : lista.length === 0 ? (
            <Vazio icone={<UserRound size={32} />} titulo="Nenhum garçom cadastrado">
              Clique em <b>Cadastrar garçom</b> para criar o primeiro acesso.
            </Vazio>
          ) : (
            <ul className="garcons__itens">
              {lista.map((m) => (
                <li key={m.user_id}>
                  <Avatar nome={m.nome} foto={m.foto_url} tamanho={48} />
                  <div className="garcons__info">
                    <strong>{m.nome}</strong>
                    <small>{m.email}</small>
                    {!m.foto_url && <small className="garcons__dica">Ainda sem foto: ele coloca em “Meu perfil” no celular</small>}
                  </div>
                  <div className="acoes-linha">
                    <button className="btn btn--contorno btn--sm" onClick={() => setAcesso({ nome: m.nome, email: m.email ?? '' })}><Send size={16} /> Enviar acesso</button>
                    <button className="icone-btn" title="Nova senha" aria-label={`Nova senha para ${m.nome}`} onClick={() => setTrocandoSenha(m)}><KeyRound size={18} /></button>
                    <button className="icone-btn icone-btn--perigo" title="Remover" aria-label={`Remover ${m.nome}`} onClick={() => void remover(m)}><Trash2 size={18} /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="card garcons__acesso">
          <div className="garcons__acesso-cab">
            <h2 className="card__titulo">App do garçom</h2>
            <p>Link exclusivo da equipe de salão, separado do sistema do caixa.</p>
          </div>
          <LinkCopiavel link={linkApp(restaurante.codigo)} />
          <QrCartao link={linkApp(restaurante.codigo)} legenda="Aponte a câmera do celular" arquivo="qr-app-garcom" />
          <ol className="passos">
            <li><span>1</span><div>Abra o link no celular <small>ou leia o QR code com a câmera</small></div></li>
            <li><span>2</span><div>Entre com e-mail e senha <small>os que você cadastrou aqui</small></div></li>
            <li><span>3</span><div>Toque em <b>Ativar notificações</b> <small>para receber pedidos e chamados</small></div></li>
            <li><span>4</span><div>Coloque a foto em <b>Meu perfil</b> <small>tocando na bolinha no topo</small></div></li>
          </ol>
        </aside>
      </div>

      {cadastrando && (
        <ModalCadastrar
          restauranteId={restaurante.id}
          aoFechar={() => setCadastrando(false)}
          aoCriar={(a) => { setCadastrando(false); setAcesso(a); void carregar(); }}
        />
      )}
      {trocandoSenha && (
        <ModalNovaSenha
          membro={trocandoSenha}
          aoFechar={() => setTrocandoSenha(null)}
          aoSalvar={(senha) => { setAcesso({ nome: trocandoSenha.nome, email: trocandoSenha.email ?? '', senha }); setTrocandoSenha(null); }}
        />
      )}
      {acesso && <ModalEnviarAcesso acesso={acesso} restaurante={restaurante.nome} codigo={restaurante.codigo} aoFechar={() => setAcesso(null)} />}
    </div>
  );
}

function ModalCadastrar({ restauranteId, aoFechar, aoCriar }: { restauranteId: string; aoFechar: () => void; aoCriar: (a: Acesso) => void }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState(gerarSenha);
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setErro('');
    setSalvando(true);
    try {
      const r = await gestao<{ jaExistia: boolean }>('criar_membro', { restaurante_id: restauranteId, nome, email, senha, papel: 'garcom' });
      aoCriar({ nome: nome.trim(), email: email.trim().toLowerCase(), senha: r.jaExistia ? undefined : senha, telefone, jaTinhaConta: r.jaExistia });
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
      titulo="Cadastrar garçom"
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando || !nome.trim() || !email.trim() || senha.length < 6}>
            {salvando ? 'Cadastrando…' : 'Cadastrar e enviar acesso'}
          </button>
        </>
      }
    >
      <div className="form">
        <Campo rotulo="Nome"><input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoFocus /></Campo>
        <Campo rotulo="E-mail (será o login)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Campo>
        <Campo rotulo="Senha inicial" dica="Mínimo 6 caracteres. Depois ele pode pedir uma nova a você.">
          <div className="acoes-linha" style={{ flexWrap: 'nowrap' }}>
            <input className="input" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
            <button type="button" className="btn btn--contorno" onClick={() => setSenha(gerarSenha())} title="Gerar outra senha"><Wand2 size={16} /> Gerar</button>
          </div>
        </Campo>
        <Campo rotulo="WhatsApp do garçom (opcional)" dica="Só para enviar o acesso agora. Ex.: 11 98765-4321">
          <input className="input" inputMode="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </Campo>
        {erro && <p className="erro-form">{erro}</p>}
      </div>
    </Modal>
  );
}

function ModalNovaSenha({ membro, aoFechar, aoSalvar }: { membro: Membro; aoFechar: () => void; aoSalvar: (senha: string) => void }) {
  const toast = useToast();
  const [senha, setSenha] = useState(gerarSenha);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    try {
      await gestao('redefinir_senha', { user_id: membro.user_id, senha });
      toast(`Senha de ${membro.nome} alterada.`, 'ok');
      aoSalvar(senha);
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
          <button className="btn btn--primario" disabled={senha.length < 6 || salvando} onClick={() => void salvar()}>Salvar e enviar</button>
        </>
      }
    >
      <Campo rotulo="Nova senha" dica="Mínimo 6 caracteres.">
        <div className="acoes-linha" style={{ flexWrap: 'nowrap' }}>
          <input className="input" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" autoFocus />
          <button type="button" className="btn btn--contorno" onClick={() => setSenha(gerarSenha())}><Wand2 size={16} /> Gerar</button>
        </div>
      </Campo>
    </Modal>
  );
}

function ModalEnviarAcesso({ acesso, restaurante, codigo, aoFechar }: { acesso: Acesso; restaurante: string; codigo: string; aoFechar: () => void }) {
  const toast = useToast();
  const mensagem = [
    `Olá, ${acesso.nome.split(' ')[0]}! Seu acesso ao app do garçom do ${restaurante}:`,
    '',
    `🔗 ${linkApp(codigo, acesso.email)}`,
    `📧 E-mail: ${acesso.email}`,
    acesso.senha ? `🔑 Senha: ${acesso.senha}` : '🔑 Senha: a mesma que você já usa',
    '',
    'Abra o link no celular, entre e toque em “Ativar notificações” para receber os pedidos e os chamados das mesas. Toque na bolinha do topo para colocar sua foto.',
  ].join('\n');
  const numero = (acesso.telefone ?? '').replace(/\D/g, '');
  const destino = numero ? (numero.length <= 11 ? `55${numero}` : numero) : '';
  const linkWhats = `https://wa.me/${destino}?text=${encodeURIComponent(mensagem)}`;

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={`Acesso de ${acesso.nome}`}
      largura={520}
      rodape={
        <>
          <button className="btn btn--contorno" onClick={() => void copiar(mensagem).then(() => toast('Mensagem copiada!', 'ok'))}><Copy size={16} /> Copiar mensagem</button>
          <a className="btn btn--whats" href={linkWhats} target="_blank" rel="noopener"><MessageCircle size={18} /> Enviar pelo WhatsApp</a>
        </>
      }
    >
      {acesso.jaTinhaConta && (
        <p className="caixa__alerta" style={{ marginTop: 0 }}>Este e-mail já tinha conta no BasilFiery: o garçom entra com a senha que já usa.</p>
      )}
      <pre className="mensagem-acesso">{mensagem}</pre>
      {acesso.senha && <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>Anote a senha: por segurança, ela não fica salva para ser vista depois.</p>}
    </Modal>
  );
}
