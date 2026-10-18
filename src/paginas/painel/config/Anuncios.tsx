import { useEffect, useState } from 'react';
import { CircleCheck, Trash2 } from 'lucide-react';
import { useToast } from '../../../componentes/Toast';
import { useSessao } from '../../../lib/sessao';
import { msgErro, supabase } from '../../../lib/supabase';
import { cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, PaginaConfig, mudou } from './Layout';

const PASSO = { id: 'configuracoes', rotulo: 'Configurações', dica: 'Configure os códigos de anúncios da sua loja' };
const VALIDOS = {
  pixel: /^[0-9]{5,20}$/,
  ga4: /^G-[A-Z0-9]{4,15}$/,
  gads: /^AW-[0-9]{5,15}$/,
  capi: /^[A-Za-z0-9_-]{20,400}$/,
};

export default function Anuncios() {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [base, setBase] = useState({ pixel: r.ads_pixel ?? '', ga4: r.ads_ga4 ?? '', gads: r.ads_gads ?? '' });
  const [f, setF] = useState(base);
  const [capi, setCapi] = useState('');
  const [temCapi, setTemCapi] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void supabase.from('restaurante_dados').select('capi_token').eq('restaurante_id', r.id).maybeSingle()
      .then(({ data }) => setTemCapi(!!(data as { capi_token: string | null } | null)?.capi_token));
  }, [r.id]);

  const invalido = (k: keyof typeof VALIDOS, v: string) => v.trim() !== '' && !VALIDOS[k].test(v.trim());

  async function salvar() {
    if (invalido('pixel', f.pixel)) return toast('Pixel ID inválido: são só números.', 'erro');
    if (invalido('ga4', f.ga4)) return toast('GA4 ID inválido. Ex.: G-1A2B3C4D5E', 'erro');
    if (invalido('gads', f.gads)) return toast('Google Ads inválido. Ex.: AW-1234567890', 'erro');
    if (invalido('capi', capi)) return toast('Token CAPI inválido. Copie o token inteiro do Gerenciador de Eventos.', 'erro');
    setSalvando(true);
    const [a, b] = await Promise.all([
      supabase.from('restaurantes').update({ ads_pixel: f.pixel.trim() || null, ads_ga4: f.ga4.trim() || null, ads_gads: f.gads.trim() || null }).eq('id', r.id),
      capi.trim() ? supabase.from('restaurante_dados').upsert({ restaurante_id: r.id, capi_token: capi.trim() }) : Promise.resolve({ error: null }),
    ]);
    setSalvando(false);
    const erro = a.error ?? b.error;
    if (erro) return toast(msgErro(erro), 'erro');
    toast('Anúncios salvos. Os eventos começam a ser enviados no próximo pedido.', 'ok');
    if (capi.trim()) { setTemCapi(true); setCapi(''); }
    setBase(f);
    void s.recarregar();
  }

  async function removerCapi() {
    const { error } = await supabase.from('restaurante_dados').upsert({ restaurante_id: r.id, capi_token: null });
    if (error) return toast(msgErro(error), 'erro');
    setTemCapi(false);
    toast('Token removido.', 'ok');
  }

  return (
    <PaginaConfig
      titulo="Integração de anúncios"
      passos={[PASSO]}
      atual={PASSO}
      salvar={{ sujo: mudou(f, base) || capi.trim() !== '', salvando, aoSalvar: () => void salvar() }}
    >
      <div className="form cfg-anuncios">
        <CampoAjuda rotulo="Pixel ID" ajuda="O Pixel do Facebook rastreia a atividade dos clientes no seu cardápio digital e envia os dados para o Gerenciador de Anúncios do Facebook.">
          <input className={cx('input', invalido('pixel', f.pixel) && 'input--erro')} inputMode="numeric" placeholder="Ex.: 1042957467847961" value={f.pixel} onChange={(e) => setF({ ...f, pixel: e.target.value.replace(/\D/g, '') })} />
        </CampoAjuda>
        <CampoAjuda rotulo="GA4 ID" ajuda="O Google Analytics 4 captura visitas e compras para você entender a jornada de compra.">
          <input className={cx('input', invalido('ga4', f.ga4) && 'input--erro')} placeholder="Ex.: G-1A2B3C4D5E" value={f.ga4} onChange={(e) => setF({ ...f, ga4: e.target.value.toUpperCase().trim() })} />
        </CampoAjuda>
        <CampoAjuda rotulo="Token CAPI" ajuda="A Conversions API envia as compras direto do servidor para o Facebook, sem depender do navegador. Precisa do Pixel ID preenchido. Fica guardado em segredo.">
          {temCapi && !capi ? (
            <div className="cfg-copiavel cfg-copiavel--ok">
              <span><CircleCheck size={16} /> Token configurado</span>
              <button type="button" className="btn btn--fantasma btn--sm" onClick={() => void removerCapi()}><Trash2 size={15} /> Remover</button>
            </div>
          ) : null}
          <input className={cx('input', invalido('capi', capi) && 'input--erro')} placeholder={temCapi ? 'Cole um novo token para trocar' : 'Ex.: EAAGm0PX4ZCpsBAJZA…'} value={capi} onChange={(e) => setCapi(e.target.value.trim())} autoComplete="off" />
        </CampoAjuda>
        <CampoAjuda rotulo="Google Ads" ajuda="A tag do Google Ads acompanha as conversões de vendas e ajuda a criar campanhas de remarketing.">
          <input className={cx('input', invalido('gads', f.gads) && 'input--erro')} placeholder="Ex.: AW-1234567890" value={f.gads} onChange={(e) => setF({ ...f, gads: e.target.value.toUpperCase().trim() })} />
        </CampoAjuda>
        <p className="cfg-nota">Eventos enviados: visita ao cardápio, item adicionado à sacola, início do pedido e compra (com o valor).</p>
      </div>
    </PaginaConfig>
  );
}
