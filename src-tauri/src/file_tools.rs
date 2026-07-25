use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use crate::models::AgentDocument;

pub struct KnowledgeFileTools {
    documents: HashMap<String, String>,
    generated_root: PathBuf,
    generated_files: HashSet<String>,
}

impl KnowledgeFileTools {
    pub fn new(documents: Vec<AgentDocument>, generated_root: PathBuf) -> std::io::Result<Self> {
        let mut values = HashMap::new();
        for (i, doc) in documents.iter().enumerate() {
            values.insert(
                format!("documents/{}-{}.md", i + 1, safe_filename(&doc.name)),
                doc.content.clone(),
            );
        }
        fs::create_dir_all(&generated_root)?;
        Ok(Self {
            documents: values,
            generated_root,
            generated_files: HashSet::new(),
        })
    }

    pub fn generated_files(&self) -> Vec<String> {
        self.generated_files.iter().cloned().collect()
    }

    pub fn manifest(&self) -> String {
        let mut doc_lines: Vec<String> = self.documents.keys()
            .map(|k| format!("- `{}`（只读）", k))
            .collect();
        doc_lines.sort();
        let gen_lines: Vec<String> = self.list_generated()
            .iter()
            .map(|f| format!("- `{}`（可读）", f))
            .collect();
        let mut lines = doc_lines;
        lines.extend(gen_lines);
        lines.push("- `generated/`（仅此目录可写）".into());
        lines.join("\n")
    }

    pub fn execute(&mut self, name: &str, args: &str) -> String {
        let values = match decode_args(args) {
            Some(v) => v,
            None => return err("参数不是有效的 JSON 对象"),
        };

        match name {
            "list_files" => {
                let path = values.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                self.list_files(path)
            }
            "read_file" => {
                let path = match values.get("path").and_then(|v| v.as_str()) {
                    Some(p) => p,
                    None => return err("缺少 path"),
                };
                let offset = values.get("offset").and_then(|v| v.as_i64()).unwrap_or(0) as usize;
                let limit = values.get("limit").and_then(|v| v.as_i64()).unwrap_or(20000) as usize;
                self.read_file(path, offset, limit)
            }
            "search_files" => {
                let query = match values.get("query").and_then(|v| v.as_str()) {
                    Some(q) if !q.is_empty() => q,
                    _ => return err("缺少 query"),
                };
                let path = values.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                self.search_files(query, path)
            }
            "write_file" => {
                let path = match values.get("path").and_then(|v| v.as_str()) {
                    Some(p) => p,
                    None => return err("缺少 path"),
                };
                let content = match values.get("content").and_then(|v| v.as_str()) {
                    Some(c) => c,
                    None => return err("缺少 content"),
                };
                self.write_file(path, content)
            }
            _ => err(&format!("未知工具：{}", name)),
        }
    }

    fn list_files(&self, path: &str) -> String {
        let normalized = match normalize(path, true) { Ok(n) => n, Err(e) => return e };
        let mut all: Vec<String> = self.documents.keys().cloned().collect();
        all.extend(self.list_generated());
        all.sort();

        let matches: Vec<&String> = if normalized.is_empty() {
            all.iter().collect()
        } else {
            all.iter().filter(|f| **f == normalized || f.starts_with(&format!("{}/", normalized))).collect()
        };

        if matches.is_empty() {
            "（没有匹配的文件）".into()
        } else {
            matches.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n")
        }
    }

    fn read_file(&self, path: &str, offset: usize, limit: usize) -> String {
        let normalized = match normalize(path, false) { Ok(n) => n, Err(e) => return e };
        let content = match self.content_at(&normalized) {
            Ok(c) => c,
            Err(e) => return e,
        };
        let safe_offset = offset.min(content.len());
        let safe_limit = limit.min(50000).max(1);
        if safe_offset >= content.len() {
            return format!("（offset 已超过文件末尾，共 {} 字符）", content.len());
        }
        let chars: Vec<char> = content.chars().collect();
        let end = (safe_offset + safe_limit).min(chars.len());
        let slice: String = chars[safe_offset..end].iter().collect();
        format!("[{} 字符 {}..<{} / {}]\n{}", normalized, safe_offset, end, chars.len(), slice)
    }

    fn search_files(&self, query: &str, path: &str) -> String {
        let normalized = match normalize(path, true) { Ok(n) => n, Err(e) => return e };
        let mut candidates: Vec<String> = self.documents.keys().cloned().collect();
        candidates.extend(self.list_generated());

        let matching: Vec<&String> = if normalized.is_empty() {
            candidates.iter().collect()
        } else {
            candidates.iter().filter(|f| **f == normalized || f.starts_with(&format!("{}/", normalized))).collect()
        };

        let needle = query.to_lowercase();
        let mut results = Vec::new();

        for path in matching {
            let content = match self.content_at(path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    results.push(format!("{}:{}: {}", path, i + 1, &line[..line.len().min(500)]));
                    if results.len() >= 20 { return results.join("\n"); }
                }
            }
        }

        if results.is_empty() {
            format!("（未找到\"{}\"）", query)
        } else {
            results.join("\n")
        }
    }

    fn write_file(&mut self, path: &str, content: &str) -> String {
        if content.len() > 1_000_000 {
            return err("单次写入不能超过 100 万字符");
        }
        let normalized = match normalize(path, false) { Ok(n) => n, Err(e) => return e };
        if !normalized.starts_with("generated/") || normalized.len() <= "generated/".len() {
            return err("写入被拒绝；只能写入 generated/ 目录");
        }
        let relative = &normalized["generated/".len()..];
        let dest = self.generated_root.join(relative);
        if let Some(parent) = dest.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match fs::write(&dest, content) {
            Ok(_) => {
                self.generated_files.insert(normalized.clone());
                format!("已写入 `{}`，共 {} 字符", normalized, content.len())
            }
            Err(e) => err(&format!("写入失败：{}", e)),
        }
    }

    fn content_at(&self, path: &str) -> Result<String, String> {
        if let Some(content) = self.documents.get(path) {
            return Ok(content.clone());
        }
        if path.starts_with("generated/") && path.len() > "generated/".len() {
            let relative = &path["generated/".len()..];
            let url = self.generated_root.join(relative);
            if url.exists() {
                return fs::read_to_string(&url).map_err(|e| format!("{}", e));
            }
        }
        Err(format!("文件不存在或不可读取：{}", path))
    }

    fn list_generated(&self) -> Vec<String> {
        let mut result = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.generated_root) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    if let Some(name) = entry.file_name().to_str() {
                        result.push(format!("generated/{}", name));
                    }
                }
            }
        }
        result.sort();
        result
    }
}

fn decode_args(s: &str) -> Option<HashMap<String, serde_json::Value>> {
    serde_json::from_str(s).ok()
}

fn normalize(path: &str, allow_root: bool) -> Result<String, String> {
    let value = path.trim().replace('\\', "/");
    if allow_root && (value.is_empty() || value == ".") { return Ok(String::new()); }
    if value.is_empty() || value.starts_with('/') || value.starts_with('~') {
        return Err("路径无效".into());
    }
    let components: Vec<&str> = value.split('/').filter(|c| !c.is_empty()).collect();
    if components.is_empty() || components.contains(&".") || components.contains(&"..") {
        return Err("路径无效".into());
    }
    Ok(components.join("/"))
}

fn err(msg: &str) -> String {
    format!(r#"{{"ok":false,"error":"{}"}}"#, msg)
}

fn safe_filename(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() { "document".into() } else { trimmed[..trimmed.len().min(100)].to_string() }
}
