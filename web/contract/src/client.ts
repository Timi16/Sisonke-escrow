import {ContractInfo, EscrowView, PendingUpgrade, PartyRole, ContractEvent} from './types.js';
import {Result, Spec, AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Locks the escrow amount: payer → contract. Status becomes `Funded`.
   *
   * Signer: `payer`. Allowed when `Created`, before the deadline, and not
   * paused.
   */
  fund(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Every setting and counter above in one call.
   */
  info(options?: MethodOptions): Promise<AssembledTransaction<ContractInfo>>;
  /**
   * The admin: pauses inflows and authorizes upgrades. Cannot touch escrows.
   */
  admin(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * The token every escrow uses.
   */
  token(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Closes an escrow that was never funded. Nothing moves.
   * Status becomes `Cancelled`. Final.
   *
   * Signer: `payer`. Allowed when `Created`, at any time.
   */
  cancel(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Creates an escrow in `Created` status. Nothing is locked yet; call
   * `fund` next, or use `create_and_fund` to do both in one transaction.
   * Only the payer's index lists it until it is funded, so nobody can fill
   * someone else's list with unfunded escrows.
   *
   * `arbiter` is optional and fixed for good: without one there is no
   * dispute path. `terms_hash` is the sha256 of the off-chain agreement.
   *
   * Signer: `payer`. Refused while paused. Returns the new escrow id.
   */
  create(args: { payer: string | Address; recipient: string | Address; arbiter: string | Address | null; amount: bigint; deadline: bigint; title: string; terms_hash: Uint8Array | null }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * The recipient sends the whole amount back: contract → payer.
   * Status becomes `Refunded`. Final.
   *
   * Signer: `recipient`. Allowed when `Funded` or `Disputed` (conceding a
   * dispute), at any time.
   */
  refund(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Opens a dispute, handing the decision to the escrow's arbiter. From
   * now on the payer cannot reclaim. Nothing moves.
   *
   * Signer: `by`, which must be the payer or the recipient. Allowed when
   * `Funded`, the escrow has an arbiter, and `now < deadline`.
   */
  dispute(args: { id: bigint; by: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Moves stored data to this code's layout. Permissionless, so a
   * migration can be finished even if the admin key is lost.
   *
   * v1 is the first layout, so there is never anything to migrate:
   * `NothingToMigrate` when current, `MigrationRequired` if the data is
   * from a newer version (this code was rolled back to after a migration).
   */
  migrate(options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * The payer takes the whole amount back once the deadline has passed:
   * contract → payer. Status becomes `Refunded`. Final.
   *
   * Signer: `payer`. Allowed when `Funded` (not `Disputed`) and
   * `now >= deadline`.
   */
  reclaim(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Pays the whole amount to the recipient: contract → recipient.
   * Status becomes `Released`. Final.
   *
   * Signer: `payer`. Allowed when `Funded` or `Disputed` (conceding a
   * dispute), at any time.
   */
  release(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * The arbiter divides a disputed escrow: `recipient_amount` to the
   * recipient, the rest to the payer. Status becomes `Released` (all to
   * the recipient), `Refunded` (all to the payer) or `Split`. Final.
   *
   * Signer: the escrow's arbiter. Allowed only when `Disputed`, with
   * `0 <= recipient_amount <= amount`.
   */
  resolve(args: { id: bigint; recipient_amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Step two: replaces this contract's code with the proposed wasm, like
   * UUPS `upgradeTo`, between the proposal's `eta` and `expires_at`.
   * `expected_wasm_hash` must be the pending hash, so every signature on
   * this call approves one specific, reviewed piece of code. The address,
   * all storage and all locked funds stay the same; the new code runs
   * from the next call. Signer: admin.
   *
   * Only a plain wasm hash is ever installed: an executable reference
   * would hand control of the code to another account. If the new code
   * changes the storage layout, call its `migrate` next (anyone can).
   */
  upgrade(args: { expected_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Version of the code currently running.
   */
  version(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * `true` while `create`, `create_and_fund` and `fund` are refused.
   */
  is_paused(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * One escrow plus whether its deadline has passed.
   */
  get_escrow(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<EscrowView, Error>>>;
  /**
   * Pauses or unpauses inflows: `create`, `create_and_fund` and `fund`.
   * Every way out (release, refund, reclaim, dispute, resolve, cancel)
   * keeps working. Idempotent. Signer: admin.
   */
  set_paused(args: { paused: boolean }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Batch read for the dashboard, in the order given. Ids that do not
   * exist are skipped rather than failing the whole call. At most
   * `MAX_BATCH` ids.
   */
  get_escrows(args: { ids: Array<bigint> }, options?: MethodOptions): Promise<AssembledTransaction<Result<Array<EscrowView>, Error>>>;
  /**
   * Step two of an admin handover. The old admin loses every power here,
   * and any upgrade it proposed is cancelled. Signer: the pending admin.
   */
  accept_admin(options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Number of escrows ever created. Ids run from 1 to this value.
   */
  escrow_count(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Sum of the amounts of every `Funded` and `Disputed` escrow.
   */
  total_locked(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Freezes the code permanently: `propose_upgrade` and `upgrade` fail
   * from now on, for every admin, and any pending proposal is cancelled.
   * Cannot be undone. Refused while a migration is pending, so a
   * half-migrated contract can never be frozen. Signer: admin.
   */
  lock_upgrades(options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * The address `propose_admin` named, until it calls `accept_admin`.
   */
  pending_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Step one of an admin handover. Nothing changes until `new_admin` calls
   * `accept_admin`, so a typo cannot lose the admin role. Proposing again
   * replaces the pending admin. Signer: current admin.
   */
  propose_admin(args: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Seconds a proposed upgrade must wait before `upgrade` can run it.
   */
  upgrade_delay(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Withdraws the pending upgrade proposal. Signer: admin.
   */
  cancel_upgrade(options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * `create` and `fund` in one transaction, with one signature from the
   * payer covering the call and the token transfer. The default path.
   *
   * Signer: `payer`. Refused while paused. Returns the new escrow id.
   */
  create_and_fund(args: { payer: string | Address; recipient: string | Address; arbiter: string | Address | null; amount: bigint; deadline: bigint; title: string; terms_hash: Uint8Array | null }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, Error>>>;
  /**
   * The proposed upgrade, if any: its wasm hash and the earliest time
   * (`eta`) and latest time (`expires_at`) it can run. Until `eta` either
   * party can still move each escrow's funds out of the new code's reach.
   */
  pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgrade | null>>;
  /**
   * Step one of an upgrade: names already-uploaded wasm and starts the
   * public delay. `upgrade` can run it from `eta = now + upgrade_delay()`
   * until `expires_at = eta + UPGRADE_WINDOW`; after that it has to be
   * proposed again, with a fresh delay. Proposing again replaces the
   * proposal (with an `upgrade_cancelled` event for the old one) and
   * restarts the delay. Nothing changes for escrows: during the delay
   * every exit function keeps working, so either party can move the funds
   * out of the new code's reach; before the deadline that means toward the
   * counterparty or through the arbiter (docs/CONTRACT.md, trust
   * assumption #1). Signer: admin.
   *
   * Upload the wasm first (`stellar contract upload`) and pass its hash.
   * Allowed while a migration is pending, so a broken version can always
   * be replaced.
   */
  propose_upgrade(args: { new_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Layout version of the stored data. Equal to the code's
   * `STORAGE_VERSION` unless a `migrate` is pending.
   */
  storage_version(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Like `extend_escrow_ttl`, for a party's index count and one page.
   * Missing entries are skipped. Anyone may call it.
   */
  extend_index_ttl(args: { party: string | Address; role: PartyRole; page: number }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * One page of at most `PAGE_SIZE` escrow ids for `party` in `role`.
   * Page `n` holds entries `n * 50 ..`; empty past the end. Creation
   * order for `Payer`, funding order for `Recipient` and `Arbiter`.
   */
  party_escrow_ids(args: { party: string | Address; role: PartyRole; page: number }, options?: MethodOptions): Promise<AssembledTransaction<Array<bigint>>>;
  /**
   * `false` once `lock_upgrades` has been called; the code is then final.
   */
  upgrades_enabled(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Keeps an escrow record alive for another 120 days if fewer than 60
   * remain. Anyone may call it (a keeper, the web app); it changes nothing
   * else and emits nothing.
   */
  extend_escrow_ttl(args: { id: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * Raises the upgrade delay. Increase only: a lower delay would itself
   * need a delay to be safe. A pending proposal is held to the new delay
   * too: its `eta` moves to `proposed_at + delay` if that is later (and
   * its `expires_at` with it). Signer: admin.
   */
  set_upgrade_delay(args: { delay: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
  /**
   * How many escrows `party` has in `role`, across all pages.
   */
  party_escrow_count(args: { party: string | Address; role: PartyRole }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Withdraws a pending proposal. Signer: current admin.
   */
  cancel_admin_proposal(options?: MethodOptions): Promise<AssembledTransaction<Result<null, Error>>>;
}

export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new Spec(["AAAAAAAAAJRMb2NrcyB0aGUgZXNjcm93IGFtb3VudDogcGF5ZXIg4oaSIGNvbnRyYWN0LiBTdGF0dXMgYmVjb21lcyBgRnVuZGVkYC4KClNpZ25lcjogYHBheWVyYC4gQWxsb3dlZCB3aGVuIGBDcmVhdGVkYCwgYmVmb3JlIHRoZSBkZWFkbGluZSwgYW5kIG5vdApwYXVzZWQuAAAABGZ1bmQAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAACxFdmVyeSBzZXR0aW5nIGFuZCBjb3VudGVyIGFib3ZlIGluIG9uZSBjYWxsLgAAAARpbmZvAAAAAAAAAAEAAAfQAAAADENvbnRyYWN0SW5mbw==", "AAAAAAAAAEhUaGUgYWRtaW46IHBhdXNlcyBpbmZsb3dzIGFuZCBhdXRob3JpemVzIHVwZ3JhZGVzLiBDYW5ub3QgdG91Y2ggZXNjcm93cy4AAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=", "AAAAAAAAABxUaGUgdG9rZW4gZXZlcnkgZXNjcm93IHVzZXMuAAAABXRva2VuAAAAAAAAAAAAAAEAAAAT", "AAAAAAAAAJBDbG9zZXMgYW4gZXNjcm93IHRoYXQgd2FzIG5ldmVyIGZ1bmRlZC4gTm90aGluZyBtb3Zlcy4KU3RhdHVzIGJlY29tZXMgYENhbmNlbGxlZGAuIEZpbmFsLgoKU2lnbmVyOiBgcGF5ZXJgLiBBbGxvd2VkIHdoZW4gYENyZWF0ZWRgLCBhdCBhbnkgdGltZS4AAAAGY2FuY2VsAAAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAcRDcmVhdGVzIGFuIGVzY3JvdyBpbiBgQ3JlYXRlZGAgc3RhdHVzLiBOb3RoaW5nIGlzIGxvY2tlZCB5ZXQ7IGNhbGwKYGZ1bmRgIG5leHQsIG9yIHVzZSBgY3JlYXRlX2FuZF9mdW5kYCB0byBkbyBib3RoIGluIG9uZSB0cmFuc2FjdGlvbi4KT25seSB0aGUgcGF5ZXIncyBpbmRleCBsaXN0cyBpdCB1bnRpbCBpdCBpcyBmdW5kZWQsIHNvIG5vYm9keSBjYW4gZmlsbApzb21lb25lIGVsc2UncyBsaXN0IHdpdGggdW5mdW5kZWQgZXNjcm93cy4KCmBhcmJpdGVyYCBpcyBvcHRpb25hbCBhbmQgZml4ZWQgZm9yIGdvb2Q6IHdpdGhvdXQgb25lIHRoZXJlIGlzIG5vCmRpc3B1dGUgcGF0aC4gYHRlcm1zX2hhc2hgIGlzIHRoZSBzaGEyNTYgb2YgdGhlIG9mZi1jaGFpbiBhZ3JlZW1lbnQuCgpTaWduZXI6IGBwYXllcmAuIFJlZnVzZWQgd2hpbGUgcGF1c2VkLiBSZXR1cm5zIHRoZSBuZXcgZXNjcm93IGlkLgAAAAZjcmVhdGUAAAAAAAcAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAHYXJiaXRlcgAAAAPoAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAABXRpdGxlAAAAAAAAEAAAAAAAAAAKdGVybXNfaGFzaAAAAAAD6AAAA+4AAAAgAAAAAQAAA+kAAAAGAAAAAw==", "AAAAAAAAAL5UaGUgcmVjaXBpZW50IHNlbmRzIHRoZSB3aG9sZSBhbW91bnQgYmFjazogY29udHJhY3Qg4oaSIHBheWVyLgpTdGF0dXMgYmVjb21lcyBgUmVmdW5kZWRgLiBGaW5hbC4KClNpZ25lcjogYHJlY2lwaWVudGAuIEFsbG93ZWQgd2hlbiBgRnVuZGVkYCBvciBgRGlzcHV0ZWRgIChjb25jZWRpbmcgYQpkaXNwdXRlKSwgYXQgYW55IHRpbWUuAAAAAAAGcmVmdW5kAAAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAPRPcGVucyBhIGRpc3B1dGUsIGhhbmRpbmcgdGhlIGRlY2lzaW9uIHRvIHRoZSBlc2Nyb3cncyBhcmJpdGVyLiBGcm9tCm5vdyBvbiB0aGUgcGF5ZXIgY2Fubm90IHJlY2xhaW0uIE5vdGhpbmcgbW92ZXMuCgpTaWduZXI6IGBieWAsIHdoaWNoIG11c3QgYmUgdGhlIHBheWVyIG9yIHRoZSByZWNpcGllbnQuIEFsbG93ZWQgd2hlbgpgRnVuZGVkYCwgdGhlIGVzY3JvdyBoYXMgYW4gYXJiaXRlciwgYW5kIGBub3cgPCBkZWFkbGluZWAuAAAAB2Rpc3B1dGUAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAAAmJ5AAAAAAATAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAUFNb3ZlcyBzdG9yZWQgZGF0YSB0byB0aGlzIGNvZGUncyBsYXlvdXQuIFBlcm1pc3Npb25sZXNzLCBzbyBhCm1pZ3JhdGlvbiBjYW4gYmUgZmluaXNoZWQgZXZlbiBpZiB0aGUgYWRtaW4ga2V5IGlzIGxvc3QuCgp2MSBpcyB0aGUgZmlyc3QgbGF5b3V0LCBzbyB0aGVyZSBpcyBuZXZlciBhbnl0aGluZyB0byBtaWdyYXRlOgpgTm90aGluZ1RvTWlncmF0ZWAgd2hlbiBjdXJyZW50LCBgTWlncmF0aW9uUmVxdWlyZWRgIGlmIHRoZSBkYXRhIGlzCmZyb20gYSBuZXdlciB2ZXJzaW9uICh0aGlzIGNvZGUgd2FzIHJvbGxlZCBiYWNrIHRvIGFmdGVyIGEgbWlncmF0aW9uKS4AAAAAAAAHbWlncmF0ZQAAAAAAAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAMlUaGUgcGF5ZXIgdGFrZXMgdGhlIHdob2xlIGFtb3VudCBiYWNrIG9uY2UgdGhlIGRlYWRsaW5lIGhhcyBwYXNzZWQ6CmNvbnRyYWN0IOKGkiBwYXllci4gU3RhdHVzIGJlY29tZXMgYFJlZnVuZGVkYC4gRmluYWwuCgpTaWduZXI6IGBwYXllcmAuIEFsbG93ZWQgd2hlbiBgRnVuZGVkYCAobm90IGBEaXNwdXRlZGApIGFuZApgbm93ID49IGRlYWRsaW5lYC4AAAAAAAAHcmVjbGFpbQAAAAABAAAAAAAAAAJpZAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAALtQYXlzIHRoZSB3aG9sZSBhbW91bnQgdG8gdGhlIHJlY2lwaWVudDogY29udHJhY3Qg4oaSIHJlY2lwaWVudC4KU3RhdHVzIGJlY29tZXMgYFJlbGVhc2VkYC4gRmluYWwuCgpTaWduZXI6IGBwYXllcmAuIEFsbG93ZWQgd2hlbiBgRnVuZGVkYCBvciBgRGlzcHV0ZWRgIChjb25jZWRpbmcgYQpkaXNwdXRlKSwgYXQgYW55IHRpbWUuAAAAAAdyZWxlYXNlAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAASpUaGUgYXJiaXRlciBkaXZpZGVzIGEgZGlzcHV0ZWQgZXNjcm93OiBgcmVjaXBpZW50X2Ftb3VudGAgdG8gdGhlCnJlY2lwaWVudCwgdGhlIHJlc3QgdG8gdGhlIHBheWVyLiBTdGF0dXMgYmVjb21lcyBgUmVsZWFzZWRgIChhbGwgdG8KdGhlIHJlY2lwaWVudCksIGBSZWZ1bmRlZGAgKGFsbCB0byB0aGUgcGF5ZXIpIG9yIGBTcGxpdGAuIEZpbmFsLgoKU2lnbmVyOiB0aGUgZXNjcm93J3MgYXJiaXRlci4gQWxsb3dlZCBvbmx5IHdoZW4gYERpc3B1dGVkYCwgd2l0aApgMCA8PSByZWNpcGllbnRfYW1vdW50IDw9IGFtb3VudGAuAAAAAAAHcmVzb2x2ZQAAAAACAAAAAAAAAAJpZAAAAAAABgAAAAAAAAAQcmVjaXBpZW50X2Ftb3VudAAAAAsAAAABAAAD6QAAAAIAAAAD", "AAAAAAAAAj1TdGVwIHR3bzogcmVwbGFjZXMgdGhpcyBjb250cmFjdCdzIGNvZGUgd2l0aCB0aGUgcHJvcG9zZWQgd2FzbSwgbGlrZQpVVVBTIGB1cGdyYWRlVG9gLCBiZXR3ZWVuIHRoZSBwcm9wb3NhbCdzIGBldGFgIGFuZCBgZXhwaXJlc19hdGAuCmBleHBlY3RlZF93YXNtX2hhc2hgIG11c3QgYmUgdGhlIHBlbmRpbmcgaGFzaCwgc28gZXZlcnkgc2lnbmF0dXJlIG9uCnRoaXMgY2FsbCBhcHByb3ZlcyBvbmUgc3BlY2lmaWMsIHJldmlld2VkIHBpZWNlIG9mIGNvZGUuIFRoZSBhZGRyZXNzLAphbGwgc3RvcmFnZSBhbmQgYWxsIGxvY2tlZCBmdW5kcyBzdGF5IHRoZSBzYW1lOyB0aGUgbmV3IGNvZGUgcnVucwpmcm9tIHRoZSBuZXh0IGNhbGwuIFNpZ25lcjogYWRtaW4uCgpPbmx5IGEgcGxhaW4gd2FzbSBoYXNoIGlzIGV2ZXIgaW5zdGFsbGVkOiBhbiBleGVjdXRhYmxlIHJlZmVyZW5jZQp3b3VsZCBoYW5kIGNvbnRyb2wgb2YgdGhlIGNvZGUgdG8gYW5vdGhlciBhY2NvdW50LiBJZiB0aGUgbmV3IGNvZGUKY2hhbmdlcyB0aGUgc3RvcmFnZSBsYXlvdXQsIGNhbGwgaXRzIGBtaWdyYXRlYCBuZXh0IChhbnlvbmUgY2FuKS4AAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAABJleHBlY3RlZF93YXNtX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAACZWZXJzaW9uIG9mIHRoZSBjb2RlIGN1cnJlbnRseSBydW5uaW5nLgAAAAAAB3ZlcnNpb24AAAAAAAAAAAEAAAAE", "AAAAAAAAAEBgdHJ1ZWAgd2hpbGUgYGNyZWF0ZWAsIGBjcmVhdGVfYW5kX2Z1bmRgIGFuZCBgZnVuZGAgYXJlIHJlZnVzZWQuAAAACWlzX3BhdXNlZAAAAAAAAAAAAAABAAAAAQ==", "AAAAAAAAADBPbmUgZXNjcm93IHBsdXMgd2hldGhlciBpdHMgZGVhZGxpbmUgaGFzIHBhc3NlZC4AAAAKZ2V0X2VzY3JvdwAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAKRXNjcm93VmlldwAAAAAAAw==", "AAAAAAAAALBQYXVzZXMgb3IgdW5wYXVzZXMgaW5mbG93czogYGNyZWF0ZWAsIGBjcmVhdGVfYW5kX2Z1bmRgIGFuZCBgZnVuZGAuCkV2ZXJ5IHdheSBvdXQgKHJlbGVhc2UsIHJlZnVuZCwgcmVjbGFpbSwgZGlzcHV0ZSwgcmVzb2x2ZSwgY2FuY2VsKQprZWVwcyB3b3JraW5nLiBJZGVtcG90ZW50LiBTaWduZXI6IGFkbWluLgAAAApzZXRfcGF1c2VkAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAAD", "AAAAAAAAAJBCYXRjaCByZWFkIGZvciB0aGUgZGFzaGJvYXJkLCBpbiB0aGUgb3JkZXIgZ2l2ZW4uIElkcyB0aGF0IGRvIG5vdApleGlzdCBhcmUgc2tpcHBlZCByYXRoZXIgdGhhbiBmYWlsaW5nIHRoZSB3aG9sZSBjYWxsLiBBdCBtb3N0CmBNQVhfQkFUQ0hgIGlkcy4AAAALZ2V0X2VzY3Jvd3MAAAAAAQAAAAAAAAADaWRzAAAAA+oAAAAGAAAAAQAAA+kAAAPqAAAH0AAAAApFc2Nyb3dWaWV3AAAAAAAD", "AAAAAAAAAIlTdGVwIHR3byBvZiBhbiBhZG1pbiBoYW5kb3Zlci4gVGhlIG9sZCBhZG1pbiBsb3NlcyBldmVyeSBwb3dlciBoZXJlLAphbmQgYW55IHVwZ3JhZGUgaXQgcHJvcG9zZWQgaXMgY2FuY2VsbGVkLiBTaWduZXI6IHRoZSBwZW5kaW5nIGFkbWluLgAAAAAAAAxhY2NlcHRfYWRtaW4AAAAAAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAD1OdW1iZXIgb2YgZXNjcm93cyBldmVyIGNyZWF0ZWQuIElkcyBydW4gZnJvbSAxIHRvIHRoaXMgdmFsdWUuAAAAAAAADGVzY3Jvd19jb3VudAAAAAAAAAABAAAABg==", "AAAAAAAAADtTdW0gb2YgdGhlIGFtb3VudHMgb2YgZXZlcnkgYEZ1bmRlZGAgYW5kIGBEaXNwdXRlZGAgZXNjcm93LgAAAAAMdG90YWxfbG9ja2VkAAAAAAAAAAEAAAAL", "AAAAAAAAAVNSdW5zIG9uY2UsIGF0b21pY2FsbHkgd2l0aCBkZXBsb3ksIHNvIGl0IGNhbm5vdCBiZSBmcm9udC1ydW4uCmB0b2tlbmAgaXMgcGlubmVkIGZvciBldmVyeSBlc2Nyb3c7IHRoZSBgZGVjaW1hbHMoKWAgY2FsbCBtYWtlcyBkZXBsb3kKZmFpbCBpZiBpdCBpc24ndCBhIHRva2VuIGNvbnRyYWN0LiBgdXBncmFkZV9kZWxheWAgKHNlY29uZHMsIGJldHdlZW4KYE1JTl9VUEdSQURFX0RFTEFZYCBhbmQgYE1BWF9VUEdSQURFX0RFTEFZYCkgaXMgaG93IGxvbmcgZXZlcnkgcHJvcG9zZWQKdXBncmFkZSBtdXN0IHdhaXQgYmVmb3JlIGl0IGNhbiBydW47IGl0IGNhbiBsYXRlciBvbmx5IGJlIHJhaXNlZC4AAAAADV9fY29uc3RydWN0b3IAAAAAAAADAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAANdXBncmFkZV9kZWxheQAAAAAAAAYAAAAA", "AAAAAAAAAP9GcmVlemVzIHRoZSBjb2RlIHBlcm1hbmVudGx5OiBgcHJvcG9zZV91cGdyYWRlYCBhbmQgYHVwZ3JhZGVgIGZhaWwKZnJvbSBub3cgb24sIGZvciBldmVyeSBhZG1pbiwgYW5kIGFueSBwZW5kaW5nIHByb3Bvc2FsIGlzIGNhbmNlbGxlZC4KQ2Fubm90IGJlIHVuZG9uZS4gUmVmdXNlZCB3aGlsZSBhIG1pZ3JhdGlvbiBpcyBwZW5kaW5nLCBzbyBhCmhhbGYtbWlncmF0ZWQgY29udHJhY3QgY2FuIG5ldmVyIGJlIGZyb3plbi4gU2lnbmVyOiBhZG1pbi4AAAAADWxvY2tfdXBncmFkZXMAAAAAAAAAAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAEFUaGUgYWRkcmVzcyBgcHJvcG9zZV9hZG1pbmAgbmFtZWQsIHVudGlsIGl0IGNhbGxzIGBhY2NlcHRfYWRtaW5gLgAAAAAAAA1wZW5kaW5nX2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAL9TdGVwIG9uZSBvZiBhbiBhZG1pbiBoYW5kb3Zlci4gTm90aGluZyBjaGFuZ2VzIHVudGlsIGBuZXdfYWRtaW5gIGNhbGxzCmBhY2NlcHRfYWRtaW5gLCBzbyBhIHR5cG8gY2Fubm90IGxvc2UgdGhlIGFkbWluIHJvbGUuIFByb3Bvc2luZyBhZ2FpbgpyZXBsYWNlcyB0aGUgcGVuZGluZyBhZG1pbi4gU2lnbmVyOiBjdXJyZW50IGFkbWluLgAAAAANcHJvcG9zZV9hZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAABAAAD6QAAAAIAAAAD", "AAAAAAAAAEFTZWNvbmRzIGEgcHJvcG9zZWQgdXBncmFkZSBtdXN0IHdhaXQgYmVmb3JlIGB1cGdyYWRlYCBjYW4gcnVuIGl0LgAAAAAAAA11cGdyYWRlX2RlbGF5AAAAAAAAAAAAAAEAAAAG", "AAAAAAAAADZXaXRoZHJhd3MgdGhlIHBlbmRpbmcgdXBncmFkZSBwcm9wb3NhbC4gU2lnbmVyOiBhZG1pbi4AAAAAAA5jYW5jZWxfdXBncmFkZQAAAAAAAAAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAAMhgY3JlYXRlYCBhbmQgYGZ1bmRgIGluIG9uZSB0cmFuc2FjdGlvbiwgd2l0aCBvbmUgc2lnbmF0dXJlIGZyb20gdGhlCnBheWVyIGNvdmVyaW5nIHRoZSBjYWxsIGFuZCB0aGUgdG9rZW4gdHJhbnNmZXIuIFRoZSBkZWZhdWx0IHBhdGguCgpTaWduZXI6IGBwYXllcmAuIFJlZnVzZWQgd2hpbGUgcGF1c2VkLiBSZXR1cm5zIHRoZSBuZXcgZXNjcm93IGlkLgAAAA9jcmVhdGVfYW5kX2Z1bmQAAAAABwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAdhcmJpdGVyAAAAA+gAAAATAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAFdGl0bGUAAAAAAAAQAAAAAAAAAAp0ZXJtc19oYXNoAAAAAAPoAAAD7gAAACAAAAABAAAD6QAAAAYAAAAD", "AAAAAAAAAM1UaGUgcHJvcG9zZWQgdXBncmFkZSwgaWYgYW55OiBpdHMgd2FzbSBoYXNoIGFuZCB0aGUgZWFybGllc3QgdGltZQooYGV0YWApIGFuZCBsYXRlc3QgdGltZSAoYGV4cGlyZXNfYXRgKSBpdCBjYW4gcnVuLiBVbnRpbCBgZXRhYCBlaXRoZXIKcGFydHkgY2FuIHN0aWxsIG1vdmUgZWFjaCBlc2Nyb3cncyBmdW5kcyBvdXQgb2YgdGhlIG5ldyBjb2RlJ3MgcmVhY2guAAAAAAAAD3BlbmRpbmdfdXBncmFkZQAAAAAAAAAAAQAAA+gAAAfQAAAADlBlbmRpbmdVcGdyYWRlAAA=", "AAAAAAAAAxBTdGVwIG9uZSBvZiBhbiB1cGdyYWRlOiBuYW1lcyBhbHJlYWR5LXVwbG9hZGVkIHdhc20gYW5kIHN0YXJ0cyB0aGUKcHVibGljIGRlbGF5LiBgdXBncmFkZWAgY2FuIHJ1biBpdCBmcm9tIGBldGEgPSBub3cgKyB1cGdyYWRlX2RlbGF5KClgCnVudGlsIGBleHBpcmVzX2F0ID0gZXRhICsgVVBHUkFERV9XSU5ET1dgOyBhZnRlciB0aGF0IGl0IGhhcyB0byBiZQpwcm9wb3NlZCBhZ2Fpbiwgd2l0aCBhIGZyZXNoIGRlbGF5LiBQcm9wb3NpbmcgYWdhaW4gcmVwbGFjZXMgdGhlCnByb3Bvc2FsICh3aXRoIGFuIGB1cGdyYWRlX2NhbmNlbGxlZGAgZXZlbnQgZm9yIHRoZSBvbGQgb25lKSBhbmQKcmVzdGFydHMgdGhlIGRlbGF5LiBOb3RoaW5nIGNoYW5nZXMgZm9yIGVzY3Jvd3M6IGR1cmluZyB0aGUgZGVsYXkKZXZlcnkgZXhpdCBmdW5jdGlvbiBrZWVwcyB3b3JraW5nLCBzbyBlaXRoZXIgcGFydHkgY2FuIG1vdmUgdGhlIGZ1bmRzCm91dCBvZiB0aGUgbmV3IGNvZGUncyByZWFjaDsgYmVmb3JlIHRoZSBkZWFkbGluZSB0aGF0IG1lYW5zIHRvd2FyZCB0aGUKY291bnRlcnBhcnR5IG9yIHRocm91Z2ggdGhlIGFyYml0ZXIgKGRvY3MvQ09OVFJBQ1QubWQsIHRydXN0CmFzc3VtcHRpb24gIzEpLiBTaWduZXI6IGFkbWluLgoKVXBsb2FkIHRoZSB3YXNtIGZpcnN0IChgc3RlbGxhciBjb250cmFjdCB1cGxvYWRgKSBhbmQgcGFzcyBpdHMgaGFzaC4KQWxsb3dlZCB3aGlsZSBhIG1pZ3JhdGlvbiBpcyBwZW5kaW5nLCBzbyBhIGJyb2tlbiB2ZXJzaW9uIGNhbiBhbHdheXMKYmUgcmVwbGFjZWQuAAAAD3Byb3Bvc2VfdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD", "AAAAAAAAAGdMYXlvdXQgdmVyc2lvbiBvZiB0aGUgc3RvcmVkIGRhdGEuIEVxdWFsIHRvIHRoZSBjb2RlJ3MKYFNUT1JBR0VfVkVSU0lPTmAgdW5sZXNzIGEgYG1pZ3JhdGVgIGlzIHBlbmRpbmcuAAAAAA9zdG9yYWdlX3ZlcnNpb24AAAAAAAAAAAEAAAAE", "AAAAAAAAAHJMaWtlIGBleHRlbmRfZXNjcm93X3R0bGAsIGZvciBhIHBhcnR5J3MgaW5kZXggY291bnQgYW5kIG9uZSBwYWdlLgpNaXNzaW5nIGVudHJpZXMgYXJlIHNraXBwZWQuIEFueW9uZSBtYXkgY2FsbCBpdC4AAAAAABBleHRlbmRfaW5kZXhfdHRsAAAAAwAAAAAAAAAFcGFydHkAAAAAAAATAAAAAAAAAARyb2xlAAAH0AAAAAlQYXJ0eVJvbGUAAAAAAAAAAAAABHBhZ2UAAAAEAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAMJPbmUgcGFnZSBvZiBhdCBtb3N0IGBQQUdFX1NJWkVgIGVzY3JvdyBpZHMgZm9yIGBwYXJ0eWAgaW4gYHJvbGVgLgpQYWdlIGBuYCBob2xkcyBlbnRyaWVzIGBuICogNTAgLi5gOyBlbXB0eSBwYXN0IHRoZSBlbmQuIENyZWF0aW9uCm9yZGVyIGZvciBgUGF5ZXJgLCBmdW5kaW5nIG9yZGVyIGZvciBgUmVjaXBpZW50YCBhbmQgYEFyYml0ZXJgLgAAAAAAEHBhcnR5X2VzY3Jvd19pZHMAAAADAAAAAAAAAAVwYXJ0eQAAAAAAABMAAAAAAAAABHJvbGUAAAfQAAAACVBhcnR5Um9sZQAAAAAAAAAAAAAEcGFnZQAAAAQAAAABAAAD6gAAAAY=", "AAAAAAAAAEVgZmFsc2VgIG9uY2UgYGxvY2tfdXBncmFkZXNgIGhhcyBiZWVuIGNhbGxlZDsgdGhlIGNvZGUgaXMgdGhlbiBmaW5hbC4AAAAAAAAQdXBncmFkZXNfZW5hYmxlZAAAAAAAAAABAAAAAQ==", "AAAAAAAAAKFLZWVwcyBhbiBlc2Nyb3cgcmVjb3JkIGFsaXZlIGZvciBhbm90aGVyIDEyMCBkYXlzIGlmIGZld2VyIHRoYW4gNjAKcmVtYWluLiBBbnlvbmUgbWF5IGNhbGwgaXQgKGEga2VlcGVyLCB0aGUgd2ViIGFwcCk7IGl0IGNoYW5nZXMgbm90aGluZwplbHNlIGFuZCBlbWl0cyBub3RoaW5nLgAAAAAAABFleHRlbmRfZXNjcm93X3R0bAAAAAAAAAEAAAAAAAAAAmlkAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==", "AAAAAAAAAPZSYWlzZXMgdGhlIHVwZ3JhZGUgZGVsYXkuIEluY3JlYXNlIG9ubHk6IGEgbG93ZXIgZGVsYXkgd291bGQgaXRzZWxmCm5lZWQgYSBkZWxheSB0byBiZSBzYWZlLiBBIHBlbmRpbmcgcHJvcG9zYWwgaXMgaGVsZCB0byB0aGUgbmV3IGRlbGF5CnRvbzogaXRzIGBldGFgIG1vdmVzIHRvIGBwcm9wb3NlZF9hdCArIGRlbGF5YCBpZiB0aGF0IGlzIGxhdGVyIChhbmQKaXRzIGBleHBpcmVzX2F0YCB3aXRoIGl0KS4gU2lnbmVyOiBhZG1pbi4AAAAAABFzZXRfdXBncmFkZV9kZWxheQAAAAAAAAEAAAAAAAAABWRlbGF5AAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=", "AAAAAAAAADlIb3cgbWFueSBlc2Nyb3dzIGBwYXJ0eWAgaGFzIGluIGByb2xlYCwgYWNyb3NzIGFsbCBwYWdlcy4AAAAAAAAScGFydHlfZXNjcm93X2NvdW50AAAAAAACAAAAAAAAAAVwYXJ0eQAAAAAAABMAAAAAAAAABHJvbGUAAAfQAAAACVBhcnR5Um9sZQAAAAAAAAEAAAAE", "AAAAAAAAADRXaXRoZHJhd3MgYSBwZW5kaW5nIHByb3Bvc2FsLiBTaWduZXI6IGN1cnJlbnQgYWRtaW4uAAAAFWNhbmNlbF9hZG1pbl9wcm9wb3NhbAAAAAAAAAAAAAABAAAD6QAAAAIAAAAD", "AAAAAQAAAAAAAAAAAAAABkVzY3JvdwAAAAAAFAAAADtTbWFsbGVzdCB1bml0IG9mIHRoZSB0b2tlbiAoVVNEQyA9IDcgZGVjaW1hbHMpLiBBbHdheXMgPiAwLgAAAAAGYW1vdW50AAAAAAALAAAAJmBOb25lYCBtZWFucyB0aGVyZSBpcyBubyBkaXNwdXRlIHBhdGguAAAAAAAHYXJiaXRlcgAAAAPoAAAAEwAAACowIHVudGlsIHRoZSBlc2Nyb3cgcmVhY2hlcyBhIGZpbmFsIHN0YXR1cy4AAAAAAAljbG9zZWRfYXQAAAAAAAAGAAAAKlNpZ25lciBvZiB0aGUgY2FsbCB0aGF0IGNsb3NlZCB0aGUgZXNjcm93LgAAAAAACWNsb3NlZF9ieQAAAAAAA+gAAAATAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAQkxlZGdlciB0aGUgZXNjcm93IHdhcyBjcmVhdGVkIGluOyB3aGVyZSB0aGUgVUkgc3RhcnRzIGBnZXRFdmVudHNgLgAAAAAADmNyZWF0ZWRfbGVkZ2VyAAAAAAAEAAAASExlZGdlciB0aW1lc3RhbXAsIHNlY29uZHMuIEF0IGBub3cgPT0gZGVhZGxpbmVgIHRoZSBkZWFkbGluZSBoYXMgcGFzc2VkLgAAAAhkZWFkbGluZQAAAAYAAAASMCB1bmxlc3MgZGlzcHV0ZWQuAAAAAAALZGlzcHV0ZWRfYXQAAAAABgAAAChUaGUgcGF5ZXIgb3IgdGhlIHJlY2lwaWVudCwgaWYgZGlzcHV0ZWQuAAAAC2Rpc3B1dGVkX2J5AAAAA+gAAAATAAAADzAgdW50aWwgZnVuZGVkLgAAAAAJZnVuZGVkX2F0AAAAAAAABgAAABgxIG9yIG1vcmUsIG5ldmVyIHJldXNlZC4AAAACaWQAAAAAAAYAAAAOMCB1bnRpbCBmaW5hbC4AAAAAAA1wYWlkX3RvX3BheWVyAAAAAAAACwAAAA4wIHVudGlsIGZpbmFsLgAAAAAAEXBhaWRfdG9fcmVjaXBpZW50AAAAAAAACwAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAZzdGF0dXMAAAAAB9AAAAAGU3RhdHVzAAAAAAAqc2hhMjU2IG9mIHRoZSBvZmYtY2hhaW4gYWdyZWVtZW50LCBpZiBhbnkuAAAAAAAKdGVybXNfaGFzaAAAAAAD6AAAA+4AAAAgAAAAH0F0IG1vc3QgNjQgYnl0ZXMsIG1heSBiZSBlbXB0eS4AAAAABXRpdGxlAAAAAAAAEAAAADRUaGUgdG9rZW4gcGlubmVkIGF0IGNvbnN0cnVjdGlvbiAoVGVzdG5ldCBVU0RDIFNBQykuAAAABXRva2VuAAAAAAAAEwAAADtMZWRnZXIgb2YgdGhlIGxhc3QgdHJhbnNpdGlvbiwgYXMgYSBoaW50IGZvciBldmVudCBsb29rdXBzLgAAAAAOdXBkYXRlZF9sZWRnZXIAAAAAAAQ=", "AAAAAgAAAq9MaWZlY3ljbGUgb2YgYW4gZXNjcm93LiBTdGF0dXMgb25seSBldmVyIG1vdmVzIGZvcndhcmQ6CgpgYGB0ZXh0CkNyZWF0ZWQg4pSA4pSAZnVuZOKUgOKUgOKWtiBGdW5kZWQg4pSA4pSAcmVsZWFzZeKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKWtiBSZWxlYXNlZArilIIgICAgICAgICAgICAgICAgIOKUnOKUgOKUgHJlZnVuZCAvIHJlY2xhaW3ilIDilIDilIDilIDilrYgUmVmdW5kZWQK4pSCICAgICAgICAgICAgICAgICDilJTilIDilIBkaXNwdXRl4pSA4pSA4pa2IERpc3B1dGVkIOKUgOKUrOKUgHJlbGVhc2UgLyByZXNvbHZlKGFsbCnilIDilIDilrYgUmVsZWFzZWQK4pSCICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICDilJzilIByZWZ1bmQgLyByZXNvbHZlKG5vbmUp4pSA4pSA4pa2IFJlZnVuZGVkCuKUgiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4pSU4pSAcmVzb2x2ZShzcGxpdCnilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilrYgU3BsaXQK4pSU4pSA4pSAY2FuY2Vs4pSA4pSA4pa2IENhbmNlbGxlZApgYGAKCkZpbmFsIHN0YXR1c2VzIHNheSB3aGVyZSB0aGUgbW9uZXkgd2VudCwgbm90IHdobyBjbG9zZWQgdGhlIGVzY3JvdzsgdGhhdAppcyBpbiBgRXNjcm93OjpjbG9zZWRfYnlgIGFuZCBpbiB0aGUgZXZlbnQgbmFtZS4AAAAAAAAAAAZTdGF0dXMAAAAAAAcAAAAAAAAAI0FncmVlbWVudCBtYWRlLCBub3RoaW5nIGxvY2tlZCB5ZXQuAAAAAAdDcmVhdGVkAAAAAAAAAAAlVGhlIGFtb3VudCBpcyBsb2NrZWQgaW4gdGhlIGNvbnRyYWN0LgAAAAAAAAZGdW5kZWQAAAAAAAAAAABkTG9ja2VkLCBhbmQgdGhlIGFyYml0ZXIgbWF5IG5vdyBkaXZpZGUgaXQuIFBheWVyIGFuZCByZWNpcGllbnQgY2FuCnN0aWxsIGNvbmNlZGUgKHJlbGVhc2UgLyByZWZ1bmQpLgAAAAhEaXNwdXRlZAAAAAAAAAAvQWxsIG9mIHRoZSBhbW91bnQgd2VudCB0byB0aGUgcmVjaXBpZW50LiBGaW5hbC4AAAAACFJlbGVhc2VkAAAAAAAAADBBbGwgb2YgdGhlIGFtb3VudCB3ZW50IGJhY2sgdG8gdGhlIHBheWVyLiBGaW5hbC4AAAAIUmVmdW5kZWQAAAAAAAAAQFRoZSBhcmJpdGVyIGRpdmlkZWQgdGhlIGFtb3VudDsgYm90aCBzaWRlcyBnb3Qgc29tZXRoaW5nLiBGaW5hbC4AAAAFU3BsaXQAAAAAAAAAAAAAMkNsb3NlZCBiZWZvcmUgaXQgd2FzIGZ1bmRlZC4gTm90aGluZyBtb3ZlZC4gRmluYWwuAAAAAAAJQ2FuY2VsbGVkAAAA", "AAAAAgAAAD5XaGljaCBzaWRlIG9mIGFuIGVzY3JvdyBhbiBhZGRyZXNzIGlzIG9uLCBmb3IgdGhlIHBhcnR5IGluZGV4LgAAAAAAAAAAAAlQYXJ0eVJvbGUAAAAAAAADAAAAAAAAAAAAAAAFUGF5ZXIAAAAAAAAAAAAAAAAAAAlSZWNpcGllbnQAAAAAAAAAAAAAAAAAAAdBcmJpdGVyAA==", "AAAAAQAAAIhXaGF0IHJlYWQgY2FsbHMgcmV0dXJuOiB0aGUgc3RvcmVkIGVzY3JvdyBwbHVzIHdoZXRoZXIgaXRzIGRlYWRsaW5lIGhhcwpwYXNzZWQgKGBub3cgPj0gZGVhZGxpbmVgKSwgc28gdGhlIFVJIG5lZWRzIG5vIGNsb2NrIG9mIGl0cyBvd24uAAAAAAAAAApFc2Nyb3dWaWV3AAAAAAACAAAAAAAAAA9kZWFkbGluZV9wYXNzZWQAAAAAAQAAAAAAAAAGZXNjcm93AAAAAAfQAAAABkVzY3JvdwAA", "AAAAAQAAADFFdmVyeXRoaW5nIHRoZSB3ZWIgYXBwIGhlYWRlciBuZWVkcywgaW4gb25lIHJlYWQuAAAAAAAAAAAAAAxDb250cmFjdEluZm8AAAANAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAADGVzY3Jvd19jb3VudAAAAAYAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAANcGVuZGluZ19hZG1pbgAAAAAAA+gAAAATAAAAAAAAABNwZW5kaW5nX3VwZ3JhZGVfZXRhAAAAA+gAAAAGAAAAAAAAABpwZW5kaW5nX3VwZ3JhZGVfZXhwaXJlc19hdAAAAAAD6AAAAAYAAAEvVGhlIHByb3Bvc2VkIHVwZ3JhZGUncyB3YXNtIGhhc2ggYW5kIGBldGFgLCBmbGF0dGVuZWQgZnJvbQpgcGVuZGluZ191cGdyYWRlKClgIChhbiBgT3B0aW9uYCBvZiBhIHN0cnVjdCBjYW4ndCBiZSBhIGZpZWxkIGhlcmUpLgpTaG93IHRoZW0gcHJvbWluZW50bHk6IGJlZm9yZSBgZXRhYCBlaXRoZXIgcGFydHkgY2FuIHN0aWxsIG1vdmUgZWFjaAplc2Nyb3cncyBmdW5kcyBvdXQgb2YgdGhlIG5ldyBjb2RlJ3MgcmVhY2ggKHRvIHRoZSBjb3VudGVycGFydHksIG9yCmJhY2sgdG8gdGhlIHBheWVyIGFmdGVyIHRoZSBkZWFkbGluZSkuAAAAABRwZW5kaW5nX3VwZ3JhZGVfaGFzaAAAA+gAAAPuAAAAIAAAAAAAAAAPc3RvcmFnZV92ZXJzaW9uAAAAAAQAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAMdG90YWxfbG9ja2VkAAAACwAAAAAAAAANdXBncmFkZV9kZWxheQAAAAAAAAYAAAAAAAAAD3VwZ3JhZGVzX2xvY2tlZAAAAAABAAAAAAAAAAd2ZXJzaW9uAAAAAAQ=", "AAAAAQAAAMJBbiB1cGdyYWRlIHRoZSBhZG1pbiBoYXMgcHJvcG9zZWQuIGB1cGdyYWRlYCBjYW4gaW5zdGFsbCBgd2FzbV9oYXNoYApmcm9tIGBldGFgIChgcHJvcG9zZWRfYXQgKyB1cGdyYWRlX2RlbGF5YCkgdW50aWwgYGV4cGlyZXNfYXRgCihgZXRhICsgVVBHUkFERV9XSU5ET1dgKTsgYWZ0ZXIgdGhhdCBpdCBtdXN0IGJlIHByb3Bvc2VkIGFnYWluLgAAAAAAAAAAAA5QZW5kaW5nVXBncmFkZQAAAAAABAAAAAAAAAADZXRhAAAAAAYAAAAAAAAACmV4cGlyZXNfYXQAAAAAAAYAAAAAAAAAC3Byb3Bvc2VkX2F0AAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg", "AAAABAAAAU5Db250cmFjdCBlcnJvciBjb2Rlcy4gU3RhYmxlOiBuZXZlciByZW51bWJlciBvciByZXVzZSBhIGNvZGUuCgpDb2RlcyBzdGFydCBhdCAxMDAgc28gdGhleSBuZXZlciBjb2xsaWRlIHdpdGggdGhlIFN0ZWxsYXIgQXNzZXQgQ29udHJhY3Qncwpvd24gY29kZXMgKDHigJMxMyksIHdoaWNoIHJlYWNoIHRoZSBjYWxsZXIgdW5jaGFuZ2VkIHdoZW4gYSB0cmFuc2ZlciBmYWlscy4KClVuYXV0aG9yaXplZCBjYWxsZXJzIG5ldmVyIHJlYWNoIHRoZXNlOiBgcmVxdWlyZV9hdXRoKClgIGZhaWxzIGZpcnN0IGFuZAp0aGUgdHJhbnNhY3Rpb24gYWJvcnRzIHdpdGggYSBob3N0IGF1dGggZXJyb3IuAAAAAAAAAAAABUVycm9yAAAAAAAAHQAAABdObyBlc2Nyb3cgd2l0aCB0aGlzIGlkLgAAAAAITm90Rm91bmQAAABkAAAAhFRoZSBlc2Nyb3cncyBzdGF0dXMgZG9lcyBub3QgYWxsb3cgdGhpcyBhY3Rpb24uIEV2ZXJ5IGR1cGxpY2F0ZQooc2Vjb25kIGZ1bmQsIHNlY29uZCByZWxlYXNlLCBhY3Rpbmcgb24gYSBjbG9zZWQgZXNjcm93KSBsYW5kcyBoZXJlLgAAAA1JbnZhbGlkU3RhdHVzAAAAAAAAZQAAAC1gZnVuZGAgb3IgYGRpc3B1dGVgIGF0IG9yIGFmdGVyIHRoZSBkZWFkbGluZS4AAAAAAAAORGVhZGxpbmVQYXNzZWQAAAAAAGYAAAAeYHJlY2xhaW1gIGJlZm9yZSB0aGUgZGVhZGxpbmUuAAAAAAASRGVhZGxpbmVOb3RSZWFjaGVkAAAAAABnAAAAP2BkaXNwdXRlYCBvciBgcmVzb2x2ZWAgb24gYW4gZXNjcm93IGNyZWF0ZWQgd2l0aG91dCBhbiBhcmJpdGVyLgAAAAAJTm9BcmJpdGVyAAAAAAAAaAAAAERgZGlzcHV0ZWAgYnkgYW4gYWRkcmVzcyB0aGF0IGlzIG5laXRoZXIgdGhlIHBheWVyIG5vciB0aGUgcmVjaXBpZW50LgAAAAhOb3RQYXJ0eQAAAGkAAAA0YHJlc29sdmVgIHdpdGggYHJlY2lwaWVudF9hbW91bnQgPCAwYCBvciBgPiBhbW91bnRgLgAAAAxJbnZhbGlkU3BsaXQAAABqAAAARVRoZSBjb250cmFjdCdzIGJhbGFuY2UgZGlkIG5vdCBncm93IGJ5IGV4YWN0bHkgYGFtb3VudGAgd2hlbiBmdW5kaW5nLgAAAAAAABBUcmFuc2Zlck1pc21hdGNoAAAAawAAACFBbW91bnQgbXVzdCBiZSBncmVhdGVyIHRoYW4gemVyby4AAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAHgAAAAwUGF5ZXIgYW5kIHJlY2lwaWVudCBtdXN0IGJlIGRpZmZlcmVudCBhZGRyZXNzZXMuAAAACVNhbWVQYXJ0eQAAAAAAAHkAAAA4VGhlIGFyYml0ZXIgbXVzdCBiZSBuZWl0aGVyIHRoZSBwYXllciBub3IgdGhlIHJlY2lwaWVudC4AAAAOSW52YWxpZEFyYml0ZXIAAAAAAHoAAAAxVGhlIHBheWVyLCByZWNpcGllbnQgb3IgYXJiaXRlciBpcyB0aGlzIGNvbnRyYWN0LgAAAAAAAAxJbnZhbGlkUGFydHkAAAB7AAAALURlYWRsaW5lIG11c3QgYmUgaW4gdGhlIGZ1dHVyZSB3aGVuIGNyZWF0aW5nLgAAAAAAAA5EZWFkbGluZUluUGFzdAAAAAAAfAAAACREZWFkbGluZSBpcyBtb3JlIHRoYW4gMzY1IGRheXMgYXdheS4AAAAORGVhZGxpbmVUb29GYXIAAAAAAH0AAAAeVGl0bGUgaXMgbG9uZ2VyIHRoYW4gNjQgYnl0ZXMuAAAAAAAMVGl0bGVUb29Mb25nAAAAfgAAAC1gZ2V0X2VzY3Jvd3NgIHdhcyBhc2tlZCBmb3IgbW9yZSB0aGFuIDIwIGlkcy4AAAAAAAANQmF0Y2hUb29MYXJnZQAAAAAAAH8AAABSVGl0bGUgaXMgbm90IHZhbGlkIFVURi04LCBvciBjb250YWlucyBhbiBBU0NJSSBjb250cm9sIGJ5dGUKKGJlbG93IDB4MjAsIG9yIDB4N0YpLgAAAAAADEludmFsaWRUaXRsZQAAAIAAAAAjTmV3IGVzY3Jvd3MgYW5kIGZ1bmRpbmcgYXJlIHBhdXNlZC4AAAAABlBhdXNlZAAAAAAAjAAAAEZUaGUgc3RvcmVkIGRhdGEgaXMgbm90IGluIHRoZSBsYXlvdXQgdGhpcyBjb2RlIGV4cGVjdHM7IHJ1biBgbWlncmF0ZWAuAAAAAAARTWlncmF0aW9uUmVxdWlyZWQAAAAAAACNAAAANWBtaWdyYXRlYCB3YXMgY2FsbGVkIGJ1dCB0aGUgZGF0YSBpcyBhbHJlYWR5IGN1cnJlbnQuAAAAAAAAEE5vdGhpbmdUb01pZ3JhdGUAAACOAAAARkNoZWNrZWQgYXJpdGhtZXRpYyBvdmVyZmxvd2VkIChpZCBjb3VudGVyLCB0b3RhbCBsb2NrZWQsIGluZGV4IGNvdW50KS4AAAAAAAhPdmVyZmxvdwAAAI8AAAA6YGxvY2tfdXBncmFkZXNgIGhhcyBydW4sIHNvIHRoZSBjb2RlIGNhbiBubyBsb25nZXIgY2hhbmdlLgAAAAAADlVwZ3JhZGVzTG9ja2VkAAAAAADIAAAAQWBhY2NlcHRfYWRtaW5gIG9yIGBjYW5jZWxfYWRtaW5fcHJvcG9zYWxgIHdpdGggbm8gYWRtaW4gcHJvcG9zZWQuAAAAAAAADk5vUGVuZGluZ0FkbWluAAAAAADJAAAAY1VwZ3JhZGUgZGVsYXkgb3V0c2lkZSBgTUlOX1VQR1JBREVfREVMQVkuLj1NQVhfVVBHUkFERV9ERUxBWWAKKGNvbnN0cnVjdG9yIG9yIGBzZXRfdXBncmFkZV9kZWxheWApLgAAAAATSW52YWxpZFVwZ3JhZGVEZWxheQAAAADKAAAAN2B1cGdyYWRlYCBvciBgY2FuY2VsX3VwZ3JhZGVgIHdpdGggbm8gdXBncmFkZSBwcm9wb3NlZC4AAAAAEE5vUGVuZGluZ1VwZ3JhZGUAAADLAAAAJmB1cGdyYWRlYCBiZWZvcmUgdGhlIHByb3Bvc2FsJ3MgYGV0YWAuAAAAAAAPVXBncmFkZVRvb0Vhcmx5AAAAAMwAAAAsYHNldF91cGdyYWRlX2RlbGF5YCBiZWxvdyB0aGUgY3VycmVudCBkZWxheS4AAAAUVXBncmFkZURlbGF5RGVjcmVhc2UAAADNAAAARWB1cGdyYWRlKGV4cGVjdGVkX3dhc21faGFzaClgIHdpdGggYSBoYXNoIG90aGVyIHRoYW4gdGhlIHBlbmRpbmcgb25lLgAAAAAAABNVcGdyYWRlSGFzaE1pc21hdGNoAAAAAM4AAAA+YHVwZ3JhZGVgIGFmdGVyIHRoZSBwcm9wb3NhbCdzIGBleHBpcmVzX2F0YDogcHJvcG9zZSBpdCBhZ2Fpbi4AAAAAAA5VcGdyYWRlRXhwaXJlZAAAAAAAzw==", "AAAABQAAAEBUb3BpY3M6IGAoInNpc29ua2UiLCAiaW5pdCIpYC4gRW1pdHRlZCBvbmNlLCBieSB0aGUgY29uc3RydWN0b3IuAAAAAAAAAARJbml0AAAAAgAAAAdzaXNvbmtlAAAAAARpbml0AAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAAAAAAHdmVyc2lvbgAAAAAEAAAAAAAAAAAAAAANdXBncmFkZV9kZWxheQAAAAAAAAYAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAABkZ1bmRlZAAAAAAAAgAAAAdzaXNvbmtlAAAAAAZmdW5kZWQAAAAAAAMAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=", "AAAABQAAACBUb3BpY3M6IGAoInNpc29ua2UiLCAicGF1c2VkIilgLgAAAAAAAAAGUGF1c2VkAAAAAAACAAAAB3Npc29ua2UAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAGcGF1c2VkAAAAAAABAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAB0NyZWF0ZWQAAAAAAgAAAAdzaXNvbmtlAAAAAAdjcmVhdGVkAAAAAAkAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAAAAAAJcmVjaXBpZW50AAAAAAAAEwAAAAAAAAAAAAAAB2FyYml0ZXIAAAAD6AAAABMAAAAAAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAAAAAAAV0aXRsZQAAAAAAABAAAAAAAAAAAAAAAAp0ZXJtc19oYXNoAAAAAAPoAAAD7gAAACAAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAACERpc3B1dGVkAAAAAgAAAAdzaXNvbmtlAAAAAAhkaXNwdXRlZAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAQAAABtUaGUgcGF5ZXIgb3IgdGhlIHJlY2lwaWVudC4AAAAAAmJ5AAAAAAATAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAACFJlZnVuZGVkAAAAAgAAAAdzaXNvbmtlAAAAAAhyZWZ1bmRlZAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAA5UaGUgcmVjaXBpZW50LgAAAAAAAmJ5AAAAAAATAAAAAAAAAAAAAAAFcGF5ZXIAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAgAAAAdzaXNvbmtlAAAAAAhyZWxlYXNlZAAAAAQAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAApUaGUgcGF5ZXIuAAAAAAACYnkAAAAAABMAAAAAAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAACFJlc29sdmVkAAAAAgAAAAdzaXNvbmtlAAAAAAhyZXNvbHZlZAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAHYXJiaXRlcgAAAAATAAAAAAAAAAAAAAAQcmVjaXBpZW50X2Ftb3VudAAAAAsAAAAAAAAAAAAAAAxwYXllcl9hbW91bnQAAAALAAAAAAAAACJgUmVsZWFzZWRgLCBgUmVmdW5kZWRgIG9yIGBTcGxpdGAuAAAAAAAGc3RhdHVzAAAAAAfQAAAABlN0YXR1cwAAAAAAAAAAAAI=", "AAAABQAAAD5UaGUgY29kZSBpcyBiZWluZyByZXBsYWNlZC4gVG9waWNzOiBgKCJzaXNvbmtlIiwgInVwZ3JhZGVkIilgLgAAAAAAAAAAAAhVcGdyYWRlZAAAAAIAAAAHc2lzb25rZQAAAAAIdXBncmFkZWQAAAACAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAL1ZlcnNpb24gb2YgdGhlIGNvZGUgdGhhdCBwZXJmb3JtZWQgdGhlIHVwZ3JhZGUuAAAAAAxmcm9tX3ZlcnNpb24AAAAEAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAACUNhbmNlbGxlZAAAAAAAAAIAAAAHc2lzb25rZQAAAAAJY2FuY2VsbGVkAAAAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAABAAAAAAAAAAVwYXllcgAAAAAAABMAAAAAAAAAAg==", "AAAABQAAADdUaGUgcGF5ZXIgdG9vayB0aGUgZnVuZHMgYmFjayBhdCBvciBhZnRlciB0aGUgZGVhZGxpbmUuAAAAAAAAAAAJUmVjbGFpbWVkAAAAAAAAAgAAAAdzaXNvbmtlAAAAAAlyZWNsYWltZWQAAAAAAAADAAAAAAAAAAJpZAAAAAAABgAAAAEAAAAAAAAABXBheWVyAAAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAC", "AAAABQAAADJUb3BpY3M6IGAoInNpc29ua2UiLCAiYWRtaW5fY2hhbmdlZCIsIG5ld19hZG1pbilgLgAAAAAAAAAAAAxBZG1pbkNoYW5nZWQAAAACAAAAB3Npc29ua2UAAAAADWFkbWluX2NoYW5nZWQAAAAAAAACAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAAAAAAAAOcHJldmlvdXNfYWRtaW4AAAAAABMAAAAAAAAAAg==", "AAAABQAAAD9Ub3BpY3M6IGAoInNpc29ua2UiLCAiYWRtaW5fcHJvcG9zZWQiLCBuZXdfYWRtaW4pYC4gRGF0YTogYFtdYC4AAAAAAAAAAA1BZG1pblByb3Bvc2VkAAAAAAAAAgAAAAdzaXNvbmtlAAAAAA5hZG1pbl9wcm9wb3NlZAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAAB", "AAAABQAAAFxVcGdyYWRlcyBhcmUgbm93IHBlcm1hbmVudGx5IGRpc2FibGVkLiBUb3BpY3M6IGAoInNpc29ua2UiLCAidXBncmFkZXNfbG9ja2VkIilgLgpEYXRhOiBgW11gLgAAAAAAAAAOVXBncmFkZXNMb2NrZWQAAAAAAAIAAAAHc2lzb25rZQAAAAAPdXBncmFkZXNfbG9ja2VkAAAAAAAAAAAB", "AAAABQAAAQlBbiB1cGdyYWRlIHdhcyBwcm9wb3NlZDsgaXQgY2FuIHJ1biBmcm9tIGBldGFgLiBUb3BpY3M6CmAoInNpc29ua2UiLCAidXBncmFkZV9wcm9wb3NlZCIpYC4gVGhlIHdlYiBhcHAgc2hvdWxkIHNob3cgdGhpcyBhcyBhCmJhbm5lcjogdW50aWwgYGV0YWAsIGVpdGhlciBwYXJ0eSBvZiBhbiBlc2Nyb3cgY2FuIHN0aWxsIG1vdmUgaXRzIGZ1bmRzCm91dCBvZiB0aGUgbmV3IGNvZGUncyByZWFjaCAoZG9jcy9DT05UUkFDVC5tZCwgdHJ1c3QgYXNzdW1wdGlvbiAjMSkuAAAAAAAAAAAAAA9VcGdyYWRlUHJvcG9zZWQAAAAAAgAAAAdzaXNvbmtlAAAAABB1cGdyYWRlX3Byb3Bvc2VkAAAABAAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAAAAAALcHJvcG9zZWRfYXQAAAAABgAAAAAAAAAAAAAAA2V0YQAAAAAGAAAAAAAAAAAAAAAKZXhwaXJlc19hdAAAAAAABgAAAAAAAAAC", "AAAABQAAANNBIHBlbmRpbmcgdXBncmFkZSB3YXMgd2l0aGRyYXduOiBgY2FuY2VsX3VwZ3JhZGVgLCBgbG9ja191cGdyYWRlc2AsIGFuCmFkbWluIGhhbmRvdmVyLCBvciBhIG5ldyBwcm9wb3NhbCByZXBsYWNpbmcgaXQgKGVtaXR0ZWQganVzdCBiZWZvcmUgdGhlCm5ldyBgdXBncmFkZV9wcm9wb3NlZGApLiBUb3BpY3M6IGAoInNpc29ua2UiLCAidXBncmFkZV9jYW5jZWxsZWQiKWAuAAAAAAAAAAAQVXBncmFkZUNhbmNlbGxlZAAAAAIAAAAHc2lzb25rZQAAAAARdXBncmFkZV9jYW5jZWxsZWQAAAAAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAC", "AAAABQAAAC9Ub3BpY3M6IGAoInNpc29ua2UiLCAidXBncmFkZV9kZWxheV9jaGFuZ2VkIilgLgAAAAAAAAAAE1VwZ3JhZGVEZWxheUNoYW5nZWQAAAAAAgAAAAdzaXNvbmtlAAAAABV1cGdyYWRlX2RlbGF5X2NoYW5nZWQAAAAAAAADAAAAAAAAAAhwcmV2aW91cwAAAAYAAAAAAAAAAAAAAAVkZWxheQAAAAAAAAYAAAAAAAAAeVRoZSBwZW5kaW5nIHByb3Bvc2FsJ3MgYGV0YWAgYWZ0ZXIgdGhlIGNoYW5nZSAocHVzaGVkIG91dCBpZiB0aGUgbmV3CmRlbGF5IHJlcXVpcmVzIGl0KSwgb3IgYE5vbmVgIGlmIG5vdGhpbmcgaXMgcGVuZGluZy4AAAAAAAALcGVuZGluZ19ldGEAAAAD6AAAAAYAAAAAAAAAAg==", "AAAABQAAAD5Ub3BpY3M6IGAoInNpc29ua2UiLCAiYWRtaW5fcHJvcG9zYWxfY2FuY2VsbGVkIilgLiBEYXRhOiBgW11gLgAAAAAAAAAAABZBZG1pblByb3Bvc2FsQ2FuY2VsbGVkAAAAAAACAAAAB3Npc29ua2UAAAAAGGFkbWluX3Byb3Bvc2FsX2NhbmNlbGxlZAAAAAAAAAAB"]),
      options
    );
  }

   static deploy<T = Client>(args: { admin: string | Address; token: string | Address; upgrade_delay: bigint }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(args, options);
  }
  public readonly fromJson = {
    fund : this.txFromJson<Result<null, Error>>,  info : this.txFromJson<ContractInfo>,  admin : this.txFromJson<string>,  token : this.txFromJson<string>,  cancel : this.txFromJson<Result<null, Error>>,  create : this.txFromJson<Result<bigint, Error>>,  refund : this.txFromJson<Result<null, Error>>,  dispute : this.txFromJson<Result<null, Error>>,  migrate : this.txFromJson<Result<null, Error>>,  reclaim : this.txFromJson<Result<null, Error>>,  release : this.txFromJson<Result<null, Error>>,  resolve : this.txFromJson<Result<null, Error>>,  upgrade : this.txFromJson<Result<null, Error>>,  version : this.txFromJson<number>,  is_paused : this.txFromJson<boolean>,  get_escrow : this.txFromJson<Result<EscrowView, Error>>,  set_paused : this.txFromJson<Result<null, Error>>,  get_escrows : this.txFromJson<Result<Array<EscrowView>, Error>>,  accept_admin : this.txFromJson<Result<null, Error>>,  escrow_count : this.txFromJson<bigint>,  total_locked : this.txFromJson<bigint>,  lock_upgrades : this.txFromJson<Result<null, Error>>,  pending_admin : this.txFromJson<string | null>,  propose_admin : this.txFromJson<Result<null, Error>>,  upgrade_delay : this.txFromJson<bigint>,  cancel_upgrade : this.txFromJson<Result<null, Error>>,  create_and_fund : this.txFromJson<Result<bigint, Error>>,  pending_upgrade : this.txFromJson<PendingUpgrade | null>,  propose_upgrade : this.txFromJson<Result<null, Error>>,  storage_version : this.txFromJson<number>,  extend_index_ttl : this.txFromJson<Result<null, Error>>,  party_escrow_ids : this.txFromJson<Array<bigint>>,  upgrades_enabled : this.txFromJson<boolean>,  extend_escrow_ttl : this.txFromJson<Result<null, Error>>,  set_upgrade_delay : this.txFromJson<Result<null, Error>>,  party_escrow_count : this.txFromJson<number>,  cancel_admin_proposal : this.txFromJson<Result<null, Error>>
  };

  /** @deprecated Use fromJson instead. */
  public readonly fromJSON = this.fromJson;

  /**
   * Parse a raw contract event (topics + data) into a typed {@link ContractEvent}.
   */
  parseEvent(topics: xdr.ScVal[] | string[], data: xdr.ScVal | string): ContractEvent | undefined {
    return this.spec.parseEvent(topics, data) as ContractEvent | undefined;
  }
  /**
   * Build a topics filter row for the "Init" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  initEventFilter(): string[] {
    return this.spec.eventTopicFilter("Init");
  }
  /**
   * Build a topics filter row for the "Funded" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  fundedEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Funded", topicValues);
  }
  /**
   * Build a topics filter row for the "Paused" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  pausedEventFilter(): string[] {
    return this.spec.eventTopicFilter("Paused");
  }
  /**
   * Build a topics filter row for the "Created" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  createdEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Created", topicValues);
  }
  /**
   * Build a topics filter row for the "Disputed" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  disputedEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Disputed", topicValues);
  }
  /**
   * Build a topics filter row for the "Refunded" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  refundedEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Refunded", topicValues);
  }
  /**
   * Build a topics filter row for the "Released" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  releasedEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Released", topicValues);
  }
  /**
   * Build a topics filter row for the "Resolved" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  resolvedEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Resolved", topicValues);
  }
  /**
   * Build a topics filter row for the "Upgraded" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradedEventFilter(): string[] {
    return this.spec.eventTopicFilter("Upgraded");
  }
  /**
   * Build a topics filter row for the "Cancelled" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  cancelledEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Cancelled", topicValues);
  }
  /**
   * Build a topics filter row for the "Reclaimed" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  reclaimedEventFilter(topicValues?: { id?: bigint }): string[] {
    return this.spec.eventTopicFilter("Reclaimed", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminChanged" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminChangedEventFilter(topicValues?: { new_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminChanged", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminProposed" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminProposedEventFilter(topicValues?: { new_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminProposed", topicValues);
  }
  /**
   * Build a topics filter row for the "UpgradesLocked" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradesLockedEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradesLocked");
  }
  /**
   * Build a topics filter row for the "UpgradeProposed" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeProposedEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeProposed");
  }
  /**
   * Build a topics filter row for the "UpgradeCancelled" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeCancelledEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeCancelled");
  }
  /**
   * Build a topics filter row for the "UpgradeDelayChanged" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeDelayChangedEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeDelayChanged");
  }
  /**
   * Build a topics filter row for the "AdminProposalCancelled" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminProposalCancelledEventFilter(): string[] {
    return this.spec.eventTopicFilter("AdminProposalCancelled");
  }
}