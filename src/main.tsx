import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { iconThemeColorStore } from "./platform/persistence/iconThemeColorStore.ts";
import { configureIconThemeColorPersistence } from "./shared/hooks/useIconThemeColors.ts";

configureIconThemeColorPersistence(iconThemeColorStore);

window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
