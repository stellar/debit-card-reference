import { Heading, Text } from "@stellar/design-system";

export const Guide = () => {
  return (
    <div>
      <Heading as="h1" size="md">
        How It Works
      </Heading>
      <Text as="p" size="sm">
        A non-custodial debit card system where users keep funds in their own
        wallet. The contract pulls funds only when an authorized card payment
        occurs.
      </Text>

      {/* Architecture */}
      <div className="PageSection">
        <div className="PageSection__title">Architecture</div>
        <Text as="p" size="sm">
          The system uses two contracts. The <strong>Factory</strong> is a
          singleton that enforces all policy (roles, velocity limits,
          destination allowlists). Each <strong>Issuer</strong> is a minimal
          proxy deployed by the factory that can pull funds from cardholder
          wallets via <code>transfer_from</code>.
        </Text>
        <div className="Guide__diagram">
          <div className="Guide__box Guide__box--factory">
            <div className="Guide__boxTitle">Factory (Singleton)</div>
            <div className="Guide__boxBody">
              Roles, velocity limits, destination allowlists, deploys issuers
            </div>
          </div>
          <div className="Guide__arrows">
            <span>deploys</span>
            <span>deploys</span>
          </div>
          <div className="Guide__row">
            <div className="Guide__box Guide__box--issuer">
              <div className="Guide__boxTitle">Issuer A</div>
              <div className="Guide__boxBody">Program + Token pair</div>
            </div>
            <div className="Guide__box Guide__box--issuer">
              <div className="Guide__boxTitle">Issuer B</div>
              <div className="Guide__boxBody">Program + Token pair</div>
            </div>
          </div>
          <div className="Guide__arrows">
            <span>transfer_from</span>
          </div>
          <div className="Guide__box Guide__box--token">
            <div className="Guide__boxTitle">Token Contract (SEP-41)</div>
            <div className="Guide__boxBody">Manages balances &amp; allowances</div>
          </div>
        </div>
        <Text as="p" size="sm">
          <strong>Why two contracts?</strong> On Soroban, <code>transfer_from</code>{" "}
          requires the spender to be a contract address. The cardholder approves
          the issuer contract (not the factory) to pull their funds.
        </Text>
      </div>

      {/* Roles */}
      <div className="PageSection">
        <div className="PageSection__title">Roles</div>
        <div className="Guide__roles">
          <div className="Guide__role">
            <div className="Guide__roleHeader">
              <span className="Guide__roleBadge Guide__roleBadge--owner" />
              <strong>Owner</strong>
            </div>
            <Text as="p" size="xs">
              Deploys issuer contracts, manages destination allowlists, rotates
              managers. Set at factory deployment.
            </Text>
            <code className="Guide__fns">
              create_issuer, update_issuer_destination, set_authorized_manager
            </code>
          </div>
          <div className="Guide__role">
            <div className="Guide__roleHeader">
              <span className="Guide__roleBadge Guide__roleBadge--pauser" />
              <strong>Pauser</strong>
            </div>
            <Text as="p" size="xs">
              Emergency freeze/unfreeze of all operations. Set at factory
              deployment. While paused, authority-<em>adding</em> operations
              (authorize debitor, add destination, create issuer, set velocity,
              transfer) are blocked, but authority-<em>reducing</em> ones
              (revoke debitor, remove destination, rotate manager or pauser via
              the owner) still work — so freeze-then-revoke is a single
              incident window (FIND-008).
            </Text>
            <code className="Guide__fns">pause, unpause</code>
          </div>
          <div className="Guide__role">
            <div className="Guide__roleHeader">
              <span className="Guide__roleBadge Guide__roleBadge--manager" />
              <strong>Manager</strong>
            </div>
            <Text as="p" size="xs">
              One per issuer. Authorizes debitors and configures per-user
              velocity limits (spend caps and periods).
            </Text>
            <code className="Guide__fns">
              update_authorized_debitor, update_user_velocity
            </code>
          </div>
          <div className="Guide__role">
            <div className="Guide__roleHeader">
              <span className="Guide__roleBadge Guide__roleBadge--debitor" />
              <strong>Debitor</strong>
            </div>
            <Text as="p" size="xs">
              The payment backend. When a card is swiped, the debitor submits
              the on-chain transfer request. Has no policy control.
            </Text>
            <code className="Guide__fns">transfer_to_destination</code>
          </div>
          <div className="Guide__role">
            <div className="Guide__roleHeader">
              <span className="Guide__roleBadge Guide__roleBadge--cardholder" />
              <strong>Cardholder</strong>
            </div>
            <Text as="p" size="xs">
              The end user. Approves the issuer contract to spend their tokens
              up to a capped amount. Funds stay in their wallet until a payment
              is triggered.
            </Text>
            <code className="Guide__fns">token.approve(issuer, amount, expiry)</code>
          </div>
        </div>
      </div>

      {/* Transfer Flow */}
      <div className="PageSection">
        <div className="PageSection__title">Transfer Flow</div>
        <Text as="p" size="sm">
          When a cardholder swipes their card, the payment flows through these
          checks before funds move:
        </Text>
        <div className="Guide__flow">
          <div className="Guide__flowStep">
            Pause check
            <span className="Guide__flowDetail">
              Blocks transfers and all authority-adding ops; authority-reducing
              ops stay available
            </span>
          </div>
          <div className="Guide__flowArrow" />
          <div className="Guide__flowStep">Debitor authorized?</div>
          <div className="Guide__flowArrow" />
          <div className="Guide__flowStep">Destination allowed?</div>
          <div className="Guide__flowArrow" />
          <div className="Guide__flowStep Guide__flowStep--velocity">
            Velocity limits
            <span className="Guide__flowDetail">
              Amount &gt; 0, per-tx limit, fixed-window period limit,
              one-per-ledger
            </span>
          </div>
          <div className="Guide__flowArrow" />
          <div className="Guide__flowStep Guide__flowStep--action">
            Issuer: transfer_from
          </div>
          <div className="Guide__flowArrow" />
          <div className="Guide__flowStep Guide__flowStep--event">
            Event emitted
          </div>
        </div>
        <Text as="p" size="xs">
          Velocity periods are <strong>fixed windows</strong>, not rolling
          ones: the window anchors at the first spend and re-anchors on the
          first transfer after it elapses. Around a window boundary, up to ~2x
          the period limit can clear in a short wall-clock span (full limit
          just before the reset, full limit just after) — size limits
          accordingly.
        </Text>
      </div>

      {/* Role Hierarchy */}
      <div className="PageSection">
        <div className="PageSection__title">Role Hierarchy</div>
        <Text as="p" size="sm">
          Authorization flows top-down. Each level can only act within its
          scope.
        </Text>
        <div className="Guide__hierarchy">
          <div className="Guide__hLevel Guide__hLevel--0">
            <strong>Owner</strong>
            <span>Global &mdash; deploys issuers, sets managers</span>
          </div>
          <div className="Guide__hConnector" />
          <div className="Guide__hBranch">
            <div className="Guide__hLevel Guide__hLevel--1">
              <strong>Pauser</strong>
              <span>Global &mdash; freeze / unfreeze all</span>
            </div>
            <div className="Guide__hLevel Guide__hLevel--1">
              <strong>Manager</strong>
              <span>Per-issuer &mdash; authorizes debitors, sets velocity</span>
            </div>
          </div>
          <div className="Guide__hConnector" />
          <div className="Guide__hLevel Guide__hLevel--2">
            <strong>Debitor</strong>
            <span>Per-issuer &mdash; submits transfer requests</span>
          </div>
          <div className="Guide__hConnector" />
          <div className="Guide__hLevel Guide__hLevel--3">
            <strong>Cardholder</strong>
            <span>Per-user &mdash; approves token allowance</span>
          </div>
        </div>
      </div>

      {/* Guided Scenarios */}
      <div className="PageSection">
        <div className="PageSection__title">Guided Scenarios</div>
        <Text as="p" size="sm">
          Walkthroughs that exercise the audited security properties end to
          end. Run them after completing Setup; watch the StatusBar pause badge
          and the log pane as you go.
        </Text>

        <Text as="p" size="sm">
          <strong>1. Incident-response drill (FIND-008 / FIND-004)</strong>
        </Text>
        <Text as="p" size="xs">
          Pauser tab: <code>pause</code> → Manager tab: revoke the debitor —
          succeeds <em>while paused</em> (authority-reducing) → Debitor tab:
          attempt a transfer — rejected with error #1000 (paused) → Pauser tab:{" "}
          <code>unpause</code> → Debitor tab: retry the transfer — rejected
          with error #0 (<code>DebitorNotAuthorized</code>). The compromise is
          contained in a single freeze-then-revoke window.
        </Text>

        <Text as="p" size="sm">
          <strong>2. Owner authority chain (FIND-001)</strong>
        </Text>
        <Text as="p" size="xs">
          The owner is the system&apos;s root of trust — every guardrail is
          owner-reachable. Demonstrate it: Owner tab: rotate the manager to a
          key you control → Manager tab: authorize yourself as debitor → raise
          the velocity limits → Owner tab: allowlist your own destination →
          Debitor tab: transfer from the cardholder. Each step is a normal,
          authorized call; protecting the owner key is the operational
          requirement this walk demonstrates.
        </Text>

        <Text as="p" size="sm">
          <strong>3. Debitor blast-radius bounds (FIND-004)</strong>
        </Text>
        <Text as="p" size="xs">
          As debitor, probe each on-chain bound: exceed the per-transaction cap
          — error #4 → exceed the period cap with repeated transfers — error #5
          → attempt an un-allowlisted destination — error #1 → attempt two
          transfers in one ledger — error #6. A compromised debitor key is
          bounded by the destination allowlist and velocity controls; it cannot
          move funds outside them.
        </Text>
      </div>
    </div>
  );
};
