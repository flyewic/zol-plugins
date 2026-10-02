// ai-fake: a suggestion provider that always returns the same text. No model,
// no subprocess, no network — the fastest way to see ghost text and to test the
// editor's suggestion seam.

let timer = 0;
let change_count = 0;
let debounce_count = 0;
let suggest_count = 0;

zol.registerSuggestProvider("ai-fake", {
  suggest(_ctx) {
    suggest_count += 1;
    return Promise.resolve({ text: zol.setting("text") || "test test" });
  },
});

zol.onChange(function () {
  change_count += 1;
  const ms = zol.setting("debounce_ms") || 200;
  // `debounce_ms 0` triggers immediately (no timer).
  if (ms <= 0) {
    zol.requestSuggestion();
    return;
  }
  if (timer) zol.clearTimeout(timer);
  timer = zol.setTimeout(function () {
    debounce_count += 1;
    zol.requestSuggestion();
  }, ms);
});

// Trigger on demand (also useful when auto-trigger is disabled).
zol.registerCommand("ai-fake.suggest", "Fake: suggest at caret", function () {
  zol.requestSuggestion();
});

// Test aid: after typing, run this to see how far the auto path got.
zol.registerCommand("ai-fake.status", "Fake: status", function () {
  zol.notify(
    "onChange=" + change_count + " debounce=" + debounce_count + " suggest=" + suggest_count,
    "info",
    "",
  );
});
