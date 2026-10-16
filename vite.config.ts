import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Identificador desta publicação: o commit na Vercel, ou a hora do build no computador.
const VERSAO = process.env.VERCEL_GIT_COMMIT_SHA || `local-${Date.now()}`;

/** Publica /versao.json para quem está com o sistema aberto descobrir que saiu atualização. */
function arquivoVersao(): Plugin {
  return {
    name: 'arquivo-versao',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'versao.json', source: JSON.stringify({ versao: VERSAO }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), arquivoVersao()],
  define: { __VERSAO__: JSON.stringify(VERSAO) },
  server: { port: 5173, host: true },
});
