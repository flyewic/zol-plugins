// Streaming parsers for the two text protocols providers use.
//
// Calls arrive in arbitrary chunks, so each parser keeps the trailing partial
// line and returns it with the parsed values; feed the remainder back next call.

export function makeLineParser(onLine) {
  let rest = "";
  return function (chunk) {
    rest += chunk;
    const lines = rest.split("\n");
    rest = lines.pop();
    for (const line of lines) onLine(line.replace(/\r$/, ""));
  };
}

// Server-sent events: `data: <json>` lines, with `[DONE]` marking the end.
export function makeSseParser(onDelta) {
  return makeLineParser(function (line) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (data === "" || data === "[DONE]") return;
    try {
      const obj = JSON.parse(data);
      const choice = obj.choices && obj.choices[0];
      const delta = choice && (choice.delta || choice.message);
      if (delta && delta.content) onDelta(delta.content);
    } catch (_) {
      // Ignore malformed keep-alive lines.
    }
  });
}

// NDJSON (Ollama): `{ "response": "…", "done": false }` per line.
export function makeNdjsonParser(onDelta) {
  return makeLineParser(function (line) {
    if (line === "") return;
    try {
      const obj = JSON.parse(line);
      if (obj.response) onDelta(obj.response);
    } catch (_) {}
  });
}

// Raw text (the fake provider): every chunk is a completion delta.
export function makeRawParser(onDelta) {
  return function (chunk) {
    if (chunk) onDelta(chunk);
  };
}
