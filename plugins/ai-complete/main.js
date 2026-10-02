// ai-complete: single-line ghost text. The plugin owns the trigger (a debounced
// onChange), the prompt, and the provider call; the editor owns display and
// accept keys (Tab / Escape).

import { complete } from "ai-kit";

let timer = 0;

function settings() {
  return {
    provider: zol.setting("provider"),
    model: zol.setting("model"),
    endpoint: zol.setting("endpoint"),
    api_key_env: zol.setting("api_key_env"),
    api_key: zol.secret("api_key") || "",
  };
}

zol.registerSuggestProvider("ai-complete", {
  suggest(ctx) {
    const lines = zol.setting("context_lines") || 40;
    const before = ctx.text.slice(0, ctx.offset);
    const tail = before.split("\n").slice(-lines).join("\n");
    const prompt =
      "Complete the next line of the following code. " +
      "Reply with only the continuation, no explanation, no code fences.\n\n" +
      tail;
    return complete(settings(), prompt).then(function (r) {
      const line = (r.text || "").split("\n")[0];
      return line.trim() === "" ? null : { text: line };
    });
  },
});

zol.onChange(function () {
  if (timer) zol.clearTimeout(timer);
  timer = zol.setTimeout(function () {
    zol.requestSuggestion();
  }, zol.setting("debounce_ms") || 300);
});
