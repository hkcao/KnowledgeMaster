'use strict';

function completionUrl(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

async function chatCompletion(settings, messages, options = {}) {
  if (!settings.apiKey) throw new Error('请先在设置中填写 API Key');
  if (!settings.baseUrl || !settings.model) throw new Error('请完善模型地址和模型名称');
  const response = await fetch(completionUrl(settings.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      temperature: options.temperature ?? 0.3,
      stream: false
    }),
    signal: AbortSignal.timeout(options.timeout || 120000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || body.message || `模型请求失败（HTTP ${response.status}）`);
  }
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('模型没有返回可显示的内容');
  return content;
}

module.exports = { chatCompletion, completionUrl };
