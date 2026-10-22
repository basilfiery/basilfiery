/* Telas do sistema desenhadas em HTML para o site de vendas (nítidas em qualquer tela e animadas). */
import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import {
  BarChart3, Bell, BookOpen, Check, ClipboardList, ConciergeBell, LayoutGrid, Plus, Printer, Search, ShoppingBasket, Smartphone, Sparkles, TrendingUp, Wallet,
} from 'lucide-react';

const PRODUTOS = [
  { e: '🍕', n: 'Pizza Fiery', d: 'Calabresa, pimenta e mel', p: '84,90', tag: 'Mais pedido' },
  { e: '🍔', n: 'Smash Duplo', d: 'Blend 160g, cheddar', p: '42,90' },
  { e: '🍝', n: 'Fettuccine', d: 'Molho branco e bacon', p: '58,90' },
  { e: '🥗', n: 'Caesar', d: 'Frango grelhado', p: '36,90', tag: 'Novo' },
];

/** Cardápio digital (tablet da mesa ou celular do cliente). */
export function TelaCardapio({ compacto = false, comOferta = false }: { compacto?: boolean; comOferta?: boolean }) {
  return (
    <div className={`mk-card${compacto ? ' mk-card--compacto' : ''}`}>
      <div className="mk-card__topo">
        <span className="mk-card__logo">🔥</span>
        <div><b>Pizzaria Fiery</b><small><i /> Mesa 7 · aberto</small></div>
        <span className="mk-card__chamar"><ConciergeBell size={12} /> Garçom</span>
      </div>
      <div className="mk-card__abas">
        <span className="ativo">🍕 Pizzas</span><span>🍔 Burgers</span><span>🍝 Massas</span><span>🥤 Bebidas</span>
      </div>
      <div className="mk-card__grade">
        {PRODUTOS.slice(0, compacto ? 3 : 4).map((x) => (
          <div className="mk-prod" key={x.n}>
            <div className="mk-prod__txt">
              {x.tag && <em>{x.tag}</em>}
              <b>{x.n}</b>
              <small>{x.d}</small>
              <span>R$ {x.p}</span>
            </div>
            <div className="mk-prod__foto">{x.e}<i><Plus size={11} strokeWidth={3} /></i></div>
          </div>
        ))}
      </div>
      {comOferta && (
        <div className="mk-oferta">
          <span className="mk-oferta__selo"><Sparkles size={10} /> Oferta única -R$ 2,00</span>
          <b>Que tal levar junto?</b>
          <div className="mk-oferta__item">
            <span className="mk-oferta__foto">🥤</span>
            <div><b>Coca-Cola 2L</b><span><em>R$ 16,00</em> <s>R$ 18,00</s></span></div>
            <i><Check size={13} strokeWidth={3} /></i>
          </div>
          <span className="mk-oferta__botao">Quero por R$ 16,00</span>
        </div>
      )}
      {!comOferta && (
        <div className="mk-card__sacola"><span>2 itens</span><b>Ver pedido · R$ 127,80</b></div>
      )}
    </div>
  );
}

/** App do dono: vendas do dia, meta do mês e gráfico. */
export function TelaDono() {
  const barras = [38, 52, 44, 66, 58, 82, 96];
  return (
    <div className="mk-dono">
      <div className="mk-dono__topo"><span className="mk-dono__avatar">🔥</span><div><small>Boa noite,</small><b>Pizzaria Fiery</b></div><Bell size={14} /></div>
      <div className="mk-dono__venda">
        <small>Vendas hoje</small>
        <b>R$ 4.872,40</b>
        <span><TrendingUp size={11} /> +18% vs. ontem</span>
      </div>
      <div className="mk-dono__linha">
        <div className="mk-dono__meta">
          <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="18" /><circle cx="22" cy="22" r="18" className="arco" /></svg>
          <div><b>72%</b><small>meta do mês</small></div>
        </div>
        <div className="mk-dono__mini"><small>Pedidos</small><b>126</b><small>Ticket médio</small><b>R$ 38,67</b></div>
      </div>
      <div className="mk-dono__grafico">
        {barras.map((b, i) => <i key={i} style={{ height: `${b}%` }} className={i === barras.length - 1 ? 'hoje' : ''} />)}
      </div>
      <div className="mk-dono__dias"><span>S</span><span>T</span><span>Q</span><span>Q</span><span>S</span><span>S</span><span>D</span></div>
    </div>
  );
}

/** Painel do restaurante (computador do caixa): menu lateral + pedidos ao vivo. */
export function TelaPainel() {
  const col = (titulo: string, cor: string, itens: [string, string, string][]) => (
    <div className="mk-col">
      <div className="mk-col__cab"><i style={{ background: cor }} />{titulo}<b>{itens.length}</b></div>
      {itens.map(([n, m, v]) => (
        <div className="mk-ped" key={n}>
          <div><b>#{n}</b><span>{m}</span></div>
          <small>{v}</small>
          <i />
        </div>
      ))}
    </div>
  );
  return (
    <div className="mk-painel">
      <aside className="mk-painel__menu">
        <span className="mk-painel__marca">🔥 <b>Basil<em>Fiery</em></b></span>
        <span className="ativo"><ClipboardList size={11} /> Pedidos</span>
        <span><ShoppingBasket size={11} /> PDV</span>
        <span><LayoutGrid size={11} /> Mesas</span>
        <span><BookOpen size={11} /> Cardápio</span>
        <span><Sparkles size={11} /> Alavancar vendas</span>
        <span><BarChart3 size={11} /> Relatórios</span>
        <span><Printer size={11} /> Impressora</span>
      </aside>
      <div className="mk-painel__corpo">
        <div className="mk-painel__barra"><span><Search size={10} /> Buscar pedido…</span><i /><i /><b><Wallet size={10} /> Caixa</b></div>
        <div className="mk-painel__titulo"><b>Pedidos</b><span><i /> Ao vivo</span></div>
        <div className="mk-painel__cols">
          {col('Novos', '#ff2d3d', [['143', 'Mesa 7', 'R$ 99,70'], ['144', 'Delivery', 'R$ 62,00']])}
          {col('Em preparo', '#f59e0b', [['141', 'Mesa 2', 'R$ 148,30'], ['142', 'Balcão', 'R$ 28,00']])}
          {col('Prontos', '#22c55e', [['140', 'Mesa 4', 'R$ 76,90']])}
        </div>
      </div>
    </div>
  );
}

/** App do garçom: QR code da mesa e liberação do celular do cliente. */
export function TelaGarcom() {
  const [qr, setQr] = useState('');
  useEffect(() => {
    void QRCode.toDataURL('https://basilfiery.com.br', { width: 360, margin: 1, color: { dark: '#0a0a0c', light: '#ffffff' } }).then(setQr);
  }, []);
  return (
    <div className="mk-garcom">
      <div className="mk-garcom__topo"><b>Mesa 4</b><span><Smartphone size={10} /> App do garçom</span></div>
      <div className="mk-garcom__qr">{qr && <img src={qr} alt="" />}</div>
      <small className="mk-garcom__dica">Escaneie com a câmera para pedir</small>
      <div className="mk-garcom__linha"><ConciergeBell size={12} /><span><b>Mesa 2</b> pediu a conta</span><em>agora</em></div>
      <div className="mk-garcom__linha mk-garcom__linha--ok"><Check size={12} /><span><b>#141</b> pronto para levar</span><em>2 min</em></div>
      <div className="mk-garcom__pedido">
        <span className="mk-garcom__icone"><Smartphone size={13} /></span>
        <div><b>Maria · iPhone</b><small>Quer fazer pedidos</small></div>
        <span className="mk-garcom__liberar"><Check size={11} strokeWidth={3} /> Liberar</span>
      </div>
    </div>
  );
}

export function Cupom() {
  return (
    <div className="mk-cupom">
      <b>COZINHA</b>
      <strong>PEDIDO #143</strong>
      <span>MESA 7 · 20:41</span>
      <hr />
      <p><b>1x</b> Pizza Fiery</p>
      <p className="obs">› sem cebola</p>
      <p><b>2x</b> Smash Duplo</p>
      <p><b>1x</b> Coca-Cola 2L</p>
      <hr />
      <small>Feito por: Basil Fiery</small>
    </div>
  );
}

export function Notificacao({ titulo, texto, icone = <Bell size={14} /> }: { titulo: string; texto: string; icone?: ReactNode }) {
  return (
    <div className="mk-notif">
      <span className="mk-notif__icone">{icone}</span>
      <div><b>{titulo}</b><small>{texto}</small></div>
      <em>agora</em>
    </div>
  );
}
