import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bot, Check, CheckCheck, CircleCheckBig, Headset, ImagePlus, LifeBuoy, MessageCircle, Mic, Pause, Play, SendHorizontal, Sparkles, Star, Trash2, X,
} from 'lucide-react';
import { TOPICOS_AJUDA, type TopicoAjuda } from '../lib/ajudaRapida';
import { useSessao } from '../lib/sessao';
import { notificarLocal, somLigado, tocarAviso } from '../lib/som';
import { msgErro, prepararImagem, supabase } from '../lib/supabase';
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
  tipo: 'texto' | 'imagem' | 'audio' | 'sistema';
  anexo: string | null;
  duracao: number | null;
  ia: boolean;
  meta: { acao?: string; motivo?: string; atendente_nome?: string; nota?: number; comentario?: string } | null;
  criado_em: string;
  lida_em: string | null;
}
export interface EstadoSuporte { modo: 'ia' | 'humano'; pedido_humano_em: string | null; atendente_nome: string | null }

/** Mensagens de uma loja, ao vivo (novas, lidas e avaliadas chegam sozinhas). */
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
      .subscribe((st) => { if (st === 'SUBSCRIBED') void carregar(); });
    return () => { vivo = false; void supabase.removeChannel(canal); };
  }, [restauranteId]);

  const incluir = useCallback((m: MensagemSuporte) => {
    setMsgs((l) => (l && l.some((x) => x.id === m.id) ? l : [...(l ?? []), m]));
  }, []);
  return { msgs, incluir };
}

/** Com quem a loja está falando: o assistente ou uma pessoa do time. */
export function useEstadoSuporte(restauranteId: string | null) {
  const [estado, setEstado] = useState<EstadoSuporte>({ modo: 'ia', pedido_humano_em: null, atendente_nome: null });
  useEffect(() => {
    if (!restauranteId) return;
    let vivo = true;
    const carregar = async () => {
      const { data } = await supabase.from('suporte_estado').select('modo, pedido_humano_em, atendente_nome').eq('restaurante_id', restauranteId).maybeSingle();
      if (vivo) setEstado((data as EstadoSuporte | null) ?? { modo: 'ia', pedido_humano_em: null, atendente_nome: null });
    };
    void carregar();
    const canal = supabase
      .channel(`suporte-estado-${restauranteId}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suporte_estado', filter: `restaurante_id=eq.${restauranteId}` }, () => void carregar())
      .subscribe();
    return () => { vivo = false; void supabase.removeChannel(canal); };
  }, [restauranteId]);
  return estado;
}

/* ---------- Arquivos (privados): endereço temporário assinado ---------- */
const urls = new Map<string, { url: string; ate: number }>();
function useUrlAnexo(caminho: string | null) {
  const [url, setUrl] = useState(() => (caminho && (urls.get(caminho)?.ate ?? 0) > Date.now() ? urls.get(caminho)!.url : ''));
  useEffect(() => {
    if (!caminho) return;
    const c = urls.get(caminho);
    if (c && c.ate > Date.now()) { setUrl(c.url); return; }
    let vivo = true;
    void supabase.storage.from('suporte').createSignedUrl(caminho, 3600).then(({ data }) => {
      if (!vivo || !data?.signedUrl) return;
      urls.set(caminho, { url: data.signedUrl, ate: Date.now() + 3500_000 });
      setUrl(data.signedUrl);
    });
    return () => { vivo = false; };
  }, [caminho]);
  return url;
}

async function subirAnexo(restauranteId: string, blob: Blob, tipo: 'imagem' | 'audio') {
  const mime = (blob.type || (tipo === 'imagem' ? 'image/jpeg' : 'audio/webm')).split(';')[0];
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/wav': 'wav' } as Record<string, string>)[mime] ?? 'bin';
  const caminho = `${restauranteId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('suporte').upload(caminho, blob, { contentType: mime, upsert: false });
  if (error) throw error;
  return caminho;
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
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- Gravador de áudio ---------- */
function tipoAudio() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}
function useGravador(aoTerminar: (b: Blob, segundos: number) => void) {
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const inicio = useRef(0);
  const cancelado = useRef(false);
  const fim = useRef(aoTerminar);
  fim.current = aoTerminar;

  useEffect(() => {
    if (!gravando) return;
    const i = setInterval(() => {
      const s = (Date.now() - inicio.current) / 1000;
      setSegundos(s);
      if (s >= 180) rec.current?.stop(); // até 3 minutos
    }, 250);
    return () => clearInterval(i);
  }, [gravando]);

  async function comecar() {
    const fluxo = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tipo = tipoAudio();
    const r = new MediaRecorder(fluxo, tipo ? { mimeType: tipo } : undefined);
    pedacos.current = [];
    cancelado.current = false;
    r.ondataavailable = (e) => { if (e.data.size) pedacos.current.push(e.data); };
    r.onstop = () => {
      fluxo.getTracks().forEach((t) => t.stop());
      setGravando(false);
      const seg = Math.round((Date.now() - inicio.current) / 1000);
      if (!cancelado.current && seg >= 1) fim.current(new Blob(pedacos.current, { type: (r.mimeType || tipo || 'audio/webm').split(';')[0] }), seg);
    };
    rec.current = r;
    inicio.current = Date.now();
    setSegundos(0);
    r.start(250);
    setGravando(true);
  }
  const parar = () => rec.current?.state === 'recording' && rec.current.stop();
  const cancelar = () => { cancelado.current = true; parar(); };
  useEffect(() => () => { cancelado.current = true; if (rec.current?.state === 'recording') rec.current.stop(); }, []);
  return { gravando, segundos, comecar, parar, cancelar };
}

/* ---------- Anexos na conversa ---------- */
function ImagemMsg({ caminho, aoAbrir }: { caminho: string; aoAbrir: (url: string) => void }) {
  const url = useUrlAnexo(caminho);
  return url
    ? <button type="button" className="sup-imagem" onClick={() => aoAbrir(url)}><img src={url} alt="Imagem enviada" loading="lazy" /></button>
    : <span className="sup-imagem sup-imagem--carregando" />;
}

function AudioMsg({ caminho, duracao }: { caminho: string; duracao: number | null }) {
  const url = useUrlAnexo(caminho);
  const audio = useRef<HTMLAudioElement>(null);
  const [tocando, setTocando] = useState(false);
  const [pos, setPos] = useState(0);
  const total = duracao || audio.current?.duration || 0;
  return (
    <span className="sup-audio">
      <button type="button" className="sup-audio__play" disabled={!url} aria-label={tocando ? 'Pausar' : 'Ouvir'}
        onClick={() => { const a = audio.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); }}>
        {tocando ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <span className="sup-audio__barra"><i style={{ width: `${total ? Math.min(100, (pos / total) * 100) : 0}%` }} /></span>
      <small>{mmss(tocando || pos ? pos : total)}</small>
      {url && (
        <audio ref={audio} src={url} preload="metadata"
          onPlay={() => setTocando(true)} onPause={() => setTocando(false)}
          onEnded={() => { setTocando(false); setPos(0); }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} />
      )}
    </span>
  );
}

const ROTULO_NOTA = ['', 'Ruim', 'Poderia ser melhor', 'Bom', 'Muito bom', 'Excelente!'];

function Estrelas({ valor, aoMudar, tamanho = 26 }: { valor: number; aoMudar?: (n: number) => void; tamanho?: number }) {
  // Passando o mouse, as estrelas vão preenchendo até onde o mouse está
  const [sobre, setSobre] = useState(0);
  const mostra = sobre || valor;
  return (
    <span className="sup-estrelas-caixa">
      <span className={cx('sup-estrelas', aoMudar && 'sup-estrelas--editavel')} onMouseLeave={() => setSobre(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" disabled={!aoMudar} onClick={() => aoMudar?.(n)} aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
            onMouseEnter={() => aoMudar && setSobre(n)} onFocus={() => aoMudar && setSobre(n)} onBlur={() => setSobre(0)}>
            <Star size={tamanho} className={cx(n <= mostra && 'cheia')} />
          </button>
        ))}
      </span>
      {aoMudar && <small className={cx('sup-estrelas__rotulo', mostra > 0 && 'ativo')}>{ROTULO_NOTA[mostra] || 'Toque nas estrelas'}</small>}
    </span>
  );
}

/** Cliente avalia o atendimento que acabou de ser finalizado. */
function Avaliar({ m }: { m: MensagemSuporte }) {
  const toast = useToast();
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  if (m.meta?.nota) {
    return (
      <div className="sup-avaliacao sup-avaliacao--feita">
        <span>Obrigado pela avaliação!</span>
        <Estrelas valor={m.meta.nota} tamanho={18} />
      </div>
    );
  }
  async function enviar() {
    setEnviando(true);
    const { error } = await supabase.rpc('suporte_avaliar', { p_mensagem: m.id, p_nota: nota, p_comentario: comentario.trim() || null });
    setEnviando(false);
    if (error) toast(msgErro(error), 'erro');
  }
  return (
    <div className="sup-avaliacao">
      <b>{m.meta?.atendente_nome && m.meta.atendente_nome !== 'Suporte' ? `Como foi o atendimento de ${m.meta.atendente_nome}?` : 'Como foi o atendimento do nosso time?'}</b>
      <Estrelas valor={nota} aoMudar={setNota} />
      {nota > 0 && (
        <>
          <textarea rows={2} maxLength={500} value={comentario} onChange={(e) => setComentario(e.target.value)} placeholder={nota >= 4 ? 'Quer deixar um elogio? (opcional)' : 'O que podemos melhorar? (opcional)'} />
          <button type="button" className="sup-avaliacao__enviar" disabled={enviando} onClick={() => void enviar()}>{enviando ? 'Enviando…' : 'Enviar avaliação'}</button>
        </>
      )}
    </div>
  );
}

/** Ajuda rápida: o cliente escolhe o assunto e vê os passos antes de falar com alguém. */
function AjudaRapida({ aoNaoResolver, aoPessoa, aoOutro }: { aoNaoResolver: (t: TopicoAjuda) => void; aoPessoa: () => void; aoOutro: () => void }) {
  const [topico, setTopico] = useState<TopicoAjuda | null>(null);
  const [resolveu, setResolveu] = useState(false);
  if (resolveu) {
    return (
      <div className="sup-funil sup-funil--ok">
        <CircleCheckBig size={30} />
        <b>Que bom que resolveu! 🎉</b>
        <small>Se precisar de novo, é só escrever aqui.</small>
        <button type="button" className="sup-funil__link" onClick={() => { setResolveu(false); setTopico(null); }}>Ver outros assuntos</button>
      </div>
    );
  }
  if (topico) {
    return (
      <div className="sup-funil">
        <button type="button" className="sup-funil__voltar" onClick={() => setTopico(null)}>← Outros assuntos</button>
        <b className="sup-funil__titulo">{topico.emoji} {topico.titulo}</b>
        <ol className="sup-funil__passos">{topico.passos.map((p) => <li key={p}>{p}</li>)}</ol>
        <div className="sup-funil__acoes">
          <button type="button" className="sup-funil__sim" onClick={() => setResolveu(true)}>Resolveu!</button>
          <button type="button" className="sup-funil__nao" onClick={() => aoNaoResolver(topico)}>Não resolveu</button>
        </div>
      </div>
    );
  }
  return (
    <div className="sup-funil">
      <b className="sup-funil__titulo">Sobre o que você precisa de ajuda?</b>
      <div className="sup-funil__topicos">
        {TOPICOS_AJUDA.map((t) => (
          <button key={t.id} type="button" onClick={() => setTopico(t)}><span>{t.emoji}</span>{t.titulo}</button>
        ))}
        <button type="button" onClick={aoOutro}><span>💬</span>Outro assunto</button>
      </div>
      <button type="button" className="sup-funil__pessoa" onClick={aoPessoa}><Headset size={15} /> Prefiro falar com uma pessoa</button>
    </div>
  );
}

/** Lista de mensagens + campo de escrever (com imagem e áudio). Usado no balão do painel e na central do suporte. */
export function ConversaSuporte({ restauranteId, comoSuporte, msgs, incluir, estado, vazio, rascunho, aoRascunho }: {
  restauranteId: string;
  comoSuporte: boolean;
  msgs: MensagemSuporte[] | null;
  incluir: (m: MensagemSuporte) => void;
  estado?: EstadoSuporte;
  vazio?: ReactNode;
  rascunho: string;
  aoRascunho: (t: string) => void;
}) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);
  const [digitando, setDigitando] = useState(false);
  const [foto, setFoto] = useState('');
  const lista = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const meu = (m: MensagemSuporte) => m.do_suporte === comoSuporte;
  const comIA = !comoSuporte && (estado?.modo ?? 'ia') === 'ia';

  // Atendimento atual = depois do último "finalizado"
  const ultimoFim = (msgs ?? []).map((m) => m.meta?.acao).lastIndexOf('finalizado');
  const atuais = (msgs ?? []).slice(ultimoFim + 1);
  // Avaliação pendente vem antes: a ajuda rápida aparece depois que o cliente avaliar
  const avaliacaoPendente = ultimoFim >= 0 && !msgs![ultimoFim].meta?.nota;
  const mostrarFunil = comIA && !!msgs && !avaliacaoPendente && atuais.filter((m) => m.tipo !== 'sistema').length === 0 && !digitando;

  useLayoutEffect(() => {
    const el = lista.current;
    // Ajuda rápida no começo: mostra do topo (saudação + assuntos); conversa: vai para a última mensagem
    if (el) el.scrollTop = msgs?.length === 0 ? 0 : el.scrollHeight;
  }, [msgs?.length, restauranteId, digitando, mostrarFunil]);

  const temNaoLida = !!msgs?.some((m) => !meu(m) && !m.lida_em);
  useEffect(() => {
    if (!temNaoLida) return;
    const ler = () => { if (!document.hidden) void supabase.rpc('suporte_ler', { p_rest: restauranteId, p_como_suporte: comoSuporte }).then(() => undefined); };
    ler();
    document.addEventListener('visibilitychange', ler);
    return () => document.removeEventListener('visibilitychange', ler);
  }, [temNaoLida, restauranteId, comoSuporte, msgs?.length]);

  useLayoutEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [rascunho]);

  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) campo.current?.focus(); }, [restauranteId]);

  // O assistente responde (só no lado do cliente, enquanto não houver uma pessoa no atendimento)
  async function chamarIA() {
    if (!comIA) return;
    setDigitando(true);
    try { await supabase.functions.invoke('suporte-ia', { body: { restaurante_id: restauranteId } }); } catch { /* o time vê a mensagem mesmo assim */ }
    setDigitando(false);
  }

  async function mandar(args: { texto?: string; tipo?: 'texto' | 'imagem' | 'audio'; anexo?: string; duracao?: number }) {
    const { data, error } = await supabase.rpc('suporte_enviar', {
      p_rest: restauranteId, p_texto: args.texto ?? '', p_como_suporte: comoSuporte,
      p_tipo: args.tipo ?? 'texto', p_anexo: args.anexo ?? null, p_duracao: args.duracao ?? null,
    });
    if (error) throw error;
    incluir(data as MensagemSuporte);
    void chamarIA();
  }

  async function enviar(texto = rascunho) {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    try {
      await mandar({ texto: t });
      aoRascunho('');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviando(false);
      campo.current?.focus();
    }
  }

  async function enviarImagem(f: File) {
    setEnviando(true);
    try {
      const blob = await prepararImagem(f);
      const caminho = await subirAnexo(restauranteId, blob, 'imagem');
      await mandar({ tipo: 'imagem', anexo: caminho, texto: rascunho.trim() });
      aoRascunho('');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setEnviando(false);
    }
  }

  const grav = useGravador((blob, segundos) => {
    setEnviando(true);
    void subirAnexo(restauranteId, blob, 'audio')
      .then((caminho) => mandar({ tipo: 'audio', anexo: caminho, duracao: segundos }))
      .catch((e) => toast(msgErro(e), 'erro'))
      .finally(() => setEnviando(false));
  });
  async function gravar() {
    try { await grav.comecar(); } catch { toast('Libere o microfone no navegador para mandar áudio.', 'erro'); }
  }

  async function pedirPessoa() {
    const { error } = await supabase.rpc('suporte_pedir_humano', { p_rest: restauranteId, p_motivo: null });
    if (error) toast(msgErro(error), 'erro');
  }

  function sistema(m: MensagemSuporte): ReactNode {
    const acao = m.meta?.acao;
    if (acao === 'finalizado') {
      return (
        <div className="sup-sistema-bloco">
          <div className="sup-sistema"><span><CircleCheckBig size={13} /> Atendimento finalizado{m.autor_nome && comoSuporte ? ` por ${m.autor_nome}` : ''}</span></div>
          {comoSuporte
            ? (m.meta?.nota ? <div className="sup-avaliacao sup-avaliacao--feita"><span>Avaliação</span><Estrelas valor={m.meta.nota} tamanho={16} />{m.meta.comentario && <em>“{m.meta.comentario}”</em>}</div> : null)
            : <Avaliar m={m} />}
        </div>
      );
    }
    if (acao === 'pediu_humano') return <div className="sup-sistema"><span><Headset size={13} /> {comoSuporte ? 'Pediu para falar com uma pessoa' : 'Você pediu para falar com uma pessoa'}</span></div>;
    if (acao === 'ia_chamou_humano') return <div className="sup-sistema"><span><Headset size={13} /> {comoSuporte ? `Assistente chamou o time: ${m.meta?.motivo ?? ''}` : 'Chamando alguém do time…'}</span></div>;
    return <div className="sup-sistema"><span>{m.texto}</span></div>;
  }

  return (
    <>
      <div className="sup-lista" ref={lista}>
        {!msgs ? (
          <div className="sup-lista__carregando"><div className="spinner" /></div>
        ) : (
          <>
            {msgs.length === 0 && <div className="sup-vazio">{vazio}</div>}
            {msgs.map((m, i) => {
              const ant = msgs[i - 1];
              const novoDia = !ant || new Date(ant.criado_em).toDateString() !== new Date(m.criado_em).toDateString();
              if (m.tipo === 'sistema') return <Fragment key={m.id}>{novoDia && <div className="sup-dia"><span>{rotuloDia(m.criado_em)}</span></div>}{sistema(m)}</Fragment>;
              const emGrupo = !novoDia && ant && ant.tipo !== 'sistema' && ant.do_suporte === m.do_suporte && ant.autor_id === m.autor_id && ant.ia === m.ia
                && new Date(m.criado_em).getTime() - new Date(ant.criado_em).getTime() < 5 * 60000;
              const nome = !emGrupo && (m.ia ? 'Assistente virtual' : comoSuporte !== m.do_suporte || comoSuporte ? m.autor_nome : '');
              return (
                <Fragment key={m.id}>
                  {novoDia && <div className="sup-dia"><span>{rotuloDia(m.criado_em)}</span></div>}
                  <div className={cx('sup-msg', meu(m) ? 'sup-msg--minha' : 'sup-msg--dele', emGrupo && 'sup-msg--seguida', m.ia && 'sup-msg--ia', m.tipo !== 'texto' && 'sup-msg--midia')}>
                    {nome && <span className="sup-msg__autor">{m.ia && <Sparkles size={11} />}{nome}</span>}
                    <div className="sup-msg__balao">
                      {m.tipo === 'imagem' && m.anexo && <ImagemMsg caminho={m.anexo} aoAbrir={setFoto} />}
                      {m.tipo === 'audio' && m.anexo && <AudioMsg caminho={m.anexo} duracao={m.duracao} />}
                      {m.texto && <span className="sup-msg__texto">{m.texto}</span>}
                      <span className="sup-msg__hora">
                        {hora(m.criado_em)}
                        {meu(m) && !m.ia && (m.lida_em ? <CheckCheck size={14} className="sup-msg__visto" aria-label="Visualizada" /> : <Check size={14} aria-label="Enviada" />)}
                      </span>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            {mostrarFunil && (
              <AjudaRapida
                aoNaoResolver={(t) => void enviar(t.pergunta)}
                aoPessoa={() => void pedirPessoa()}
                aoOutro={() => campo.current?.focus()}
              />
            )}
            {digitando && (
              <div className="sup-msg sup-msg--dele sup-msg--ia">
                <span className="sup-msg__autor"><Sparkles size={11} />Assistente virtual</span>
                <div className="sup-msg__balao sup-digitando" aria-label="Digitando"><i /><i /><i /></div>
              </div>
            )}
          </>
        )}
      </div>

      {grav.gravando ? (
        <div className="sup-escrever sup-gravando">
          <button type="button" className="sup-escrever__icone" onClick={grav.cancelar} aria-label="Cancelar áudio"><Trash2 size={19} /></button>
          <span className="sup-gravando__tempo"><i aria-hidden="true" /> Gravando {mmss(grav.segundos)}</span>
          <button type="button" className="sup-escrever__enviar" onClick={grav.parar} aria-label="Enviar áudio"><SendHorizontal size={19} /></button>
        </div>
      ) : (
        <form className="sup-escrever" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          <button type="button" className="sup-escrever__icone" onClick={() => arquivo.current?.click()} disabled={enviando} aria-label="Enviar imagem" title="Enviar imagem"><ImagePlus size={19} /></button>
          <input ref={arquivo} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviarImagem(f); e.target.value = ''; }} />
          <textarea
            ref={campo}
            rows={1}
            value={rascunho}
            maxLength={4000}
            placeholder={comIA ? 'Escreva sua dúvida...' : 'Digite uma mensagem...'}
            aria-label="Mensagem"
            onChange={(e) => aoRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar(); }
            }}
          />
          {rascunho.trim() || !tipoAudio() ? (
            <button type="submit" className="sup-escrever__enviar" disabled={!rascunho.trim() || enviando} aria-label="Enviar"><SendHorizontal size={19} /></button>
          ) : (
            <button type="button" className="sup-escrever__enviar sup-escrever__mic" disabled={enviando} onClick={() => void gravar()} aria-label="Gravar áudio" title="Gravar áudio"><Mic size={19} /></button>
          )}
        </form>
      )}

      {foto && (
        <div className="sup-foto" role="dialog" aria-label="Imagem" onClick={() => setFoto('')}>
          <img src={foto} alt="" />
          <button type="button" aria-label="Fechar"><X size={22} /></button>
        </div>
      )}
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
  const toast = useToast();
  const [aberto, setAberto] = useState(lerAberto);
  const [rascunho, setRascunho] = useState('');
  const abertoRef = useRef(aberto);
  abertoRef.current = aberto;
  const estado = useEstadoSuporte(restauranteId);

  const { msgs, incluir } = useMensagensSuporte(restauranteId, (m) => {
    if (!m.do_suporte || m.tipo === 'sistema') return;
    if (!abertoRef.current || document.hidden) {
      if (somLigado()) tocarAviso();
      notificarLocal('Suporte Basil Fiery', m.tipo === 'audio' ? '🎤 Áudio' : m.tipo === 'imagem' ? '📷 Imagem' : m.texto, 'suporte');
    }
  });
  const naoLidas = aberto ? 0 : (msgs ?? []).filter((m) => m.do_suporte && !m.lida_em && m.tipo !== 'sistema').length;

  function mudar(v: boolean) { setAberto(v); gravarAberto(v); }
  async function pedirPessoa() {
    const { error } = await supabase.rpc('suporte_pedir_humano', { p_rest: restauranteId, p_motivo: null });
    if (error) toast(msgErro(error), 'erro');
  }

  const subtitulo = estado.modo === 'humano'
    ? (estado.atendente_nome ? `Com ${estado.atendente_nome} do time` : 'Chamando alguém do time…')
    : 'Assistente virtual · responde na hora';

  return (
    <>
      {aberto && (
        <section className="sup-janela" aria-label="Conversa com o suporte">
          <header className="sup-janela__topo">
            <span className="sup-janela__avatar">
              {estado.modo === 'humano' ? <Headset size={20} /> : <img src="/icone.svg" alt="" />}
              <i aria-hidden="true" />
            </span>
            <span className="sup-janela__quem">
              <b>Suporte Basil Fiery</b>
              <small>{subtitulo}</small>
            </span>
            <button type="button" className="sup-janela__fechar" onClick={() => mudar(false)} aria-label="Fechar conversa">
              <X size={20} />
            </button>
          </header>
          {/* Sempre fácil chegar numa pessoa do time */}
          {estado.modo === 'ia' ? (
            <div className="sup-faixa">
              <Bot size={15} /> <span>Prefere falar com alguém?</span>
              <button type="button" onClick={() => void pedirPessoa()}><Headset size={14} /> Falar com uma pessoa</button>
            </div>
          ) : (
            <div className="sup-faixa sup-faixa--humano">
              <Headset size={15} /> <span>{estado.atendente_nome ? `Você está falando com ${estado.atendente_nome}.` : 'Chamamos alguém do time. Já já responde por aqui.'}</span>
            </div>
          )}
          <ConversaSuporte
            restauranteId={restauranteId}
            comoSuporte={false}
            msgs={msgs}
            incluir={incluir}
            estado={estado}
            rascunho={rascunho}
            aoRascunho={setRascunho}
            vazio={<>
              <b><LifeBuoy size={17} /> Olá{s.nome ? `, ${s.nome.split(' ')[0]}` : ''}! Como posso ajudar?</b>
              <small>Escolha um assunto ou escreva sua dúvida. Dá para continuar usando o sistema enquanto conversa.</small>
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
  ultima_tipo: string;
  ultima_em: string;
  ultima_do_suporte: boolean;
  ultima_ia: boolean;
  nao_lidas: number;
  modo: 'ia' | 'humano';
  pedido_humano_em: string | null;
  atendente_nome: string | null;
  nota_media: number | null;
}

/** Time de suporte: todas as conversas, ao vivo, e aviso quando uma loja escreve ou pede uma pessoa. */
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
        if ((!m.do_suporte && m.autor_id !== uid) || m.meta?.acao === 'ia_chamou_humano') cb.current?.(m);
        depois();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'suporte_mensagens' }, depois)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suporte_estado' }, depois)
      .subscribe((st) => { if (st === 'SUBSCRIBED') void carregar(); });
    return () => { vivo = false; clearTimeout(espera); void supabase.removeChannel(canal); };
  }, [ativo, uid]);

  const naoLidas = (conversas ?? []).reduce((t, c) => t + c.nao_lidas, 0);
  const esperando = (conversas ?? []).filter((c) => c.modo === 'humano' && c.pedido_humano_em).length;
  return { conversas, naoLidas, esperando };
}

/** Central de atendimento: conversas das lojas à esquerda, chat à direita. */
export function CaixaSuporte({ conversas }: { conversas: ConversaResumo[] | null }) {
  const toast = useToast();
  const [atual, setAtual] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const { msgs, incluir } = useMensagensSuporte(atual);
  const estado = useEstadoSuporte(atual);
  const c = conversas?.find((x) => x.restaurante_id === atual) ?? null;

  async function finalizar() {
    if (!c) return;
    const { error } = await supabase.rpc('suporte_finalizar', { p_rest: c.restaurante_id });
    if (error) return toast(msgErro(error), 'erro');
    toast('Atendimento finalizado. A loja vai receber o pedido de avaliação.', 'ok');
  }

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
  const previa = (x: ConversaResumo) => {
    const t = x.ultima_tipo === 'audio' ? '🎤 Áudio' : x.ultima_tipo === 'imagem' ? '📷 Imagem' : x.ultima_texto;
    return `${x.ultima_ia ? 'Assistente: ' : x.ultima_do_suporte ? 'Você: ' : ''}${t}`;
  };

  return (
    <div className={cx('sup-caixa', atual && 'sup-caixa--aberta')}>
      <aside className="sup-caixa__lojas" aria-label="Conversas">
        {conversas.map((x) => {
          const espera = x.modo === 'humano' && !!x.pedido_humano_em;
          return (
            <button key={x.restaurante_id} type="button" className={cx('sup-loja', x.restaurante_id === atual && 'ativo', (x.nao_lidas > 0 || espera) && 'sup-loja--nova')} onClick={() => setAtual(x.restaurante_id)}>
              {avatar(x)}
              <span className="sup-loja__txt">
                <span className="sup-loja__linha"><b>{x.nome}</b><small>{rotuloCurto(x.ultima_em)}</small></span>
                <span className="sup-loja__linha">
                  <span className="sup-loja__ultima">{previa(x)}</span>
                  {x.nao_lidas > 0 && <span className="sup-loja__selo">{x.nao_lidas}</span>}
                </span>
                <span className="sup-loja__tags">
                  {espera ? <em className="sup-tag sup-tag--espera"><Headset size={11} /> Quer falar com uma pessoa</em>
                    : x.modo === 'ia' ? <em className="sup-tag"><Bot size={11} /> Com o assistente</em>
                      : <em className="sup-tag sup-tag--humano"><Headset size={11} /> {x.atendente_nome ?? 'Com o time'}</em>}
                  {x.nota_media != null && <em className="sup-tag sup-tag--nota"><Star size={11} /> {Number(x.nota_media).toLocaleString('pt-BR')}</em>}
                </span>
              </span>
            </button>
          );
        })}
      </aside>
      <section className="sup-caixa__chat">
        {!c ? (
          <div className="sup-caixa__nada"><MessageCircle size={34} /><b>Escolha uma conversa</b></div>
        ) : (
          <>
            <header className="sup-caixa__topo">
              <button type="button" className="sup-caixa__voltar" onClick={() => setAtual(null)} aria-label="Voltar para as conversas"><X size={18} /></button>
              {avatar(c)}
              <span className="sup-janela__quem">
                <b>{c.nome}</b>
                <small>Plano {c.plano ?? '—'} · {estado.modo === 'ia' ? 'assistente respondendo' : estado.atendente_nome ? `com ${estado.atendente_nome}` : 'esperando uma pessoa'}</small>
              </span>
              <button type="button" className="btn btn--contorno btn--sm" onClick={() => void finalizar()}><CircleCheckBig size={15} /> Finalizar atendimento</button>
            </header>
            <ConversaSuporte
              restauranteId={c.restaurante_id}
              comoSuporte
              msgs={msgs}
              incluir={incluir}
              estado={estado}
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
