import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * Cena 3D da entrada do app do garçom: chão em perspectiva, esferas flutuando e um bloco
 * com a marca que inclina seguindo o dedo (ou o celular, pelo giroscópio). Só CSS 3D: leve em qualquer Android.
 */
export function Cena3D({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let alvoX = 0, alvoY = 0, x = 0, y = 0, quadro = 0;
    const animar = () => {
      x += (alvoX - x) * 0.08;
      y += (alvoY - y) * 0.08;
      el.style.setProperty('--rx', `${(-y * 14).toFixed(2)}deg`);
      el.style.setProperty('--ry', `${(x * 18).toFixed(2)}deg`);
      el.style.setProperty('--px', x.toFixed(3));
      el.style.setProperty('--py', y.toFixed(3));
      quadro = requestAnimationFrame(animar);
    };
    quadro = requestAnimationFrame(animar);
    const limitar = (v: number) => Math.max(-1, Math.min(1, v));
    const aoMover = (e: PointerEvent) => {
      alvoX = limitar((e.clientX / innerWidth) * 2 - 1);
      alvoY = limitar((e.clientY / innerHeight) * 2 - 1);
    };
    // Celular: inclina junto com a mão (gamma = lados, beta = frente/trás; segurando em pé ~ 45°)
    const aoGirar = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      alvoX = limitar(e.gamma / 30);
      alvoY = limitar((e.beta - 45) / 30);
    };
    addEventListener('pointermove', aoMover, { passive: true });
    addEventListener('deviceorientation', aoGirar, { passive: true });
    return () => {
      cancelAnimationFrame(quadro);
      removeEventListener('pointermove', aoMover);
      removeEventListener('deviceorientation', aoGirar);
    };
  }, []);

  return (
    <div className="g3d" ref={ref} aria-hidden="true">
      <div className="g3d__chao" />
      <div className="g3d__palco">
        <span className="g3d__orbe g3d__orbe--1" />
        <span className="g3d__orbe g3d__orbe--2" />
        <span className="g3d__orbe g3d__orbe--3" />
        <span className="g3d__orbe g3d__orbe--4" />
        <div className="g3d__anel" />
        <div className="g3d__bloco">
          {/* Espessura do bloco: camadas empilhadas atrás da face */}
          {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--z': i + 1 } as CSSProperties} />)}
          <div className="g3d__face">{children}<span className="g3d__brilho" /></div>
        </div>
        <div className="g3d__sombra" />
      </div>
    </div>
  );
}
