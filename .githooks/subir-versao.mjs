// Antes de cada commit que muda o sistema (src, public, index.html): versão + 1.
// Os dígitos contam as atualizações: 1.3.5 = 135ª. Depois de 1.3.9 vem 1.4.0; depois de 1.9.9, 2.0.0.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const alterados = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n');
if (!alterados.some((f) => /^(src\/|public\/|index\.html$)/.test(f))) process.exit(0);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [a, b, c] = pkg.version.split('.').map(Number);
const n = a * 100 + b * 10 + c + 1;
const nova = `${Math.floor(n / 100)}.${Math.floor(n / 10) % 10}.${n % 10}`;

const trocar = (arq, conta) => {
  let txt = readFileSync(arq, 'utf8');
  let feitas = 0;
  txt = txt.replace(/"version": "[^"]+"/g, (m) => (feitas++ < conta ? `"version": "${nova}"` : m));
  writeFileSync(arq, txt);
};
trocar('package.json', 1);
trocar('package-lock.json', 2); // raiz do lock e o pacote "" dele
execSync('git add package.json package-lock.json');
console.log(`Versão do sistema: ${pkg.version} -> ${nova}`);
