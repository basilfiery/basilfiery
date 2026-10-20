import type { MarcaSistema, Restaurante } from '../lib/tipos';
import { cx } from '../lib/util';

/** Marca que aparece no topo do menu lateral: BasilFiery, logo + nome da loja, ou só uma imagem larga */
export function marcaDe(r: Pick<Restaurante, 'nome' | 'logo_url' | 'marca_sistema'>): Required<Pick<MarcaSistema, 'modo'>> & MarcaSistema {
  const m = r.marca_sistema;
  if (!m || m.modo === 'padrao') return { modo: 'padrao' };
  if (m.modo === 'imagem' && !m.imagem_url) return { modo: 'padrao' };
  return { ...m, logo_url: m.logo_url || r.logo_url || null, nome: m.nome?.trim() || r.nome };
}

/** Nome para o título da janela/aba */
export const tituloMarca = (r: Pick<Restaurante, 'nome' | 'logo_url' | 'marca_sistema'>) => {
  const m = marcaDe(r);
  return m.modo === 'padrao' ? 'BasilFiery' : m.nome || r.nome;
};

export function MarcaLateral({ r, classe }: { r: Pick<Restaurante, 'nome' | 'logo_url' | 'marca_sistema'>; classe?: string }) {
  const m = marcaDe(r);
  if (m.modo === 'imagem') {
    return (
      <span className={cx('marca-sis marca-sis--imagem', classe)}>
        {/* Menu recolhido (só ícones): mostra a logo quadrada ou um recorte da imagem */}
        <img className="marca-sis__rail" src={m.logo_url || m.imagem_url!} alt="" />
        <div><img className="marca-sis__larga" src={m.imagem_url!} alt={m.nome} /></div>
      </span>
    );
  }
  if (m.modo === 'logo_nome') {
    return (
      <span className={cx('marca-sis', classe)}>
        {m.logo_url ? <img src={m.logo_url} alt="" /> : <span className="marca-sis__inicial">{(m.nome || '?').charAt(0).toUpperCase()}</span>}
        <div>
          <strong className="marca-sis__nome">{m.nome}</strong>
          {m.sub?.trim() && <small>{m.sub}</small>}
        </div>
      </span>
    );
  }
  return (
    <span className={cx('marca-sis', classe)}>
      <img src="/favicon.png" alt="" />
      <div>
        <strong>Basil<span>Fiery</span></strong>
        <small>Gestão de pedidos</small>
      </div>
    </span>
  );
}
