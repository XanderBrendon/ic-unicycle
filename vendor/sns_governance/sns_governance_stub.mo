// Local stub for an SNS governance canister (US22). Exists purely so the
// backend's hotkey proposal-submission path can be exercised against a fresh
// local replica; mainnet has a real governance canister per SNS, discovered via
// the SNS-Wasm registry, and the backend never loads this stub there.
//
// It models just enough of SNS governance to gate `manage_neuron`: a seedable
// neuronId → hotkey-principals set (the `SubmitProposal` permission), a
// `MakeProposal` command that succeeds iff the caller is hotkeyed on the target
// neuron and otherwise returns an `Error`, and a monotonic proposal counter so
// the returned `proposal_id` is observable. The real governance models far more
// (the full `Command`/`Action` surface, voting, maturity, …); the backend reads
// only the narrow shapes declared here, so Candid subtyping drops the rest.
//
// `addHotkey` / `registerNeuronWithBackend` are test-fixture seeds (mirroring
// the icpswap / sns_wasm stubs' bootstrap helpers). The real hotkey grant is
// `add_neuron_permissions` on the SNS, and the real neuron registration is the
// SNS submitting a proposal that calls the backend — neither of which the CLI
// can drive locally. `registerNeuronWithBackend` is the only way to call the
// root-keyed `snsSetProposalNeuron` twin with `caller = governance` locally.

import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Map "mo:core/Map";
import Set "mo:core/Set";
import Nat64 "mo:core/Nat64";
import Iter "mo:core/Iter";
import List "mo:core/List";

persistent actor class SnsGovernanceStub() = self {

  // Narrow structural shapes the backend sends/reads — identical to the ones
  // declared in `src/unicycle_backend/main.mo`.
  type SnsMotion = { motion_text : Text };
  // US23 adds the AddGenericNervousSystemFunction shapes (identical to the
  // backend's narrow types) so the stub can record what `snsSetup` registers.
  type SnsTopic = { #ApplicationBusinessLogic };
  type SnsGenericFunction = {
    target_canister_id : ?Principal;
    target_method_name : ?Text;
    validator_canister_id : ?Principal;
    validator_method_name : ?Text;
    topic : ?SnsTopic;
  };
  type SnsFunctionType = { #GenericNervousSystemFunction : SnsGenericFunction };
  type SnsNervousSystemFunction = {
    id : Nat64;
    name : Text;
    description : ?Text;
    function_type : ?SnsFunctionType;
  };
  // US24 adds the TransferSnsTreasuryFunds shapes (identical to the backend's
  // narrow types) so the stub can record what the automatic deposit top-up
  // submits, for verification.
  type SnsSubaccount = { subaccount : Blob };
  type SnsTransferTreasuryFunds = {
    from_treasury : Int32;
    to_principal : ?Principal;
    to_subaccount : ?SnsSubaccount;
    memo : ?Nat64;
    amount_e8s : Nat64;
  };
  type SnsAction = {
    #Motion : SnsMotion;
    #AddGenericNervousSystemFunction : SnsNervousSystemFunction;
    #TransferSnsTreasuryFunds : SnsTransferTreasuryFunds;
  };
  type SnsProposalArg = { title : Text; url : Text; summary : Text; action : ?SnsAction };
  // What a recorded treasury-transfer proposal looks like for verification.
  type SubmittedTransfer = { summary : Text; transfer : SnsTransferTreasuryFunds };
  // What a recorded Motion proposal looks like for verification (US25).
  type SubmittedMotion = { title : Text; summary : Text };
  type SnsManageNeuron = { subaccount : Blob; command : ?{ #MakeProposal : SnsProposalArg } };
  type SnsProposalId = { id : Nat64 };
  type SnsManageNeuronResponse = {
    command : ?{
      #MakeProposal : { proposal_id : ?SnsProposalId };
      #Error : { error_message : Text };
    };
  };

  // neuronId → principals holding `SubmitProposal`, seeded via addHotkey.
  let hotkeys : Map.Map<Blob, Set.Set<Principal>> = Map.empty();
  // Monotonic id source for submitted proposals.
  var proposalCounter : Nat = 0;
  // Functions registered via accepted AddGenericNervousSystemFunction proposals
  // (US23), keyed by function id — exposed via registeredFunctions() for tests.
  let registered : Map.Map<Nat64, SnsNervousSystemFunction> = Map.empty();
  // Treasury transfers submitted via accepted TransferSnsTreasuryFunds proposals
  // (US24), in submission order — exposed via submittedTreasuryTransfers().
  let submittedTransfers : List.List<SubmittedTransfer> = List.empty();
  // Motion proposals submitted via accepted Motion proposals (US25), in
  // submission order — exposed via submittedMotions() so the report body the
  // backend submits can be inspected.
  let motions : List.List<SubmittedMotion> = List.empty();

  // Authorize the caller against the target neuron's hotkey set: a `MakeProposal`
  // command from a hotkeyed caller mints a new proposal id; anyone else gets an
  // `Error` — the exact gate the backend's hotkey relies on. An accepted
  // AddGenericNervousSystemFunction proposal (US23) also records the function so
  // registeredFunctions() can confirm `snsSetup` registered it; an accepted
  // Motion proposal (US25) records its title/summary so submittedMotions() can
  // confirm the report body the backend submitted.
  public shared ({ caller }) func manage_neuron(arg : SnsManageNeuron) : async SnsManageNeuronResponse {
    switch (arg.command) {
      case (?#MakeProposal(proposal)) {
        let authorized = switch (hotkeys.get(arg.subaccount)) {
          case (?set) { set.contains(caller) };
          case null { false };
        };
        if (authorized) {
          switch (proposal.action) {
            case (?#AddGenericNervousSystemFunction(fn)) { registered.add(fn.id, fn) };
            case (?#TransferSnsTreasuryFunds(t)) { submittedTransfers.add({ summary = proposal.summary; transfer = t }) };
            case (?#Motion(_)) { motions.add({ title = proposal.title; summary = proposal.summary }) };
            case (_) {};
          };
          proposalCounter += 1;
          { command = ?#MakeProposal({ proposal_id = ?{ id = Nat64.fromNat(proposalCounter) } }) };
        } else {
          { command = ?#Error({ error_message = "caller not authorized to submit proposals for this neuron" }) };
        };
      };
      case (_) {
        { command = ?#Error({ error_message = "unsupported command" }) };
      };
    };
  };

  // Grant `principal` the `SubmitProposal` permission on `neuronId` (test seed;
  // the real grant is `add_neuron_permissions` on the SNS).
  public func addHotkey(neuronId : Blob, principal : Principal) : async () {
    let set = switch (hotkeys.get(neuronId)) {
      case (?s) s;
      case null {
        let fresh = Set.empty<Principal>();
        hotkeys.add(neuronId, fresh);
        fresh;
      };
    };
    set.add(principal);
  };

  // Record `neuronId` as this SNS's proposal neuron on the backend, calling the
  // root-keyed `snsSetProposalNeuron` twin with `caller = <this stub> =
  // governance` — the only way to drive that twin locally.
  public func registerNeuronWithBackend(backend : Principal, neuronId : Blob) : async () {
    let uni : actor {
      snsSetProposalNeuron : shared { neuronId : Blob } -> async ();
    } = actor (backend.toText());
    await uni.snsSetProposalNeuron({ neuronId });
  };

  // Drive the real `snsGrantAdmin` twin (US27) with `caller = <this stub> =
  // governance` — the only local way to designate an SNS admin (mirrors
  // `registerNeuronWithBackend`).
  public func grantAdminOnBackend(backend : Principal, admin : Principal) : async () {
    let uni : actor {
      snsGrantAdmin : shared { admin : Principal } -> async ();
    } = actor (backend.toText());
    await uni.snsGrantAdmin({ admin });
  };

  // Drive the real `snsRevokeAdmin` twin (US28) with `caller = <this stub> =
  // governance` — the only local way to revoke an SNS admin (mirrors
  // `grantAdminOnBackend`).
  public func revokeAdminOnBackend(backend : Principal, admin : Principal) : async () {
    let uni : actor {
      snsRevokeAdmin : shared { admin : Principal } -> async ();
    } = actor (backend.toText());
    await uni.snsRevokeAdmin({ admin });
  };

  // Drive the real `snsSetup` twin (US23) with `caller = <this stub> =
  // governance` — the only local way to exercise the production custom-function
  // path (governance caller → root resolution + submission through the neuron).
  public func invokeSnsSetup(backend : Principal, neuronId : Blob, baseFunctionId : Nat64) : async () {
    let uni : actor {
      snsSetup : shared { neuronId : Blob; baseFunctionId : Nat64 } -> async ();
    } = actor (backend.toText());
    await uni.snsSetup({ neuronId; baseFunctionId });
  };

  // Drive the real `snsSetDepositConfig` twin (US24) with `caller = <this stub> =
  // governance` — the only local way to set an SNS's deposit auto-top-up config
  // (mirrors `registerNeuronWithBackend`).
  public func setSnsDepositConfigOnBackend(backend : Principal, arg : { minBalanceE8s : Nat; depositAmountE8s : Nat; includeReport : Bool }) : async () {
    let uni : actor {
      snsSetDepositConfig : shared { minBalanceE8s : Nat; depositAmountE8s : Nat; includeReport : Bool } -> async ();
    } = actor (backend.toText());
    await uni.snsSetDepositConfig(arg);
  };

  // Drive the real `snsSetReportConfig` twin (US25) with `caller = <this stub> =
  // governance` — the only local way to set an SNS's recurring report cadence
  // (mirrors `setSnsDepositConfigOnBackend`).
  public func setSnsReportConfigOnBackend(backend : Principal, arg : { cadenceDays : Nat }) : async () {
    let uni : actor {
      snsSetReportConfig : shared { cadenceDays : Nat } -> async ();
    } = actor (backend.toText());
    await uni.snsSetReportConfig(arg);
  };

  // Drive the real `snsSetDrainAlertConfig` twin (US26) with `caller = <this stub> =
  // governance` — the only local way to set an SNS's cycle-drain alert thresholds
  // (mirrors `setSnsReportConfigOnBackend`).
  public func setSnsDrainAlertConfigOnBackend(backend : Principal, arg : { weeklyAvgFactorPct : Nat; monthlyAvgFactorPct : Nat; dayOverDayFactorPct : Nat; alertCooldownDays : Nat }) : async () {
    let uni : actor {
      snsSetDrainAlertConfig : shared { weeklyAvgFactorPct : Nat; monthlyAvgFactorPct : Nat; dayOverDayFactorPct : Nat; alertCooldownDays : Nat } -> async ();
    } = actor (backend.toText());
    await uni.snsSetDrainAlertConfig(arg);
  };

  // Verification convenience — how many proposals have been minted so far.
  public query func proposalCount() : async Nat { proposalCounter };

  // Verification convenience — the functions registered by accepted
  // AddGenericNervousSystemFunction proposals (US23).
  public query func registeredFunctions() : async [SnsNervousSystemFunction] {
    registered.values().toArray();
  };

  // Verification convenience — the treasury transfers submitted by accepted
  // TransferSnsTreasuryFunds proposals (US24), in submission order.
  public query func submittedTreasuryTransfers() : async [SubmittedTransfer] {
    submittedTransfers.toArray();
  };

  // Verification convenience — the Motion proposals submitted by accepted Motion
  // proposals (US25), in submission order.
  public query func submittedMotions() : async [SubmittedMotion] {
    motions.toArray();
  };
};
