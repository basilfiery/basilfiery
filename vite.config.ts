import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Identificador da versão do SISTEMA: um resumo do conteúdo (src, public, index.html e dependências).
 * Push que não muda o sistema (ex.: só arquivos do GitHub) gera a mesma versão e não pede atualização
 * a quem está com o sistema aberto. Duas publicações do mesmo código também dão a mesma versão.
 */
function versaoDoConteudo(): string {
  const h = createHash('sha1');
  const juntar = (caminho: string) => {
    const info = statSync(caminho, { throwIfNoEntry: false });
    if (!info) return;
    if (info.isDirectory()) {
      for (const nome of readdirSync(caminho).sort()) juntar(join(caminho, nome));
      return;
    }
    h.update(caminho.split('\\').join('/'));
    h.update(readFileSync(caminho));
  };
  ['index.html', 'package.json', 'package-lock.json', 'src', 'public'].forEach(juntar);
  return h.digest('hex');
}
const VERSAO = versaoDoConteudo();

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
