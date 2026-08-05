import { test } "mo:test";
import Principal "mo:core/Principal";
import ReadRoute "../lib/ReadRoute";

let rootA = Principal.fromText("ibahq-taaaa-aaaaq-aadna-cai");

test("primaryFor: a remembered source wins over the structural rule", func() {
  assert ReadRoute.primaryFor(?#blackhole, ?rootA) == #blackhole;
  assert ReadRoute.primaryFor(?#snsRoot, null) == #snsRoot;
});

test("primaryFor: nothing remembered falls back to the candidate root", func() {
  assert ReadRoute.primaryFor(null, ?rootA) == #snsRoot;
  assert ReadRoute.primaryFor(null, null) == #blackhole;
});

// The four gate tests below cover all 12 reachable input combinations.
// (inSummary = true, blackholeOk = false) is unreachable: callers derive
// blackholeOk as "in the summary, or the probe answered".

test("gate: in the summary -> allow via snsRoot, whatever the origin", func() {
  assert ReadRoute.gate(#snsAdmin, false, true, true) == #allow(#snsRoot);
  assert ReadRoute.gate(#snsProposal, false, true, true) == #allow(#snsRoot);
  assert ReadRoute.gate(#snsAdmin, true, true, true) == #allow(#snsRoot);
  assert ReadRoute.gate(#snsProposal, true, true, true) == #allow(#snsRoot);
});

test("gate: neither source can read it -> unverifiable", func() {
  assert ReadRoute.gate(#snsAdmin, false, false, false) == #unverifiable;
  assert ReadRoute.gate(#snsProposal, false, false, false) == #unverifiable;
  assert ReadRoute.gate(#snsAdmin, true, false, false) == #unverifiable;
  assert ReadRoute.gate(#snsProposal, true, false, false) == #unverifiable;
});

test("gate: blackhole-only but already tracked -> allow, admins included", func() {
  assert ReadRoute.gate(#snsAdmin, true, false, true) == #allow(#blackhole);
  assert ReadRoute.gate(#snsProposal, true, false, true) == #allow(#blackhole);
});

test("gate: blackhole-only and untracked -> governance only", func() {
  assert ReadRoute.gate(#snsProposal, false, false, true) == #allow(#blackhole);
  assert ReadRoute.gate(#snsAdmin, false, false, true) == #requiresProposal;
});
