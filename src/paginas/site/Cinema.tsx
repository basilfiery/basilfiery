/* Abertura cinematográfica do site: o vídeo da pizza anda junto com a rolagem e conta a história do sistema. */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, BellRing, Mouse, Printer, QrCode } from 'lucide-react';
import '../../estilos/cinema.css';

/** Quadros em public/cinema/{d,m}/000.webp … (d = computador, m = celular). */
const TOTAL = 105;

const CENAS = [
  { etiqueta: 'Para pizzarias e restaurantes', titulo: <>Toda pizza começa com <em>um pedido</em>.</>, texto: 'E cada pedido merece chegar certo, rápido e sem papelzinho. Do salão ao delivery, do caixa ao seu celular.' },
  { etiqueta: '01 · No salão', titulo: <>O cliente pede <em>pela mesa</em>.</>, texto: 'QR code ou tablet: fotos, meio a meio, borda e a oferta certa antes do carrinho. O garçom libera com um toque.' },
  { etiqueta: '02 · Na cozinha', titulo: <>A comanda sai <em>na hora</em>.</>, texto: 'O pedido entra no painel com som e já sai impresso na térmica. Nada esquecido na correria.' },
  { etiqueta: '03 · No seu bolso', titulo: <>A venda chega <em>no seu celular</em>.</>, texto: 'Conta paga, notificação no app do dono. Vendas, meta do mês e lucro ao vivo, de onde você estiver.' },
];

const CHIPS = [
  null,
  { icone: QrCode, t: 'Mesa 4', s: 'Pedido enviado · R$ 89,90' },
  { icone: Printer, t: 'Comanda impressa', s: 'Cozinha · 1 Pizza G meio a meio' },
  { icone: BellRing, t: 'Nova venda! R$ 127,80', s: 'Mesa 7 · conta paga' },
];

const limitar = (v: number) => Math.min(1, Math.max(0, v));

export function Cinema() {
  const secao = useRef<HTMLElement>(null);
  const tela = useRef<HTMLCanvasElement>(null);
  const [cena, setCena] = useState(0);
  const [inicio, setInicio] = useState(true);

  useEffect(() => {
    const el = secao.current;
    const cv = tela.current;
    const ctx = cv?.getContext('2d');
    if (!el || !cv || !ctx) return;
    const pasta = window.matchMedia('(max-width: 860px)').matches ? 'm' : 'd';
    const imgs: (HTMLImageElement | null)[] = Array(TOTAL).fill(null);
    let vivo = true;
    let alvo = 0; // progresso da rolagem
    let atual = 0; // progresso desenhado (segue o alvo com suavidade)
    let quadro = 0;
    let cenaAtual = 0;
    let noInicio = true;

    // Ordem de carga: primeiro quadros espaçados (já dá para rolar), depois preenche os buracos
    const ordem: number[] = [];
    const visto = new Set<number>();
    for (const passo of [16, 8, 4, 2, 1]) {
      for (let i = 0; i < TOTAL; i += passo) if (!visto.has(i)) { visto.add(i); ordem.push(i); }
      if (passo === 16 && !visto.has(TOTAL - 1)) { visto.add(TOTAL - 1); ordem.push(TOTAL - 1); }
    }
    let pos = 0;
    const carregar = () => {
      const i = ordem[pos++];
      if (i === undefined || !vivo) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { if (!vivo) return; imgs[i] = img; pedir(); carregar(); };
      img.onerror = () => carregar();
      img.src = `/cinema/${pasta}/${String(i).padStart(3, '0')}.webp`;
    };
    for (let k = 0; k < 4; k++) carregar();

    const maisPerto = (i: number) => {
      for (let d = 0; d < TOTAL; d++) {
        if (imgs[i - d]) return imgs[i - d];
        if (imgs[i + d]) return imgs[i + d];
      }
      return null;
    };
    const cobrir = (img: HTMLImageElement, alfa: number) => {
      const s = Math.max(cv.width / img.naturalWidth, cv.height / img.naturalHeight);
      const w = img.naturalWidth * s;
      const h = img.naturalHeight * s;
      ctx.globalAlpha = alfa;
      ctx.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h);
    };
    const desenhar = () => {
      const f = atual * (TOTAL - 1);
      const a = Math.floor(f);
      const b = Math.min(TOTAL - 1, a + 1);
      const ia = maisPerto(a);
      if (!ia) return;
      cobrir(ia, 1);
      const ib = imgs[b];
      const t = f - a;
      if (ib && ib !== ia && t > 0.02) cobrir(ib, t); // mistura dois quadros: movimento liso
      ctx.globalAlpha = 1;
    };
    const passo = () => {
      quadro = 0;
      const d = alvo - atual;
      atual = Math.abs(d) < 0.0005 ? alvo : atual + d * 0.2;
      el.style.setProperty('--p', atual.toFixed(4));
      desenhar();
      if (atual !== alvo) quadro = requestAnimationFrame(passo);
    };
    function pedir() { if (!quadro) quadro = requestAnimationFrame(passo); }

    const medir = () => {
      const r = el.getBoundingClientRect();
      const curso = r.height - window.innerHeight;
      alvo = limitar(curso > 0 ? -r.top / curso : 0);
      const c = Math.min(CENAS.length - 1, Math.floor(alvo * CENAS.length * 0.9999));
      if (c !== cenaAtual) { cenaAtual = c; setCena(c); }
      const ini = alvo < 0.02;
      if (ini !== noInicio) { noInicio = ini; setInicio(ini); }
      pedir();
    };
    const ajustar = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      desenhar();
      medir();
    };
    ajustar();
    window.addEventListener('scroll', medir, { passive: true });
    window.addEventListener('resize', ajustar);
    return () => {
      vivo = false;
      cancelAnimationFrame(quadro);
      window.removeEventListener('scroll', medir);
      window.removeEventListener('resize', ajustar);
    };
  }, []);

  const irPara = (i: number) => {
    const el = secao.current;
    if (!el) return;
    const curso = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: el.offsetTop + curso * ((i + 0.35) / CENAS.length), behavior: 'smooth' });
  };

  return (
    <section className="sv-cine" ref={secao} aria-label="Apresentação">
      <div className="sv-cine__palco">
        <div className="sv-cine__fundo" aria-hidden="true"><i /><b /></div>
        <div className="sv-cine__grade">
          <div className="sv-cine__textos">
            {CENAS.map((c, i) => {
              const Titulo = i === 0 ? 'h1' : 'h2';
              return (
                <div key={i} className={`sv-cine__cena${i === cena ? ' ativa' : i < cena ? ' passou' : ''}`} aria-hidden={i !== cena}>
                  <span className="sv-cine__num" aria-hidden="true">{String(i).padStart(2, '0')}</span>
                  <span className="sv-cine__etiqueta">{c.etiqueta}</span>
                  <Titulo>{c.titulo}</Titulo>
                  <p>{c.texto}</p>
                  {i === CENAS.length - 1 && (
                    <div className="sv-hero__ctas">
                      <a href="#planos" className="sv-btn sv-btn--vermelho sv-btn--grande" tabIndex={i === cena ? 0 : -1}>Ver planos <ArrowRight size={18} /></a>
                      <a href="#sistema" className="sv-btn sv-btn--vidro sv-btn--grande" tabIndex={i === cena ? 0 : -1}>Ver o sistema</a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="sv-cine__quadro">
            <canvas ref={tela} aria-hidden="true" />
            <span className="sv-cine__veu" aria-hidden="true" />
            {CHIPS.map((c, i) => c && (
              <div key={i} className={`sv-cine__chip${i === cena ? ' ativo' : ''}`} aria-hidden="true">
                <span><c.icone size={16} /></span>
                <div><b>{c.t}</b><small>{c.s}</small></div>
              </div>
            ))}
          </div>
        </div>

        <nav className="sv-cine__pontos" aria-label="Partes da apresentação">
          {CENAS.map((c, i) => (
            <button key={i} type="button" className={i === cena ? 'ativo' : ''} onClick={() => irPara(i)} aria-label={c.etiqueta} />
          ))}
        </nav>
        <div className={`sv-cine__dica${inicio ? '' : ' some'}`} aria-hidden="true"><Mouse size={16} /> Role para ver</div>
        <div className="sv-cine__barra" aria-hidden="true" style={{ '--n': CENAS.length } as CSSProperties}><i /></div>
      </div>
    </section>
  );
}
