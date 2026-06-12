// SPDX-License-Identifier: Apache-2.0 AND MIT
// Portions of this file are adapted primarily from verified Solidity source:
// - https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code
// Related project (different Solana implementation):
// - https://github.com/withbridge/bridge-cards
// Copyright (c) 2025 Bridge Ventures
// Modifications Copyright (c) 2026 Stellar Development Foundation

#![no_std]
//! Issuer contract that executes token transfers authorized by the factory.

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env};

#[contract]
pub struct Issuer;

/// Instance storage keys for the issuer contract.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Factory contract address authorized to trigger transfers.
    Factory,
}

/// Number of ledgers in one day, assuming 5-second ledger close times.
const DAY_IN_LEDGERS: u32 = 17_280;

/// Re-extend the instance/code TTL only once fewer than this many ledgers
/// (~30 days) remain, so steady-state use amortizes the rent cost.
const TTL_EXTEND_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;

/// Extends the TTL of this contract's instance and code entries to the network
/// maximum once it falls below [`TTL_EXTEND_THRESHOLD`], so every use keeps the
/// issuer alive. The issuer has no persistent entries; its only state, the
/// factory address, lives in instance storage and shares this entry's TTL.
fn extend_instance_ttl(env: &Env) {
    let max_ttl = env.storage().max_ttl();
    env.storage()
        .instance()
        .extend_ttl(TTL_EXTEND_THRESHOLD, max_ttl);
}

fn require_factory_auth(env: &Env) {
    let factory: Address = env
        .storage()
        .instance()
        .get(&DataKey::Factory)
        .expect("factory not set");
    factory.require_auth();
}

#[contractimpl]
impl Issuer {
    /// Initializes the issuer with the controlling factory address.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `factory` - Factory contract address allowed to authorize transfers.
    ///
    /// # Authorization
    /// No runtime authorization check. This entrypoint is only callable at contract initialization.
    pub fn __constructor(env: Env, factory: Address) {
        env.storage().instance().set(&DataKey::Factory, &factory);
        extend_instance_ttl(&env);
    }

    /// Transfers `amount` of `token` from `account` to `destination`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `token` - Token contract address.
    /// * `account` - Source account to debit.
    /// * `destination` - Recipient account.
    /// * `amount` - Amount to transfer.
    ///
    /// # Authorization
    /// Requires authorization from the stored factory address.
    pub fn transfer_to_destination(
        env: Env,
        token: Address,
        account: Address,
        destination: Address,
        amount: i128,
    ) {
        require_factory_auth(&env);
        extend_instance_ttl(&env);

        token::TokenClient::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &account,
            &destination,
            &amount,
        );
    }

    /// Replaces this contract's WASM bytecode in-place.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `new_wasm_hash` - Hash of the uploaded WASM to install.
    ///
    /// # Authorization
    /// Requires authorization from the stored factory address.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        require_factory_auth(&env);
        extend_instance_ttl(&env);

        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }
}
