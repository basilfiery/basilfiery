import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Carregando } from '../componentes/Carregando';
import { LinkCurtoCtx, caminhoMesa } from '../lib/linkCurto';
import { supabase } from '../lib/supabase';
import Mesa from './mesa/Mesa';
import Loja, { LojaPedido } from './loja/Loja';

type Alvo = { slug: string; codigo?: string; token?: string; mesa?: string };

/** basilfiery.com.br/<loja>, /<loja>/<mesa>, /<loja>/pedido/<acompanhar> e, na loja principal, /<mesa> */
export default function LinkCurto() {
  const { loja = '', mesa = '', acompanhar } = useParams();
  const [alvo, setAlvo] = useState<Alvo | null | undefined>(undefined);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    setAlvo(undefined);
    setFalhou(false);
    void supabase.rpc('link_resolver', { p_loja: loja, p_mesa: mesa || null }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) setFalhou(true);
      else setAlvo((data as Alvo | null) ?? null);
    });
    return () => { vivo = false; };
  }, [loja, mesa]);

  // Deixa o endereço no formato oficial (/Cardapio → /cardapio, /Mesa-1 → /mesa1)
  useEffect(() => {
    if (!alvo) return;
    const certo = alvo.token && alvo.mesa ? caminhoMesa(alvo.slug, alvo.mesa) : `/${alvo.slug}${acompanhar ? `/pedido/${acompanhar}` : ''}`;
    if (window.location.pathname !== certo) window.history.replaceState(window.history.state, '', certo + window.location.search + window.location.hash);
  }, [alvo, mesa, acompanhar]);

  if (falhou) {
    return (
      <div className="mesa-erro">
        <h1 className="titulo">Sem conexão</h1>
        <p className="muted">Confira a internet e tente de novo.</p>
        <button className="btn btn--primario btn--lg" onClick={() => window.location.reload()}>Tentar de novo</button>
      </div>
    );
  }
  if (alvo === undefined) return <Carregando />;
  if (alvo === null) return <Navigate to="/" replace />;

  if (alvo.token) {
    return (
      <LinkCurtoCtx.Provider value={{ token: alvo.token, base: caminhoMesa(alvo.slug, alvo.mesa ?? mesa.toLowerCase()) }}>
        <Mesa key={alvo.token} />
      </LinkCurtoCtx.Provider>
    );
  }
  return (
    <LinkCurtoCtx.Provider value={{ codigo: alvo.codigo, base: `/${alvo.slug}` }}>
      {acompanhar ? <LojaPedido /> : <Loja />}
    </LinkCurtoCtx.Provider>
  );
}
