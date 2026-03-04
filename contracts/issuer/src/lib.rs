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

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env};

#[contract]
pub struct Issuer;

/// Instance storage keys for the issuer contract.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Factory contract address authorized to trigger transfers.
    Factory,
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
        let factory: Address = env
            .storage()
            .instance()
            .get(&DataKey::Factory)
            .expect("factory not set");
        factory.require_auth();

        token::TokenClient::new(&env, &token).transfer_from(
            &env.current_contract_address(),
            &account,
            &destination,
            &amount,
        );
    }
}
