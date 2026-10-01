import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import App from "./App";
import "@fontsource-variable/geist";
import "./index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
		<Analytics />
	</StrictMode>,
);
