import { useState } from "react";
import { Button, Input } from "@stellar/design-system";

import type { RoleName } from "@/types.ts";
import { useAppState, useAppDispatch } from "@/store.ts";
import { generateKeypair, importKeypair, fundViaFriendbot } from "@/soroban/keypairs.ts";
import { getSecretKeyError } from "@/helper/validation.ts";

import "./styles.scss";

const ROLE_LABELS: Record<RoleName, string> = {
  owner: "Owner",
  pauser: "Pauser",
  manager: "Manager",
  debitor: "Debitor",
  cardholder: "Cardholder",
  destination: "Destination",
};

const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  owner: "Deploys issuers, manages destinations",
  pauser: "Emergency pause / unpause",
  manager: "Authorizes debitors, sets velocity",
  debitor: "Signs transfer requests (not the merchant)",
  cardholder: "Wallet owner, approves token spend",
  destination:
    "Settlement pool — receives funds on-chain (not the merchant)",
};

export const KeypairCard = ({ role }: { role: RoleName }) => {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const roleState = state.roles[role];

  const [showImport, setShowImport] = useState(false);
  const [secretInput, setSecretInput] = useState("");
  const [secretError, setSecretError] = useState("");
  const [isFunding, setIsFunding] = useState(false);
  const [fundError, setFundError] = useState("");

  const handleGenerate = () => {
    const kp = generateKeypair();
    dispatch({ type: "SET_KEYPAIR", role, keypair: kp });
    setShowImport(false);
    setSecretInput("");
    setSecretError("");
    setFundError("");
  };

  const handleImport = () => {
    const error = getSecretKeyError(secretInput);
    if (error) {
      setSecretError(error);
      return;
    }
    try {
      const kp = importKeypair(secretInput);
      dispatch({ type: "SET_KEYPAIR", role, keypair: kp });
      setShowImport(false);
      setSecretInput("");
      setSecretError("");
    } catch {
      setSecretError("Invalid secret key");
    }
  };

  const handleFund = async () => {
    if (!roleState.keypair) return;
    setIsFunding(true);
    setFundError("");
    try {
      await fundViaFriendbot(roleState.keypair.publicKey());
      dispatch({ type: "SET_FUNDED", role });
    } catch (e) {
      setFundError(e instanceof Error ? e.message : "Funding failed");
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <div className="KeypairCard" data-funded={roleState.funded}>
      <div className="KeypairCard__header">
        <div className="KeypairCard__role">
          <span className="KeypairCard__dot" data-funded={roleState.funded} />
          <strong>{ROLE_LABELS[role]}</strong>
        </div>
        <span className="KeypairCard__desc">{ROLE_DESCRIPTIONS[role]}</span>
      </div>

      {roleState.keypair && (
        <div className="KeypairCard__pubkey">
          {roleState.keypair.publicKey()}
        </div>
      )}

      <div className="KeypairCard__actions">
        <Button size="sm" variant="secondary" onClick={handleGenerate}>
          Generate
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          onClick={() => setShowImport(!showImport)}
        >
          {showImport ? "Cancel" : "Import"}
        </Button>
        {roleState.keypair && !roleState.funded && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleFund}
            isLoading={isFunding}
          >
            Fund
          </Button>
        )}
      </div>

      {showImport && (
        <div className="KeypairCard__import">
          <Input
            id={`import-${role}`}
            fieldSize="sm"
            label="Secret Key"
            placeholder="S..."
            value={secretInput}
            error={secretError}
            onChange={(e) => {
              setSecretInput(e.target.value);
              setSecretError("");
            }}
          />
          <Button size="sm" variant="secondary" onClick={handleImport}>
            Import
          </Button>
        </div>
      )}

      {fundError && <div className="InlineError">{fundError}</div>}
    </div>
  );
};
