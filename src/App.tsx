import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Carregando } from './componentes/Carregando';
import { ExigeLogin } from './lib/sessao';
import { recarregarUmaVez } from './lib/carregamento';

/** Carrega uma tela; se o arquivo dela não existir mais (sistema atualizado), recarrega sozinho. */
function tela(carregar: () => Promise<{ default: ComponentType }>) {
  return lazy(() => carregar().catch((erro) => {
    if (recarregarUmaVez()) return new Promise<never>(() => {});
    throw erro;
  }));
}

const Site = tela(() => import('./paginas/site/Site'));
const Login = tela(() => import('./paginas/Login'));
const Mesa = tela(() => import('./paginas/mesa/Mesa'));
const Garcom = tela(() => import('./paginas/garcom/Garcom'));
const Plataforma = tela(() => import('./paginas/plataforma/Plataforma'));
const Painel = tela(() => import('./paginas/painel/Painel'));
const Pedidos = tela(() => import('./paginas/painel/Pedidos'));
const Mesas = tela(() => import('./paginas/painel/Mesas'));
const Cardapio = tela(() => import('./paginas/painel/Cardapio'));
const Estoque = tela(() => import('./paginas/painel/Estoque'));
const Equipe = tela(() => import('./paginas/painel/Equipe'));
const Garcons = tela(() => import('./paginas/painel/Garcons'));
const Configuracoes = tela(() => import('./paginas/painel/Configuracoes'));
const Relatorios = tela(() => import('./paginas/painel/Relatorios'));

export default function App() {
  return (
    <Suspense fallback={<Carregando />}>
      <Routes>
        <Route path="/" element={<Site />} />
        <Route path="/login" element={<Login />} />
        <Route path="/mesa/:token" element={<Mesa />} />
        <Route path="/garcom" element={<ExigeLogin><Garcom /></ExigeLogin>} />
        <Route path="/plataforma" element={<Plataforma />} />
        <Route path="/painel" element={<ExigeLogin><Painel /></ExigeLogin>}>
          <Route index element={<Pedidos />} />
          <Route path="mesas" element={<Mesas />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="cardapio" element={<Cardapio />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="garcons" element={<Garcons />} />
          <Route path="equipe" element={<Equipe />} />
          <Route path="config" element={<Configuracoes />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
