use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
use syn::{
    spanned::Spanned,
    visit::{self, Visit},
    Item,
};

struct Scope {
    source: PathBuf,
    spans: Vec<(usize, usize)>,
    external_tests: Vec<PathBuf>,
    all_test: bool,
}

impl<'ast> Visit<'ast> for Scope {
    fn visit_item(&mut self, item: &'ast Item) {
        let attrs = match item {
            Item::Const(x) => &x.attrs,
            Item::Enum(x) => &x.attrs,
            Item::ExternCrate(x) => &x.attrs,
            Item::Fn(x) => &x.attrs,
            Item::ForeignMod(x) => &x.attrs,
            Item::Impl(x) => &x.attrs,
            Item::Macro(x) => &x.attrs,
            Item::Mod(x) => &x.attrs,
            Item::Static(x) => &x.attrs,
            Item::Struct(x) => &x.attrs,
            Item::Trait(x) => &x.attrs,
            Item::TraitAlias(x) => &x.attrs,
            Item::Type(x) => &x.attrs,
            Item::Union(x) => &x.attrs,
            Item::Use(x) => &x.attrs,
            _ => return,
        };
        let test_only = self.all_test
            || attrs.iter().any(|attr| {
                attr.path().is_ident("cfg")
                    && matches!(attr.parse_args::<syn::Meta>(),
                Ok(syn::Meta::Path(path)) if path.is_ident("test"))
            });
        if test_only {
            self.spans
                .push((item.span().start().line, item.span().end().line));
            if let Item::Mod(module) = item {
                if module.content.is_none() {
                    let parent = self.source.parent().unwrap();
                    let explicit_path = attrs.iter().find_map(|attr| {
                        if !attr.path().is_ident("path") {
                            return None;
                        }
                        if let syn::Meta::NameValue(value) = &attr.meta {
                            if let syn::Expr::Lit(value) = &value.value {
                                if let syn::Lit::Str(value) = &value.lit {
                                    return Some(parent.join(value.value()));
                                }
                            }
                        }
                        None
                    });
                    if let Some(path) = explicit_path {
                        self.external_tests.push(path.canonicalize().unwrap());
                        return;
                    }
                    let stem = self.source.file_stem().unwrap().to_str().unwrap();
                    let base = if ["mod", "lib", "main"].contains(&stem) {
                        parent.to_path_buf()
                    } else {
                        parent.join(stem)
                    };
                    let name = module.ident.to_string();
                    for path in [
                        base.join(format!("{name}.rs")),
                        base.join(&name).join("mod.rs"),
                    ] {
                        if path.is_file() {
                            self.external_tests.push(path.canonicalize().unwrap());
                        }
                    }
                } else if self.all_test {
                    visit::visit_item(self, item);
                }
            }
        } else {
            visit::visit_item(self, item);
        }
    }
}

fn gather(path: &Path, files: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            gather(&path, files);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path);
        }
    }
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let root = PathBuf::from(&args[0]).canonicalize().unwrap();
    let mut files = Vec::new();
    gather(&root, &mut files);
    let mut spans = BTreeMap::new();
    let mut test_files = BTreeSet::new();
    let mut generated_files = Vec::new();
    for path in files {
        let content = std::fs::read_to_string(&path).unwrap();
        if content
            .lines()
            .next()
            .unwrap_or("")
            .starts_with("// Generated")
        {
            generated_files.push(path.clone());
        }
        let syntax = syn::parse_file(&content).unwrap();
        let mut scope = Scope {
            source: path.clone(),
            spans: Vec::new(),
            external_tests: Vec::new(),
            all_test: false,
        };
        scope.visit_file(&syntax);
        test_files.extend(scope.external_tests);
        spans.insert(path, scope.spans);
    }
    // External test roots can declare their own module files without #[cfg(test)].
    let mut pending: Vec<_> = test_files.iter().cloned().collect();
    while let Some(path) = pending.pop() {
        let syntax = syn::parse_file(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut scope = Scope {
            source: path,
            spans: Vec::new(),
            external_tests: Vec::new(),
            all_test: true,
        };
        scope.visit_file(&syntax);
        for child in scope.external_tests {
            if test_files.insert(child.clone()) {
                pending.push(child);
            }
        }
    }
    let result = serde_json::json!({"test_spans":spans,"test_files":test_files,"generated_files":generated_files});
    std::fs::write(&args[1], serde_json::to_vec_pretty(&result).unwrap()).unwrap();
}
