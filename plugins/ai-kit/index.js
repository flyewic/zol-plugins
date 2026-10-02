// ai-kit: shared provider adapters + streaming helpers for AI plugins.
//
// `kind "library"` (see plugin.kdl): this file is never auto-activated; a
// dependent imports it, and the imported code runs under the *importer's*
// permissions and zol.* surface.

import { makeAdapter } from "./providers.js";
import { makeLineParser, makeSseParser, makeNdjsonParser } from "./sse.js";

export { makeLineParser, makeSseParser, makeNdjsonParser };
export { makeAdapter };

// Run a one-shot completion. `onDelta(text)` receives streamed chunks; the
// promise resolves with { code, stdout, stderr }. The caller passes its own
// settings object (provider/model/endpoint/temperature/api_key_env).
export function run(settings, prompt, onDelta) {
  const adapter = makeAdapter(settings);
  const spec = adapter.build(prompt);
  const parser = adapter.makeParser(function (delta) {
    if (onDelta) onDelta(delta);
  });
  return zol.exec(spec.argv, {
    stdin: spec.stdin,
    cwd: spec.cwd,
    onStdout: parser,
  });
}

// Collect a full completion (no streaming callback).
export function complete(settings, prompt) {
  let acc = "";
  return run(settings, prompt, function (delta) {
    acc += delta;
  }).then(function (res) {
    return { text: acc, code: res.code, stderr: res.stderr };
  });
}
