// BasilFiery para Windows.
// Abre o sistema online (mesmos dados do site, atualiza sozinho a cada publicação)
// e acrescenta o que só um programa instalado consegue: impressão direta na
// térmica, ícone perto do relógio, iniciar com o Windows e avisos minimizado.
const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// Endereço que o programa abre (troca para o domínio próprio quando ele estiver no ar)
const SITE = 'https://basilfiery.com.br';
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
  iniciarAtualizacao();
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
    atualizacaoPronta
      ? { label: `Instalar a versão ${atualizacaoPronta} agora (reinicia em segundos)`, click: () => instalarAtualizacao() }
      : { label: `Versão ${app.getVersion()}: procurar atualização`, click: () => procurarAtualizacao(true) },
    { type: 'separator' },
    { label: 'Abrir quando o Windows iniciar', type: 'checkbox', checked: auto, click: (item) => definirAutoInicio(item.checked) },
    { type: 'separator' },
    { label: 'Sair (para de receber pedidos)', click: () => { saindo = true; app.quit(); } },
  ]));
}

/* ------------------------- Atualização automática ------------------------- */
// O programa procura versão nova sozinho (ao abrir e a cada 3 horas), baixa em segundo plano
// e instala sem atrapalhar o atendimento:
// - se acabou de abrir (ainda sem movimento), instala na hora;
// - com o programa em uso, instala de madrugada (3h às 6h) ou quando o programa for fechado;
// - ou na hora, pelo menu do ícone perto do relógio.
let atualizacaoPronta = null;
const abertoEm = Date.now();
let atualizador = null;

function iniciarAtualizacao() {
  if (!app.isPackaged) return;
  try {
    atualizador = require('electron-updater').autoUpdater;
  } catch {
    return;
  }
  atualizador.autoDownload = true;
  atualizador.autoInstallOnAppQuit = true;
  atualizador.on('update-downloaded', (info) => {
    atualizacaoPronta = info.version;
    if (bandeja) {
      atualizarMenu();
      bandeja.setToolTip(`BasilFiery: versão ${info.version} pronta para instalar`);
    }
    if (Date.now() - abertoEm < 3 * 60000) instalarAtualizacao();
  });
  atualizador.on('error', () => { /* sem internet ou servidor fora: tenta de novo depois */ });
  procurarAtualizacao(false);
  setInterval(() => procurarAtualizacao(false), 3 * 3600e3);
  // De madrugada (3h às 6h), com atualização baixada: instala
  setInterval(() => {
    const h = new Date().getHours();
    if (atualizacaoPronta && h >= 3 && h < 6) instalarAtualizacao();
  }, 10 * 60000);
}

function procurarAtualizacao(avisar) {
  if (!atualizador) return;
  atualizador.checkForUpdates().then((r) => {
    if (!avisar || !bandeja) return;
    const nova = r && r.updateInfo && r.updateInfo.version !== app.getVersion();
    bandeja.displayBalloon({
      title: 'BasilFiery',
      content: nova ? `Baixando a versão ${r.updateInfo.version}. Ela instala sozinha.` : `Você já está na versão mais nova (${app.getVersion()}).`,
      iconType: 'info',
    });
  }).catch(() => {
    if (avisar && bandeja) bandeja.displayBalloon({ title: 'BasilFiery', content: 'Não deu para procurar atualização agora (sem internet?).', iconType: 'warning' });
  });
}

function instalarAtualizacao() {
  if (!atualizador || !atualizacaoPronta) return;
  saindo = true;
  // Silencioso e abre de novo sozinho
  setImmediate(() => atualizador.quitAndInstall(true, true));
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

// Nome do computador: o garçom vê em qual computador a conta imprimiu (ou falhou)
ipcMain.handle('bf:computador', (e) => (veioDoSite(e) ? require('os').hostname() : ''));

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
    // Já vai montando o cupom enquanto descobre a impressora (a escolhida ou a padrão do Windows)
    const [lista] = await Promise.all([
      janela.webContents.getPrintersAsync().catch(() => []),
      w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html))}`),
    ]);
    const nome = impressora || (lista.find((p) => p.isDefault) || {}).name || '';
    if (impressora && lista.length && !lista.some((p) => p.name === impressora)) {
      throw new Error(`A impressora "${impressora}" não está instalada neste computador`);
    }
    const alturaPx = await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
    const alturaMicrons = Math.max(Math.ceil((alturaPx * 25400) / 96) + 6000, 60000);
    // Manda para a impressora NA HORA; a conferência vem depois, sem atrasar o papel
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

    // O Windows diz "ok" só por pôr na fila, mesmo com a impressora desligada.
    // Confere se o cupom saiu da fila (a térmica leva 1 a 3 s); com erro ou parado, é falha de verdade.
    if (nome) {
      const ini = Date.now();
      while (Date.now() - ini < 12000) {
        await new Promise((r) => setTimeout(r, 400));
        const agora = await filaImpressora(nome);
        if (!agora) return; // não deu para conferir: confia no Windows
        if (agora.total === 0) return; // saiu da fila: imprimiu
        // O Windows marca "Erro" logo que a impressora não responde (desligada, sem cabo, está em outro computador)
        if (agora.erros > 0 || agora.parados > 0) break;
      }
      // Tira o cupom parado: quando a impressora voltar, não sai uma pilha de contas antigas
      await limparFila(nome);
      throw new Error(IMPRESSORA_PARADA);
    }
  } finally {
    w.destroy();
  }
});

const IMPRESSORA_PARADA = 'A impressora não está imprimindo: confira se está ligada, com o cabo conectado e com papel';

/*
 * PowerShell que fica aberto: abrir um novo leva ~2 s a cada consulta; aberto, responde em décimos de segundo.
 * Se ele travar ou fechar, abre outro; se nem assim der, usa o jeito antigo (um PowerShell por consulta).
 */
let ps = null;
let filaPs = Promise.resolve();
function abrirPs() {
  if (ps && ps.exitCode === null && !ps.killed) return ps;
  try {
    ps = require('child_process').spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true });
    ps.stdout.setEncoding('utf8');
    ps.on('error', () => { ps = null; });
    ps.on('exit', () => { ps = null; });
    ps.stdin.on('error', () => { ps = null; });
  } catch {
    ps = null;
  }
  return ps;
}
function rodarPs(cmd) {
  const rodar = () => new Promise((ok) => {
    const p = abrirPs();
    if (!p) {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, timeout: 10000 }, (erro, saida) => ok(erro ? null : String(saida || '')));
      return;
    }
    const marca = `__bf_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    let saida = '';
    const aoDado = (d) => {
      saida += d;
      const i = saida.indexOf(marca);
      if (i >= 0) { fim(); ok(saida.slice(0, i)); }
    };
    const limite = setTimeout(() => { fim(); try { p.kill(); } catch { /* já fechou */ } ps = null; ok(null); }, 10000);
    const fim = () => { clearTimeout(limite); p.stdout.off('data', aoDado); };
    p.stdout.on('data', aoDado);
    try {
      p.stdin.write(`try { ${cmd} } catch { 'ERRO' }\nWrite-Output '${marca}'\n`);
    } catch {
      fim(); ps = null; ok(null);
    }
  });
  const r = filaPs.then(rodar);
  filaPs = r.then(() => undefined, () => undefined);
  return r;
}
// Deixa o PowerShell pronto logo que o programa abre (a primeira conferência já sai rápida)
app.whenReady().then(() => { if (process.platform === 'win32') void rodarPs("'ok'"); });

/** Trabalhos na fila da impressora do Windows: total, parados há mais de 30 s e com erro. null = não deu para ver. */
async function filaImpressora(nome) {
  const n = nome.replace(/'/g, "''");
  const cmd = `$j = @(Get-PrintJob -PrinterName '${n}' -ErrorAction Stop | Where-Object { [string]$_.JobStatus -notmatch 'Printed|Complete|Deleted' }); $p = @($j | Where-Object { $_.SubmittedTime -lt (Get-Date).AddSeconds(-30) }); $e = @($j | Where-Object { [string]$_.JobStatus -match 'Error|Offline|Paused|PaperOut|UserIntervention|Blocked' }); "FILA $($j.Count) $($p.Count) $($e.Count)"`;
  const saida = await rodarPs(cmd);
  const m = /FILA (\d+)\s+(\d+)\s+(\d+)/.exec(String(saida || ''));
  return m ? { total: Number(m[1]), parados: Number(m[2]), erros: Number(m[3]) } : null;
}

/** Apaga da fila os cupons que não saíram (só os deste usuário; não precisa de administrador). */
async function limparFila(nome) {
  const n = nome.replace(/'/g, "''");
  await rodarPs(`Get-PrintJob -PrinterName '${n}' -ErrorAction SilentlyContinue | Where-Object { [string]$_.JobStatus -notmatch 'Printed|Complete|Deleted' } | ForEach-Object { Remove-PrintJob -InputObject $_ -ErrorAction SilentlyContinue }; 'ok'`);
}

app.on('before-quit', () => { saindo = true; });
app.on('window-all-closed', () => { /* continua na bandeja */ });
