import { useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BellRing, BookOpen, Check, ChevronRight, ClipboardList, ConciergeBell, FileText, Megaphone, Palette, Play, Plug, Printer, Store, Users, type LucideIcon } from 'lucide-react';
import { Switch } from '../../componentes/Basicos';
import { useToast } from '../../componentes/Toast';
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { SONS_CHAMADO, definirSom, somLigado, tocarAlerta, tocarChamado, type SomChamado } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Papel } from '../../lib/tipos';
import { cx, ehGestor, podeCaixa } from '../../lib/util';
import { VERSAO_CURTA } from '../../lib/versao';
import { usePainel } from './Painel';
import { PaginaConfig, usePasso, type Passo } from './config/Layout';
import Estabelecimento from './config/Estabelecimento';
import CardapioDigitalConfig from './config/CardapioDigitalConfig';
import Integracoes from './config/Integracoes';
import Anuncios from './config/Anuncios';
import Clientes from './config/Clientes';
import HistoricoPedidos from './config/HistoricoPedidos';
import PaginaImpressora from './config/Impressora';
import NotaFiscal from './config/NotaFiscal';
import LogoSistema from './config/LogoSistema';

interface Secao { id: string; titulo: string; descricao: string; icone: LucideIcon; pode: (p: Papel) => boolean; tela: () => ReactElement }

const SECOES: Secao[] = [
  { id: 'clientes', titulo: 'Meus clientes', descricao: 'Quem já pediu, quanto gastou e WhatsApp para chamar de volta', icone: Users, pode: podeCaixa, tela: () => <Clientes /> },
  { id: 'pedidos', titulo: 'Meus pedidos', descricao: 'Histórico de todos os pedidos com filtros e reimpressão', icone: ClipboardList, pode: podeCaixa, tela: () => <HistoricoPedidos /> },
  { id: 'impressora', titulo: 'Impressora', descricao: 'Impressão automática, papel e vias deste computador', icone: Printer, pode: () => true, tela: () => <PaginaImpressora /> },
  { id: 'integracoes', titulo: 'Integrações', descricao: 'Chave (token) para conectar outros aplicativos', icone: Plug, pode: ehGestor, tela: () => <Integracoes /> },
  { id: 'cardapio-digital', titulo: 'Cardápio digital', descricao: 'Cor, capa, destaques, esgotados e link do delivery', icone: BookOpen, pode: ehGestor, tela: () => <CardapioDigitalConfig /> },
  { id: 'estabelecimento', titulo: 'Estabelecimento', descricao: 'Dados, endereço, horários, entrega e pagamento', icone: Store, pode: ehGestor, tela: () => <Estabelecimento /> },
  { id: 'logo-sistema', titulo: 'Logo do sistema', descricao: 'Troque a marca BasilFiery do menu pela da sua loja', icone: Palette, pode: ehGestor, tela: () => <LogoSistema /> },
  { id: 'nota-fiscal', titulo: 'Nota fiscal', descricao: 'NFC-e, NF-e, certificado digital e notas recebidas', icone: FileText, pode: ehGestor, tela: () => <NotaFiscal /> },
  { id: 'anuncios', titulo: 'Integração de anúncios', descricao: 'Pixel do Facebook, Google Analytics e Google Ads', icone: Megaphone, pode: ehGestor, tela: () => <Anuncios /> },
  { id: 'avisos', titulo: 'Avisos e sons', descricao: 'Notificações neste aparelho e toque do chamado', icone: BellRing, pode: () => true, tela: () => <PaginaAvisos /> },
];

export default function Configuracoes() {
  const { restaurante, papel } = usePainel();
  const { aba } = useParams();
  const secao = SECOES.find((x) => x.id === aba);
  if (secao) {
    if (!secao.pode(papel)) return <p className="vazio">Seu cargo não tem acesso a esta área.</p>;
    return <div key={`${secao.id}-${restaurante.id}`} className="cfg-pagina">{secao.tela()}</div>;
  }
  return (
    <div className="pagina">
      <div className="pagina__cab">
        <div>
          <h1 className="titulo">Configurações</h1>
          <p>Escolha o que você quer ajustar.</p>
        </div>
      </div>
      <div className="cfg-inicio">
        {SECOES.filter((x) => x.pode(papel)).map((x) => (
          <Link key={x.id} to={`/painel/config/${x.id}`} className="cfg-atalho">
            <span className="cfg-atalho__icone"><x.icone size={22} strokeWidth={1.8} /></span>
            <span className="cfg-atalho__texto"><strong>{x.titulo}</strong><small>{x.descricao}</small></span>
            <ChevronRight size={18} className="cfg-atalho__seta" />
          </Link>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '.8rem', margin: 0 }}>
        Versão do sistema: <b>{VERSAO_CURTA}</b> · as atualizações são verificadas a cada minuto.
      </p>
    </div>
  );
}

const PASSOS_AVISOS: Passo[] = [
  { id: 'notificacoes', rotulo: 'Notificações', dica: 'Som e aviso no canto da tela quando chegar pedido ou chamado' },
  { id: 'toque', rotulo: 'Toque do chamado', dica: 'O som que toca quando uma mesa chama o garçom' },
];

function PaginaAvisos() {
  const [passo, ir] = usePasso(PASSOS_AVISOS);
  return (
    <PaginaConfig titulo="Avisos e sons" passos={PASSOS_AVISOS} atual={passo} aoPasso={ir}>
      {passo.id === 'notificacoes' ? <CartaoNotificacoes /> : <CartaoSomChamado />}
    </PaginaConfig>
  );
}

function CartaoSomChamado() {
  const { restaurante, papel } = usePainel();
  const s = useSessao();
  const toast = useToast();
  const [atual, setAtual] = useState<SomChamado>(restaurante.som_chamado ?? 'campainha');
  const gestor = ehGestor(papel);

  async function escolher(id: SomChamado) {
    tocarChamado(id, true);
    if (!gestor || id === atual) return;
    const antes = atual;
    setAtual(id);
    const { error } = await supabase.from('restaurantes').update({ som_chamado: id }).eq('id', restaurante.id);
    if (error) {
      setAtual(antes);
      return toast(msgErro(error), 'erro');
    }
    toast('Toque salvo. Vale para o painel e para os celulares dos garçons.', 'ok');
    void s.recarregar();
  }

  return (
    <section>
      <p className="cfg-subtitulo"><ConciergeBell size={18} /> Toque do “chamar garçom”</p>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: '.9rem' }}>
        Toca no painel do caixa e no celular dos garçons quando uma mesa chama.{' '}
        {gestor ? 'Clique numa opção para ouvir e escolher.' : 'Clique para ouvir; só o dono ou gerente pode trocar.'}
      </p>
      <div className="sons" role="radiogroup" aria-label="Toque do chamado">
        {SONS_CHAMADO.map((o) => (
          <div
            key={o.id}
            role="radio"
            tabIndex={0}
            aria-checked={atual === o.id}
            className={cx('som-opcao', atual === o.id && 'ativo', !gestor && 'som-opcao--so-ouvir')}
            onClick={() => void escolher(o.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void escolher(o.id); } }}
          >
            <button
              type="button"
              className="som-opcao__play"
              onClick={(e) => { e.stopPropagation(); tocarChamado(o.id, true); }}
              aria-label={`Ouvir ${o.nome}`}
              title="Ouvir"
            >
              <Play size={15} fill="currentColor" />
            </button>
            <span className="som-opcao__texto">
              <strong>{o.nome}</strong>
              <small>{o.descricao}</small>
            </span>
            {atual === o.id
              ? <span className="som-opcao__selo"><Check size={15} /> Em uso</span>
              : gestor && <span className="som-opcao__usar">Usar este</span>}
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: '12px 0 0', fontSize: '.82rem' }}>
        Com o celular bloqueado, a notificação usa o toque padrão do aparelho (o navegador não permite trocar).
      </p>
    </section>
  );
}

function CartaoNotificacoes() {
  const { restaurante } = usePainel();
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [som, setSom] = useState(somLigado());
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { void estadoPush().then(setEstado); }, []);

  async function ativar() {
    setOcupado(true);
    try {
      await ativarPush(restaurante.id);
      toast('Notificações ativadas neste aparelho!', 'ok');
    } catch (e) {
      toast(msgErro(e), 'erro');
    } finally {
      setOcupado(false);
      setEstado(await estadoPush());
    }
  }

  async function desativar() {
    setOcupado(true);
    await desativarPush().catch(() => {});
    setOcupado(false);
    setEstado(await estadoPush());
  }

  const textos: Record<EstadoPush, string> = {
    ativo: 'Ativadas neste aparelho.',
    inativo: 'Desativadas neste aparelho.',
    bloqueado: 'Bloqueadas pelo navegador. Libere nas configurações do site (ícone do cadeado ao lado do endereço).',
    indisponivel: 'Este navegador não suporta notificações.',
    'precisa-instalar': 'No iPhone/iPad, adicione o site à Tela de Início para receber notificações.',
  };

  return (
    <section>
      <div className="form">
        <Switch marcado={som} aoMudar={(v) => { setSom(v); definirSom(v); if (v) tocarAlerta('pedido'); }}>
          Tocar som quando chegar pedido ou chamado
        </Switch>
        <div className="estado-push">
          <span className={cx('badge', estado === 'ativo' ? 'badge--verde' : 'badge--amarelo')}>{estado === 'ativo' ? 'Notificações ligadas' : 'Notificações desligadas'}</span>
        </div>
        {estado && <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>{textos[estado]}</p>}
        {estado === 'ativo' ? (
          <button className="btn btn--contorno" onClick={() => void desativar()} disabled={ocupado}>Desativar neste aparelho</button>
        ) : (
          <button className="btn btn--primario" onClick={() => void ativar()} disabled={ocupado || estado === 'indisponivel'}>Ativar notificações</button>
        )}
        <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
          Para os garçons: abram <b>{window.location.origin}/garcom</b> no celular, entrem com o login deles e toquem em “Ativar notificações”.
        </p>
      </div>
    </section>
  );
}
