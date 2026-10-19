import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Footprints, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { Modal } from '../../componentes/Modal';
import { cx, ls } from '../../lib/util';

/* =====================================================================
   Jogo da memória para passar o tempo enquanto o pedido fica pronto.
   Só no cardápio da mesa. Para tirar: JOGO_NA_MESA = false em Mesa.tsx.
   ===================================================================== */

const COMIDAS = ['🍕', '🍔', '🍟', '🌭', '🥤', '🍦', '🍩', '🍰', '🧀', '🍅', '🌮', '🥗', '🍗', '🍫'];
type Nivel = 'facil' | 'medio' | 'dificil';
const NIVEIS: Record<Nivel, { rotulo: string; pares: number; colunas: number }> = {
  facil: { rotulo: 'Fácil', pares: 6, colunas: 4 },
  medio: { rotulo: 'Médio', pares: 8, colunas: 4 },
  dificil: { rotulo: 'Difícil', pares: 10, colunas: 5 },
};
interface Carta { id: number; emoji: string; virada: boolean; achada: boolean }
interface Recorde { jogadas: number; segundos: number }

function embaralhar<T>(lista: T[]) {
  const l = [...lista];
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

function novoJogo(nivel: Nivel): Carta[] {
  const escolhidas = embaralhar(COMIDAS).slice(0, NIVEIS[nivel].pares);
  return embaralhar([...escolhidas, ...escolhidas]).map((emoji, id) => ({ id, emoji, virada: false, achada: false }));
}

const tempo = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function JogoMemoria({ aoFechar }: { aoFechar: () => void }) {
  const [nivel, setNivel] = useState<Nivel>(() => ls.ler<Nivel>('bf:jogo:nivel', 'facil'));
  const [cartas, setCartas] = useState<Carta[]>(() => novoJogo(nivel));
  const [abertas, setAbertas] = useState<number[]>([]);
  const [jogadas, setJogadas] = useState(0);
  const [segundos, setSegundos] = useState(0);
  const [comecou, setComecou] = useState(false);
  const [acertou, setAcertou] = useState<number | null>(null);
  const travado = useRef(false);
  const recordes = useMemo(() => ls.ler<Partial<Record<Nivel, Recorde>>>('bf:jogo:recordes', {}), [cartas]); // eslint-disable-line react-hooks/exhaustive-deps
  const venceu = cartas.length > 0 && cartas.every((c) => c.achada);
  const achados = cartas.filter((c) => c.achada).length / 2;
  const [novoRecorde, setNovoRecorde] = useState(false);

  // Relógio: começa no primeiro toque e para quando termina
  useEffect(() => {
    if (!comecou || venceu) return;
    const i = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [comecou, venceu]);

  // Fim de jogo: guarda o recorde (menos jogadas; empate, menos tempo)
  useEffect(() => {
    if (!venceu) return;
    const atual = recordes[nivel];
    const melhor = !atual || jogadas < atual.jogadas || (jogadas === atual.jogadas && segundos < atual.segundos);
    if (melhor) ls.gravar('bf:jogo:recordes', { ...recordes, [nivel]: { jogadas, segundos } });
    setNovoRecorde(melhor);
    if ('vibrate' in navigator) navigator.vibrate?.([60, 40, 60, 40, 120]);
  }, [venceu]); // eslint-disable-line react-hooks/exhaustive-deps

  function reiniciar(n: Nivel = nivel) {
    setNivel(n);
    ls.gravar('bf:jogo:nivel', n);
    setCartas(novoJogo(n));
    setAbertas([]);
    setJogadas(0);
    setSegundos(0);
    setComecou(false);
    setNovoRecorde(false);
    travado.current = false;
  }

  function virar(c: Carta) {
    if (travado.current || c.virada || c.achada) return;
    if (!comecou) setComecou(true);
    const novas = [...abertas, c.id];
    setCartas((l) => l.map((x) => (x.id === c.id ? { ...x, virada: true } : x)));
    if (novas.length < 2) { setAbertas(novas); return; }
    setJogadas((j) => j + 1);
    const [a, b] = novas.map((id) => cartas.find((x) => x.id === id)!);
    const outra = a.id === c.id ? b : a;
    if (outra.emoji === c.emoji) {
      setCartas((l) => l.map((x) => (x.id === c.id || x.id === outra.id ? { ...x, virada: true, achada: true } : x)));
      setAbertas([]);
      setAcertou(c.id);
      setTimeout(() => setAcertou(null), 600);
      if ('vibrate' in navigator) navigator.vibrate?.(30);
    } else {
      travado.current = true;
      setAbertas(novas);
      setTimeout(() => {
        setCartas((l) => l.map((x) => (novas.includes(x.id) && !x.achada ? { ...x, virada: false } : x)));
        setAbertas([]);
        travado.current = false;
      }, 850);
    }
  }

  const recorde = recordes[nivel];
  const cfg = NIVEIS[nivel];

  return (
    <Modal aberto aoFechar={aoFechar} largura={560} classe="mesa-modal jogo-modal" titulo="Jogo da memória">
      <div className="jogo">
        <div className="jogo__niveis" role="tablist" aria-label="Dificuldade">
          {(Object.keys(NIVEIS) as Nivel[]).map((n) => (
            <button key={n} role="tab" aria-selected={nivel === n} className={cx(nivel === n && 'ativo')} onClick={() => reiniciar(n)}>{NIVEIS[n].rotulo}</button>
          ))}
        </div>

        <div className="jogo__placar">
          <span><Footprints size={16} /> {jogadas} {jogadas === 1 ? 'jogada' : 'jogadas'}</span>
          <span><Clock size={16} /> {tempo(segundos)}</span>
          <span><Sparkles size={16} /> {achados}/{cfg.pares}</span>
        </div>

        {venceu ? (
          <div className="jogo__fim">
            <span className="jogo__trofeu"><Trophy size={40} /></span>
            <h2>{novoRecorde ? 'Novo recorde!' : 'Você conseguiu!'}</h2>
            <p>Achou os {cfg.pares} pares em <b>{jogadas} jogadas</b> e <b>{tempo(segundos)}</b>.</p>
            {recorde && !novoRecorde && <p className="jogo__recorde">Recorde neste aparelho: {recorde.jogadas} jogadas · {tempo(recorde.segundos)}</p>}
            <div className="jogo__fim-acoes">
              <button className="btn btn--primario btn--lg" onClick={() => reiniciar()}><RotateCcw size={18} /> Jogar de novo</button>
              {nivel !== 'dificil' && <button className="btn btn--contorno btn--lg" onClick={() => reiniciar(nivel === 'facil' ? 'medio' : 'dificil')}>Tentar o {nivel === 'facil' ? 'Médio' : 'Difícil'}</button>}
            </div>
          </div>
        ) : (
          <>
            <div className="jogo__grade" style={{ gridTemplateColumns: `repeat(${cfg.colunas}, minmax(0, 1fr))` }}>
              {cartas.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cx('jogo__carta', (c.virada || c.achada) && 'virada', c.achada && 'achada', acertou !== null && c.achada && cartas.find((x) => x.id === acertou)?.emoji === c.emoji && 'pulo')}
                  onClick={() => virar(c)}
                  aria-label={c.virada || c.achada ? c.emoji : 'Carta virada para baixo'}
                >
                  <span className="jogo__face jogo__face--costas" aria-hidden="true" />
                  <span className="jogo__face jogo__face--frente" aria-hidden="true">{c.emoji}</span>
                </button>
              ))}
            </div>
            <p className="jogo__dica">
              {comecou ? 'Ache os pares iguais com o menor número de jogadas.' : 'Toque em duas cartas para achar os pares iguais.'}
              {recorde && <> · Recorde: {recorde.jogadas} jogadas</>}
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
