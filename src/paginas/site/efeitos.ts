/* Efeitos do site de vendas: inclinação 3D com o mouse, revelar ao rolar e órbita arrastável. */
import { useEffect, useRef, useState, type RefObject } from 'react';

const semMovimento = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const temMouse = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * Inclina o elemento em 3D acompanhando o mouse (variáveis --rx, --ry, --mx, --my).
 * `alvo` = onde o mouse é observado (padrão: o próprio elemento; 'janela' = a página toda).
 */
export function useInclinar<T extends HTMLElement>(max = 10, alvo: 'elemento' | 'janela' = 'elemento'): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || semMovimento() || !temMouse()) return;
    let quadro = 0;
    let rx = 0, ry = 0, alvoX = 0, alvoY = 0, mx = 50, my = 50;
    const animar = () => {
      rx += (alvoX - rx) * 0.12;
      ry += (alvoY - ry) * 0.12;
      el.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
      el.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
      el.style.setProperty('--mx', `${mx}%`);
      el.style.setProperty('--my', `${my}%`);
      if (Math.abs(alvoX - rx) > 0.01 || Math.abs(alvoY - ry) > 0.01) quadro = requestAnimationFrame(animar);
      else quadro = 0;
    };
    const mover = (e: PointerEvent) => {
      const r = alvo === 'janela' ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      alvoY = (x - 0.5) * 2 * max;
      alvoX = -(y - 0.5) * 2 * max;
      mx = Math.round(x * 100);
      my = Math.round(y * 100);
      if (!quadro) quadro = requestAnimationFrame(animar);
    };
    const sair = () => { alvoX = 0; alvoY = 0; if (!quadro) quadro = requestAnimationFrame(animar); };
    const fonte: HTMLElement | Window = alvo === 'janela' ? window : el;
    fonte.addEventListener('pointermove', mover as EventListener);
    if (alvo === 'elemento') el.addEventListener('pointerleave', sair);
    return () => {
      cancelAnimationFrame(quadro);
      fonte.removeEventListener('pointermove', mover as EventListener);
      el.removeEventListener('pointerleave', sair);
    };
  }, [max, alvo]);
  return ref;
}

/** Marca .visivel quando o elemento entra na tela (animações de entrada). */
export function useRevelar() {
  useEffect(() => {
    const itens = document.querySelectorAll<HTMLElement>('[data-revelar]');
    if (semMovimento() || !('IntersectionObserver' in window)) {
      itens.forEach((i) => i.classList.add('visivel'));
      return;
    }
    const obs = new IntersectionObserver((entradas) => {
      for (const e of entradas) {
        if (e.isIntersecting) {
          (e.target as HTMLElement).classList.add('visivel');
          obs.unobserve(e.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    itens.forEach((i) => obs.observe(i));
    return () => obs.disconnect();
  }, []);
}

/** Progresso da rolagem dentro de uma seção (0 a 1), para a linha do tempo. */
export function useProgresso<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let quadro = 0;
    const medir = () => {
      quadro = 0;
      const r = el.getBoundingClientRect();
      const h = window.innerHeight;
      setP(Math.min(1, Math.max(0, (h * 0.75 - r.top) / (r.height))));
    };
    const rolar = () => { if (!quadro) quadro = requestAnimationFrame(medir); };
    medir();
    window.addEventListener('scroll', rolar, { passive: true });
    window.addEventListener('resize', rolar);
    return () => { window.removeEventListener('scroll', rolar); window.removeEventListener('resize', rolar); cancelAnimationFrame(quadro); };
  }, []);
  return [ref, p];
}

/** Órbita 3D que gira sozinha e pode ser arrastada para os lados. */
export function useOrbita<T extends HTMLElement>(): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let angulo = 0;
    let vel = semMovimento() ? 0 : 0.12;
    let arrastando = false;
    let ultimoX = 0;
    let quadro = 0;
    const girar = () => {
      if (!arrastando) {
        angulo += vel;
        vel += ((semMovimento() ? 0 : 0.12) - vel) * 0.02;
      }
      el.style.setProperty('--giro', `${angulo}deg`);
      quadro = requestAnimationFrame(girar);
    };
    const descer = (e: PointerEvent) => { arrastando = true; ultimoX = e.clientX; el.setPointerCapture(e.pointerId); el.classList.add('arrastando'); };
    const mover = (e: PointerEvent) => {
      if (!arrastando) return;
      const d = e.clientX - ultimoX;
      ultimoX = e.clientX;
      angulo += d * 0.35;
      vel = d * 0.35;
    };
    const subir = () => { arrastando = false; el.classList.remove('arrastando'); };
    el.addEventListener('pointerdown', descer);
    el.addEventListener('pointermove', mover);
    el.addEventListener('pointerup', subir);
    el.addEventListener('pointercancel', subir);
    // Só gira quando está na tela
    const obs = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(quadro);
      if (e.isIntersecting) quadro = requestAnimationFrame(girar);
    });
    obs.observe(el);
    return () => {
      cancelAnimationFrame(quadro);
      obs.disconnect();
      el.removeEventListener('pointerdown', descer);
      el.removeEventListener('pointermove', mover);
      el.removeEventListener('pointerup', subir);
      el.removeEventListener('pointercancel', subir);
    };
  }, []);
  return ref;
}
