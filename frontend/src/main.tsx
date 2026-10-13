import ReactDOM from "react-dom/client";
import App from "./App";
import { loadConfig } from "./config";

// NOTE: React.StrictMode is intentionally NOT used here. In development it
// double-invokes effects and remounts components, which would open two
// WebSocket voice sessions (and thus play/echo the assistant audio twice).

// Load runtime /config.json (present on AWS deploy) before rendering so the
// app has the real WSS endpoint and Cognito settings.
loadConfig().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
});
