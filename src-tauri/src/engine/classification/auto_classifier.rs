use scraper::{Html, Selector};
use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct AutoClassification {
    pub category: Option<String>,
    pub display_name: Option<String>,
}

/// Built-in local rules — exe_name → (official_name, category)
/// Reuses the same categories as the existing legacy frontend rules.
const BUILTIN_RULES: &[(&str, &str, &str)] = &[
    ("chrome.exe", "Google Chrome", "browser"),
    ("msedge.exe", "Microsoft Edge", "browser"),
    ("firefox.exe", "Mozilla Firefox", "browser"),
    ("opera.exe", "Opera", "browser"),
    ("brave.exe", "Brave", "browser"),
    ("vivaldi.exe", "Vivaldi", "browser"),
    ("arc.exe", "Arc", "browser"),
    ("code.exe", "Visual Studio Code", "development"),
    ("vscodium.exe", "VSCodium", "development"),
    ("cursor.exe", "Cursor", "development"),
    ("idea64.exe", "IntelliJ IDEA", "development"),
    ("pycharm64.exe", "PyCharm", "development"),
    ("webstorm64.exe", "WebStorm", "development"),
    ("clion64.exe", "CLion", "development"),
    ("goland64.exe", "GoLand", "development"),
    ("rider64.exe", "Rider", "development"),
    ("devenv.exe", "Visual Studio", "development"),
    ("sublime_text.exe", "Sublime Text", "development"),
    ("notepad++.exe", "Notepad++", "development"),
    ("wechat.exe", "WeChat", "communication"),
    ("weixin.exe", "WeChat", "communication"),
    ("qq.exe", "QQ", "communication"),
    ("qqnt.exe", "QQ", "communication"),
    ("discord.exe", "Discord", "communication"),
    ("slack.exe", "Slack", "communication"),
    ("telegram.exe", "Telegram", "communication"),
    ("dingtalk.exe", "DingTalk", "communication"),
    ("lark.exe", "Lark", "communication"),
    ("teams.exe", "Microsoft Teams", "office"),
    ("zoom.exe", "Zoom", "office"),
    ("winword.exe", "Microsoft Word", "office"),
    ("excel.exe", "Microsoft Excel", "office"),
    ("powerpnt.exe", "Microsoft PowerPoint", "office"),
    ("onenote.exe", "Microsoft OneNote", "office"),
    ("outlook.exe", "Microsoft Outlook", "office"),
    ("wps.exe", "WPS Office", "office"),
    ("wpsoffice.exe", "WPS Office", "office"),
    ("et.exe", "WPS Spreadsheets", "office"),
    ("wpp.exe", "WPS Presentation", "office"),
    ("obsidian.exe", "Obsidian", "browser"),
    ("notion.exe", "Notion", "office"),
    ("spotify.exe", "Spotify", "music"),
    ("vlc.exe", "VLC Media Player", "video"),
    ("steam.exe", "Steam", "game"),
    ("epicgameslauncher.exe", "Epic Games Launcher", "game"),
    ("bilibili.exe", "Bilibili", "video"),
    ("douyin.exe", "Douyin", "video"),
    ("qqmusic.exe", "QQ Music", "music"),
    ("neteasemusic.exe", "Netease Music", "music"),
    ("powershell.exe", "PowerShell", "development"),
    ("pwsh.exe", "PowerShell 7", "development"),
    ("windowsterminal.exe", "Windows Terminal", "development"),
    ("wt.exe", "Windows Terminal", "development"),
    ("explorer.exe", "File Explorer", "utility"),
    ("todesk.exe", "ToDesk", "utility"),
    ("teamviewer.exe", "TeamViewer", "utility"),
    ("anydesk.exe", "AnyDesk", "utility"),
];

const CATEGORY_KEYWORDS: &[(&[&str], &str)] = &[
    (
        &[
            "integrated development environment",
            "programming language",
            "software development",
            "code editor",
            "compiler",
            "debugger",
            "devops",
            "version control",
            "database management",
            "web development",
            "api",
            "sdk",
            "software engineering",
        ],
        "development",
    ),
    (
        &["web browser", "internet", "world wide web", "browser engine"],
        "browser",
    ),
    (
        &[
            "office suite",
            "word processor",
            "spreadsheet",
            "presentation software",
            "document management",
            "productivity software",
        ],
        "office",
    ),
    (
        &[
            "communication software",
            "instant messaging",
            "video conferencing",
            "email client",
            "social media",
            "telephony",
            "voip",
            "virtual meeting",
        ],
        "communication",
    ),
    (
        &["video player", "video editing", "streaming media", "multimedia", "video codec", "video production"],
        "video",
    ),
    (
        &["audio player", "music software", "digital audio", "music production", "music player"],
        "music",
    ),
    (
        &["video game", "gaming", "game engine", "computer game", "game development"],
        "game",
    ),
    (
        &[
            "graphics software",
            "image editing",
            "vector graphics",
            "computer-aided design",
            "3d graphics",
            "animation",
            "graphic design",
            "raster graphics",
            "photo",
        ],
        "design",
    ),
    (
        &[
            "artificial intelligence",
            "machine learning",
            "chatbot",
            "large language model",
            "neural network",
            "natural language processing",
            "computer vision",
            "deep learning",
        ],
        "ai",
    ),
    (
        &[
            "utility software",
            "system software",
            "file manager",
            "compression",
            "antivirus",
            "backup",
            "disk utility",
            "system utility",
            "archive",
        ],
        "utility",
    ),
];

const KEYWORD_BLACKLIST: &[&str] = &[
    "download now",
    "free download",
    "coupon",
    "promotion",
    "pizza",
    "food",
    "travel",
    "recipe",
    "restaurant",
    "blog",
    "sponsored",
    "advertisement",
];

const TRUSTED_DOMAINS: &[&str] = &[
    "github.com",
    "github.io",
    "microsoft.com",
    "google.com",
    "wikipedia.org",
    "apple.com",
];

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

fn urlencode(s: &str) -> String {
    s.as_bytes()
        .iter()
        .map(|&b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            b' ' => "+".to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

fn map_text_to_category(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    for &(keywords, category) in CATEGORY_KEYWORDS {
        for kw in keywords {
            if lower.contains(kw) {
                return Some(category);
            }
        }
    }
    None
}

fn jaro_winkler(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    let a_chars: Vec<char> = a.chars().collect();
    let b_chars: Vec<char> = b.chars().collect();
    let a_len = a_chars.len();
    let b_len = b_chars.len();

    if a_len == 0 || b_len == 0 {
        return 0.0;
    }

    let match_distance = (a_len.max(b_len) / 2).saturating_sub(1);

    let mut a_matches = vec![false; a_len];
    let mut b_matches = vec![false; b_len];
    let mut matches = 0usize;
    let mut transpositions = 0usize;

    for i in 0..a_len {
        let start = if i > match_distance { i - match_distance } else { 0 };
        let end = (i + match_distance + 1).min(b_len);
        for j in start..end {
            if b_matches[j] || a_chars[i] != b_chars[j] {
                continue;
            }
            a_matches[i] = true;
            b_matches[j] = true;
            matches += 1;
            break;
        }
    }

    if matches == 0 {
        return 0.0;
    }

    let mut k = 0;
    for i in 0..a_len {
        if !a_matches[i] {
            continue;
        }
        while !b_matches[k] {
            k += 1;
        }
        if a_chars[i] != b_chars[k] {
            transpositions += 1;
        }
        k += 1;
    }

    let jaro = (matches as f64 / a_len as f64
        + matches as f64 / b_len as f64
        + (matches as f64 - transpositions as f64 / 2.0) / matches as f64)
        / 3.0;

    let prefix_len = a_chars
        .iter()
        .zip(b_chars.iter())
        .take_while(|(x, y)| x == y)
        .count()
        .min(4) as f64;

    jaro + prefix_len * 0.1 * (1.0 - jaro)
}

fn contains_blacklisted_keyword(text: &str) -> bool {
    let lower = text.to_lowercase();
    KEYWORD_BLACKLIST.iter().any(|&kw| lower.contains(kw))
}

fn extract_primary_name(exe_name: &str) -> &str {
    exe_name.trim().trim_end_matches(".exe").trim()
}

/// Returns `true` if the candidate display name is similar enough to the original name.
fn validate_display_name(display_name: &str, original_name: &str) -> bool {
    if contains_blacklisted_keyword(display_name) {
        return false;
    }
    let primary = extract_primary_name(original_name);
    if primary.len() < 2 {
        return false;
    }
    let similarity = jaro_winkler(primary, display_name);
    similarity >= 0.35
}

// ── Layer 1: Built-in rules ──────────────────────────────────────────

fn check_builtin_rules(exe_name: &str) -> Option<AutoClassification> {
    let canonical = exe_name.trim().to_lowercase();
    for &(rule_exe, official_name, category) in BUILTIN_RULES {
        if canonical == rule_exe {
            return Some(AutoClassification {
                category: Some(category.to_string()),
                display_name: Some(official_name.to_string()),
            });
        }
    }
    None
}

// ── Layer 2: GitHub API search ───────────────────────────────────────

#[derive(Deserialize)]
struct GitHubSearchResponse {
    items: Vec<GitHubRepo>,
}

#[derive(Deserialize)]
struct GitHubRepo {
    #[serde(rename = "full_name")]
    full_name: String,
    description: Option<String>,
}

async fn search_github(query: &str) -> Result<Option<AutoClassification>, String> {
    let client = build_client()?;
    let url = format!(
        "https://api.github.com/search/repositories?q={}+in:name&per_page=1&sort=stars",
        urlencode(query)
    );

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("GitHub search failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body: GitHubSearchResponse = resp
        .json()
        .await
        .map_err(|e| format!("GitHub parse failed: {e}"))?;

    let repo = match body.items.into_iter().next() {
        Some(r) => r,
        None => return Ok(None),
    };

    let category = repo
        .description
        .as_deref()
        .and_then(map_text_to_category)
        .or_else(|| map_text_to_category(&repo.full_name))
        .map(|s| s.to_string());

    let display_name = Some(repo.full_name);

    Ok(Some(AutoClassification {
        category,
        display_name,
    }))
}

// ── Layer 3: Bing China search ──────────────────────────────────────

async fn search_bing_china(client: &reqwest::Client, query: &str) -> Result<Option<AutoClassification>, String> {
    let url = format!("https://cn.bing.com/search?q={}+software&ensearch=0", urlencode(query));

    let resp = client
        .get(&url)
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Bing China search failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Bing China read failed: {e}"))?;

    extract_bing_results(&body)
}

async fn search_bing_global(client: &reqwest::Client, query: &str) -> Result<Option<AutoClassification>, String> {
    let url = format!("https://www.bing.com/search?q={}+software&setlang=en-US", urlencode(query));

    let resp = client
        .get(&url)
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Bing search failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Bing read failed: {e}"))?;

    extract_bing_results(&body)
}

fn extract_bing_results(body: &str) -> Result<Option<AutoClassification>, String> {
    let doc = Html::parse_document(body);

    let selectors = [
        Selector::parse("li.b_algo h2 a").ok(),
        Selector::parse(".b_algo h2 a").ok(),
        Selector::parse("h2 a").ok(),
    ];

    for sel in selectors.iter().flatten() {
        for el in doc.select(sel) {
            let title = el.text().collect::<String>().trim().to_string();
            if title.is_empty() || title.len() > 120 || contains_blacklisted_keyword(&title) {
                continue;
            }

            let href = el.value().attr("href").unwrap_or_default();
            if !href.is_empty() && !is_trusted_domain(href) {
                continue;
            }

            let category = map_text_to_category(&title).map(|s| s.to_string());
            return Ok(Some(AutoClassification {
                category,
                display_name: Some(title),
            }));
        }
    }

    let snippet_sel = Selector::parse(".b_caption p").ok();
    if let Some(sel) = snippet_sel {
        for el in doc.select(&sel) {
            let text = el.text().collect::<String>().trim().to_string();
            if text.is_empty() || contains_blacklisted_keyword(&text) {
                continue;
            }
            if let Some(cat) = map_text_to_category(&text) {
                return Ok(Some(AutoClassification {
                    category: Some(cat.to_string()),
                    display_name: None,
                }));
            }
        }
    }

    Ok(None)
}

// ── Layer 4: Baidu search ───────────────────────────────────────────

async fn search_baidu(client: &reqwest::Client, query: &str) -> Result<Option<AutoClassification>, String> {
    let url = format!("https://www.baidu.com/s?wd={}+software", urlencode(query));

    let resp = client
        .get(&url)
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Baidu search failed: {e}"))?;

    if !resp.status().is_success() {
        return Ok(None);
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Baidu read failed: {e}"))?;

    let doc = Html::parse_document(&body);

    // Baidu results: <div class="result c-container"> → <h3 class="t"> → <a>
    let result_sel = Selector::parse("div.result.c-container").ok();
    if let Some(sel) = result_sel {
        for container in doc.select(&sel) {
            let link_sel = Selector::parse("h3.t a").ok();
            if let Some(link_s) = link_sel {
                if let Some(el) = container.select(&link_s).next() {
                    let title = el.text().collect::<String>().trim().to_string();
                    if title.is_empty() || title.len() > 120 || contains_blacklisted_keyword(&title) {
                        continue;
                    }

                    let href = el.value().attr("href").unwrap_or_default();
                    if !href.is_empty() && !is_trusted_domain(href) {
                        continue;
                    }

                    let category = map_text_to_category(&title).map(|s| s.to_string());
                    return Ok(Some(AutoClassification {
                        category,
                        display_name: Some(title),
                    }));
                }
            }
        }
    }

    Ok(None)
}

fn is_trusted_domain(url: &str) -> bool {
    url.to_lowercase()
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .map(|rest| {
            let domain = rest.split('/').next().unwrap_or("");
            TRUSTED_DOMAINS
                .iter()
                .any(|td| domain == *td || domain.ends_with(&format!(".{td}")))
        })
        .unwrap_or(false)
}

fn validate_search_result(result: &AutoClassification, query: &str) -> AutoClassification {
    match result.display_name {
        Some(ref dn) if validate_display_name(dn, query) => AutoClassification {
            display_name: result.display_name.clone(),
            category: result.category.clone(),
        },
        _ => AutoClassification {
            display_name: None,
            category: result.category.clone(),
        },
    }
}

// ── Layer 1.5: PE file version info (offline, exe from disk) ────────

fn search_exe_in_path(exe_name: &str, extra_dirs: &[String]) -> Option<std::path::PathBuf> {
    let trimmed = exe_name.trim();
    let candidates = if trimmed.to_lowercase().ends_with(".exe") {
        vec![trimmed.to_string()]
    } else {
        vec![format!("{trimmed}.exe"), trimmed.to_string()]
    };

    let system32 = std::path::PathBuf::from(r"C:\Windows\System32");
    if let Ok(_dir) = system32.read_dir() {
        for cand in &candidates {
            let full = system32.join(cand);
            if full.exists() {
                return Some(full);
            }
        }
    }

    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            for cand in &candidates {
                let full = dir.join(cand);
                if full.exists() {
                    return Some(full);
                }
            }
        }
    }

    let common = [
        r"C:\Program Files",
        r"C:\Program Files (x86)",
        r"C:\Program Files\WindowsApps",
        r"C:\Users",
    ];
    for base in &common {
        let dir = std::path::PathBuf::from(base);
        if let Ok(entries) = dir.read_dir() {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    for cand in &candidates {
                        let full = path.join(cand);
                        if full.exists() {
                            return Some(full);
                        }
                    }
                    // Search one level deeper for common patterns
                    if let Ok(sub_entries) = path.read_dir() {
                        for sub in sub_entries.flatten() {
                            let sub_path = sub.path();
                            if sub_path.is_dir() {
                                for cand in &candidates {
                                    let full = sub_path.join(cand);
                                    if full.exists() {
                                        return Some(full);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    for base in extra_dirs {
        let dir = std::path::PathBuf::from(base);
        if let Ok(entries) = dir.read_dir() {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    for cand in &candidates {
                        let full = path.join(cand);
                        if full.exists() {
                            return Some(full);
                        }
                    }
                    // Search one level deeper for common patterns
                    if let Ok(sub_entries) = path.read_dir() {
                        for sub in sub_entries.flatten() {
                            let sub_path = sub.path();
                            if sub_path.is_dir() {
                                for cand in &candidates {
                                    let full = sub_path.join(cand);
                                    if full.exists() {
                                        return Some(full);
                                    }
                                }
                            }
                        }
                    }
                } else if path.is_file() {
                    for cand in &candidates {
                        let full = dir.join(cand);
                        if full.exists() {
                            return Some(full);
                        }
                    }
                }
            }
        }
    }

    None
}

fn read_pe_version_info(exe_path: &std::path::Path) -> Result<(Option<String>, Option<String>), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

    let path_wide: Vec<u16> = exe_path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut handle = 0u32;
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(path_wide.as_ptr()), Some(&mut handle)) };
    if size == 0 {
        return Ok((None, None));
    }

    let mut buf = vec![0u8; size as usize];
    unsafe {
        GetFileVersionInfoW(
            PCWSTR(path_wide.as_ptr()),
            Some(0),
            size,
            buf.as_mut_ptr() as *mut _,
        )
        .map_err(|_| "GetFileVersionInfoW failed".to_string())?;
    }

    let mut product_name: Option<String> = None;
    let mut company_name: Option<String> = None;

    // Try to read \StringFileInfo\*\ProductName
    let sub_block = "\\StringFileInfo\\040904B0\\ProductName\0";
    let sub_wide: Vec<u16> = sub_block.encode_utf16().collect();

    let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    let result = unsafe {
        VerQueryValueW(
            buf.as_ptr() as _,
            PCWSTR(sub_wide.as_ptr()),
            &mut ptr,
            &mut len,
        )
    };
    if result.as_bool() && !ptr.is_null() && len > 0 {
        let data = ptr as *const u16;
        let slice = unsafe { std::slice::from_raw_parts(data, len as usize) };
        let s = String::from_utf16_lossy(slice);
        let trimmed = s.trim().trim_end_matches('\0').to_string();
        if !trimmed.is_empty() {
            product_name = Some(trimmed);
        }
    }

    let sub_block = "\\StringFileInfo\\040904B0\\CompanyName\0";
    let sub_wide: Vec<u16> = sub_block.encode_utf16().collect();
    let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
    let mut len: u32 = 0;
    let result = unsafe {
        VerQueryValueW(
            buf.as_ptr() as _,
            PCWSTR(sub_wide.as_ptr()),
            &mut ptr,
            &mut len,
        )
    };
    if result.as_bool() && !ptr.is_null() && len > 0 {
        let data = ptr as *const u16;
        let slice = unsafe { std::slice::from_raw_parts(data, len as usize) };
        let s = String::from_utf16_lossy(slice);
        let trimmed = s.trim().trim_end_matches('\0').to_string();
        if !trimmed.is_empty() {
            company_name = Some(trimmed);
        }
    }

    Ok((product_name, company_name))
}

fn classify_by_pe(exe_name: &str, extra_dirs: &[String]) -> Result<Option<AutoClassification>, String> {
    let exe_path = match search_exe_in_path(exe_name, extra_dirs) {
        Some(p) => p,
        None => return Ok(None),
    };

    let (product_name, company_name) = read_pe_version_info(&exe_path)?;
    let display_name = product_name.clone();

    // Derive category from product name or company name
    let category = product_name
        .as_deref()
        .and_then(map_text_to_category)
        .or_else(|| company_name.as_deref().and_then(map_text_to_category))
        .map(|s| s.to_string());

    if display_name.is_none() && category.is_none() {
        return Ok(None);
    }

    Ok(Some(AutoClassification {
        category,
        display_name,
    }))
}

// ── Public API ────────────────────────────────────────────────────────

pub async fn classify_app(
    app_name: &str,
    exe_name: &str,
    extra_dirs: &[String],
) -> Result<Option<AutoClassification>, String> {
    let query = {
        let trimmed = app_name.trim();
        if trimmed.len() >= 2 {
            trimmed.to_string()
        } else {
            let fallback = extract_primary_name(exe_name);
            if fallback.len() >= 2 {
                fallback.to_string()
            } else {
                return Ok(None);
            }
        }
    };

    // Layer 1: Built-in local rules
    if let Some(result) = check_builtin_rules(exe_name) {
        return Ok(Some(result));
    }

    // Layer 1.5: PE file version info from disk
    if let Ok(Some(result)) = classify_by_pe(exe_name, extra_dirs) {
        return Ok(Some(result));
    }

    // Layer 2: GitHub API search (for open-source / GitHub-sourced software)
    if let Ok(Some(result)) = search_github(&query).await {
        // If GitHub found something, validate display_name
        if let Some(ref dn) = result.display_name {
            if validate_display_name(dn, &query) {
                return Ok(Some(AutoClassification {
                    display_name: result.display_name,
                    category: result.category,
                }));
            }
            // Display name failed validation — return category only
            return Ok(Some(AutoClassification {
                display_name: None,
                category: result.category,
            }));
        }
        return Ok(Some(result));
    }

    // Layer 3: Web search — try Bing China, then Baidu, then global Bing
    let client = build_client()?;

    // Try Bing China first (works in China)
    let search_result = search_bing_china(&client, &query).await?;
    if let Some(ref result) = search_result {
        return Ok(Some(validate_search_result(result, &query)));
    }

    // Try Baidu next
    let baidu_result = search_baidu(&client, &query).await?;
    if let Some(ref result) = baidu_result {
        return Ok(Some(validate_search_result(result, &query)));
    }

    // Finally try global Bing
    let global_result = search_bing_global(&client, &query).await?;
    if let Some(ref result) = global_result {
        return Ok(Some(validate_search_result(result, &query)));
    }

    Ok(None)
}
