/// Liber on-chain registry.
///
/// Registers a content reference (a Walrus blob address) as a real on-chain
/// object so that authorship, timestamp and license are independently
/// verifiable and not dependent on Liber's servers. Delivers:
///   1) 存证 / provenance  — an immutable Record with publisher + epoch + license
///   2) 真正的所有权        — the Record is *owned* by the publisher's address
///                           (transferable, composable by other packages)
///   3) 开放事件源          — every registration emits a `Registered` event, so
///                           anyone (incl. agents who don't trust our API) can
///                           build their own index from chain events.
///
/// High-value, low-frequency objects only (a book, a CC0 work, a shared
/// conversation). Comments / highlights / votes stay off-chain by design.
module liber::registry {
    use std::string::{Self, String};
    use sui::event;
    use sui::tx_context::sender;

    /// An on-chain record of a piece of CC0 content. `key` so it's an owned,
    /// transferable object (ownership lives with the publisher's wallet).
    public struct Record has key, store {
        id: UID,
        /// content address — typically a walrus:// blob id
        content_id: String,
        /// "book" | "work" | "conversation"
        kind: String,
        /// license identifier, e.g. "CC0-1.0"
        license: String,
        /// who registered it
        publisher: address,
        /// chain epoch at registration (coarse timestamp; verifiable on-chain)
        epoch: u64,
    }

    /// Emitted on every registration — the open event source for indexers/agents.
    public struct Registered has copy, drop {
        record_id: ID,
        content_id: String,
        kind: String,
        license: String,
        publisher: address,
        epoch: u64,
    }

    /// Register a content reference. Creates a `Record` owned by the caller and
    /// emits a `Registered` event. Called by Liber's backend signer today, but
    /// permissionless — any address can register its own content.
    public entry fun register(
        content_id: vector<u8>,
        kind: vector<u8>,
        license: vector<u8>,
        ctx: &mut TxContext,
    ) {
        let publisher = sender(ctx);
        let epoch = ctx.epoch();
        let record = Record {
            id: object::new(ctx),
            content_id: string::utf8(content_id),
            kind: string::utf8(kind),
            license: string::utf8(license),
            publisher,
            epoch,
        };
        event::emit(Registered {
            record_id: object::id(&record),
            content_id: record.content_id,
            kind: record.kind,
            license: record.license,
            publisher,
            epoch,
        });
        // hand ownership to the publisher's wallet
        transfer::transfer(record, publisher);
    }

    // ---- read-only accessors (for composing packages / tests) ----
    public fun content_id(r: &Record): String { r.content_id }
    public fun kind(r: &Record): String { r.kind }
    public fun license(r: &Record): String { r.license }
    public fun publisher(r: &Record): address { r.publisher }
    public fun epoch(r: &Record): u64 { r.epoch }
}
