import React from "react";
import { createRoot } from "react-dom/client";

/* Design system + screen styles. Order matters — later sheets override earlier
   ones, matching the original prototype's <link> order exactly. */
import "./styles/liber.css";
import "./styles/product.css";
import "./styles/product2.css";
import "./styles/product3.css";
import "./styles/product-onboarding.css";
import "./styles/product-mobile.css";
import "./styles/convo-forms.css";
import "./styles/product-agent.css";
import "./styles/product-charts.css";
import "./styles/product-booklist.css";
import "./styles/product-reader-empty.css";
import "./styles/product-news.css";
import "./styles/product-messaging.css";
import "./styles/wallet.css";
import "./styles/wallet-profile.css";

/* Data is a bootstrapped singleton: importing it populates window.* (BOOKS,
   CHAPTERS, …) which the screen components read. Must run before App renders. */
import "./data/product-data.js";

/* API client. Exposed as window.liberApi; screens call it with graceful
   fallback to seed/localStorage when the backend isn't reachable. */
import api from "./lib/api.js";
if (typeof window !== "undefined") {
  window.liberApi = api;
}

import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query.js";
import { App } from "./components/product-app.jsx";
import { LiberTweaks } from "./components/product-tweaks.jsx";

createRoot(document.getElementById("app")).render(
  <QueryClientProvider client={queryClient}><App /></QueryClientProvider>,
);

/* The Tweaks island doesn't mount inside the phone-preview iframe (?vp=phone),
   mirroring the original guard. */
if (!new URLSearchParams(location.search).get("vp")) {
  createRoot(document.getElementById("tweaks")).render(<LiberTweaks />);
}
