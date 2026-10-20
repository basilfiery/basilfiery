// BasilFiery para Windows.
// Abre o sistema online (mesmos dados do site, atualiza sozinho a cada publicação)
// e acrescenta o que só um programa instalado consegue: impressão direta na
// térmica, ícone perto do relógio, iniciar com o Windows e avisos minimizado.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Endereço que o programa abre (troca para o domínio próprio quando ele estiver no ar)
const SITE = 'https://basilfiery.vercel.app';
// Endereços do sistema: navegar entre eles fica dentro do programa
const SITES = ['https://basilfiery.vercel.app', 'https://basilfiery.com.br', 'https://www.basilfiery.com.br', 'https://basilfiery.com', 'https://www.basilfiery.com'];
const INICIO = `${SITE}/painel`;
// .ico tem uma versão desenhada para cada tamanho (barra de tarefas, relógio): fica nítido
const ICONE = path.join(__dirname, process.platform === 'win32' ? 'icone.ico' : 'icone.png');

let janela = null;
let bandeja = null;
let saindo = false;
let avisouBandeja = false;

app.setAppUserModelId('com.basilfiery.app');
// Som de pedido novo toca mesmo sem clicar na janela antes
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', mostrar);
  app.whenReady().then(iniciar);
}

function iniciar() {
  primeiraExecucao();
  criarJanela();
  criarBandeja();
}

function doSite(url) {
  return typeof url === 'string' && SITES.some((s) => url === s || url.startsWith(`${s}/`));
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'BasilFiery',
    icon: ICONE,
    backgroundColor: '#121010',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Continua recebendo pedidos e tocando som com a janela minimizada
      backgroundThrottling: false,
    },
  });
  janela.removeMenu();

  janela.once('ready-to-show', () => {
    if (!process.argv.includes('--oculto')) janela.show();
  });

  janela.loadURL(INICIO);

  // Sem internet: mostra uma tela que tenta de novo sozinha
  janela.webContents.on('did-fail-load', (_e, codigo, _desc, _url, principal) => {
    if (principal && codigo !== -3) janela.loadFile(path.join(__dirname, 'offline.html'));
  });

  // Se a página travar ou fechar sozinha, recarrega limpo (nunca deixa a tela preta)
  janela.webContents.on('render-process-gone', () => {
    janela.webContents.session.clearCache().finally(() => janela.loadURL(INICIO));
  });
  janela.webContents.on('unresponsive', () => janela.webContents.reloadIgnoringCache());

  // Links de fora (WhatsApp, link do tablet etc.) abrem no navegador
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (!doSite(url) && !url.startsWith('file:')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  janela.webContents.on('before-input-event', (e, tecla) => {
    if (tecla.type !== 'keyDown') return;
    if (tecla.key === 'F5') { janela.webContents.reload(); e.preventDefault(); }
    if (tecla.key === 'F12') janela.webContents.toggleDevTools();
  });

  // Fechar no X só esconde: o caixa continua recebendo e imprimindo pedidos
  janela.on('close', (e) => {
    if (saindo) return;
    e.preventDefault();
    janela.hide();
    if (!avisouBandeja && bandeja) {
      avisouBandeja = true;
      bandeja.displayBalloon({
        iconType: 'info',
        title: 'O BasilFiery continua aberto',
        content: 'Os pedidos continuam chegando e imprimindo. Para fechar de vez: botão direito no ícone perto do relógio → Sair.',
      });
    }
  });
}

function mostrar() {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

function criarBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(ICONE));
  bandeja.setToolTip('BasilFiery: recebendo pedidos');
  bandeja.on('click', mostrar);
  atualizarMenu();
}

function atualizarMenu() {
  const auto = app.getLoginItemSettings().openAtLogin;
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir BasilFiery', click: mostrar },
    { label: 'Recarregar', click: () => { janela.loadURL(INICIO); mostrar(); } },
    { type: 'separator' },
    { label: 'Abrir quando o Windows iniciar', type: 'checkbox', checked: auto, click: (item) => definirAutoInicio(item.checked) },
    { type: 'separator' },
    { label: 'Sair (para de receber pedidos)', click: () => { saindo = true; app.quit(); } },
  ]));
}

function definirAutoInicio(ligado) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: ligado, args: ['--oculto'] });
  if (bandeja) atualizarMenu();
}

// Na primeira vez que o programa instalado abre, liga o "iniciar com o Windows"
function primeiraExecucao() {
  const marca = path.join(app.getPath('userData'), 'ja-configurado');
  if (fs.existsSync(marca)) return;
  definirAutoInicio(true);
  try { fs.writeFileSync(marca, new Date().toISOString()); } catch { /* sem problema */ }
}

/* ------------------------- Ponte com o sistema ------------------------- */

function veioDoSite(evento) {
  return doSite(evento.senderFrame && evento.senderFrame.url);
}

ipcMain.handle('bf:mostrar', (e) => { if (veioDoSite(e)) mostrar(); });

// Atualizar o sistema: limpa as cópias guardadas e recarrega tudo do servidor
ipcMain.handle('bf:recarregar', async (e) => {
  if (!veioDoSite(e)) return;
  await janela.webContents.session.clearCache();
  janela.webContents.reloadIgnoringCache();
});

ipcMain.handle('bf:impressoras', async (e) => {
  if (!veioDoSite(e)) return [];
  const lista = await janela.webContents.getPrintersAsync();
  return lista.map((p) => ({ nome: p.name, padrao: !!p.isDefault }));
});

// Impressão direta, sem janela de confirmação, no tamanho do cupom
ipcMain.handle('bf:imprimir', async (e, { html, larguraMm, impressora }) => {
  if (!veioDoSite(e)) throw new Error('Origem não autorizada');
  const largura = larguraMm === 58 ? 58 : 80;
  const w = new BrowserWindow({
    show: false,
    width: Math.round((largura * 96) / 25.4) + 24,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html))}`);
    const alturaPx = await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
    const alturaMicrons = Math.max(Math.ceil((alturaPx * 25400) / 96) + 6000, 60000);
    await new Promise((ok, falhou) => {
      w.webContents.print(
        {
          silent: true,
          printBackground: false,
          deviceName: impressora || '',
          margins: { marginType: 'none' },
          pageSize: { width: largura * 1000, height: alturaMicrons },
        },
        (sucesso, motivo) => (sucesso ? ok() : falhou(new Error(motivo || 'Falha ao imprimir'))),
      );
    });
  } finally {
    w.destroy();
  }
});

app.on('before-quit', () => { saindo = true; });
app.on('window-all-closed', () => { /* continua na bandeja */ });
