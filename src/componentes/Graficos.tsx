import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cx } from '../lib/util';

export interface Ponto {
  chave: string;
  rotulo: string;   // texto curto no eixo
  detalhe: string;  // texto completo na dica
  valor: number;
  sub?: string;     // linha extra na dica (ex.: "12 pedidos")
  n?: number;       // contagem para a visão em tabela
}

/** Escala "redonda" para o eixo Y (0, 250, 500…). */
function escala(max: number) {
  if (max <= 0) return { topo: 4, passo: 1 };
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / mag;
  const passo = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { topo: passo * Math.ceil(max / passo), passo };
}

interface PropsColunas {
  dados: Ponto[];
  formatar: (v: number) => string;
  formatarEixo: (v: number) => string;
  altura?: number;
  rotuloAria: string;
  aoClicar?: (indice: number) => void;
  destacar?: number; // índice com destaque (ex.: mês/dia atual)
}

/** Gráfico de colunas de uma série: barras finas, dica ao passar o mouse/tocar. */
export function GraficoColunas({ dados, formatar, formatarEixo, altura = 220, rotuloAria, aoClicar, destacar }: PropsColunas) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const [largura, setLargura] = useState(600);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(0, ...dados.map((d) => d.valor));
  const { topo, passo } = escala(max);
  const ticks: number[] = [];
  for (let v = 0; v <= topo + passo / 1000; v += passo) ticks.push(v);
  const salto = Math.max(1, Math.ceil(dados.length / Math.max(2, Math.floor(largura / 52))));
  const pct = (v: number) => `${(v / topo) * 100}%`;

  return (
    <div className="gc" style={{ '--gc-altura': `${altura}px` } as CSSProperties}>
      <div className="gc__eixo-y" aria-hidden="true">
        {ticks.map((t) => <span key={t} style={{ bottom: pct(t) }}>{formatarEixo(t)}</span>)}
      </div>
      <div className="gc__area" ref={areaRef}>
        <div className="gc__grade" aria-hidden="true">
          {ticks.map((t) => <span key={t} style={{ bottom: pct(t) }} />)}
        </div>
        <div className="gc__colunas" role="list" aria-label={rotuloAria}>
          {dados.map((d, i) => {
            const lado = i < dados.length * 0.2 ? 'esq' : i > dados.length * 0.8 ? 'dir' : '';
            return (
              <div
                key={d.chave}
                role="listitem"
                tabIndex={0}
                aria-label={`${d.detalhe}: ${formatar(d.valor)}${d.sub ? `, ${d.sub}` : ''}`}
                className={cx('gc__slot', ativo === i && 'ativo', !!aoClicar && 'clicavel', destacar === i && 'destaque')}
                onPointerEnter={() => setAtivo(i)}
                onPointerLeave={() => setAtivo((a) => (a === i ? null : a))}
                onFocus={() => setAtivo(i)}
                onBlur={() => setAtivo((a) => (a === i ? null : a))}
                onClick={aoClicar ? () => aoClicar(i) : undefined}
                onKeyDown={aoClicar ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aoClicar(i); } } : undefined}
              >
                {d.valor > 0 && <div className="gc__barra" style={{ height: `max(3px, ${pct(d.valor)})` }} />}
                {ativo === i && (
                  <div className={cx('gc__dica', lado)} role="tooltip">
                    <strong>{formatar(d.valor)}</strong>
                    <span>{d.detalhe}</span>
                    {d.sub && <span>{d.sub}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="gc__eixo-x" aria-hidden="true">
          {dados.map((d, i) => <span key={d.chave}>{i % salto === 0 ? d.rotulo : ''}</span>)}
        </div>
      </div>
    </div>
  );
}

/** Ranking em barras horizontais (valor na ponta, em texto neutro). */
export function BarrasHorizontais({ itens, formatar }: {
  itens: { chave: string; rotulo: string; valor: number; sub?: string }[];
  formatar: (v: number) => string;
}) {
  const max = Math.max(0, ...itens.map((i) => i.valor)) || 1;
  return (
    <ol className="bh">
      {itens.map((i, n) => (
        <li key={i.chave} className="bh__linha">
          <span className="bh__pos">{n + 1}</span>
          <span className="bh__rotulo" title={i.rotulo}>{i.rotulo}</span>
          <span className="bh__trilho" aria-hidden="true">
            <span className="bh__barra" style={{ width: `${(i.valor / max) * 100}%` }} />
          </span>
          <span className="bh__valor">
            {formatar(i.valor)}
            {i.sub && <small>{i.sub}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}
