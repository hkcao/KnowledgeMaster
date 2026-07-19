'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { scoreText, excerptFor, chunkText } = require('./search.cjs');

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.html', '.htm', '.md', '.markdown', '.txt']);

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function defaultData() {
  return {
    version: 1,
    documents: [],
    topics: [],
    documentTopics: [],
    conversations: [],
    topicSummaries: [],
    settings: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      apiKeyEncrypted: ''
    }
  };
}

class Store {
  constructor(root) {
    this.root = root;
    this.sourceRoot = path.join(root, 'source');
    this.documentsRoot = path.join(this.sourceRoot, 'documents');
    this.indexRoot = path.join(this.sourceRoot, 'index');
    this.downloadsRoot = path.join(this.sourceRoot, 'downloads');
    this.generatedRoot = path.join(this.sourceRoot, 'generated');
    this.dbPath = path.join(root, 'knowledge.json');
    this.backupPath = path.join(root, 'knowledge.json.bak');
    this.recoveryNotice = '';
    fs.mkdirSync(this.documentsRoot, { recursive: true });
    fs.mkdirSync(this.indexRoot, { recursive: true });
    fs.mkdirSync(this.downloadsRoot, { recursive: true });
    fs.mkdirSync(this.generatedRoot, { recursive: true });
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.dbPath)) {
      const initial = defaultData();
      this.write(initial);
      return initial;
    }
    try {
      return { ...defaultData(), ...JSON.parse(fs.readFileSync(this.dbPath, 'utf8')) };
    } catch (error) {
      if (!fs.existsSync(this.backupPath)) {
        throw new Error(`知识库元数据损坏，且没有可用备份：${error.message}`);
      }
      const recovered = { ...defaultData(), ...JSON.parse(fs.readFileSync(this.backupPath, 'utf8')) };
      const corruptPath = path.join(this.root, `knowledge.corrupt-${Date.now()}.json`);
      fs.renameSync(this.dbPath, corruptPath);
      fs.copyFileSync(this.backupPath, this.dbPath);
      this.recoveryNotice = `检测到元数据损坏，已从备份恢复。损坏文件保存在 ${corruptPath}`;
      return recovered;
    }
  }

  write(next = this.data) {
    const temporary = `${this.dbPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2));
    if (fs.existsSync(this.dbPath)) fs.copyFileSync(this.dbPath, this.backupPath);
    fs.renameSync(temporary, this.dbPath);
  }

  save() {
    this.write(this.data);
  }

  publicState() {
    return {
      documents: this.data.documents.map(({ storedPath, ...document }) => document),
      topics: this.data.topics,
      documentTopics: this.data.documentTopics,
      conversations: this.data.conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        documentIds: conversation.documentIds,
        topicIds: conversation.topicIds,
        summary: conversation.summary || '',
        messageCount: conversation.messages.length
      })),
      topicSummaries: this.data.topicSummaries,
      settings: {
        provider: this.data.settings.provider,
        baseUrl: this.data.settings.baseUrl,
        model: this.data.settings.model,
        hasApiKey: Boolean(this.data.settings.apiKeyEncrypted)
      },
      dataRoot: this.root,
      recoveryNotice: this.recoveryNotice
    };
  }

  hashFile(filePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  }

  async importFiles(filePaths, extract) {
    const results = [];
    for (const filePath of filePaths) {
      const extension = path.extname(filePath).toLowerCase();
      const name = path.basename(filePath);
      if (!SUPPORTED_EXTENSIONS.has(extension)) {
        results.push({ file: name, status: 'unsupported' });
        continue;
      }
      if (this.data.documents.some((document) => document.name.toLowerCase() === name.toLowerCase())) {
        results.push({ file: name, status: 'duplicate-name' });
        continue;
      }
      const sha256 = this.hashFile(filePath);
      if (this.data.documents.some((document) => document.sha256 === sha256)) {
        results.push({ file: name, status: 'duplicate-content' });
        continue;
      }
      const documentId = id();
      const documentDirectory = path.join(this.documentsRoot, documentId);
      fs.mkdirSync(documentDirectory, { recursive: true });
      const storedPath = path.join(documentDirectory, name);
      fs.copyFileSync(filePath, storedPath);
      const document = {
        id: documentId,
        name,
        extension,
        size: fs.statSync(filePath).size,
        sha256,
        storedPath,
        importedAt: now(),
        status: 'processing',
        pageCount: null
      };
      this.data.documents.push(document);
      this.save();
      try {
        const extracted = await extract(storedPath, extension);
        fs.writeFileSync(path.join(this.indexRoot, `${documentId}.json`), JSON.stringify(extracted));
        document.status = 'ready';
        document.pageCount = extracted.pages?.length || null;
        results.push({ file: name, status: 'imported', id: documentId });
      } catch (error) {
        document.status = 'failed';
        document.error = error.message;
        results.push({ file: name, status: 'failed', error: error.message });
      }
      this.save();
    }
    return results;
  }

  documentContent(documentId) {
    const document = this.data.documents.find((item) => item.id === documentId);
    if (!document) throw new Error('文档不存在');
    const indexPath = path.join(this.indexRoot, `${documentId}.json`);
    const extracted = fs.existsSync(indexPath)
      ? JSON.parse(fs.readFileSync(indexPath, 'utf8'))
      : { text: '', pages: [] };
    return {
      ...Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'storedPath')),
      ...extracted,
      fileUrl: `appfile://document/${document.id}`
    };
  }

  getStoredPath(documentId) {
    return this.data.documents.find((item) => item.id === documentId)?.storedPath;
  }

  deleteDocument(documentId) {
    const document = this.data.documents.find((item) => item.id === documentId);
    if (!document) throw new Error('文档不存在');
    this.data.documents = this.data.documents.filter((item) => item.id !== documentId);
    this.data.documentTopics = this.data.documentTopics.filter((item) => item.documentId !== documentId);
    for (const conversation of this.data.conversations) {
      conversation.documentIds = conversation.documentIds.filter((id) => id !== documentId);
    }
    const documentDirectory = path.dirname(document.storedPath);
    if (documentDirectory.startsWith(this.documentsRoot) && fs.existsSync(documentDirectory)) {
      fs.rmSync(documentDirectory, { recursive: true, force: true });
    }
    const indexPath = path.join(this.indexRoot, `${documentId}.json`);
    if (fs.existsSync(indexPath)) fs.rmSync(indexPath, { force: true });
    this.save();
  }

  createTopic(name, parentId = null) {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('主题名称不能为空');
    const topic = { id: id(), name: trimmed, parentId: parentId || null, createdAt: now() };
    this.data.topics.push(topic);
    this.save();
    return topic;
  }

  renameTopic(topicId, name) {
    const topic = this.data.topics.find((item) => item.id === topicId);
    if (!topic) throw new Error('主题不存在');
    topic.name = String(name || '').trim() || topic.name;
    this.save();
    return topic;
  }

  deleteTopic(topicId) {
    this.data.topics = this.data.topics.filter((item) => item.id !== topicId);
    this.data.documentTopics = this.data.documentTopics.filter((item) => item.topicId !== topicId);
    this.data.topicSummaries = this.data.topicSummaries.filter((item) => item.topicId !== topicId);
    this.save();
  }

  linkDocument(documentId, topicId) {
    if (!this.data.documents.some((item) => item.id === documentId)) throw new Error('文档不存在');
    if (!this.data.topics.some((item) => item.id === topicId)) throw new Error('主题不存在');
    const exists = this.data.documentTopics.some((item) => item.documentId === documentId && item.topicId === topicId);
    if (!exists) {
      this.data.documentTopics.push({ documentId, topicId, createdAt: now() });
      this.save();
    }
    return !exists;
  }

  unlinkDocument(documentId, topicId) {
    this.data.documentTopics = this.data.documentTopics.filter(
      (item) => item.documentId !== documentId || item.topicId !== topicId
    );
    this.save();
  }

  documentIdsForTopics(topicIds = []) {
    const selected = new Set(topicIds);
    return this.data.documentTopics
      .filter((item) => selected.has(item.topicId))
      .map((item) => item.documentId);
  }

  search(query, topicId = null) {
    const allowedIds = topicId
      ? new Set(this.documentIdsForTopics([topicId]))
      : null;
    return this.data.documents
      .filter((document) => !allowedIds || allowedIds.has(document.id))
      .map((document) => {
        let text = '';
        const indexPath = path.join(this.indexRoot, `${document.id}.json`);
        if (fs.existsSync(indexPath)) text = JSON.parse(fs.readFileSync(indexPath, 'utf8')).text || '';
        const topicNames = this.data.documentTopics
          .filter((item) => item.documentId === document.id)
          .map((item) => this.data.topics.find((topic) => topic.id === item.topicId)?.name || '')
          .join(' ');
        return {
          id: document.id,
          name: document.name,
          extension: document.extension,
          score: scoreText(query, `${topicNames}\n${text}`, document.name),
          excerpt: excerptFor(query, text || topicNames)
        };
      })
      .filter((result) => result.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 50);
  }

  contextFor(query, documentIds = [], topicIds = []) {
    const selectedIds = [...new Set([...documentIds, ...this.documentIdsForTopics(topicIds)])];
    const candidates = [];
    for (const documentId of selectedIds) {
      const document = this.data.documents.find((item) => item.id === documentId);
      if (!document) continue;
      const indexPath = path.join(this.indexRoot, `${documentId}.json`);
      if (!fs.existsSync(indexPath)) continue;
      const extracted = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (Array.isArray(extracted.pages) && extracted.pages.length) {
        for (const page of extracted.pages) {
          for (const chunk of chunkText(page.text)) {
            candidates.push({ document, page: page.number, text: chunk, score: scoreText(query, chunk, document.name) });
          }
        }
      } else {
        for (const chunk of chunkText(extracted.text)) {
          candidates.push({ document, page: null, text: chunk, score: scoreText(query, chunk, document.name) });
        }
      }
    }
    candidates.sort((left, right) => right.score - left.score);
    return candidates.slice(0, 10).map((candidate, index) => ({
      label: `资料${index + 1}`,
      documentId: candidate.document.id,
      documentName: candidate.document.name,
      page: candidate.page,
      text: candidate.text
    }));
  }

  createConversation({ title, documentIds = [], topicIds = [] } = {}) {
    const conversation = {
      id: id(),
      title: title || '新对话',
      documentIds: [...new Set(documentIds)],
      topicIds: [...new Set(topicIds)],
      messages: [],
      summary: '',
      createdAt: now(),
      updatedAt: now()
    };
    this.data.conversations.unshift(conversation);
    this.save();
    return conversation;
  }

  conversation(conversationId) {
    const conversation = this.data.conversations.find((item) => item.id === conversationId);
    if (!conversation) throw new Error('对话不存在');
    return conversation;
  }

  addMessage(conversationId, message) {
    const conversation = this.conversation(conversationId);
    conversation.messages.push({ id: id(), createdAt: now(), ...message });
    conversation.updatedAt = now();
    if (conversation.title === '新对话' && message.role === 'user') {
      conversation.title = String(message.content).replace(/\s+/g, ' ').slice(0, 26) || '新对话';
    }
    this.save();
    return conversation;
  }

  updateConversationScope(conversationId, documentIds, topicIds) {
    const conversation = this.conversation(conversationId);
    conversation.documentIds = [...new Set(documentIds)];
    conversation.topicIds = [...new Set(topicIds)];
    conversation.updatedAt = now();
    this.save();
  }

  saveConversationSummary(conversationId, summary) {
    const conversation = this.conversation(conversationId);
    conversation.summary = summary;
    conversation.updatedAt = now();
    this.save();
    return conversation;
  }

  deleteConversation(conversationId) {
    if (!this.data.conversations.some((item) => item.id === conversationId)) throw new Error('对话不存在');
    this.data.conversations = this.data.conversations.filter((item) => item.id !== conversationId);
    this.save();
  }

  saveTopicSummary(topicId, summary) {
    const existing = this.data.topicSummaries.find((item) => item.topicId === topicId);
    if (existing) {
      existing.summary = summary;
      existing.updatedAt = now();
    } else {
      this.data.topicSummaries.push({ topicId, summary, updatedAt: now() });
    }
    this.save();
    return this.data.topicSummaries.find((item) => item.topicId === topicId);
  }
}

module.exports = { Store, SUPPORTED_EXTENSIONS, defaultData };
