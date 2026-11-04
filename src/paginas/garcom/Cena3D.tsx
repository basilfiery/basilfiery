import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Bell, Trophy } from 'lucide-react';

/**
 * Cena 3D da entrada do app do garçom: chão em perspectiva, pizza, lanche, refrigerante e alvo de metas
 * flutuando com espessura de verdade, cartões de "meta do dia" e "pedido pronto", e o bloco com a marca.
 * Tudo inclina seguindo o dedo (ou o celular, pelo giroscópio). Só CSS 3D: leve em qualquer Android.
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
        <Objeto tipo="pizza"><Pizza /></Objeto>
        <Objeto tipo="alvo"><Alvo /></Objeto>
        <Objeto tipo="lata"><Lata /></Objeto>
        <Objeto tipo="lanche"><Lanche /></Objeto>
        <span className="g3d__faisca g3d__faisca--1" />
        <span className="g3d__faisca g3d__faisca--2" />
        <span className="g3d__faisca g3d__faisca--3" />

        <div className="g3d__anel" />
        <div className="g3d__bloco">
          {/* Espessura do bloco: camadas empilhadas atrás da face */}
          {Array.from({ length: 10 }, (_, i) => <i key={i} style={{ '--z': i + 1 } as CSSProperties} />)}
          <div className="g3d__face">{children}<span className="g3d__brilho" /></div>
        </div>
        <div className="g3d__sombra" />

        <div className="g3d__chip g3d__chip--meta">
          <span className="g3d__chip-icone"><Trophy size={15} strokeWidth={2.4} /></span>
          <span className="g3d__chip-txt"><small>Meta do dia</small><b>12/15 entregas</b><i><u /></i></span>
        </div>
        <div className="g3d__chip g3d__chip--pronto">
          <span className="g3d__chip-icone"><Bell size={14} strokeWidth={2.4} /></span>
          <span className="g3d__chip-txt"><small>Mesa 4</small><b>Pedido pronto</b></span>
        </div>
      </div>
    </div>
  );
}

/** Objeto com espessura: o mesmo desenho empilhado em profundidade, mais escuro atrás. */
function Objeto({ tipo, children }: { tipo: string; children: ReactNode }) {
  return (
    <div className={`g3d__obj g3d__obj--${tipo}`}>
      {[5, 4, 3, 2, 1].map((i) => <span key={i} className="g3d__obj-camada" style={{ '--i': i } as CSSProperties}>{children}</span>)}
      <span className="g3d__obj-frente">{children}</span>
    </div>
  );
}

function Pizza() {
  return (
    <svg viewBox="0 0 100 110">
      <defs>
        <linearGradient id="g3d-pz-queijo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe08a" /><stop offset="1" stopColor="#f6a823" /></linearGradient>
        <linearGradient id="g3d-pz-borda" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f6c177" /><stop offset="1" stopColor="#b5652a" /></linearGradient>
        <radialGradient id="g3d-pz-cal" cx=".35" cy=".3" r=".75"><stop offset="0" stopColor="#ff8a6a" /><stop offset=".55" stopColor="#d9372a" /><stop offset="1" stopColor="#9c1d17" /></radialGradient>
      </defs>
      <path d="M13 27 Q50 13 87 27 L54 100 Q50 107 46 100 Z" fill="url(#g3d-pz-queijo)" />
      <path d="M24 40 q3 12 0 17 q-3 -5 0 -17z M71 44 q3 10 0 14 q-3 -4 0 -14z" fill="#f6a823" />
      <path d="M30 34 Q50 26 70 34" stroke="#fff3c4" strokeWidth="3" strokeLinecap="round" fill="none" opacity=".7" />
      <circle cx="38" cy="45" r="8.5" fill="url(#g3d-pz-cal)" />
      <circle cx="63" cy="49" r="7.5" fill="url(#g3d-pz-cal)" />
      <circle cx="50" cy="72" r="6.5" fill="url(#g3d-pz-cal)" />
      <path d="M42 59 q7 -8 15 -1 q-7 7 -15 1z" fill="#3e9b3a" />
      <path d="M43 59 q6 -2 13 -1" stroke="#7fd36a" strokeWidth="1.2" fill="none" />
      <circle cx="59" cy="66" r="2.4" fill="#2b2b2b" /><circle cx="59" cy="66" r="1" fill="#f6c76a" />
      <circle cx="35" cy="58" r="2.2" fill="#2b2b2b" /><circle cx="35" cy="58" r=".9" fill="#f6c76a" />
      <path d="M8 23 Q50 3 92 23 Q96 31 88 34 Q50 19 12 34 Q4 31 8 23 Z" fill="url(#g3d-pz-borda)" />
      <path d="M17 22 Q50 9 83 22" stroke="#ffe2b3" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity=".75" />
    </svg>
  );
}

function Lata() {
  return (
    <svg viewBox="0 0 70 112">
      <defs>
        <linearGradient id="g3d-lt-corpo" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7d0f1a" /><stop offset=".28" stopColor="#e2303d" /><stop offset=".42" stopColor="#ff7777" />
          <stop offset=".58" stopColor="#d72a37" /><stop offset="1" stopColor="#6c0c16" />
        </linearGradient>
        <linearGradient id="g3d-lt-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8d939c" /><stop offset=".4" stopColor="#f3f5f8" /><stop offset="1" stopColor="#7c828b" />
        </linearGradient>
      </defs>
      <path d="M8 18 Q8 13 13 12 L57 12 Q62 13 62 18 L64 26 L64 94 L62 100 Q61 104 56 105 L14 105 Q9 104 8 100 L6 94 L6 26 Z" fill="url(#g3d-lt-corpo)" />
      <path d="M6 50 C22 41 44 63 64 52 L64 63 C44 74 22 52 6 61 Z" fill="#fff" opacity=".95" />
      <path d="M6 66 C22 57 44 79 64 68 L64 71 C44 82 22 60 6 69 Z" fill="#ffd166" opacity=".9" />
      <rect x="17" y="18" width="5" height="80" rx="2.5" fill="#fff" opacity=".28" />
      <ellipse cx="35" cy="13" rx="25" ry="5.5" fill="url(#g3d-lt-metal)" />
      <ellipse cx="35" cy="13" rx="20" ry="3.8" fill="#b5bbc4" />
      <rect x="29" y="10" width="12" height="5" rx="2.5" fill="#e9ecf0" stroke="#8d939c" strokeWidth=".8" />
      <path d="M8 100 Q9 104 14 105 L56 105 Q61 104 62 100 Q35 110 8 100 Z" fill="url(#g3d-lt-metal)" />
      <circle cx="48" cy="34" r="1.6" fill="#fff" opacity=".7" /><circle cx="52" cy="40" r="1.1" fill="#fff" opacity=".6" />
      <circle cx="45" cy="84" r="1.4" fill="#fff" opacity=".65" /><circle cx="25" cy="88" r="1" fill="#fff" opacity=".55" />
    </svg>
  );
}

function Lanche() {
  return (
    <svg viewBox="0 0 110 96">
      <defs>
        <linearGradient id="g3d-ln-pao" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f9c16e" /><stop offset="1" stopColor="#c06f2a" /></linearGradient>
        <linearGradient id="g3d-ln-carne" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a4428" /><stop offset="1" stopColor="#3f1f12" /></linearGradient>
      </defs>
      <path d="M10 82 L100 82 Q100 92 88 92 L22 92 Q10 92 10 82 Z" fill="url(#g3d-ln-pao)" />
      <rect x="7" y="62" width="96" height="18" rx="9" fill="url(#g3d-ln-carne)" />
      <path d="M14 66 q8 -2 16 0 M40 65 q8 -2 16 0 M66 66 q8 -2 16 0" stroke="#9b5a35" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <path d="M9 56 L101 56 L94 67 L82 60 L68 71 L54 60 L38 69 L24 60 Z" fill="#ffc83a" />
      <path d="M5 52 q6 9 12 0 q6 9 12 0 q6 9 12 0 q6 9 12 0 q6 9 12 0 q6 9 12 0 q6 9 12 0 q6 9 12 0 L104 58 L6 58 Z" fill="#5cbf4a" />
      <rect x="12" y="52" width="86" height="5" rx="2.5" fill="#e2463a" />
      <path d="M8 50 Q10 8 55 8 Q100 8 102 50 Z" fill="url(#g3d-ln-pao)" />
      <path d="M24 26 Q40 14 60 14" stroke="#ffe2b0" strokeWidth="4" strokeLinecap="round" fill="none" opacity=".7" />
      <g fill="#fff5dc">
        <ellipse cx="38" cy="28" rx="2.6" ry="1.4" transform="rotate(-25 38 28)" /><ellipse cx="55" cy="22" rx="2.6" ry="1.4" transform="rotate(10 55 22)" />
        <ellipse cx="72" cy="28" rx="2.6" ry="1.4" transform="rotate(30 72 28)" /><ellipse cx="47" cy="38" rx="2.6" ry="1.4" transform="rotate(-10 47 38)" />
        <ellipse cx="64" cy="39" rx="2.6" ry="1.4" transform="rotate(20 64 39)" /><ellipse cx="82" cy="40" rx="2.4" ry="1.3" transform="rotate(35 82 40)" />
        <ellipse cx="28" cy="41" rx="2.4" ry="1.3" transform="rotate(-35 28 41)" />
      </g>
    </svg>
  );
}

function Alvo() {
  return (
    <svg viewBox="0 0 100 100">
      <defs>
        <radialGradient id="g3d-av-luz" cx=".32" cy=".28" r=".85"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".35" /></radialGradient>
      </defs>
      <circle cx="46" cy="54" r="42" fill="#e23a3a" />
      <circle cx="46" cy="54" r="32" fill="#fff" />
      <circle cx="46" cy="54" r="22" fill="#e23a3a" />
      <circle cx="46" cy="54" r="12" fill="#fff" />
      <circle cx="46" cy="54" r="5" fill="#e23a3a" />
      <circle cx="46" cy="54" r="42" fill="url(#g3d-av-luz)" />
      <path d="M47 53 L84 16" stroke="#2b2b31" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M80 20 L80 6 L88 12 Z M80 20 L94 20 L88 12 Z" fill="#ffcc4d" />
      <path d="M80 20 L88 12" stroke="#d99a16" strokeWidth="1.2" />
    </svg>
  );
}
