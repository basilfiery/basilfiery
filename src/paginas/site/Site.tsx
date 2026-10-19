import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, Boxes, Check, ChefHat, ConciergeBell, Flame, LayoutDashboard, Menu, MessageCircle, Printer, ShieldCheck, Smartphone, Tablet, X } from 'lucide-react';
import { Logo } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { SITE, linkWhatsVendas } from '../../config/site';
import '../../estilos/site.css';

const PASSOS = [
  { icone: Tablet, titulo: 'O cliente pede no tablet', texto: 'Cardápio com fotos na mesa. Ele escolhe, ajusta observações e envia, sem esperar ninguém.' },
  { icone: Printer, titulo: 'O caixa recebe e imprime', texto: 'O pedido aparece na hora no painel do balcão e sai impresso na térmica para a cozinha.' },
  { icone: BellRing, titulo: 'O garçom é avisado', texto: 'Notificação no celular quando chega pedido, quando fica pronto e quando a mesa chama.' },
  { icone: ConciergeBell, titulo: 'Leva à mesa e fecha a conta', texto: 'O garçom entrega, marca como entregue e o caixa fecha a conta da mesa com um toque.' },
];

const RECURSOS = [
  { icone: Tablet, titulo: 'Cardápio no tablet', texto: 'Categorias, fotos, selos de vegetariano e picância, observações por item. Pensado para o dedo, não para o mouse.' },
  { icone: BellRing, titulo: 'Aviso no celular do garçom', texto: 'Notificações mesmo com a tela bloqueada, para pedido novo, pedido pronto, "chamar garçom" e "pedir a conta".' },
  { icone: Printer, titulo: 'Impressão automática', texto: 'Funciona com a impressora térmica USB que você já tem (58 ou 80 mm). O pedido sai sozinho, sem clicar.' },
  { icone: LayoutDashboard, titulo: 'Painel do caixa ao vivo', texto: 'Pedidos em colunas: novos, em preparo e prontos. Tempo de espera em destaque para nada atrasar.' },
  { icone: Boxes, titulo: 'Controle de estoque', texto: 'Cada pedido dá baixa automática. Acabou? O item aparece como esgotado no tablet na mesma hora.' },
  { icone: ShieldCheck, titulo: 'Equipe com permissões', texto: 'Dono, gerente, caixa e garçom, cada um com seu login e só o que precisa ver.' },
  { icone: Smartphone, titulo: 'Funciona em qualquer aparelho', texto: 'Tablet, celular ou computador, direto no navegador. Nada para instalar no caixa.' },
  { icone: ChefHat, titulo: 'Menos erro na cozinha', texto: 'O pedido chega escrito pelo próprio cliente, com observações. Sem papelzinho e sem letra ilegível.' },
];

const PERGUNTAS = [
  { p: 'Preciso comprar um tablet específico?', r: 'Não. Qualquer tablet Android ou iPad com navegador atualizado funciona. Recomendamos 10 polegadas e um suporte de mesa.' },
  { p: 'Qual impressora eu preciso?', r: 'Uma impressora térmica não fiscal (58 ou 80 mm) ligada por USB ao computador do caixa: Epson, Elgin, Bematech e similares.' },
  { p: 'Funciona sem internet?', r: 'O sistema precisa de Wi-Fi no salão. Se a conexão cair, o tablet avisa e os pedidos voltam a fluir assim que ela volta.' },
  { p: 'E se o cliente pedir algo que acabou?', r: 'Com o controle de estoque ligado, o item aparece como esgotado no tablet assim que zera. Nada de vender o que não tem.' },
  { p: 'O garçom precisa instalar algum app?', r: 'Não. Ele entra pelo navegador do celular e ativa as notificações. No iPhone basta adicionar o site à Tela de Início.' },
  { p: 'Tem fidelidade?', r: 'Não. O plano é mensal e você pode cancelar quando quiser.' },
];

export default function Site() {
  const toast = useToast();
  const [menuAberto, setMenuAberto] = useState(false);
  const whats = linkWhatsVendas();

  const aoContratar = (e: MouseEvent) => {
    if (!whats) {
      e.preventDefault();
      toast('Configure o WhatsApp de vendas em src/config/site.ts', 'info');
    }
  };

  const BotaoContratar = ({ texto = 'Quero contratar', grande = false }: { texto?: string; grande?: boolean }) => (
    <a className={`btn btn--primario ${grande ? 'btn--lg' : ''}`} href={whats ?? '#'} target="_blank" rel="noopener" onClick={aoContratar}>
      <MessageCircle size={18} /> {texto}
    </a>
  );

  return (
    <div className="site">
      <header className="site-nav">
        <div className="site-nav__inner">
          <Link to="/" aria-label="BasilFiery, início"><Logo /></Link>
          <nav className={`site-nav__links ${menuAberto ? 'aberto' : ''}`} onClick={() => setMenuAberto(false)}>
            <a href="#como-funciona">Como funciona</a>
            <a href="#recursos">Recursos</a>
            <a href="#planos">Planos</a>
            <a href="#perguntas">Dúvidas</a>
          </nav>
          <div className="site-nav__acoes">
            <Link to="/login" className="btn btn--contorno btn--sm">Entrar</Link>
            <span className="so-desktop"><BotaoContratar /></span>
            <button className="icone-btn so-mobile" onClick={() => setMenuAberto((v) => !v)} aria-label="Menu">
              {menuAberto ? <X /> : <Menu />}
            </button>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="hero">
          <div className="hero__texto">
            <span className="etiqueta"><Flame size={14} /> Cardápio digital para restaurantes</span>
            <h1 className="titulo">O pedido sai da mesa e chega na cozinha <em>sozinho</em>.</h1>
            <p>
              Tablet na mesa para o cliente pedir, impressão automática no caixa e aviso no celular do garçom.
              Menos espera, menos erro e mais giro de mesa.
            </p>
            <div className="hero__ctas">
              <BotaoContratar texto="Falar com a gente" grande />
              <a href="#como-funciona" className="btn btn--contorno btn--lg">Ver como funciona</a>
            </div>
            <ul className="hero__checks">
              <li><Check size={16} /> Sem instalar nada</li>
              <li><Check size={16} /> Usa a impressora que você já tem</li>
              <li><Check size={16} /> Sem fidelidade</li>
            </ul>
          </div>

          <div className="hero__visual" aria-hidden="true">
            <div className="tablet">
              <div className="tablet__tela">
                <div className="tm-topo">
                  <span className="tm-logo">R</span>
                  <div><b>Restaurante Demo</b><small>Mesa 7</small></div>
                  <span className="tm-btn"><ConciergeBell size={13} /> Chamar garçom</span>
                </div>
                <div className="tm-corpo">
                  <div className="tm-cats">
                    <span className="ativo">🍕 Pizzas</span><span>🍝 Massas</span><span>🍰 Doces</span><span>🥤 Bebidas</span>
                  </div>
                  <div className="tm-grade">
                    {[['🍕', 'Margherita', '69,90'], ['🌶️', 'Diavola', '79,90'], ['🔥', 'Fiery', '84,90'], ['🧀', '4 Queijos', '76,90']].map(([e, n, p]) => (
                      <div className="tm-prod" key={n}><div className="tm-foto">{e}</div><b>{n}</b><span>R$ {p}</span></div>
                    ))}
                  </div>
                  <div className="tm-carrinho">
                    <b>Seu pedido</b>
                    <div className="tm-linha"><span>1× Margherita</span><span>69,90</span></div>
                    <div className="tm-linha"><span>2× Limonada</span><span>29,80</span></div>
                    <div className="tm-total"><span>Total</span><span>R$ 99,70</span></div>
                    <span className="tm-enviar">Enviar pedido</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="flutua flutua--celular">
              <BellRing size={18} />
              <div><b>Novo pedido #42 · Mesa 7</b><small>Total R$ 99,70</small></div>
            </div>
            <div className="flutua flutua--cupom">
              <b>PEDIDO #42</b>
              <span>MESA 7</span>
              <hr />
              <span>1x Margherita</span>
              <span>2x Limonada</span>
            </div>
          </div>
        </section>

        {/* ---------- Como funciona ---------- */}
        <section className="secao" id="como-funciona">
          <div className="secao__cab">
            <span className="etiqueta">Como funciona</span>
            <h2 className="titulo">Do toque na mesa ao prato na mesa</h2>
          </div>
          <ol className="passos">
            {PASSOS.map((p, i) => (
              <li key={p.titulo} className="passo">
                <span className="passo__num">{i + 1}</span>
                <p.icone size={28} className="passo__icone" />
                <h3>{p.titulo}</h3>
                <p>{p.texto}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Recursos ---------- */}
        <section className="secao" id="recursos">
          <div className="secao__cab">
            <span className="etiqueta">Recursos</span>
            <h2 className="titulo">Tudo o que o salão precisa, em um só sistema</h2>
          </div>
          <div className="recursos">
            {RECURSOS.map((r) => (
              <article key={r.titulo} className="recurso">
                <span className="recurso__icone"><r.icone size={22} /></span>
                <h3>{r.titulo}</h3>
                <p>{r.texto}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- Planos ---------- */}
        <section className="secao" id="planos">
          <div className="secao__cab">
            <span className="etiqueta">Planos</span>
            <h2 className="titulo">Escolha o tamanho da sua casa</h2>
            <p>Implantação inclusa: cadastramos seu cardápio e deixamos tudo funcionando com você.</p>
          </div>
          <div className="planos">
            {SITE.planos.map((p) => (
              <article key={p.nome} className={`plano ${p.destaque ? 'plano--destaque' : ''}`}>
                {p.destaque && <span className="plano__selo">Mais escolhido</span>}
                <h3>{p.nome}</h3>
                <p className="plano__desc">{p.descricao}</p>
                <p className="plano__preco"><strong>{p.preco}</strong><span>{p.periodo}</span></p>
                <ul>
                  {p.itens.map((i) => <li key={i}><Check size={16} /> {i}</li>)}
                </ul>
                <a
                  className={`btn btn--bloco ${p.destaque ? 'btn--primario' : 'btn--contorno'}`}
                  href={linkWhatsVendas(`Olá! Tenho interesse no plano ${p.nome} do BasilFiery.`) ?? '#'}
                  target="_blank" rel="noopener" onClick={aoContratar}
                >
                  Quero o {p.nome}
                </a>
              </article>
            ))}
          </div>
        </section>

        {/* ---------- Perguntas ---------- */}
        <section className="secao secao--estreita" id="perguntas">
          <div className="secao__cab">
            <span className="etiqueta">Dúvidas</span>
            <h2 className="titulo">Perguntas frequentes</h2>
          </div>
          <div className="faq">
            {PERGUNTAS.map((q) => (
              <details key={q.p}>
                <summary>{q.p}</summary>
                <p>{q.r}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- CTA final ---------- */}
        <section className="cta-final">
          <h2 className="titulo">Bora colocar o seu cardápio na mesa?</h2>
          <p>Fale com a gente pelo WhatsApp e veja o sistema funcionando com o seu cardápio.</p>
          <BotaoContratar texto="Chamar no WhatsApp" grande />
        </section>
      </main>

      <footer className="site-rodape">
        <Logo tamanho="sm" />
        <nav>
          <a href="#recursos">Recursos</a>
          <a href="#planos">Planos</a>
          <Link to="/login">Área do cliente</Link>
          <Link to="/termos">Termos de uso</Link>
          <Link to="/privacidade">Privacidade</Link>
        </nav>
        <small>© {new Date().getFullYear()} {SITE.marca}. Todos os direitos reservados.</small>
      </footer>
    </div>
  );
}
