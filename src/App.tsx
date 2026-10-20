import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Carregando } from './componentes/Carregando';
import { ExigeLogin } from './lib/sessao';
import { recarregarUmaVez } from './lib/carregamento';
import { ehHostSistema } from './lib/linkCurto';

/** Carrega uma tela; se o arquivo dela não existir mais (sistema atualizado), recarrega sozinho. */
function tela(carregar: () => Promise<{ default: ComponentType }>) {
  return lazy(() => carregar().catch((erro) => {
    if (recarregarUmaVez()) return new Promise<never>(() => {});
    throw erro;
  }));
}

const Site = tela(() => import('./paginas/site/Site'));
const Login = tela(() => import('./paginas/Login'));
const Ativar = tela(() => import('./paginas/Ativar'));
const Termos = tela(() => import('./paginas/site/Legal'));
const Privacidade = tela(() => import('./paginas/site/Legal').then((m) => ({ default: m.Privacidade })));
const TermosPoliticas = tela(() => import('./paginas/painel/TermosPoliticas'));
const NotasFiscais = tela(() => import('./paginas/painel/NotasFiscais'));
const Mesa = tela(() => import('./paginas/mesa/Mesa'));
const Garcom = tela(() => import('./paginas/garcom/Garcom'));
const AppGarcom = tela(() => import('./paginas/garcom/AppGarcom'));
const Dono = tela(() => import('./paginas/dono/Dono'));
const Loja = tela(() => import('./paginas/loja/Loja'));
const LojaPedido = tela(() => import('./paginas/loja/Loja').then((m) => ({ default: m.LojaPedido })));
const AppGarcomGeral = tela(() => import('./paginas/garcom/AppGarcom').then((m) => ({ default: m.AppGarcomGeral })));
const AppGarcomInicio = tela(() => import('./paginas/garcom/AppGarcom').then((m) => ({ default: m.AppGarcomInicio })));
const Plataforma = tela(() => import('./paginas/plataforma/Plataforma'));
const Painel = tela(() => import('./paginas/painel/Painel'));
const Pedidos = tela(() => import('./paginas/painel/Pedidos'));
const Mesas = tela(() => import('./paginas/painel/Mesas'));
const Cardapio = tela(() => import('./paginas/painel/Cardapio'));
const Estoque = tela(() => import('./paginas/painel/Estoque'));
const Equipe = tela(() => import('./paginas/painel/Equipe'));
const Garcons = tela(() => import('./paginas/painel/Garcons'));
const Configuracoes = tela(() => import('./paginas/painel/Configuracoes'));
const Conta = tela(() => import('./paginas/painel/Conta'));
const Relatorios = tela(() => import('./paginas/painel/Relatorios'));
const Pdv = tela(() => import('./paginas/painel/Pdv'));
const Compras = tela(() => import('./paginas/painel/Compras'));
const Aparencia = tela(() => import('./paginas/painel/Aparencia'));
const AppsCelular = tela(() => import('./paginas/painel/AppsCelular'));
const LinkCurto = tela(() => import('./paginas/LinkCurto'));
const LinkAssinante = tela(() => import('./paginas/LinkCurto').then((m) => ({ default: m.LinkAssinante })));
const LinkDominio = tela(() => import('./paginas/LinkCurto').then((m) => ({ default: m.LinkDominio })));
const Dominios = tela(() => import('./paginas/painel/Dominios'));
const ListaCompras = tela(() => import('./paginas/compras/ListaCompras'));

/** Telas do painel: baixadas em segundo plano para trocar de aba sem esperar. */
const TELAS_PAINEL = [
  () => import('./paginas/painel/Pedidos'), () => import('./paginas/painel/Mesas'), () => import('./paginas/painel/Pdv'),
  () => import('./paginas/painel/Cardapio'), () => import('./paginas/painel/Estoque'), () => import('./paginas/painel/Relatorios'),
  () => import('./paginas/painel/Garcons'), () => import('./paginas/painel/Equipe'), () => import('./paginas/painel/Configuracoes'),
  () => import('./paginas/painel/Conta'), () => import('./paginas/painel/Compras'), () => import('./paginas/painel/Aparencia'),
  () => import('./paginas/painel/AppsCelular'), () => import('./paginas/painel/NotasFiscais'), () => import('./paginas/painel/Dominios'),
  () => import('./paginas/painel/TermosPoliticas'), () => import('./paginas/mesa/Mesa'),
];

function usePrecarregarPainel() {
  const noPainel = useLocation().pathname.startsWith('/painel');
  useEffect(() => {
    if (!noPainel) return;
    const t = setTimeout(() => TELAS_PAINEL.forEach((carregar) => void carregar().catch(() => {})), 800);
    return () => clearTimeout(t);
  }, [noPainel]);
}

// Aberto pelo domínio próprio de uma loja (plano Premium): só o cardápio e as mesas dela
const DOMINIO_PROPRIO = !ehHostSistema();

function RotasDominio() {
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/" element={<LinkDominio />} />
        <Route path="/cardapio" element={<LinkDominio />} />
        <Route path="/pedido/:acompanhar" element={<LinkDominio />} />
        <Route path="/termos" element={<Termos />} />
        <Route path="/privacidade" element={<Privacidade />} />
        <Route path="/mesa/:token" element={<Mesa />} />
        <Route path="/:mesa" element={<LinkDominio />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  usePrecarregarPainel();
  if (DOMINIO_PROPRIO) return <RotasDominio />;
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/" element={<Site />} />
        <Route path="/login" element={<Login />} />
        <Route path="/ativar" element={<Ativar />} />
        <Route path="/termos" element={<Termos />} />
        <Route path="/privacidade" element={<Privacidade />} />
        <Route path="/mesa/:token" element={<Mesa />} />
        <Route path="/dono" element={<Dono />} />
        <Route path="/loja/:codigo" element={<Loja />} />
        <Route path="/loja/:codigo/pedido/:acompanhar" element={<LojaPedido />} />
        <Route path="/lista/:codigo" element={<ListaCompras />} />
        <Route path="/colaboradores/:codigo" element={<ListaCompras />} />
        <Route path="/appgarcom" element={<AppGarcomGeral />} />
        <Route path="/colaboradores" element={<ListaCompras />} />
        <Route path="/g" element={<AppGarcomInicio />} />
        <Route path="/g/:codigo" element={<AppGarcom />} />
        <Route path="/garcom" element={<ExigeLogin><Garcom /></ExigeLogin>} />
        <Route path="/plataforma" element={<Plataforma />} />
        <Route path="/painel" element={<ExigeLogin><Painel /></ExigeLogin>}>
          <Route index element={<Pedidos />} />
          <Route path="mesas" element={<Mesas />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="cardapio" element={<Cardapio />} />
          <Route path="cardapio/aparencia" element={<Aparencia />} />
          <Route path="apps" element={<AppsCelular />} />
          <Route path="termos" element={<TermosPoliticas />} />
          <Route path="notas" element={<NotasFiscais />} />
          <Route path="dominios" element={<Dominios />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="garcons" element={<Garcons />} />
          <Route path="equipe" element={<Equipe />} />
          <Route path="pdv" element={<Pdv />} />
          <Route path="compras" element={<Compras />} />
          <Route path="config" element={<Configuracoes />} />
          <Route path="config/:aba" element={<Configuracoes />} />
          <Route path="conta" element={<Conta />} />
          <Route path="conta/:aba" element={<Conta />} />
        </Route>
        {/* Plano Start: /assinante/<loja>/cardapio, /assinante/<loja>/mesa1, /assinante/<loja>/pedido/<x> */}
        <Route path="/assinante/:loja" element={<LinkAssinante />} />
        <Route path="/assinante/:loja/cardapio" element={<LinkAssinante />} />
        <Route path="/assinante/:loja/pedido/:acompanhar" element={<LinkAssinante />} />
        <Route path="/assinante/:loja/:mesa" element={<LinkAssinante />} />
        {/* Loja principal (/cardapio, /mesa1) e links antigos /<loja> */}
        <Route path="/:loja" element={<LinkCurto />} />
        <Route path="/:loja/:mesa" element={<LinkCurto />} />
        <Route path="/:loja/pedido/:acompanhar" element={<LinkCurto />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
