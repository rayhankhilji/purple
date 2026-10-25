// PURPLE concept lab - the model switcher's data and the Go live run body (pure; the browser page and node tests share it).
// The models come from concept/gp/entrants.json (the Model GP entrants); each one is a "car" with its own name (entrant.car, else this
// file's built-in car for that id, else entrant.name) and a label for the picker and the title (this file's label for that id, else
// the car and the entrant name, e.g. "ChatGPT (GPT-6 Luna)"). The default model (Claude Haiku 4.5, the frozen designer task) is the only one
// whose Go live keeps record_good: physics-approved ideas re-sent by the server as trained calls. Every other model is sent as
// { model: id, memory: true } with no record_good / trained fields: untrained, not recorded for training (the server refuses those
// fields for any other model). "no-ai" is the control: llm "live", but the server makes no model call (the engine's own direction).
(function (root) {
  const DEFAULT_ID = "haiku-4-5";
  const BUILTIN = [
    { id: "haiku-4-5", label: "Claude Haiku 4.5", car: "Claude Haiku", code: "HAIK", color: "#3987e5", provider: "anthropic", model: "claude-haiku-4-5" },
    { id: "sonnet-5-5", label: "Claude Sonnet 5.5", car: "Claude Sonnet", code: "SONN", color: "#d95926", provider: "anthropic", model: "claude-sonnet-5-5" },
    { id: "opus-5-5", label: "Claude Opus 5.5", car: "Claude Opus", code: "OPUS", color: "#9085e9", provider: "anthropic", model: "claude-opus-5-5" },
    { id: "gpt-6-luna", label: "ChatGPT (GPT-6 Luna)", car: "ChatGPT", code: "GPT", color: "#d55181", provider: "openai", model: "gpt-6-luna" },
    { id: "no-ai", label: "No AI (control)", car: "No AI", code: "NOAI", color: "#8a8a94", provider: "none", model: null, control: true },
  ];
  const ID_RE = /^[a-z0-9][a-z0-9.-]{0,40}$/;
  const isDefault = id => !id || id === DEFAULT_ID;
  const isNoAi = m => !!m && (m.control === true || m.provider === "none" || m.id === "no-ai");
  // entrants.json -> the switcher's list (the default first); a missing or broken file -> the built-in list
  function fromEntrants(j) {
    const list = j && Array.isArray(j.entrants) ? j.entrants : null;
    if (!list || !list.length) return BUILTIN.slice();
    const out = [];
    for (const e of list) {
      if (!e || typeof e.id !== "string" || !ID_RE.test(e.id) || out.some(x => x.id === e.id)) continue;
      const b = BUILTIN.find(x => x.id === e.id) || {};
      const car = String((typeof e.car === "string" && e.car.trim()) || b.car || e.name || e.id).slice(0, 40);
      const name = String(e.name || car);
      out.push({ id: e.id, car, name, label: b.label || (name !== car ? car + " (" + name + ")" : car), code: String(e.code || b.code || e.id.slice(0, 4)).toUpperCase().slice(0, 4), color: /^#[0-9a-fA-F]{6}$/.test(e.color || "") ? e.color : b.color || "#8a8a94",
        provider: e.provider || b.provider || null, model: e.model === undefined ? b.model || null : e.model, control: !!(e.control || b.control) });
    }
    if (!out.length) return BUILTIN.slice();
    if (!out.some(x => x.id === DEFAULT_ID)) out.unshift(BUILTIN[0]);
    out.sort((a, b) => (a.id === DEFAULT_ID ? -1 : b.id === DEFAULT_ID ? 1 : 0));
    return out;
  }
  const find = (list, id) => (list || BUILTIN).find(x => x.id === id) || null;
  // the POST /api/concept/engine/run body of Go live (llm "live") or the offline demo (llm "mock")
  //   o: { llm, model (entrant id; omitted / the default = Haiku), rounds, ideas, screen: { variants, confirm_k, explore }, seed }
  function runBody(o) {
    const rounds = o.rounds, n = rounds * o.ideas, sc = o.screen || {};
    const common = { mode: "engineer", team: "redbull", ideas: o.ideas, rounds, max_calls: n, variants: sc.variants, confirm_k: sc.confirm_k, explore: sc.explore };
    const live = o.llm === "live", dflt = isDefault(o.model);
    const head = live
      ? (dflt ? { llm: "live", record_good: "kept", confirm: "trained", confirm_text: "TRAIN " + n, seed: o.seed } : { llm: "live", seed: o.seed })
      : { llm: "mock", seed: o.seed };
    const body = Object.assign(head, common);
    if (!dflt) Object.assign(body, { model: o.model, memory: true });
    return body;
  }
  // does this run send physics-approved ideas to Mubit as training examples?
  const trains = body => !!(body && body.llm === "live" && (body.record_good || body.trained));
  const api = { DEFAULT_ID, BUILTIN, isDefault, isNoAi, fromEntrants, find, runBody, trains };
  if (root) { const EI = (root.EI = root.EI || {}); EI.modelSwitch = api; }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
