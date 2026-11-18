use quick_xml::{events::Event, name::ResolveResult, reader::NsReader};
use reqwest::Url;

#[derive(Default)]
struct Element {
    name: String,
    text: String,
    children: Vec<Element>,
}

impl Element {
    fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Element> {
        self.children.iter().filter(move |child| child.name == name)
    }
}

pub(super) fn confirms_collection(xml: &str, target: &Url) -> Result<bool, String> {
    let invalid = || "webdav_directory_invalid_response".to_string();
    let mut reader = NsReader::from_str(xml);
    reader.config_mut().expand_empty_elements = true;
    let mut stack = vec![Element::default()];
    let mut nodes = 0;
    loop {
        let (namespace, event) = reader.read_resolved_event().map_err(|_| invalid())?;
        match event {
            Event::Start(element) => {
                nodes += 1;
                if nodes > 2048 || stack.len() > 32 {
                    return Err(invalid());
                }
                let name = if matches!(namespace, ResolveResult::Bound(ns) if ns.as_ref() == b"DAV:")
                {
                    String::from_utf8(element.local_name().as_ref().to_vec())
                        .map_err(|_| invalid())?
                } else {
                    String::new()
                };
                stack.push(Element {
                    name,
                    ..Element::default()
                });
            }
            Event::Text(text) => {
                let decoded = text.decode().map_err(|_| invalid())?;
                stack
                    .last_mut()
                    .ok_or_else(invalid)?
                    .text
                    .push_str(&quick_xml::escape::unescape(&decoded).map_err(|_| invalid())?);
            }
            Event::GeneralRef(reference) => {
                let decoded = reference.decode().map_err(|_| invalid())?;
                let escaped = format!("&{decoded};");
                stack
                    .last_mut()
                    .ok_or_else(invalid)?
                    .text
                    .push_str(&quick_xml::escape::unescape(&escaped).map_err(|_| invalid())?);
            }
            Event::End(_) => {
                if stack.len() < 2 {
                    return Err(invalid());
                }
                let child = stack.pop().ok_or_else(invalid)?;
                stack.last_mut().ok_or_else(invalid)?.children.push(child);
            }
            Event::DocType(_) | Event::CData(_) => return Err(invalid()),
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return Err(invalid());
    }
    let document = stack.pop().ok_or_else(invalid)?;
    if document.children.len() != 1 || document.children[0].name != "multistatus" {
        return Err(invalid());
    }
    let mut matched = None;
    for response in document.children[0].children_named("response") {
        let hrefs: Vec<_> = response.children_named("href").collect();
        if hrefs.len() != 1 {
            return Err(invalid());
        }
        let href = target.join(hrefs[0].text.trim()).map_err(|_| invalid())?;
        if href.origin() != target.origin()
            || href.query().is_some()
            || href.fragment().is_some()
            || percent_encoding::percent_decode_str(href.path().trim_end_matches('/'))
                .collect::<Vec<_>>()
                != percent_encoding::percent_decode_str(target.path().trim_end_matches('/'))
                    .collect::<Vec<_>>()
        {
            continue;
        }
        if matched.is_some() {
            return Err(invalid());
        }
        let collection = response.children_named("propstat").any(|propstat| {
            propstat
                .children_named("status")
                .any(|status| status.text.split_whitespace().nth(1) == Some("200"))
                && propstat.children_named("prop").any(|prop| {
                    prop.children_named("resourcetype")
                        .any(|kind| kind.children_named("collection").next().is_some())
                })
        });
        matched = Some(collection);
    }
    matched.ok_or_else(invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_matching_dav_success_properties_prove_a_collection() {
        let target = Url::parse("https://example.test/dav/").unwrap();
        let xml = "<multistatus xmlns=\"DAV:\"><response><href>/dav/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>";
        assert_eq!(confirms_collection(xml, &target), Ok(true));
        assert_eq!(
            confirms_collection(&xml.replace("200 OK", "403 Forbidden"), &target),
            Ok(false)
        );
        assert!(confirms_collection(&xml.replace("DAV:", "other:"), &target).is_err());
        assert!(
            confirms_collection(&xml.replace("/dav/", "https://other.test/dav/"), &target).is_err()
        );
        assert!(confirms_collection(&format!("<!DOCTYPE x>{xml}"), &target).is_err());
        assert!(confirms_collection(&format!("{xml}{xml}"), &target).is_err());
        assert!(confirms_collection(&xml.replace("</response>", ""), &target).is_err());
    }
}
