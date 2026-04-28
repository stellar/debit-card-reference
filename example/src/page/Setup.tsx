import { useState, useCallback, useEffect } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState, useAppDispatch } from "@/store.ts";
import { KeypairCard } from "@/component/KeypairCard/index.tsx";
import type { RoleName } from "@/types.ts";
import { generateKeypair, fundViaFriendbot } from "@/soroban/keypairs.ts";
import { errorMessage } from "@/helper/errors.ts";
import { randomBytes32, bytesToHex, hexToBytes, toScValAddress, toScValBytes32 } from "@/soroban/codec.ts";
import { uploadWasm, deployContract } from "@/soroban/deploy.ts";
import { createIssuer } from "@/soroban/factory.ts";
import { isPaused } from "@/soroban/factory.ts";
import { StrKey } from "@stellar/stellar-sdk";

const ROLES: RoleName[] = ["owner", "pauser", "manager", "debitor", "cardholder", "destination"];

export const Setup = () => {
  const state = useAppState();
  const dispatch = useAppDispatch();

  // Step 2 — Token
  const [tokenInput, setTokenInput] = useState("");
  const [tokenError, setTokenError] = useState("");

  // Step 3 — Factory
  const [factoryMode, setFactoryMode] = useState<"existing" | "deploy">(
    "existing",
  );
  const [factoryInput, setFactoryInput] = useState("");
  const [factoryError, setFactoryError] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // Deploy mode
  const [issuerWasm, setIssuerWasm] = useState<Uint8Array | null>(null);
  const [factoryWasm, setFactoryWasm] = useState<Uint8Array | null>(null);
  const [bundledWasmsAvailable, setBundledWasmsAvailable] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    const fetchWasm = async (name: string) => {
      const res = await fetch(`${import.meta.env.BASE_URL}wasm/${name}.wasm`);
      if (!res.ok) throw new Error(`${name}.wasm: HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    Promise.all([fetchWasm("issuer"), fetchWasm("factory")])
      .then(([issuer, factory]) => {
        if (cancelled) return;
        setIssuerWasm((prev) => prev ?? issuer);
        setFactoryWasm((prev) => prev ?? factory);
        setBundledWasmsAvailable(true);
      })
      .catch(() => {
        // Bundled WASMs not present in this build (local dev without copying
        // them into public/wasm). Fall back to manual upload.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Step 4 — Create Issuer
  const [issuerIdInput, setIssuerIdInput] = useState(() => bytesToHex(randomBytes32()));
  const destinationPub = state.roles.destination.keypair?.publicKey() ?? "";
  const [isCreatingIssuer, setIsCreatingIssuer] = useState(false);
  const [createIssuerError, setCreateIssuerError] = useState("");
  const [createIssuerSuccess, setCreateIssuerSuccess] = useState("");

  const [isQuickSetup, setIsQuickSetup] = useState(false);
  const [quickSetupStatus, setQuickSetupStatus] = useState("");

  const handleQuickSetup = useCallback(async () => {
    setIsQuickSetup(true);
    setQuickSetupStatus("Funding all accounts...");

    const keypairs = ROLES.map((role) => {
      const kp = generateKeypair();
      dispatch({ type: "SET_KEYPAIR", role, keypair: kp });
      return { role, keypair: kp };
    });

    const results = await Promise.allSettled(
      keypairs.map((b) => fundViaFriendbot(b.keypair.publicKey())),
    );

    let hasFailed = false;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "fulfilled") {
        dispatch({ type: "SET_FUNDED", role: keypairs[i].role });
      } else {
        hasFailed = true;
      }
    }

    setQuickSetupStatus(
      hasFailed
        ? "Some accounts failed to fund. Retry individually."
        : "All accounts generated and funded.",
    );
    setIsQuickSetup(false);
  }, [dispatch]);

  const allKeypairsReady = ROLES.every((r) => state.roles[r].keypair);
  const allFunded = ROLES.every((r) => state.roles[r].funded);
  const ownerFunded = state.roles.owner.funded;

  // Step 2 — Set token
  const handleSetToken = () => {
    const trimmed = tokenInput.trim();
    if (!trimmed || !StrKey.isValidContract(trimmed)) {
      setTokenError("Enter a valid Stellar contract address (C...)");
      return;
    }
    dispatch({ type: "SET_TOKEN", tokenContractId: trimmed });
    setTokenError("");
  };

  // Step 3a — Verify existing factory
  const handleVerifyFactory = useCallback(async () => {
    const trimmed = factoryInput.trim();
    if (!trimmed || !StrKey.isValidContract(trimmed)) {
      setFactoryError("Enter a valid Stellar contract address (C...)");
      return;
    }

    const callerKp = ROLES.map((r) => state.roles[r].keypair).find(Boolean);
    if (!callerKp) {
      setFactoryError("Generate at least one keypair first");
      return;
    }

    setIsVerifying(true);
    setFactoryError("");
    try {
      await isPaused({
        factoryId: trimmed,
        callerPublicKey: callerKp.publicKey(),
      });
      dispatch({ type: "SET_FACTORY", factoryContractId: trimmed });
    } catch (e) {
      setFactoryError(
        `Verification failed: ${errorMessage(e)}`,
      );
    } finally {
      setIsVerifying(false);
    }
  }, [factoryInput, state.roles, dispatch]);

  // Step 3b — Deploy factory
  const handleFileUpload = (
    setter: (bytes: Uint8Array | null) => void,
  ) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setter(new Uint8Array(reader.result as ArrayBuffer));
      };
      reader.readAsArrayBuffer(file);
    };
  };

  const handleDeploy = useCallback(async () => {
    if (!issuerWasm || !factoryWasm) {
      setFactoryError("Upload both WASM files");
      return;
    }
    const ownerKp = state.roles.owner.keypair;
    if (!ownerKp || !state.roles.owner.funded) {
      setFactoryError("Owner keypair must be funded");
      return;
    }
    const pauserKp = state.roles.pauser.keypair;
    if (!pauserKp) {
      setFactoryError("Pauser keypair is required");
      return;
    }

    setIsDeploying(true);
    setFactoryError("");
    try {
      setDeployStatus("Uploading issuer WASM...");
      const issuerHash = await uploadWasm({
        wasmBytes: issuerWasm,
        signerKeypair: ownerKp,
      });

      setDeployStatus("Uploading factory WASM...");
      const factoryHash = await uploadWasm({
        wasmBytes: factoryWasm,
        signerKeypair: ownerKp,
      });

      setDeployStatus("Deploying factory contract...");
      const factoryId = await deployContract({
        wasmHash: factoryHash,
        constructorArgs: [
          toScValAddress(ownerKp.publicKey()),
          toScValAddress(pauserKp.publicKey()),
          toScValBytes32(hexToBytes(issuerHash)),
        ],
        signerKeypair: ownerKp,
      });

      dispatch({ type: "SET_FACTORY", factoryContractId: factoryId });
      setDeployStatus(`Factory deployed: ${factoryId}`);
    } catch (e) {
      setFactoryError(
        `Deploy failed: ${errorMessage(e)}`,
      );
      setDeployStatus("");
    } finally {
      setIsDeploying(false);
    }
  }, [issuerWasm, factoryWasm, state.roles, dispatch]);

  // Step 4 — Create issuer
  const handleCreateIssuer = useCallback(async () => {
    const ownerKp = state.roles.owner.keypair;
    const managerKp = state.roles.manager.keypair;
    if (!ownerKp || !managerKp || !state.factoryContractId || !state.tokenContractId) {
      setCreateIssuerError("Missing prerequisites");
      return;
    }
    if (!destinationPub) {
      setCreateIssuerError("Generate a destination keypair first");
      return;
    }

    setIsCreatingIssuer(true);
    setCreateIssuerError("");
    setCreateIssuerSuccess("");
    try {
      const issuerId = hexToBytes(issuerIdInput);
      const issuerAddress = await createIssuer({
        factoryId: state.factoryContractId,
        issuerId,
        token: state.tokenContractId,
        manager: managerKp.publicKey(),
        destination: destinationPub,
        ownerKeypair: ownerKp,
      });

      dispatch({
        type: "SET_ISSUER",
        issuerContractId: issuerAddress,
        issuerId: issuerIdInput,
      });
      dispatch({ type: "SET_DESTINATION", destinationAddress: destinationPub });
      setCreateIssuerSuccess(`Issuer deployed: ${issuerAddress}`);
    } catch (e) {
      setCreateIssuerError(
        `Create failed: ${errorMessage(e)}`,
      );
    } finally {
      setIsCreatingIssuer(false);
    }
  }, [
    state.roles,
    state.factoryContractId,
    state.tokenContractId,
    issuerIdInput,
    destinationPub,
    dispatch,
  ]);

  return (
    <div>
      <Heading as="h1" size="md">
        Non-Custodial Debit Card
      </Heading>
      <Text as="p" size="sm">
        Reference implementation of Bridge&apos;s non-custodial debit card
        contracts on Stellar. Users keep funds in their own wallet and grant a
        capped allowance &mdash; the contract pulls funds only when a card
        payment is authorized.
      </Text>

      <div className="SetupGuide">
        <div className="SetupGuide__step">
          <span className="SetupGuide__number" data-complete={allKeypairsReady}>1</span>
          <span className="SetupGuide__text">Generate &amp; fund role keypairs</span>
        </div>
        <span className="SetupGuide__arrow">&rarr;</span>
        <div className="SetupGuide__step">
          <span className="SetupGuide__number" data-complete={!!state.tokenContractId}>2</span>
          <span className="SetupGuide__text">Set token contract</span>
        </div>
        <span className="SetupGuide__arrow">&rarr;</span>
        <div className="SetupGuide__step">
          <span className="SetupGuide__number" data-complete={!!state.factoryContractId}>3</span>
          <span className="SetupGuide__text">Deploy factory</span>
        </div>
        <span className="SetupGuide__arrow">&rarr;</span>
        <div className="SetupGuide__step">
          <span className="SetupGuide__number" data-complete={!!state.issuerContractId}>4</span>
          <span className="SetupGuide__text">Create issuer</span>
        </div>
      </div>

      {/* Step 1 — Keypairs */}
      <div className="PageSection">
        <div className="PageSection__title">
          <span
            className="PageSection__step"
            data-complete={allKeypairsReady}
          >
            1
          </span>
          Generate Keypairs
        </div>
        {!allFunded && (
          <div className="QuickSetup">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleQuickSetup}
              isLoading={isQuickSetup}
            >
              Generate &amp; Fund All Accounts
            </Button>
            {quickSetupStatus && (
              <span className="QuickSetup__status">{quickSetupStatus}</span>
            )}
          </div>
        )}
        {ROLES.map((role) => (
          <KeypairCard key={role} role={role} />
        ))}
      </div>

      {/* Step 2 — Token */}
      <div className="PageSection">
        <div className="PageSection__title">
          <span
            className="PageSection__step"
            data-complete={!!state.tokenContractId}
          >
            2
          </span>
          Set Token Contract
        </div>
        {state.tokenContractId ? (
          <div className="ResultValue">{state.tokenContractId}</div>
        ) : (
          <Card>
            <div className="FormStack">
              <Text as="p" size="xs">
                Enter the SEP-41 token contract ID (e.g. testnet native XLM
                SAC).
              </Text>
              <Button
                size="sm"
                variant="tertiary"
                onClick={() => setTokenInput("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC")}
              >
                Use Testnet XLM SAC
              </Button>
              <div className="FormRow">
                <Input
                  id="token-id"
                  fieldSize="sm"
                  label="Token Contract ID"
                  placeholder="C..."
                  value={tokenInput}
                  error={tokenError}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    setTokenError("");
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleSetToken}
                  disabled={!ownerFunded}
                >
                  Set
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Step 3 — Factory */}
      <div className="PageSection">
        <div className="PageSection__title">
          <span
            className="PageSection__step"
            data-complete={!!state.factoryContractId}
          >
            3
          </span>
          Connect or Deploy Factory
        </div>
        {state.factoryContractId ? (
          <div className="ResultValue">{state.factoryContractId}</div>
        ) : (
          <Card>
            <div className="FormStack">
              <div className="FormRow">
                <Button
                  size="sm"
                  variant={factoryMode === "existing" ? "primary" : "tertiary"}
                  onClick={() => setFactoryMode("existing")}
                >
                  Use Existing
                </Button>
                <Button
                  size="sm"
                  variant={factoryMode === "deploy" ? "primary" : "tertiary"}
                  onClick={() => setFactoryMode("deploy")}
                >
                  Deploy New
                </Button>
              </div>

              {factoryMode === "existing" ? (
                <div className="FormRow">
                  <Input
                    id="factory-id"
                    fieldSize="sm"
                    label="Factory Contract ID"
                    placeholder="C..."
                    value={factoryInput}
                    error={factoryError}
                    onChange={(e) => {
                      setFactoryInput(e.target.value);
                      setFactoryError("");
                    }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleVerifyFactory}
                    isLoading={isVerifying}
                    disabled={!allKeypairsReady}
                  >
                    Verify
                  </Button>
                </div>
              ) : (
                <div className="FormStack">
                  {bundledWasmsAvailable ? (
                    <Text as="p" size="xs">
                      Contracts built from this branch are bundled with the
                      preview and pre-loaded below. Upload your own WASMs to
                      override.
                    </Text>
                  ) : (
                    <Text as="p" size="xs">
                      Upload the compiled WASM files from{" "}
                      <code>contracts/target/</code>. Build them with{" "}
                      <code>make build</code>.
                    </Text>
                  )}
                  <div className="FormStack">
                    <label className="FileInput">
                      <span>Issuer WASM</span>
                      <input
                        type="file"
                        accept=".wasm"
                        onChange={handleFileUpload(setIssuerWasm)}
                      />
                      {issuerWasm && (
                        <span className="InlineSuccess">
                          {(issuerWasm.length / 1024).toFixed(1)} KB loaded
                        </span>
                      )}
                    </label>
                    <label className="FileInput">
                      <span>Factory WASM</span>
                      <input
                        type="file"
                        accept=".wasm"
                        onChange={handleFileUpload(setFactoryWasm)}
                      />
                      {factoryWasm && (
                        <span className="InlineSuccess">
                          {(factoryWasm.length / 1024).toFixed(1)} KB loaded
                        </span>
                      )}
                    </label>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleDeploy}
                    isLoading={isDeploying}
                    disabled={
                      !issuerWasm ||
                      !factoryWasm ||
                      !ownerFunded ||
                      !state.roles.pauser.keypair
                    }
                  >
                    Upload &amp; Deploy
                  </Button>
                  {deployStatus && (
                    <div className="InlineSuccess">{deployStatus}</div>
                  )}
                  {factoryError && (
                    <div className="InlineError">{factoryError}</div>
                  )}
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Step 4 — Create Issuer */}
      <div className="PageSection">
        <div className="PageSection__title">
          <span
            className="PageSection__step"
            data-complete={!!state.issuerContractId}
          >
            4
          </span>
          Create Issuer
        </div>
        {state.issuerContractId ? (
          <div className="FormStack">
            <div>
              <Text as="p" size="xs">
                <strong>Issuer ID:</strong>
              </Text>
              <div className="ResultValue">{state.issuerId}</div>
            </div>
            <div>
              <Text as="p" size="xs">
                <strong>Issuer Contract:</strong>
              </Text>
              <div className="ResultValue">{state.issuerContractId}</div>
            </div>
          </div>
        ) : (
          <Card>
            <div className="FormStack">
              <Text as="p" size="xs">
                Calls <code>factory.create_issuer()</code> to deploy a new issuer
                contract for this token and manager. The issuer contract is the
                on-chain spender that cardholders will approve.
              </Text>
              <Input
                id="issuer-id"
                fieldSize="sm"
                label="Issuer ID (hex, 32 bytes)"
                value={issuerIdInput}
                onChange={(e) => setIssuerIdInput(e.target.value)}
              />
              <Button
                size="sm"
                variant="tertiary"
                onClick={() => setIssuerIdInput(bytesToHex(randomBytes32()))}
              >
                Randomize
              </Button>
              <Text as="p" size="xs">
                <strong>Destination (settlement pool):</strong>{" "}
                {destinationPub ? (
                  <code>{destinationPub}</code>
                ) : (
                  <span className="InlineError">
                    Generate a Destination keypair in Step 1
                  </span>
                )}
              </Text>
              <Text as="p" size="xs">
                <strong>Manager:</strong>{" "}
                <code>
                  {state.roles.manager.keypair?.publicKey() ?? "not set"}
                </code>
              </Text>
              <Button
                size="sm"
                variant="secondary"
                onClick={handleCreateIssuer}
                isLoading={isCreatingIssuer}
                disabled={
                  !state.factoryContractId ||
                  !state.tokenContractId ||
                  !state.roles.owner.keypair ||
                  !state.roles.manager.keypair ||
                  !destinationPub
                }
              >
                Create Issuer
              </Button>
              {createIssuerError && (
                <div className="InlineError">{createIssuerError}</div>
              )}
              {createIssuerSuccess && (
                <div className="InlineSuccess">{createIssuerSuccess}</div>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};
