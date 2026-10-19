import { useState } from 'react';
import { Check, Copy, ExternalLink, FileText, Megaphone, ShieldCheck } from 'lucide-react';
import { useToast } from '../../componentes/Toast';

const BASE = 'https://basilfiery.vercel.app';
const LINKS = [
  { icone: ShieldCheck, titulo: 'Política de privacidade', texto: 'O que o sistema e o seu cardápio fazem com os dados dos clientes (LGPD, Pixel da Meta, Google).', url: `${BASE}/privacidade` },
  { icone: FileText, titulo: 'Termos de uso', texto: 'As regras de uso do sistema e dos cardápios digitais.', url: `${BASE}/termos` },
];

/** Termos e políticas: links públicos, prontos para colar nos anúncios. */
export default function TermosPoliticas() {
  const toast = useToast();
  const [copiado, setCopiado] = useState('');
  async function copiar(url: string) {
    try { await navigator.clipboard.writeText(url); setCopiado(url); toast('Link copiado.', 'ok'); setTimeout(() => setCopiado(''), 1800); } catch { toast('Não consegui copiar. Selecione o link e copie.', 'erro'); }
  }
  return (
    <div className="pagina termos-pag">
      <div className="pagina__cab">
        <div style={{ flex: 1 }}>
          <h1 className="titulo">Termos e políticas</h1>
          <p>Páginas públicas do {`BasilFiery`}. Já aparecem no rodapé do cardápio digital, na criação de conta e na finalização do pedido.</p>
        </div>
      </div>
      <section className="card termos-pag__card">
        <h2 className="card__titulo">Links para acesso</h2>
        {LINKS.map((l) => (
          <div key={l.url} className="termos-link">
            <span className="termos-link__icone"><l.icone size={20} /></span>
            <div>
              <strong>{l.titulo}</strong>
              <small>{l.texto}</small>
              <code>{l.url}</code>
            </div>
            <div className="termos-link__acoes">
              <button className="btn btn--contorno btn--sm" onClick={() => void copiar(l.url)}>{copiado === l.url ? <Check size={15} /> : <Copy size={15} />} Copiar</button>
              <a className="btn btn--primario btn--sm" href={l.url} target="_blank" rel="noopener"><ExternalLink size={15} /> Abrir</a>
            </div>
          </div>
        ))}
      </section>
      <section className="card termos-pag__dica">
        <Megaphone size={20} />
        <div>
          <strong>Vai anunciar no Instagram, Facebook ou Google?</strong>
          <p>Quando a plataforma pedir a “URL da política de privacidade”, cole o link da <b>Política de privacidade</b>. Ela já explica o uso do Pixel da Meta, do Google Analytics e do Google Ads no seu cardápio.</p>
        </div>
      </section>
    </div>
  );
}
