import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Bell, BellRing, Bike, Boxes, Check, ChevronDown, ConciergeBell, Download, FileText, Flame, Globe, Headset,
  LayoutDashboard, Menu, MonitorDown, MousePointer2, Palette, Printer, QrCode, Rocket, ShieldCheck, ShoppingBasket, Smartphone, Sparkles,
  TrendingUp, Wallet, X, Zap,
} from 'lucide-react';
import { SITE, linkWhatsVendas, noProgramaWindows } from '../../config/site';
import { Cupom, Notificacao, TelaCardapio, TelaDono, TelaGarcom, TelaPainel } from './Mockups';
import { useInclinar, useOrbita, useProgresso, useRevelar } from './efeitos';
import '../../estilos/site.css';

const SEGMENTOS = ['🍕 Pizzarias', '🍔 Hamburguerias', '🍽️ Restaurantes', '🍺 Bares', '🍣 Comida japonesa', '🥩 Churrascarias', '🍨 Açaí e sorvetes', '☕ Cafeterias', '🥐 Padarias', '🍱 Marmitarias', '🥟 Pastelarias', '🍰 Docerias'];

const MODULOS: { icone: typeof QrCode; titulo: string; texto: string; classe?: string; visual?: ReactNode }[] = [
  { icone: QrCode, titulo: 'Cardápio digital na mesa', texto: 'O cliente escaneia o QR code ou usa o tablet da mesa, vê fotos e vídeos e pede sozinho. O garçom libera o celular com um toque.', classe: 'bento--alto', visual: <div className="bento__tela"><TelaCardapio compacto /></div> },
  { icone: Bike, titulo: 'Delivery com link próprio', texto: 'Entrega e retirada, taxa fixa, por bairro ou por distância, pedido mínimo e acompanhamento ao vivo para o cliente.', visual: <Rastreio /> },
  { icone: LayoutDashboard, titulo: 'Pedidos ao vivo', texto: 'Novos, em preparo, prontos. Som, aviso no canto da tela e tempo de espera em destaque.', classe: 'bento--largo', visual: <div className="bento__painel"><TelaPainel /></div> },
  { icone: Printer, titulo: 'Impressão automática', texto: 'A comanda sai sozinha na térmica da cozinha. Sem clicar, sem janela de impressão.' },
  { icone: ShoppingBasket, titulo: 'PDV de balcão', texto: 'Venda rápida no caixa, desconto, troco e várias formas de pagamento.' },
  { icone: Smartphone, titulo: 'App do garçom', texto: 'QR code de cada mesa, liberação do cliente, chamados e pedidos prontos para levar.' },
  { icone: TrendingUp, titulo: 'App do dono', texto: 'Vendas, meta do mês, lucro e aviso a cada venda, direto no seu celular.' },
  { icone: Rocket, titulo: 'Alavancar vendas', texto: 'Order bump: “Que tal levar junto?” com desconto e escassez, antes do carrinho. Ticket médio lá em cima.', classe: 'bento--destaque' },
  { icone: Wallet, titulo: 'Caixa e contas', texto: 'Abertura, retirada, fechamento e conta da mesa com forma de pagamento.' },
  { icone: Boxes, titulo: 'Estoque e compras', texto: 'Baixa automática a cada pedido, item esgotado na hora e lista de compras da equipe.' },
  { icone: BarChart3, titulo: 'Relatórios completos', texto: 'Itens mais vendidos, mesas e comandas, horários de pico, lucro por produto.' },
  { icone: Headset, titulo: 'Suporte com IA + time humano', texto: 'Assistente responde na hora dentro do sistema. Precisou? Uma pessoa do time assume.' },
  { icone: Globe, titulo: 'Sua marca, seu domínio', texto: 'suapizzaria.com.br, sua logo no menu e o sistema na cor que você escolher.' },
  { icone: FileText, titulo: 'Notas fiscais', texto: 'NFC-e e NF-e emitidas a partir do pedido, com certificado digital.' },
];

const FLUXO = [
  { icone: QrCode, titulo: 'Cliente escaneia', texto: 'O QR code da mesa abre o cardápio no celular dele.' },
  { icone: Smartphone, titulo: 'Garçom libera', texto: 'Um toque no app e a mesa pode pedir. Nada de pedido de casa.' },
  { icone: Sparkles, titulo: 'Oferta na hora certa', texto: 'Antes do carrinho, o order bump sugere o acompanhamento.' },
  { icone: Printer, titulo: 'Cozinha recebe', texto: 'Aparece no painel com som e sai impresso na térmica.' },
  { icone: ConciergeBell, titulo: 'Garçom leva', texto: 'Aviso de pedido pronto no celular do garçom.' },
  { icone: BellRing, titulo: 'Você vende', texto: 'Conta paga, notificação “Nova venda!” no app do dono.' },
];

const ANTES = ['Papelzinho e letra ilegível na cozinha', 'Cliente esperando para ser atendido', 'Pedido esquecido na correria', 'Sem saber o que mais vende', 'Ficar no restaurante para ver as vendas'];
const DEPOIS = ['Pedido digitado pelo próprio cliente', 'Cliente pede na hora, pelo celular', 'Tudo na tela, com som e impresso', 'Relatório de itens, horários e lucro', 'Vendas ao vivo no seu celular'];

const PERGUNTAS = [
  { p: 'Preciso comprar equipamento?', r: 'Não. Funciona no celular do cliente (QR code), em qualquer tablet, celular ou computador com navegador. Para imprimir, use a térmica USB que você já tem (58 ou 80 mm).' },
  { p: 'O cliente consegue pedir de casa pelo QR da mesa?', r: 'Não. Depois de escanear, o celular do cliente só pede quando a equipe libera, pelo painel ou pelo app do garçom. Ao fechar a conta, o acesso é encerrado.' },
  { p: 'Tem delivery próprio, sem comissão por pedido?', r: 'Sim. Você ganha um link do seu cardápio de delivery com taxa por bairro ou distância, retirada no balcão, pedido mínimo e acompanhamento do pedido.' },
  { p: 'O que é o order bump?', r: 'É a oferta que aparece logo depois que o cliente escolhe um item, antes do carrinho: “Que tal uma bebida gelada?”. Você escolhe onde aparece, o que oferecer e se tem desconto.' },
  { p: 'Como funciona o suporte?', r: 'Dentro do sistema tem um chat. Um assistente com inteligência artificial responde na hora e, se precisar, uma pessoa do nosso time assume a conversa.' },
  { p: 'Funciona no iPhone e no Android?', r: 'Sim. O app do dono e o app do garçom funcionam nos dois e mandam notificações. No computador do caixa, tem o programa para Windows.' },
  { p: 'Posso usar meu próprio domínio?', r: 'Sim, nos planos Premium e Rede: o cardápio abre em suapizzaria.com.br. Você também troca a logo e a cor do sistema.' },
  { p: 'Tem fidelidade?', r: 'Não. O plano é mensal e você cancela quando quiser.' },
];

/** Acompanhamento do pedido de delivery (o que o cliente vê). */
function Rastreio() {
  const etapas = [['Pedido recebido', '20:31'], ['Em preparo', '20:33'], ['Saiu para entrega', '20:52'], ['Entregue', '']];
  return (
    <div className="bento__rastreio">
      {etapas.map(([t, h], i) => (
        <div key={t} className={`bento__etapa${i < 2 ? ' feito' : i === 2 ? ' agora' : ''}`}>
          <i />
          <span>{t}</span>
          {h && <small>{h}</small>}
        </div>
      ))}
    </div>
  );
}

const ORBITA = [
  { icone: QrCode, t: 'QR na mesa' }, { icone: Bike, t: 'Delivery' }, { icone: Printer, t: 'Impressão' }, { icone: Smartphone, t: 'App garçom' },
  { icone: BarChart3, t: 'Relatórios' }, { icone: Rocket, t: 'Order bump' }, { icone: Wallet, t: 'Caixa' }, { icone: Headset, t: 'Suporte IA' },
  { icone: ShoppingBasket, t: 'PDV' }, { icone: Boxes, t: 'Estoque' }, { icone: Bell, t: 'App dono' }, { icone: Palette, t: 'Sua marca' },
];

/** Cartão que inclina em 3D com o mouse e tem um brilho que segue o cursor. */
function Tilt({ children, className = '', max = 8, style }: { children: ReactNode; className?: string; max?: number; style?: CSSProperties }) {
  const ref = useInclinar<HTMLDivElement>(max);
  return <div ref={ref} className={`tilt ${className}`} style={style}><div className="tilt__in">{children}<span className="tilt__brilho" aria-hidden="true" /></div></div>;
}

export default function Site() {
  const [menuAberto, setMenuAberto] = useState(false);
  const [rolou, setRolou] = useState(false);
  const programa = noProgramaWindows();
  const cena = useInclinar<HTMLDivElement>(9, 'janela');
  const orbita = useOrbita<HTMLDivElement>();
  const [fluxoRef, fluxo] = useProgresso<HTMLDivElement>();
  useRevelar();

  useEffect(() => {
    const r = () => setRolou(window.scrollY > 12);
    r();
    window.addEventListener('scroll', r, { passive: true });
    return () => window.removeEventListener('scroll', r);
  }, []);
  useEffect(() => {
    const t = document.title;
    document.title = 'BasilFiery · Sistema completo para restaurantes';
    return () => { document.title = t; };
  }, []);

  const contato = (msg?: string) => linkWhatsVendas(msg) ?? `mailto:${SITE.emailContato}?subject=${encodeURIComponent('Quero conhecer o BasilFiery')}`;

  return (
    <div className="sv">
      {/* ================= Navegação ================= */}
      <header className={`sv-nav${rolou ? ' sv-nav--rolou' : ''}`}>
        <div className="sv-nav__in">
          <Link to="/" className="sv-marca" aria-label="BasilFiery, início"><img src="/marca/logo-basilfiery.png" alt="Basil Fiery" /></Link>
          <nav className={`sv-nav__links${menuAberto ? ' aberto' : ''}`} onClick={() => setMenuAberto(false)}>
            <a href="#sistema">Sistema</a>
            <a href="#tour">Na prática</a>
            <a href="#como-funciona">Como funciona</a>
            <a href="#planos">Planos</a>
            <a href="#duvidas">Dúvidas</a>
            <Link to="/login" className="sv-nav__entrar-mobile">Entrar</Link>
          </nav>
          <div className="sv-nav__acoes">
            <Link to="/login" className="sv-btn sv-btn--fantasma sv-so-desktop">Entrar</Link>
            <a href="#planos" className="sv-btn sv-btn--vermelho">Começar agora <ArrowRight size={16} /></a>
            <button className="sv-nav__menu" onClick={() => setMenuAberto((v) => !v)} aria-label="Menu">{menuAberto ? <X size={22} /> : <Menu size={22} />}</button>
          </div>
        </div>
      </header>

      <main>
        {/* ================= Hero ================= */}
        <section className="sv-hero">
          <div className="sv-hero__fundo" aria-hidden="true"><div className="sv-hero__chao" /><div className="sv-hero__luz" /><div className="sv-hero__ruido" /></div>
          <div className="sv-hero__texto">
            <a href="#sistema" className="sv-novidade"><b>Novo</b> Order bump e suporte com IA <ArrowRight size={14} /></a>
            <h1>Do QR code na mesa à <em>venda</em> no seu celular.</h1>
            <p>Cardápio digital, delivery, PDV, pedidos ao vivo, impressão automática, app do garçom e app do dono. Tudo conectado, em tempo real, num só sistema.</p>
            <div className="sv-hero__ctas">
              <a href="#planos" className="sv-btn sv-btn--vermelho sv-btn--grande">Ver planos <ArrowRight size={18} /></a>
              <a href="#tour" className="sv-btn sv-btn--vidro sv-btn--grande">Ver na prática</a>
            </div>
            <ul className="sv-checks">
              <li><Check size={15} /> Sem fidelidade</li>
              <li><Check size={15} /> Implantação inclusa</li>
              <li><Check size={15} /> Funciona no que você já tem</li>
            </ul>
          </div>

          {/* Cena 3D: inclina com o mouse */}
          <div className="sv-cena" ref={cena} aria-hidden="true">
            <div className="sv-cena__grupo">
              <div className="sv-cena__tablet sv-device sv-device--tablet"><TelaCardapio comOferta /></div>
              <div className="sv-cena__celular sv-device sv-device--celular"><TelaDono /></div>
              <div className="sv-cena__notif"><Notificacao titulo="Nova venda! R$ 127,80" texto="Mesa 7 · conta paga" /></div>
              <div className="sv-cena__cupom"><Cupom /></div>
              <div className="sv-cena__chip"><QrCode size={14} /> Mesa 4 liberada</div>
              <div className="sv-cena__sombra" />
            </div>
          </div>
          <a href="#sistema" className="sv-hero__descer" aria-label="Ver mais"><ChevronDown size={20} /></a>
        </section>

        {/* ================= Segmentos ================= */}
        <section className="sv-faixa" aria-label="Para quem é">
          <div className="sv-faixa__trilho">
            {[...SEGMENTOS, ...SEGMENTOS].map((s, i) => <span key={i}>{s}</span>)}
          </div>
        </section>

        {/* ================= Sistema (bento) ================= */}
        <section className="sv-secao" id="sistema">
          <div className="sv-cab" data-revelar>
            <span className="sv-etiqueta">Um sistema. Tudo conectado.</span>
            <h2>Tudo que o seu restaurante precisa, <em>sem colar sistemas</em>.</h2>
            <p>Do salão ao delivery, do caixa ao seu celular. Cada parte conversa com a outra, ao vivo.</p>
          </div>
          <div className="sv-bento">
            {MODULOS.map((m, i) => (
              <Tilt key={m.titulo} className={`bento ${m.classe ?? ''}`} max={5} style={{ '--i': i } as CSSProperties}>
                <div className="bento__cab" data-revelar>
                  <span className="bento__icone"><m.icone size={20} /></span>
                  <h3>{m.titulo}</h3>
                  <p>{m.texto}</p>
                </div>
                {m.visual}
              </Tilt>
            ))}
          </div>
        </section>

        {/* ================= Na prática ================= */}
        <section className="sv-secao sv-tour" id="tour">
          <div className="sv-cab" data-revelar>
            <span className="sv-etiqueta">Na prática</span>
            <h2>Feito para a correria de verdade.</h2>
          </div>

          <div className="sv-linha" data-revelar>
            <div className="sv-linha__texto">
              <span className="sv-numero">01</span>
              <h3>O cardápio que <em>vende sozinho</em>.</h3>
              <p>Fotos, vídeos e adicionais em etapas, como meio a meio e borda. E, antes do carrinho, a oferta certa: “Que tal levar junto?”.</p>
              <ul className="sv-lista">
                <li><Check size={16} /> QR code na mesa ou tablet fixo</li>
                <li><Check size={16} /> Esgotados em cinza ou escondidos</li>
                <li><Check size={16} /> Order bump com desconto e escassez</li>
                <li><Check size={16} /> Mesmo cardápio no delivery</li>
              </ul>
            </div>
            <Tilt className="sv-linha__visual" max={12}>
              <div className="sv-device sv-device--celular sv-device--grande"><TelaCardapio comOferta /></div>
              <div className="sv-flutua sv-flutua--a"><Sparkles size={14} /> +1 item no pedido</div>
            </Tilt>
          </div>

          <div className="sv-linha sv-linha--inverte" data-revelar>
            <div className="sv-linha__texto">
              <span className="sv-numero">02</span>
              <h3>A cozinha recebe <em>na hora</em>.</h3>
              <p>O pedido entra no painel com som e já sai impresso na térmica. Nada de papelzinho, nada de pedido esquecido.</p>
              <ul className="sv-lista">
                <li><Check size={16} /> Pedidos ao vivo em colunas</li>
                <li><Check size={16} /> Impressão automática da cozinha e da conta</li>
                <li><Check size={16} /> Programa para Windows que abre sozinho</li>
                <li><Check size={16} /> PDV de balcão no mesmo lugar</li>
              </ul>
            </div>
            <Tilt className="sv-linha__visual" max={10}>
              <div className="sv-device sv-device--tela"><TelaPainel /></div>
              <div className="sv-linha__cupom"><Cupom /></div>
            </Tilt>
          </div>

          <div className="sv-linha" data-revelar>
            <div className="sv-linha__texto">
              <span className="sv-numero">03</span>
              <h3>O garçom <em>no controle</em> da mesa.</h3>
              <p>Tocou na mesa, apareceu o QR code. O cliente escaneia e o garçom libera ali mesmo. Chamados como “limpar a mesa” chegam no celular.</p>
              <ul className="sv-lista">
                <li><Check size={16} /> Libera o celular do cliente com um toque</li>
                <li><Check size={16} /> Pedidos prontos para levar</li>
                <li><Check size={16} /> Chamados e pedido de conta</li>
                <li><Check size={16} /> Desafios para motivar a equipe</li>
              </ul>
            </div>
            <Tilt className="sv-linha__visual" max={12}>
              <div className="sv-device sv-device--celular sv-device--grande"><TelaGarcom /></div>
              <div className="sv-flutua sv-flutua--b"><Bell size={14} /> Mesa 2 pediu a conta</div>
            </Tilt>
          </div>

          <div className="sv-linha sv-linha--inverte" data-revelar>
            <div className="sv-linha__texto">
              <span className="sv-numero">04</span>
              <h3>Você acompanha <em>de onde estiver</em>.</h3>
              <p>Vendas ao vivo, meta do mês e lucro no app do dono. A cada conta paga, uma notificação no seu celular.</p>
              <ul className="sv-lista">
                <li><Check size={16} /> Vendas e ticket médio em tempo real</li>
                <li><Check size={16} /> Meta do mês e comparação com ontem</li>
                <li><Check size={16} /> Relatórios de itens, mesas e horários</li>
                <li><Check size={16} /> iPhone e Android</li>
              </ul>
            </div>
            <Tilt className="sv-linha__visual" max={12}>
              <div className="sv-device sv-device--celular sv-device--grande"><TelaDono /></div>
              <div className="sv-linha__notif"><Notificacao titulo="Nova venda! R$ 84,90" texto="Delivery #144 entregue" /></div>
            </Tilt>
          </div>
        </section>

        {/* ================= Como funciona ================= */}
        <section className="sv-secao" id="como-funciona">
          <div className="sv-cab" data-revelar>
            <span className="sv-etiqueta">Como funciona</span>
            <h2>Da mesa ao seu bolso em <em>6 passos</em>.</h2>
          </div>
          <div className="sv-fluxo" ref={fluxoRef} style={{ '--p': fluxo } as CSSProperties}>
            <div className="sv-fluxo__linha"><i /></div>
            {FLUXO.map((f, i) => (
              <div key={f.titulo} className={`sv-fluxo__passo${fluxo * FLUXO.length > i + 0.2 ? ' ativo' : ''}`}>
                <span className="sv-fluxo__icone"><f.icone size={20} /></span>
                <small>Passo {i + 1}</small>
                <b>{f.titulo}</b>
                <p>{f.texto}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= Antes x depois ================= */}
        <section className="sv-secao" aria-label="Antes e depois">
          <div className="sv-compara" data-revelar>
            <div className="sv-compara__lado">
              <h3>Sem o BasilFiery</h3>
              <ul>{ANTES.map((a) => <li key={a}><X size={16} /> {a}</li>)}</ul>
            </div>
            <div className="sv-compara__lado sv-compara__lado--sim">
              <h3><Flame size={18} /> Com o BasilFiery</h3>
              <ul>{DEPOIS.map((a) => <li key={a}><Check size={16} /> {a}</li>)}</ul>
            </div>
          </div>
        </section>

        {/* ================= Planos ================= */}
        <section className="sv-secao" id="planos">
          <div className="sv-cab" data-revelar>
            <span className="sv-etiqueta">Planos</span>
            <h2>Escolha o tamanho da <em>sua casa</em>.</h2>
            <p>Implantação inclusa: cadastramos seu cardápio e deixamos tudo funcionando com você. Sem fidelidade.</p>
          </div>
          <div className="sv-planos">
            {SITE.planos.map((p) => (
              <Tilt key={p.nome} className={`sv-plano${p.destaque ? ' sv-plano--destaque' : ''}`} max={p.destaque ? 7 : 5}>
                {p.destaque && <span className="sv-plano__selo"><Zap size={12} /> Mais escolhido</span>}
                <h3>{p.nome}</h3>
                <p className="sv-plano__desc">{p.descricao}</p>
                <p className="sv-plano__preco"><strong>{p.preco}</strong><span>{p.periodo}</span></p>
                <a className={`sv-btn sv-btn--bloco ${p.destaque ? 'sv-btn--vermelho' : 'sv-btn--vidro'}`} href={p.checkout || contato(`Olá! Tenho interesse no plano ${p.nome} do BasilFiery.`)} target="_blank" rel="noopener">
                  {p.checkout ? `Assinar o ${p.nome}` : `Quero o ${p.nome}`} <ArrowRight size={16} />
                </a>
                <ul>{p.itens.map((i) => <li key={i}><Check size={15} /> {i}</li>)}</ul>
              </Tilt>
            ))}
          </div>
          <p className="sv-planos__ja">Já assinou? <Link to="/ativar">Crie seu acesso aqui</Link> com o e-mail e o CPF/CNPJ do pagamento.</p>
        </section>

        {/* ================= Órbita 3D + chamada ================= */}
        <section className="sv-final">
          <div className="sv-orbita" ref={orbita} aria-label="Tudo o que vem no sistema (arraste para girar)">
            <div className="sv-orbita__palco">
            <div className="sv-orbita__trilha" />
            <div className="sv-orbita__nucleo"><img src="/marca/pizza-icone.png" alt="" /></div>
            <div className="sv-orbita__anel">
              {ORBITA.map((o, i) => (
                <span key={o.t} className="sv-orbita__item" style={{ '--a': `${(360 / ORBITA.length) * i}deg` } as CSSProperties}>
                  <o.icone size={16} /> {o.t}
                </span>
              ))}
            </div>
            </div>
            <small className="sv-orbita__dica"><MousePointer2 size={13} /> Arraste para girar</small>
          </div>
          <div className="sv-final__texto" data-revelar>
            <h2>Seu restaurante merece um sistema <em>à altura</em>.</h2>
            <p>Cardápio, delivery, caixa, cozinha, equipe e números. Tudo num lugar só, com suporte de verdade.</p>
            <div className="sv-hero__ctas">
              <a href="#planos" className="sv-btn sv-btn--vermelho sv-btn--grande">Começar agora <ArrowRight size={18} /></a>
              <a href={contato()} target="_blank" rel="noopener" className="sv-btn sv-btn--vidro sv-btn--grande">Falar com a gente</a>
            </div>
          </div>
        </section>

        {/* ================= Windows ================= */}
        {!programa && (
          <section className="sv-secao" id="baixar">
            <div className="sv-windows" data-revelar>
              <span className="sv-windows__icone"><MonitorDown size={30} /></span>
              <div>
                <h3>Programa para o computador do caixa</h3>
                <p>Abre com o Windows, imprime direto na térmica sem janela de impressão e continua recebendo pedidos minimizado. Atualiza sozinho.</p>
              </div>
              <a className="sv-btn sv-btn--vermelho" href={SITE.downloadWindows}><Download size={17} /> Baixar para Windows</a>
            </div>
          </section>
        )}

        {/* ================= Dúvidas ================= */}
        <section className="sv-secao sv-secao--estreita" id="duvidas">
          <div className="sv-cab" data-revelar>
            <span className="sv-etiqueta">Dúvidas</span>
            <h2>Perguntas <em>frequentes</em>.</h2>
          </div>
          <div className="sv-faq">
            {PERGUNTAS.map((q) => (
              <details key={q.p}>
                <summary>{q.p}<ChevronDown size={18} /></summary>
                <p>{q.r}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="sv-rodape">
        <div className="sv-rodape__in">
          <div>
            <Link to="/" className="sv-marca sv-marca--rodape"><img src="/marca/logo-basilfiery.png" alt="Basil Fiery" /></Link>
            <p>Sistema completo para restaurantes: cardápio digital, delivery, PDV, cozinha, equipe e números.</p>
          </div>
          <nav>
            <b>Produto</b>
            <a href="#sistema">Sistema</a>
            <a href="#tour">Na prática</a>
            <a href="#planos">Planos</a>
            {!programa && <a href={SITE.downloadWindows}>Baixar para Windows</a>}
          </nav>
          <nav>
            <b>Clientes</b>
            <Link to="/login">Entrar</Link>
            <Link to="/ativar">Criar meu acesso</Link>
            <Link to="/appgarcom">App do garçom</Link>
            <Link to="/dono">App do dono</Link>
          </nav>
          <nav>
            <b>Legal</b>
            <Link to="/termos">Termos de uso</Link>
            <Link to="/privacidade">Privacidade</Link>
            <a href={`mailto:${SITE.emailContato}`}>{SITE.emailContato}</a>
          </nav>
        </div>
        <small className="sv-rodape__copy"><ShieldCheck size={13} /> © {new Date().getFullYear()} {SITE.marca}. Todos os direitos reservados.</small>
      </footer>
    </div>
  );
}
