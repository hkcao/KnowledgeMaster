use crate::models::AgentTraceEvent;
use chrono::Utc;
use uuid::Uuid;

#[derive(Default)]
pub struct AgentStreamParser {
    backend: String,
    buffer: Vec<u8>,
    pub final_answer: Option<String>,
    pub session_id: Option<String>,
}

impl AgentStreamParser {
    pub fn new(backend: &str) -> Self {
        Self {
            backend: backend.to_string(),
            buffer: Vec::new(),
            final_answer: None,
            session_id: None,
        }
    }

    pub fn consume(&mut self, data: &[u8]) -> Vec<AgentTraceEvent> {
        self.buffer.extend_from_slice(data);
        let mut events = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|&b| b == b'\n') {
            let line = String::from_utf8_lossy(&self.buffer[..pos]).to_string();
            self.buffer.drain(..=pos);
            let update = parse_line(&line, &self.backend);
            events.extend(update.events);
            if let Some(answer) = update.final_answer {
                self.final_answer = Some(answer);
            }
            if let Some(sid) = update.session_id {
                self.session_id = Some(sid);
            }
        }
        events
    }

    pub fn finish(&mut self) -> Vec<AgentTraceEvent> {
        if self.buffer.is_empty() { return Vec::new(); }
        let line = String::from_utf8_lossy(&self.buffer).to_string();
        self.buffer.clear();
        let update = parse_line(&line, &self.backend);
        if let Some(answer) = update.final_answer {
            self.final_answer = Some(answer);
        }
        update.events
    }
}

struct StreamUpdate {
    events: Vec<AgentTraceEvent>,
    final_answer: Option<String>,
    session_id: Option<String>,
}

fn parse_line(line: &str, backend: &str) -> StreamUpdate {
    let trimmed = line.trim();
    if trimmed.is_empty() { return StreamUpdate { events: vec![], final_answer: None, session_id: None }; }
    let json: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return StreamUpdate { events: vec![], final_answer: None, session_id: None },
    };

    match backend {
        "codex" => parse_codex(&json),
        _ => parse_claude(&json),
    }
}

fn parse_codex(json: &serde_json::Value) -> StreamUpdate {
    let event_type = json["type"].as_str().unwrap_or("");
    match event_type {
        "thread.started" => {
            let mut u = event("status", "Codex 会话已建立", None);
            u.session_id = json["thread_id"].as_str().map(|s| s.to_string());
            u
        }
        "turn.completed" => event("completed", "Codex 执行完成", None),
        "turn.failed" => event("error", "Codex 执行失败", json["message"].as_str()),
        "error" => {
            let msg = json["message"].as_str().unwrap_or("");
            if msg.to_lowercase().contains("reconnecting") {
                event("warning", "网络超时，Codex 正在重连", Some(msg))
            } else {
                event("error", "Codex 错误", Some(msg))
            }
        }
        "item.started" | "item.updated" | "item.completed" => {
            parse_codex_item(&json["item"])
        }
        _ => StreamUpdate { events: vec![], final_answer: None, session_id: None },
    }
}

fn parse_codex_item(item: &serde_json::Value) -> StreamUpdate {
    let item_type = item["type"].as_str().unwrap_or("");
    match item_type {
        "reasoning" => StreamUpdate { events: vec![], final_answer: None, session_id: None },
        "agent_message" => {
            item["text"].as_str().map(|t| event("status", "Agent 更新", Some(t)))
                .unwrap_or(StreamUpdate { events: vec![], final_answer: None, session_id: None })
        }
        "command_execution" => {
            let cmd = item["command"].as_str().unwrap_or("");
            event("tool", "正在执行命令", Some(cmd))
        }
        "file_change" => {
            let path = item["path"].as_str().or(item["file_path"].as_str()).unwrap_or("");
            event("file", "正在处理文件", Some(path))
        }
        "web_search" => {
            event("tool", "正在检索网页", item["query"].as_str())
        }
        _ => StreamUpdate { events: vec![], final_answer: None, session_id: None },
    }
}

fn parse_claude(json: &serde_json::Value) -> StreamUpdate {
    let event_type = json["type"].as_str().unwrap_or("");
    match event_type {
        "system" => {
            let subtype = json["subtype"].as_str().unwrap_or("");
            if subtype == "init" {
                let mut u = event("status", "Claude Code 会话已建立", None);
                u.session_id = json["session_id"].as_str().map(|s| s.to_string());
                u
            } else if subtype.contains("hook") {
                event("tool", "正在运行 Hook", json["hook_name"].as_str().or(json["name"].as_str()))
            } else {
                StreamUpdate { events: vec![], final_answer: None, session_id: None }
            }
        }
        "assistant" => {
            let message = &json["message"];
            let content = message["content"].as_array();
            let mut events = Vec::new();
            if let Some(blocks) = content {
                for block in blocks {
                    match block["type"].as_str() {
                        Some("tool_use") => {
                            let name = block["name"].as_str().unwrap_or("工具");
                            let detail = block["input"].as_object().and_then(|input| {
                                ["file_path", "path", "command", "query", "pattern"]
                                    .iter().find_map(|k| input.get(*k)?.as_str())
                            });
                            let title = match name {
                                "read" | "Read" => "正在读取文件",
                                "grep" | "Grep" | "Glob" => "正在检索资料",
                                "WebSearch" | "WebFetch" => "正在联网查询",
                                "Bash" => "正在执行命令",
                                "Write" | "Edit" => "正在写入工作区",
                                "Skill" => "正在调用 Skill",
                                _ => &format!("正在调用 {}", name),
                            };
                            events.push(make_event(match name {
                                "read" | "Read" | "Write" | "Edit" => "file",
                                "WebSearch" | "WebFetch" => "tool",
                                _ => "tool",
                            }, title, detail));
                        }
                        Some("text") => {
                            if let Some(text) = block["text"].as_str() {
                                events.push(make_event("status", "Agent 更新", Some(text)));
                            }
                        }
                        _ => {}
                    }
                }
            }
            StreamUpdate { events, final_answer: None, session_id: None }
        }
        "result" => {
            let answer = json["result"].as_str().map(|s| s.to_string());
            let is_error = json["is_error"].as_bool().unwrap_or(false);
            if is_error {
                StreamUpdate {
                    events: vec![make_event("error", "Claude Code 执行失败", answer.as_deref())],
                    final_answer: answer,
                    session_id: None,
                }
            } else {
                let turns = json["num_turns"].as_i64();
                let dur = json["duration_ms"].as_i64().map(|d| format!("{:.1} 秒", d as f64 / 1000.0));
                let detail = match (turns, dur) {
                    (Some(t), Some(d)) => Some(format!("{} 轮 · {}", t, d)),
                    (Some(t), None) => Some(format!("{} 轮", t)),
                    (None, Some(d)) => Some(d),
                    _ => None,
                };
                StreamUpdate {
                    events: vec![make_event("completed", "Claude Code 执行完成", detail.as_deref())],
                    final_answer: answer,
                    session_id: None,
                }
            }
        }
        _ => StreamUpdate { events: vec![], final_answer: None, session_id: None },
    }
}

fn event(kind: &str, title: &str, detail: Option<&str>) -> StreamUpdate {
    StreamUpdate {
        events: vec![make_event(kind, title, detail)],
        final_answer: None,
        session_id: None,
    }
}

fn make_event(kind: &str, title: &str, detail: Option<&str>) -> AgentTraceEvent {
    AgentTraceEvent {
        id: Uuid::new_v4(),
        kind: kind.to_string(),
        title: title.to_string(),
        detail: detail.map(|d| {
            let t = d.trim();
            if t.len() <= 600 { t.to_string() } else { format!("{}…", &t[..600]) }
        }),
        created_at: Utc::now(),
    }
}
