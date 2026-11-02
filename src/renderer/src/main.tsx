import "./assets/main.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./components/I18nProvider";
import { initAnalytics } from "./utils/analytics";
import { applyStoredFontScale } from "./components/settings/fontSize";

const appName = import.meta.env.VITE_HERMES_DESKTOP_APP_NAME?.trim();
document.title = appName || "Hermes One";

// Text-size preference applies before the first paint (no flash of default text).
applyStoredFontScale();

// Initialize analytics (privacy-first, only if user consented and key is configured)
initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
