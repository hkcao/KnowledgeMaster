'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store.cjs');
const { queryTerms, scoreText, chunkText } = require('../src/main/search.cjs');
const { htmlToText, safeHtml } = require('../src/main/extract.cjs');
const { completionUrl } = require('../src/main/ai.cjs');
const { AppConfig, isICloudPath } = require('../src/main/config.cjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-organizer-'));
}

test('中文查询生成双字词并可匹配近似正文', () => {
  assert.deepEqual(queryTerms('数据库性能'), ['数据', '据库', '库性', '性能']);
  assert.ok(scoreText('数据库性能', '这一章节分析数据库的写入性能和并发问题', '设计文档') > 0);
});

test('正文分块保留重叠且不产生空块', () => {
  const chunks = chunkText('A'.repeat(3200), 1000, 100);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].length, 1000);
  assert.ok(chunks.every(Boolean));
});

test('HTML 提取正文并移除可执行内容', () => {
  const html = '<h1>知识库</h1><script>alert(1)</script><p onclick="bad()">正文 &amp; 引用</p>';
  assert.match(htmlToText(html), /知识库/);
  assert.match(htmlToText(html), /正文 & 引用/);
  assert.doesNotMatch(safeHtml(html), /script|onclick/i);
});

test('模型地址只追加一次 chat completions', () => {
  assert.equal(completionUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(completionUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
});

test('同名文件默认丢弃，主题关联保持多对多且不重复', async () => {
  const root = temporaryDirectory();
  const inputA = path.join(root, 'input-a');
  const inputB = path.join(root, 'input-b');
  fs.mkdirSync(inputA);
  fs.mkdirSync(inputB);
  fs.writeFileSync(path.join(inputA, 'note.txt'), '第一份内容：向量数据库。');
  fs.writeFileSync(path.join(inputB, 'note.txt'), '第二份不同内容。');
  const store = new Store(path.join(root, 'data'));
  const extract = async (filePath) => ({ text: fs.readFileSync(filePath, 'utf8'), pages: [] });
  const first = await store.importFiles([path.join(inputA, 'note.txt')], extract);
  const second = await store.importFiles([path.join(inputB, 'note.txt')], extract);
  assert.equal(first[0].status, 'imported');
  assert.equal(second[0].status, 'duplicate-name');
  assert.equal(store.data.documents.length, 1);

  const topicA = store.createTopic('数据库');
  const topicB = store.createTopic('AI Infra');
  assert.equal(store.linkDocument(first[0].id, topicA.id), true);
  assert.equal(store.linkDocument(first[0].id, topicA.id), false);
  assert.equal(store.linkDocument(first[0].id, topicB.id), true);
  assert.equal(store.data.documentTopics.length, 2);
  assert.equal(store.search('向量数据库', topicA.id)[0].id, first[0].id);
});

test('对话、消息与摘要可持久化', () => {
  const root = temporaryDirectory();
  const store = new Store(root);
  const topic = store.createTopic('RAG');
  const conversation = store.createConversation({ topicIds: [topic.id] });
  store.addMessage(conversation.id, { role: 'user', content: '什么是检索增强？' });
  store.addMessage(conversation.id, { role: 'assistant', content: '它结合了检索与生成。' });
  store.saveConversationSummary(conversation.id, '讨论了检索增强。');
  store.saveTopicSummary(topic.id, 'RAG 主题摘要。');
  const reloaded = new Store(root);
  assert.equal(reloaded.conversation(conversation.id).messages.length, 2);
  assert.equal(reloaded.conversation(conversation.id).summary, '讨论了检索增强。');
  assert.equal(reloaded.data.topicSummaries[0].summary, 'RAG 主题摘要。');
});

test('删除文档会清理物理副本、索引和主题关系', async () => {
  const root = temporaryDirectory();
  const input = path.join(root, 'delete-me.txt');
  fs.writeFileSync(input, '待删除正文');
  const store = new Store(path.join(root, 'data'));
  const [result] = await store.importFiles([input], async (filePath) => ({ text: fs.readFileSync(filePath, 'utf8'), pages: [] }));
  const topic = store.createTopic('临时主题');
  store.linkDocument(result.id, topic.id);
  const storedPath = store.getStoredPath(result.id);
  store.deleteDocument(result.id);
  assert.equal(fs.existsSync(storedPath), false);
  assert.equal(store.data.documents.length, 0);
  assert.equal(store.data.documentTopics.length, 0);
});

test('元数据损坏时从上一份备份恢复', () => {
  const root = temporaryDirectory();
  const store = new Store(root);
  const topic = store.createTopic('可恢复主题');
  store.renameTopic(topic.id, '已备份主题');
  fs.writeFileSync(path.join(root, 'knowledge.json'), '{broken');
  const recovered = new Store(root);
  assert.equal(recovered.data.topics[0].name, '可恢复主题');
  assert.match(recovered.recoveryNotice, /已从备份恢复/);
  assert.equal(fs.readdirSync(root).some((name) => name.startsWith('knowledge.corrupt-')), true);
});

test('删除对话不会影响其他历史', () => {
  const store = new Store(temporaryDirectory());
  const first = store.createConversation({ title: '保留' });
  const second = store.createConversation({ title: '删除' });
  store.deleteConversation(second.id);
  assert.deepEqual(store.data.conversations.map((item) => item.id), [first.id]);
});

test('模型配置与知识库数据分开保存在本机设置中', () => {
  const root = temporaryDirectory();
  const configPath = path.join(root, 'config.json');
  const config = new AppConfig(configPath, path.join(root, 'library'));
  config.data.libraryRoot = path.join(root, 'iCloud-library');
  config.data.apiKeyEncrypted = 'encrypted-value';
  config.save();
  const reloaded = new AppConfig(configPath, path.join(root, 'fallback'));
  assert.equal(reloaded.data.libraryRoot, path.join(root, 'iCloud-library'));
  assert.equal(reloaded.publicSettings().hasApiKey, true);
  assert.equal(Object.hasOwn(new Store(path.join(root, 'library')).data, 'settings'), false);
});

test('识别 macOS iCloud Drive 知识库路径', () => {
  assert.equal(isICloudPath('/Users/hank/Library/Mobile Documents/com~apple~CloudDocs/KnowledgeMaster'), true);
  assert.equal(isICloudPath('/Users/hank/Documents/KnowledgeMaster'), false);
});

test('对话保存是否包含当前页面及当前标签文档', () => {
  const store = new Store(temporaryDirectory());
  const conversation = store.createConversation({ includeCurrentPage: false });
  store.updateConversationScope(conversation.id, ['manual-document'], ['topic'], true, 'current-document');
  const saved = store.conversation(conversation.id);
  assert.equal(saved.includeCurrentPage, true);
  assert.equal(saved.currentDocumentId, 'current-document');
  assert.deepEqual(saved.documentIds, ['manual-document']);
});

test('渲染脚本引用的静态元素都存在于页面中', () => {
  const root = path.join(__dirname, '..', 'src', 'renderer');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const referencedIds = [...script.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map((match) => match[1]);
  const missing = [...new Set(referencedIds)].filter((elementId) => !html.includes(`id="${elementId}"`));
  assert.deepEqual(missing, []);
});
