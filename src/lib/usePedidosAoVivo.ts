import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { Chamado, Pedido, StatusPedido } from './tipos';

interface Eventos {
  aoNovoPedido?: (p: Pedido) => void;
  aoPedidoPronto?: (p: Pedido) => void;
  aoNovoChamado?: (c: Chamado) => void;
}

const SELECT_PEDIDO = '*, pedido_itens(*)';

/**
 * Pedidos e chamados do restaurante em tempo real.
 * Traz os pedidos das últimas 16h + qualquer pedido ainda em andamento,
 * e recarrega periodicamente para cobrir quedas de conexão.
 */
export function usePedidosAoVivo(restauranteId: string | undefined, eventos: Eventos = {}) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [chamados, setChamados] = useState<Chamado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [conectado, setConectado] = useState(false);

  const ev = useRef(eventos);
  ev.current = eventos;
  const conhecidos = useRef(new Map<string, StatusPedido>());
  const chamadosConhecidos = useRef(new Set<string>());
  const semeado = useRef(false);

  const registrar = useCallback((lista: Pedido[], disparar: boolean) => {
    for (const p of lista) {
      const antes = conhecidos.current.get(p.id);
      conhecidos.current.set(p.id, p.status);
      if (!disparar) continue;
      if (antes === undefined && p.status === 'novo') ev.current.aoNovoPedido?.(p);
      else if (antes !== undefined && antes !== 'pronto' && p.status === 'pronto') ev.current.aoPedidoPronto?.(p);
    }
  }, []);

  const carregar = useCallback(async () => {
    if (!restauranteId) return;
    const desde = new Date(Date.now() - 16 * 3600e3).toISOString();
    const [p, c] = await Promise.all([
      supabase.from('pedidos').select(SELECT_PEDIDO)
        .eq('restaurante_id', restauranteId)
        .or(`criado_em.gte.${desde},status.in.(novo,preparando,pronto)`)
        .order('criado_em', { ascending: true }),
      supabase.from('chamados').select('*')
        .eq('restaurante_id', restauranteId)
        .is('atendido_em', null)
        .order('criado_em', { ascending: true }),
    ]);
    if (p.data) {
      const lista = p.data as Pedido[];
      registrar(lista, semeado.current);
      setPedidos(lista);
    }
    if (c.data) {
      const lista = c.data as Chamado[];
      for (const ch of lista) {
        if (semeado.current && !chamadosConhecidos.current.has(ch.id)) ev.current.aoNovoChamado?.(ch);
        chamadosConhecidos.current.add(ch.id);
      }
      setChamados(lista);
    }
    semeado.current = true;
    setCarregando(false);
  }, [restauranteId, registrar]);

  useEffect(() => {
    if (!restauranteId) return;
    semeado.current = false;
    conhecidos.current.clear();
    chamadosConhecidos.current.clear();
    setCarregando(true);
    void carregar();

    const filtro = `restaurante_id=eq.${restauranteId}`;
    const canal = supabase
      .channel(`ao-vivo-${restauranteId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos', filter: filtro }, async (payload) => {
        const { data } = await supabase.from('pedidos').select(SELECT_PEDIDO).eq('id', (payload.new as Pedido).id).single();
        if (!data) return;
        const novo = data as Pedido;
        registrar([novo], true);
        setPedidos((lista) => (lista.some((x) => x.id === novo.id) ? lista : [...lista, novo]));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: filtro }, (payload) => {
        const novo = payload.new as Pedido;
        setPedidos((lista) => {
          const atual = lista.find((x) => x.id === novo.id);
          const mesclado = { ...(atual ?? {}), ...novo, pedido_itens: atual?.pedido_itens ?? [] } as Pedido;
          registrar([mesclado], true);
          return atual ? lista.map((x) => (x.id === novo.id ? mesclado : x)) : lista;
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chamados', filter: filtro }, (payload) => {
        const c = payload.new as Chamado;
        if (!chamadosConhecidos.current.has(c.id)) {
          chamadosConhecidos.current.add(c.id);
          ev.current.aoNovoChamado?.(c);
        }
        setChamados((lista) => [...lista.filter((x) => x.id !== c.id), c]);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chamados', filter: filtro }, (payload) => {
        const c = payload.new as Chamado;
        if (c.atendido_em) setChamados((lista) => lista.filter((x) => x.id !== c.id));
      })
      .subscribe((status) => {
        setConectado(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') void carregar();
      });

    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void carregar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('online', aoVoltar);
    const intervalo = setInterval(() => void carregar(), 45000);

    return () => {
      void supabase.removeChannel(canal);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('online', aoVoltar);
      clearInterval(intervalo);
    };
  }, [restauranteId, carregar, registrar]);

  const atualizarPedido = useCallback((id: string, mudancas: Partial<Pedido>) => {
    setPedidos((lista) => lista.map((p) => (p.id === id ? { ...p, ...mudancas } : p)));
    if (mudancas.status) conhecidos.current.set(id, mudancas.status);
  }, []);

  const removerChamado = useCallback((id: string) => {
    setChamados((lista) => lista.filter((c) => c.id !== id));
  }, []);

  return { pedidos, chamados, carregando, conectado, recarregar: carregar, atualizarPedido, removerChamado };
}
