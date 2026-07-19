'use strict';

const fs = require('node:fs');
const path = require('node:path');

function defaultConfig(libraryRoot) {
  return {
    version: 1,
    libraryRoot,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKeyEncrypted: ''
  };
}

class AppConfig {
  constructor(filePath, defaultLibraryRoot) {
    this.filePath = filePath;
    this.defaults = defaultConfig(defaultLibraryRoot);
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) return { ...this.defaults };
    try {
      return { ...this.defaults, ...JSON.parse(fs.readFileSync(this.filePath, 'utf8')) };
    } catch (error) {
      throw new Error(`本机设置文件损坏：${error.message}`);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2));
    fs.renameSync(temporary, this.filePath);
  }

  publicSettings() {
    return {
      provider: this.data.provider,
      baseUrl: this.data.baseUrl,
      model: this.data.model,
      hasApiKey: Boolean(this.data.apiKeyEncrypted)
    };
  }
}

function isICloudPath(directory) {
  return String(directory || '').includes(`${path.sep}Mobile Documents${path.sep}com~apple~CloudDocs${path.sep}`)
    || String(directory || '').endsWith(`${path.sep}Mobile Documents${path.sep}com~apple~CloudDocs`);
}

module.exports = { AppConfig, defaultConfig, isICloudPath };
