// SPDX-License-Identifier: Apache-2.0 AND MIT
// Portions of this file are adapted primarily from verified Solidity source:
// - https://worldscan.org/address/0x6b0d105999491a48d5793fb6cb54f5ce079e0da9#code
// Related project (different Solana implementation):
// - https://github.com/withbridge/bridge-cards
// Copyright (c) 2025 Bridge Ventures
// Modifications Copyright (c) 2026 Stellar Development Foundation

//! Velocity validation and state transition logic.

use soroban_sdk::{panic_with_error, Address, BytesN, Env};

use crate::{
    storage::{set_user_velocity, user_velocity},
    FactoryError,
};

pub fn validate_velocity_config(
    env: &Env,
    period_duration_seconds: u64,
    period_spend_limit: i128,
    per_transaction_spend_limit: i128,
) {
    if period_duration_seconds == 0 || period_spend_limit < 0 || per_transaction_spend_limit < 0 {
        panic_with_error!(env, FactoryError::InvalidVelocityConfig);
    }
}

pub fn set_user_velocity_limits(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    user: &Address,
    period_duration_seconds: u64,
    period_spend_limit: i128,
    per_transaction_spend_limit: i128,
) {
    let mut velocity = user_velocity(env, issuer_id, token, user);
    velocity.period_duration_seconds = period_duration_seconds;
    velocity.period_spend_limit = period_spend_limit;
    velocity.per_transaction_spend_limit = per_transaction_spend_limit;
    set_user_velocity(env, issuer_id, token, user, &velocity);
}

pub fn validate_and_update_user_velocity(
    env: &Env,
    issuer_id: &BytesN<32>,
    token: &Address,
    user: &Address,
    amount: i128,
) {
    if amount <= 0 {
        panic_with_error!(env, FactoryError::InvalidTransferAmount);
    }

    let mut velocity = user_velocity(env, issuer_id, token, user);

    let now = env.ledger().timestamp();
    // Reset period accounting once the rolling window elapsed.
    if now.saturating_sub(velocity.period_last_reset_timestamp) >= velocity.period_duration_seconds
    {
        velocity.period_spent = 0;
        velocity.period_last_reset_timestamp = now;
        velocity.has_spent = false;
    }

    if amount > velocity.per_transaction_spend_limit {
        panic_with_error!(env, FactoryError::PerTransactionSpendLimitExceeded);
    }

    let Some(next_spent) = velocity.period_spent.checked_add(amount) else {
        panic_with_error!(env, FactoryError::PeriodSpendLimitExceeded);
    };
    if next_spent > velocity.period_spend_limit {
        panic_with_error!(env, FactoryError::PeriodSpendLimitExceeded);
    }

    let current_ledger = env.ledger().sequence();
    // Restrict to one successful spend per ledger for the same velocity scope.
    if velocity.has_spent && current_ledger == velocity.ledger_last_spent {
        panic_with_error!(env, FactoryError::OneTransferPerLedger);
    }

    velocity.period_spent = next_spent;
    velocity.ledger_last_spent = current_ledger;
    velocity.has_spent = true;
    set_user_velocity(env, issuer_id, token, user, &velocity);
}
