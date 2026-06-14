import { useCallback, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import { UpsertCanisterError } from '../bindings/unicycle_backend/unicycle_backend';
import { unexpectedError, type UserError } from '../ui/format';

export type UpsertCanisterStatus =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; canisterId: string }
  // `detail` is the de-emphasized technical tail; `command` is an optional
  // copy-pasteable shell command that fixes the error.
  | { kind: 'error'; message: string; detail?: string; command?: string };

export interface UpsertCanisterArgs {
  minCycleBalance: bigint;
  cycleTopUpAmount: bigint;
  // Required by the candid binding but discarded server-side — only
  // `setCanisterSuspended` can change suspension state. Callers pass the
  // existing value on edit and `undefined` on add.
  suspendedUntil: bigint | undefined;
  // Optional human label. `mergeConfig` takes the incoming value, so edits can
  // rename (send the new label) or clear it (send undefined).
  nickname?: string;
}

export type UpsertCanisterResult =
  | { ok: true }
  | { ok: false; message: string; detail?: string };

export interface UseUpsertCanisterResult {
  status: UpsertCanisterStatus;
  upsertCanister: (
    canisterId: Principal,
    config: UpsertCanisterArgs,
  ) => Promise<UpsertCanisterResult>;
  reset: () => void;
}

function formatUpsertCanisterError(
  err: UpsertCanisterError,
  target: Principal,
): UserError & { command?: string } {
  switch (err.__kind__) {
    case 'anonymous':
      return { message: "Anonymous sessions can't register canisters — sign in and try again." };
    case 'zeroMinCycleBalance':
      return {
        message:
          'Min cycle balance must be greater than zero — enter the balance that should trigger a top-up (e.g. 0.5 TC).',
      };
    case 'zeroCycleTopUpAmount':
      return {
        message:
          'Top-up amount must be greater than zero — enter how many cycles to add per refill (e.g. 1.0 TC).',
      };
    case 'blackholeNotController': {
      const { blackholeCanisterId, reason } = err.blackholeNotController;
      return {
        message:
          "Unicycle can't read this canister's cycle balance yet: the blackhole canister isn't one of its " +
          "controllers. Run this from the canister's controlling identity, then try again.",
        detail: `Blackhole said: ${reason}`,
        command: `icp canister settings update ${target.toText()} --add-controller ${blackholeCanisterId.toText()}`,
      };
    }
    case 'ownerLimitReached':
      return {
        message:
          "Unicycle is at capacity for new accounts right now and can't register another tracker. Please try again later.",
        detail: `Owner limit: ${err.ownerLimitReached.maxOwners.toString()}.`,
      };
    case 'canisterLimitReached':
      return {
        message: `You've reached the limit of ${err.canisterLimitReached.maxCanistersPerOwner.toString()} tracked canisters for this account — remove one before adding another.`,
      };
    case 'rateLimited':
      return {
        message: 'Too many requests in a short window — wait a few seconds and try again.',
      };
    default: {
      const _exhaustive: never = err;
      return { message: 'Unknown error.', detail: JSON.stringify(_exhaustive) };
    }
  }
}

export function useUpsertCanister(
  identity: Identity | null,
  onSuccess?: () => void,
  actAs?: Principal | null,
): UseUpsertCanisterResult {
  const [status, setStatus] = useState<UpsertCanisterStatus>({ kind: 'idle' });

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  const upsertCanister = useCallback(
    async (
      canisterId: Principal,
      config: UpsertCanisterArgs,
    ): Promise<UpsertCanisterResult> => {
      if (!identity) {
        const message = "You're not signed in — sign in and try again.";
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }
      if (config.minCycleBalance <= 0n) {
        const message =
          'Min cycle balance must be greater than zero — enter the balance that should trigger a top-up (e.g. 0.5 TC).';
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }
      if (config.cycleTopUpAmount <= 0n) {
        const message =
          'Top-up amount must be greater than zero — enter how many cycles to add per refill (e.g. 1.0 TC).';
        setStatus({ kind: 'error', message });
        return { ok: false, message };
      }

      setStatus({ kind: 'submitting' });
      try {
        const backend = createUnicycleBackendActor(identity);
        const result = actAs
          ? await backend.asSnsUpsertCanister(actAs, canisterId, config)
          : await backend.upsertCanister(canisterId, config);
        if (result.__kind__ === 'ok') {
          setStatus({ kind: 'success', canisterId: canisterId.toString() });
          onSuccess?.();
          return { ok: true };
        } else {
          const formatted = formatUpsertCanisterError(result.err, canisterId);
          setStatus({ kind: 'error', ...formatted });
          return { ok: false, message: formatted.message, detail: formatted.detail };
        }
      } catch (e) {
        const err = unexpectedError('save the canister', e);
        setStatus({ kind: 'error', ...err });
        return { ok: false, ...err };
      }
    },
    [identity, onSuccess, actAs],
  );

  return { status, upsertCanister, reset };
}
