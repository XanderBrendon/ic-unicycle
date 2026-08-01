  // ===========================================================================
  // LOCAL SEED FIXTURES — NOT PART OF THE PRODUCTION SOURCE
  //
  // devscripts/seed-local.sh appends this block to a throwaway copy of the actor
  // body (src/unicycle_backend/main.seed.mo), builds it, and installs it onto
  // the LOCAL unicycle_backend as an upgrade. `seedLocalFixtures()` at the very
  // bottom runs during that upgrade — statements in a persistent actor's body
  // re-run on every install/upgrade (only stable *initializers* are skipped),
  // which is the same mechanism the `refreshSnsRegistry` timer above relies on.
  // The script then restores the production wasm; the seeded state survives via
  // enhanced orthogonal persistence.
  //
  // Nothing here is a public method, so the `inspect` variant needs no entry and
  // the candid surface stays identical to production's.
  //
  // The __PLACEHOLDER__ tokens are substituted by the script.
  // ===========================================================================

  func seedLocalFixtures() {
    let ownerA = Principal.fromText("__OWNER_A__");
    let ownerB = Principal.fromText("__OWNER_B__");
    let snsEnabled : Bool = __SNS_ENABLED__;
    let snsGovernance = Principal.fromText("__SNS_GOV__");
    let snsRootId = Principal.fromText("__SNS_ROOT__");

    let now = Int.abs(Time.now());
    let TC : Nat = 1_000_000_000_000; // 1 T cycles == 1 TCYCLES (12 decimals)
    let E8S : Nat = 100_000_000; // 1 ICP

    // A timestamp d days before now, floored at 0 on a replica whose clock is
    // younger than the span being backdated over.
    func daysBack(d : Nat) : Nat {
      if (now > d * Durations.DAY_NS) { now - d * Durations.DAY_NS } else { 0 };
    };

    // Deterministic, obviously-synthetic canister ids. A canister principal is
    // 8 id bytes followed by 0x01 0x01; building them from bytes avoids
    // hand-typing (and mistyping) base32 text.
    func fakeCanister(n : Nat8) : Principal {
      Principal.fromBlob(Blob.fromArray([0, 0, 0, 0, 0, 0xf0, 0, n, 0x01, 0x01]));
    };

    // -------------------------------------------------------------------------
    // Reading series
    // -------------------------------------------------------------------------

    // Forward-simulate a daily balance series, then flip it: `cycleHistory` is
    // stored newest-first (History.prependCapped's invariant), so the fixtures
    // are written in that order rather than sorted after the fact.
    //   burnFor : daysAgo -> cycles burned that day
    //   ups     : (daysAgo, cycles delivered) applied after that day's burn
    func simulate(
      spanDays : Nat,
      startBalance : Nat,
      burnFor : Nat -> Nat,
      ups : [(Nat, Nat)],
    ) : [Types.CycleReading] {
      var balance = startBalance;
      let out = List.empty<Types.CycleReading>();
      var remaining = spanDays;
      while (remaining > 0) {
        let day : Nat = remaining - 1; // oldest (spanDays-1) → newest (0)
        let burn = burnFor(day);
        balance := if (balance > burn) { balance - burn } else { 0 };
        for ((upDay, amount) in ups.vals()) {
          if (upDay == day) { balance += amount };
        };
        out.add({ recordedAt = daysBack(day); result = #ok(balance) });
        remaining -= 1;
      };
      Array.reverse(out.toArray());
    };

    func flatBurn(perDay : Nat) : Nat -> Nat {
      func(_day : Nat) : Nat { perDay };
    };

    // -------------------------------------------------------------------------
    // Curated scenarios
    // -------------------------------------------------------------------------

    let cApi = fakeCanister(1); // healthy baseline
    let cIndexer = fakeCanister(2); // draining hard over the last 5 days
    let cArchive = fakeCanister(3); // suspended; readings stop 3 days ago
    let cDead = fakeCanister(4); // unreachable; #err readings and #err top-ups
    let cWorker = fakeCanister(5); // swap-funded, incl. #deferred and #stuckInPool
    let cFresh = fakeCanister(6); // registered 2 days ago, no top-ups
    let cbFront = fakeCanister(7); // owner B, healthy
    let cbBack = fakeCanister(8); // owner B, direct-mint funded

    // 1. healthy — 12 T start, 0.25 T/day, +5 T at days 60/35/10, landing at
    //    4.5 T against a 3 T floor.
    let apiReadings = simulate(90, 12 * TC, flatBurn(TC / 4), [(60, 5 * TC), (35, 5 * TC), (10, 5 * TC)]);

    // 2. draining — 0.1 T/day for 85 days, then 1.8 T/day for the last 5. Ends
    //    just above its 2 T floor, so the next-top-up projection is hours out.
    let indexerReadings = simulate(
      90,
      20 * TC,
      func(day : Nat) : Nat { if (day < 5) { (18 * TC) / 10 } else { TC / 10 } },
      [],
    );

    // 3. suspended — the newest 3 days dropped, so the last reading predates
    //    the suspension.
    let archiveAll = simulate(90, 8 * TC, flatBurn(TC / 20), []);
    let archiveReadings = archiveAll.sliceToArray(3, archiveAll.size());

    // 4. unreachable — the newest 4 readings failed; older ones are real.
    let deadOk = simulate(90, 6 * TC, flatBurn(TC / 10), []);
    let deadErrs = List.empty<Types.CycleReading>();
    var errDay = 4;
    while (errDay > 0) {
      deadErrs.add({
        recordedAt = daysBack(errDay - 1);
        result = #err("canister_status failed: canister not found");
      });
      errDay -= 1;
    };
    let deadReadings = Array.reverse(deadErrs.toArray()).concat(deadOk.sliceToArray(4, deadOk.size()));

    // 5. swap-funded worker pool.
    let workerReadings = simulate(90, 9 * TC, flatBurn(TC / 5), [(40, 4 * TC), (18, 4 * TC), (5, 4 * TC)]);

    // 6. fresh — registered two days ago, a single reading.
    let freshReadings : [Types.CycleReading] = [{ recordedAt = daysBack(0); result = #ok(7 * TC) }];

    let bFrontReadings = simulate(45, 10 * TC, flatBurn(TC / 8), [(30, 3 * TC), (8, 3 * TC)]);
    let bBackReadings = simulate(45, 6 * TC, flatBurn(TC / 10), [(12, 4 * TC)]);

    // -------------------------------------------------------------------------
    // Top-ups
    // -------------------------------------------------------------------------

    // The service fee is baseServiceFeeBps of the topped-up amount — what the
    // live fee path would have charged for these amounts.
    func fee(amount : Nat) : Nat { (amount * settings.baseServiceFeeBps) / 10_000 };

    func okTopUp(day : Nat, amount : Nat, block : Nat, rebate : Nat) : Types.TopUp {
      {
        attemptedAt = daysBack(day);
        amount;
        result = #ok(block);
        swap = null;
        serviceFee = fee(amount) - rebate;
        feeError = null;
        rebateApplied = rebate;
      };
    };

    func failedTopUp(day : Nat, amount : Nat, message : Text) : Types.TopUp {
      {
        attemptedAt = daysBack(day);
        amount;
        result = #err(message);
        swap = null;
        serviceFee = 0;
        feeError = null;
        rebateApplied = 0;
      };
    };

    func swapTopUp(
      day : Nat,
      amount : Nat,
      result : { #ok : Nat; #err : Text; #deferred : Text },
      outcome : { #ok; #err : Text; #stuckInPool : { token : Text; amount : Nat } },
    ) : Types.TopUp {
      {
        attemptedAt = daysBack(day);
        amount;
        result;
        swap = ?{
          source = #swap;
          amountIn = (amount / TC) * (E8S / 2); // ~0.5 ICP per T at the local peg
          amountOut = amount;
          outcome;
        };
        serviceFee = switch (result) { case (#ok _) { fee(amount) }; case (_) { 0 } };
        feeError = null;
        rebateApplied = 0;
      };
    };

    let apiTopUps : [Types.TopUp] = [
      okTopUp(10, 5 * TC, 4_812, TC / 50),
      okTopUp(35, 5 * TC, 3_140, 0),
      okTopUp(60, 5 * TC, 1_907, 0),
    ];

    let deadTopUps : [Types.TopUp] = [
      failedTopUp(2, 3 * TC, "cycles ledger transfer failed: canister not found"),
      failedTopUp(20, 3 * TC, "cycles ledger transfer failed: canister not found"),
    ];

    // The three-way `result` split plus a stuck-in-pool swap outcome — the
    // branch the top-up detail view is hardest to get right on.
    let workerTopUps : [Types.TopUp] = [
      swapTopUp(5, 4 * TC, #ok(5_233), #ok),
      swapTopUp(18, 4 * TC, #deferred("bought TCYCLES had not settled before the retry window closed"), #ok),
      swapTopUp(
        40,
        4 * TC,
        #err("withdrawToSubaccount failed after the swap succeeded"),
        #stuckInPool({ token = "TCYCLES"; amount = 4 * TC }),
      ),
    ];

    let bFrontTopUps : [Types.TopUp] = [
      okTopUp(8, 3 * TC, 5_401, 0),
      okTopUp(30, 3 * TC, 2_755, 0),
    ];

    let bBackTopUps : [Types.TopUp] = [{
      attemptedAt = daysBack(12);
      amount = 4 * TC;
      result = #ok(4_990);
      swap = ?{ source = #mint; amountIn = 2 * E8S; amountOut = 4 * TC; outcome = #ok };
      serviceFee = fee(4 * TC);
      feeError = null;
      rebateApplied = 0;
    }];

    let snsTopUps1 : [Types.TopUp] = if (snsEnabled) { [okTopUp(20, 10 * TC, 3_880, 0)] } else { [] };
    let snsTopUps2 : [Types.TopUp] = if (snsEnabled) { [okTopUp(25, 10 * TC, 3_402, 0)] } else { [] };

    // -------------------------------------------------------------------------
    // Write the fleets
    // -------------------------------------------------------------------------

    func config(min : Nat, amount : Nat, nickname : Text, suspendedUntil : ?Nat, snsRoot : ?Principal) : CanisterConfig {
      { minCycleBalance = min; cycleTopUpAmount = amount; suspendedUntil; nickname = ?nickname; snsRoot };
    };

    // Replace the fleet for the seeded owners only — other owners' entries and
    // any real local activity outside these principals are left alone.
    let fleetA = Map.empty<Principal, CanisterConfig>();
    fleetA.add(cApi, config(3 * TC, 5 * TC, "api-gateway", null, null));
    fleetA.add(cIndexer, config(2 * TC, 8 * TC, "ledger-indexer", null, null));
    fleetA.add(cArchive, config(TC, 3 * TC, "archive-node", ?(daysBack(0) + 7 * Durations.DAY_NS), null));
    fleetA.add(cDead, config(TC, 3 * TC, "decommissioned-worker", null, null));
    // The only entry with a non-null snsRoot — exercises the user-tracked-SNS
    // badge alongside the plain blackhole-verified rows.
    fleetA.add(cWorker, config(2 * TC, 4 * TC, "worker-pool", null, if (snsEnabled) { ?snsRootId } else { null }));
    fleetA.add(cFresh, config(2 * TC, 4 * TC, "new-service", null, null));
    tracked.add(ownerA, fleetA);

    let fleetB = Map.empty<Principal, CanisterConfig>();
    fleetB.add(cbFront, config(2 * TC, 3 * TC, "b-frontend", null, null));
    fleetB.add(cbBack, config(2 * TC, 4 * TC, "b-backend", null, null));
    tracked.add(ownerB, fleetB);

    cycleHistory.add(cApi, apiReadings);
    cycleHistory.add(cIndexer, indexerReadings);
    cycleHistory.add(cArchive, archiveReadings);
    cycleHistory.add(cDead, deadReadings);
    cycleHistory.add(cWorker, workerReadings);
    cycleHistory.add(cFresh, freshReadings);
    cycleHistory.add(cbFront, bFrontReadings);
    cycleHistory.add(cbBack, bBackReadings);

    let topUpsA = Map.empty<Principal, [Types.TopUp]>();
    topUpsA.add(cApi, apiTopUps);
    topUpsA.add(cDead, deadTopUps);
    topUpsA.add(cWorker, workerTopUps);
    topUpHistory.add(ownerA, topUpsA);

    let topUpsB = Map.empty<Principal, [Types.TopUp]>();
    topUpsB.add(cbFront, bFrontTopUps);
    topUpsB.add(cbBack, bBackTopUps);
    topUpHistory.add(ownerB, topUpsB);

    // -------------------------------------------------------------------------
    // SNS fleet — same `tracked` map, keyed by root
    // -------------------------------------------------------------------------

    if (snsEnabled) {
      let sns1 = fakeCanister(20);
      let sns2 = fakeCanister(21);
      let sns3 = fakeCanister(22);
      let sns4 = fakeCanister(23);

      let fleetSns = Map.empty<Principal, CanisterConfig>();
      // snsRoot stays null: these are entries owned by the root itself, not
      // user-tracked SNS funding.
      fleetSns.add(sns1, config(5 * TC, 10 * TC, "sns-governance", null, null));
      fleetSns.add(sns2, config(5 * TC, 10 * TC, "sns-ledger", null, null));
      fleetSns.add(sns3, config(3 * TC, 6 * TC, "sns-index", null, null));
      fleetSns.add(sns4, config(3 * TC, 6 * TC, "sns-root", null, null));
      tracked.add(snsRootId, fleetSns);

      cycleHistory.add(sns1, simulate(60, 30 * TC, flatBurn(TC / 3), [(20, 10 * TC)]));
      cycleHistory.add(sns2, simulate(60, 25 * TC, flatBurn(TC / 4), [(25, 10 * TC)]));
      cycleHistory.add(sns3, simulate(60, 14 * TC, flatBurn(TC / 6), []));
      cycleHistory.add(sns4, simulate(60, 12 * TC, flatBurn(TC / 8), []));

      let topUpsSns = Map.empty<Principal, [Types.TopUp]>();
      topUpsSns.add(sns1, snsTopUps1);
      topUpsSns.add(sns2, snsTopUps2);
      topUpHistory.add(snsRootId, topUpsSns);

      snsRootByGovernance.add(snsGovernance, snsRootId);

      // The proposal neuron is what marks an SNS as onboarded — no admin grant
      // or config can exist without `snsSetup` having recorded one, and the
      // public "SNS DAO" nav reads exactly this map. A synthetic 32-byte id:
      // nothing here ever calls governance with it.
      snsProposalNeuron.add(snsRootId, Blob.fromArray(Array.repeat(0x11 : Nat8, 32)));

      let snsAdminSet = Set.empty<Principal>();
      snsAdminSet.add(ownerA);
      snsAdmins.add(snsRootId, snsAdminSet);

      snsDepositConfig.add(snsRootId, { minBalanceE8s = 50 * E8S; depositAmountE8s = 25 * E8S; includeReport = true });
      snsReportConfig.add(snsRootId, { cadenceDays = 30 });

      let trackedRoots = Set.empty<Principal>();
      trackedRoots.add(snsRootId);
      userTrackedSnsRoots.add(ownerA, trackedRoots);
    };

    // -------------------------------------------------------------------------
    // Aggregates — folded from the seeded top-ups, never authored in parallel.
    //
    // Hardcoding these beside the scenarios would let the admin metrics
    // contradict the fleet views, and the next person to change the UI would
    // end up debugging the fixture instead of their change.
    // -------------------------------------------------------------------------

    let allTopUps = apiTopUps
      .concat(deadTopUps)
      .concat(workerTopUps)
      .concat(bFrontTopUps)
      .concat(bBackTopUps)
      .concat(snsTopUps1)
      .concat(snsTopUps2);

    // Counters as they stood at `asOf`, so consecutive snapshots diff into
    // meaningful per-interval deltas.
    func foldAsOf(asOf : Nat) : { succeeded : Nat; failed : Nat; volume : Nat; fees : Nat; rebates : Nat } {
      var succeeded = 0;
      var failed = 0;
      var volume = 0;
      var fees = 0;
      var rebates = 0;
      for (t in allTopUps.vals()) {
        if (t.attemptedAt <= asOf) {
          switch (t.result) {
            // `#deferred` is neither a success nor a failure — nothing failed,
            // the delivery was still in flight. The same rule the live
            // counters apply.
            case (#ok _) { succeeded += 1; volume += t.amount };
            case (#err _) { failed += 1 };
            case (#deferred _) {};
          };
          fees += t.serviceFee;
          rebates += t.rebateApplied;
        };
      };
      { succeeded; failed; volume; fees; rebates };
    };

    // Derived from `tracked` so they cannot drift from the fleets written above.
    var ownersCount = 0;
    var canistersCount = 0;
    for ((_owner, fleet) in tracked.entries()) {
      ownersCount += 1;
      canistersCount += fleet.size();
    };

    let totals = foldAsOf(now);
    cumulativeTopUpsSucceeded := totals.succeeded;
    cumulativeTopUpsFailed := totals.failed;
    cumulativeTopUpTcycles := totals.volume;
    cumulativeFeesTcycles := totals.fees;
    cumulativeRebatesGrantedTcycles := totals.rebates;
    cumulativeSurplusRewardsTcycles := (totals.fees * 3) / 10;
    cumulativeServiceFundingTcycles := 12 * TC;
    cumulativeAdminFundedTcycles := 40 * TC;
    accRewardPerShare := 2_500_000;
    lastCycleCheckAt := ?daysBack(0);

    // -------------------------------------------------------------------------
    // Wallet / loyalty
    // -------------------------------------------------------------------------

    func balanceEvent(
      day : Nat,
      token : Types.Token,
      amount : Nat,
      direction : { #credit; #debit },
      kind : Types.BalanceEventKind,
    ) : Types.BalanceEvent {
      { at = daysBack(day); token; amount; direction; kind };
    };

    // Newest-first, matching History.prependCapped's invariant.
    let eventsA : [Types.BalanceEvent] = [
      balanceEvent(3, #TCYCLES, TC / 40, #credit, #rebateSettled),
      balanceEvent(5, #TCYCLES, 4 * TC, #credit, #swapDelivery({ canisterId = cWorker })),
      balanceEvent(5, #ICP, 2 * E8S, #debit, #swapFunding({ canisterId = cWorker })),
      balanceEvent(10, #TCYCLES, fee(5 * TC) - TC / 50, #debit, #feeCharge({ canisterId = cApi; rebateApplied = TC / 50 })),
      balanceEvent(10, #TCYCLES, 5 * TC, #debit, #topUp({ canisterId = cApi })),
      balanceEvent(12, #ICP, 10 * E8S, #debit, #withdraw),
      balanceEvent(14, #ICP, 40 * E8S, #credit, #deposit),
      balanceEvent(35, #TCYCLES, fee(5 * TC), #debit, #feeCharge({ canisterId = cApi; rebateApplied = 0 })),
      balanceEvent(35, #TCYCLES, 5 * TC, #debit, #topUp({ canisterId = cApi })),
      balanceEvent(46, #ICP, 60 * E8S, #credit, #deposit),
      balanceEvent(60, #TCYCLES, fee(5 * TC), #debit, #feeCharge({ canisterId = cApi; rebateApplied = 0 })),
      balanceEvent(60, #TCYCLES, 5 * TC, #debit, #topUp({ canisterId = cApi })),
      balanceEvent(90, #ICP, 100 * E8S, #credit, #deposit),
    ];
    balanceEvents.add(ownerA, eventsA);

    let eventsB : [Types.BalanceEvent] = [
      balanceEvent(8, #TCYCLES, fee(3 * TC), #debit, #feeCharge({ canisterId = cbFront; rebateApplied = 0 })),
      balanceEvent(8, #TCYCLES, 3 * TC, #debit, #topUp({ canisterId = cbFront })),
      balanceEvent(12, #TCYCLES, 4 * TC, #credit, #mintDelivery({ canisterId = cbBack })),
      balanceEvent(12, #ICP, 2 * E8S, #debit, #mintFunding({ canisterId = cbBack })),
      balanceEvent(45, #ICP, 50 * E8S, #credit, #deposit),
    ];
    balanceEvents.add(ownerB, eventsB);

    // `shares` are cumulative NET fees paid, so they are folded from the same
    // top-ups the fee events above describe.
    func netFeesFor(topUps : [Types.TopUp]) : Nat {
      var total = 0;
      for (t in topUps.vals()) { total += t.serviceFee };
      total;
    };
    loyalty.add(ownerA, {
      shares = netFeesFor(apiTopUps.concat(workerTopUps).concat(deadTopUps));
      rewardDebt = 0;
      accrued = TC / 20;
    });
    loyalty.add(ownerB, {
      shares = netFeesFor(bFrontTopUps.concat(bBackTopUps));
      rewardDebt = 0;
      accrued = TC / 200;
    });

    // -------------------------------------------------------------------------
    // Admin surfaces
    // -------------------------------------------------------------------------

    admins.add(ownerA);
    ignore admins.delete(ownerB); // owner B is deliberately a plain user
    // Never displace an already-designated primary admin.
    switch (primaryAdmin) { case null { primaryAdmin := ?ownerA }; case (?_) {} };

    lpPositionId := ?1;

    harvestHistory := [
      { at = daysBack(6); claimedIcp = 3 * E8S; claimedTcycles = (65 * TC) / 10; toAdmin = 0; toSurplus = (65 * TC) / 10; outcome = #ok },
      { at = daysBack(21); claimedIcp = 0; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #err("pending rewards below harvestThresholdTcycles") },
      { at = daysBack(48); claimedIcp = 5 * E8S; claimedTcycles = 11 * TC; toAdmin = 0; toSurplus = 11 * TC; outcome = #ok },
    ];

    lpHistory := [
      { at = daysBack(30); tcyclesIn = 20 * TC; icpOut = 9 * E8S; positionId = ?1; outcome = #ok },
      { at = daysBack(75); tcyclesIn = 20 * TC; icpOut = 0; positionId = null; outcome = #err("swap floor not met at the quoted price") },
    ];

    // A curated set covering every category and level, plus 30 daily timer
    // entries so the admin log filters have something real to page through.
    let logs = List.empty<Types.LogEntry>();
    func entry(day : Nat, level : Types.LogLevel, category : Types.LogCategory, message : Text, caller : ?Principal) {
      logs.add({ seq = 0; at = daysBack(day); level; category; message; caller });
    };

    entry(2, #error, #topUp, "top-up failed for " # cDead.toText() # ": canister not found", null);
    entry(3, #info, #fee, "rebate settled for " # ownerA.toText(), null);
    entry(5, #info, #swap, "group swap settled: 2 ICP in, 4 TCYCLES out", null);
    entry(5, #info, #topUp, "topped up " # cWorker.toText() # " with 4 TCYCLES", null);
    entry(6, #info, #harvest, "harvested 6.5 TCYCLES of LP rewards to surplus", null);
    entry(8, #warn, #topUp, "deferred delivery for " # cWorker.toText() # ": pool queue not settled", null);
    entry(10, #info, #topUp, "topped up " # cApi.toText() # " with 5 TCYCLES", null);
    entry(12, #info, #admin, "adminSetTunable maxTopContributors = 25", ?ownerA);
    entry(18, #warn, #swap, "swap output below quote, retrying next sweep", null);
    entry(21, #warn, #harvest, "harvest skipped: pending rewards below threshold", null);
    entry(30, #info, #lp, "funded LP position 1 with 20 TCYCLES", ?ownerA);
    entry(40, #error, #swap, "withdrawToSubaccount failed; 4 TCYCLES stuck in pool", null);
    entry(75, #error, #lp, "LP funding aborted: swap floor not met", ?ownerA);

    if (snsEnabled) {
      entry(4, #info, #sns, "SNS deposit check: balance above minimum, no proposal submitted", null);
      entry(28, #info, #sns, "SNS report proposal submitted (id 42)", null);
    };

    var timerDay = 30;
    while (timerDay > 0) {
      entry(timerDay - 1, #info, #timer, "cycle check completed: " # canistersCount.toText() # " canisters scanned", null);
      timerDay -= 1;
    };

    // Newest-first with a descending `seq`, so `beforeSeq` paging walks the list
    // in the same direction the live logger produces it.
    let ordered = Array.sort<Types.LogEntry>(logs.toArray(), func(a, b) { Nat.compare(b.at, a.at) });
    let numbered = List.empty<Types.LogEntry>();
    var nextSeq = ordered.size();
    for (e in ordered.vals()) {
      numbered.add({ e with seq = nextSeq });
      nextSeq -= 1;
    };
    logEntries := numbered.toArray();
    logSeq := ordered.size();

    // 30 daily snapshots, each sampling the counters as they stood that day.
    // Built with s == daysAgo, so the array is newest-first by construction.
    let snaps = List.empty<Types.MetricsSnapshot>();
    var s = 0;
    while (s < 30) {
      let asOf = daysBack(s);
      let f = foldAsOf(asOf);
      snaps.add({
        at = asOf;
        ownersCount;
        trackedCanistersCount = canistersCount;
        feePoolBalanceTcycles = f.fees;
        serviceCyclesBalance = (300 * TC) + (s * TC) / 2;
        cumulativeFeesTcycles = f.fees;
        cumulativeServiceFundingTcycles = 12 * TC;
        cumulativeSurplusRewardsTcycles = (f.fees * 3) / 10;
        cumulativeRebatesGrantedTcycles = f.rebates;
        cumulativeTopUpsSucceeded = f.succeeded;
        cumulativeTopUpsFailed = f.failed;
        cumulativeTopUpTcycles = f.volume;
        accRewardPerShare = 2_500_000;
        lpPositionId = ?1;
      });
      s += 1;
    };
    metricsSnapshots := snaps.toArray();
  };

  seedLocalFixtures();
