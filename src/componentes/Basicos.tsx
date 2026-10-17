import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Flame, Leaf, Minus, Plus, Star, UtensilsCrossed } from 'lucide-react';
import { cx } from '../lib/util';

export function Logo({ tamanho = 'md' }: { tamanho?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`logo logo--${tamanho}`}>
      <img src="/icone.svg" alt="" className="logo__icone" />
      <span className="logo__nome">
        <span className="logo__basil">Basil</span>
        <span className="logo__fiery">Fiery</span>
      </span>
    </span>
  );
}

interface StepperProps {
  valor: number;
  aoMudar: (v: number) => void;
  min?: number;
  max?: number;
  grande?: boolean;
}

export function Stepper({ valor, aoMudar, min = 1, max = 99, grande }: StepperProps) {
  return (
    <div className={cx('stepper', grande && 'stepper--lg')}>
      <button type="button" onClick={() => aoMudar(valor - 1)} disabled={valor <= min} aria-label="Diminuir">
        <Minus size={grande ? 22 : 16} />
      </button>
      <span aria-live="polite">{valor}</span>
      <button type="button" onClick={() => aoMudar(valor + 1)} disabled={valor >= max} aria-label="Aumentar">
        <Plus size={grande ? 22 : 16} />
      </button>
    </div>
  );
}

export function Switch({ marcado, aoMudar, children, desativado }: {
  marcado: boolean;
  aoMudar: (v: boolean) => void;
  children?: ReactNode;
  desativado?: boolean;
}) {
  return (
    <label className="switch">
      <input type="checkbox" checked={marcado} disabled={desativado} onChange={(e) => aoMudar(e.target.checked)} />
      {children && <span>{children}</span>}
    </label>
  );
}

export function Campo({ rotulo, children, dica }: { rotulo: string; children: ReactNode; dica?: string }) {
  return (
    <label className="campo">
      <span>{rotulo}</span>
      {children}
      {dica && <small className="campo__dica">{dica}</small>}
    </label>
  );
}

export function Vazio({ icone, titulo, children }: { icone?: ReactNode; titulo: string; children?: ReactNode }) {
  return (
    <div className="vazio">
      {icone && <div className="vazio__icone">{icone}</div>}
      <strong>{titulo}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}

/** Selos do produto: mais pedido, novo, vegetariano, picância. */
export function Selos({ p }: { p: { destaque?: boolean; novo?: boolean; vegetariano?: boolean; picancia?: number } }) {
  if (!p.destaque && !p.novo && !p.vegetariano && !p.picancia) return null;
  return (
    <div className="selos">
      {p.destaque && <span className="selo selo--top"><Star size={11} fill="currentColor" /> Mais pedido</span>}
      {p.novo && <span className="selo selo--novo">Novo</span>}
      {p.vegetariano && <span className="selo selo--veg"><Leaf size={11} /> Vegetariano</span>}
      {!!p.picancia && (
        <span className="selo selo--pic" title={`Picância ${p.picancia} de 3`} aria-label={`Picância ${p.picancia} de 3`}>
          {Array.from({ length: p.picancia }, (_, i) => <Flame key={i} size={12} fill="currentColor" />)}
        </span>
      )}
    </div>
  );
}

/**
 * Capa em vídeo: roda sozinho, sem som e em repetição, só enquanto está visível
 * na tela (economiza bateria e internet). Se o vídeo falhar, mostra a foto/emoji.
 */
export function VideoCapa({ p, classe }: { p: { video_url: string; imagem_url: string | null; emoji: string | null; nome: string }; classe?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) void v.play().catch(() => { /* modo economia: fica a primeira imagem */ });
      else v.pause();
    }, { threshold: 0.25 });
    obs.observe(v);
    return () => obs.disconnect();
  }, [falhou]);

  if (falhou) return <FotoProduto p={p} classe={classe} />;
  return (
    <div className={cx('foto foto--video', classe)}>
      <video
        ref={ref}
        src={p.video_url}
        poster={p.imagem_url ?? undefined}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        aria-label={`Vídeo de ${p.nome}`}
        onError={() => setFalhou(true)}
      />
    </div>
  );
}

export function FotoProduto({ p, classe }: { p: { imagem_url: string | null; emoji: string | null; nome: string }; classe?: string }) {
  return (
    <div className={cx('foto', classe)}>
      {p.imagem_url ? <img src={p.imagem_url} alt={p.nome} loading="lazy" /> : <span aria-hidden="true">{p.emoji || <UtensilsCrossed className="foto__padrao" strokeWidth={1.5} />}</span>}
    </div>
  );
}
