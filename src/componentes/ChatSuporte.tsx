import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, CheckCheck, MessageCircle, SendHorizontal, X } from 'lucide-react';
import { useSessao } from '../lib/sessao';
import { notificarLocal, somLigado, tocarAviso } from '../lib/som';
import { msgErro, supabase } from '../lib/supabase';
import { cx } from '../lib/util';
import { useToast } from './Toast';
import '../estilos/suporte.css';

export interface MensagemSuporte {
  id: string;
  restaurante_id: string;
  autor_id: string | null;
  autor_nome: string;
  do_suporte: boolean;
  texto: string;
  criado_em: string;
  lida_em: string | null;
}

/** Mensagens de uma loja, ao vivo (novas e "lidas" chegam sozinhas). */
export function useMensagensSuporte(restauranteId: string | null, aoChegar?: (m: MensagemSuporte) => void) {
  const [msgs, setMsgs] = useState<MensagemSuporte[] | null>(null);
  const cb = useRef(aoChegar);
  cb.current = aoChegar;

  useEffect(() => {
    if (!restauranteId) { setMsgs(null); return; }
    let vivo = true;
    setMsgs(null);
    const carregar = async () => {
      const { data } = await supabase.from('suporte_mensagens').select('*')
        .eq('restaurante_id', restauranteId).order('criado_em', { ascending: false }).limit(300);
      if (vivo && data) setMsgs((data as MensagemSuporte[]).reverse());
    };
    void carregar();
    const filtro = `restaurante_id=eq.${restauranteId}`;
    const canal = supabase
      .channel(`suporte-${restauranteId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'suporte_mensagens', filter: filtro }, (p) => {
        const m = p.new as MensagemSuporte;
        setMsgs((l) => (l && l.some((x) => x.id === m.id) ? l : [...(l ?? []), m]));
        cb.current?.(m);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'suporte_mensagens', filter: filtro }, (p) => {
        const m = p.new as MensagemSuporte;
        setMsgs((l) => l?.map((x) => (x.id === m.id ? m : x)) ?? l);
      })
      // Voltou a conexão: busca de novo para não perder nada
      .subscribe((st) => { if (st === 'SUBSCRIBED') void carregar(); });
    return () => { vivo = false; void supabase.removeChannel(canal); };
  }, [restauranteId]);

  const incluir = useCallback((m: MensagemSuporte) => {
    setMsgs((l) => (l && l.some((x) => x.id === m.id) ? l : [...(l ?? []), m]));
  }, []);
  return { msgs, incluir };
}

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
function rotuloDia(iso: string) {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  const h = new Date(); h.setHours(0, 0, 0, 0);
  const dif = Math.round((h.getTime() - d.getTime()) / 86400000);
  if (dif === 0) return 'Hoje';
  if (dif === 1) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === h.getFullYear() ? undefined : 'numeric' });
}

const SUGESTOES = ['Preciso de ajuda com o cardápio', 'Minha impressora não imprime', 'Dúvida sobre a minha fatura'];

/** Lista de mensagens + campo de escrever. Usado no balão do painel e na caixa do suporte. */
export function ConversaSuporte({ restauranteId, comoSuporte, msgs, incluir, vazio, rascunho, aoRascunho }: {
  restauranteId: string;
  comoSuporte: boolean;
  msgs: MensagemSuporte[] | null;
  incluir: (m: MensagemSuporte) => void;
  vazio?: ReactNode;
  rascunho: string;
  aoRascunho: (t: string) => void;
}) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const meu = (m: MensagemSuporte) => m.do_suporte === comoSuporte;

  // Sempre mostra a última mensagem
  useLayoutEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length, restauranteId]);

  // Viu a conversa: marca como lidas as do outro lado
  const temNaoLida = !!msgs?.some((m) => !meu(m) && !m.lida_em);
  useEffect(() => {
    if (!temNaoLida) return;
    // then: a chamada só sai quando alguém espera por ela
    const ler = () => { if (!document.hidden) void supabase.rpc('suporte_ler', { p_rest: restauranteId, p_como_suporte: comoSuporte }).then(() => undefined); };
    ler();
    document.addEventListener('visibilitychange', ler);
    return () => document.removeEventListener('visibilitychange', ler);
  }, [temNaoLida, restauranteId, comoSuporte, msgs?.length]);

  // Campo cresce com o texto (até 5 linhas)
  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [rascunho]);

  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) campo.current?.focus(); }, [restauranteId]);

  async function enviar(texto = rascunho) {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      const { data, error } = await supabase.rpc('suporte_enviar', { p_rest: restauranteId, p_texto: t, p_como_suporte: comoSuporte });
      if (error) throw error;
      incluir(data as MensagemSuporte);
      aoRascunho('');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  return (
    <>
      <div className="sup-lista" ref={lista}>
        {!msgs ? (
          <div className="sup-lista__carregando"><div className="spinner" /></div>
        ) : msgs.length === 0 ? (
          <div className="sup-vazio">
            {vazio}
            {!comoSuporte && (
              <div className="sup-sugestoes">
                {SUGESTOES.map((s) => <button key={s} type="button" onClick={() => void enviar(s)} disabled={enviando}>{s}</button>)}
              </div>
            )}
          </div>
        ) : msgs.map((m, i) => {
          const ant = msgs[i - 1];
          const novoDia = !ant || new Date(ant.criado_em).toDateString() !== new Date(m.criado_em).toDateString();
          const emGrupo = !novoDia && ant && ant.do_suporte === m.do_suporte && ant.autor_id === m.autor_id
            && new Date(m.criado_em).getTime() - new Date(ant.criado_em).getTime() < 5 * 60000;
          const mostrarNome = comoSuporte && !m.do_suporte && !emGrupo && m.autor_nome;
          return (
            <Fragment key={m.id}>
              {novoDia && <div className="sup-dia"><span>{rotuloDia(m.criado_em)}</span></div>}
              <div className={cx('sup-msg', meu(m) ? 'sup-msg--minha' : 'sup-msg--dele', emGrupo && 'sup-msg--seguida')}>
                {mostrarNome && <span className="sup-msg__autor">{m.autor_nome}</span>}
                <div className="sup-msg__balao">
                  <span className="sup-msg__texto">{m.texto}</span>
                  <span className="sup-msg__hora">
                    {hora(m.criado_em)}
                    {meu(m) && (m.lida_em
                      ? <CheckCheck size={14} className="sup-msg__visto" aria-label="Visualizada" />
                      : <Check size={14} aria-label="Enviada" />)}
                  </span>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <form className="sup-escrever" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
        <textarea
          ref={campo}
          rows={1}
          value={rascunho}
          maxLength={2000}
          placeholder="Digite uma mensagem..."
          aria-label="Mensagem"
          onChange={(e) => aoRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.stopPropagation(); // não fecha a janela que estiver aberta atrás
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(); }
          }}
        />
        <button type="submit" className="sup-escrever__enviar" disabled={!rascunho.trim() || enviando} aria-label="Enviar">
          <SendHorizontal size={19} />
        </button>
      </form>
    </>
  );
}

const CHAVE_ABERTO = 'bf:suporte-aberto';
const lerAberto = () => { try { return sessionStorage.getItem(CHAVE_ABERTO) === '1'; } catch { return false; } };
const gravarAberto = (v: boolean) => { try { sessionStorage.setItem(CHAVE_ABERTO, v ? '1' : '0'); } catch { /* sem armazenamento */ } };

/**
 * Balão de suporte do painel (igual ao do Anota AI): fica fixo no canto, a conversa
 * continua aberta enquanto a pessoa navega pelo sistema e só fecha no X.
 */
export function BalaoSuporte({ restauranteId }: { restauranteId: string }) {
  const s = useSessao();
  const [aberto, setAberto] = useState(lerAberto);
  const [rascunho, setRascunho] = useState('');
  const abertoRef = useRef(aberto);
  abertoRef.current = aberto;

  const { msgs, incluir } = useMensagensSuporte(restauranteId, (m) => {
    if (!m.do_suporte) return;
    if (!abertoRef.current || document.hidden) {
      if (somLigado()) tocarAviso();
      notificarLocal('Suporte Basil Fiery', m.texto, 'suporte');
    }
  });
  const naoLidas = aberto ? 0 : (msgs ?? []).filter((m) => m.do_suporte && !m.lida_em).length;

  function mudar(v: boolean) { setAberto(v); gravarAberto(v); }

  return (
    <>
      {aberto && (
        <section className="sup-janela" aria-label="Conversa com o suporte">
          <header className="sup-janela__topo">
            <span className="sup-janela__avatar"><img src="/icone.svg" alt="" /><i aria-hidden="true" /></span>
            <span className="sup-janela__quem">
              <b>Suporte Basil Fiery</b>
              <small>Online · respondemos por aqui</small>
            </span>
            <button type="button" className="sup-janela__fechar" onClick={() => mudar(false)} aria-label="Fechar conversa">
              <X size={20} />
            </button>
          </header>
          <ConversaSuporte
            restauranteId={restauranteId}
            comoSuporte={false}
            msgs={msgs}
            incluir={incluir}
            rascunho={rascunho}
            aoRascunho={setRascunho}
            vazio={<>
              <span className="sup-vazio__icone"><MessageCircle size={26} /></span>
              <b>Olá{s.nome ? `, ${s.nome.split(' ')[0]}` : ''}! Como posso ajudar?</b>
              <small>Mande sua dúvida. Você pode continuar usando o sistema enquanto conversa.</small>
            </>}
          />
        </section>
      )}
      {!aberto && (
        <button type="button" className="sup-botao" onClick={() => mudar(true)} aria-label={naoLidas ? `Suporte: ${naoLidas} mensagem(ns) nova(s)` : 'Falar com o suporte'}>
          <MessageCircle size={26} />
          {naoLidas > 0 && <span className="sup-botao__selo">{naoLidas > 9 ? '9+' : naoLidas}</span>}
          <span className="sup-botao__dica" aria-hidden="true">Fale com o suporte</span>
        </button>
      )}
    </>
  );
}

export interface ConversaResumo {
  restaurante_id: string;
  nome: string;
  logo_url: string | null;
  cor: string | null;
  plano: string | null;
  ultima_texto: string;
  ultima_em: string;
  ultima_do_suporte: boolean;
  nao_lidas: number;
}

/** Só para o administrador: todas as conversas, ao vivo, e aviso quando uma loja escreve. */
export function useCaixaSuporte(ativo: boolean, aoChegar?: (m: MensagemSuporte) => void) {
  const s = useSessao();
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const cb = useRef(aoChegar);
  cb.current = aoChegar;
  const uid = s.usuario?.id;

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const carregar = async () => {
      const { data } = await supabase.rpc('suporte_conversas');
      if (vivo && data) setConversas(data as ConversaResumo[]);
    };
    const depois = () => { clearTimeout(espera); espera = setTimeout(() => void carregar(), 250); };
    void carregar();
    const canal = supabase
      .channel(`suporte-caixa-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'suporte_mensagens' }, (p) => {
        const m = p.new as MensagemSuporte;
        if (!m.do_suporte && m.autor_id !== uid) cb.current?.(m);
        depois();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'suporte_mensagens' }, depois)
      .subscribe((st) => { if (st === 'SUBSCRIBED') void carregar(); });
    return () => { vivo = false; clearTimeout(espera); void supabase.removeChannel(canal); };
  }, [ativo, uid]);

  const naoLidas = (conversas ?? []).reduce((t, c) => t + c.nao_lidas, 0);
  return { conversas, naoLidas };
}

/** /plataforma › Suporte: conversas das lojas à esquerda, chat à direita. */
export function CaixaSuporte({ conversas }: { conversas: ConversaResumo[] | null }) {
  const [atual, setAtual] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const { msgs, incluir } = useMensagensSuporte(atual);
  const c = conversas?.find((x) => x.restaurante_id === atual) ?? null;

  if (!conversas) return <div className="sup-lista__carregando"><div className="spinner" /></div>;
  if (!conversas.length) {
    return (
      <div className="sup-caixa__nada">
        <MessageCircle size={34} />
        <b>Nenhuma conversa ainda</b>
        <small>Quando uma loja tocar no balão de suporte do painel, a conversa aparece aqui.</small>
      </div>
    );
  }
  const avatar = (x: ConversaResumo) => (x.logo_url
    ? <span className="sup-loja__avatar"><img src={x.logo_url} alt="" /></span>
    : <span className="sup-loja__avatar" style={{ background: x.cor ?? 'var(--fire)' }}>{x.nome.trim().slice(0, 1).toUpperCase()}</span>);

  return (
    <div className={cx('sup-caixa', atual && 'sup-caixa--aberta')}>
      <aside className="sup-caixa__lojas" aria-label="Conversas">
        {conversas.map((x) => (
          <button key={x.restaurante_id} type="button" className={cx('sup-loja', x.restaurante_id === atual && 'ativo', x.nao_lidas > 0 && 'sup-loja--nova')} onClick={() => setAtual(x.restaurante_id)}>
            {avatar(x)}
            <span className="sup-loja__txt">
              <span className="sup-loja__linha"><b>{x.nome}</b><small>{rotuloCurto(x.ultima_em)}</small></span>
              <span className="sup-loja__linha">
                <span className="sup-loja__ultima">{x.ultima_do_suporte && 'Você: '}{x.ultima_texto}</span>
                {x.nao_lidas > 0 && <span className="sup-loja__selo">{x.nao_lidas}</span>}
              </span>
            </span>
          </button>
        ))}
      </aside>
      <section className="sup-caixa__chat">
        {!c ? (
          <div className="sup-caixa__nada"><MessageCircle size={34} /><b>Escolha uma conversa</b></div>
        ) : (
          <>
            <header className="sup-caixa__topo">
              <button type="button" className="sup-caixa__voltar" onClick={() => setAtual(null)} aria-label="Voltar para as conversas"><X size={18} /></button>
              {avatar(c)}
              <span className="sup-janela__quem"><b>{c.nome}</b><small>Plano {c.plano ?? '—'}</small></span>
            </header>
            <ConversaSuporte
              restauranteId={c.restaurante_id}
              comoSuporte
              msgs={msgs}
              incluir={incluir}
              rascunho={rascunhos[c.restaurante_id] ?? ''}
              aoRascunho={(t) => setRascunhos((r) => ({ ...r, [c.restaurante_id]: t }))}
            />
          </>
        )}
      </section>
    </div>
  );
}

function rotuloCurto(iso: string) {
  const d = rotuloDia(iso);
  return d === 'Hoje' ? hora(iso) : d;
}
