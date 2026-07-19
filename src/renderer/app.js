'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  data: null,
  currentTopicId: null,
  currentDocument: null,
  openTabs: [],
  currentConversation: null,
  scopeDocumentIds: [],
  scopeTopicIds: [],
  currentQuote: null,
  selectedText: '',
  pdfMode: 'preview',
  includeCurrentPage: true,
  busy: false
};

const providerDefaults = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2' },
  custom: { baseUrl: '', model: '' }
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function showToast(message, duration = 2600) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function friendlyError(error) {
  return error?.message || String(error || '操作失败');
}

function updateState(next) {
  state.data = next;
  renderStorageStatus();
  renderTopics();
  renderDocuments();
  renderScope();
  renderModelIndicator();
}

function renderStorageStatus() {
  $('#storageStatus').textContent = `${state.data.documents.length} 份资料 · ${state.data.syncMode === 'icloud' ? 'iCloud Drive' : '本地存储'}`;
}

function documentsForTopic(topicId) {
  if (!topicId) return state.data.documents;
  const ids = new Set(state.data.documentTopics.filter((link) => link.topicId === topicId).map((link) => link.documentId));
  return state.data.documents.filter((document) => ids.has(document.id));
}

function renderTopics() {
  const counts = new Map();
  for (const link of state.data.documentTopics) counts.set(link.topicId, (counts.get(link.topicId) || 0) + 1);
  const all = `
    <div class="topic-item ${state.currentTopicId ? '' : 'active'}" data-topic-id="">
      <span>⌂</span><span>全部资料</span><span class="count">${state.data.documents.length}</span>
    </div>`;
  $('#topicList').innerHTML = all + state.data.topics.map((topic) => `
    <div class="topic-item ${state.currentTopicId === topic.id ? 'active' : ''}" data-topic-id="${topic.id}">
      <span>◇</span><span>${escapeHtml(topic.name)}</span><span class="count">${counts.get(topic.id) || 0}</span>
      <span class="topic-actions">
        <button class="item-action" data-summary-topic="${topic.id}" title="生成主题摘要">≋</button>
        <button class="item-action" data-rename-topic="${topic.id}" title="重命名">✎</button>
        <button class="item-action danger" data-delete-topic="${topic.id}" title="删除主题">×</button>
      </span>
    </div>`).join('');
  $$('.topic-item').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target.closest('.topic-actions')) return;
      state.currentTopicId = element.dataset.topicId || null;
      renderTopics();
      renderDocuments();
    });
    if (element.dataset.topicId) {
      element.addEventListener('dragover', (event) => { event.preventDefault(); element.classList.add('drag-over'); });
      element.addEventListener('dragleave', () => element.classList.remove('drag-over'));
      element.addEventListener('drop', async (event) => {
        event.preventDefault();
        element.classList.remove('drag-over');
        const documentId = event.dataTransfer.getData('application/x-knowledge-document');
        if (!documentId) return;
        try {
          const result = await window.knowledge.linkDocument(documentId, element.dataset.topicId);
          updateState(result.state);
          showToast(result.added ? '已添加主题关联，可立即检索' : '文档已属于该主题');
        } catch (error) { showToast(friendlyError(error)); }
      });
    }
  });
  $$('[data-summary-topic]').forEach((button) => button.addEventListener('click', () => summarizeTopic(button.dataset.summaryTopic)));
  $$('[data-rename-topic]').forEach((button) => button.addEventListener('click', () => renameTopic(button.dataset.renameTopic)));
  $$('[data-delete-topic]').forEach((button) => button.addEventListener('click', () => deleteTopic(button.dataset.deleteTopic)));
}

function renderDocuments() {
  const documents = documentsForTopic(state.currentTopicId);
  const topic = state.data.topics.find((item) => item.id === state.currentTopicId);
  $('#documentHeading').textContent = topic?.name || '全部资料';
  $('#documentCount').textContent = documents.length;
  $('#documentList').innerHTML = documents.length ? documents.map((document) => {
    const topicCount = state.data.documentTopics.filter((link) => link.documentId === document.id).length;
    return `
      <div class="document-item ${state.currentDocument?.id === document.id ? 'active' : ''}" draggable="true" data-document-id="${document.id}">
        <span class="doc-icon">${escapeHtml(document.extension.slice(1, 5).toUpperCase())}</span>
        <span class="doc-info"><strong>${escapeHtml(document.name)}</strong><span>${formatBytes(document.size)} · ${document.status === 'ready' ? '可检索' : document.status}</span></span>
        <span class="document-actions">
          ${state.currentTopicId ? `<button class="item-action" data-unlink-document="${document.id}" title="从当前主题移除">↗</button>` : ''}
          <button class="item-action danger" data-delete-document="${document.id}" title="从知识库删除">×</button>
        </span>
      </div>`;
  }).join('') : '<div class="chat-welcome"><p>这个主题下还没有资料。<br>把左侧文件拖到主题即可添加关联。</p></div>';
  $$('.document-item').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (!event.target.closest('.document-actions')) openDocument(element.dataset.documentId);
    });
    element.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('application/x-knowledge-document', element.dataset.documentId);
      event.dataTransfer.effectAllowed = 'copy';
    });
  });
  $$('[data-unlink-document]').forEach((button) => button.addEventListener('click', () => unlinkDocument(button.dataset.unlinkDocument)));
  $$('[data-delete-document]').forEach((button) => button.addEventListener('click', () => deleteDocument(button.dataset.deleteDocument)));
}

async function renameTopic(topicId) {
  const topic = state.data.topics.find((item) => item.id === topicId);
  const name = window.prompt('修改主题名称', topic?.name || '');
  if (!name?.trim() || name.trim() === topic?.name) return;
  try { const result = await window.knowledge.renameTopic(topicId, name); updateState(result.state); }
  catch (error) { showToast(friendlyError(error)); }
}

async function deleteTopic(topicId) {
  const topic = state.data.topics.find((item) => item.id === topicId);
  if (!window.confirm(`删除主题「${topic?.name}」？文档本身不会被删除。`)) return;
  try {
    updateState(await window.knowledge.deleteTopic(topicId));
    if (state.currentTopicId === topicId) state.currentTopicId = null;
    state.scopeTopicIds = state.scopeTopicIds.filter((id) => id !== topicId);
    renderTopics(); renderDocuments(); renderScope();
    showToast('主题已删除，原文档仍保留');
  } catch (error) { showToast(friendlyError(error)); }
}

async function unlinkDocument(documentId) {
  if (!state.currentTopicId) return;
  try {
    updateState(await window.knowledge.unlinkDocument(documentId, state.currentTopicId));
    showToast('已从当前主题移除，文档仍保留');
  } catch (error) { showToast(friendlyError(error)); }
}

async function deleteDocument(documentId) {
  const document = state.data.documents.find((item) => item.id === documentId);
  if (!window.confirm(`从知识库永久删除「${document?.name}」及其 source 副本？`)) return;
  try {
    updateState(await window.knowledge.deleteDocument(documentId));
    state.openTabs = state.openTabs.filter((id) => id !== documentId);
    state.scopeDocumentIds = state.scopeDocumentIds.filter((id) => id !== documentId);
    if (state.currentDocument?.id === documentId) {
      const fallbackId = state.openTabs.at(-1);
      if (fallbackId) await openDocument(fallbackId);
      else resetReader();
    }
    renderReaderTabs();
    renderScope();
    showToast('文档已从知识库删除');
  } catch (error) { showToast(friendlyError(error)); }
}

function resetReader() {
  state.currentDocument = null;
  $('#readerHeader').classList.add('hidden');
  $('#readerContent').classList.add('hidden');
  $('#readerContent').innerHTML = '';
  $('#readerEmpty').classList.remove('hidden');
  renderReaderTabs();
}

async function openDocument(documentId, page = null) {
  try {
    const document = await window.knowledge.getDocument(documentId);
    state.currentDocument = document;
    if (!state.openTabs.includes(document.id)) state.openTabs.push(document.id);
    state.pdfMode = document.extension === '.pdf' && page ? 'text' : 'preview';
    $('#readerEmpty').classList.add('hidden');
    $('#readerHeader').classList.remove('hidden');
    $('#readerContent').classList.remove('hidden');
    renderReaderTabs();
    $('#readerName').textContent = document.name;
    $('#readerType').textContent = document.extension.slice(1, 5).toUpperCase();
    $('#readerMeta').textContent = `${formatBytes(document.size)}${document.pageCount ? ` · ${document.pageCount} 页` : ''}`;
    $('#pdfModeToggle').classList.toggle('hidden', document.extension !== '.pdf');
    $$('#pdfModeToggle button').forEach((button) => button.classList.toggle('active', button.dataset.mode === state.pdfMode));
    renderDocumentContent(page);
    renderDocuments();
    renderScope();
  } catch (error) { showToast(friendlyError(error)); }
}

function renderReaderTabs() {
  state.openTabs = state.openTabs.filter((id) => state.data.documents.some((document) => document.id === id));
  const tabs = $('#readerTabs');
  tabs.classList.toggle('hidden', state.openTabs.length === 0);
  tabs.innerHTML = state.openTabs.map((documentId) => {
    const document = state.data.documents.find((item) => item.id === documentId);
    return `<button class="reader-tab ${state.currentDocument?.id === documentId ? 'active' : ''}" data-reader-tab="${documentId}">
      <span>${escapeHtml(document.extension.slice(1, 4).toUpperCase())}</span>
      <span class="tab-name">${escapeHtml(document.name)}</span>
      <span class="tab-close" data-close-tab="${documentId}">×</span>
    </button>`;
  }).join('');
  $$('[data-reader-tab]').forEach((tab) => tab.addEventListener('click', (event) => {
    if (!event.target.closest('[data-close-tab]')) openDocument(tab.dataset.readerTab);
  }));
  $$('[data-close-tab]').forEach((button) => button.addEventListener('click', () => closeReaderTab(button.dataset.closeTab)));
}

async function closeReaderTab(documentId) {
  const index = state.openTabs.indexOf(documentId);
  state.openTabs = state.openTabs.filter((id) => id !== documentId);
  if (state.currentDocument?.id === documentId) {
    const nextId = state.openTabs[Math.min(index, state.openTabs.length - 1)];
    if (nextId) await openDocument(nextId);
    else resetReader();
  }
  renderReaderTabs();
  renderScope();
}

function renderDocumentContent(page = null) {
  const document = state.currentDocument;
  const container = $('#readerContent');
  if (!document) return;
  if (document.extension === '.pdf' && state.pdfMode === 'preview') {
    container.innerHTML = `<iframe class="pdf-preview" src="${document.fileUrl}#toolbar=1"></iframe>`;
    return;
  }
  if ((document.extension === '.html' || document.extension === '.htm') && document.html) {
    container.innerHTML = '<iframe class="html-frame" sandbox="allow-same-origin allow-popups"></iframe>';
    const frame = container.querySelector('iframe');
    frame.srcdoc = `<base target="_blank"><style>body{max-width:820px;margin:35px auto;padding:30px;font:16px/1.8 Georgia,'Songti SC',serif;color:#20241f}img{max-width:100%}a{color:#335f4a}</style>${document.html}`;
    frame.addEventListener('load', () => frame.contentDocument?.addEventListener('mouseup', () => handleSelection(frame.contentWindow)));
    return;
  }
  if (document.extension === '.pdf') {
    container.innerHTML = `<article class="text-document">${(document.pages || []).map((item) => `
      <section class="pdf-page" id="page-${item.number}"><span class="page-number">第 ${item.number} 页</span>${escapeHtml(item.text)}</section>`).join('')}</article>`;
    if (page) requestAnimationFrame(() => $(`#page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  } else {
    container.innerHTML = `<article class="text-document">${escapeHtml(document.text || '未提取到正文')}</article>`;
  }
}

function handleSelection(selectionWindow = window) {
  const selection = selectionWindow.getSelection?.();
  const text = selection?.toString().trim();
  if (!text || text.length < 2) {
    $('#selectionToolbar').classList.add('hidden');
    return;
  }
  state.selectedText = text.slice(0, 4000);
  let rect;
  try { rect = selection.getRangeAt(0).getBoundingClientRect(); } catch { return; }
  const frame = selectionWindow.frameElement;
  const frameRect = frame?.getBoundingClientRect();
  const toolbar = $('#selectionToolbar');
  toolbar.style.left = `${Math.min(window.innerWidth - 290, Math.max(290, (frameRect?.left || 0) + rect.left))}px`;
  toolbar.style.top = `${Math.max(75, (frameRect?.top || 0) + rect.top - 46)}px`;
  toolbar.classList.remove('hidden');
}

function setQuote(text) {
  state.currentQuote = {
    text,
    documentId: state.currentDocument?.id || null,
    documentName: state.currentDocument?.name || '选中文字'
  };
  $('#quoteText').textContent = text;
  $('#quotePreview').classList.remove('hidden');
  $('#chatInput').focus();
}

function renderScope() {
  if (!state.data) return;
  const chips = [];
  if (state.includeCurrentPage && state.currentDocument) {
    chips.push({ type: 'current-page', id: state.currentDocument.id, name: `当前页面 · ${state.currentDocument.name}`, icon: '◉' });
  }
  for (const documentId of state.scopeDocumentIds) {
    const document = state.data.documents.find((item) => item.id === documentId);
    if (document) chips.push({ type: 'document', id: document.id, name: document.name, icon: '▧' });
  }
  for (const topicId of state.scopeTopicIds) {
    const topic = state.data.topics.find((item) => item.id === topicId);
    if (topic) chips.push({ type: 'topic', id: topic.id, name: topic.name, icon: '◇' });
  }
  $('#scopeChips').innerHTML = chips.length ? chips.map((chip) => `
    <span class="scope-chip ${chip.type === 'current-page' ? 'current-page' : ''}"><b>${chip.icon}</b><span>${escapeHtml(chip.name)}</span>${chip.type === 'current-page' ? '' : `<button data-remove-scope="${chip.type}:${chip.id}">×</button>`}</span>`).join('')
    : '<span class="scope-empty">未选择资料，将进行普通对话</span>';
  $$('[data-remove-scope]').forEach((button) => button.addEventListener('click', () => {
    const [type, id] = button.dataset.removeScope.split(':');
    if (type === 'document') state.scopeDocumentIds = state.scopeDocumentIds.filter((item) => item !== id);
    else state.scopeTopicIds = state.scopeTopicIds.filter((item) => item !== id);
    renderScope();
  }));
  $('#includeCurrentPageToggle').checked = state.includeCurrentPage;
  const remainingTopics = state.data.topics.filter((topic) => !state.scopeTopicIds.includes(topic.id));
  $('#scopeMenu').innerHTML = remainingTopics.length
    ? remainingTopics.map((topic) => `<button data-add-topic="${topic.id}">◇ ${escapeHtml(topic.name)}</button>`).join('')
    : '<button disabled>没有更多主题</button>';
  $$('[data-add-topic]').forEach((button) => button.addEventListener('click', () => {
    state.scopeTopicIds.push(button.dataset.addTopic);
    $('#scopeMenu').classList.add('hidden');
    renderScope();
  }));
}

function renderMessages() {
  const messages = state.currentConversation?.messages || [];
  if (!messages.length) return;
  $('#chatMessages').innerHTML = messages.map((message) => `
    <article class="message ${message.role}">
      <div class="message-label">${message.role === 'user' ? '你' : 'AI 助手'} · ${new Date(message.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="message-body">${escapeHtml(message.content)}</div>
      ${message.sources?.length ? `<div class="message-sources">${message.sources.map((source) => `<button data-source-document="${source.documentId}" data-source-page="${source.page || ''}">[${source.label}] ${escapeHtml(source.documentName)}${source.page ? ` · P${source.page}` : ''}</button>`).join('')}</div>` : ''}
    </article>`).join('');
  $$('[data-source-document]').forEach((button) => button.addEventListener('click', () => openDocument(button.dataset.sourceDocument, Number(button.dataset.sourcePage) || null)));
  $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}

async function sendMessage(prefill = null) {
  if (state.busy) return;
  if (prefill) $('#chatInput').value = prefill;
  const content = $('#chatInput').value.trim();
  if (!content) return;
  state.busy = true;
  $('#sendButton').disabled = true;
  $('#chatInput').value = '';
  if (!state.currentConversation) {
    state.currentConversation = { messages: [] };
  }
  state.currentConversation.messages.push({ role: 'user', content, createdAt: new Date().toISOString() });
  renderMessages();
  $('#chatMessages').insertAdjacentHTML('beforeend', '<div class="message typing">正在阅读所选资料并组织回答…</div>');
  try {
    const result = await window.knowledge.sendMessage({
      conversationId: state.currentConversation.id || null,
      content,
      quote: state.currentQuote,
      documentIds: state.scopeDocumentIds,
      topicIds: state.scopeTopicIds,
      includeCurrentPage: state.includeCurrentPage,
      currentDocumentId: state.currentDocument?.id || null
    });
    state.currentConversation = result.conversation;
    updateState(result.state);
    renderMessages();
    clearQuote();
  } catch (error) {
    state.currentConversation.messages.pop();
    renderMessages();
    showToast(friendlyError(error), 4500);
  } finally {
    state.busy = false;
    $('#sendButton').disabled = false;
  }
}

function clearQuote() {
  state.currentQuote = null;
  $('#quotePreview').classList.add('hidden');
}

async function importWith(method) {
  try {
    showToast('正在导入并提取正文…', 30000);
    const result = await method();
    if (result.canceled) { $('#toast').classList.add('hidden'); return; }
    updateState(result.state);
    const imported = result.results.filter((item) => item.status === 'imported').length;
    const duplicates = result.results.filter((item) => item.status.startsWith('duplicate')).length;
    const failed = result.results.filter((item) => item.status === 'failed').length;
    showToast(`导入 ${imported} 个 · 重复丢弃 ${duplicates} 个${failed ? ` · 失败 ${failed} 个` : ''}`, 4500);
    if (!state.currentDocument && imported) openDocument(result.results.find((item) => item.status === 'imported').id);
  } catch (error) { showToast(friendlyError(error), 4500); }
}

async function importDroppedFiles(files) {
  if (!files?.length) return;
  await importWith(() => window.knowledge.importDroppedFiles(files));
}

async function performSearch() {
  const query = $('#searchInput').value.trim();
  if (!query) {
    $('#searchResults').classList.add('hidden');
    $('#documentList').classList.remove('hidden');
    return;
  }
  try {
    const results = await window.knowledge.search(query, state.currentTopicId);
    $('#documentList').classList.add('hidden');
    $('#searchResults').classList.remove('hidden');
    $('#searchResults').innerHTML = results.length ? results.map((result) => `
      <div class="search-result" data-search-document="${result.id}"><strong>${escapeHtml(result.name)}</strong><p>${escapeHtml(result.excerpt || '文件名或主题匹配')}</p></div>`).join('')
      : '<div class="chat-welcome"><p>没有匹配结果</p></div>';
    $$('[data-search-document]').forEach((element) => element.addEventListener('click', () => openDocument(element.dataset.searchDocument)));
  } catch (error) { showToast(friendlyError(error)); }
}

function openSettings() {
  const settings = state.data.settings;
  $('#providerSelect').value = settings.provider || 'deepseek';
  $('#baseUrlInput').value = settings.baseUrl || '';
  $('#modelInput').value = settings.model || '';
  $('#apiKeyInput').value = '';
  $('#settingsHint').textContent = settings.hasApiKey ? '已保存 API Key。输入新值可替换。' : '尚未保存 API Key。';
  $('#dataRootText').textContent = state.data.dataRoot;
  $('#librarySyncStatus').textContent = state.data.syncMode === 'icloud' ? '✓ 由 iCloud Drive 同步' : '当前为本地目录';
  $('#settingsModal').classList.remove('hidden');
}

function currentSettingsForm() {
  return {
    provider: $('#providerSelect').value,
    baseUrl: $('#baseUrlInput').value.trim(),
    model: $('#modelInput').value.trim(),
    apiKey: $('#apiKeyInput').value.trim()
  };
}

function renderModelIndicator() {
  const settings = state.data?.settings;
  $('#modelIndicator').textContent = settings?.hasApiKey ? settings.model : '尚未配置模型';
}

function renderHistory() {
  const conversations = state.data.conversations;
  $('#historyList').innerHTML = conversations.length ? conversations.map((conversation) => `
    <div class="history-item"><div><strong>${escapeHtml(conversation.title)}</strong><span>${new Date(conversation.updatedAt).toLocaleString('zh-CN')} · ${conversation.messageCount} 条消息${conversation.summary ? ' · 已摘要' : ''}</span></div><button data-open-conversation="${conversation.id}">打开</button><button class="danger-text-button" data-delete-conversation="${conversation.id}">删除</button></div>`).join('')
    : '<div class="chat-welcome"><p>还没有对话历史</p></div>';
  $$('[data-open-conversation]').forEach((button) => button.addEventListener('click', async () => {
    try {
      state.currentConversation = await window.knowledge.getConversation(button.dataset.openConversation);
      state.scopeDocumentIds = [...state.currentConversation.documentIds];
      state.scopeTopicIds = [...state.currentConversation.topicIds];
      state.includeCurrentPage = state.currentConversation.includeCurrentPage !== false;
      if (state.currentConversation.currentDocumentId && state.data.documents.some((item) => item.id === state.currentConversation.currentDocumentId)) {
        await openDocument(state.currentConversation.currentDocumentId);
      }
      renderScope();
      renderMessages();
      $('#historyModal').classList.add('hidden');
    } catch (error) { showToast(friendlyError(error)); }
  }));
  $$('[data-delete-conversation]').forEach((button) => button.addEventListener('click', async () => {
    if (!window.confirm('永久删除这段对话历史？')) return;
    try {
      updateState(await window.knowledge.deleteConversation(button.dataset.deleteConversation));
      if (state.currentConversation?.id === button.dataset.deleteConversation) startNewChat();
      renderHistory();
    } catch (error) { showToast(friendlyError(error)); }
  }));
}

function startNewChat() {
  state.currentConversation = null;
  state.scopeDocumentIds = [];
  state.scopeTopicIds = [];
  clearQuote();
  renderScope();
  $('#chatMessages').innerHTML = '<div class="chat-welcome"><span class="welcome-icon">✦</span><h2>开始一段新对话</h2><p>问答范围已经重置，可以继续选择资料或主题。</p></div>';
}

function resetLibraryView(nextState) {
  state.data = nextState;
  state.currentTopicId = null;
  state.currentDocument = null;
  state.currentConversation = null;
  state.openTabs = [];
  state.scopeDocumentIds = [];
  state.scopeTopicIds = [];
  state.currentQuote = null;
  $('#searchInput').value = '';
  $('#searchResults').classList.add('hidden');
  $('#documentList').classList.remove('hidden');
  resetReader();
  updateState(nextState);
  startNewChat();
}

async function changeLibraryRoot() {
  try {
    const selection = await window.knowledge.chooseLibraryRoot();
    if (selection.canceled) return;
    if (selection.isCurrent) { showToast('当前已经使用这个知识库目录'); return; }
    let migrate = false;
    if (selection.hasLibrary) {
      if (!window.confirm('所选目录包含已有 KnowledgeMaster 知识库。切换并打开它？')) return;
    } else {
      const hasCurrentData = state.data.documents.length || state.data.topics.length || state.data.conversations.length;
      if (hasCurrentData) {
        migrate = window.confirm('是否复制当前全部资料、主题和对话到新目录？\n\n选择“取消”后还可以创建一个空知识库。');
        if (!migrate && !window.confirm('不复制现有数据，直接在所选目录创建空知识库？旧知识库仍会保留。')) return;
      }
    }
    const nextState = await window.knowledge.switchLibraryRoot(selection.path, migrate);
    resetLibraryView(nextState);
    $('#dataRootText').textContent = nextState.dataRoot;
    $('#librarySyncStatus').textContent = nextState.syncMode === 'icloud' ? '✓ 由 iCloud Drive 同步' : '当前为本地目录';
    showToast(nextState.syncMode === 'icloud' ? '已切换知识库，后续由 iCloud Drive 同步' : '知识库目录已切换', 4500);
  } catch (error) { showToast(friendlyError(error), 5000); }
}

async function summarizeConversation() {
  if (!state.currentConversation?.id) { showToast('请先完成一轮对话'); return; }
  try {
    showToast('正在提炼对话摘要…', 30000);
    const result = await window.knowledge.summarizeConversation(state.currentConversation.id);
    state.currentConversation = result.conversation;
    updateState(result.state);
    showSummary('本次对话摘要', state.currentConversation.title, state.currentConversation.summary);
    $('#toast').classList.add('hidden');
  } catch (error) { showToast(friendlyError(error), 4500); }
}

async function summarizeTopic(topicId) {
  const topic = state.data.topics.find((item) => item.id === topicId);
  const existing = state.data.topicSummaries.find((item) => item.topicId === topicId);
  if (existing) showSummary(`${topic.name} · 主题摘要`, `更新于 ${new Date(existing.updatedAt).toLocaleString('zh-CN')}`, existing.summary);
  try {
    showToast(existing ? '正在更新主题摘要…' : '正在生成主题摘要…', 30000);
    const result = await window.knowledge.summarizeTopic(topicId);
    updateState(result.state);
    showSummary(`${topic.name} · 主题摘要`, `更新于 ${new Date(result.summary.updatedAt).toLocaleString('zh-CN')}`, result.summary.summary);
    $('#toast').classList.add('hidden');
  } catch (error) { showToast(friendlyError(error), 4500); }
}

function showSummary(title, meta, content) {
  $('#summaryTitle').textContent = title;
  $('#summaryMeta').textContent = meta;
  $('#summaryContent').textContent = content;
  $('#summaryModal').classList.remove('hidden');
}

function bindEvents() {
  $('#importFilesButton').addEventListener('click', () => importWith(window.knowledge.chooseFiles));
  $('#emptyImportButton').addEventListener('click', () => importWith(window.knowledge.chooseFiles));
  $('#importFolderButton').addEventListener('click', () => importWith(window.knowledge.chooseFolder));
  $('#settingsButton').addEventListener('click', openSettings);
  $('#historyButton').addEventListener('click', () => { renderHistory(); $('#historyModal').classList.remove('hidden'); });
  $('#createTopicButton').addEventListener('click', async () => {
    const name = window.prompt('新主题名称');
    if (!name?.trim()) return;
    try { const result = await window.knowledge.createTopic(name); updateState(result.state); } catch (error) { showToast(friendlyError(error)); }
  });
  $('#searchInput').addEventListener('input', () => { clearTimeout(performSearch.timer); performSearch.timer = setTimeout(performSearch, 180); });
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); }
  });
  $('#readerContent').addEventListener('mouseup', () => handleSelection(window));
  $('#selectionToolbar').addEventListener('mousedown', (event) => event.preventDefault());
  $('#selectionToolbar').addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action) return;
    setQuote(state.selectedText);
    if (action === 'ask') $('#chatInput').value = '请结合上下文回答我关于这段内容的问题：';
    if (action === 'explain') $('#chatInput').value = '请解释这段内容，并说明其中的关键概念：';
    $('#selectionToolbar').classList.add('hidden');
  });
  $$('#pdfModeToggle button').forEach((button) => button.addEventListener('click', () => {
    state.pdfMode = button.dataset.mode;
    $$('#pdfModeToggle button').forEach((item) => item.classList.toggle('active', item === button));
    renderDocumentContent();
  }));
  $('#addCurrentToScope').addEventListener('click', () => {
    if (!state.currentDocument) return;
    if (!state.scopeDocumentIds.includes(state.currentDocument.id)) state.scopeDocumentIds.push(state.currentDocument.id);
    renderScope();
    showToast('当前文档已加入问答范围');
  });
  $('#scopeMenuButton').addEventListener('click', () => $('#scopeMenu').classList.toggle('hidden'));
  $('#includeCurrentPageToggle').addEventListener('change', (event) => {
    state.includeCurrentPage = event.target.checked;
    renderScope();
  });
  $('#newChatButton').addEventListener('click', startNewChat);
  $('#sendButton').addEventListener('click', () => sendMessage());
  $('#chatInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  $('#chatInput').addEventListener('input', (event) => {
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(140, event.target.scrollHeight)}px`;
  });
  $$('.suggestions button').forEach((button) => button.addEventListener('click', () => sendMessage(button.textContent)));
  $('#removeQuote').addEventListener('click', clearQuote);
  $('#summarizeButton').addEventListener('click', summarizeConversation);
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).classList.add('hidden')));
  $$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) backdrop.classList.add('hidden'); }));
  $('#providerSelect').addEventListener('change', (event) => {
    const defaults = providerDefaults[event.target.value];
    $('#baseUrlInput').value = defaults.baseUrl;
    $('#modelInput').value = defaults.model;
  });
  $('#saveSettingsButton').addEventListener('click', async () => {
    try {
      const settings = await window.knowledge.saveSettings(currentSettingsForm());
      state.data.settings = settings;
      renderModelIndicator();
      $('#settingsModal').classList.add('hidden');
      showToast('模型设置已保存');
    } catch (error) { $('#settingsHint').textContent = friendlyError(error); }
  });
  $('#testSettingsButton').addEventListener('click', async () => {
    const button = $('#testSettingsButton');
    button.disabled = true;
    $('#settingsHint').textContent = '正在测试连接…';
    try {
      const answer = await window.knowledge.testSettings(currentSettingsForm());
      $('#settingsHint').textContent = `连接正常：${answer}`;
    } catch (error) { $('#settingsHint').textContent = friendlyError(error); }
    finally { button.disabled = false; }
  });
  $('#openDataButton').addEventListener('click', async () => {
    try { await window.knowledge.openDataDirectory(); } catch (error) { showToast(friendlyError(error)); }
  });
  $('#changeDataRootButton').addEventListener('click', changeLibraryRoot);
  $('#clearApiKeyButton').addEventListener('click', async () => {
    if (!state.data.settings.hasApiKey || !window.confirm('清除本机保存的 API Key？')) return;
    try {
      state.data.settings = await window.knowledge.clearApiKey();
      renderModelIndicator();
      $('#settingsHint').textContent = 'API Key 已清除。';
    } catch (error) { $('#settingsHint').textContent = friendlyError(error); }
  });
  window.addEventListener('dragover', (event) => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    importDroppedFiles(event.dataTransfer.files);
  });
  window.knowledge.onMenuAction((action) => {
    if (action === 'import-files') importWith(window.knowledge.chooseFiles);
    if (action === 'import-folder') importWith(window.knowledge.chooseFolder);
    if (action === 'new-chat') startNewChat();
    if (action === 'settings') openSettings();
  });
}

async function initialize() {
  try {
    state.data = await window.knowledge.bootstrap();
    renderStorageStatus();
    bindEvents();
    renderTopics();
    renderDocuments();
    renderScope();
    renderModelIndicator();
    if (state.data.recoveryNotice) showToast(state.data.recoveryNotice, 8000);
  } catch (error) {
    document.body.innerHTML = `<pre style="padding:30px">应用启动失败：${escapeHtml(friendlyError(error))}</pre>`;
  }
}

initialize();
