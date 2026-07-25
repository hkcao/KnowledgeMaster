use std::path::Path;
use crate::models::*;

pub fn build_outline(document: &KnowledgeDocument, source_path: &Path, extracted: &ExtractedDocument) -> Vec<DocumentOutlineEntry> {
    if document.extension_name == ".pdf" {
        pdf_entries(source_path, extracted)
    } else {
        let source = std::fs::read_to_string(source_path).unwrap_or_else(|_| extracted.text.clone());
        text_entries(&source, &document.extension_name, &extracted.text)
    }
}

fn pdf_entries(source_path: &Path, extracted: &ExtractedDocument) -> Vec<DocumentOutlineEntry> {
    // Try to read PDF outline
    if let Ok(bytes) = std::fs::read(source_path) {
        if let Ok(doc) = lopdf::Document::load_mem(&bytes) {
            let page_count = doc.get_pages().len();
            // Fallback: detect headings from extracted text
            let detected: Vec<DocumentOutlineEntry> = extracted.pages.iter()
                .filter_map(|page| {
                    let title = page.text.lines()
                        .map(|l| l.trim())
                        .find(|l| is_likely_heading(l))?;
                    Some(DocumentOutlineEntry {
                        id: format!("pdf-page-{}-{}", page.number, title),
                        title: title.to_string(),
                        level: heading_level(title),
                        target: DocumentNavigationTarget::Pdf {
                            page_index: page.number - 1,
                            point: None,
                        },
                    })
                })
                .collect();
            if !detected.is_empty() { return detected; }

            return (0..page_count).map(|i| DocumentOutlineEntry {
                id: format!("pdf-page-{}", i),
                title: format!("第 {} 页", i + 1),
                level: 1,
                target: DocumentNavigationTarget::Pdf { page_index: i as i32, point: None },
            }).collect();
        }
    }
    Vec::new()
}

fn text_entries(source: &str, extension: &str, rendered: &str) -> Vec<DocumentOutlineEntry> {
    let headings = if [".html", ".htm"].contains(&extension) {
        html_headings(source)
    } else {
        markdown_headings(source)
    };
    entries_for_headings(&headings, rendered)
}

fn markdown_headings(source: &str) -> Vec<(String, i32)> {
    source.lines().filter_map(|line| {
        let line = line.trim();
        let marker_count = line.chars().take_while(|c| *c == '#').count();
        if (1..=6).contains(&marker_count) && line.chars().nth(marker_count).map_or(false, |c| c.is_whitespace()) {
            let title = line[marker_count..].trim().trim_matches('#').trim().to_string();
            if !title.is_empty() {
                return Some((title, marker_count as i32));
            }
        }
        if is_likely_heading(line) {
            return Some((line.to_string(), heading_level(line)));
        }
        None
    }).collect()
}

fn html_headings(source: &str) -> Vec<(String, i32)> {
    let re = regex_lite::Regex::new(r"<h([1-6])\b[^>]*>(.*?)</h\1>").unwrap();
    re.captures_iter(source).filter_map(|caps| {
        let level: i32 = caps.get(1)?.as_str().parse().ok()?;
        let html_title = caps.get(2)?.as_str();
        let doc = scraper::Html::parse_fragment(html_title);
        let title = doc.root_element().text().collect::<Vec<_>>().join("").trim().to_string();
        if title.is_empty() { None } else { Some((title, level)) }
    }).collect()
}

fn entries_for_headings(headings: &[(String, i32)], rendered: &str) -> Vec<DocumentOutlineEntry> {
    let lower_rendered = rendered.to_lowercase();
    let mut search_offset = 0usize;
    headings.iter().enumerate().filter_map(|(i, (title, level))| {
        let search_in = &rendered[search_offset.min(rendered.len())..];
        let pos = search_in.to_lowercase().find(&title.to_lowercase())
            .map(|p| search_offset + p)
            .or_else(|| lower_rendered.find(&title.to_lowercase()));
        if let Some(pos) = pos {
            search_offset = pos + title.len();
        }
        let pos = pos.unwrap_or(0);
        Some(DocumentOutlineEntry {
            id: format!("text-heading-{}-{}", i, pos),
            title: title.clone(),
            level: *level,
            target: DocumentNavigationTarget::Text { location: pos },
        })
    }).collect()
}

fn is_likely_heading(line: &str) -> bool {
    if line.len() < 2 || line.len() > 120 { return false; }
    let normalized = line.to_lowercase().trim_matches(|c: char| c == ':' || c == '：').to_string();
    let common = ["abstract", "introduction", "conclusion", "conclusions", "references",
        "摘要", "引言", "结论", "参考文献"];
    if common.contains(&normalized.as_str()) { return true; }
    // Check for numbered sections like "1.", "1.1", "1.1."
    line.starts_with(|c: char| c.is_ascii_digit())
        && line.chars().take_while(|c| c.is_ascii_digit() || *c == '.').count() > 1
}

fn heading_level(title: &str) -> i32 {
    let dots = title.chars().take_while(|c| c.is_ascii_digit() || *c == '.').filter(|c| *c == '.').count();
    (dots as i32).min(5) + 1
}
