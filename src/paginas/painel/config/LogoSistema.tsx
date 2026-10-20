import { useRef, useState } from 'react';
import { Check, ImagePlus, Trash2 } from 'lucide-react';
import { AjustarFoto } from '../../../componentes/AjustarFoto';
import { MarcaLateral } from '../../../componentes/MarcaSistema';
import { useToast } from '../../../componentes/Toast';
import { useSessao } from '../../../lib/sessao';
import { ACEITA_IMAGEM, enviarImagem, msgErro, supabase } from '../../../lib/supabase';
import type { MarcaSistema } from '../../../lib/tipos';
import { cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, PaginaConfig, mudou } from './Layout';

const PASSO = { id: 'logo', rotulo: 'Logo do sistema', dica: 'A marca que aparece no topo do menu' };

const MODOS: { id: MarcaSistema['modo']; titulo: string; texto: string }[] = [
  { id: 'padrao', titulo: 'BasilFiery', texto: 'A marca padrão do sistema.' },
  { id: 'logo_nome', titulo: 'Minha logo + nome', texto: 'Logo quadrada com o nome ao lado, como está hoje.' },
  { id: 'imagem', titulo: 'Só a imagem', texto: 'Uma logo larga (16:9, 3:1…) no lugar do texto.' },
];

/** Logo do sistema: troca a marca BasilFiery do menu lateral pela da loja (só essa parte). */
export default function LogoSistema() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const inicial: MarcaSistema = { modo: 'padrao', nome: '', sub: '', logo_url: null, imagem_url: null, ...(r.marca_sistema ?? {}) };
  const [base, setBase] = useState(inicial);
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState<'' | 'logo' | 'imagem'>('');
  const [ajustar, setAjustar] = useState<File | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const imagemRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof MarcaSistema>(k: K, v: MarcaSistema[K]) => setF((x) => ({ ...x, [k]: v }));

  async function subir(tipo: 'logo' | 'imagem', arquivo: Blob) {
    setEnviando(tipo);
    try {
      const url = await enviarImagem(r.id, arquivo, 'marca');
      set(tipo === 'logo' ? 'logo_url' : 'imagem_url', url);
      setAjustar(null);
    } catch (er) { toast(msgErro(er), 'erro'); }
    setEnviando('');
  }

  async function salvar() {
    if (f.modo === 'imagem' && !f.imagem_url) return toast('Envie a imagem da logo.', 'erro');
    setSalvando(true);
    const valor: MarcaSistema | null = f.modo === 'padrao' ? null : {
      modo: f.modo, nome: f.nome?.trim() || '', sub: f.sub?.trim() || '', logo_url: f.logo_url || null, imagem_url: f.imagem_url || null,
    };
    const { error } = await supabase.from('restaurantes').update({ marca_sistema: valor }).eq('id', r.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    setBase(f);
    await s.recarregar();
    toast('Logo do sistema atualizada.', 'ok');
  }

  const previa = { nome: r.nome, logo_url: r.logo_url, marca_sistema: f };

  return (
    <PaginaConfig titulo="Logo do sistema" passos={[PASSO]} atual={PASSO} salvar={{ sujo: mudou(f, base), salvando, aoSalvar: () => void salvar() }}>
      <div className="form logo-sis">
        <div className="logo-sis__previa" aria-label="Prévia do menu">
          <small>Prévia</small>
          <div className="logo-sis__menu"><MarcaLateral r={previa} /></div>
        </div>

        <CampoAjuda rotulo="Como mostrar" ajuda="Muda só a marca do topo do menu e o nome da janela. O resto do sistema continua igual.">
          <div className="logo-sis__modos" role="radiogroup">
            {MODOS.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={f.modo === m.id} className={cx('logo-sis__modo', f.modo === m.id && 'ativo')} onClick={() => set('modo', m.id)}>
                <span className="logo-sis__mini"><MarcaLateral r={{ ...previa, marca_sistema: { ...f, modo: m.id, imagem_url: f.imagem_url || (m.id === 'imagem' ? '/favicon.png' : null) } }} /></span>
                <b>{m.titulo}</b>
                <small>{m.texto}</small>
                {f.modo === m.id && <i className="logo-sis__ok"><Check size={14} /></i>}
              </button>
            ))}
          </div>
        </CampoAjuda>

        {f.modo === 'logo_nome' && (
          <>
            <CampoAjuda rotulo="Logo (quadrada)" ajuda="Sem logo aqui, usamos a logo da loja cadastrada em Estabelecimento.">
              <div className="logo-sis__arquivo">
                <span className="logo-sis__quadro">{f.logo_url || r.logo_url ? <img src={f.logo_url || r.logo_url!} alt="" /> : <ImagePlus size={20} />}</span>
                <button type="button" className="btn btn--contorno" disabled={!!enviando} onClick={() => logoRef.current?.click()}>
                  {enviando === 'logo' ? 'Enviando…' : f.logo_url ? 'Trocar logo' : 'Enviar logo'}
                </button>
                {f.logo_url && <button type="button" className="btn btn--fantasma" onClick={() => set('logo_url', null)}><Trash2 size={16} /> Remover</button>}
                <input ref={logoRef} type="file" accept={ACEITA_IMAGEM} hidden onChange={(e) => { const a = e.target.files?.[0]; if (a) setAjustar(a); e.target.value = ''; }} />
              </div>
            </CampoAjuda>
            <div className="form-linha">
              <CampoAjuda rotulo="Nome">
                <input className="input" maxLength={28} value={f.nome ?? ''} onChange={(e) => set('nome', e.target.value)} placeholder={r.nome} />
              </CampoAjuda>
              <CampoAjuda rotulo="Frase de baixo (opcional)">
                <input className="input" maxLength={32} value={f.sub ?? ''} onChange={(e) => set('sub', e.target.value)} placeholder="Ex.: Gestão de pedidos" />
              </CampoAjuda>
            </div>
          </>
        )}

        {f.modo === 'imagem' && (
          <CampoAjuda rotulo="Imagem da logo" ajuda="Formato largo, como 16:9 ou 3:1. PNG com fundo transparente fica melhor no menu escuro.">
            <div className="logo-sis__arquivo">
              <span className="logo-sis__quadro logo-sis__quadro--largo">{f.imagem_url ? <img src={f.imagem_url} alt="" /> : <ImagePlus size={20} />}</span>
              <button type="button" className="btn btn--contorno" disabled={!!enviando} onClick={() => imagemRef.current?.click()}>
                {enviando === 'imagem' ? 'Enviando…' : f.imagem_url ? 'Trocar imagem' : 'Enviar imagem'}
              </button>
              <input ref={imagemRef} type="file" accept={ACEITA_IMAGEM} hidden onChange={(e) => { const a = e.target.files?.[0]; if (a) void subir('imagem', a); e.target.value = ''; }} />
            </div>
          </CampoAjuda>
        )}
      </div>
      {ajustar && <AjustarFoto arquivo={ajustar} formato="quadrado" titulo="Ajustar logo" aoConfirmar={(b) => subir('logo', b)} aoCancelar={() => setAjustar(null)} />}
    </PaginaConfig>
  );
}
