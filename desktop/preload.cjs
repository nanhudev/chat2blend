const { contextBridge, ipcRenderer } = require('electron');
const methods = new Set(['status', 'signIn', 'logout', 'models', 'usage', 'directory', 'blender', 'generate', 'buildRobot', 'execute', 'exportPpt', 'openOutput', 'save']);
contextBridge.exposeInMainWorld('desktop', {
  async call(method, payload) {
    if (!methods.has(method)) throw new Error('Unsupported operation');
    const result = await ipcRenderer.invoke('action', method, payload);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onProgress(callback) { ipcRenderer.on('progress', (_event, data) => callback(data)); },
});
