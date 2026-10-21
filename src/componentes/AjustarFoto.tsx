import { useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from 'react';
import { Minus, Move, Plus, RotateCw } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { imagemExibivel, msgErro } from '../lib/supabase';
import { cx } from '../lib/util';

const SAIDA = 640; // tamanho final (px) da foto recortada (perfil e logos)
const SAIDA_LARGA = 1200; // fotos de produto: maiores, para ficarem nítidas em telas grandes

export interface Proporcao { id: string; rotulo: string; razao: number }

/** Baixa uma foto que já está no cardápio para ajustá-la de novo */
export async function arquivoDaFoto(url: string): Promise<File> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('Não foi possível abrir a foto. Tente de novo.');
  const blob = await r.blob();
  return new File([blob], 'foto', { type: blob.type || 'image/jpeg' });
}
/** Formatos para fotos de itens do cardápio */
export const PROPORCOES_PRODUTO: Proporcao[] = [
  { id: 'quadrada', rotulo: 'Quadrada', razao: 1 },
  { id: 'retangular', rotulo: '4:3', razao: 4 / 3 },
  { id: 'larga', rotulo: 'Larga 16:9', razao: 16 / 9 },
];

/**
 * Enquadrar a foto antes de enviar: arrastar para posicionar, zoom pela barra,
 * roda do mouse ou pinça (dois dedos), e girar. Devolve um JPEG.
 * Com `proporcoes`, a pessoa escolhe o formato do recorte (ex.: quadrada ou larga);
 * com `permitirOriginal`, pode usar a foto inteira, sem cortar.
 */
export function AjustarFoto({ arquivo, formato = 'circulo', titulo = 'Ajustar foto', proporcoes, permitirOriginal, aoConfirmar, aoCancelar }: {
  arquivo: File;
  formato?: 'circulo' | 'quadrado';
  titulo?: string;
  proporcoes?: Proporcao[];
  permitirOriginal?: boolean;
  aoConfirmar: (foto: Blob) => void | Promise<void>;
  aoCancelar: () => void;
}) {
  const toast = useToast();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [palco, setPalco] = useState(() => Math.min(340, window.innerWidth - 64));
  const [zoom, setZoom] = useState(1);
  const [giro, setGiro] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [salvando, setSalvando] = useState(false);
  const [razao, setRazao] = useState(proporcoes?.[0]?.razao ?? 1);
  const escolheuFormato = useRef(false);
  const toques = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<{ dist: number; zoom: number } | null>(null);
  // Área do recorte (cabe no palco, na proporção escolhida)
  const lado = Math.round(palco * 0.86);
  const recorteW = razao >= 1 ? lado : Math.round(lado * razao);
  const recorteH = razao >= 1 ? Math.round(lado / razao) : lado;
  const cancelarRef = useRef(aoCancelar);
  cancelarRef.current = aoCancelar;

  // Lê a foto (HEIC vira JPEG) e mostra
  useEffect(() => {
    let url = '';
    let vivo = true;
    void imagemExibivel(arquivo).then((blob) => {
      url = URL.createObjectURL(blob);
      const el = new Image();
      el.onload = () => {
        if (!vivo) return;
        // Começa no formato mais parecido com o da foto (a pessoa pode trocar)
        if (proporcoes?.length && !escolheuFormato.current) {
          const r = el.naturalWidth / el.naturalHeight;
          setRazao(proporcoes.reduce((m, p) => (Math.abs(Math.log(p.razao / r)) < Math.abs(Math.log(m / r)) ? p.razao : m), proporcoes[0].razao));
        }
        setImg(el);
      };
      el.onerror = () => { toast('Não foi possível abrir esta foto. Tente outra.', 'erro'); cancelarRef.current(); };
      el.src = url;
    }).catch((e) => { toast(msgErro(e), 'erro'); cancelarRef.current(); });
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [arquivo, toast]);

  useEffect(() => {
    const medir = () => setPalco(Math.min(340, window.innerWidth - 64));
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, []);

  // Dimensões com o giro aplicado (90°/270° trocam largura e altura)
  const deitada = giro % 180 !== 0;
  const w0 = img ? (deitada ? img.naturalHeight : img.naturalWidth) : 1;
  const h0 = img ? (deitada ? img.naturalWidth : img.naturalHeight) : 1;
  const base = Math.max(recorteW / w0, recorteH / h0); // a foto sempre cobre o recorte
  const escala = base * zoom;
  const W = w0 * escala;
  const H = h0 * escala;
  const limitar = (p: { x: number; y: number }, w = W, h = H) => ({
    x: Math.max(-(w - recorteW) / 2, Math.min((w - recorteW) / 2, p.x)),
    y: Math.max(-(h - recorteH) / 2, Math.min((h - recorteH) / 2, p.y)),
  });
  const trocarFormato = (r: number) => { escolheuFormato.current = true; setRazao(r); setZoom(1); setPos({ x: 0, y: 0 }); };
  const mudarZoom = (z: number) => {
    const novo = Math.max(1, Math.min(4, z));
    setZoom(novo);
    setPos((p) => limitar(p, w0 * base * novo, h0 * base * novo));
  };

  function apertar(e: EventoPonteiro) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    toques.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (toques.current.size === 2) {
      const [a, b] = [...toques.current.values()];
      pinca.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function mover(e: EventoPonteiro) {
    const antes = toques.current.get(e.pointerId);
    if (!antes) return;
    toques.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (toques.current.size === 2 && pinca.current) {
      const [a, b] = [...toques.current.values()];
      mudarZoom(pinca.current.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinca.current.dist));
      return;
    }
    setPos((p) => limitar({ x: p.x + e.clientX - antes.x, y: p.y + e.clientY - antes.y }));
  }
  function soltar(e: EventoPonteiro) {
    toques.current.delete(e.pointerId);
    if (toques.current.size < 2) pinca.current = null;
  }

  async function confirmar() {
    if (!img) return;
    setSalvando(true);
    const canvas = document.createElement('canvas');
    const larguraFinal = proporcoes ? SAIDA_LARGA : SAIDA;
    canvas.width = razao >= 1 ? larguraFinal : Math.round(larguraFinal * razao);
    canvas.height = Math.round(canvas.width / razao);
    const ctx = canvas.getContext('2d')!;
    const k = canvas.width / recorteW;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // centro da foto em relação ao centro do recorte
    ctx.translate(canvas.width / 2 + pos.x * k, canvas.height / 2 + pos.y * k);
    ctx.rotate((giro * Math.PI) / 180);
    const dw = img.naturalWidth * escala * k;
    const dh = img.naturalHeight * escala * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    if (!blob) { setSalvando(false); return toast('Não foi possível recortar a foto.', 'erro'); }
    try {
      await aoConfirmar(blob);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto
      aoFechar={() => !salvando && aoCancelar()}
      titulo={titulo}
      largura={420}
      classe="ajustar-foto"
      rodape={
        <>
          <button className="btn btn--contorno" onClick={aoCancelar} disabled={salvando}>Cancelar</button>
          {permitirOriginal && (
            <button className="btn btn--fantasma" disabled={salvando} title="Envia a foto inteira, do jeito que está"
              onClick={() => { setSalvando(true); void Promise.resolve(aoConfirmar(arquivo)).finally(() => setSalvando(false)); }}>
              Usar sem cortar
            </button>
          )}
          <button className="btn btn--primario" onClick={() => void confirmar()} disabled={!img || salvando}>{salvando ? 'Enviando…' : 'Usar esta foto'}</button>
        </>
      }
    >
      <div className="ajustar-foto__corpo">
        {proporcoes && proporcoes.length > 1 && (
          <div className="ajustar-foto__formatos" role="radiogroup" aria-label="Formato da foto">
            {proporcoes.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={razao === p.razao} className={cx(razao === p.razao && 'ativo')} onClick={() => trocarFormato(p.razao)}>
                <i style={{ aspectRatio: String(p.razao) }} /> {p.rotulo}
              </button>
            ))}
          </div>
        )}
        <div
          className={cx('ajustar-foto__palco', !img && 'carregando')}
          style={{ width: palco, height: palco }}
          onPointerDown={apertar}
          onPointerMove={mover}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onWheel={(e) => mudarZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
        >
          {img ? (
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{
                width: img.naturalWidth * escala,
                height: img.naturalHeight * escala,
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) rotate(${giro}deg)`,
              }}
            />
          ) : <div className="spinner" />}
          <div className={cx('ajustar-foto__recorte', formato === 'circulo' && !proporcoes && 'circulo')} style={{ width: recorteW, height: recorteH }} />
        </div>
        <p className="ajustar-foto__dica"><Move size={14} /> Arraste para enquadrar</p>
        <div className="ajustar-foto__controles">
          <button type="button" className="icone-btn" onClick={() => mudarZoom(zoom - 0.2)} aria-label="Diminuir zoom"><Minus size={18} /></button>
          <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => mudarZoom(Number(e.target.value))} aria-label="Zoom" />
          <button type="button" className="icone-btn" onClick={() => mudarZoom(zoom + 0.2)} aria-label="Aumentar zoom"><Plus size={18} /></button>
          <button type="button" className="icone-btn" onClick={() => { setGiro((g) => (g + 90) % 360); setPos({ x: 0, y: 0 }); }} aria-label="Girar" title="Girar"><RotateCw size={18} /></button>
        </div>
      </div>
    </Modal>
  );
}
