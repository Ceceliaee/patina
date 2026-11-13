// The same identity palette used by objectColor when the app has no custom colour.
pub(super) fn app_color(key: &str) -> u32 {
    const COLORS: [u32; 7] = [
        0x36ac7e, 0x4790cf, 0x6f7ae6, 0xb07e55, 0x35a69e, 0xc56a73, 0x8c6fa1,
    ];
    if key == "activity:anonymous" {
        return 0x8f98a8;
    }
    let hash = "app:"
        .encode_utf16()
        .chain(key.encode_utf16())
        .fold(0u32, |hash, ch| {
            hash.wrapping_mul(31).wrapping_add(u32::from(ch))
        });
    COLORS[hash as usize % COLORS.len()]
}
