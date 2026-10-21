import { useCallback, useRef, useState, type RefObject } from 'react';

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
