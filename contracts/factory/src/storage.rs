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

/// Number of ledgers in one day, assuming 5-second ledger close times.
const DAY_IN_LEDGERS: u32 = 17_280;

/// Re-extend an entry's TTL only once fewer than this many ledgers (~30 days)
/// remain. Because extension is skipped while the TTL is still above this
/// threshold, the rent cost is amortized: steady-state calls that touch an
/// already-extended entry pay nothing.
const TTL_EXTEND_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;

/// Extends the TTL of the contract's instance and code entries to the network
/// maximum once it falls below [`TTL_EXTEND_THRESHOLD`]. Called from every
/// state-mutating entrypoint so routine operation keeps the contract alive.
///
/// `instance().extend_ttl` extends the instance entry **and** the contract code
/// entry together; an archived code entry halts the contract just as hard as an
/// archived instance entry, so both must be kept alive.
pub fn extend_instance_ttl(env: &Env) {
    let max_ttl = env.storage().max_ttl();
    env.storage()
        .instance()
        .extend_ttl(TTL_EXTEND_THRESHOLD, max_ttl);
}

/// Extends a persistent entry's TTL to the network maximum once it falls below
/// [`TTL_EXTEND_THRESHOLD`], so every access keeps the entry alive. No-op when
/// the entry does not exist: extending an absent key traps, and read paths
/// (membership probes, defaulting velocity reads) legitimately miss.
///
/// The target is `max_ttl()` read at call time (the network maximum, ~180 days
/// on mainnet) to maximize idle runway for write-once routing/authorization
/// entries and to track any change to the network cap.
fn extend_persistent_ttl(env: &Env, key: &PersistentKey) {
    if env.storage().persistent().has(key) {
        let max_ttl = env.storage().max_ttl();
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_EXTEND_THRESHOLD, max_ttl);
    }
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
    extend_persistent_ttl(env, &key);
}

pub fn remove_allowed_destination(env: &Env, issuer_id: &BytesN<32>, destination: &Address) {
    let key = PersistentKey::AllowedDestination(issuer_id.clone(), destination.clone());
    env.storage().persistent().remove(&key);
}

pub fn is_allowed_destination(env: &Env, issuer_id: &BytesN<32>, destination: &Address) -> bool {
    let key = PersistentKey::AllowedDestination(issuer_id.clone(), destination.clone());
    extend_persistent_ttl(env, &key);
    env.storage().persistent().has(&key)
}

pub fn set_issuer_manager(env: &Env, issuer_id: &BytesN<32>, manager: &Address) {
    let key = PersistentKey::IssuerManager(issuer_id.clone());
    env.storage().persistent().set(&key, manager);
    extend_persistent_ttl(env, &key);
}

pub fn issuer_manager(env: &Env, issuer_id: &BytesN<32>) -> Option<Address> {
    let key = PersistentKey::IssuerManager(issuer_id.clone());
    extend_persistent_ttl(env, &key);
    env.storage().persistent().get(&key)
}

pub fn set_issuer_address(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    issuer_address: &Address,
) {
    let key = PersistentKey::IssuerAddress(issuer_id.clone(), token.clone());
    env.storage().persistent().set(&key, issuer_address);
    extend_persistent_ttl(env, &key);
}

pub fn issuer_address(env: &Env, issuer_id: &BytesN<32>, token: &Address) -> Option<Address> {
    let key = PersistentKey::IssuerAddress(issuer_id.clone(), token.clone());
    extend_persistent_ttl(env, &key);
    env.storage().persistent().get(&key)
}

// Debitor authorization
pub fn authorized_debitor(env: &Env, issuer_id: &BytesN<32>, debitor: &Address) -> bool {
    let key = PersistentKey::AuthorizedDebitor(issuer_id.clone(), debitor.clone());
    extend_persistent_ttl(env, &key);
    env.storage().persistent().has(&key)
}

pub fn set_authorized_debitor(env: &Env, issuer_id: &BytesN<32>, debitor: &Address) {
    let key = PersistentKey::AuthorizedDebitor(issuer_id.clone(), debitor.clone());
    env.storage().persistent().set(&key, &());
    extend_persistent_ttl(env, &key);
}

pub fn remove_authorized_debitor(env: &Env, issuer_id: &BytesN<32>, debitor: &Address) {
    let key = PersistentKey::AuthorizedDebitor(issuer_id.clone(), debitor.clone());
    env.storage().persistent().remove(&key);
}

// User velocity state
pub fn user_velocity(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    user: &Address,
) -> UserVelocity {
    let key = PersistentKey::UserVelocity(issuer_id.clone(), token.clone(), user.clone());
    extend_persistent_ttl(env, &key);
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
    extend_persistent_ttl(env, &key);
}
