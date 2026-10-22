import { useState, type CSSProperties } from 'react';
import { Check, ClipboardList, LayoutGrid, Plus, ShoppingBasket } from 'lucide-react';
import { useToast } from '../../../componentes/Toast';
import { useSessao } from '../../../lib/sessao';
import { msgErro, supabase } from '../../../lib/supabase';
import { TEMAS, type TemaSistema } from '../../../lib/temaSistema';
import { cx } from '../../../lib/util';
import { usePainel } from '../Painel';
import { CampoAjuda, PaginaConfig, usePasso, type Passo } from './Layout';
import LogoSistema from './LogoSistema';

const PASSOS: Passo[] = [
  { id: 'cor', rotulo: 'Cor do sistema', dica: 'A cor do menu, dos botões e dos destaques do painel' },
  { id: 'logo', rotulo: 'Logo do sistema', dica: 'A marca que aparece no topo do menu' },
];

/** Configurações › Aparência: cor do sistema e logo do menu. */
export default function Aparencia() {
  const [passo, ir] = usePasso(PASSOS);
  return passo.id === 'logo'
    ? <LogoSistema titulo="Aparência" passos={PASSOS} atual={passo} aoPasso={ir} />
    : <CorSistema passo={passo} aoPasso={ir} />;
}

function CorSistema({ passo, aoPasso }: { passo: Passo; aoPasso: (id: string) => void }) {
  const { restaurante: r } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const salvo = r.tema_sistema ?? null;
  const [tema, setTema] = useState<TemaSistema | null>(salvo);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!tema) return;
    setSalvando(true);
    const { error } = await supabase.from('restaurantes').update({ tema_sistema: tema }).eq('id', r.id);
    setSalvando(false);
    if (error) return toast(msgErro(error), 'erro');
    await s.recarregar();
    toast(`Pronto! O sistema agora está ${TEMAS[tema].nome.toLowerCase()}.`, 'ok');
  }

  return (
    <PaginaConfig titulo="Aparência" passos={PASSOS} atual={passo} aoPasso={aoPasso}
      salvar={{ sujo: !!tema && tema !== salvo, salvando, aoSalvar: () => void salvar() }}>
      <CampoAjuda rotulo="Cor do sistema" ajuda="Vale para todos da equipe neste painel. O cardápio do cliente continua com a cor da loja (Cardápio digital).">
        <div className="tema-opcoes" role="radiogroup" aria-label="Cor do sistema">
          {(Object.keys(TEMAS) as TemaSistema[]).map((id) => {
            const t = TEMAS[id];
            const estilo = { '--t': t.cor, '--t-claro': t.claro, '--t-escuro': t.escuro } as CSSProperties;
            return (
              <button key={id} type="button" role="radio" aria-checked={tema === id} className={cx('tema-opcao', tema === id && 'ativo')} style={estilo} onClick={() => setTema(id)}>
                {/* Miniatura do painel com a cor */}
                <span className="tema-mini" aria-hidden="true">
                  <span className="tema-mini__menu">
                    <i className="tema-mini__logo" />
                    <span className="tema-mini__item tema-mini__item--ativo"><ClipboardList size={11} /> Pedidos</span>
                    <span className="tema-mini__item"><ShoppingBasket size={11} /> PDV</span>
                    <span className="tema-mini__item"><LayoutGrid size={11} /> Mesas</span>
                  </span>
                  <span className="tema-mini__tela">
                    <span className="tema-mini__titulo" />
                    <span className="tema-mini__chips"><i className="ativo" /><i /><i /></span>
                    <span className="tema-mini__cartao"><b /><i /></span>
                    <span className="tema-mini__botao"><Plus size={10} /> Novo</span>
                  </span>
                </span>
                <span className="tema-opcao__rodape">
                  <span className="tema-opcao__cor" />
                  <span className="tema-opcao__txt"><b>{t.nome}{id === 'laranja' && <small> (tradicional)</small>}</b><small>{t.texto}</small></span>
                  {tema === id && <span className="tema-opcao__ok"><Check size={14} strokeWidth={3} /></span>}
                </span>
              </button>
            );
          })}
        </div>
      </CampoAjuda>
    </PaginaConfig>
  );
}
