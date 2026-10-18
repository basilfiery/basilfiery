import { useRef, useState, type CSSProperties } from 'react';
import { Film, ImagePlus, Play, RefreshCw, Store, Trash2 } from 'lucide-react';
import { AjustarFoto } from '../../componentes/AjustarFoto';
import { useToast } from '../../componentes/Toast';
import { useSessao } from '../../lib/sessao';
import { ACEITA_IMAGEM, ACEITA_VIDEO, LIMITE_VIDEO_MB, enviarImagem, enviarVideo, msgErro, supabase } from '../../lib/supabase';
import { cx } from '../../lib/util';
import { CampoAjuda, PaginaConfig, mudou, usePasso, type Passo } from './config/Layout';
import { usePainel } from './Painel';

/* =====================================================================
   Aparência do cardápio (mesa e delivery): logo, cor, capa e textos
   ===================================================================== */

const PASSOS: Passo[] = [
  { id: 'marca', rotulo: 'Logo e cor', dica: 'A cara do seu cardápio na mesa e no delivery' },
  { id: 'capa', rotulo: 'Capa (vídeo ou foto)', dica: 'Aparece em cima das categorias. Sem capa, o cardápio fica como está.' },
  { id: 'textos', rotulo: 'Textos', dica: 'Boas-vindas, descrição e rodapé' },
];
const CORES = ['#ff5a1f', '#e63946', '#d6336c', '#7048e8', '#1c7ed6', '#0b7285', '#0ca678', '#5c940d', '#f08c00', '#212529'];

export default function Aparencia() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [passo, irPasso] = usePasso(PASSOS);
  const inicial = () => ({
    logo: r.logo_url, cor: r.cor, capa: r.loja_capa_url, video: r.capa_video_url ?? null,
    slogan: r.slogan ?? '', descricao: r.loja_descricao ?? '', rodape: r.loja_rodape ?? '',
  });
  const [base, setBase] = useState(inicial);
  const [f, setF] = useState(base);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState<'' | 'capa' | 'video'>('');
  const [ajustarLogo, setAjustarLogo] = useState<File | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const capaRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function salvar() {
    setSalvando(true);
    const { error } = await supabase.from('restaurantes').update({
      logo_url: f.logo, cor: f.cor, loja_capa_url: f.capa, capa_video_url: f.video,
      slogan: f.slogan.trim() || null, loja_descricao: f.descricao.trim() || null, loja_rodape: f.rodape.trim() || null,
    }).eq('id', r.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    toast('Aparência do cardápio salva. Já aparece na mesa e no delivery.', 'ok');
    setBase(f);
    void s.recarregar();
  }

  async function enviar(tipo: 'capa' | 'video', arquivo?: File) {
    if (!arquivo) return;
    setEnviando(tipo);
    try {
      if (tipo === 'capa') set('capa', await enviarImagem(r.id, arquivo, 'capa'));
      else set('video', await enviarVideo(r.id, arquivo, 'capa'));
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviando('');
    }
  }

  const previa = (
    <div className="ap-previa" style={{ '--cor-previa': f.cor } as CSSProperties}>
      <small>Prévia no celular</small>
      <div className="ap-previa__cel">
        <div className="ap-previa__topo">
          <span className="ap-previa__logo">{f.logo ? <img src={f.logo} alt="" /> : r.nome.charAt(0)}</span>
          <div><strong>{r.nome}</strong><em>Aberto agora</em></div>
        </div>
        {(f.video || f.capa) && (
          <div className="ap-previa__capa">
            {f.video ? <video src={f.video} poster={f.capa ?? undefined} autoPlay muted loop playsInline /> : <img src={f.capa!} alt="" />}
          </div>
        )}
        <div className="ap-previa__cats"><i className="ativa" /><i /><i /></div>
        {f.descricao && <p className="ap-previa__desc">{f.descricao}</p>}
        <div className="ap-previa__itens">
          {[0, 1, 2].map((i) => <div key={i}><span><i /><i /></span><b /><em>+</em></div>)}
        </div>
      </div>
    </div>
  );

  return (
    <PaginaConfig
      titulo="Aparência do cardápio"
      passos={PASSOS}
      atual={passo}
      aoPasso={irPasso}
      salvar={{ sujo: mudou(f, base), salvando, aoSalvar: () => void salvar() }}
      lateral={previa}
    >
      {passo.id === 'marca' && (
        <div className="form">
          <div className="campo cfg-campo">
            <span>Logo</span>
            <div className="ap-logo">
              <div className="ap-logo__foto">{f.logo ? <img src={f.logo} alt="Logo" /> : <Store size={34} strokeWidth={1.5} />}</div>
              <div className="acoes-linha">
                <button type="button" className="btn btn--contorno btn--sm" onClick={() => logoRef.current?.click()}>{f.logo ? <><RefreshCw size={15} /> Trocar logo</> : <><ImagePlus size={15} /> Enviar logo</>}</button>
                {f.logo && <button type="button" className="btn btn--fantasma btn--sm" onClick={() => set('logo', null)}><Trash2 size={15} /> Remover</button>}
              </div>
              <small className="cfg-campo__ajuda">Quadrada, de preferência. Você enquadra depois de escolher.</small>
            </div>
            <input ref={logoRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => { const x = e.target.files?.[0]; if (x) setAjustarLogo(x); e.target.value = ''; }} />
          </div>
          <CampoAjuda rotulo="Cor do cardápio" ajuda="Botões, categoria ativa e preços usam esta cor.">
            <div className="cores">
              {CORES.map((c) => (
                <button key={c} type="button" className={cx('cor', f.cor === c && 'ativo')} style={{ background: c }} onClick={() => set('cor', c)} aria-label={`Cor ${c}`} />
              ))}
              <span className={cx('cor cor--livre', !CORES.includes(f.cor) && 'ativo')} title="Outra cor" style={{ background: CORES.includes(f.cor) ? undefined : f.cor }}>
                <input type="color" value={f.cor} onChange={(e) => set('cor', e.target.value)} aria-label="Escolher outra cor" />
              </span>
            </div>
          </CampoAjuda>
        </div>
      )}

      {passo.id === 'capa' && (
        <div className="form">
          <div className="ap-capas">
            <div className="campo cfg-campo">
              <span><Film size={15} /> Vídeo de capa <small className="muted">(opcional)</small></span>
              <div className={cx('ap-capa', f.video && 'cheia')} onClick={() => !f.video && videoRef.current?.click()} role={f.video ? undefined : 'button'}>
                {enviando === 'video' ? <span className="spinner" /> : f.video
                  ? <video src={f.video} poster={f.capa ?? undefined} autoPlay muted loop playsInline />
                  : <span><Play size={26} /> Enviar vídeo deitado<small>MP4/MOV até {LIMITE_VIDEO_MB} MB · 5 a 15 segundos</small></span>}
              </div>
              {f.video && (
                <div className="acoes-linha">
                  <button type="button" className="btn btn--contorno btn--sm" onClick={() => videoRef.current?.click()}><RefreshCw size={15} /> Trocar vídeo</button>
                  <button type="button" className="btn btn--fantasma btn--sm" onClick={() => set('video', null)}><Trash2 size={15} /> Tirar vídeo</button>
                </div>
              )}
              <input ref={videoRef} className="input-arquivo" type="file" accept={ACEITA_VIDEO} onChange={(e) => { void enviar('video', e.target.files?.[0]); e.target.value = ''; }} />
            </div>
            <div className="campo cfg-campo">
              <span><ImagePlus size={15} /> Foto de capa <small className="muted">(opcional)</small></span>
              <div className={cx('ap-capa', f.capa && 'cheia')} onClick={() => !f.capa && capaRef.current?.click()} role={f.capa ? undefined : 'button'}>
                {enviando === 'capa' ? <span className="spinner" /> : f.capa
                  ? <img src={f.capa} alt="Capa" />
                  : <span><ImagePlus size={26} /> Enviar foto deitada<small>Ex.: 1200 × 500, salão ou prato famoso</small></span>}
              </div>
              {f.capa && (
                <div className="acoes-linha">
                  <button type="button" className="btn btn--contorno btn--sm" onClick={() => capaRef.current?.click()}><RefreshCw size={15} /> Trocar foto</button>
                  <button type="button" className="btn btn--fantasma btn--sm" onClick={() => set('capa', null)}><Trash2 size={15} /> Tirar foto</button>
                </div>
              )}
              <input ref={capaRef} className="input-arquivo" type="file" accept={ACEITA_IMAGEM} onChange={(e) => { void enviar('capa', e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </div>
          <p className="cfg-nota">Com vídeo, ele roda sozinho (sem som) e a foto aparece enquanto o vídeo carrega. A capa some quando o cliente rola os produtos, para não ocupar espaço.</p>
        </div>
      )}

      {passo.id === 'textos' && (
        <div className="form">
          <CampoAjuda rotulo="Frase de boas-vindas da mesa" ajuda="Aparece no cardápio do tablet/QR code da mesa.">
            <input className="input" maxLength={100} value={f.slogan} onChange={(e) => set('slogan', e.target.value)} placeholder="Ex.: Seja bem-vindo! Peça pelo tablet." />
          </CampoAjuda>
          <CampoAjuda rotulo="Descrição da loja" ajuda={`Aparece no começo do cardápio de delivery. ${f.descricao.length}/300`}>
            <textarea className="textarea" rows={3} maxLength={300} value={f.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Ex.: Pizzas artesanais no forno a lenha desde 2010." />
          </CampoAjuda>
          <CampoAjuda rotulo="Rodapé" ajuda={`Texto no fim do cardápio de delivery (ex.: aviso de alergênicos). ${f.rodape.length}/300`}>
            <textarea className="textarea" rows={3} maxLength={300} value={f.rodape} onChange={(e) => set('rodape', e.target.value)} placeholder="Ex.: Imagens ilustrativas." />
          </CampoAjuda>
        </div>
      )}

      {ajustarLogo && (
        <AjustarFoto
          arquivo={ajustarLogo}
          formato="quadrado"
          titulo="Ajustar logo"
          aoCancelar={() => setAjustarLogo(null)}
          aoConfirmar={async (b) => {
            try { set('logo', await enviarImagem(r.id, b, 'logo')); setAjustarLogo(null); } catch (e) { toast(msgErro(e), 'erro'); }
          }}
        />
      )}
    </PaginaConfig>
  );
}
