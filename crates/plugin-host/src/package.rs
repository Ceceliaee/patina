use base64::{Engine, engine::general_purpose::STANDARD};
use patina_plugin_sdk::{Capability, Manifest};
use ring::signature::{ED25519, Ed25519KeyPair, KeyPair, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

pub(super) const MAX_PACKAGE: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Package {
    pub manifest: Manifest,
    #[serde(with = "encoded_wasm")]
    pub wasm: Vec<u8>,
    #[serde(default, skip_serializing_if = "crate::Catalogs::is_empty")]
    pub locales: crate::Catalogs,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub signature: String,
}

impl Package {
    pub(super) fn names(&self) -> std::collections::BTreeMap<String, String> {
        self.locales
            .iter()
            .filter_map(|(tag, c)| Some((tag.clone(), c.get("plugin.name")?.clone())))
            .collect()
    }

    pub(super) fn display_manifest(&self) -> Manifest {
        crate::localized_manifest(&self.manifest, &self.names())
    }

    fn signed_content(&self) -> Result<Vec<u8>, String> {
        if !self.locales.is_empty() {
            return serde_json::to_vec(&(
                "Patina tool v2",
                &self.manifest,
                STANDARD.encode(&self.wasm),
                &self.locales,
            ))
            .map_err(|e| e.to_string());
        }
        serde_json::to_vec(&(
            "Patina tool v1",
            &self.manifest,
            STANDARD.encode(&self.wasm),
        ))
        .map_err(|e| e.to_string())
    }

    pub(super) fn bundle_digest(&self) -> Result<[u8; 32], String> {
        Ok(Sha256::digest(self.signed_content()?).into())
    }

    pub fn sign(&mut self, key: &Ed25519KeyPair) -> Result<(), String> {
        self.publisher = STANDARD.encode(key.public_key());
        self.signature = STANDARD.encode(key.sign(&self.signed_content()?).as_ref());
        Ok(())
    }

    pub fn read_verified(path: &Path) -> Result<(Self, String), String> {
        let mut bytes = Vec::new();
        File::open(path)
            .and_then(|f| f.take(MAX_PACKAGE as u64 + 1).read_to_end(&mut bytes))
            .map_err(|e| e.to_string())?;
        if bytes.len() > MAX_PACKAGE {
            return Err("Package exceeds 8 MiB".into());
        }
        let package: Self = if bytes.starts_with(b"PK") {
            crate::archive::read(&bytes)?
        } else if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("patina-tool"))
        {
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())?
        } else {
            return Err("Expected a plugin ZIP".into());
        };
        package.verify_signature()?;
        package.validated_wasm()?;
        Ok((package, format!("{:x}", Sha256::digest(bytes))))
    }

    pub(super) fn verify_signature(&self) -> Result<(), String> {
        self.verify_content(&self.signed_content()?)
    }

    pub(super) fn verified_digest(&self) -> Result<[u8; 32], String> {
        let content = self.signed_content()?;
        self.verify_content(&content)?;
        Ok(Sha256::digest(content).into())
    }

    fn verify_content(&self, content: &[u8]) -> Result<(), String> {
        let key = STANDARD
            .decode(&self.publisher)
            .map_err(|e| e.to_string())?;
        let signature = STANDARD
            .decode(&self.signature)
            .map_err(|e| e.to_string())?;
        UnparsedPublicKey::new(&ED25519, key)
            .verify(content, &signature)
            .map_err(|_| "Invalid tool publisher signature")?;
        Ok(())
    }

    pub fn validated_wasm(&self) -> Result<&[u8], String> {
        crate::locales::validate(&self.locales).map_err(|e| e.to_string())?;
        let m = &self.manifest;
        if !matches!(m.api, 1..=8)
            || m.presentation.as_ref().is_some_and(|p| {
                p.names.len() > 64
                    || p.names
                        .iter()
                        .any(|(tag, name)| !display_text(tag, 64) || !display_text(name, 100))
            })
            || !identifier(&m.id)
            || !identifier(&m.entry)
            || !display_text(&m.name, 100)
            || !display_text(&m.version, 40)
            || !m.capabilities.contains(&Capability::Panel)
            || m.capabilities
                .iter()
                .enumerate()
                .any(|(i, cap)| m.capabilities[..i].contains(cap))
        {
            return Err("Unsupported tool manifest or capabilities".into());
        }
        let bytes = self.wasm.as_slice();
        if bytes.len() > MAX_PACKAGE || !bytes.starts_with(b"\0asm\x01\0\0\0") {
            return Err("A WebAssembly module is required".into());
        }
        Ok(bytes)
    }
}

pub(super) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value.starts_with(|c: char| c.is_ascii_lowercase())
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
}

pub(super) fn display_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
}

mod encoded_wasm {
    use super::*;
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(wasm: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(wasm))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        STANDARD
            .decode(String::deserialize(deserializer)?)
            .map_err(serde::de::Error::custom)
    }
}
