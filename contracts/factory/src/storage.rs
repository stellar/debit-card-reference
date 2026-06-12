// SPDX-License-Identifier: Apache-2.0 AND MIT
// Portions of this file are adapted primarily from verified Solidity source:
// - https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code
// Related project (different Solana implementation):
// - https://github.com/withbridge/bridge-cards
// Copyright (c) 2025 Bridge Ventures
// Modifications Copyright (c) 2026 Stellar Development Foundation

//! Storage schema and accessors for factory contract state.

use soroban_sdk::{contracttype, Address, BytesN, Env};

use crate::UserVelocity;

/// Instance-storage keys for global contract configuration.
#[contracttype]
pub enum ConfigKey {
    /// Contract owner address.
    Owner,
    /// Address authorized to pause and unpause the contract.
    Pauser,
    /// Global pause flag.
    Paused,
    /// Wasm hash used when deploying issuer contracts.
    IssuerWasmHash,
}

/// Persistent-storage keys for issuer-scoped and user-scoped state.
#[contracttype]
pub enum PersistentKey {
    /// Destination allowlist membership for a given issuer.
    ///
    /// Tuple fields:
    /// 1. `issuer_id`
    /// 2. `destination`
    AllowedDestination(BytesN<32>, Address),
    /// Manager address for a given issuer.
    ///
    /// Tuple fields:
    /// 1. `issuer_id`
    IssuerManager(BytesN<32>),
    /// Issuer contract address for a given issuer and token pair.
    ///
    /// Tuple fields:
    /// 1. `issuer_id`
    /// 2. `token`
    IssuerAddress(BytesN<32>, Address),
    /// Debitor authorization membership for a given issuer.
    ///
    /// Tuple fields:
    /// 1. `issuer_id`
    /// 2. `debitor`
    AuthorizedDebitor(BytesN<32>, Address),
    /// Velocity state for a given issuer, token, and user tuple.
    ///
    /// Tuple fields:
    /// 1. `issuer_id`
    /// 2. `token`
    /// 3. `user`
    UserVelocity(BytesN<32>, Address, Address),
}

/// Number of ledgers a consumed transfer `uuid` is retained for deduplication
/// (~7 days at 5 second ledgers). Must cover the offchain processor's maximum
/// retry window: once the entry expires, the same `uuid` is accepted again.
pub const TRANSFER_UUID_TTL_LEDGERS: u32 = 120_960;

/// Temporary-storage keys for short-lived deduplication state.
#[contracttype]
pub enum TemporaryKey {
    /// Consumed transfer uuid marker for a given issuer and token pair.
    ///
    /// Tuple fields:
    /// 1. `issuer_id`
    /// 2. `token`
    /// 3. `uuid`
    UsedTransferUuid(BytesN<32>, Address, BytesN<32>),
}

// Global config
pub fn set_owner(env: &Env, owner: &Address) {
    env.storage().instance().set(&ConfigKey::Owner, owner);
}

pub fn owner(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&ConfigKey::Owner)
        .expect("owner not set")
}

pub fn set_pauser(env: &Env, pauser: &Address) {
    env.storage().instance().set(&ConfigKey::Pauser, pauser);
}

pub fn pauser(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&ConfigKey::Pauser)
        .expect("pauser not set")
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&ConfigKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&ConfigKey::Paused)
        .unwrap_or(false)
}

pub fn set_issuer_wasm_hash(env: &Env, issuer_wasm_hash: &BytesN<32>) {
    env.storage()
        .instance()
        .set(&ConfigKey::IssuerWasmHash, issuer_wasm_hash);
}

pub fn issuer_wasm_hash(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&ConfigKey::IssuerWasmHash)
        .expect("issuer wasm hash not set")
}

// Issuer-scoped policy
pub fn set_allowed_destination(env: &Env, issuer_id: &BytesN<32>, destination: &Address) {
    let key = PersistentKey::AllowedDestination(issuer_id.clone(), destination.clone());
    env.storage().persistent().set(&key, &());
}

pub fn remove_allowed_destination(env: &Env, issuer_id: &BytesN<32>, destination: &Address) {
    let key = PersistentKey::AllowedDestination(issuer_id.clone(), destination.clone());
    env.storage().persistent().remove(&key);
}

pub fn is_allowed_destination(env: &Env, issuer_id: &BytesN<32>, destination: &Address) -> bool {
    let key = PersistentKey::AllowedDestination(issuer_id.clone(), destination.clone());
    env.storage().persistent().has(&key)
}

pub fn set_issuer_manager(env: &Env, issuer_id: &BytesN<32>, manager: &Address) {
    let key = PersistentKey::IssuerManager(issuer_id.clone());
    env.storage().persistent().set(&key, manager);
}

pub fn issuer_manager(env: &Env, issuer_id: &BytesN<32>) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&PersistentKey::IssuerManager(issuer_id.clone()))
}

pub fn set_issuer_address(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    issuer_address: &Address,
) {
    let key = PersistentKey::IssuerAddress(issuer_id.clone(), token.clone());
    env.storage().persistent().set(&key, issuer_address);
}

pub fn issuer_address(env: &Env, issuer_id: &BytesN<32>, token: &Address) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&PersistentKey::IssuerAddress(
            issuer_id.clone(),
            token.clone(),
        ))
}

// Debitor authorization
pub fn authorized_debitor(env: &Env, issuer_id: &BytesN<32>, debitor: &Address) -> bool {
    let key = PersistentKey::AuthorizedDebitor(issuer_id.clone(), debitor.clone());
    env.storage().persistent().has(&key)
}

pub fn set_authorized_debitor(env: &Env, issuer_id: &BytesN<32>, debitor: &Address) {
    let key = PersistentKey::AuthorizedDebitor(issuer_id.clone(), debitor.clone());
    env.storage().persistent().set(&key, &());
}

pub fn remove_authorized_debitor(env: &Env, issuer_id: &BytesN<32>, debitor: &Address) {
    let key = PersistentKey::AuthorizedDebitor(issuer_id.clone(), debitor.clone());
    env.storage().persistent().remove(&key);
}

// Transfer uuid deduplication
pub fn is_transfer_uuid_used(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    uuid: &BytesN<32>,
) -> bool {
    let key = TemporaryKey::UsedTransferUuid(issuer_id.clone(), token.clone(), uuid.clone());
    env.storage().temporary().has(&key)
}

pub fn mark_transfer_uuid_used(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    uuid: &BytesN<32>,
) {
    let key = TemporaryKey::UsedTransferUuid(issuer_id.clone(), token.clone(), uuid.clone());
    env.storage().temporary().set(&key, &());
    env.storage().temporary().extend_ttl(
        &key,
        TRANSFER_UUID_TTL_LEDGERS,
        TRANSFER_UUID_TTL_LEDGERS,
    );
}

// User velocity state
pub fn user_velocity(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    user: &Address,
) -> UserVelocity {
    let key = PersistentKey::UserVelocity(issuer_id.clone(), token.clone(), user.clone());
    env.storage().persistent().get(&key).unwrap_or_default()
}

pub fn set_user_velocity(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    user: &Address,
    velocity: &UserVelocity,
) {
    let key = PersistentKey::UserVelocity(issuer_id.clone(), token.clone(), user.clone());
    env.storage().persistent().set(&key, &velocity);
}
