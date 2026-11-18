# AccessKit Windows adapter

This is the Windows adapter for [AccessKit](https://accesskit.dev/). It exposes an AccessKit accessibility tree through the UI Automation API.

## Patina desktop patch

Patina vendors the published `accesskit_windows 0.34.0` crate used by GPUI. The upstream source is [AccessKit at c88605b](https://github.com/AccessKit/accesskit/tree/c88605b96d04431f9c3c792464a0f2f253480e94/platforms/windows).

Geometry queries return `UIA_E_ELEMENTNOTAVAILABLE` if Windows reports that the HWND has been destroyed. Other coordinate conversion errors retain their HRESULT. The change covers the fragment bounds, point hit testing, text range lookup and text range bounds. The regression test keeps a provider alive across destruction of its window.

From this directory run `cargo test --locked --lib geometry_after_window_destruction`. The desktop workspace uses its own lockfile. Remove the local Cargo patch when the version used by GPUI passes this regression.
