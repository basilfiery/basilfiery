// Gera o APK do app do garçom (Trusted Web Activity) e copia para public/apps/.
// Uso: npm i && npm run gerar   (precisa do Android Studio instalado)
// A chave de assinatura fica FORA do projeto: C:/Users/<você>/Documents/BasilFiery-chaves/
import { ConsoleLog, TwaGenerator, TwaManifest } from '@bubblewrap/core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const VERSAO = '1.0.0';
const CODIGO_VERSAO = 1; // aumente a cada APK novo

const HOME = os.homedir();
const CHAVES = path.join(HOME, 'Documents', 'BasilFiery-chaves');
const KEYSTORE = path.join(CHAVES, 'garcom-android.keystore');
const SENHA = fs.readFileSync(path.join(CHAVES, 'LEIA-ME-senha.txt'), 'utf8').match(/Senha[^:]*:\s*(\S+)/)[1];
const JAVA_HOME = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr';
const SDK = process.env.ANDROID_HOME || path.join(HOME, 'AppData', 'Local', 'Android', 'Sdk');
const BUILD_TOOLS = path.join(SDK, 'build-tools', fs.readdirSync(path.join(SDK, 'build-tools')).sort().at(-1));
const PROJETO = path.resolve('projeto');
const SAIDA = path.resolve('..', 'public', 'apps', 'basilfiery-garcom.apk');

const manifesto = new TwaManifest({
  packageId: 'br.com.basilfiery.garcom',
  host: 'basilfiery.com.br',
  name: 'BasilFiery Garçom',
  launcherName: 'Garçom',
  display: 'standalone',
  orientation: 'portrait',
  themeColor: '#121010',
  themeColorDark: '#121010',
  navigationColor: '#121010',
  navigationColorDark: '#121010',
  backgroundColor: '#121010',
  enableNotifications: true,
  startUrl: '/g',
  iconUrl: 'https://basilfiery.com.br/icone-512.png',
  maskableIconUrl: 'https://basilfiery.com.br/icone-512.png',
  appVersion: VERSAO,
  appVersionCode: CODIGO_VERSAO,
  signingKey: { path: KEYSTORE, alias: 'basilfiery-garcom' },
  fallbackType: 'customtabs',
  enableSiteSettingsShortcut: false,
  minSdkVersion: 24, // Android 7 ou mais novo
  splashScreenFadeOutDuration: 300,
  shortcuts: [],
  features: {},
  alphaDependencies: { enabled: false },
  isChromeOSOnly: false,
  isMetaQuest: false,
});

fs.rmSync(PROJETO, { recursive: true, force: true });
await new TwaGenerator().createTwaProject(PROJETO, manifesto, new ConsoleLog('gerar'));
fs.writeFileSync(path.join(PROJETO, 'local.properties'), `sdk.dir=${SDK.split(path.sep).join('/')}\n`);

const env = { ...process.env, JAVA_HOME, ANDROID_HOME: SDK };
const WIN = process.platform === 'win32';
/** No Windows os .bat precisam de shell: põe aspas nos caminhos com espaço */
const rodar = (cmd, args, opcoes = {}) => execFileSync(WIN ? `"${cmd}"` : cmd, WIN ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args, { env, stdio: 'inherit', shell: WIN, ...opcoes });
rodar(path.join(PROJETO, WIN ? 'gradlew.bat' : 'gradlew'), ['assembleRelease', '--no-daemon', '-q'], { cwd: PROJETO });

const semAssinatura = path.join(PROJETO, 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
const alinhado = path.join(PROJETO, 'app-alinhado.apk');
execFileSync(path.join(BUILD_TOOLS, `zipalign${WIN ? '.exe' : ''}`), ['-f', '-p', '4', semAssinatura, alinhado], { stdio: 'inherit' });
fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
rodar(path.join(BUILD_TOOLS, `apksigner${WIN ? '.bat' : ''}`), [
  'sign', '--ks', KEYSTORE, '--ks-key-alias', 'basilfiery-garcom', '--ks-pass', `pass:${SENHA}`, '--key-pass', `pass:${SENHA}`,
  '--out', SAIDA, alinhado,
]);
fs.rmSync(`${SAIDA}.idsig`, { force: true });
console.log(`\nAPK pronto: ${SAIDA} (${(fs.statSync(SAIDA).size / 1024 / 1024).toFixed(1)} MB)`);
