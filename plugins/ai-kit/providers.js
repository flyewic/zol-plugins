// Provider adapters. Each `build(prompt, settings)` returns an argv/stdio
// command for `zol.exec`, a `makeParser(onDelta)` for its stream, and the body
// it expects. All provider-specific knowledge lives here, never in the editor.

import { makeSseParser, makeNdjsonParser, makeRawParser } from "./sse.js";

function messages(prompt, settings) {
  const sys = settings.system || "You are a concise coding assistant.";
  return [
    { role: "system", content: sys },
    { role: "user", content: prompt },
  ];
}

function ollama(settings) {
  const model = settings.model || "llama3.2";
  return {
    name: "ollama",
    build(prompt) {
      return { argv: ["ollama", "run", model, prompt] };
    },
    makeParser: makeNdjsonParser,
  };
}

// OpenAI-compatible HTTP endpoints (OpenAI, llama.cpp server, vLLM, …) via
// curl, so no HTTP/TLS client is needed in the editor. The key comes from an
// environment variable named by the plugin settings.
function openai(settings) {
  const endpoint = settings.endpoint || "https://api.openai.com/v1/chat/completions";
  const model = settings.model || "gpt-4o-mini";
  const keyEnv = settings.api_key_env || "OPENAI_API_KEY";
  return {
    name: "openai",
    build(prompt) {
      const key = settings.api_key || zol.env(keyEnv) || "";
      const body = JSON.stringify({
        model: model,
        stream: true,
        temperature: settings.temperature ?? 0.2,
        messages: messages(prompt, settings),
      });
      return {
        argv: [
          "curl", "-s", "-N", "-X", "POST", endpoint,
          "-H", "Content-Type: application/json",
          "-H", "Authorization: Bearer " + key,
          "-d", body,
        ],
      };
    },
    makeParser: makeSseParser,
  };
}

function anthropic(settings) {
  const endpoint = settings.endpoint || "https://api.anthropic.com/v1/messages";
  const model = settings.model || "claude-sonnet-4-5";
  const keyEnv = settings.api_key_env || "ANTHROPIC_API_KEY";
  return {
    name: "anthropic",
    build(prompt) {
      const key = settings.api_key || zol.env(keyEnv) || "";
      const body = JSON.stringify({
        model: model,
        stream: true,
        max_tokens: settings.max_tokens ?? 1024,
        messages: [{ role: "user", content: prompt }],
      });
      return {
        argv: [
          "curl", "-s", "-N", "-X", "POST", endpoint,
          "-H", "Content-Type: application/json",
          "-H", "x-api-key: " + key,
          "-H", "anthropic-version: 2023-06-01",
          "-d", body,
        ],
      };
    },
    makeParser: makeSseParser,
  };
}

export function makeAdapter(settings) {
  const provider = (settings.provider || "ollama").toLowerCase();
  if (provider === "fake") return fake(settings);
  if (provider === "openai" || provider === "openai-compatible") return openai(settings);
  if (provider === "anthropic") return anthropic(settings);
  return ollama(settings);
}

// A fake model for tests/demos: runs a command with the prompt on stdin and
// treats raw stdout as the completion. Defaults to a self-contained shell
// one-liner that always answers "test test"; `fake_command` overrides it
// (e.g. examples/plugins/fake-provider.sh, or any prompt-on-stdin CLI).
function fake(settings) {
  const cmd = settings.fake_command || "";
  return {
    name: "fake",
    build(prompt) {
      const argv = cmd !== ""
        ? [cmd]
        : ["sh", "-c", "cat >/dev/null; printf 'test test\\n'"];
      return { argv: argv, stdin: prompt };
    },
    makeParser: makeRawParser,
  };
}
