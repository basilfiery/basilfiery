import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Papel, Restaurante, RestauranteComPapel } from './tipos';
import { ls } from './util';
import { Carregando } from '../componentes/Carregando';

interface Sessao {
  carregando: boolean;
  usuario: User | null;
  nome: string;
  /** Foto de perfil (null = sem foto) */
  foto: string | null;
  ehAdmin: boolean;
  restaurantes: RestauranteComPapel[];
  restaurante: RestauranteComPapel | null;
  escolherRestaurante: (id: string) => void;
  recarregar: () => Promise<void>;
  sair: () => Promise<void>;
}

const Ctx = createContext<Sessao | null>(null);
const CHAVE_REST = 'bf:restaurante';

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [authPronto, setAuthPronto] = useState(false);
  const [dados, setDados] = useState<{ uid: string; ehAdmin: boolean; restaurantes: RestauranteComPapel[]; nome: string; foto: string | null } | null>(null);
  const [escolhido, setEscolhido] = useState<string | null>(() => ls.ler<string | null>(CHAVE_REST, null));

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUsuario(data.session?.user ?? null);
      setAuthPronto(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_evento, s) => setUsuario(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = usuario?.id;

  const carregar = useCallback(async () => {
    if (!uid) {
      setDados(null);
      return;
    }
    const [m, a] = await Promise.all([
      supabase.from('membros').select('papel, nome, foto_url, restaurante:restaurantes(*)').eq('user_id', uid),
      supabase.from('plataforma_admins').select('user_id').eq('user_id', uid).maybeSingle(),
    ]);
    const ehAdmin = !!a.data;
    type Linha = { papel: Papel; nome: string; foto_url: string | null; restaurante: Restaurante | null };
    const linhas = (m.data ?? []) as unknown as Linha[];
    const lista: RestauranteComPapel[] = linhas
      .filter((l) => l.restaurante)
      .map((l) => ({ ...(l.restaurante as Restaurante), papel: l.papel }));
    if (ehAdmin) {
      const { data } = await supabase.from('restaurantes').select('*');
      for (const r of (data ?? []) as Restaurante[]) {
        if (!lista.some((l) => l.id === r.id)) lista.push({ ...r, papel: 'dono' });
      }
    }
    lista.sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    setDados({ uid, ehAdmin, restaurantes: lista, nome: linhas[0]?.nome ?? '', foto: linhas[0]?.foto_url ?? null });
  }, [uid]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const escolherRestaurante = useCallback((id: string) => {
    setEscolhido(id);
    ls.gravar(CHAVE_REST, id);
  }, []);

  const sair = useCallback(async () => {
    // Sai só deste aparelho: o celular, o caixa e os outros computadores continuam conectados
    await supabase.auth.signOut({ scope: 'local' });
    setDados(null);
  }, []);

  const valor = useMemo<Sessao>(() => {
    const restaurantes = dados?.restaurantes ?? [];
    const restaurante = restaurantes.find((r) => r.id === escolhido) ?? restaurantes[0] ?? null;
    return {
      carregando: !authPronto || (!!uid && dados?.uid !== uid),
      usuario,
      nome: dados?.nome || usuario?.user_metadata?.nome || usuario?.email || '',
      foto: dados?.foto ?? null,
      ehAdmin: dados?.ehAdmin ?? false,
      restaurantes,
      restaurante,
      escolherRestaurante,
      recarregar: carregar,
      sair,
    };
  }, [authPronto, uid, usuario, dados, escolhido, escolherRestaurante, carregar, sair]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessao() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSessao fora do ProvedorSessao');
  return s;
}

/** Para onde mandar a pessoa depois do login, de acordo com o cargo. */
export function destinoInicial(s: Sessao): string {
  if (!s.restaurante) return s.ehAdmin ? '/plataforma' : '/painel';
  return s.restaurante.papel === 'garcom' ? '/garcom' : '/painel';
}

export function ExigeLogin({ children }: { children: ReactNode }) {
  const s = useSessao();
  const local = useLocation();
  if (s.carregando) return <Carregando />;
  if (!s.usuario) return <Navigate to="/login" replace state={{ de: local.pathname }} />;
  return <>{children}</>;
}
