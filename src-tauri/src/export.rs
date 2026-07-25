use std::fs;
use std::path::Path;
use crate::models::*;
use crate::errors::AppResult;

pub fn export_original(source: &Path, destination: &Path) -> AppResult<()> {
    if source == destination { return Ok(()); }
    if destination.exists() {
        fs::remove_file(destination)?;
    }
    fs::copy(source, destination)?;
    Ok(())
}

pub fn export_annotated(
    document: &KnowledgeDocument,
    source: &Path,
    annotations: &[KnowledgeAnnotation],
    destination: &Path,
) -> AppResult<()> {
    if document.extension_name == ".pdf" {
        export_annotated_pdf(source, annotations, destination)
    } else if [".html", ".htm"].contains(&document.extension_name.as_str()) {
        let source_text = fs::read_to_string(source)?;
        let output = annotated_html(&source_text, &document.display_title(), annotations);
        fs::write(destination, output)?;
        Ok(())
    } else {
        let source_text = fs::read_to_string(source)?;
        let output = annotated_markdown(&source_text, &document.display_title(), annotations);
        fs::write(destination, output)?;
        Ok(())
    }
}

pub fn annotated_filename(document: &KnowledgeDocument) -> String {
    let path = Path::new(&document.name);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let ext = if document.extension_name == ".pdf" {
        "pdf"
    } else if [".html", ".htm"].contains(&document.extension_name.as_str()) {
        "html"
    } else {
        "md"
    };
    format!("{}-带批注.{}", stem, ext)
}

fn export_annotated_pdf(source: &Path, _annotations: &[KnowledgeAnnotation], destination: &Path) -> AppResult<()> {
    // For now, just copy the PDF as-is. Full annotation embedding requires
    // further work with lopdf's annotation API.
    fs::copy(source, destination)?;
    Ok(())
}

fn annotated_markdown(source: &str, title: &str, annotations: &[KnowledgeAnnotation]) -> String {
    let items = annotations.iter().enumerate().map(|(i, item)| {
        let page = item.page.map(|p| format!(" · 第 {} 页", p)).unwrap_or_default();
        let quote = item.quote.lines()
            .map(|l| format!("> {}", l))
            .collect::<Vec<_>>()
            .join("\n");
        let note = if item.note.is_empty() {
            String::new()
        } else {
            format!("\n\n**笔记：** {}", item.note)
        };
        format!("### {}. {}{}\n\n{}{}", i + 1, kind_name(&item.kind), page, quote, note)
    }).collect::<Vec<_>>().join("\n\n");

    format!("{}\n\n---\n\n## 知屿批注 · {}\n\n{}\n", source, title, items)
}

fn annotated_html(source_html: &str, title: &str, annotations: &[KnowledgeAnnotation]) -> String {
    let rows = annotations.iter().enumerate().map(|(i, item)| {
        let page = item.page.map(|p| format!(" · 第 {} 页", p)).unwrap_or_default();
        let note = if item.note.is_empty() {
            String::new()
        } else {
            format!("<p><strong>笔记：</strong>{}</p>", escape_html(&item.note))
        };
        format!("<article><h3>{}. {}{}</h3><blockquote>{}</blockquote>{}</article>",
            i + 1, kind_name(&item.kind), page, escape_html(&item.quote), note)
    }).collect::<Vec<_>>().join("\n");

    let appendix = format!(
        r#"<section id="knowledgemaster-annotations" style="margin:3rem auto;padding:1.5rem;max-width:900px;border-top:2px solid #58a66a;font:16px/1.6 -apple-system,BlinkMacSystemFont,sans-serif"><h2>知屿批注 · {}</h2>{}</section>"#,
        escape_html(title), rows
    );

    if let Some(pos) = source_html.to_lowercase().rfind("</body>") {
        let mut result = source_html.to_string();
        result.insert_str(pos, &appendix);
        result
    } else {
        format!("{}{}", source_html, appendix)
    }
}

fn kind_name(kind: &str) -> &str {
    match kind {
        "underline" => "划线",
        "note" => "笔记",
        _ => "高亮",
    }
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
