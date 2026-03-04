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
pub struct IssuerCreated {
    /// Issuer identifier.
    pub issuer_id: BytesN<32>,
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
    pub uuid: BytesN<32>,
    /// Debited source account.
    pub account: Address,
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
    pub issuer_id: BytesN<32>,
    /// Destination address updated in the allowlist.
    pub destination: Address,
    /// `true` when added, `false` when removed.
    pub allowed: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct DebitorUpdated {
    /// Issuer identifier.
    pub issuer_id: BytesN<32>,
    /// Debitor address that was updated.
    pub debitor: Address,
    /// `true` when authorized, `false` when revoked.
    pub authorized: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct ManagedUpdated {
    /// Issuer identifier.
    pub issuer_id: BytesN<32>,
    /// Previous manager address.
    pub old_manager: Address,
    /// New manager address.
    pub manager: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct UserVelocityUpdated {
    /// Issuer identifier.
    pub issuer_id: BytesN<32>,
    /// Token address for velocity scope.
    pub token: Address,
    /// User address for velocity scope.
    pub user: Address,
    /// Rolling period length in seconds.
    pub period_duration_seconds: u64,
    /// Max spend in a rolling period.
    pub period_spend_limit: i128,
    /// Max spend per transaction.
    pub per_transaction_spend_limit: i128,
}
