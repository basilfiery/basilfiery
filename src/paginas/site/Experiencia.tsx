/*
 * Abertura interativa do site: a pizza (recortada, solta na página) atravessa as cenas conforme a rolagem.
 * Ingredientes flutuam, formam um anel, a pizza explode em fatias, painéis deslizam e a história termina no celular do dono.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, BellRing, Check, Printer, QrCode } from 'lucide-react';
import { Cupom, Notificacao, TelaDono } from './Mockups';
import '../../estilos/experiencia.css';

gsap.registerPlugin(ScrollTrigger);

/** Ingredientes em volta da pizza: posição na "nuvem" inicial (em tamanhos de pizza), tamanho e giro. */
const INGS = [
  { n: 'ramo', s: 0.32, x: -0.5, y: -0.56, r: -20 },
  { n: 'folha1', s: 0.19, x: 0.6, y: -0.52, r: 35 },
  { n: 'tomate1', s: 0.23, x: 0.76, y: -0.06, r: 10 },
  { n: 'cogu3', s: 0.17, x: 0.74, y: 0.36, r: -40 },
  { n: 'folha3', s: 0.15, x: 0.42, y: 0.7, r: 130 },
  { n: 'tomate4', s: 0.15, x: 0.06, y: 0.8, r: -30 },
  { n: 'cogu4', s: 0.15, x: -0.32, y: 0.74, r: 15 },
  { n: 'tomate2', s: 0.24, x: -0.5, y: 0.62, r: -15 },
  { n: 'folha2', s: 0.17, x: -0.6, y: 0.3, r: -60 },
  { n: 'tomate3', s: 0.17, x: -0.62, y: -0.2, r: 40 },
  { n: 'cogu2', s: 0.16, x: -0.26, y: -0.78, r: 30 },
  { n: 'folha4', s: 0.14, x: 0.12, y: -0.8, r: 80 },
  { n: 'cogu1', s: 0.17, x: 0.42, y: -0.76, r: -25 },
];

/** Centro real da pizza na foto (os cortes partem daqui). */
const CX = 47.8, CY = 47.3;
const N_FATIAS = 8;
const fatia = (i: number) => {
  const a0 = 2 + i * (360 / N_FATIAS);
  const P = (t: number) => { const r = (t * Math.PI) / 180; return `${(CX + 75 * Math.sin(r)).toFixed(2)}% ${(CY - 75 * Math.cos(r)).toFixed(2)}%`; };
  const meio = a0 + 180 / N_FATIAS;
  return { clip: `polygon(${CX}% ${CY}%, ${P(a0)}, ${P(meio)}, ${P(a0 + 360 / N_FATIAS)})`, ang: (meio * Math.PI) / 180 };
};
const FATIAS = Array.from({ length: N_FATIAS }, (_, i) => fatia(i));

const CENAS = ['Início', 'Cardápio', 'Pedido certo', 'Cozinha', 'Seu celular'];

export function Experiencia() {
  const raiz = useRef<HTMLElement>(null);
  const valor = useRef<HTMLElement>(null);
  const [cena, setCena] = useState(0);

  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const mm = gsap.matchMedia();

    mm.add({ pc: '(min-width: 861px)', cel: '(max-width: 860px)' }, (ctx) => {
      const pc = !!ctx.conditions?.pc;
      const S = () => (q('.xp__obj')[0] as HTMLElement).offsetWidth;
      const vw = (v: number) => () => (window.innerWidth * v) / 100;
      const vh = (v: number) => () => (window.innerHeight * v) / 100;
      // Onde a pizza fica em cada cena
      const L = pc
        ? { a: [24, 4, 1], b: [0, 1, 0.74], c: [21, 2, 0.96], d: [35, 33, 0.62], e: [25, 2, 1.12] }
        : { a: [0, -15, 1], b: [0, -8, 0.8], c: [0, -14, 0.98], d: [-30, 31, 0.62], e: [10, -12, 1.1] };

      const ings = q('.xp__ing') as HTMLElement[];
      const fatias = q('.xp__fatia') as HTMLElement[];
      gsap.set(q('.xp__obj'), { x: vw(L.a[0]), y: vh(L.a[1]), scale: L.a[2] });
      const nuvem = pc ? 1 : 0.8;
      ings.forEach((g, i) => gsap.set(g, { x: () => INGS[i].x * S() * nuvem, y: () => INGS[i].y * S() * nuvem, rotation: INGS[i].r }));
      gsap.set(q('.xp__painel'), { clipPath: 'inset(100% 0% 0% 0%)' });
      gsap.set(q('.xp__cel'), { y: () => window.innerHeight, rotation: pc ? 8 : 4 });
      gsap.set(q('.xp__notif'), { autoAlpha: 0, y: 30, scale: 0.92 });
      gsap.set(q('.xp__t2, .xp__t3, .xp__t5'), { autoAlpha: 0 });
      gsap.set(q('.xp__t2 .xp__gigante span'), { yPercent: 110 });
      gsap.set(q('.xp__t3 > *, .xp__t5 > *'), { y: 50, autoAlpha: 0 });
      gsap.set(q('.xp__t4 > *'), { y: 60, autoAlpha: 0 });
      gsap.set(q('.xp__cupom'), { yPercent: -105 });

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut', duration: 1 },
        scrollTrigger: {
          trigger: el, start: 'top top', end: '+=620%', scrub: 1, pin: q('.xp__palco')[0], anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: (st) => setCena(Math.min(CENAS.length - 1, Math.round(st.progress * (CENAS.length - 1)))),
        },
      });

      // ---- 1 → 2: o texto sai, a pizza vai ao centro e os ingredientes formam um anel girando
      tl.to(q('.xp__t1 > *'), { y: -90, autoAlpha: 0, stagger: 0.04, duration: 0.5, ease: 'power2.in' }, 0)
        .set(q('.xp__t1'), { autoAlpha: 0 }, 0.75)
        .to(q('.xp__obj'), { x: vw(L.b[0]), y: vh(L.b[1]), scale: L.b[2] }, 0)
        .to(q('.xp__pizza'), { rotation: 140 }, 0)
        .to(q('.xp__anel'), { rotation: 100, duration: 2, ease: 'none' }, 0);
      ings.forEach((g, i) => {
        const a = (i / ings.length) * Math.PI * 2;
        tl.to(g, { x: () => Math.sin(a) * S() * 0.8, y: () => -Math.cos(a) * S() * 0.8, rotation: INGS[i].r + 200, scale: 0.9 }, 0);
      });
      tl.set(q('.xp__t2'), { autoAlpha: 1 }, 0.35)
        .to(q('.xp__t2 .xp__gigante span'), { yPercent: 0, stagger: 0.08, duration: 0.6, ease: 'power3.out' }, 0.4)
        .from(q('.xp__t2 .xp__legenda'), { y: 40, autoAlpha: 0, duration: 0.5 }, 0.6);

      // ---- 2 → 3: a pizza explode em fatias, os ingredientes voam para longe
      tl.to(q('.xp__t2 .xp__gigante span'), { yPercent: -110, stagger: 0.05, duration: 0.5, ease: 'power2.in' }, 1.05)
        .to(q('.xp__t2 .xp__legenda'), { y: -30, autoAlpha: 0, duration: 0.4 }, 1.05)
        .to(q('.xp__obj'), { x: vw(L.c[0]), y: vh(L.c[1]), scale: L.c[2] }, 1)
        .to(q('.xp__pizza'), { rotation: 210 }, 1);
      ings.forEach((g, i) => {
        const a = (i / ings.length) * Math.PI * 2 + 0.6;
        tl.to(g, { x: () => Math.sin(a) * S() * 1.9, y: () => -Math.cos(a) * S() * 1.9, rotation: '+=160', scale: 1.4, autoAlpha: 0, duration: 0.9, ease: 'power2.in' }, 1.05);
      });
      fatias.forEach((f, i) => {
        tl.to(f, { x: () => Math.sin(FATIAS[i].ang) * S() * 0.17, y: () => -Math.cos(FATIAS[i].ang) * S() * 0.17, rotation: (i % 2 ? 1 : -1) * 7, duration: 0.8, ease: 'power3.out' }, 1.15);
      });
      tl.set(q('.xp__t3'), { autoAlpha: 1 }, 1.3)
        .to(q('.xp__t3 > *'), { y: 0, autoAlpha: 1, stagger: 0.07, duration: 0.5, ease: 'power3.out' }, 1.35);

      // ---- 3 → 4: as fatias se juntam, o painel claro sobe e a pizza atravessa a borda dele
      tl.to(q('.xp__t3 > *'), { y: -50, autoAlpha: 0, stagger: 0.04, duration: 0.4, ease: 'power2.in' }, 2.05)
        .set(q('.xp__t3'), { autoAlpha: 0 }, 2.5)
        .to(fatias, { x: 0, y: 0, rotation: 0, duration: 0.6, ease: 'power3.inOut' }, 2.05)
        .to(q('.xp__painel'), { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.9, ease: 'power3.inOut' }, 2.1)
        .to(q('.xp__obj'), { x: vw(L.d[0]), y: vh(L.d[1]), scale: L.d[2] }, 2.05)
        .to(q('.xp__pizza'), { rotation: 320 }, 2.05)
        .to(q('.xp__t4 > *'), { y: 0, autoAlpha: 1, stagger: 0.07, duration: 0.5, ease: 'power3.out' }, 2.6)
        .to(q('.xp__cupom'), { yPercent: 0, duration: 0.8, ease: 'power1.out' }, 2.7);

      // ---- 4 → 5: o painel sai por cima, o celular sobe e as vendas chegam
      tl.to(q('.xp__t4 > *'), { y: -40, autoAlpha: 0, stagger: 0.03, duration: 0.35 }, 3.15)
        .to(q('.xp__painel'), { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.8, ease: 'power3.inOut' }, 3.2)
        .to(q('.xp__obj'), { x: vw(L.e[0]), y: vh(L.e[1]), scale: L.e[2] }, 3.1)
        .set(q('.xp__obj'), { zIndex: 2 }, 3.45)
        .to(q('.xp__pizza'), { rotation: 420 }, 3.1)
        .to(q('.xp__giro'), { opacity: 0.38 }, 3.1)
        .to(q('.xp__cel'), { y: 0, rotation: pc ? -4 : 0, duration: 1, ease: 'power3.out' }, 3.35)
        .set(q('.xp__t5'), { autoAlpha: 1 }, 3.5)
        .to(q('.xp__t5 > *'), { y: 0, autoAlpha: 1, stagger: 0.07, duration: 0.5, ease: 'power3.out' }, 3.55)
        .to(q('.xp__notif'), { autoAlpha: 1, y: 0, scale: 1, stagger: 0.22, duration: 0.4, ease: 'back.out(1.6)' }, 3.9);
      const conta = { v: 0 };
      tl.to(conta, {
        v: 128430.9, duration: 0.9, ease: 'power1.out',
        onUpdate: () => { if (valor.current) valor.current.textContent = conta.v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      }, 3.7);
      // Letreiro gigante do fundo anda durante toda a história
      tl.fromTo(q('.xp__letreiro'), { xPercent: 0 }, { xPercent: -38, duration: 4.6, ease: 'none' }, 0);
      tl.to({}, { duration: 0.4 }, 4.6); // respiro no final antes de soltar a página
    });

    // Ingredientes acompanham o mouse (profundidade) no computador
    const palco = q('.xp__palco')[0] as HTMLElement;
    const mover = (e: PointerEvent) => {
      palco.style.setProperty('--mx', ((e.clientX / window.innerWidth) - 0.5).toFixed(3));
      palco.style.setProperty('--my', ((e.clientY / window.innerHeight) - 0.5).toFixed(3));
    };
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) window.addEventListener('pointermove', mover);
    return () => { mm.revert(); window.removeEventListener('pointermove', mover); };
  }, []);

  const irPara = (i: number) => {
    const st = ScrollTrigger.getAll().find((s) => s.trigger === raiz.current);
    if (st) window.scrollTo({ top: st.start + (st.end - st.start) * (i / (CENAS.length - 1)) + 2, behavior: 'smooth' });
  };

  return (
    <section className="xp" ref={raiz} aria-label="Apresentação do BasilFiery">
      <div className="xp__palco">
        <div className="xp__fundo" aria-hidden="true"><i /><b /></div>
        <div className="xp__letreiro" aria-hidden="true">PIZZA · CARDÁPIO · PEDIDO · COZINHA · VENDA · PIZZA · CARDÁPIO · PEDIDO ·</div>

        {/* Painel claro da cozinha (desliza por cima do escuro) */}
        <div className="xp__painel">
          <div className="xp__t4">
            <span className="xp__etiqueta">03 · Na cozinha</span>
            <h2 className="xp__titulo">A comanda<br /><em>sai na hora.</em></h2>
            <p>O pedido entra no painel com som e já sai impresso na térmica. Sem clicar, sem papelzinho, sem pedido esquecido.</p>
            <ul className="xp__lista">
              <li><Printer size={16} /> Impressão automática da cozinha e da conta</li>
              <li><Check size={16} /> Pedidos ao vivo em colunas</li>
            </ul>
          </div>
          <div className="xp__impressora" aria-hidden="true">
            <div className="xp__fenda" />
            <div className="xp__papel"><div className="xp__cupom"><Cupom /></div></div>
          </div>
          <span className="xp__numero" aria-hidden="true">03</span>
        </div>

        {/* Cena 1 */}
        <div className="xp__t1">
          <span className="xp__etiqueta">Para pizzarias e restaurantes</span>
          <h1 className="xp__titulo">Feito para<br />pizzarias<br /><em>que vendem.</em></h1>
          <p>Cardápio digital, pedidos, cozinha, caixa e delivery num só sistema. Do QR code na mesa à venda no seu celular.</p>
          <div className="xp__ctas">
            <a href="#planos" className="sv-btn sv-btn--vermelho sv-btn--grande">Ver planos <ArrowRight size={18} /></a>
            <a href="#sistema" className="sv-btn sv-btn--vidro sv-btn--grande">Ver o sistema</a>
          </div>
          <ul className="xp__checks"><li><Check size={15} /> Sem fidelidade</li><li><Check size={15} /> Implantação inclusa</li></ul>
        </div>

        {/* Cena 2: título gigante atrás da pizza */}
        <div className="xp__t2" aria-hidden="true">
          <div className="xp__gigante"><div><span>Um cardápio</span></div><div><span><em>que dá fome.</em></span></div></div>
          <p className="xp__legenda"><QrCode size={16} /> QR code na mesa ou tablet · fotos, vídeos e a oferta certa antes do carrinho</p>
        </div>

        {/* Cena 3 */}
        <div className="xp__t3">
          <span className="xp__etiqueta">02 · Do jeito do cliente</span>
          <h2 className="xp__titulo">Meio a meio,<br />borda e<br /><em>adicionais.</em></h2>
          <p>Em etapas, sem erro. O cliente monta a pizza dele e o pedido chega certinho na cozinha.</p>
        </div>

        {/* Cena 5 */}
        <div className="xp__t5">
          <span className="xp__etiqueta">04 · No seu bolso</span>
          <h2 className="xp__titulo">A venda chega<br /><em>no seu celular.</em></h2>
          <p>Conta paga, notificação no app do dono. Vendas, meta do mês e lucro ao vivo, de onde você estiver.</p>
          <div className="xp__ctas">
            <a href="#planos" className="sv-btn sv-btn--vermelho sv-btn--grande">Começar agora <ArrowRight size={18} /></a>
            <a href="#sistema" className="sv-btn sv-btn--vidro sv-btn--grande">Ver tudo</a>
          </div>
        </div>
        <div className="xp__cel" aria-hidden="true">
          <div className="sv-device sv-device--celular xp__aparelho"><TelaDono /></div>
          <div className="xp__vendas">
            <small>Faturamento do mês</small>
            <strong>R$ <b ref={valor}>0,00</b></strong>
          </div>
          <div className="xp__notifs">
            <div className="xp__notif"><Notificacao titulo="Nova venda! R$ 127,80" texto="Mesa 7 · conta paga" /></div>
            <div className="xp__notif"><Notificacao titulo="Pedido #144 entregue" texto="Delivery · R$ 84,90" icone={<BellRing size={14} />} /></div>
            <div className="xp__notif"><Notificacao titulo="Meta do mês: 72%" texto="+18% vs. mês passado" /></div>
          </div>
        </div>

        {/* A pizza: atravessa todas as cenas por cima de tudo */}
        <div className="xp__obj" aria-hidden="true">
          <div className="xp__anel">
            {INGS.map((g, i) => (
              <div key={g.n} className="xp__ing" style={{ '--s': g.s, '--d': (i % 4) + 1, '--atraso': `${-i * 0.7}s` } as CSSProperties}>
                <img src={`/sabor/${g.n}.webp`} alt="" draggable={false} decoding="async" />
              </div>
            ))}
          </div>
          <div className="xp__pizza">
            <div className="xp__giro">
              {FATIAS.map((f, i) => <div key={i} className="xp__fatia" style={{ clipPath: f.clip }} />)}
            </div>
          </div>
        </div>

        <nav className="xp__pontos" aria-label="Partes da apresentação">
          {CENAS.map((c, i) => <button key={c} type="button" className={i === cena ? 'ativo' : ''} onClick={() => irPara(i)} aria-label={c} />)}
        </nav>
        <div className={`xp__dica${cena ? ' some' : ''}`} aria-hidden="true"><span /> Role para ver</div>
      </div>
    </section>
  );
}
