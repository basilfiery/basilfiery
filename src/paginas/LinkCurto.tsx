import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Carregando } from '../componentes/Carregando';
import { LinkCurtoCtx, caminhosLoja } from '../lib/linkCurto';
import { supabase } from '../lib/supabase';
import Mesa from './mesa/Mesa';
import Loja, { LojaPedido } from './loja/Loja';

type Alvo = { slug: string; codigo?: string; token?: string; mesa?: string };

/**
 * Abre o cardápio, a mesa ou o acompanhamento do pedido a partir do endereço:
 *   raiz:       /cardapio, /mesa1, /<loja> (antigo → vira /assinante/<loja>/cardapio)
 *   assinante:  /assinante/<loja>, /assinante/<loja>/cardapio, /assinante/<loja>/mesa1, /assinante/<loja>/pedido/<x>
 *   dominio:    fritas.com.br, /cardapio, /mesa1, /pedido/<x>  (domínio próprio da loja)
 */
export default function LinkCurto({ modo = 'raiz' }: { modo?: 'raiz' | 'assinante' | 'dominio' }) {
  const { loja = '', mesa = '', acompanhar } = useParams();
  const [alvo, setAlvo] = useState<Alvo | null | undefined>(undefined);
  const [falhou, setFalhou] = useState(false);
  const dominio = modo === 'dominio' ? window.location.hostname : null;

  useEffect(() => {
    let vivo = true;
    setAlvo(undefined);
    setFalhou(false);
    void supabase.rpc('link_resolver', { p_loja: dominio ? null : loja, p_mesa: mesa || null, p_dominio: dominio })
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setFalhou(true);
        else setAlvo((data as Alvo | null) ?? null);
      });
    return () => { vivo = false; };
  }, [loja, mesa, dominio]);

  // Deixa o endereço no formato oficial (/Cardapio → /cardapio, /fritas → /assinante/fritas/cardapio)
  useEffect(() => {
    if (!alvo) return;
    const c = caminhosLoja(alvo.slug, !!dominio);
    const certo = alvo.token && alvo.mesa ? c.mesa(alvo.mesa) : acompanhar ? `${c.base}/pedido/${acompanhar}` : c.inicio;
    if (window.location.pathname !== certo) window.history.replaceState(window.history.state, '', certo + window.location.search + window.location.hash);
  }, [alvo, dominio, acompanhar]);

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
  if (alvo === null) return dominio ? <NaoEncontrado /> : <Navigate to="/" replace />;

  const c = caminhosLoja(alvo.slug, !!dominio);
  if (alvo.token) {
    return (
      <LinkCurtoCtx.Provider value={{ token: alvo.token, base: c.mesa(alvo.mesa ?? mesa.toLowerCase()) }}>
        <Mesa key={alvo.token} />
      </LinkCurtoCtx.Provider>
    );
  }
  return (
    <LinkCurtoCtx.Provider value={{ codigo: alvo.codigo, base: c.base, inicio: c.inicio }}>
      {acompanhar ? <LojaPedido /> : <Loja />}
    </LinkCurtoCtx.Provider>
  );
}

export const LinkAssinante = () => <LinkCurto modo="assinante" />;
export const LinkDominio = () => <LinkCurto modo="dominio" />;

/** Domínio próprio: endereço que não existe (ex.: mesa apagada) */
function NaoEncontrado() {
  return (
    <div className="mesa-erro">
      <h1 className="titulo">Página não encontrada</h1>
      <p className="muted">Confira o endereço digitado.</p>
      <a className="btn btn--primario btn--lg" href="/">Ver o cardápio</a>
    </div>
  );
}
