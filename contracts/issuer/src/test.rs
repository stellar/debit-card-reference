// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Stellar Development Foundation

extern crate std;

use super::{Issuer, IssuerClient};
use soroban_sdk::testutils::storage::Instance as _;
use soroban_sdk::testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::IntoVal;
use soroban_sdk::{Address, Env};

#[test]
fn transfer_to_destination_rejects_direct_non_factory_call() {
    let env = Env::default();
    let factory = Address::generate(&env);
    let issuer_address = env.register(Issuer, (factory,));
    let issuer = IssuerClient::new(&env, &issuer_address);

    // Direct external invocation should fail because issuer requires factory auth.
    let result = issuer.try_transfer_to_destination(
        &Address::generate(&env),
        &Address::generate(&env),
        &Address::generate(&env),
        &1i128,
    );

    assert!(result.is_err());
}

#[test]
fn transfer_to_destination_succeeds_with_factory_auth() {
    let env = Env::default();
    env.mock_all_auths();
    let factory = Address::generate(&env);
    let issuer_address = env.register(Issuer, (factory.clone(),));
    let issuer = IssuerClient::new(&env, &issuer_address);

    let token_admin_address = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin_address);
    let token_address = sac.address();
    let token = TokenClient::new(&env, &token_address);
    let token_admin = StellarAssetClient::new(&env, &token_address);

    let user_account = Address::generate(&env);
    let destination = Address::generate(&env);
    token_admin.mint(&user_account, &1_000);
    token.approve(
        &user_account,
        &issuer_address,
        &1_000,
        &(env.ledger().sequence() + 1000),
    );

    issuer
        .mock_auths(&[MockAuth {
            address: &factory,
            invoke: &MockAuthInvoke {
                contract: &issuer_address,
                fn_name: "transfer_to_destination",
                args: (&token_address, &user_account, &destination, &100i128).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .transfer_to_destination(&token_address, &user_account, &destination, &100);

    assert_eq!(token.balance(&user_account), 900);
    assert_eq!(token.balance(&destination), 100);
}

// --- FIND-002: storage TTL management ---

#[test]
fn issuer_keeps_instance_ttl_extended() {
    let env = Env::default();
    env.mock_all_auths();
    let factory = Address::generate(&env);
    let issuer_address = env.register(Issuer, (factory,));
    let issuer = IssuerClient::new(&env, &issuer_address);
    let max_ttl = env.as_contract(&issuer_address, || env.storage().max_ttl());

    // The constructor extends the fresh instance entry (created with the
    // network minimum TTL, 4096 in the test env) to the network maximum.
    let constructed_ttl = env.as_contract(&issuer_address, || env.storage().instance().get_ttl());
    assert_eq!(constructed_ttl, max_ttl);

    // Decay below the ~30-day extension threshold, then verify a transfer
    // extends the instance entry back to the maximum.
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 5_900_000);

    let token_admin_address = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin_address);
    let token_address = sac.address();
    let token_admin = StellarAssetClient::new(&env, &token_address);
    let user_account = Address::generate(&env);
    let destination = Address::generate(&env);
    token_admin.mint(&user_account, &1_000);
    TokenClient::new(&env, &token_address).approve(
        &user_account,
        &issuer_address,
        &1_000,
        &(env.ledger().sequence() + 1000),
    );

    issuer.transfer_to_destination(&token_address, &user_account, &destination, &100);

    let refreshed_ttl = env.as_contract(&issuer_address, || env.storage().instance().get_ttl());
    assert_eq!(refreshed_ttl, max_ttl);
}
