import { useEffect, useRef, useState, type PointerEvent as EventoPonteiro } from 'react';
import { Minus, Move, Plus, RotateCw } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { imagemExibivel, msgErro } from '../lib/supabase';
import { cx } from '../lib/util';

const SAIDA = 640; // tamanho final (px) da foto recortada

/**
 * Enquadrar a foto antes de enviar: arrastar para posicionar, zoom pela barra,
 * roda do mouse ou pinça (dois dedos), e girar. Devolve um JPEG quadrado.
 */
export function AjustarFoto({ arquivo, formato = 'circulo', titulo = 'Ajustar foto', aoConfirmar, aoCancelar }: {
  arquivo: File;
  formato?: 'circulo' | 'quadrado';
  titulo?: string;
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
  const toques = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<{ dist: number; zoom: number } | null>(null);
  const recorte = Math.round(palco * 0.82);
  const cancelarRef = useRef(aoCancelar);
  cancelarRef.current = aoCancelar;

  // Lê a foto (HEIC vira JPEG) e mostra
  useEffect(() => {
    let url = '';
    let vivo = true;
    void imagemExibivel(arquivo).then((blob) => {
      url = URL.createObjectURL(blob);
      const el = new Image();
      el.onload = () => { if (vivo) setImg(el); };
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
  const base = recorte / Math.min(w0, h0); // a foto sempre cobre o recorte
  const escala = base * zoom;
  const W = w0 * escala;
  const H = h0 * escala;
  const limitar = (p: { x: number; y: number }, w = W, h = H) => ({
    x: Math.max(-(w - recorte) / 2, Math.min((w - recorte) / 2, p.x)),
    y: Math.max(-(h - recorte) / 2, Math.min((h - recorte) / 2, p.y)),
  });
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
    canvas.width = SAIDA;
    canvas.height = SAIDA;
    const ctx = canvas.getContext('2d')!;
    const k = SAIDA / recorte;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SAIDA, SAIDA);
    // centro da foto em relação ao centro do recorte
    ctx.translate(SAIDA / 2 + pos.x * k, SAIDA / 2 + pos.y * k);
    ctx.rotate((giro * Math.PI) / 180);
    const dw = img.naturalWidth * escala * k;
    const dh = img.naturalHeight * escala * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.9));
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
          <button className="btn btn--primario" onClick={() => void confirmar()} disabled={!img || salvando}>{salvando ? 'Enviando…' : 'Usar esta foto'}</button>
        </>
      }
    >
      <div className="ajustar-foto__corpo">
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
          <div className={cx('ajustar-foto__recorte', formato === 'circulo' && 'circulo')} style={{ width: recorte, height: recorte }} />
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
