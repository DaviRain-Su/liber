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

/* Data is a bootstrapped singleton: importing it populates window.* (BOOKS,
   CHAPTERS, …) which the screen components read. Must run before App renders. */
import "./data/product-data.js";

import { App } from "./components/product-app.jsx";
import { LiberTweaks } from "./components/product-tweaks.jsx";

createRoot(document.getElementById("app")).render(<App />);

/* The Tweaks island doesn't mount inside the phone-preview iframe (?vp=phone),
   mirroring the original guard. */
if (!new URLSearchParams(location.search).get("vp")) {
  createRoot(document.getElementById("tweaks")).render(<LiberTweaks />);
}
