use serde::{Deserialize, Serialize};
use crate::models::*;
use crate::errors::{AppError, AppResult};

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMsg>,
    temperature: f64,
}

#[derive(Serialize)]
struct VisionRequest {
    model: String,
    messages: Vec<VisionMsg>,
    temperature: f64,
}

#[derive(Serialize, Clone, Deserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct VisionMsg {
    role: String,
    content: serde_json::Value,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMsg,
}

pub async fn completion(settings: &AppSettings, messages: &[ChatMsg], image_png: Option<&[u8]>) -> AppResult<String> {
    let client = reqwest::Client::new();
    let endpoint = build_endpoint(&settings.base_url);

    let response = if let Some(img) = image_png {
        let vision_msgs = build_vision_messages(messages, img);
        let body = VisionRequest {
            model: settings.model.clone(),
            messages: vision_msgs,
            temperature: 0.2,
        };
        client.post(&endpoint)
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .json(&body)
            .send()
            .await?
    } else {
        let body = ChatRequest {
            model: settings.model.clone(),
            messages: messages.to_vec(),
            temperature: 0.2,
        };
        client.post(&endpoint)
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::Ai(format!("HTTP {}: {}", status, body)));
    }

    let result: ChatResponse = response.json().await?;
    result.choices.first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| AppError::Ai("Empty response".into()))
}

fn build_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

fn build_vision_messages(messages: &[ChatMsg], image_png: &[u8]) -> Vec<VisionMsg> {
    let target_idx = messages.iter().rposition(|m| m.role == "user");
    messages.iter().enumerate().map(|(i, msg)| {
        if Some(i) == target_idx {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, image_png);
            let content = serde_json::json!([
                {"type": "text", "text": msg.content},
                {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", b64)}}
            ]);
            VisionMsg { role: msg.role.clone(), content }
        } else {
            VisionMsg { role: msg.role.clone(), content: serde_json::json!(msg.content) }
        }
    }).collect()
}

// ReAct mode — tool-use loop
pub async fn react_completion(
    settings: &AppSettings,
    messages: &[ChatMsg],
    workspace: &mut crate::file_tools::KnowledgeFileTools,
    image_png: Option<&[u8]>,
    max_steps: usize,
) -> AppResult<ReActResult> {
    let client = reqwest::Client::new();
    let endpoint = build_endpoint(&settings.base_url);
    let mut transcript: Vec<ReActMsg> = messages.iter()
        .map(|m| ReActMsg { role: m.role.clone(), content: Some(m.content.clone()), tool_calls: None })
        .collect();

    for _step in 0..max_steps.max(1) {
        let body = ReActRequest {
            model: settings.model.clone(),
            messages: transcript.clone(),
            tools: tool_definitions(),
            temperature: 0.2,
        };

        let response = client.post(&endpoint)
            .header("Authorization", format!("Bearer {}", settings.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            return Err(AppError::Ai(format!("ReAct HTTP error: {}", response.status())));
        }

        let result: ReActResponse = response.json().await?;
        let assistant = result.choices.first()
            .map(|c| c.message.clone())
            .ok_or_else(|| AppError::Ai("Empty ReAct response".into()))?;

        transcript.push(assistant.clone());

        if let Some(ref calls) = assistant.tool_calls {
            if !calls.is_empty() {
                for call in calls {
                    let output = workspace.execute(&call.function.name, &call.function.arguments);
                    transcript.push(ReActMsg {
                        role: "tool".into(),
                        content: Some(output),
                        tool_calls: None,
                    });
                }
                continue;
            }
        }

        if let Some(ref answer) = assistant.content {
            let trimmed = answer.trim();
            if !trimmed.is_empty() {
                return Ok(ReActResult {
                    answer: trimmed.to_string(),
                    generated_files: workspace.generated_files().clone(),
                });
            }
        }
        return Err(AppError::Ai("Empty response".into()));
    }
    Err(AppError::Ai("Max tool steps exceeded".into()))
}

#[derive(Serialize, Clone, Deserialize)]
struct ReActMsg {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Serialize, Clone, Deserialize)]
struct ToolCall {
    id: String,
    #[serde(rename = "type")]
    call_type: String,
    function: ToolFunction,
}

#[derive(Serialize, Clone, Deserialize)]
struct ToolFunction {
    name: String,
    arguments: String,
}

#[derive(Serialize)]
struct ReActRequest {
    model: String,
    messages: Vec<ReActMsg>,
    tools: Vec<ToolDef>,
    temperature: f64,
}

#[derive(Serialize, Clone)]
struct ToolDef {
    #[serde(rename = "type")]
    def_type: String,
    function: ToolFnDef,
}

#[derive(Serialize, Clone)]
struct ToolFnDef {
    name: String,
    description: String,
    parameters: ToolParams,
}

#[derive(Serialize, Clone)]
struct ToolParams {
    #[serde(rename = "type")]
    param_type: String,
    properties: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    required: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct ReActResponse {
    choices: Vec<ReActChoice>,
}

#[derive(Deserialize)]
struct ReActChoice {
    message: ReActMsg,
}

#[derive(Debug, Clone)]
pub struct ReActResult {
    pub answer: String,
    pub generated_files: Vec<String>,
}

fn tool_definitions() -> Vec<ToolDef> {
    vec![
        ToolDef {
            def_type: "function".into(),
            function: ToolFnDef {
                name: "list_files".into(),
                description: "列出已授权的知识库文件".into(),
                parameters: ToolParams {
                    param_type: "object".into(),
                    properties: serde_json::json!({
                        "path": {
                            "type": "string",
                            "description": "可选的相对目录"
                        }
                    }),
                    required: None,
                },
            },
        },
        ToolDef {
            def_type: "function".into(),
            function: ToolFnDef {
                name: "read_file".into(),
                description: "按字符区间读取文件".into(),
                parameters: ToolParams {
                    param_type: "object".into(),
                    properties: serde_json::json!({
                        "path": {"type": "string", "description": "文件路径"},
                        "offset": {"type": "integer", "description": "起始字符", "minimum": 0},
                        "limit": {"type": "integer", "description": "最大字符数", "minimum": 1, "maximum": 50000}
                    }),
                    required: Some(vec!["path".into()]),
                },
            },
        },
        ToolDef {
            def_type: "function".into(),
            function: ToolFnDef {
                name: "search_files".into(),
                description: "在文件中搜索关键词".into(),
                parameters: ToolParams {
                    param_type: "object".into(),
                    properties: serde_json::json!({
                        "query": {"type": "string", "description": "搜索关键词"},
                        "path": {"type": "string", "description": "可选的文件或目录"}
                    }),
                    required: Some(vec!["query".into()]),
                },
            },
        },
        ToolDef {
            def_type: "function".into(),
            function: ToolFnDef {
                name: "write_file".into(),
                description: "写入文件到 generated/".into(),
                parameters: ToolParams {
                    param_type: "object".into(),
                    properties: serde_json::json!({
                        "path": {"type": "string", "description": "generated/ 下的路径"},
                        "content": {"type": "string", "description": "文件内容"}
                    }),
                    required: Some(vec!["path".into(), "content".into()]),
                },
            },
        },
    ]
}
