// PURPLE ENGINE v2 - the DESIGN TREE (docs/concept/ENGINE_V2.md §2). Every car the physics sim measured is a node: { id, parent,
// decision, branch, kind, lap_s, sectors_s, legal, articles, by, changes (vs parent), params (decision results and the root only) }.
// The engine keeps two pointers: the PEAK (the fastest legal car of the run) and the HEAD (the car the next decision starts from).
// A decision's result node is kept when it is legal and faster than the head: the head moves to it (and the peak, if it is also the
// fastest so far). A branch is the chain of decisions since the last revert or fork. After `patience` decisions in a row on a
// branch without a kept result the engine abandons the branch automatically:
//   - head ≠ peak: REVERT to the peak;
//   - head = peak: FORK from the best other result node that is not the peak or one of its ancestors and was not a fork root yet
//     (if none exists, a new branch restarts from the peak).
// The abandoned branch is summarised (root, parts tried, decisions, best delta vs its head) for the next scenario. Pure and
// deterministic; toJSON() / fromJSON() make a run resumable.
"use strict";

const r3 = v => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const EPS = 1e-4;   // s: a result must beat the head by more than this to be kept (the physics sim is deterministic; this only stops churn)

class Tree {
  constructor(o) {
    o = o || {};
    this.patience = o.patience == null ? 3 : o.patience;
    this.nodes = []; this.byId = new Map(); this.peak = null; this.head = null;
    this.branches = []; this.branch = null; this.events = []; this.forkRoots = new Set();
  }
  get(id) { return this.byId.get(id) || null; }
  add(n) {
    const node = Object.assign({ id: "n" + this.nodes.length, parent: null, decision: null, branch: this.branch ? this.branch.id : 0, kind: "result", legal: false, lap_s: null }, n);
    this.nodes.push(node); this.byId.set(node.id, node);
    return node;
  }
  // the baseline car: root of the tree, first head, first peak, branch 1
  root(n) {
    const node = this.add(Object.assign({ kind: "root", by: "baseline" }, n));
    this.peak = node.id; this.head = node.id;
    this.newBranch(node.id, "start");
    return node;
  }
  newBranch(from, why) {
    const b = { id: this.branches.length + 1, root: from, from_peak: from === this.peak, why, decisions: [], fails: 0, kept: 0, parts: [], best_d_s: null, status: "open" };
    this.branches.push(b); this.branch = b;
    return b;
  }
  ancestors(id) { const out = new Set(); let n = this.get(id); while (n) { out.add(n.id); n = n.parent ? this.get(n.parent) : null; } return out; }
  // record a decision's result (the fastest car its subspace produced). parts = the parts the decision touched (for the branch
  // summary). -> { kept, new_peak, d_head_s, reverted?: { kind, from, to, abandoned } }
  decide(result, info) {
    info = info || {};
    const b = this.branch, head = this.get(this.head), peak = this.get(this.peak);
    const legal = !!(result && result.legal && typeof result.lap_s === "number");
    const d = legal ? result.lap_s - head.lap_s : null;
    const kept = legal && d < -EPS;
    b.decisions.push(info.decision == null ? null : info.decision);
    for (const p of info.parts || []) if (!b.parts.includes(p)) b.parts.push(p);
    if (d != null && (b.best_d_s == null || d < b.best_d_s)) b.best_d_s = r3(d);
    const out = { kept, new_peak: false, d_head_s: r3(d), head_before: head.id, peak_before: peak.id };
    if (kept) {
      this.head = result.id; b.kept++; b.fails = 0;
      if (result.lap_s < peak.lap_s - EPS) { this.peak = result.id; out.new_peak = true; }
    } else {
      b.fails++;
      if (b.fails >= this.patience) out.reverted = this.abandon();
    }
    out.head = this.head; out.peak = this.peak;
    return out;
  }
  // abandon the current branch: revert to the peak or fork from the best other node
  abandon() {
    const b = this.branch; b.status = "abandoned";
    const summary = { branch: b.id, root: b.root, from_peak: b.from_peak, parts: b.parts.slice(), decisions: b.decisions.length, kept: b.kept, best_d_s: b.best_d_s };
    let kind, to;
    if (this.head !== this.peak) { kind = "revert"; to = this.peak; }
    else {
      const anc = this.ancestors(this.peak);
      const cand = this.nodes.filter(n => n.kind === "result" && n.legal && !anc.has(n.id) && !this.forkRoots.has(n.id)).sort((x, y) => x.lap_s - y.lap_s || (x.id < y.id ? -1 : 1));
      if (cand.length) { kind = "fork"; to = cand[0].id; this.forkRoots.add(to); }
      else { kind = "restart"; to = this.peak; }
    }
    this.head = to;
    const nb = this.newBranch(to, kind);
    const ev = { kind, from: summary.root, to, abandoned: summary, new_branch: nb.id };
    this.events.push(ev);
    return ev;
  }
  // the branch state as the scenario reports it (compact; numbers only)
  state() {
    const head = this.get(this.head), peak = this.get(this.peak);
    const abandoned = this.branches.filter(b => b.status === "abandoned").slice(-2).map(b => ({ b: b.id, from: b.root === this.peak || b.from_peak ? "peak" : b.root, parts: b.parts.slice(0, 4).join("+"), tries: b.decisions.length, best_d_s: b.best_d_s }));
    const last = this.events.length ? this.events[this.events.length - 1] : null;
    return {
      cars: this.nodes.filter(n => n.kind !== "root").length,
      peak: { node: peak.id, lap_s: r3(peak.lap_s) },
      head: { node: head.id, d_peak_s: r3(head.lap_s - peak.lap_s), branch: this.branch.id, fails: this.branch.fails, of: this.patience },
      abandoned, last_move: last && last.new_branch === this.branch.id ? last.kind + " to " + (last.to === this.peak ? "peak " + last.to : last.to) : null,
    };
  }
  // all result nodes, compact (for the UI's tree view): id, parent, decision, branch, lap, legal, kind, by
  compact(kinds) {
    const k = kinds || ["root", "result"];
    return this.nodes.filter(n => k.includes(n.kind)).map(n => ({ id: n.id, parent: n.parent, decision: n.decision, branch: n.branch, kind: n.kind, lap_s: r3(n.lap_s), legal: n.legal, by: n.by || null }));
  }
  toJSON() { return { v: 1, patience: this.patience, nodes: this.nodes, peak: this.peak, head: this.head, branches: this.branches, branch: this.branch ? this.branch.id : null, events: this.events, forkRoots: Array.from(this.forkRoots) }; }
  static fromJSON(j) {
    if (!j || j.v !== 1 || !Array.isArray(j.nodes)) throw new Error("tree: not a v1 tree state");
    const t = new Tree({ patience: j.patience });
    for (const n of j.nodes) { t.nodes.push(n); t.byId.set(n.id, n); }
    t.peak = j.peak; t.head = j.head; t.branches = j.branches; t.branch = t.branches.find(b => b.id === j.branch) || t.branches[t.branches.length - 1];
    t.events = j.events || []; t.forkRoots = new Set(j.forkRoots || []);
    if (!t.get(t.peak) || !t.get(t.head)) throw new Error("tree: peak / head not in the nodes");
    return t;
  }
}

module.exports = { Tree, EPS };
