use crate::errors::AppResult;

const MAX_CONTENT_SIZE: usize = 25 * 1024 * 1024; // 25 MB

pub fn normalize_url(input: &str) -> Option<String> {
    let value = input.trim();
    if value.is_empty() { return None; }
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{}", value)
    };
    let url = url::Url::parse(&candidate).ok()?;
    match url.scheme() {
        "http" | "https" => {
            if url.host().is_some() { Some(url.to_string()) } else { None }
        }
        _ => None,
    }
}

pub async fn fetch_page(input: &str) -> AppResult<(Vec<u8>, String)> {
    let url_str = normalize_url(input).ok_or_else(|| crate::errors::AppError::Ai("无效的 URL".into()))?;
    let client = reqwest::Client::new();
    let response = client.get(&url_str)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 KnowledgeMaster/2.0")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await?;

    let status = response.status();
    if !status.is_success() {
        return Err(crate::errors::AppError::Ai(format!("HTTP {}", status)));
    }

    let content_type = response.headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    let bytes = response.bytes().await?;
    if bytes.len() > MAX_CONTENT_SIZE {
        return Err(crate::errors::AppError::Ai("内容超过 25 MB".into()));
    }

    // Validate HTML content
    let prefix = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_lowercase();
    let is_html = content_type.contains("text/html")
        || content_type.contains("application/xhtml+xml")
        || prefix.contains("<html")
        || prefix.contains("<!doctype html");

    if !is_html {
        return Err(crate::errors::AppError::Ai(format!("不是 HTML 网页（{}）", content_type)));
    }

    Ok((bytes.to_vec(), url_str.to_string()))
}

pub fn html_title(data: &[u8]) -> Option<String> {
    let source = String::from_utf8_lossy(data);
    // Try <title> tag
    let re = regex_lite::Regex::new(r"<title\b[^>]*>(.*?)</title>").ok()?;
    if let Some(caps) = re.captures(&source) {
        let title_html = caps.get(1)?.as_str();
        let doc = scraper::Html::parse_fragment(title_html);
        let title = doc.root_element().text().collect::<Vec<_>>().join("").trim().to_string();
        if !title.is_empty() {
            return Some(title);
        }
    }
    None
}
