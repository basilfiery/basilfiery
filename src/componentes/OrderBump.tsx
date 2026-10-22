import { Check, Minus, Plus, Sparkles } from 'lucide-react';
import { FotoProduto } from './Basicos';
import { rotuloDesconto, type OfertaBump } from '../lib/orderBump';
import { brl, cx } from '../lib/util';
import '../estilos/orderbump.css';

/**
 * Tela da oferta (order bump) dentro da janela do item: o item escolhido fica resumido
 * no topo e, embaixo, as ofertas para levar junto. Usada no cardápio e na prévia do painel.
 */
export function CorpoOrderBump({ oferta, escolhidos, aoMudar, item }: {
  oferta: OfertaBump;
  escolhidos: Record<string, number>;
  aoMudar: (id: string, qtd: number) => void;
  item?: { nome: string; qtd: number; total: number; foto?: { imagem_url: string | null; emoji: string | null; nome: string } };
}) {
  const { bump, itens } = oferta;
  const selo = rotuloDesconto(bump.desconto_tipo, Number(bump.desconto_valor));
  return (
    <div className="obump">
      {item && (
        <div className="obump__item">
          <span className="obump__ok"><Check size={14} strokeWidth={3} /></span>
          {item.foto && <FotoProduto p={item.foto} classe="obump__item-foto" />}
          <span className="obump__item-nome"><small>No seu pedido</small><b>{item.qtd > 1 ? `${item.qtd}× ` : ''}{item.nome}</b></span>
          <b className="obump__item-preco">{brl(item.total)}</b>
        </div>
      )}

      <header className="obump__cab">
        <span className="obump__selo"><Sparkles size={13} /> {selo ? `Oferta especial ${selo}` : 'Combina com o seu pedido'}</span>
        <h2>{bump.titulo}</h2>
        {bump.subtitulo && <p>{bump.subtitulo}</p>}
      </header>

      <ul className="obump__lista">
        {itens.map(({ p, preco, precoDe }) => {
          const n = escolhidos[p.id] ?? 0;
          const desconto = preco < precoDe;
          return (
            <li key={p.id} className={cx('obump__oferta', n > 0 && 'marcada')}>
              <button type="button" className="obump__toque" onClick={() => aoMudar(p.id, n ? 0 : 1)} aria-pressed={n > 0}>
                <FotoProduto p={p} classe="obump__foto" />
                <span className="obump__txt">
                  <strong>{p.prefixo ? `${p.prefixo} · ${p.nome}` : p.nome}</strong>
                  {p.descricao && <small>{p.descricao}</small>}
                  <span className="obump__precos">
                    {desconto && <s>{brl(precoDe)}</s>}
                    <em>{preco === 0 ? 'Grátis' : brl(preco)}</em>
                    {desconto && selo && <i>{selo}</i>}
                  </span>
                </span>
                {n === 0 && <span className="obump__mais" aria-hidden="true"><Plus size={18} strokeWidth={2.6} /></span>}
              </button>
              {n > 0 && (
                <div className="obump__qtd">
                  <button type="button" onClick={() => aoMudar(p.id, n - 1)} aria-label={`Menos ${p.nome}`}><Minus size={16} /></button>
                  <span>{n}</span>
                  <button type="button" disabled={n >= 10} onClick={() => aoMudar(p.id, n + 1)} aria-label={`Mais ${p.nome}`}><Plus size={16} /></button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
