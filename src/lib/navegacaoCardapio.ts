import { useCallback, useRef, useState, type RefObject } from 'react';

/**
 * Barra de subcategorias: quando a subcategoria escolhida muda (ou a categoria é reaberta),
 * rola a barra só o necessário para ela ficar visível. Não mexe se a pessoa estiver arrastando a barra.
 * Usar como ref: ref={(el) => manterAbaVisivel(el, abaAtual)}
 */
export function manterAbaVisivel(barra: HTMLElement | null, abaAtual: string) {
  if (!barra || barra.dataset.ativa === abaAtual) return;
  // Barra acabou de aparecer (abriu a categoria): mostra que dá para arrastar para o lado
  if (barra.dataset.ativa === undefined) dicaArrastar(barra, 500);
  barra.dataset.ativa = abaAtual;
  requestAnimationFrame(() => {
    const aba = barra.querySelector<HTMLElement>('.mesa__aba.ativa');
    if (!aba) return;
    // Posição da aba dentro da barra (contando o quanto a barra já está rolada)
    const ini = aba.getBoundingClientRect().left - barra.getBoundingClientRect().left + barra.scrollLeft;
    const fim = ini + aba.offsetWidth;
    if (ini < barra.scrollLeft) barra.scrollTo({ left: Math.max(0, ini - 16), behavior: 'smooth' });
    else if (fim > barra.scrollLeft + barra.clientWidth) barra.scrollTo({ left: fim - barra.clientWidth + 16, behavior: 'smooth' });
  });
}

/**
 * Dica de que a barra arrasta para o lado: ela anda um pouco sozinha e volta.
 * Só acontece se tiver coisa escondida à direita e a pessoa ainda não mexeu na barra.
 */
export function dicaArrastar(barra: HTMLElement | null, atraso = 600) {
  if (!barra || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let parou = false;
  const parar = () => { parou = true; };
  barra.addEventListener('pointerdown', parar, { once: true });
  barra.addEventListener('touchstart', parar, { once: true, passive: true });
  barra.addEventListener('wheel', parar, { once: true, passive: true });
  window.setTimeout(() => {
    const sobra = barra.scrollWidth - barra.clientWidth;
    if (parou || !barra.isConnected || sobra < 24 || barra.scrollLeft > 4) return;
    const dist = Math.min(90, sobra);
    const snap = barra.style.scrollSnapType;
    barra.style.scrollSnapType = 'none';
    const ida = 420, pausa = 160, volta = 560, ini = performance.now();
    const suave = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const passo = (agora: number) => {
      const t = agora - ini;
      if (parou || !barra.isConnected) { barra.style.scrollSnapType = snap; return; }
      if (t < ida) barra.scrollLeft = dist * suave(t / ida);
      else if (t < ida + pausa) barra.scrollLeft = dist;
      else if (t < ida + pausa + volta) barra.scrollLeft = dist * (1 - suave((t - ida - pausa) / volta));
      else { barra.scrollLeft = 0; barra.style.scrollSnapType = snap; return; }
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }, atraso);
}

/**
 * Barra de categorias (celular): a categoria tocada vai para o meio da barra, mostrando as próximas.
 * Se ela já está no lugar (ex.: a primeira), a barra dá a dica de que arrasta.
 */
export function centralizarNaBarra(botao: HTMLElement | null) {
  const barra = botao?.parentElement;
  if (!botao || !barra || barra.scrollWidth - barra.clientWidth < 8) return;
  const alvo = Math.max(0, Math.min(barra.scrollWidth - barra.clientWidth, botao.offsetLeft - (barra.clientWidth - botao.offsetWidth) / 2));
  if (Math.abs(alvo - barra.scrollLeft) > 12) barra.scrollTo({ left: alvo, behavior: 'smooth' });
  else dicaArrastar(barra, 0);
}

/**
 * Navegação entre categorias do cardápio (mesa e delivery) que LEMBRA onde o cliente estava:
 * ao voltar para uma categoria, ela abre na mesma subcategoria e na mesma posição da lista,
 * em vez de recomeçar do topo.
 */
export function useNavegacaoCardapio(listaRef: RefObject<HTMLElement>) {
  const [catAtiva, setCatAtiva] = useState('');
  const [subAtiva, setSubAtiva] = useState('');
  /** Por categoria: a última subcategoria aberta e a rolagem de cada subcategoria */
  const memoria = useRef(new Map<string, { sub: string; topos: Map<string, number> }>());
  /** Categoria e subcategoria que estão NA TELA (preenchido pela página a cada render) */
  const atual = useRef({ cat: '', sub: '' });

  const guardar = useCallback(() => {
    const { cat, sub } = atual.current;
    if (!cat) return;
    const m = memoria.current.get(cat) ?? { sub, topos: new Map<string, number>() };
    m.sub = sub;
    m.topos.set(sub, listaRef.current?.scrollTop ?? 0);
    memoria.current.set(cat, m);
  }, [listaRef]);

  const rolarPara = useCallback((topo: number) => {
    // Espera a nova lista aparecer na tela antes de rolar
    requestAnimationFrame(() => requestAnimationFrame(() => listaRef.current?.scrollTo({ top: topo })));
  }, [listaRef]);

  /** Troca de categoria. `doInicio` = começar do topo (ex.: botão "Ver a seguir") */
  const escolherCategoria = useCallback((id: string, sub = '', doInicio = false) => {
    guardar();
    const m = memoria.current.get(id);
    const proxSub = sub || (doInicio ? '' : m?.sub ?? '');
    setCatAtiva(id);
    setSubAtiva(proxSub);
    rolarPara(doInicio || !m ? 0 : m.topos.get(proxSub || m.sub) ?? 0);
  }, [guardar, rolarPara]);

  /** Troca de subcategoria dentro da categoria atual */
  const abrirSub = useCallback((id: string, doInicio = false) => {
    guardar();
    setSubAtiva(id);
    const m = memoria.current.get(atual.current.cat);
    rolarPara(doInicio ? 0 : m?.topos.get(id) ?? 0);
  }, [guardar, rolarPara]);

  /** Volta tudo ao começo (ex.: tablet parado sem ninguém usando) */
  const zerar = useCallback(() => {
    memoria.current.clear();
    setCatAtiva('');
    setSubAtiva('');
    listaRef.current?.scrollTo({ top: 0 });
  }, [listaRef]);

  return { catAtiva, subAtiva, escolherCategoria, abrirSub, zerar, atual };
}
