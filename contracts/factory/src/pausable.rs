// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Stellar Development Foundation

//! Pause-state helpers shared by contract entrypoints.

use soroban_sdk::{panic_with_error, Env};

use crate::{
    storage::{is_paused, set_paused},
    FactoryError,
};

pub trait Pausable {
    /// Returns whether the contract is currently paused.
    fn paused(env: Env) -> bool;
    /// Pauses contract execution for guarded entrypoints.
    fn pause(env: Env);
    /// Resumes contract execution for guarded entrypoints.
    fn unpause(env: Env);
}

pub fn paused(env: &Env) -> bool {
    is_paused(env)
}

pub fn require_not_paused(env: &Env) {
    if paused(env) {
        panic_with_error!(env, FactoryError::EnforcedPause);
    }
}

pub fn require_paused(env: &Env) {
    if !paused(env) {
        panic_with_error!(env, FactoryError::ExpectedPause);
    }
}

pub fn pause(env: &Env) {
    require_not_paused(env);
    set_paused(env, true);
}

pub fn unpause(env: &Env) {
    require_paused(env);
    set_paused(env, false);
}
