use std::fs;
use std::path::Path;
use crate::models::*;
use crate::errors::AppResult;

pub use crate::models::ExtractedDocument;

pub fn extract(path: &Path) -> AppResult<ExtractedDocument> {
    let ext = path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    match ext.as_str() {
        "pdf" => extract_pdf(path),
        "html" | "htm" => extract_html(path),
        "md" | "markdown" | "txt" => {
            let text = fs::read_to_string(path)?;
            Ok(ExtractedDocument { text, pages: Vec::new() })
        }
        "doc" | "docx" => {
            // For DOC/DOCX, we can only extract basic text in pure Rust
            // Full extraction requires mammoth.js on the frontend
            match extract_docx_text(path) {
                Ok(text) => Ok(ExtractedDocument { text, pages: Vec::new() }),
                Err(_) => Ok(ExtractedDocument {
                    text: format!("[{} 文件 — 请在阅读器中查看]", ext.to_uppercase()),
                    pages: Vec::new(),
                }),
            }
        }
        _ => Ok(ExtractedDocument { text: String::new(), pages: Vec::new() }),
    }
}

fn extract_pdf(path: &Path) -> AppResult<ExtractedDocument> {
    // Use pdf_extract for text extraction
    match pdf_extract::extract_text(path) {
        Ok(text) => {
            Ok(ExtractedDocument {
                text: text.clone(),
                pages: text.split('\n')
                    .enumerate()
                    .map(|(i, t)| ExtractedPage {
                        number: (i + 1) as i32,
                        text: t.to_string(),
                    })
                    .collect(),
            })
        }
        Err(_) => {
            let bytes = fs::read(path)?;
            let doc = lopdf::Document::load_mem(&bytes)
                .map_err(|e| crate::errors::AppError::Ai(format!("PDF parse error: {}", e)))?;
            let mut pages = Vec::new();
            let mut all_text = String::new();
            for (i, (&page_id, _)) in doc.get_pages().iter().enumerate() {
                let page_text = pdf_page_text(&doc, page_id);
                pages.push(ExtractedPage { number: (i + 1) as i32, text: page_text.clone() });
                if i > 0 { all_text.push_str("\n\n"); }
                all_text.push_str(&page_text);
            }
            Ok(ExtractedDocument { text: all_text, pages })
        }
    }
}

fn pdf_page_text(_doc: &lopdf::Document, _page_id: u32) -> String {
    // PDF text extraction via lopdf requires complex content stream decoding
    // Use pdf_extract crate for actual extraction; this is a fallback
    String::new()
}

pub fn first_page_text(path: &Path) -> Option<String> {
    pdf_extract::extract_text(path).ok()
}

fn extract_html(path: &Path) -> AppResult<ExtractedDocument> {
    let data = fs::read(path)?;
    let source = String::from_utf8_lossy(&data);
    let document = scraper::Html::parse_document(&source);
    let text = document.root_element().text().collect::<Vec<_>>().join(" ");
    Ok(ExtractedDocument { text, pages: Vec::new() })
}

fn extract_docx_text(_path: &Path) -> AppResult<String> {
    // DOCX extraction would require docx-rs crate with correct API version
    // For now, return a placeholder
    Ok("[DOCX 文件 — 请在阅读器中查看]".to_string())
}

pub fn paper_display_name_at(path: &Path) -> Option<String> {
    if path.extension()?.to_str()? != "pdf" { return None; }
    let first_page_text = first_page_text(path)?;
    if first_page_text.is_empty() { return None; }

    let normalized = first_page_text.replace("\r\n", "\n");
    let lower = normalized.to_lowercase();
    if !lower.contains("\nabstract") && !normalized.contains("摘要") {
        return None;
    }

    let lines: Vec<String> = normalized.split('\n')
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    let title = lines.iter().take(5).find(|line| {
        let l = line.to_lowercase();
        line.len() >= 12 && line.len() <= 300 && !l.contains("arxiv:") && !l.starts_with("doi")
    })?.clone();

    let author = lines.iter()
        .skip_while(|l| **l != title)
        .skip(1)
        .find(|l| l.len() < 240 && !l.to_lowercase().contains("abstract"))
        .cloned();

    paper_display_name(&title, author.as_deref())
}

pub fn paper_display_name(title: &str, authors: Option<&str>) -> Option<String> {
    let clean_title = title.trim().to_string();
    if clean_title.len() < 6 { return None; }

    match authors.and_then(|a| first_author_surname(a)) {
        Some(surname) => {
            let has_multiple = authors.unwrap_or("").contains(',')
                || authors.unwrap_or("").contains(';')
                || authors.unwrap_or("").to_lowercase().contains(" and ");
            if has_multiple {
                Some(format!("{} et al., {}", surname, clean_title))
            } else {
                Some(format!("{}, {}", surname, clean_title))
            }
        }
        None => Some(clean_title),
    }
}

pub fn first_author_surname(authors: &str) -> Option<String> {
    let first_block = authors.split(';').next()?
        .split(',').next()?
        .split(" and ").next()?
        .trim();
    let words: Vec<&str> = first_block.split_whitespace().collect();
    words.last()
        .map(|w| w.trim_matches(|c: char| c.is_ascii_punctuation()))
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars: Vec<char> = w.chars().collect();
            if let Some(first) = chars.first_mut() {
                *first = first.to_uppercase().next().unwrap_or(*first);
            }
            chars.into_iter().collect()
        })
}

pub fn paper_header_candidate(extracted: &ExtractedDocument, limit: usize) -> Option<String> {
    let source = extracted.pages.first()
        .map(|p| p.text.clone())
        .unwrap_or_else(|| extracted.text.clone());
    let normalized = source.replace("\r\n", "\n");
    let lines: Vec<&str> = normalized.split('\n')
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let mut selected = Vec::new();
    let mut count = 0;
    let skip_keywords = ["university", "institute", "department", "laboratory", "school of",
        "college", "research center", "研究院", "大学", "学院", "实验室"];

    for line in lines.iter().take(40) {
        let normalized = line.to_lowercase().trim_matches(|c: char| c.is_whitespace() || c.is_ascii_punctuation()).to_string();
        if !selected.is_empty() && (normalized == "abstract" || normalized == "摘要"
            || normalized.starts_with("abstract ") || normalized.starts_with("摘要：")) {
            break;
        }
        let is_affiliation = line.contains('@') || skip_keywords.iter().any(|k| normalized.contains(k));
        let is_noise = normalized.starts_with("arxiv:") || normalized.starts_with("doi:")
            || normalized.contains("conference paper") || normalized.contains("published as");
        if line.len() > 500 || is_affiliation || is_noise { continue; }
        if count + line.len() > limit { break; }
        selected.push(*line);
        count += line.len() + 1;
        if selected.len() == 8 { break; }
    }
    let result = selected.join("\n").trim().to_string();
    if result.is_empty() { None } else { Some(result) }
}
