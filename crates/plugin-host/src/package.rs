use base64::{Engine, engine::general_purpose::STANDARD};
use patina_plugin_sdk::{Capability, Manifest};
use ring::signature::{ED25519, Ed25519KeyPair, KeyPair, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path};

const MAX_PACKAGE: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Package {
    pub manifest: Manifest,
    pub wasm: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub signature: String,
}

impl Package {
    fn signed_content(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&("Patina tool v1", &self.manifest, &self.wasm))
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
        let package: Self = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let key = STANDARD
            .decode(&package.publisher)
            .map_err(|e| e.to_string())?;
        let signature = STANDARD
            .decode(&package.signature)
            .map_err(|e| e.to_string())?;
        UnparsedPublicKey::new(&ED25519, key)
            .verify(&package.signed_content()?, &signature)
            .map_err(|_| "Invalid tool publisher signature")?;
        package.validated_wasm()?;
        Ok((package, format!("{:x}", Sha256::digest(bytes))))
    }

    pub fn validated_wasm(&self) -> Result<Vec<u8>, String> {
        let m = &self.manifest;
        if m.api != 1
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
        let bytes = STANDARD.decode(&self.wasm).map_err(|e| e.to_string())?;
        if !bytes.starts_with(b"\0asm\x01\0\0\0") {
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
