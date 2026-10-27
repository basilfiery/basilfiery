import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../lib/util';

/* =====================================================================
   Botão de período com calendário (como no Anota AI): clica, escolhe um
   atalho à direita ou marca o início e o fim no calendário, e "Selecionar".
   ===================================================================== */

export interface AtalhoPeriodo { id: string; rotulo: string; periodo: () => { inicio: Date; fim: Date } } // fim exclusivo

const SEMANA = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const PERSONALIZADO = 'personalizado';

const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const somar = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mesmoDia = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() === b.getTime();
const curta = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/** 6 semanas (segunda a domingo) a partir da semana do dia 1: o calendário não muda de altura */
function grade(mes: Date) {
  const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1);
  const comeco = somar(primeiro, -((primeiro.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => somar(comeco, i));
}

export function SeletorPeriodo({ inicio, fim, preset, atalhos, aoEscolher }: {
  inicio: Date;
  fim: Date;
  preset: string;
  atalhos: AtalhoPeriodo[];
  aoEscolher: (preset: string, inicio: Date, ultimoDia: Date) => void;
}) {
  const ultimo = somar(fim, -1);
  const [aberto, setAberto] = useState(false);
  const [tPreset, setTPreset] = useState(preset);
  const [a, setA] = useState<Date | null>(inicio);
  const [b, setB] = useState<Date | null>(ultimo);
  const [passando, setPassando] = useState<Date | null>(null);
  const [mes, setMes] = useState(() => new Date(ultimo.getFullYear(), ultimo.getMonth(), 1));
  const caixa = useRef<HTMLDivElement>(null);

  function abrir() {
    setTPreset(preset);
    setA(inicio);
    setB(ultimo);
    setPassando(null);
    const ref = ultimo > new Date() ? dia(new Date()) : ultimo;
    setMes(new Date(ref.getFullYear(), ref.getMonth(), 1));
    setAberto(true);
  }

  // Fecha clicando fora ou no Esc
  useEffect(() => {
    if (!aberto) return;
    // No celular os atalhos ficam numa fileira que rola: mostra o escolhido
    caixa.current?.querySelector('.sp-atalho.ativo')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto]);

  function usarAtalho(at: AtalhoPeriodo) {
    const p = at.periodo();
    const fimIncl = somar(p.fim, -1);
    setTPreset(at.id);
    setA(p.inicio);
    setB(fimIncl);
    const ref = fimIncl > new Date() ? dia(new Date()) : fimIncl;
    setMes(new Date(ref.getFullYear(), ref.getMonth(), 1));
  }

  function clicarDia(d: Date) {
    setTPreset(PERSONALIZADO);
    if (!a || b) { setA(d); setB(null); return; }
    if (d < a) { setB(a); setA(d); } else setB(d);
  }

  function selecionar() {
    if (!a) return;
    const fimSel = b ?? a;
    const atalho = atalhos.find((x) => x.id === tPreset);
    aoEscolher(atalho ? tPreset : PERSONALIZADO, a, fimSel);
    setAberto(false);
  }

  // Faixa: o que já está marcado, ou a prévia enquanto passa o mouse depois do primeiro clique
  const ini = a;
  const fimFaixa = b ?? (a && passando ? passando : null);
  const [lo, hi] = ini && fimFaixa && fimFaixa < ini ? [fimFaixa, ini] : [ini, fimFaixa];
  const hoje = dia(new Date());
  const anos = Array.from({ length: hoje.getFullYear() - 2020 + 2 }, (_, i) => 2020 + i);
  const rotulo = mesmoDia(inicio, ultimo) ? curta(inicio) : `${curta(inicio)} - ${curta(ultimo)}`;

  return (
    <div className="sp" ref={caixa}>
      <button type="button" className={cx('sp-botao', aberto && 'aberto')} onClick={() => (aberto ? setAberto(false) : abrir())} aria-haspopup="dialog" aria-expanded={aberto}>
        <CalendarDays size={17} />
        <span>{rotulo}</span>
        <ChevronDown size={16} className="sp-botao__seta" />
      </button>

      {aberto && <div className="sp-fundo" onClick={() => setAberto(false)} aria-hidden="true" />}
      {aberto && (
        <div className="sp-pop" role="dialog" aria-label="Escolher período">
          <div className="sp-cal">
            <div className="sp-cal__topo">
              <button type="button" className="sp-nav" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
              <select className="sp-sel" value={mes.getMonth()} onChange={(e) => setMes(new Date(mes.getFullYear(), Number(e.target.value), 1))} aria-label="Mês">
                {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select className="sp-sel" value={mes.getFullYear()} onChange={(e) => setMes(new Date(Number(e.target.value), mes.getMonth(), 1))} aria-label="Ano">
                {anos.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <button type="button" className="sp-nav" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} aria-label="Próximo mês"><ChevronRight size={18} /></button>
            </div>
            <div className="sp-grade" onMouseLeave={() => setPassando(null)}>
              {SEMANA.map((s, i) => <span key={i} className="sp-semana">{s}</span>)}
              {grade(mes).map((d) => {
                const t = d.getTime();
                const ehIni = !!lo && mesmoDia(d, lo);
                const ehFim = !!hi && mesmoDia(d, hi);
                const dentro = !!lo && !!hi && t > lo.getTime() && t < hi.getTime();
                const faixa = !!lo && !!hi && !mesmoDia(lo, hi);
                return (
                  <span key={t} className={cx('sp-cel', dentro && 'entre', faixa && ehIni && 'ini', faixa && ehFim && 'fim')}>
                    <button
                      type="button"
                      className={cx('sp-dia', d.getMonth() !== mes.getMonth() && 'fora', mesmoDia(d, hoje) && 'hoje', (ehIni || ehFim) && 'marcado')}
                      onClick={() => clicarDia(d)}
                      onMouseEnter={() => a && !b && setPassando(d)}
                      aria-pressed={ehIni || ehFim}
                      aria-label={d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    >
                      {d.getDate()}
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="sp-rodape">
              <button type="button" className="btn btn--contorno" onClick={() => setAberto(false)}>Cancelar</button>
              <button type="button" className="btn btn--primario" onClick={selecionar} disabled={!a}>Selecionar</button>
            </div>
          </div>
          <div className="sp-atalhos" role="listbox" aria-label="Atalhos de período">
            {atalhos.map((at) => (
              <button key={at.id} type="button" role="option" aria-selected={tPreset === at.id} className={cx('sp-atalho', tPreset === at.id && 'ativo')} onClick={() => usarAtalho(at)}>{at.rotulo}</button>
            ))}
            <button type="button" role="option" aria-selected={tPreset === PERSONALIZADO} className={cx('sp-atalho', tPreset === PERSONALIZADO && 'ativo')} onClick={() => { setTPreset(PERSONALIZADO); setA(null); setB(null); }}>Personalizado</button>
          </div>
        </div>
      )}
    </div>
  );
}
