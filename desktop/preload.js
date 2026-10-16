// Expõe ao sistema só o necessário: imprimir direto, listar impressoras e trazer a janela.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('basilfieryDesktop', {
  imprimir: (html, larguraMm, impressora) => ipcRenderer.invoke('bf:imprimir', { html, larguraMm, impressora }),
  impressoras: () => ipcRenderer.invoke('bf:impressoras'),
  mostrar: () => ipcRenderer.invoke('bf:mostrar'),
});
