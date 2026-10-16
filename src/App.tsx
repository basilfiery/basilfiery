import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Carregando } from './componentes/Carregando';
import { ExigeLogin } from './lib/sessao';

const Site = lazy(() => import('./paginas/site/Site'));
const Login = lazy(() => import('./paginas/Login'));
const Mesa = lazy(() => import('./paginas/mesa/Mesa'));
const Garcom = lazy(() => import('./paginas/garcom/Garcom'));
const Plataforma = lazy(() => import('./paginas/plataforma/Plataforma'));
const Painel = lazy(() => import('./paginas/painel/Painel'));
const Pedidos = lazy(() => import('./paginas/painel/Pedidos'));
const Mesas = lazy(() => import('./paginas/painel/Mesas'));
const Cardapio = lazy(() => import('./paginas/painel/Cardapio'));
const Estoque = lazy(() => import('./paginas/painel/Estoque'));
const Equipe = lazy(() => import('./paginas/painel/Equipe'));
const Configuracoes = lazy(() => import('./paginas/painel/Configuracoes'));
const Relatorios = lazy(() => import('./paginas/painel/Relatorios'));

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
          <Route path="equipe" element={<Equipe />} />
          <Route path="config" element={<Configuracoes />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
