import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Campo } from './Basicos';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { useSessao } from '../lib/sessao';
import { ACEITA_IMAGEM, enviarFotoPerfil, msgErro, supabase } from '../lib/supabase';
import { cx } from '../lib/util';

export const iniciais = (nome: string) =>
  nome.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

/** Bolinha com a foto da pessoa, ou as iniciais quando não tem foto. */
export function Avatar({ nome, foto, tamanho = 36, classe }: { nome: string; foto?: string | null; tamanho?: number; classe?: string }) {
  return (
    <span className={cx('avatar', classe)} style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.36 }}>
      {foto ? <img src={foto} alt="" /> : iniciais(nome)}
    </span>
  );
}

/** "Meu perfil": a própria pessoa troca a foto e o nome que aparece para a equipe. */
export function ModalPerfil({ aoFechar }: { aoFechar: () => void }) {
  const s = useSessao();
  const toast = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [nome, setNome] = useState(s.nome);
  const [foto, setFoto] = useState<string | null>(s.foto);
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function escolherFoto(arquivo?: File) {
    if (!arquivo || !s.usuario) return;
    setEnviando(true);
    try {
      setFoto(await enviarFotoPerfil(s.usuario.id, arquivo));
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviando(false);
      if (arquivoRef.current) arquivoRef.current.value = '';
    }
  }

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.rpc('meu_perfil_atualizar', { p_nome: nome, p_foto_url: foto });
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Perfil atualizado.', 'ok');
    await s.recarregar();
    aoFechar();
  }

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo="Meu perfil"
      largura={440}
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoFechar}>Cancelar</button>
          <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando || enviando || !nome.trim()}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="perfil">
        <button type="button" className="perfil__foto" onClick={() => arquivoRef.current?.click()} disabled={enviando} aria-label="Trocar foto">
          <Avatar nome={nome || s.nome} foto={foto} tamanho={112} />
          <span className="perfil__camera"><Camera size={18} /></span>
        </button>
        <div className="acoes-linha" style={{ justifyContent: 'center' }}>
          <button className="btn btn--contorno btn--sm" onClick={() => arquivoRef.current?.click()} disabled={enviando}>
            <Camera size={16} /> {enviando ? 'Enviando…' : foto ? 'Trocar foto' : 'Colocar foto'}
          </button>
          {foto && <button className="btn btn--fantasma btn--sm" onClick={() => setFoto(null)}><Trash2 size={16} /> Remover</button>}
        </div>
        <input ref={arquivoRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => void escolherFoto(e.target.files?.[0])} />
        <Campo rotulo="Seu nome (aparece para a equipe)">
          <input className="input" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
        </Campo>
        <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>E-mail de acesso: {s.usuario?.email}</p>
      </div>
    </Modal>
  );
}
