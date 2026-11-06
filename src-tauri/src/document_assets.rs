//! Portable image resources shared by originals and their translations.
use crate::store::error;
use base64::{engine::general_purpose::STANDARD, Engine};
use quick_xml::{events::Event, Reader};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, io::Read, path::Path};
use uuid::Uuid;

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn mime(path: &str) -> Option<&'static str> {
    match path
        .split(['?', '#'])
        .next()?
        .rsplit('.')
        .next()?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        "avif" => Some("image/avif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn image_reference() -> Regex {
    Regex::new(r#"(?i)(?:\bsrc\s*=\s*["']([^"']+)["']|!\[[^\]]*\]\(<?([^\s)>]+)>?(?:\s+[^)]*)?\))"#)
        .unwrap()
}

pub fn snapshot(root: &Path, id: Uuid, path: &Path, web_url: Option<&str>) -> Result<(), String> {
    let source = fs::read_to_string(path).map_err(error)?;
    let base = path
        .parent()
        .ok_or("图片目录不可用")?
        .canonicalize()
        .map_err(error)?;
    let mut mapping = HashMap::new();
    for capture in image_reference().captures_iter(&source) {
        let reference = capture.get(1).or_else(|| capture.get(2)).unwrap().as_str();
        if mapping.contains_key(reference) || reference.starts_with("data:") {
            continue;
        }
        let Some(content_type) = mime(reference) else {
            continue;
        };
        let remote = reqwest::Url::parse(reference)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"));
        let bytes = if let Some(url) = remote.or_else(|| {
            web_url
                .and_then(|base| reqwest::Url::parse(base).ok())
                .and_then(|base| base.join(reference).ok())
        }) {
            if !matches!(url.scheme(), "http" | "https") {
                continue;
            }
            let response = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .map_err(error)?
                .get(url)
                .send();
            let Ok(response) = response.and_then(|r| r.error_for_status()) else {
                continue;
            };
            let mut bytes = vec![];
            if response
                .take(25 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .is_err()
            {
                continue;
            }
            bytes
        } else {
            let Ok(local) = base.join(reference).canonicalize() else {
                continue;
            };
            if !local.starts_with(&base) {
                continue;
            }
            let Ok(bytes) = fs::read(local) else {
                continue;
            };
            bytes
        };
        if bytes.len() > 25 * 1024 * 1024 {
            continue;
        }
        let data = format!("data:{content_type};base64,{}", STANDARD.encode(bytes));
        mapping.insert(reference.to_owned(), persist_image(root, id, &data)?);
    }
    if !mapping.is_empty() {
        let dir = root.join("index/assets");
        fs::create_dir_all(&dir).map_err(error)?;
        fs::write(
            dir.join(format!("{id}.json")),
            serde_json::to_vec(&mapping).map_err(error)?,
        )
        .map_err(error)?;
    }
    Ok(())
}

fn persist_image(root: &Path, id: Uuid, data: &str) -> Result<String, String> {
    let (prefix, encoded) = data.split_once(";base64,").ok_or("图片编码无效")?;
    let extension = match prefix {
        "data:image/png" => "png",
        "data:image/jpeg" | "data:image/jpg" => "jpg",
        "data:image/gif" => "gif",
        "data:image/webp" => "webp",
        "data:image/svg+xml" => "svg",
        "data:image/avif" => "avif",
        "data:image/bmp" => "bmp",
        _ => return Err("不支持的图片格式".into()),
    };
    let bytes = STANDARD.decode(encoded).map_err(error)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let dir = root.join("source/assets").join(id.to_string());
    fs::create_dir_all(&dir).map_err(error)?;
    fs::write(dir.join(format!("{hash}.{extension}")), bytes).map_err(error)?;
    Ok(format!("../assets/{id}/{hash}.{extension}"))
}

fn map_references(content: &str, mut map: impl FnMut(&str) -> Option<String>) -> String {
    image_reference()
        .replace_all(content, |capture: &regex::Captures<'_>| {
            let reference = capture.get(1).or_else(|| capture.get(2)).unwrap();
            let Some(replacement) = map(reference.as_str()) else {
                return capture[0].to_owned();
            };
            let mut matched = capture[0].to_owned();
            let offset = reference.start() - capture.get(0).unwrap().start();
            matched.replace_range(offset..offset + reference.len(), &replacement);
            matched
        })
        .into_owned()
}

pub fn persist_html_images(root: &Path, id: Uuid, html: &str) -> Result<String, String> {
    let mut failure = None;
    let output = map_references(html, |src| {
        if !src.starts_with("data:image/") || !src.contains(";base64,") {
            return None;
        }
        match persist_image(root, id, src) {
            Ok(path) => Some(path),
            Err(message) => {
                failure = Some(message);
                None
            }
        }
    });
    failure.map_or(Ok(output), Err)
}

pub fn resolve(root: &Path, id: Uuid, content: &str) -> String {
    let mapping: HashMap<String, String> =
        fs::read(root.join("index/assets").join(format!("{id}.json")))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
    let base = root.join("source/documents");
    let Ok(allowed) = root.join("source/assets").canonicalize() else {
        return content.to_owned();
    };
    map_references(content, |src| {
        let relative = mapping.get(src).map(String::as_str).unwrap_or(src);
        let path = base.join(relative).canonicalize().ok()?;
        if !path.starts_with(&allowed) {
            return None;
        }
        let content_type = mime(relative)?;
        let bytes = fs::read(path).ok()?;
        Some(format!(
            "data:{content_type};base64,{}",
            STANDARD.encode(bytes)
        ))
    })
}

pub fn docx_html(path: &Path) -> Result<String, String> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).map_err(error)?).map_err(error)?;
    let mut relationships = String::new();
    if let Ok(mut file) = archive.by_name("word/_rels/document.xml.rels") {
        file.read_to_string(&mut relationships).map_err(error)?;
    }
    let mut images = HashMap::new();
    let mut reader = Reader::from_str(&relationships);
    while let Ok(event) = reader.read_event() {
        match event {
            Event::Empty(e) | Event::Start(e) if e.name().as_ref() == b"Relationship" => {
                let attrs: HashMap<_, _> = e
                    .attributes()
                    .flatten()
                    .filter_map(|a| {
                        Some((
                            String::from_utf8_lossy(a.key.as_ref()).into_owned(),
                            a.decoded_and_normalized_value(
                                quick_xml::XmlVersion::Implicit1_0,
                                reader.decoder(),
                            )
                            .ok()?
                            .into_owned(),
                        ))
                    })
                    .collect();
                if let (Some(id), Some(target)) = (attrs.get("Id"), attrs.get("Target")) {
                    if !target.starts_with("media/") {
                        continue;
                    }
                    if let (Some(content_type), Ok(mut file)) =
                        (mime(target), archive.by_name(&format!("word/{target}")))
                    {
                        let mut bytes = vec![];
                        file.read_to_end(&mut bytes).map_err(error)?;
                        images.insert(
                            id.clone(),
                            format!("data:{content_type};base64,{}", STANDARD.encode(bytes)),
                        );
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(error)?
        .read_to_string(&mut xml)
        .map_err(error)?;
    let mut reader = Reader::from_str(&xml);
    let mut html = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event().map_err(error)? {
            Event::Start(e) if e.name().as_ref() == b"a:blip" => {
                for attr in e.attributes().flatten() {
                    if attr.key.as_ref() == b"r:embed" {
                        let id = attr
                            .decoded_and_normalized_value(
                                quick_xml::XmlVersion::Implicit1_0,
                                reader.decoder(),
                            )
                            .map_err(error)?;
                        if let Some(src) = images.get(id.as_ref()) {
                            html.push_str(&format!("<img src=\"{src}\" alt=\"\">"));
                        }
                    }
                }
            }
            Event::Start(e) => match e.name().as_ref() {
                b"w:p" => html.push_str("<p>"),
                b"w:tbl" => html.push_str("<table>"),
                b"w:tr" => html.push_str("<tr>"),
                b"w:tc" => html.push_str("<td>"),
                b"w:t" => in_text = true,
                _ => {}
            },
            Event::End(e) => match e.name().as_ref() {
                b"w:p" => html.push_str("</p>"),
                b"w:tbl" => html.push_str("</table>"),
                b"w:tr" => html.push_str("</tr>"),
                b"w:tc" => html.push_str("</td>"),
                b"w:t" => in_text = false,
                _ => {}
            },
            Event::Text(e) if in_text => html.push_str(&escape(&e.decode().map_err(error)?)),
            Event::GeneralRef(e) if in_text => {
                html.push_str(&format!("&{};", e.decode().map_err(error)?))
            }
            Event::Empty(e) => match e.name().as_ref() {
                b"w:br" => html.push_str("<br>"),
                b"w:tab" => html.push_str("&#9;"),
                b"a:blip" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"r:embed" {
                            let id = attr
                                .decoded_and_normalized_value(
                                    quick_xml::XmlVersion::Implicit1_0,
                                    reader.decoder(),
                                )
                                .map_err(error)?;
                            if let Some(src) = images.get(id.as_ref()) {
                                html.push_str(&format!("<img src=\"{src}\" alt=\"\">"));
                            }
                        }
                    }
                }
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn docx_preview_keeps_text_table_order_and_embedded_images() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("paper.docx");
        let mut zip = zip::ZipWriter::new(fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for (name, bytes) in [
            ("word/document.xml", "<w:document><w:body><w:p><w:r><w:t>Text &amp; text</w:t></w:r><w:r><a:blip r:embed=\"rId1\"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"),
            ("word/_rels/document.xml.rels", "<Relationships><Relationship Id=\"rId1\" Target=\"media/image.png\"/></Relationships>"),
            ("word/media/image.png", "png fixture"),
        ] { zip.start_file(name, options).unwrap(); zip.write_all(bytes.as_bytes()).unwrap(); }
        zip.finish().unwrap();
        let html = docx_html(&path).unwrap();
        assert!(html.contains("Text &amp; text"));
        assert!(html.contains("<img src=\"data:image/png;base64,"));
        assert!(html.contains("<table><tr><td><p>Cell</p></td></tr></table>"));
        assert!(html.find("Text").unwrap() < html.find("<table>").unwrap());
    }

    #[test]
    fn resource_snapshot_survives_source_removal_and_rejects_paths_outside_assets() {
        let root = tempfile::tempdir().unwrap();
        crate::store::prepare_directories(root.path()).unwrap();
        let input = tempfile::tempdir().unwrap();
        fs::write(input.path().join("figure.png"), b"fixture").unwrap();
        let path = input.path().join("article.md");
        let markdown = "A paragraph\n\n![figure](figure.png)";
        fs::write(&path, markdown).unwrap();
        let id = Uuid::new_v4();
        snapshot(root.path(), id, &path, None).unwrap();
        drop(input);
        let html = resolve(root.path(), id, markdown);
        assert!(html.contains("data:image/png;base64,"));
        let secret = root.path().join("outside.png");
        fs::write(&secret, b"private").unwrap();
        let malicious = format!("<img src=\"{}\">", secret.display());
        assert_eq!(resolve(root.path(), id, &malicious), malicious);
    }
}
