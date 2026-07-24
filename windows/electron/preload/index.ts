import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings, KnowledgeData, KnowledgeMasterAPI } from "../../src/types";

const api: KnowledgeMasterAPI = {
  bootstrap: () => ipcRenderer.invoke("km:bootstrap"),
  saveData: (data: KnowledgeData) => ipcRenderer.invoke("km:save-data", data),
  chooseFiles: () => ipcRenderer.invoke("km:choose-files"),
  pathForFile: (file) => webUtils.getPathForFile(file),
  chooseFolder: () => ipcRenderer.invoke("km:choose-folder"),
  importPaths: (paths) => ipcRenderer.invoke("km:import-paths", paths),
  importUrl: (url) => ipcRenderer.invoke("km:import-url", url),
  chooseLibrary: () => ipcRenderer.invoke("km:choose-library"),
  switchLibrary: (path, migrate) => ipcRenderer.invoke("km:switch-library", path, migrate),
  readDocument: (storedPath) => ipcRenderer.invoke("km:read-document", storedPath),
  writeNote: (storedPath, title, content) =>
    ipcRenderer.invoke("km:write-note", storedPath, title, content),
  exportDocument: (documentId, annotated) =>
    ipcRenderer.invoke("km:export-document", documentId, annotated),
  openExternal: (storedPath) => ipcRenderer.invoke("km:open-external", storedPath),
  updateSettings: (patch: Partial<AppSettings> & { apiKey?: string }) =>
    ipcRenderer.invoke("km:update-settings", patch),
  complete: (messages) => ipcRenderer.invoke("km:complete", messages),
  runAgent: (backend, prompt, documentIds) =>
    ipcRenderer.invoke("km:run-agent", backend, prompt, documentIds),
  platform: process.platform
};

contextBridge.exposeInMainWorld("km", api);
