use crate::{
    models::{KnowledgeAnnotation, KnowledgeDocument},
    store::{error, stored_path, Inner},
};
use lopdf::{dictionary, Document, Object, ObjectId};
use std::{collections::HashMap, fs, path::Path};
use uuid::Uuid;

pub fn export_document(
    inner: &Inner,
    document_id: Uuid,
    destination: &Path,
    annotated: bool,
) -> Result<(), String> {
    let document = inner
        .data
        .documents
        .iter()
        .find(|document| document.id == document_id)
        .ok_or("文档不存在")?;
    let source = stored_path(&inner.root, document)?;
    if !annotated {
        fs::copy(source, destination).map_err(error)?;
        return Ok(());
    }
    let annotations: Vec<_> = inner
        .data
        .annotations
        .iter()
        .filter(|annotation| annotation.document_id == document_id)
        .cloned()
        .collect();
    match document.extension_name.as_str() {
        ".pdf" => export_pdf(&source, destination, &annotations),
        ".html" | ".htm" => export_html(&source, destination, document, &annotations),
        ".md" | ".markdown" | ".txt" => export_text(&source, destination, document, &annotations),
        _ => {
            let markdown = destination.with_extension("md");
            let body = format!(
                "# {} · 知屿批注\n\n原文档：`{}`\n{}",
                document.title(),
                document.name,
                annotation_appendix(document, &annotations)
            );
            fs::write(markdown, body).map_err(error)
        }
    }
}

fn export_pdf(
    source: &Path,
    destination: &Path,
    annotations: &[KnowledgeAnnotation],
) -> Result<(), String> {
    let mut document = Document::load(source).map_err(error)?;
    let pages = document.get_pages();
    let mut additions: HashMap<ObjectId, Vec<ObjectId>> = HashMap::new();
    for annotation in annotations {
        for rect in &annotation.rects {
            let Some(page_id) = pages.get(&(rect.page as u32)).copied() else {
                continue;
            };
            let x1 = rect.x;
            let y1 = rect.y;
            let x2 = rect.x + rect.width;
            let y2 = rect.y + rect.height;
            let subtype = if annotation.kind == "underline" {
                "Underline"
            } else {
                "Highlight"
            };
            let contents = if annotation.note.is_empty() {
                annotation.quote.clone()
            } else {
                format!("{}\n\n{}", annotation.quote, annotation.note)
            };
            let mut dictionary = dictionary! {
                "Type" => "Annot",
                "Subtype" => subtype,
                "Rect" => vec![x1.into(), y1.into(), x2.into(), y2.into()],
                "Contents" => Object::string_literal(contents),
                "NM" => Object::string_literal(format!("KM:{}", annotation.id)),
                "F" => 4,
            };
            if subtype == "Highlight" {
                dictionary.set("C", vec![1.into(), 0.84.into(), 0.2.into()]);
                dictionary.set(
                    "QuadPoints",
                    vec![
                        x1.into(),
                        y2.into(),
                        x2.into(),
                        y2.into(),
                        x1.into(),
                        y1.into(),
                        x2.into(),
                        y1.into(),
                    ],
                );
                dictionary.set("CA", 0.35);
            } else {
                dictionary.set("C", vec![0.91.into(), 0.55.into(), 0.08.into()]);
                dictionary.set(
                    "QuadPoints",
                    vec![
                        x1.into(),
                        y2.into(),
                        x2.into(),
                        y2.into(),
                        x1.into(),
                        y1.into(),
                        x2.into(),
                        y1.into(),
                    ],
                );
            }
            let annotation_id = document.add_object(dictionary);
            additions.entry(page_id).or_default().push(annotation_id);
        }
    }
    for (page_id, values) in additions {
        append_annotations(&mut document, page_id, values)?;
    }
    document.compress();
    document.save(destination).map_err(error)?;
    Ok(())
}

fn append_annotations(
    document: &mut Document,
    page_id: ObjectId,
    additions: Vec<ObjectId>,
) -> Result<(), String> {
    let existing = document
        .get_object(page_id)
        .map_err(error)?
        .as_dict()
        .map_err(error)?
        .get(b"Annots")
        .ok()
        .cloned();
    match existing {
        Some(Object::Reference(id)) => {
            let array = document
                .get_object_mut(id)
                .map_err(error)?
                .as_array_mut()
                .map_err(error)?;
            array.extend(additions.into_iter().map(Object::Reference));
        }
        Some(Object::Array(mut values)) => {
            values.extend(additions.into_iter().map(Object::Reference));
            document
                .get_object_mut(page_id)
                .map_err(error)?
                .as_dict_mut()
                .map_err(error)?
                .set("Annots", values);
        }
        _ => {
            document
                .get_object_mut(page_id)
                .map_err(error)?
                .as_dict_mut()
                .map_err(error)?
                .set(
                    "Annots",
                    additions
                        .into_iter()
                        .map(Object::Reference)
                        .collect::<Vec<_>>(),
                );
        }
    }
    Ok(())
}

fn export_text(
    source: &Path,
    destination: &Path,
    document: &KnowledgeDocument,
    annotations: &[KnowledgeAnnotation],
) -> Result<(), String> {
    let source = fs::read_to_string(source).map_err(error)?;
    fs::write(
        destination,
        format!("{source}{}", annotation_appendix(document, annotations)),
    )
    .map_err(error)
}

fn export_html(
    source: &Path,
    destination: &Path,
    document: &KnowledgeDocument,
    annotations: &[KnowledgeAnnotation],
) -> Result<(), String> {
    let source = fs::read_to_string(source).map_err(error)?;
    let rows = annotations
        .iter()
        .enumerate()
        .map(|(index, annotation)| {
            format!(
                "<article><h3>{}. {}{}</h3><blockquote>{}</blockquote>{}</article>",
                index + 1,
                kind_name(&annotation.kind),
                annotation
                    .page
                    .map(|page| format!(" · 第 {page} 页"))
                    .unwrap_or_default(),
                escape_html(&annotation.quote),
                if annotation.note.is_empty() {
                    String::new()
                } else {
                    format!(
                        "<p><strong>笔记：</strong>{}</p>",
                        escape_html(&annotation.note)
                    )
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let appendix = format!(
        "<section id=\"knowledgemaster-annotations\"><style>#knowledgemaster-annotations{{margin:3rem auto;padding:1.5rem;max-width:860px;border-top:2px solid #ddd}}#knowledgemaster-annotations blockquote{{border-left:4px solid #f2c94c;padding-left:1rem}}</style><h2>知屿批注 · {}</h2>{rows}</section>",
        escape_html(document.title())
    );
    let output = if let Some(index) = source.to_lowercase().rfind("</body>") {
        format!("{}{}{}", &source[..index], appendix, &source[index..])
    } else {
        format!("{source}{appendix}")
    };
    fs::write(destination, output).map_err(error)
}

fn annotation_appendix(
    document: &KnowledgeDocument,
    annotations: &[KnowledgeAnnotation],
) -> String {
    let items = annotations
        .iter()
        .enumerate()
        .map(|(index, annotation)| {
            let quote = annotation
                .quote
                .lines()
                .map(|line| format!("> {line}"))
                .collect::<Vec<_>>()
                .join("\n");
            format!(
                "### {}. {}{}\n\n{}{}",
                index + 1,
                kind_name(&annotation.kind),
                annotation
                    .page
                    .map(|page| format!(" · 第 {page} 页"))
                    .unwrap_or_default(),
                quote,
                if annotation.note.is_empty() {
                    String::new()
                } else {
                    format!("\n\n**笔记：** {}", annotation.note)
                }
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "\n\n---\n\n## 知屿批注 · {}\n\n{}\n",
        document.title(),
        items
    )
}

fn kind_name(kind: &str) -> &str {
    match kind {
        "underline" => "划线",
        "note" => "笔记",
        _ => "高亮",
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_appendix_contains_quote_and_note() {
        let document = KnowledgeDocument {
            id: Uuid::nil(),
            name: "paper.md".into(),
            display_name: None,
            extension_name: ".md".into(),
            size: 0,
            sha256: String::new(),
            stored_path: None,
            imported_at: String::new(),
            status: "ready".into(),
            page_count: None,
            error: None,
            source_url: None,
        };
        let annotation = KnowledgeAnnotation {
            id: Uuid::nil(),
            document_id: Uuid::nil(),
            page: Some(2),
            quote: "quoted".into(),
            kind: "highlight".into(),
            note: "note".into(),
            rects: vec![],
            created_at: String::new(),
            updated_at: String::new(),
        };
        let output = annotation_appendix(&document, &[annotation]);
        assert!(output.contains("> quoted"));
        assert!(output.contains("**笔记：** note"));
    }
}
