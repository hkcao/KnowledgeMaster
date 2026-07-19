'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('knowledge', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  chooseFiles: () => ipcRenderer.invoke('documents:choose-files'),
  chooseFolder: () => ipcRenderer.invoke('documents:choose-folder'),
  importDroppedFiles: (files) => ipcRenderer.invoke('documents:import-paths', Array.from(files).map((file) => webUtils.getPathForFile(file))),
  getDocument: (id) => ipcRenderer.invoke('documents:get', id),
  deleteDocument: (id) => ipcRenderer.invoke('documents:delete', id),
  search: (query, topicId) => ipcRenderer.invoke('documents:search', { query, topicId }),
  createTopic: (name, parentId) => ipcRenderer.invoke('topics:create', { name, parentId }),
  renameTopic: (id, name) => ipcRenderer.invoke('topics:rename', { id, name }),
  deleteTopic: (id) => ipcRenderer.invoke('topics:delete', id),
  linkDocument: (documentId, topicId) => ipcRenderer.invoke('topics:link', { documentId, topicId }),
  unlinkDocument: (documentId, topicId) => ipcRenderer.invoke('topics:unlink', { documentId, topicId }),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  clearApiKey: () => ipcRenderer.invoke('settings:clear-key'),
  testSettings: (settings) => ipcRenderer.invoke('settings:test', settings),
  openDataDirectory: () => ipcRenderer.invoke('system:open-data-directory'),
  chooseLibraryRoot: () => ipcRenderer.invoke('library:choose-root'),
  switchLibraryRoot: (targetPath, migrate) => ipcRenderer.invoke('library:switch-root', { targetPath, migrate }),
  getConversation: (id) => ipcRenderer.invoke('conversations:get', id),
  deleteConversation: (id) => ipcRenderer.invoke('conversations:delete', id),
  sendMessage: (payload) => ipcRenderer.invoke('conversations:send', payload),
  summarizeConversation: (id) => ipcRenderer.invoke('conversations:summarize', id),
  summarizeTopic: (id) => ipcRenderer.invoke('topics:summarize', id),
  onMenuAction: (callback) => ipcRenderer.on('menu:action', (_, action) => callback(action))
});
