#[test]
fn web_sync_guide_data_is_localized_and_preserves_actions() {
    use patina_recorder::{localized_data as data, text, Locale};
    for (locale, title) in [
        (Locale::ZhCn, "准备连接信息"),
        (Locale::EnUs, "Prepare connection details"),
        (Locale::RuRu, "Подготовьте параметры подключения"),
        (Locale::Es, "Preparar datos de conexión"),
    ] {
        let guide = data(locale, "settings.webActivityHelpSteps").unwrap();
        assert_eq!(guide.as_array().unwrap().len(), 4);
        assert_eq!(guide[0]["title"], title);
        assert_eq!(guide[1]["showStoreBadges"], true);
        assert_eq!(
            guide[1]["details"][0]["links"][0]["href"],
            "https://github.com/Ceceliaee/patina-web-sync/releases/latest"
        );
        assert_eq!(guide[2]["details"].as_array().unwrap().len(), 5);
        assert_eq!(guide[3]["details"].as_array().unwrap().len(), 3);
    }
    assert!(data(Locale::EnUs, "settings.webActivityHelpTitle").is_none());
    assert!(data(Locale::EnUs, "unknown").is_none());
    assert_eq!(
        text(Locale::EnUs, "settings.webActivityHelpTitle"),
        "Web Sync Guide"
    );
}
