// Keyboard-accessible interaction helpers for non-<button> clickable elements.
//
// Spread onto a <div>/<span> that has an onClick so the same action also fires
// on keyboard (Enter / Space) and the element is reachable via Tab — WITHOUT
// changing any visual styling. Mouse behavior is identical to a bare onClick.
//
//   <div className="card" {...clickable(() => open(id))}>…</div>
//
// Pass a role when the element is not really a button (e.g. "tab", "option").
export function clickable(handler, { role = "button", tabIndex = 0 } = {}) {
  return {
    role,
    tabIndex,
    onClick: handler,
    onKeyDown: (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handler(e);
      }
    },
  };
}
