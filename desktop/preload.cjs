const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openForensicAgent", Object.freeze({
  connect: (apiKey) => ipcRenderer.invoke("agent:connect", apiKey),
  disconnect: () => ipcRenderer.invoke("agent:disconnect"),
  signInChatGPT: () => ipcRenderer.invoke("agent:sign-in-chatgpt"),
  signOutChatGPT: () => ipcRenderer.invoke("agent:sign-out-chatgpt"),
  ask: (request) => ipcRenderer.invoke("agent:ask", request),
  status: () => ipcRenderer.invoke("agent:status"),
}));
