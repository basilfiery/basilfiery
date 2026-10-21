import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Award, Bell, BellOff, CheckCircle2, ChevronRight, ClipboardList, Crown, LogOut, Medal, Moon, Settings, Share, Smartphone, SquarePlus, Sun, Trophy, UserRound, Volume2, X,
} from 'lucide-react';
import { Switch } from '../../componentes/Basicos';
import { Carregando } from '../../componentes/Carregando';
import { Modal } from '../../componentes/Modal';
import { useToast } from '../../componentes/Toast';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { definirSom, somLigado, tocarAlerta } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import { brl, cx } from '../../lib/util';
import { VERSAO_CURTA } from '../../lib/versao';
import { useAparencia, type Aparencia } from '../../lib/aparencia';

export type TelaGarcom = 'principal' | 'desafios' | 'config';

/* =====================================================================
   Menu do app do garçom (☰): Mesas e pedidos, Desafios, Configurações,
   Meu perfil, Adicionar atalho e Sair.
   ===================================================================== */

type EventoInstalar = Event & { prompt: () => Promise<void> };
let promptGuardado: EventoInstalar | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptGuardado = e as EventoInstalar; });
}
const jaInstalado = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true || document.referrer.startsWith('android-app://'));
const ehIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export function MenuGarcom({ aberto, tela, nomeRest, logo, aoIr, aoPerfil, aoSair, aoFechar }: {
  aberto: boolean;
  tela: TelaGarcom;
  nomeRest: string;
  logo: string | null;
  aoIr: (t: TelaGarcom) => void;
  aoPerfil: () => void;
  aoSair: () => void;
  aoFechar: () => void;
}) {
  const [ajudaIphone, setAjudaIphone] = useState(false);
  const [aparencia, setAparencia] = useAparencia('garcom');
  const instalado = jaInstalado();

  useEffect(() => {
    if (!aberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto, aoFechar]);

  async function adicionarAtalho() {
    if (promptGuardado) { await promptGuardado.prompt(); promptGuardado = null; return; }
    setAjudaIphone(true);
  }

  const Item = ({ id, icone, rotulo }: { id: TelaGarcom; icone: ReactNode; rotulo: string }) => (
    <button className={cx('gmenu__item', tela === id && 'ativo')} onClick={() => { aoIr(id); aoFechar(); }}>
      {icone}<span>{rotulo}</span>
    </button>
  );

  return createPortal(
    <>
      <div className={cx('gmenu-fundo', aberto && 'aberto')} onClick={aoFechar} aria-hidden="true" />
      <aside className={cx('gmenu', aberto && 'aberto')} aria-label="Menu do garçom" aria-hidden={!aberto}>
        <header className="gmenu__topo">
          <strong>Menu</strong>
          <button className="icone-btn" onClick={aoFechar} aria-label="Fechar menu"><X size={20} /></button>
        </header>
        <nav className="gmenu__lista">
          <Item id="principal" icone={<ClipboardList size={20} />} rotulo="Mesas e pedidos" />
          <Item id="desafios" icone={<Trophy size={20} />} rotulo="Desafios do garçom" />
          <Item id="config" icone={<Settings size={20} />} rotulo="Configurações" />
          <button className="gmenu__item" onClick={() => { aoPerfil(); aoFechar(); }}><UserRound size={20} /><span>Meu perfil</span></button>
          <button className="gmenu__item" onClick={() => setAparencia(aparencia === 'claro' ? 'escuro' : 'claro')}>
            {aparencia === 'claro' ? <Moon size={20} /> : <Sun size={20} />}<span>{aparencia === 'claro' ? 'Usar modo escuro' : 'Usar modo claro'}</span>
          </button>
        </nav>

        <div className="gmenu__rodape">
          {instalado ? (
            <div className="gmenu__atalho gmenu__atalho--ok"><CheckCircle2 size={22} /><div><b>App instalado</b><small>Abra sempre pelo ícone da tela inicial</small></div></div>
          ) : (
            <button className="gmenu__atalho" onClick={() => void adicionarAtalho()}>
              <span className="gmenu__atalho-icone"><Smartphone size={20} /></span>
              <div><b>Adicionar atalho</b><small>Salve na sua tela inicial</small></div>
              <ChevronRight size={18} />
            </button>
          )}
          <div className="gmenu__loja">
            {logo ? <img src={logo} alt="" /> : <span>{nomeRest.charAt(0)}</span>}
            <b>{nomeRest}</b>
          </div>
          <button className="btn btn--contorno btn--bloco" onClick={aoSair}><LogOut size={17} /> Sair</button>
          <small className="gmenu__versao">BasilFiery · versão {VERSAO_CURTA}</small>
        </div>
      </aside>

      {ajudaIphone && (
        <Modal aberto aoFechar={() => setAjudaIphone(false)} titulo="Adicionar à tela inicial" largura={420}>
          {ehIphone() ? (
            <ol className="gmenu__passos">
              <li>Toque em <Share size={16} /> <b>Compartilhar</b> (barra de baixo do Safari)</li>
              <li>Escolha <SquarePlus size={16} /> <b>Adicionar à Tela de Início</b></li>
              <li>Abra o app pelo ícone novo: as notificações passam a funcionar com a tela bloqueada</li>
            </ol>
          ) : (
            <ol className="gmenu__passos">
              <li>Toque nos <b>três pontinhos</b> do Chrome (canto de cima)</li>
              <li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b></li>
              <li>Ou baixe o app Android com o gerente (em Apps no celular)</li>
            </ol>
          )}
        </Modal>
      )}
    </>,
    document.body,
  );
}

/* ---------- Desafios do garçom ---------- */
interface Numeros { entregues: number; lancados: number; vendas: number; chamados: number; liberadas: number; pontos: number }
interface Desafios { hoje: Numeros; semana: Numeros; ranking: { user_id: string; nome: string; foto: string | null; eu: boolean; pontos: number }[] }

const METAS_HOJE: { chave: keyof Numeros; meta: number; titulo: string }[] = [
  { chave: 'entregues', meta: 15, titulo: 'Entregue 15 pedidos' },
  { chave: 'lancados', meta: 10, titulo: 'Lance 10 pedidos pelo celular' },
  { chave: 'chamados', meta: 8, titulo: 'Atenda 8 chamados de mesa' },
  { chave: 'liberadas', meta: 5, titulo: 'Libere 5 mesas' },
];
const METAS_SEMANA: { chave: keyof Numeros; meta: number; titulo: string }[] = [
  { chave: 'entregues', meta: 80, titulo: 'Entregue 80 pedidos na semana' },
  { chave: 'chamados', meta: 40, titulo: 'Atenda 40 chamados na semana' },
  { chave: 'pontos', meta: 250, titulo: 'Faça 250 pontos na semana' },
];
function nivel(pontos: number) {
  if (pontos >= 400) return { nome: 'Lenda do salão', classe: 'lenda', proximo: null };
  if (pontos >= 200) return { nome: 'Ouro', classe: 'ouro', proximo: 400 };
  if (pontos >= 80) return { nome: 'Prata', classe: 'prata', proximo: 200 };
  return { nome: 'Bronze', classe: 'bronze', proximo: 80 };
}

export function DesafiosGarcom({ restauranteId }: { restauranteId: string }) {
  const toast = useToast();
  const [d, setD] = useState<Desafios | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('garcom_desafios', { p_rest: restauranteId, p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo' });
    if (error) { toast(msgErro(error), 'erro'); return; }
    setD(data as Desafios);
  }, [restauranteId, toast]);
  useEffect(() => {
    void carregar();
    const i = setInterval(() => void carregar(), 60000);
    return () => clearInterval(i);
  }, [carregar]);

  if (!d) return <Carregando />;
  const nv = nivel(d.semana.pontos);
  const pos = d.ranking.findIndex((x) => x.eu) + 1;

  const Lista = ({ metas, numeros }: { metas: typeof METAS_HOJE; numeros: Numeros }) => (
    <ul className="gdes__metas">
      {metas.map((m) => {
        const v = Number(numeros[m.chave]);
        const feito = v >= m.meta;
        return (
          <li key={m.titulo} className={cx(feito && 'feito')}>
            <span className="gdes__selo">{feito ? <CheckCircle2 size={20} /> : <Award size={20} />}</span>
            <div>
              <b>{m.titulo}</b>
              <span className="gdes__barra"><i style={{ width: `${Math.min(100, (v / m.meta) * 100)}%` }} /></span>
            </div>
            <small>{Math.min(v, m.meta)}/{m.meta}</small>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="gdes">
      <section className={cx('gdes__nivel', `gdes__nivel--${nv.classe}`)}>
        <span className="gdes__medalha"><Medal size={30} /></span>
        <div>
          <small>Seu nível da semana</small>
          <strong>{nv.nome}</strong>
          <span>{d.semana.pontos} pontos{nv.proximo ? ` · faltam ${nv.proximo - d.semana.pontos} para o próximo nível` : ' · nível máximo!'}</span>
        </div>
        {pos > 0 && <b className="gdes__pos">{pos}º</b>}
      </section>

      <div className="gdes__resumo">
        <div><small>Entregues hoje</small><strong>{d.hoje.entregues}</strong></div>
        <div><small>Chamados hoje</small><strong>{d.hoje.chamados}</strong></div>
        <div><small>Vendas lançadas hoje</small><strong>{brl(Number(d.hoje.vendas))}</strong></div>
      </div>

      <h2 className="gdes__titulo">Desafios de hoje</h2>
      <Lista metas={METAS_HOJE} numeros={d.hoje} />
      <h2 className="gdes__titulo">Desafios da semana</h2>
      <Lista metas={METAS_SEMANA} numeros={d.semana} />

      <h2 className="gdes__titulo">Ranking da semana</h2>
      <ol className="gdes__ranking">
        {d.ranking.map((x, i) => (
          <li key={x.user_id} className={cx(x.eu && 'eu')}>
            <span className={cx('gdes__lugar', i < 3 && `top${i + 1}`)}>{i === 0 && x.pontos > 0 ? <Crown size={15} /> : i + 1}</span>
            {x.foto ? <img src={x.foto} alt="" /> : <span className="gdes__inicial">{x.nome.charAt(0).toUpperCase()}</span>}
            <b>{x.nome}{x.eu && <small> (você)</small>}</b>
            <span className="gdes__pontos">{x.pontos} pts</span>
          </li>
        ))}
      </ol>
      <p className="gdes__regra">Pontos: entregar ou lançar pedido vale 2; atender chamado ou liberar mesa vale 1. Zera toda segunda-feira.</p>
    </div>
  );
}

/* ---------- Configurações do garçom ---------- */
export function ConfigGarcom({ restauranteId }: { restauranteId: string }) {
  const toast = useToast();
  const [som, setSom] = useState(somLigado());
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [aparencia, setAparencia] = useAparencia('garcom');
  useEffect(() => { void estadoPush().then(setPush); }, []);

  async function ativar() {
    try {
      await ativarPush(restauranteId);
      toast('Notificações ativadas.', 'ok');
    } catch (e) { toast(msgErro(e), 'erro'); }
    setPush(await estadoPush());
  }

  return (
    <div className="gcfg">
      <section className="gcfg__bloco">
        <div className="gcfg__linha">
          <span className="gcfg__icone">{aparencia === 'claro' ? <Sun size={20} /> : <Moon size={20} />}</span>
          <div><b>Aparência</b><small>Escolha o app claro ou escuro neste celular</small></div>
        </div>
        <SeletorAparencia valor={aparencia} aoMudar={setAparencia} />
      </section>
      <section className="gcfg__bloco">
        <div className="gcfg__linha">
          <span className="gcfg__icone"><Volume2 size={20} /></span>
          <div><b>Som dos avisos</b><small>Toca quando chega pedido, fica pronto ou a mesa chama</small></div>
          <Switch marcado={som} aoMudar={(v) => { setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }} />
        </div>
        <button className="btn btn--contorno btn--sm gcfg__testar" onClick={() => tocarAlerta('pedido')} disabled={!som}>Testar som</button>
      </section>
      <section className="gcfg__bloco">
        <div className="gcfg__linha">
          <span className="gcfg__icone">{push === 'ativo' ? <Bell size={20} /> : <BellOff size={20} />}</span>
          <div>
            <b>Notificações com a tela bloqueada</b>
            <small>
              {push === 'ativo' ? 'Ativas neste celular.'
                : push === 'bloqueado' ? 'Bloqueadas: libere nas permissões do navegador (cadeado ao lado do endereço).'
                  : push === 'precisa-instalar' ? 'No iPhone, adicione o app à Tela de Início e abra por ele.'
                    : push === 'indisponivel' ? 'Este navegador não aceita notificações.' : 'Desativadas neste celular.'}
            </small>
          </div>
          {push === 'ativo' ? <CheckCircle2 size={22} className="gcfg__ok" /> : (push === 'inativo') && <button className="btn btn--primario btn--sm" onClick={() => void ativar()}>Ativar</button>}
        </div>
      </section>
      <p className="gcfg__versao">BasilFiery · versão {VERSAO_CURTA}</p>
    </div>
  );
}

/** Dois botões grandes: Escuro | Claro (usado no garçom e no dono) */
export function SeletorAparencia({ valor, aoMudar, classe }: { valor: Aparencia; aoMudar: (v: Aparencia) => void; classe?: string }) {
  return (
    <div className={cx('aparencia', classe)} role="radiogroup" aria-label="Aparência do app">
      {([['escuro', 'Escuro', <Moon key="m" size={18} />], ['claro', 'Claro', <Sun key="s" size={18} />]] as const).map(([id, rotulo, icone]) => (
        <button key={id} type="button" role="radio" aria-checked={valor === id} className={cx('aparencia__opcao', `aparencia__opcao--${id}`, valor === id && 'ativo')} onClick={() => aoMudar(id)}>
          <span className="aparencia__mini" aria-hidden="true"><i /><i /><i /></span>
          <span className="aparencia__rotulo">{icone} {rotulo}</span>
        </button>
      ))}
    </div>
  );
}
