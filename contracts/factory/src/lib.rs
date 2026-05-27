// SPDX-License-Identifier: Apache-2.0 AND MIT
// Portions of this file are adapted primarily from verified Solidity source:
// - https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code
// Related project (different Solana implementation):
// - https://github.com/withbridge/bridge-cards
// Copyright (c) 2025 Bridge Ventures
// Modifications Copyright (c) 2026 Stellar Development Foundation

#![no_std]
#![allow(clippy::too_many_arguments)]

mod events;
mod pausable;
mod storage;
#[cfg(test)]
mod test;
mod velocity;

use crate::events::{
    ContractUpgraded, DebitorUpdated, DestinationUpdated, IssuerCreated, IssuerUpgraded,
    ManagedUpdated, OwnerUpdated, PauserUpdated, TransferExecuted, UserVelocityUpdated,
};
use pausable::{require_not_paused, Pausable};
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error, vec,
    xdr::ToXdr, Address, BytesN, Env,
};
use storage::{
    authorized_debitor, is_allowed_destination, issuer_address, issuer_manager, issuer_wasm_hash,
    owner, pauser, remove_allowed_destination, remove_authorized_debitor, set_allowed_destination,
    set_authorized_debitor, set_issuer_address, set_issuer_manager, set_issuer_wasm_hash,
    set_paused, user_velocity,
};
use velocity::{
    set_user_velocity_limits, validate_and_update_user_velocity, validate_velocity_config,
};

#[contract]
pub struct Factory;

#[contractclient(name = "IssuerClient")]
pub trait IssuerContract {
    fn transfer_to_destination(
        env: Env,
        token: Address,
        account: Address,
        destination: Address,
        amount: i128,
    );
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>);
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum FactoryError {
    /// The debitor is not authorized for the issuer.
    DebitorNotAuthorized = 0,
    /// The destination is not allowlisted for the issuer.
    NotAuthorizedDestination = 1,
    /// Velocity configuration is invalid.
    InvalidVelocityConfig = 2,
    /// Transfer amount is invalid.
    InvalidTransferAmount = 3,
    /// Transfer exceeds per-transaction spend limit.
    PerTransactionSpendLimitExceeded = 4,
    /// Transfer exceeds rolling period spend limit.
    PeriodSpendLimitExceeded = 5,
    /// More than one transfer was attempted in the same ledger for this user scope.
    OneTransferPerLedger = 6,
    /// Issuer for the `(issuer_id, token)` pair does not exist.
    IssuerNotFound = 7,
    /// Issuer manager for `issuer_id` does not exist.
    IssuerManagerNotFound = 8,
    /// Issuer for the `(issuer_id, token)` pair already exists.
    IssuerAlreadyExists = 9,
    /// Operation requires the contract to be unpaused.
    EnforcedPause = 1000,
    /// Operation requires the contract to be paused.
    ExpectedPause = 1001,
}

#[contracttype]
#[derive(Clone, Default)]
pub struct UserVelocity {
    /// Rolling period length in seconds.
    pub period_duration_seconds: u64,
    /// Maximum spend allowed during a rolling period.
    pub period_spend_limit: i128,
    /// Maximum spend allowed per transfer.
    pub per_transaction_spend_limit: i128,
    /// Amount spent in the current period.
    pub period_spent: i128,
    /// Ledger timestamp when the period was last reset.
    pub period_last_reset_timestamp: u64,
    /// Most recent ledger sequence where a transfer was recorded.
    pub ledger_last_spent: u32,
    /// Whether any spend has occurred in the current period.
    pub has_spent: bool,
}

#[contractimpl]
impl Factory {
    /// Initializes contract roles and issuer deployment configuration.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `owner` - Address authorized for owner-only operations.
    /// * `pauser` - Address authorized to pause and unpause the contract.
    /// * `issuer_wasm_hash` - Wasm hash used when deploying issuer contracts.
    ///
    /// # Authorization
    /// No runtime authorization check. This entrypoint is only callable at contract initialization.
    pub fn __constructor(env: Env, owner: Address, pauser: Address, issuer_wasm_hash: BytesN<32>) {
        storage::set_owner(&env, &owner);
        storage::set_pauser(&env, &pauser);
        set_paused(&env, false);
        set_issuer_wasm_hash(&env, &issuer_wasm_hash);
    }

    /// Deploys an issuer contract for `issuer_id` and configures its initial manager and destination.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier used for per-issuer state.
    /// * `token` - Token address associated with this issuer deployment.
    /// * `manager` - Initial manager for issuer-scoped operations.
    /// * `destination` - Initial allowed destination for transfers.
    ///
    /// # Authorization
    /// Requires owner authorization and a non-paused contract state.
    ///
    /// # Returns
    /// The deployed issuer contract address.
    pub fn create_issuer(
        env: Env,
        issuer_id: BytesN<32>,
        token: Address,
        manager: Address,
        destination: Address,
    ) -> Address {
        require_not_paused(&env);
        owner(&env).require_auth();

        if issuer_address(&env, &issuer_id, &token).is_some() {
            panic_with_error!(&env, FactoryError::IssuerAlreadyExists);
        }

        let issuer_hash = issuer_wasm_hash(&env);
        let salt = env.crypto().sha256(&(&issuer_id, &token).to_xdr(&env));
        let deployed_issuer_address = env
            .deployer()
            .with_current_contract(salt)
            .deploy_v2(issuer_hash, vec![&env, env.current_contract_address()]);

        set_allowed_destination(&env, &issuer_id, &destination);
        set_issuer_manager(&env, &issuer_id, &manager);
        set_issuer_address(&env, &issuer_id, &token, &deployed_issuer_address);

        IssuerCreated {
            issuer_id,
            issuer: deployed_issuer_address.clone(),
            manager,
            destination,
        }
        .publish(&env);

        deployed_issuer_address
    }

    /// Returns the issuer contract address for an `(issuer_id, token)` pair.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier.
    /// * `token` - Token address associated with the issuer contract.
    ///
    /// # Returns
    /// The issuer contract address stored for this `(issuer_id, token)` pair.
    pub fn get_issuer_address(env: Env, issuer_id: BytesN<32>, token: Address) -> Address {
        let Some(address) = issuer_address(&env, &issuer_id, &token) else {
            panic_with_error!(&env, FactoryError::IssuerNotFound);
        };
        address
    }

    /// Checks whether `debitor` is authorized for `issuer_id`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier.
    /// * `debitor` - Debitor address to check.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// `true` if the debitor is authorized for this issuer, otherwise `false`.
    pub fn is_authorized_debitor(env: Env, issuer_id: BytesN<32>, debitor: Address) -> bool {
        authorized_debitor(&env, &issuer_id, &debitor)
    }

    /// Checks whether `manager` is the configured manager for `issuer_id`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier.
    /// * `manager` - Manager address to check.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// `true` if `manager` is currently authorized for this issuer, otherwise `false`.
    pub fn is_authorized_manager(env: Env, issuer_id: BytesN<32>, manager: Address) -> bool {
        issuer_manager(&env, &issuer_id).is_some_and(|stored_manager| stored_manager == manager)
    }

    /// Checks whether `destination` is allowlisted for `issuer_id`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier.
    /// * `destination` - Destination address to check.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// `true` if the destination is authorized for this issuer, otherwise `false`.
    pub fn is_authorized_destination(
        env: Env,
        issuer_id: BytesN<32>,
        destination: Address,
    ) -> bool {
        is_allowed_destination(&env, &issuer_id, &destination)
    }

    /// Returns velocity limits and spend tracking for `user` under an issuer/token scope.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier.
    /// * `token` - Token address.
    /// * `user` - User address.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// Current `UserVelocity` state for this `(issuer_id, token, user)` scope.
    pub fn get_user_velocity(
        env: Env,
        issuer_id: BytesN<32>,
        token: Address,
        user: Address,
    ) -> UserVelocity {
        user_velocity(&env, &issuer_id, &token, &user)
    }

    /// Updates whether `destination` is allowed for `issuer_id`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier to update.
    /// * `destination` - Destination address being modified.
    /// * `allowed` - If `true`, add destination to allowlist; if `false`, remove it.
    ///
    /// # Authorization
    /// Requires owner authorization and a non-paused contract state.
    pub fn update_issuer_destination(
        env: Env,
        issuer_id: BytesN<32>,
        destination: Address,
        allowed: bool,
    ) {
        require_not_paused(&env);
        owner(&env).require_auth();

        if allowed {
            set_allowed_destination(&env, &issuer_id, &destination);
        } else {
            remove_allowed_destination(&env, &issuer_id, &destination);
        }

        DestinationUpdated {
            issuer_id,
            destination,
            allowed,
        }
        .publish(&env);
    }

    /// Transfers `amount` from `account` to `destination` through the issuer contract.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier whose policy applies to this transfer.
    /// * `token` - Token address being transferred.
    /// * `debitor` - Authorized debitor that signs this request.
    /// * `account` - Debited account used as the token source.
    /// * `amount` - Transfer amount.
    /// * `destination` - Destination address that must be allowlisted.
    /// * `uuid` - Offchain transfer correlation identifier emitted in events.
    ///
    /// # Authorization
    /// Requires a non-paused contract state and authentication for an authorized debitor.
    pub fn transfer_to_destination(
        env: Env,
        issuer_id: BytesN<32>,
        token: Address,
        debitor: Address,
        account: Address,
        amount: i128,
        destination: Address,
        uuid: BytesN<32>,
    ) {
        require_not_paused(&env);

        if !authorized_debitor(&env, &issuer_id, &debitor) {
            panic_with_error!(&env, FactoryError::DebitorNotAuthorized);
        }
        debitor.require_auth();
        if !is_allowed_destination(&env, &issuer_id, &destination) {
            panic_with_error!(&env, FactoryError::NotAuthorizedDestination);
        }
        validate_and_update_user_velocity(&env, &issuer_id, &token, &account, amount);

        let Some(issuer_contract_address) = issuer_address(&env, &issuer_id, &token) else {
            panic_with_error!(&env, FactoryError::IssuerNotFound);
        };
        let issuer = IssuerClient::new(&env, &issuer_contract_address);

        issuer.transfer_to_destination(&token, &account, &destination, &amount);

        TransferExecuted {
            uuid,
            account,
            destination,
            token,
            amount,
        }
        .publish(&env);
    }

    /// Updates whether `debitor` is authorized for `issuer_id`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier to update.
    /// * `debitor` - Debitor address being modified.
    /// * `authorized` - If `true`, authorize debitor; if `false`, revoke authorization.
    ///
    /// # Authorization
    /// Requires issuer-manager authorization and a non-paused contract state.
    pub fn update_authorized_debitor(
        env: Env,
        issuer_id: BytesN<32>,
        debitor: Address,
        authorized: bool,
    ) {
        require_not_paused(&env);
        let Some(manager) = issuer_manager(&env, &issuer_id) else {
            panic_with_error!(&env, FactoryError::IssuerManagerNotFound);
        };
        manager.require_auth();

        if authorized {
            set_authorized_debitor(&env, &issuer_id, &debitor);
        } else {
            remove_authorized_debitor(&env, &issuer_id, &debitor);
        }

        DebitorUpdated {
            issuer_id,
            debitor,
            authorized,
        }
        .publish(&env);
    }

    /// Rotates the manager for `issuer_id`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier to update.
    /// * `manager` - New manager address for issuer-scoped operations.
    ///
    /// # Authorization
    /// Requires owner authorization and a non-paused contract state.
    pub fn set_authorized_manager(env: Env, issuer_id: BytesN<32>, manager: Address) {
        require_not_paused(&env);
        owner(&env).require_auth();

        let Some(old_manager) = issuer_manager(&env, &issuer_id) else {
            panic_with_error!(&env, FactoryError::IssuerManagerNotFound);
        };
        set_issuer_manager(&env, &issuer_id, &manager);

        ManagedUpdated {
            issuer_id,
            old_manager,
            manager,
        }
        .publish(&env);
    }

    /// Sets velocity limits for `user` under `issuer_id` and `token`.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier whose limits are being configured.
    /// * `token` - Token address for the velocity configuration scope.
    /// * `user` - User address whose velocity is configured.
    /// * `period_duration_seconds` - Rolling period length in seconds.
    /// * `period_spend_limit` - Maximum spend allowed per period.
    /// * `per_transaction_spend_limit` - Maximum spend per transfer.
    ///
    /// # Authorization
    /// Requires issuer-manager authorization and a non-paused contract state.
    pub fn update_user_velocity(
        env: Env,
        issuer_id: BytesN<32>,
        token: Address,
        user: Address,
        period_duration_seconds: u64,
        period_spend_limit: i128,
        per_transaction_spend_limit: i128,
    ) {
        require_not_paused(&env);
        let Some(manager) = issuer_manager(&env, &issuer_id) else {
            panic_with_error!(&env, FactoryError::IssuerManagerNotFound);
        };
        manager.require_auth();
        validate_velocity_config(
            &env,
            period_duration_seconds,
            period_spend_limit,
            per_transaction_spend_limit,
        );

        set_user_velocity_limits(
            &env,
            &issuer_id,
            &token,
            &user,
            period_duration_seconds,
            period_spend_limit,
            per_transaction_spend_limit,
        );

        UserVelocityUpdated {
            issuer_id,
            token,
            user,
            period_duration_seconds,
            period_spend_limit,
            per_transaction_spend_limit,
        }
        .publish(&env);
    }

    /// Returns the current owner address.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// The current owner address.
    pub fn get_owner(env: Env) -> Address {
        owner(&env)
    }

    /// Returns the current pauser address.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// The current pauser address.
    pub fn get_pauser(env: Env) -> Address {
        pauser(&env)
    }

    /// Transfers ownership to a new address.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `new_owner` - Address to receive ownership.
    ///
    /// # Authorization
    /// Requires authorization from both the current owner and the new owner.
    /// The new-owner co-signature prevents accidental loss of ownership to an
    /// unreachable address. Not gated by pause state.
    pub fn set_owner(env: Env, new_owner: Address) {
        let current_owner = owner(&env);
        current_owner.require_auth();
        new_owner.require_auth();

        storage::set_owner(&env, &new_owner);

        OwnerUpdated {
            old_owner: current_owner,
            new_owner,
        }
        .publish(&env);
    }

    /// Owner-driven pauser rotation. Bypasses the pause guard to recover from a compromised pauser.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `new_pauser` - Address to receive the pauser role.
    ///
    /// # Authorization
    /// Requires authorization from the current owner. Not gated by pause state.
    pub fn set_pauser_by_owner(env: Env, new_pauser: Address) {
        owner(&env).require_auth();

        let old_pauser = pauser(&env);
        storage::set_pauser(&env, &new_pauser);

        PauserUpdated {
            old_pauser,
            new_pauser,
        }
        .publish(&env);
    }

    /// Transfers the pauser role to a new address via the pauser self-rotation path.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `new_pauser` - Address to receive the pauser role.
    ///
    /// # Authorization
    /// Requires authorization from the current pauser and a non-paused contract state.
    pub fn set_pauser_by_pauser(env: Env, new_pauser: Address) {
        require_not_paused(&env);
        let old_pauser = pauser(&env);
        old_pauser.require_auth();

        storage::set_pauser(&env, &new_pauser);

        PauserUpdated {
            old_pauser,
            new_pauser,
        }
        .publish(&env);
    }

    /// Replaces the factory contract's WASM bytecode.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `new_wasm_hash` - Hash of the uploaded WASM to install.
    ///
    /// # Authorization
    /// Requires authorization from the current owner. Not gated by pause state.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        owner(&env).require_auth();

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        ContractUpgraded { new_wasm_hash }.publish(&env);
    }

    /// Upgrades an issuer contract's WASM bytecode.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    /// * `issuer_id` - Issuer identifier.
    /// * `token` - Token address associated with the issuer.
    /// * `new_wasm_hash` - Hash of the uploaded WASM to install on the issuer.
    ///
    /// # Authorization
    /// Requires authorization from the current owner. Not gated by pause state.
    pub fn upgrade_issuer(
        env: Env,
        issuer_id: BytesN<32>,
        token: Address,
        new_wasm_hash: BytesN<32>,
    ) {
        owner(&env).require_auth();

        let Some(issuer_contract_address) = issuer_address(&env, &issuer_id, &token) else {
            panic_with_error!(&env, FactoryError::IssuerNotFound);
        };

        let issuer = IssuerClient::new(&env, &issuer_contract_address);
        issuer.upgrade(&new_wasm_hash);

        IssuerUpgraded {
            issuer_id,
            token,
            new_wasm_hash,
        }
        .publish(&env);
    }
}

#[contractimpl]
impl Pausable for Factory {
    /// Returns `true` when the contract is paused.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    ///
    /// # Authorization
    /// No authorization required.
    ///
    /// # Returns
    /// `true` if paused, otherwise `false`.
    fn paused(env: Env) -> bool {
        pausable::paused(&env)
    }

    /// Pauses the contract.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    ///
    /// # Authorization
    /// Requires authorization from the configured pauser.
    fn pause(env: Env) {
        pauser(&env).require_auth();
        pausable::pause(&env);
    }

    /// Unpauses the contract.
    ///
    /// # Arguments
    /// * `env` - Contract environment.
    ///
    /// # Authorization
    /// Requires authorization from the configured pauser.
    fn unpause(env: Env) {
        pauser(&env).require_auth();
        pausable::unpause(&env);
    }
}
