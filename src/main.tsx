import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ProvedorSessao } from './lib/sessao';
import { ProvedorToast } from './componentes/Toast';
import { destravarSom } from './lib/som';
import './estilos/base.css';

// O navegador só libera som depois do primeiro toque/clique
window.addEventListener('pointerdown', destravarSom, { once: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProvedorToast>
        <ProvedorSessao>
          <App />
        </ProvedorSessao>
      </ProvedorToast>
    </BrowserRouter>
  </React.StrictMode>,
);
