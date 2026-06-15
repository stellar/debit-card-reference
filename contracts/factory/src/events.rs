// SPDX-License-Identifier: Apache-2.0 AND MIT
// Portions of this file are adapted primarily from verified Solidity source:
// - https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code
// Related project (different Solana implementation):
// - https://github.com/withbridge/bridge-cards
// Copyright (c) 2025 Bridge Ventures
// Modifications Copyright (c) 2026 Stellar Development Foundation

//! Contract events emitted by the factory.

use soroban_sdk::{contractevent, Address, BytesN};

#[contractevent]
#[derive(Clone)]
pub struct Paused {
    /// Pauser address that paused the contract.
    #[topic]
    pub pauser: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct Unpaused {
    /// Pauser address that unpaused the contract.
    #[topic]
    pub pauser: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct IssuerCreated {
    /// Issuer identifier.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// Token address associated with this issuer deployment (the unique
    /// `(issuer_id, token)` key).
    #[topic]
    pub token: Address,
    /// Deployed issuer contract address.
    pub issuer: Address,
    /// Initial issuer manager.
    pub manager: Address,
    /// Initial allowlisted destination.
    pub destination: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct TransferExecuted {
    /// Offchain transfer correlation identifier.
    #[topic]
    pub uuid: BytesN<32>,
    /// Issuer identifier whose policy scoped this transfer.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// Debited source account.
    #[topic]
    pub account: Address,
    /// Authorized debitor that signed this transfer.
    pub debitor: Address,
    /// Credited destination account.
    pub destination: Address,
    /// Token contract address.
    pub token: Address,
    /// Transfer amount.
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct DestinationUpdated {
    /// Issuer identifier.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// Destination address updated in the allowlist.
    #[topic]
    pub destination: Address,
    /// `true` when added, `false` when removed.
    pub allowed: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct DebitorUpdated {
    /// Issuer identifier.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// Debitor address that was updated.
    #[topic]
    pub debitor: Address,
    /// `true` when authorized, `false` when revoked.
    pub authorized: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct ManagedUpdated {
    /// Issuer identifier.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// New manager address.
    #[topic]
    pub manager: Address,
    /// Previous manager address.
    pub old_manager: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct UserVelocityUpdated {
    /// Issuer identifier.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// Token address for velocity scope.
    #[topic]
    pub token: Address,
    /// User address for velocity scope.
    #[topic]
    pub user: Address,
    /// Rolling period length in seconds.
    pub period_duration_seconds: u64,
    /// Max spend in a rolling period.
    pub period_spend_limit: i128,
    /// Max spend per transaction.
    pub per_transaction_spend_limit: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct OwnerUpdated {
    /// New owner address.
    #[topic]
    pub new_owner: Address,
    /// Previous owner address.
    pub old_owner: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PauserUpdated {
    /// New pauser address.
    #[topic]
    pub new_pauser: Address,
    /// Previous pauser address.
    pub old_pauser: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ContractUpgraded {
    /// New WASM hash applied to the contract.
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct IssuerUpgraded {
    /// Issuer identifier.
    #[topic]
    pub issuer_id: BytesN<32>,
    /// Token address associated with the issuer.
    pub token: Address,
    /// New WASM hash applied to the issuer contract.
    pub new_wasm_hash: BytesN<32>,
}
