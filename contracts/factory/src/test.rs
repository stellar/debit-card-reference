// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Stellar Development Foundation

extern crate std;

use super::{
    events::{
        ContractUpgraded, IssuerCreated, IssuerUpgraded, ManagedUpdated, OwnerUpdated, Paused,
        PauserUpdated, TransferExecuted, Unpaused, UserVelocityUpdated,
    },
    storage::{set_user_velocity, PersistentKey},
    velocity::MIN_PERIOD_DURATION_SECONDS,
    Factory, FactoryClient, FactoryError, UserVelocity,
};
use proptest::prelude::*;
use rstest::rstest;
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _};
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{xdr::ToXdr, Address, BytesN, Env, Event, IntoVal};

mod issuer_contract_wasm {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/issuer.wasm");
}

const AMOUNT: i128 = 100;
const INITIAL_BALANCE: i128 = 1_000;

fn proptest_config() -> ProptestConfig {
    let cases = std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(32);

    ProptestConfig {
        cases,
        ..ProptestConfig::default()
    }
}

/// Shared test harness for factory tests.
struct TestContext {
    env: Env,
    issuer_id: BytesN<32>,
    factory_address: Address,
    issuer_address: Address,
    token_address: Address,
    owner: Address,
    pauser: Address,
    manager: Address,
    debitor: Address,
    user_account: Address,
    destination: Address,
}

fn upload_issuer_wasm(env: &Env) -> BytesN<32> {
    env.deployer()
        .upload_contract_wasm(issuer_contract_wasm::WASM)
}

fn rand_bytes(env: &Env) -> BytesN<32> {
    // Hack to generate random bytes without pulling in a crate
    env.crypto()
        .sha256(&Address::generate(env).to_xdr(env))
        .into()
}

impl TestContext {
    /// Builds a transfer-ready context for flow-oriented tests.
    ///
    /// This constructor:
    /// - enables `mock_all_auths` to reduce auth boilerplate in behavior tests;
    /// - deploys a factory + issuer + token pair;
    /// - optionally allowlists destination and authorizes debitor;
    /// - configures velocity and funds/approves the debited user account.
    ///
    /// Use this in tests that focus on transfer logic, pause behavior, and
    /// velocity rules rather than per-role auth verification.
    fn for_flow(allow_destination: bool, authorize_debitor: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let owner = Address::generate(&env);
        let pauser = Address::generate(&env);
        let manager = Address::generate(&env);
        let debitor = Address::generate(&env);
        let user_account = Address::generate(&env);
        let destination = Address::generate(&env);
        let issuer_id = rand_bytes(&env);

        let issuer_wasm_hash = upload_issuer_wasm(&env);
        let factory_address =
            env.register(Factory, (owner.clone(), pauser.clone(), issuer_wasm_hash));
        let factory = FactoryClient::new(&env, &factory_address);

        let token_admin_address = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin_address);
        let token_address = sac.address();
        let token = TokenClient::new(&env, &token_address);
        let token_admin = StellarAssetClient::new(&env, &token_address);

        let issuer_address =
            factory.create_issuer(&issuer_id, &token_address, &manager, &destination);
        factory.update_issuer_destination(&issuer_id, &destination, &allow_destination);
        factory.update_authorized_debitor(&issuer_id, &debitor, &authorize_debitor);
        factory.update_user_velocity(
            &issuer_id,
            &token_address,
            &user_account,
            &3600,
            &(INITIAL_BALANCE * 10),
            &(INITIAL_BALANCE * 10),
        );

        token_admin.mint(&user_account, &INITIAL_BALANCE);
        let expiration = env.ledger().sequence() + 1000;
        token.approve(
            &user_account,
            &issuer_address,
            &INITIAL_BALANCE,
            &expiration,
        );

        Self {
            env,
            issuer_id,
            factory_address,
            issuer_address,
            token_address,
            owner,
            pauser,
            manager,
            debitor,
            user_account,
            destination,
        }
    }

    /// Builds a role-focused context for authorization tests.
    ///
    /// This constructor:
    /// - keeps normal auth behavior (no `mock_all_auths`);
    /// - creates issuer and baseline role state via explicit `mock_auths`
    ///   invocations;
    /// - prepares owner/pauser/manager/debitor addresses for positive and
    ///   negative auth checks.
    ///
    /// Use this in tests that verify who is allowed to call each entrypoint.
    fn for_auth() -> Self {
        let env = Env::default();

        let owner = Address::generate(&env);
        let pauser = Address::generate(&env);
        let manager = Address::generate(&env);
        let debitor = Address::generate(&env);
        let user_account = Address::generate(&env);
        let destination = Address::generate(&env);
        let issuer_id = rand_bytes(&env);

        let issuer_wasm_hash = upload_issuer_wasm(&env);
        let factory_address =
            env.register(Factory, (owner.clone(), pauser.clone(), issuer_wasm_hash));
        let factory = FactoryClient::new(&env, &factory_address);
        let token_admin_address = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin_address);
        let token_address = sac.address();

        // Prepare manager + debitor/destination authorization state for auth checks.
        let issuer_address = factory
            .mock_auths(&[MockAuth {
                address: &owner,
                invoke: &MockAuthInvoke {
                    contract: &factory_address,
                    fn_name: "create_issuer",
                    args: (&issuer_id, &token_address, &manager, &destination).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .create_issuer(&issuer_id, &token_address, &manager, &destination);
        factory
            .mock_auths(&[MockAuth {
                address: &owner,
                invoke: &MockAuthInvoke {
                    contract: &factory_address,
                    fn_name: "update_issuer_destination",
                    args: (&issuer_id, &destination, &true).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .update_issuer_destination(&issuer_id, &destination, &true);
        factory
            .mock_auths(&[MockAuth {
                address: &manager,
                invoke: &MockAuthInvoke {
                    contract: &factory_address,
                    fn_name: "update_authorized_debitor",
                    args: (&issuer_id, &debitor, &true).into_val(&env),
                    sub_invokes: &[],
                },
            }])
            .update_authorized_debitor(&issuer_id, &debitor, &true);

        Self {
            env,
            issuer_id,
            factory_address,
            issuer_address,
            token_address,
            owner,
            pauser,
            manager,
            debitor,
            user_account,
            destination,
        }
    }
}

#[test]
fn factory_calls_issuer_end_to_end() {
    let env = Env::default();

    let owner = Address::generate(&env);
    let pauser = Address::generate(&env);
    let manager = Address::generate(&env);
    let debitor = Address::generate(&env);
    let user_account = Address::generate(&env);
    let destination = Address::generate(&env);
    let issuer_id = rand_bytes(&env);

    let issuer_wasm_hash = upload_issuer_wasm(&env);
    let factory_address = env.register(Factory, (owner.clone(), pauser, issuer_wasm_hash));
    let factory = FactoryClient::new(&env, &factory_address);

    let token_admin_address = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin_address.clone());
    let token_address = sac.address();
    let token = TokenClient::new(&env, &token_address);
    let token_admin = StellarAssetClient::new(&env, &token_address);

    let issuer_address = factory
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &factory_address,
                fn_name: "create_issuer",
                args: (&issuer_id, &token_address, &manager, &destination).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .create_issuer(&issuer_id, &token_address, &manager, &destination);

    factory
        .mock_auths(&[MockAuth {
            address: &manager,
            invoke: &MockAuthInvoke {
                contract: &factory_address,
                fn_name: "update_authorized_debitor",
                args: (&issuer_id, &debitor, &true).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .update_authorized_debitor(&issuer_id, &debitor, &true);

    factory
        .mock_auths(&[MockAuth {
            address: &manager,
            invoke: &MockAuthInvoke {
                contract: &factory_address,
                fn_name: "update_user_velocity",
                args: (
                    &issuer_id,
                    &token_address,
                    &user_account,
                    &3600u64,
                    &(INITIAL_BALANCE * 10),
                    &(INITIAL_BALANCE * 10),
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }])
        .update_user_velocity(
            &issuer_id,
            &token_address,
            &user_account,
            &3600,
            &(INITIAL_BALANCE * 10),
            &(INITIAL_BALANCE * 10),
        );

    token_admin
        .mock_all_auths()
        .mint(&user_account, &INITIAL_BALANCE);

    let expiration = env.ledger().sequence() + 1000;
    token.mock_all_auths().approve(
        &user_account,
        &issuer_address,
        &INITIAL_BALANCE,
        &expiration,
    );

    let transfer_uuid = rand_bytes(&env);
    factory
        .mock_auths(&[MockAuth {
            address: &debitor,
            invoke: &MockAuthInvoke {
                contract: &factory_address,
                fn_name: "transfer_to_destination",
                args: (
                    &issuer_id,
                    &token_address,
                    &debitor,
                    &user_account,
                    &AMOUNT,
                    &destination,
                    &transfer_uuid,
                )
                    .into_val(&env),
                sub_invokes: &[],
            },
        }])
        .transfer_to_destination(
            &issuer_id,
            &token_address,
            &debitor,
            &user_account,
            &AMOUNT,
            &destination,
            &transfer_uuid,
        );

    assert_eq!(token.balance(&user_account), INITIAL_BALANCE - AMOUNT);
    assert_eq!(token.balance(&destination), AMOUNT);
}

#[test]
fn get_issuer_address_returns_expected_values() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let loaded = factory.get_issuer_address(&setup.issuer_id, &setup.token_address);
    assert_eq!(loaded, setup.issuer_address);
}

#[test]
fn get_issuer_address_fails_for_unknown_issuer() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unknown_issuer = rand_bytes(&setup.env);
    let result = factory.try_get_issuer_address(&unknown_issuer, &setup.token_address);
    assert_eq!(result, Err(Ok(FactoryError::IssuerNotFound.into())));
}

#[test]
fn is_authorized_debitor_returns_expected_values() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unknown_debitor = Address::generate(&setup.env);
    assert!(factory.is_authorized_debitor(&setup.issuer_id, &setup.debitor));
    assert!(!factory.is_authorized_debitor(&setup.issuer_id, &unknown_debitor));
}

#[test]
fn is_authorized_manager_returns_expected_values() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unknown_manager = Address::generate(&setup.env);
    assert!(factory.is_authorized_manager(&setup.issuer_id, &setup.manager));
    assert!(!factory.is_authorized_manager(&setup.issuer_id, &unknown_manager));

    let unknown_issuer = rand_bytes(&setup.env);
    assert!(!factory.is_authorized_manager(&unknown_issuer, &setup.manager));
}

#[test]
fn is_authorized_destination_returns_expected_values() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unknown_destination = Address::generate(&setup.env);
    assert!(factory.is_authorized_destination(&setup.issuer_id, &setup.destination));
    assert!(!factory.is_authorized_destination(&setup.issuer_id, &unknown_destination));
}

#[test]
fn get_user_velocity_returns_expected_values() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let configured_velocity =
        factory.get_user_velocity(&setup.issuer_id, &setup.token_address, &setup.user_account);
    assert_eq!(configured_velocity.period_duration_seconds, 3600);
    assert_eq!(configured_velocity.period_spend_limit, INITIAL_BALANCE * 10);
    assert_eq!(
        configured_velocity.per_transaction_spend_limit,
        INITIAL_BALANCE * 10
    );
    assert_eq!(configured_velocity.period_spent, 0);
    assert_eq!(configured_velocity.period_last_reset_timestamp, 0);
    assert_eq!(configured_velocity.ledger_last_spent, 0);
    assert!(!configured_velocity.has_spent);

    let unknown_user = Address::generate(&setup.env);
    let default_velocity =
        factory.get_user_velocity(&setup.issuer_id, &setup.token_address, &unknown_user);
    assert_eq!(default_velocity.period_duration_seconds, 0);
    assert_eq!(default_velocity.period_spend_limit, 0);
    assert_eq!(default_velocity.per_transaction_spend_limit, 0);
    assert_eq!(default_velocity.period_spent, 0);
    assert_eq!(default_velocity.period_last_reset_timestamp, 0);
    assert_eq!(default_velocity.ledger_last_spent, 0);
    assert!(!default_velocity.has_spent);
}

#[test]
fn owner_auth_is_enforced_for_create_issuer() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let token_admin_address = Address::generate(&setup.env);
    let sac = setup
        .env
        .register_stellar_asset_contract_v2(token_admin_address);
    let another_token = sac.address();
    let owner_issuer_id = rand_bytes(&setup.env);
    let attacker_issuer_id = rand_bytes(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "create_issuer",
                args: (
                    &owner_issuer_id,
                    &another_token,
                    &setup.manager,
                    &setup.destination,
                )
                    .into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .create_issuer(
            &owner_issuer_id,
            &another_token,
            &setup.manager,
            &setup.destination,
        );

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "create_issuer",
                args: (
                    &attacker_issuer_id,
                    &another_token,
                    &setup.manager,
                    &setup.destination,
                )
                    .into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_create_issuer(
            &attacker_issuer_id,
            &another_token,
            &setup.manager,
            &setup.destination,
        );
    assert!(unauthorized.is_err());
}

#[test]
fn create_issuer_fails_for_duplicate_issuer_token_pair() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = factory.try_create_issuer(
        &setup.issuer_id,
        &setup.token_address,
        &setup.manager,
        &setup.destination,
    );

    assert_eq!(result, Err(Ok(FactoryError::IssuerAlreadyExists.into())));
}

#[rstest]
#[case(true, false, FactoryError::DebitorNotAuthorized)]
#[case(false, true, FactoryError::NotAuthorizedDestination)]
fn transfer_fails_when_prerequisites_are_missing(
    #[case] allow_destination: bool,
    #[case] authorize_debitor: bool,
    #[case] expected_error: FactoryError,
) {
    let setup = TestContext::for_flow(allow_destination, authorize_debitor);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = factory.try_transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &AMOUNT,
        &setup.destination,
        &rand_bytes(&setup.env),
    );
    assert_eq!(result, Err(Ok(expected_error.into())));
}

#[test]
fn owner_auth_is_enforced_for_update_issuer_destination() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let destination = Address::generate(&setup.env);
    let attacker_destination = Address::generate(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_issuer_destination",
                args: (&setup.issuer_id, &destination, &true).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .update_issuer_destination(&setup.issuer_id, &destination, &true);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_issuer_destination",
                args: (&setup.issuer_id, &attacker_destination, &false).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_update_issuer_destination(&setup.issuer_id, &attacker_destination, &false);
    assert!(unauthorized.is_err());
    assert!(factory.is_authorized_destination(&setup.issuer_id, &destination));
}

#[test]
fn manager_auth_is_enforced_for_update_authorized_debitor() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let another_debitor = Address::generate(&setup.env);
    let attacker_debitor = Address::generate(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.manager,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_authorized_debitor",
                args: (&setup.issuer_id, &another_debitor, &true).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .update_authorized_debitor(&setup.issuer_id, &another_debitor, &true);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_authorized_debitor",
                args: (&setup.issuer_id, &attacker_debitor, &false).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_update_authorized_debitor(&setup.issuer_id, &another_debitor, &false);
    assert!(unauthorized.is_err());
    assert!(factory.is_authorized_debitor(&setup.issuer_id, &another_debitor));
}

#[test]
fn update_issuer_destination_toggles_authorization_state() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    for allowed in [false, true] {
        factory
            .mock_auths(&[MockAuth {
                address: &setup.owner,
                invoke: &MockAuthInvoke {
                    contract: &setup.factory_address,
                    fn_name: "update_issuer_destination",
                    args: (&setup.issuer_id, &setup.destination, &allowed).into_val(&setup.env),
                    sub_invokes: &[],
                },
            }])
            .update_issuer_destination(&setup.issuer_id, &setup.destination, &allowed);
        assert_eq!(
            factory.is_authorized_destination(&setup.issuer_id, &setup.destination),
            allowed
        );
    }
}

#[test]
fn update_authorized_debitor_toggles_authorization_state() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    for authorized in [false, true] {
        factory
            .mock_auths(&[MockAuth {
                address: &setup.manager,
                invoke: &MockAuthInvoke {
                    contract: &setup.factory_address,
                    fn_name: "update_authorized_debitor",
                    args: (&setup.issuer_id, &setup.debitor, &authorized).into_val(&setup.env),
                    sub_invokes: &[],
                },
            }])
            .update_authorized_debitor(&setup.issuer_id, &setup.debitor, &authorized);
        assert_eq!(
            factory.is_authorized_debitor(&setup.issuer_id, &setup.debitor),
            authorized
        );
    }
}

#[test]
fn set_authorized_manager_rotates_manager_permissions() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_manager = Address::generate(&setup.env);
    let another_debitor = Address::generate(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_authorized_manager",
                args: (&setup.issuer_id, &new_manager).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .set_authorized_manager(&setup.issuer_id, &new_manager);
    let expected_manager_event = ManagedUpdated {
        issuer_id: setup.issuer_id.clone(),
        old_manager: setup.manager.clone(),
        manager: new_manager.clone(),
    };
    let factory_events_after_rotation = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(factory_events_after_rotation
        .events()
        .contains(&expected_manager_event.to_xdr(&setup.env, &setup.factory_address)));

    let old_manager_rejected = factory
        .mock_auths(&[MockAuth {
            address: &setup.manager,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_authorized_debitor",
                args: (&setup.issuer_id, &another_debitor, &true).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_update_authorized_debitor(&setup.issuer_id, &another_debitor, &true);
    assert!(old_manager_rejected.is_err());

    factory
        .mock_auths(&[MockAuth {
            address: &new_manager,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_user_velocity",
                args: (
                    &setup.issuer_id,
                    &setup.token_address,
                    &setup.user_account,
                    &3600u64,
                    &1000i128,
                    &500i128,
                )
                    .into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .update_user_velocity(
            &setup.issuer_id,
            &setup.token_address,
            &setup.user_account,
            &3600,
            &1000,
            &500,
        );
    let expected_velocity_event = UserVelocityUpdated {
        issuer_id: setup.issuer_id.clone(),
        token: setup.token_address.clone(),
        user: setup.user_account.clone(),
        period_duration_seconds: 3600,
        period_spend_limit: 1000,
        per_transaction_spend_limit: 500,
    };
    let factory_events_after_velocity = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(factory_events_after_velocity
        .events()
        .contains(&expected_velocity_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn update_authorized_debitor_fails_for_unknown_issuer() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unknown_issuer = rand_bytes(&setup.env);
    let result = factory.try_update_authorized_debitor(&unknown_issuer, &setup.debitor, &true);
    assert_eq!(result, Err(Ok(FactoryError::IssuerManagerNotFound.into())));
}

#[test]
fn update_user_velocity_fails_for_unknown_issuer() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unknown_issuer = rand_bytes(&setup.env);
    let result = factory.try_update_user_velocity(
        &unknown_issuer,
        &setup.token_address,
        &setup.user_account,
        &3600,
        &1000,
        &500,
    );
    assert_eq!(result, Err(Ok(FactoryError::IssuerManagerNotFound.into())));
}

#[test]
fn debitor_auth_is_required_for_transfer_to_destination() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let token = TokenClient::new(&setup.env, &setup.token_address);
    assert_eq!(token.balance(&setup.user_account), 0);
    assert_eq!(token.balance(&setup.destination), 0);

    // No auth should fail even if all other parameters are correct.
    let no_auth = factory.try_transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &1,
        &setup.destination,
        &rand_bytes(&setup.env),
    );
    assert!(no_auth.is_err());

    // Wrong signer should also fail; debitor auth is required specifically.
    let wrong_signer = Address::generate(&setup.env);
    let uuid = rand_bytes(&setup.env);
    let wrong_auth = factory
        .mock_auths(&[MockAuth {
            address: &wrong_signer,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "transfer_to_destination",
                args: (
                    &setup.issuer_id,
                    &setup.token_address,
                    &setup.debitor,
                    &setup.user_account,
                    &1i128,
                    &setup.destination,
                    &uuid,
                )
                    .into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &1,
            &setup.destination,
            &uuid,
        );
    assert!(wrong_auth.is_err());
    assert_eq!(token.balance(&setup.user_account), 0);
    assert_eq!(token.balance(&setup.destination), 0);
}

#[test]
fn pauser_auth_is_enforced_for_pause_unpause() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.pauser,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "pause",
                args: ().into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .pause();
    assert!(factory.paused());

    factory
        .mock_auths(&[MockAuth {
            address: &setup.pauser,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "unpause",
                args: ().into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .unpause();
    assert!(!factory.paused());

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "pause",
                args: ().into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_pause();
    assert!(unauthorized.is_err());
    assert!(!factory.paused());
}

#[test]
fn paused_state_blocks_mutating_entrypoints() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_destination = Address::generate(&setup.env);
    let another_debitor = Address::generate(&setup.env);
    let new_manager = Address::generate(&setup.env);
    let token_admin_address = Address::generate(&setup.env);
    let sac = setup
        .env
        .register_stellar_asset_contract_v2(token_admin_address);
    let another_token = sac.address();
    let paused_create_issuer_id = rand_bytes(&setup.env);

    factory.pause();
    assert!(factory.paused());

    let create_issuer = factory.try_create_issuer(
        &paused_create_issuer_id,
        &another_token,
        &new_manager,
        &new_destination,
    );
    assert_eq!(create_issuer, Err(Ok(FactoryError::EnforcedPause.into())));

    let destination_update =
        factory.try_update_issuer_destination(&setup.issuer_id, &new_destination, &true);
    assert_eq!(
        destination_update,
        Err(Ok(FactoryError::EnforcedPause.into()))
    );

    let debitor_update =
        factory.try_update_authorized_debitor(&setup.issuer_id, &another_debitor, &true);
    assert_eq!(debitor_update, Err(Ok(FactoryError::EnforcedPause.into())));

    let velocity_update = factory.try_update_user_velocity(
        &setup.issuer_id,
        &setup.token_address,
        &setup.user_account,
        &3600,
        &1000,
        &500,
    );
    assert_eq!(velocity_update, Err(Ok(FactoryError::EnforcedPause.into())));

    let transfer = factory.try_transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &1,
        &setup.destination,
        &rand_bytes(&setup.env),
    );
    assert_eq!(transfer, Err(Ok(FactoryError::EnforcedPause.into())));

    // Manager rotation is owner-gated and authority-replacing: permitted while
    // paused so the owner can rotate out a compromised manager during an incident.
    let manager_rotation = factory.try_set_authorized_manager(&setup.issuer_id, &new_manager);
    assert_eq!(manager_rotation, Ok(Ok(())));
    assert!(factory.is_authorized_manager(&setup.issuer_id, &new_manager));
}

#[test]
fn revoke_debitor_succeeds_while_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    assert!(factory.is_authorized_debitor(&setup.issuer_id, &setup.debitor));

    factory.pause();
    assert!(factory.paused());

    let revoke = factory.try_update_authorized_debitor(&setup.issuer_id, &setup.debitor, &false);
    assert_eq!(revoke, Ok(Ok(())));
    assert!(!factory.is_authorized_debitor(&setup.issuer_id, &setup.debitor));
    assert!(factory.paused());
}

#[test]
fn authorize_debitor_blocked_while_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_debitor = Address::generate(&setup.env);

    factory.pause();
    assert!(factory.paused());

    let authorize = factory.try_update_authorized_debitor(&setup.issuer_id, &new_debitor, &true);
    assert_eq!(authorize, Err(Ok(FactoryError::EnforcedPause.into())));
    assert!(!factory.is_authorized_debitor(&setup.issuer_id, &new_debitor));
}

#[test]
fn remove_destination_succeeds_while_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    assert!(factory.is_authorized_destination(&setup.issuer_id, &setup.destination));

    factory.pause();
    assert!(factory.paused());

    let remove =
        factory.try_update_issuer_destination(&setup.issuer_id, &setup.destination, &false);
    assert_eq!(remove, Ok(Ok(())));
    assert!(!factory.is_authorized_destination(&setup.issuer_id, &setup.destination));
    assert!(factory.paused());
}

#[test]
fn add_destination_blocked_while_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_destination = Address::generate(&setup.env);

    factory.pause();
    assert!(factory.paused());

    let add = factory.try_update_issuer_destination(&setup.issuer_id, &new_destination, &true);
    assert_eq!(add, Err(Ok(FactoryError::EnforcedPause.into())));
    assert!(!factory.is_authorized_destination(&setup.issuer_id, &new_destination));
}

#[test]
fn rotate_manager_succeeds_while_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_manager = Address::generate(&setup.env);

    factory.pause();
    assert!(factory.paused());

    let rotate = factory.try_set_authorized_manager(&setup.issuer_id, &new_manager);
    assert_eq!(rotate, Ok(Ok(())));
    assert!(factory.is_authorized_manager(&setup.issuer_id, &new_manager));
    assert!(!factory.is_authorized_manager(&setup.issuer_id, &setup.manager));
    assert!(factory.paused());
}

#[test]
fn freeze_then_revoke_then_resume_incident_flow() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    // Freeze the system in response to a compromised debitor.
    factory.pause();
    assert!(factory.paused());

    // Revoke the compromised debitor while still frozen — no transient re-open window.
    let revoke = factory.try_update_authorized_debitor(&setup.issuer_id, &setup.debitor, &false);
    assert_eq!(revoke, Ok(Ok(())));

    // Resume normal operations.
    factory.unpause();
    assert!(!factory.paused());

    // The revoked debitor cannot transfer after resume.
    let transfer = factory.try_transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &1,
        &setup.destination,
        &rand_bytes(&setup.env),
    );
    assert_eq!(transfer, Err(Ok(FactoryError::DebitorNotAuthorized.into())));
}

#[rstest]
#[case(true, FactoryError::EnforcedPause)]
#[case(false, FactoryError::ExpectedPause)]
fn pause_transition_requires_matching_state(
    #[case] start_paused: bool,
    #[case] expected_error: FactoryError,
) {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = if start_paused {
        factory.pause();
        factory.try_pause()
    } else {
        factory.try_unpause()
    };
    assert_eq!(result, Err(Ok(expected_error.into())));
}

#[rstest]
#[case(3600, -1, 1000)]
#[case(3600, 1000, -1)]
#[case(0, 1000, 1000)]
fn velocity_rejects_invalid_config(
    #[case] period_duration_seconds: u64,
    #[case] period_spend_limit: i128,
    #[case] per_transaction_spend_limit: i128,
) {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = factory.try_update_user_velocity(
        &setup.issuer_id,
        &setup.token_address,
        &setup.user_account,
        &period_duration_seconds,
        &period_spend_limit,
        &per_transaction_spend_limit,
    );
    assert_eq!(result, Err(Ok(FactoryError::InvalidVelocityConfig.into())));
}

#[test]
fn velocity_rejects_per_tx_exceeding_period() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = factory.try_update_user_velocity(
        &setup.issuer_id,
        &setup.token_address,
        &setup.user_account,
        &3600,
        &100,
        &200,
    );
    assert_eq!(result, Err(Ok(FactoryError::InvalidVelocityConfig.into())));
}

#[test]
fn velocity_rejects_below_minimum_duration() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = factory.try_update_user_velocity(
        &setup.issuer_id,
        &setup.token_address,
        &setup.user_account,
        &(MIN_PERIOD_DURATION_SECONDS - 1),
        &1000,
        &1000,
    );
    assert_eq!(result, Err(Ok(FactoryError::InvalidVelocityConfig.into())));
}

#[test]
fn velocity_accepts_equal_limits() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    factory.update_user_velocity(
        &setup.issuer_id,
        &setup.token_address,
        &setup.user_account,
        &MIN_PERIOD_DURATION_SECONDS,
        &1000,
        &1000,
    );

    let configured =
        factory.get_user_velocity(&setup.issuer_id, &setup.token_address, &setup.user_account);
    assert_eq!(configured.per_transaction_spend_limit, 1000);
    assert_eq!(configured.period_spend_limit, 1000);
    assert_eq!(
        configured.period_duration_seconds,
        MIN_PERIOD_DURATION_SECONDS
    );
}

#[rstest]
#[case(-1)]
#[case(0)]
fn velocity_rejects_non_positive_transfer_amount(#[case] amount: i128) {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let result = factory.try_transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &amount,
        &setup.destination,
        &rand_bytes(&setup.env),
    );
    assert_eq!(result, Err(Ok(FactoryError::InvalidTransferAmount.into())));
}

#[test]
fn velocity_overflow_maps_to_period_limit_error() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    setup.env.as_contract(&setup.factory_address, || {
        set_user_velocity(
            &setup.env,
            &setup.issuer_id,
            &setup.token_address,
            &setup.user_account,
            &UserVelocity {
                period_duration_seconds: 3600,
                period_spend_limit: i128::MAX,
                per_transaction_spend_limit: i128::MAX,
                period_spent: i128::MAX,
                period_last_reset_timestamp: setup.env.ledger().timestamp(),
                ledger_last_spent: 0,
                has_spent: false,
            },
        );
    });

    let result = factory.try_transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &1,
        &setup.destination,
        &rand_bytes(&setup.env),
    );
    assert_eq!(
        result,
        Err(Ok(FactoryError::PeriodSpendLimitExceeded.into()))
    );
}

// --- Request 1 & 2: get_owner / get_pauser query functions ---

#[test]
fn get_owner_returns_configured_owner() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    assert_eq!(factory.get_owner(), setup.owner);
}

#[test]
fn get_pauser_returns_configured_pauser() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    assert_eq!(factory.get_pauser(), setup.pauser);
}

// --- Request 3: set_owner (owner transfer) ---

#[test]
fn set_owner_transfers_ownership() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_owner = Address::generate(&setup.env);

    factory.set_owner(&new_owner);
    assert_eq!(factory.get_owner(), new_owner);
}

#[test]
fn set_owner_emits_owner_updated_event() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_owner = Address::generate(&setup.env);

    factory
        .mock_auths(&[
            MockAuth {
                address: &setup.owner,
                invoke: &MockAuthInvoke {
                    contract: &setup.factory_address,
                    fn_name: "set_owner",
                    args: (&new_owner,).into_val(&setup.env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &new_owner,
                invoke: &MockAuthInvoke {
                    contract: &setup.factory_address,
                    fn_name: "set_owner",
                    args: (&new_owner,).into_val(&setup.env),
                    sub_invokes: &[],
                },
            },
        ])
        .set_owner(&new_owner);

    let expected_event = OwnerUpdated {
        old_owner: setup.owner.clone(),
        new_owner: new_owner.clone(),
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn set_owner_auth_is_enforced() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_owner",
                args: (&attacker,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_set_owner(&attacker);
    assert!(unauthorized.is_err());
    assert_eq!(factory.get_owner(), setup.owner);
}

#[test]
fn set_owner_requires_new_owner_auth() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_owner = Address::generate(&setup.env);

    // Only the current owner signs; new_owner does not co-authorize.
    let result = factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_owner",
                args: (&new_owner,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_set_owner(&new_owner);
    assert!(result.is_err());
    assert_eq!(factory.get_owner(), setup.owner);
}

#[test]
fn set_owner_works_when_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_owner = Address::generate(&setup.env);

    factory.pause();
    assert!(factory.paused());

    factory.set_owner(&new_owner);
    assert_eq!(factory.get_owner(), new_owner);
}

#[test]
fn new_owner_can_exercise_owner_functions_after_transfer() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_owner = Address::generate(&setup.env);
    let destination = Address::generate(&setup.env);

    factory
        .mock_auths(&[
            MockAuth {
                address: &setup.owner,
                invoke: &MockAuthInvoke {
                    contract: &setup.factory_address,
                    fn_name: "set_owner",
                    args: (&new_owner,).into_val(&setup.env),
                    sub_invokes: &[],
                },
            },
            MockAuth {
                address: &new_owner,
                invoke: &MockAuthInvoke {
                    contract: &setup.factory_address,
                    fn_name: "set_owner",
                    args: (&new_owner,).into_val(&setup.env),
                    sub_invokes: &[],
                },
            },
        ])
        .set_owner(&new_owner);

    // New owner can update destinations.
    factory
        .mock_auths(&[MockAuth {
            address: &new_owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_issuer_destination",
                args: (&setup.issuer_id, &destination, &true).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .update_issuer_destination(&setup.issuer_id, &destination, &true);

    // Old owner is rejected.
    let old_owner_rejected = factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "update_issuer_destination",
                args: (&setup.issuer_id, &destination, &false).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_update_issuer_destination(&setup.issuer_id, &destination, &false);
    assert!(old_owner_rejected.is_err());
}

// --- Request 4: set_pauser_by_owner / set_pauser_by_pauser (pauser rotation paths) ---

#[test]
fn set_pauser_by_owner_transfers_pauser_role() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_pauser = Address::generate(&setup.env);

    factory.set_pauser_by_owner(&new_pauser);
    assert_eq!(factory.get_pauser(), new_pauser);
}

#[test]
fn set_pauser_by_pauser_transfers_pauser_role() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_pauser = Address::generate(&setup.env);

    factory.set_pauser_by_pauser(&new_pauser);
    assert_eq!(factory.get_pauser(), new_pauser);
}

#[test]
fn set_pauser_emits_pauser_updated_event() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_pauser = Address::generate(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_pauser_by_owner",
                args: (&new_pauser,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .set_pauser_by_owner(&new_pauser);

    let expected_event = PauserUpdated {
        old_pauser: setup.pauser.clone(),
        new_pauser: new_pauser.clone(),
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn set_pauser_by_owner_rejects_unauthorized_caller() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_pauser_by_owner",
                args: (&attacker,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_set_pauser_by_owner(&attacker);
    assert!(unauthorized.is_err());
    assert_eq!(factory.get_pauser(), setup.pauser);
}

#[test]
fn set_pauser_by_pauser_rejects_unauthorized_caller() {
    let setup = TestContext::for_auth();
    let attacker = Address::generate(&setup.env);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_pauser_by_pauser",
                args: (&attacker,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_set_pauser_by_pauser(&attacker);
    assert!(unauthorized.is_err());
    assert_eq!(factory.get_pauser(), setup.pauser);
}

#[test]
fn set_pauser_by_owner_works_when_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_pauser = Address::generate(&setup.env);

    factory.pause();
    assert!(factory.paused());

    // Owner can rotate pauser even while paused — critical recovery path.
    factory.set_pauser_by_owner(&new_pauser);
    assert_eq!(factory.get_pauser(), new_pauser);
}

#[test]
fn set_pauser_by_pauser_blocked_when_paused() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_pauser = Address::generate(&setup.env);

    factory.pause();
    assert!(factory.paused());

    // Pauser cannot rotate themselves while paused.
    let result = factory.try_set_pauser_by_pauser(&new_pauser);
    assert_eq!(result, Err(Ok(FactoryError::EnforcedPause.into())));
    assert_eq!(factory.get_pauser(), setup.pauser);
}

#[test]
fn owner_recovers_from_compromised_pauser() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let recovery_pauser = Address::generate(&setup.env);

    // Compromised pauser freezes the contract.
    factory.pause();
    assert!(factory.paused());

    // Owner rotates pauser even though contract is paused.
    factory.set_pauser_by_owner(&recovery_pauser);
    assert_eq!(factory.get_pauser(), recovery_pauser);

    // Old (compromised) pauser can no longer unpause.
    // Note: in for_flow mode, mock_all_auths is on, so we verify via get_pauser
    // that the role has changed.
}

#[test]
fn new_pauser_can_pause_and_unpause_after_rotation() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_pauser = Address::generate(&setup.env);

    // Owner rotates pauser.
    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "set_pauser_by_owner",
                args: (&new_pauser,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .set_pauser_by_owner(&new_pauser);

    // New pauser can pause.
    factory
        .mock_auths(&[MockAuth {
            address: &new_pauser,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "pause",
                args: ().into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .pause();
    assert!(factory.paused());

    // Old pauser is rejected.
    let old_pauser_rejected = factory
        .mock_auths(&[MockAuth {
            address: &setup.pauser,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "unpause",
                args: ().into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_unpause();
    assert!(old_pauser_rejected.is_err());

    // New pauser can unpause.
    factory
        .mock_auths(&[MockAuth {
            address: &new_pauser,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "unpause",
                args: ().into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .unpause();
    assert!(!factory.paused());
}

// --- Request 5: upgrade (contract upgradeability) ---

#[test]
fn upgrade_requires_owner_auth() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let attacker = Address::generate(&setup.env);
    let fake_hash = rand_bytes(&setup.env);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "upgrade",
                args: (&fake_hash,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_upgrade(&fake_hash);
    assert!(unauthorized.is_err());
}

#[test]
fn upgrade_emits_contract_upgraded_event() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_wasm_hash = upload_issuer_wasm(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "upgrade",
                args: (&new_wasm_hash,).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .upgrade(&new_wasm_hash);

    let expected_event = ContractUpgraded {
        new_wasm_hash: new_wasm_hash.clone(),
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn upgrade_issuer_requires_owner_auth() {
    let setup = TestContext::for_auth();
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let attacker = Address::generate(&setup.env);
    let fake_hash = rand_bytes(&setup.env);

    let unauthorized = factory
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "upgrade_issuer",
                args: (&setup.issuer_id, &setup.token_address, &fake_hash).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .try_upgrade_issuer(&setup.issuer_id, &setup.token_address, &fake_hash);
    assert!(unauthorized.is_err());
}

#[test]
fn upgrade_issuer_fails_for_unknown_issuer() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let unknown_issuer = rand_bytes(&setup.env);
    let fake_hash = rand_bytes(&setup.env);

    let result = factory.try_upgrade_issuer(&unknown_issuer, &setup.token_address, &fake_hash);
    assert_eq!(result, Err(Ok(FactoryError::IssuerNotFound.into())));
}

#[test]
fn upgrade_issuer_succeeds_with_valid_wasm() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    // Re-upload the same issuer WASM to get a valid hash.
    let new_issuer_hash = upload_issuer_wasm(&setup.env);

    // upgrade_issuer should succeed — factory authorizes issuer.upgrade().
    factory.upgrade_issuer(&setup.issuer_id, &setup.token_address, &new_issuer_hash);
}

#[test]
fn upgrade_issuer_emits_issuer_upgraded_event() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let new_wasm_hash = upload_issuer_wasm(&setup.env);

    factory
        .mock_auths(&[MockAuth {
            address: &setup.owner,
            invoke: &MockAuthInvoke {
                contract: &setup.factory_address,
                fn_name: "upgrade_issuer",
                args: (&setup.issuer_id, &setup.token_address, &new_wasm_hash).into_val(&setup.env),
                sub_invokes: &[],
            },
        }])
        .upgrade_issuer(&setup.issuer_id, &setup.token_address, &new_wasm_hash);

    let expected_event = IssuerUpgraded {
        issuer_id: setup.issuer_id.clone(),
        token: setup.token_address.clone(),
        new_wasm_hash: new_wasm_hash.clone(),
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn pause_emits_paused_event() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    factory.pause();

    let expected_event = Paused {
        pauser: setup.pauser.clone(),
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn unpause_emits_unpaused_event() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);

    factory.pause();
    factory.unpause();

    let expected_event = Unpaused {
        pauser: setup.pauser.clone(),
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

#[test]
fn issuer_created_event_includes_token() {
    // The test event buffer retains only the most recent emission, so create
    // the issuer as the final operation and assert immediately afterwards.
    let env = Env::default();
    env.mock_all_auths();

    let owner = Address::generate(&env);
    let pauser = Address::generate(&env);
    let manager = Address::generate(&env);
    let destination = Address::generate(&env);
    let issuer_id = rand_bytes(&env);

    let issuer_wasm_hash = upload_issuer_wasm(&env);
    let factory_address = env.register(Factory, (owner, pauser, issuer_wasm_hash));
    let factory = FactoryClient::new(&env, &factory_address);

    let token_admin_address = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin_address);
    let token_address = sac.address();

    let issuer_address = factory.create_issuer(&issuer_id, &token_address, &manager, &destination);

    let expected_event = IssuerCreated {
        issuer_id: issuer_id.clone(),
        token: token_address.clone(),
        issuer: issuer_address.clone(),
        manager: manager.clone(),
        destination: destination.clone(),
    };
    let events = env.events().all().filter_by_contract(&factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&env, &factory_address)));
}

#[test]
fn transfer_event_includes_issuer_id_and_debitor() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let transfer_uuid = rand_bytes(&setup.env);

    factory.transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &AMOUNT,
        &setup.destination,
        &transfer_uuid,
    );

    let expected_event = TransferExecuted {
        uuid: transfer_uuid.clone(),
        issuer_id: setup.issuer_id.clone(),
        account: setup.user_account.clone(),
        debitor: setup.debitor.clone(),
        destination: setup.destination.clone(),
        token: setup.token_address.clone(),
        amount: AMOUNT,
    };
    let events = setup
        .env
        .events()
        .all()
        .filter_by_contract(&setup.factory_address);
    assert!(events
        .events()
        .contains(&expected_event.to_xdr(&setup.env, &setup.factory_address)));
}

proptest! {
    #![proptest_config(proptest_config())]

    #[test]
    fn prop_single_transfer_updates_balances(amount in 1i128..=INITIAL_BALANCE) {
        let setup = TestContext::for_flow(true, true);
        let factory = FactoryClient::new(&setup.env, &setup.factory_address);
        let token = TokenClient::new(&setup.env, &setup.token_address);

        let before_user_account = token.balance(&setup.user_account);
        let before_destination = token.balance(&setup.destination);

        factory.transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );

        prop_assert_eq!(token.balance(&setup.user_account), before_user_account - amount);
        prop_assert_eq!(token.balance(&setup.destination), before_destination + amount);
    }

    #[test]
    fn prop_transfer_above_per_tx_limit_is_rejected(
        (per_tx_limit, amount) in (0i128..INITIAL_BALANCE).prop_flat_map(|per_tx_limit| {
            (Just(per_tx_limit), (per_tx_limit + 1)..=INITIAL_BALANCE)
        })
    ) {
        let setup = TestContext::for_flow(true, true);
        let factory = FactoryClient::new(&setup.env, &setup.factory_address);

        factory.update_user_velocity(
            &setup.issuer_id,
            &setup.token_address,
            &setup.user_account,
            &3600,
            &(INITIAL_BALANCE * 10),
            &per_tx_limit,
        );

        let result = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );

        prop_assert_eq!(
            result,
            Err(Ok(FactoryError::PerTransactionSpendLimitExceeded.into()))
        );
    }

    #[test]
    fn prop_same_ledger_second_transfer_is_rejected(first_amount in 1i128..=INITIAL_BALANCE) {
        let setup = TestContext::for_flow(true, true);
        let factory = FactoryClient::new(&setup.env, &setup.factory_address);

        let first = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &first_amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert!(first.is_ok());

        // Same ledger second transfer must fail regardless of amount.
        let second = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &1i128,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert_eq!(second, Err(Ok(FactoryError::OneTransferPerLedger.into())));
    }

    #[test]
    fn prop_period_limit_rejects_after_ledger_advance(
        (first_amount, second_amount, period_limit) in (1i128..=400, 1i128..=400)
            .prop_flat_map(|(first_amount, second_amount)| {
                let min_limit = if first_amount > second_amount {
                    first_amount
                } else {
                    second_amount
                };
                (Just(first_amount), Just(second_amount), min_limit..=(first_amount + second_amount - 1))
            })
    ) {
        let setup = TestContext::for_flow(true, true);
        let factory = FactoryClient::new(&setup.env, &setup.factory_address);
        let token = TokenClient::new(&setup.env, &setup.token_address);

        factory.update_user_velocity(
            &setup.issuer_id,
            &setup.token_address,
            &setup.user_account,
            &3600,
            &period_limit,
            &period_limit,
        );

        let first = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &first_amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert!(first.is_ok());

        // Move to next ledger so failure is due to period limit, not one-transfer-per-ledger.
        let current_sequence = setup.env.ledger().sequence();
        setup.env.ledger().set_sequence_number(current_sequence + 1);

        let second = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &second_amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert_eq!(second, Err(Ok(FactoryError::PeriodSpendLimitExceeded.into())));
        prop_assert_eq!(token.balance(&setup.destination), first_amount);
    }

    #[test]
    fn prop_period_resets_after_duration(
        (first_amount, second_amount, period_limit, period_duration_seconds, third_amount) in
            (1i128..=300, 1i128..=300, MIN_PERIOD_DURATION_SECONDS..=(MIN_PERIOD_DURATION_SECONDS + 120))
                .prop_flat_map(|(first_amount, second_amount, period_duration_seconds)| {
                    let min_limit = if first_amount > second_amount {
                        first_amount
                    } else {
                        second_amount
                    };
                    (Just(first_amount), Just(second_amount), min_limit..=(first_amount + second_amount - 1), Just(period_duration_seconds))
                })
                .prop_flat_map(|(first_amount, second_amount, period_limit, period_duration_seconds)| {
                    (
                        Just(first_amount),
                        Just(second_amount),
                        Just(period_limit),
                        Just(period_duration_seconds),
                        1i128..=period_limit,
                    )
                })
    ) {
        let setup = TestContext::for_flow(true, true);
        let factory = FactoryClient::new(&setup.env, &setup.factory_address);
        let token = TokenClient::new(&setup.env, &setup.token_address);

        factory.update_user_velocity(
            &setup.issuer_id,
            &setup.token_address,
            &setup.user_account,
            &period_duration_seconds,
            &period_limit,
            &period_limit,
        );

        let first = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &first_amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert!(first.is_ok());

        // Move to next ledger so failure is due to period limit.
        let current_sequence = setup.env.ledger().sequence();
        setup.env.ledger().set_sequence_number(current_sequence + 1);

        let second = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &second_amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert_eq!(second, Err(Ok(FactoryError::PeriodSpendLimitExceeded.into())));

        // Advance time enough to reset velocity window, then try again in new ledger.
        let now = setup.env.ledger().timestamp();
        setup.env
            .ledger()
            .set_timestamp(now + period_duration_seconds);
        let next_sequence = setup.env.ledger().sequence();
        setup.env.ledger().set_sequence_number(next_sequence + 1);

        let third = factory.try_transfer_to_destination(
            &setup.issuer_id,
            &setup.token_address,
            &setup.debitor,
            &setup.user_account,
            &third_amount,
            &setup.destination,
            &rand_bytes(&setup.env),
        );
        prop_assert!(third.is_ok());
        prop_assert_eq!(token.balance(&setup.destination), first_amount + third_amount);
    }
}

/// Ledgers to decay before re-checking TTLs: enough to push entries that were
/// extended to the network maximum (6,312,000 in the test env) below the
/// contract's ~30-day extension threshold, without any TTL reaching zero.
const TTL_DECAY_LEDGERS: u32 = 5_900_000;

fn persistent_ttl(setup: &TestContext, key: &PersistentKey) -> u32 {
    setup.env.as_contract(&setup.factory_address, || {
        setup.env.storage().persistent().get_ttl(key)
    })
}

fn instance_ttl(setup: &TestContext, contract: &Address) -> u32 {
    setup
        .env
        .as_contract(contract, || setup.env.storage().instance().get_ttl())
}

/// The maximum TTL extensions can reach, as the contract computes it
/// (`max_entry_ttl` minus the current ledger).
fn network_max_ttl(setup: &TestContext) -> u32 {
    setup
        .env
        .as_contract(&setup.factory_address, || setup.env.storage().max_ttl())
}

/// Every persistent policy entry created by `TestContext::for_flow`.
fn policy_keys(setup: &TestContext) -> [PersistentKey; 5] {
    [
        PersistentKey::UserVelocity(
            setup.issuer_id.clone(),
            setup.token_address.clone(),
            setup.user_account.clone(),
        ),
        PersistentKey::AuthorizedDebitor(setup.issuer_id.clone(), setup.debitor.clone()),
        PersistentKey::AllowedDestination(setup.issuer_id.clone(), setup.destination.clone()),
        PersistentKey::IssuerAddress(setup.issuer_id.clone(), setup.token_address.clone()),
        PersistentKey::IssuerManager(setup.issuer_id.clone()),
    ]
}

#[test]
fn setup_extends_all_ttls_to_network_max() {
    let setup = TestContext::for_flow(true, true);
    let max_ttl = network_max_ttl(&setup);

    // Fresh entries are created with the network minimum TTL (4096 in the
    // test env); the storage accessors must have extended every one to max.
    for key in policy_keys(&setup) {
        assert_eq!(persistent_ttl(&setup, &key), max_ttl);
    }
    assert_eq!(instance_ttl(&setup, &setup.factory_address), max_ttl);
    assert_eq!(instance_ttl(&setup, &setup.issuer_address), max_ttl);
}

#[test]
fn transfer_extends_ttls_of_entries_it_touches() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let token = TokenClient::new(&setup.env, &setup.token_address);
    let max_ttl = network_max_ttl(&setup);
    let decayed_ttl = max_ttl - TTL_DECAY_LEDGERS;

    let sequence = setup.env.ledger().sequence();
    setup
        .env
        .ledger()
        .set_sequence_number(sequence + TTL_DECAY_LEDGERS);
    for key in policy_keys(&setup) {
        assert_eq!(persistent_ttl(&setup, &key), decayed_ttl);
    }

    // Refresh the token allowance, which expired with the ledger jump.
    token.approve(
        &setup.user_account,
        &setup.issuer_address,
        &INITIAL_BALANCE,
        &(setup.env.ledger().sequence() + 1000),
    );
    factory.transfer_to_destination(
        &setup.issuer_id,
        &setup.token_address,
        &setup.debitor,
        &setup.user_account,
        &AMOUNT,
        &setup.destination,
        &rand_bytes(&setup.env),
    );

    let [velocity, debitor, destination, issuer_address, manager] = policy_keys(&setup);
    // The transfer writes velocity and only reads debitor, destination, and
    // issuer address; reads and writes alike must extend back to max.
    assert_eq!(persistent_ttl(&setup, &velocity), max_ttl);
    assert_eq!(persistent_ttl(&setup, &debitor), max_ttl);
    assert_eq!(persistent_ttl(&setup, &destination), max_ttl);
    assert_eq!(persistent_ttl(&setup, &issuer_address), max_ttl);
    // The manager entry is not touched by transfers and keeps decaying.
    assert_eq!(persistent_ttl(&setup, &manager), decayed_ttl);
    // Both contract instances were kept alive.
    assert_eq!(instance_ttl(&setup, &setup.factory_address), max_ttl);
    assert_eq!(instance_ttl(&setup, &setup.issuer_address), max_ttl);
}

#[test]
fn manager_call_extends_manager_and_velocity_ttls() {
    let setup = TestContext::for_flow(true, true);
    let factory = FactoryClient::new(&setup.env, &setup.factory_address);
    let max_ttl = network_max_ttl(&setup);

    let sequence = setup.env.ledger().sequence();
    setup
        .env
        .ledger()
        .set_sequence_number(sequence + TTL_DECAY_LEDGERS);

    factory.update_user_velocity(
        &setup.issuer_id,
        &setup.token_address,
        &setup.user_account,
        &3600,
        &(INITIAL_BALANCE * 10),
        &(INITIAL_BALANCE * 10),
    );

    let [velocity, _, _, _, manager] = policy_keys(&setup);
    assert_eq!(persistent_ttl(&setup, &velocity), max_ttl);
    assert_eq!(persistent_ttl(&setup, &manager), max_ttl);
    assert_eq!(instance_ttl(&setup, &setup.factory_address), max_ttl);
}
