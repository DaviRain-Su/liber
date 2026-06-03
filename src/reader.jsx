import React from "react";
import { createRoot } from "react-dom/client";

/* Liber Reader — focused entry.

   The design handoff's primary file, `Liber Reader.html`, is a reader-first
   surface: it boots straight into the full-screen reading experience instead of
   the library/landing chrome. The full product lives at index.html → main.jsx;
   this entry reproduces that dedicated-reader file as a standalone page that
   opens directly on a single book.

   Design system + screen styles are imported in the same cascade order as the
   main entry so the reader renders with the identical 古籍 × 朱砂 × 档案 language. */
import "./styles/liber.css";
import "./styles/product.css";
import "./styles/product2.css";
import "./styles/product3.css";
import "./styles/product-onboarding.css";
import "./styles/product-mobile.css";
import "./styles/convo-forms.css";
import "./styles/product-agent.css";
import "./styles/product-charts.css";
import "./styles/product-reader-empty.css";
import "./styles/product-news.css";

/* Seed data is a bootstrapped singleton: importing it populates window.* (BOOKS,
   CHAPTERS, TOC, …) that the Reader reads. Must run before <ReaderApp> renders. */
import "./data/product-data.js";

/* API client. Exposed as window.liberApi; the Reader uses it for live book
   content and AI, falling back to the seed catalogue/localStorage when offline. */
import api from "./lib/api.js";
if (typeof window !== "undefined") {
  window.liberApi = api;
}

/* product-reader pulls in product-shared, which installs window.openProfile /
   window.canOpenProfile, so avatar interactions resolve even standalone. */
import { Reader } from "./components/product-reader.jsx";
import { LiberTweaks } from "./components/product-tweaks.jsx";
import { getCatalogBooks, loadCatalogBooks } from "./lib/catalog.js";

const { useState: useSt, useEffect: useEf } = React;

/* Which book to open: ?book=<id> wins, otherwise the first catalogue title. */
function initialBookId() {
  const wanted = new URLSearchParams(location.search).get("book");
  if (wanted) return wanted;
  const first = getCatalogBooks()[0];
  return first ? first.id : "daodejing";
}

function ReaderApp() {
  const [bookId, setBookId] = useSt(initialBookId);

  /* Hydrate the live catalogue (/api/books first, seed fallback). When the
     caller didn't name a book, settle on the first live title once it loads —
     mirroring the full app's catalogue-first behaviour. */
  useEf(() => {
    if (new URLSearchParams(location.search).get("book")) return;
    let live = true;
    loadCatalogBooks()
      .then((books) => {
        if (live && books && books[0]) setBookId(books[0].id);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <Reader
      key={bookId}
      bookId={bookId}
      /* The focused reader has no library behind it — "close" returns to the
         full app; opening another book swaps the reader to that title in place. */
      onClose={() => {
        location.href = "/";
      }}
      onOpenBook={(bid) => {
        if (bid) setBookId(bid);
      }}
    />
  );
}

createRoot(document.getElementById("reader-root")).render(<ReaderApp />);

const tweaksRoot = document.getElementById("tweaks");
if (tweaksRoot) createRoot(tweaksRoot).render(<LiberTweaks />);
