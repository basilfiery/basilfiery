import { Check, Hourglass, Minus, Plus, Sparkles } from 'lucide-react';
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
  const temDesconto = itens.some((i) => i.preco < i.precoDe);
  return (
    <div className="obump">
      {item && (
        <div className="obump__item">
          <span className="obump__item-foto-caixa">
            {item.foto && <FotoProduto p={item.foto} classe="obump__item-foto" />}
            <span className="obump__ok"><Check size={11} strokeWidth={3.5} /></span>
          </span>
          <span className="obump__item-nome"><small>Adicionado ao pedido</small><b>{item.qtd > 1 ? `${item.qtd}× ` : ''}{item.nome}</b></span>
          <b className="obump__item-preco">{brl(item.total)}</b>
        </div>
      )}

      <section className={cx('obump__palco', temDesconto && 'obump__palco--desconto')}>
        <header className="obump__cab">
          <div className="obump__selos">
            <span className="obump__selo"><Sparkles size={13} /> {temDesconto && selo ? `Oferta única ${selo}` : 'Combina com o seu pedido'}</span>
            <span className="obump__agora"><i aria-hidden="true" /> Só agora</span>
          </div>
          <h2>{bump.titulo}</h2>
          {bump.subtitulo && <p>{bump.subtitulo}</p>}
        </header>

        <ul className="obump__lista">
          {itens.map(({ p, preco, precoDe }) => {
            const n = escolhidos[p.id] ?? 0;
            const economia = precoDe - preco;
            return (
              <li key={p.id} className={cx('obump__oferta', n > 0 && 'marcada')}>
                <button type="button" className="obump__toque" onClick={() => aoMudar(p.id, n ? 0 : 1)} aria-pressed={n > 0}>
                  <FotoProduto p={p} classe="obump__foto" />
                  <span className="obump__txt">
                    <strong>{p.prefixo ? `${p.prefixo} · ${p.nome}` : p.nome}</strong>
                    {p.descricao && <small>{p.descricao}</small>}
                    <span className="obump__precos">
                      <em>{preco === 0 ? 'Grátis' : brl(preco)}</em>
                      {economia > 0 && <s>{brl(precoDe)}</s>}
                    </span>
                    {economia > 0 && <span className="obump__economia">Economize {brl(economia)}</span>}
                  </span>
                  <span className="obump__check" aria-hidden="true">{n > 0 ? <Check size={18} strokeWidth={3} /> : <Plus size={18} strokeWidth={2.6} />}</span>
                </button>
                {n > 0 && (
                  <div className="obump__qtd-linha">
                    <span>Quantidade</span>
                    <div className="obump__qtd">
                      <button type="button" onClick={() => aoMudar(p.id, n - 1)} aria-label={`Menos ${p.nome}`}><Minus size={15} /></button>
                      <span>{n}</span>
                      <button type="button" disabled={n >= 10} onClick={() => aoMudar(p.id, n + 1)} aria-label={`Mais ${p.nome}`}><Plus size={15} /></button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <p className="obump__escassez">
        <Hourglass size={15} />
        {temDesconto
          ? <span><b>Oferta única.</b> Se você recusar agora, esse desconto não aparece de novo.</span>
          : <span><b>Sugestão só agora.</b> Depois ela não aparece de novo nesta visita.</span>}
      </p>
    </div>
  );
}
