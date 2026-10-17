import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErroGeral } from './componentes/ErroGeral';
import { ProvedorSessao } from './lib/sessao';
import { ProvedorToast } from './componentes/Toast';
import { ProvedorConfirmar } from './componentes/Confirmar';
import { destravarSom } from './lib/som';
import { limparParametroDeRecarga, recarregarUmaVez } from './lib/carregamento';
import './estilos/base.css';

// O navegador só libera som depois do primeiro toque/clique
window.addEventListener('pointerdown', destravarSom, { once: true });

// Uma parte do sistema não baixou (ex.: logo após uma atualização): recarrega sozinho, uma vez
window.addEventListener('vite:preloadError', (e) => {
  if (recarregarUmaVez()) e.preventDefault();
});

limparParametroDeRecarga();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErroGeral>
      <BrowserRouter>
        <ProvedorToast>
          <ProvedorSessao>
            <ProvedorConfirmar>
              <App />
            </ProvedorConfirmar>
          </ProvedorSessao>
        </ProvedorToast>
      </BrowserRouter>
    </ErroGeral>
  </React.StrictMode>,
);
