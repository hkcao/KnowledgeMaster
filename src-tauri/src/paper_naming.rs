use crate::models::*;
use crate::extraction;
use crate::ai_client;
use crate::errors::AppResult;

pub fn needs_refinement(doc: &KnowledgeDocument) -> bool {
    if doc.extension_name != ".pdf" { return false; }
    match &doc.display_name {
        None => true,
        Some(name) if name.trim().is_empty() => true,
        Some(name) => {
            let lower = name.to_lowercase();
            name == &doc.name || name.len() < 12
                || lower.contains("published as")
                || lower.contains("conference paper")
                || lower.contains("arxiv:")
                || lower.starts_with("networks,")
        }
    }
}

pub async fn suggest_name(
    doc: &KnowledgeDocument,
    source_path: &std::path::Path,
    extracted: &ExtractedDocument,
    settings: &AppSettings,
) -> AppResult<Option<String>> {
    // Try local extraction first
    if let Some(local) = extraction::paper_display_name_at(source_path) {
        return Ok(Some(local));
    }

    let header = match extraction::paper_header_candidate(extracted, 1600) {
        Some(h) => h,
        None => return Ok(None),
    };
    if header.is_empty() { return Ok(None); }

    let messages = vec![
        ai_client::ChatMsg {
            role: "system".into(),
            content: "你负责识别学术论文元数据。只返回一个 JSON 对象，不要 Markdown 或代码围栏：\n{\"is_paper\":true,\"title\":\"完整论文标题\",\"first_author\":\"第一作者姓名\",\"multiple_authors\":true}\n不要把页眉、期刊名或 ABSTRACT 当作标题。无法确认时将 is_paper 设为 false。".into(),
        },
        ai_client::ChatMsg {
            role: "user".into(),
            content: format!("原文件名：{}\n\n标题与作者候选区：\n{}", doc.name, header),
        },
    ];

    let response = ai_client::completion(settings, &messages, None).await?;
    let result = parse_response(&response)?;

    if result.is_paper {
        Ok(extraction::paper_display_name(&result.title, Some(&result.first_author)))
    } else {
        Ok(None)
    }
}

#[derive(serde::Deserialize)]
struct PaperResult {
    is_paper: bool,
    title: String,
    first_author: String,
    multiple_authors: bool,
}

fn parse_response(response: &str) -> AppResult<PaperResult> {
    let start = response.find('{');
    let end = response.rfind('}');
    match (start, end) {
        (Some(s), Some(e)) if s <= e => {
            let json = &response[s..=e];
            Ok(serde_json::from_str(json)?)
        }
        _ => Err(crate::errors::AppError::Ai("无法解析模型返回".into())),
    }
}
