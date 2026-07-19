'use strict';

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store, SUPPORTED_EXTENSIONS } = require('./store.cjs');
const { extractDocument } = require('./extract.cjs');
const { chatCompletion } = require('./ai.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'appfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let store;

app.setName('KnowledgeMaster');

function mimeFor(extension) {
  return {
    '.pdf': 'application/pdf',
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.markdown': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8'
  }[extension] || 'application/octet-stream';
}

function listFilesRecursively(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const itemPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursively(itemPath));
    else if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(itemPath);
  }
  return files;
}

function expandImportPaths(inputPaths) {
  return inputPaths.flatMap((itemPath) => {
    if (!fs.existsSync(itemPath)) return [];
    return fs.statSync(itemPath).isDirectory() ? listFilesRecursively(itemPath) : [itemPath];
  });
}

async function importPaths(inputPaths) {
  return store.importFiles(expandImportPaths(inputPaths), extractDocument);
}

function apiKey() {
  const encrypted = store.data.settings.apiKeyEncrypted;
  if (!encrypted) return '';
  try {
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString('utf8');
  } catch {
    return '';
  }
}

function modelSettings(overrides = {}) {
  return {
    provider: overrides.provider || store.data.settings.provider,
    baseUrl: overrides.baseUrl || store.data.settings.baseUrl,
    model: overrides.model || store.data.settings.model,
    apiKey: overrides.apiKey || apiKey()
  };
}

function registerIpc() {
  ipcMain.handle('bootstrap', () => store.publicState());

  ipcMain.handle('documents:choose-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '支持的资料', extensions: ['pdf', 'html', 'htm', 'md', 'markdown', 'txt'] }]
    });
    if (result.canceled) return { canceled: true, results: [] };
    return { canceled: false, results: await store.importFiles(result.filePaths, extractDocument), state: store.publicState() };
  });

  ipcMain.handle('documents:choose-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled) return { canceled: true, results: [] };
    const files = listFilesRecursively(result.filePaths[0]);
    return { canceled: false, results: await store.importFiles(files, extractDocument), state: store.publicState() };
  });

  ipcMain.handle('documents:import-paths', async (_, paths) => ({
    canceled: false,
    results: await importPaths(paths),
    state: store.publicState()
  }));

  ipcMain.handle('documents:get', (_, id) => store.documentContent(id));
  ipcMain.handle('documents:delete', (_, id) => { store.deleteDocument(id); return store.publicState(); });
  ipcMain.handle('documents:search', (_, { query, topicId }) => store.search(query, topicId));
  ipcMain.handle('topics:create', (_, { name, parentId }) => ({ topic: store.createTopic(name, parentId), state: store.publicState() }));
  ipcMain.handle('topics:rename', (_, { id, name }) => ({ topic: store.renameTopic(id, name), state: store.publicState() }));
  ipcMain.handle('topics:delete', (_, id) => { store.deleteTopic(id); return store.publicState(); });
  ipcMain.handle('topics:link', (_, { documentId, topicId }) => ({ added: store.linkDocument(documentId, topicId), state: store.publicState() }));
  ipcMain.handle('topics:unlink', (_, { documentId, topicId }) => { store.unlinkDocument(documentId, topicId); return store.publicState(); });

  ipcMain.handle('settings:save', (_, settings) => {
    store.data.settings.provider = settings.provider;
    store.data.settings.baseUrl = String(settings.baseUrl || '').replace(/\/+$/, '');
    store.data.settings.model = settings.model;
    if (settings.apiKey) {
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(settings.apiKey)
        : Buffer.from(settings.apiKey, 'utf8');
      store.data.settings.apiKeyEncrypted = encrypted.toString('base64');
    }
    store.save();
    return store.publicState().settings;
  });

  ipcMain.handle('settings:clear-key', () => {
    store.data.settings.apiKeyEncrypted = '';
    store.save();
    return store.publicState().settings;
  });

  ipcMain.handle('settings:test', async (_, settings) => {
    const answer = await chatCompletion(modelSettings(settings), [{ role: 'user', content: '只回复：连接成功' }], { timeout: 30000 });
    return answer;
  });

  ipcMain.handle('system:open-data-directory', async () => {
    const error = await shell.openPath(store.root);
    if (error) throw new Error(error);
    return store.root;
  });

  ipcMain.handle('conversations:get', (_, id) => store.conversation(id));
  ipcMain.handle('conversations:delete', (_, id) => { store.deleteConversation(id); return store.publicState(); });
  ipcMain.handle('conversations:send', async (_, payload) => {
    let conversation = payload.conversationId
      ? store.conversation(payload.conversationId)
      : store.createConversation({ documentIds: payload.documentIds, topicIds: payload.topicIds });
    store.updateConversationScope(conversation.id, payload.documentIds || [], payload.topicIds || []);
    store.addMessage(conversation.id, { role: 'user', content: payload.content, quote: payload.quote || null });
    conversation = store.conversation(conversation.id);
    const retrievalQuery = `${payload.content}\n${payload.quote?.text || ''}`;
    const context = store.contextFor(retrievalQuery, conversation.documentIds, conversation.topicIds);
    const contextText = context.length
      ? context.map((item) => `[${item.label}：${item.documentName}${item.page ? `，第 ${item.page} 页` : ''}]\n${item.text}`).join('\n\n')
      : '（本次没有选择知识库资料，或所选资料尚未提取出正文。）';
    const messages = [
      {
        role: 'system',
        content: `你是个人知识库助手。优先依据提供的资料回答。引用资料时使用 [资料1] 这样的标记；不要编造资料中没有的信息。若资料不足，明确区分资料事实与一般性推理。\n\n知识库资料：\n${contextText}`
      },
      ...conversation.messages.slice(-12).map((message) => ({
        role: message.role,
        content: message.quote
          ? `引用自「${message.quote.documentName}」：\n${message.quote.text}\n\n用户问题：\n${message.content}`
          : message.content
      }))
    ];
    const answer = await chatCompletion(modelSettings(), messages);
    store.addMessage(conversation.id, { role: 'assistant', content: answer, sources: context });
    return { conversation: store.conversation(conversation.id), state: store.publicState() };
  });

  ipcMain.handle('conversations:summarize', async (_, conversationId) => {
    const conversation = store.conversation(conversationId);
    if (!conversation.messages.length) throw new Error('当前对话没有可总结的内容');
    const transcript = conversation.messages.map((message) => `${message.role === 'user' ? '用户' : 'AI'}：${message.content}`).join('\n\n').slice(-30000);
    const summary = await chatCompletion(modelSettings(), [
      { role: 'system', content: '请将对话提炼为简洁的中文知识摘要，分为：讨论主题、关键结论、待确认问题、后续行动。不要添加对话中没有的信息。' },
      { role: 'user', content: transcript }
    ]);
    return { conversation: store.saveConversationSummary(conversationId, summary), state: store.publicState() };
  });

  ipcMain.handle('topics:summarize', async (_, topicId) => {
    const topic = store.data.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('主题不存在');
    const conversations = store.data.conversations.filter((item) => item.topicIds.includes(topicId));
    if (!conversations.length) throw new Error('该主题还没有关联对话');
    const material = conversations.map((conversation) => {
      const body = conversation.summary || conversation.messages.map((message) => `${message.role}：${message.content}`).join('\n');
      return `# ${conversation.title}\n${body}`;
    }).join('\n\n').slice(-40000);
    const summary = await chatCompletion(modelSettings(), [
      { role: 'system', content: '请合并同一主题下的多次对话，输出可持续维护的中文主题摘要：核心认识、已确认结论、未解决问题、最近进展。严格忠于材料。' },
      { role: 'user', content: `主题：${topic.name}\n\n${material}` }
    ]);
    return { summary: store.saveTopicSummary(topicId, summary), state: store.publicState() };
  });
}

function sendMenuAction(action) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:action', action);
}

function installApplicationMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: '设置…', accelerator: 'CommandOrControl+,', click: () => sendMenuAction('settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '导入文件…', accelerator: 'CommandOrControl+O', click: () => sendMenuAction('import-files') },
        { label: '导入目录…', accelerator: 'CommandOrControl+Shift+O', click: () => sendMenuAction('import-folder') },
        { type: 'separator' },
        { label: '新对话', accelerator: 'CommandOrControl+N', click: () => sendMenuAction('new-chat') },
        { label: '打开数据目录', click: () => shell.openPath(store.root) },
        ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }])
      ]
    },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '显示', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f3f1eb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  window.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  store = new Store(path.join(app.getPath('userData'), 'library'));
  protocol.handle('appfile', (request) => {
    const url = new URL(request.url);
    const documentId = url.pathname.split('/').filter(Boolean)[0];
    const filePath = store.getStoredPath(documentId);
    if (!filePath || !fs.existsSync(filePath)) return new Response('Not found', { status: 404 });
    return new Response(fs.readFileSync(filePath), {
      headers: { 'Content-Type': mimeFor(path.extname(filePath).toLowerCase()) }
    });
  });
  registerIpc();
  installApplicationMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
