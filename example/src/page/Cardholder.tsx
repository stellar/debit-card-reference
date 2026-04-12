import { useState, useCallback } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState } from "@/store.ts";
import { approveSpender, getBalance, getAllowance } from "@/soroban/token.ts";
import { getSorobanServer } from "@/soroban/client.ts";
import { errorMessage } from "@/helper/errors.ts";
import { formatAmount, parseAmount, amountLabel, unitSuffix, useConvertOnUnitChange } from "@/helper/units.ts";

export const Cardholder = () => {
  const state = useAppState();
  const cardholderKp = state.roles.cardholder.keypair;
  const units = state.displayUnits;

  const [amount, setAmount] = useState("10000000000");
  const [expirationOffset, setExpirationOffset] = useState("1000");
  const [isApproving, setIsApproving] = useState(false);
  const [approveResult, setApproveResult] = useState("");
  const [approveError, setApproveError] = useState("");

  useConvertOnUnitChange(units, setAmount);

  const [balance, setBalance] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

  const handleApprove = useCallback(async () => {
    if (!cardholderKp || !state.tokenContractId || !state.issuerContractId)
      return;

    setIsApproving(true);
    setApproveError("");
    setApproveResult("");
    try {
      const server = getSorobanServer();
      const latest = await server.getLatestLedger();
      const expirationLedger =
        latest.sequence + parseInt(expirationOffset, 10);

      await approveSpender({
        tokenId: state.tokenContractId,
        cardholderKeypair: cardholderKp,
        spenderAddress: state.issuerContractId,
        amount: parseAmount(amount, units),
        expirationLedger,
      });
      setApproveResult(
        `Approved ${amount} ${unitSuffix(units)}, expires at ledger ${expirationLedger}`,
      );
    } catch (e) {
      setApproveError(errorMessage(e));
    } finally {
      setIsApproving(false);
    }
  }, [cardholderKp, state.tokenContractId, state.issuerContractId, amount, expirationOffset, units]);

  const handleQueryBalances = useCallback(async () => {
    if (!cardholderKp || !state.tokenContractId) return;
    setIsQuerying(true);
    try {
      const [bal, allow] = await Promise.all([
        getBalance({
          tokenId: state.tokenContractId,
          address: cardholderKp.publicKey(),
          callerPublicKey: cardholderKp.publicKey(),
        }),
        state.issuerContractId
          ? getAllowance({
              tokenId: state.tokenContractId,
              from: cardholderKp.publicKey(),
              spender: state.issuerContractId,
              callerPublicKey: cardholderKp.publicKey(),
            })
          : Promise.resolve(null),
      ]);
      setBalance(bal.toString());
      if (allow !== null) setAllowance(allow.toString());
    } catch {
      // queries may fail if token doesn't support balance/allowance yet
    } finally {
      setIsQuerying(false);
    }
  }, [cardholderKp, state.tokenContractId, state.issuerContractId]);

  return (
    <div>
      <Heading as="h1" size="md">
        Cardholder
      </Heading>
      <Text as="p" size="sm">
        Approve the issuer contract to spend your tokens.
      </Text>

      <div className="PageSection">
        <div className="PageSection__title">Token Approve</div>
        <Card>
          <div className="FormStack">
            <Text as="p" size="xs">
              Issuer contract:{" "}
              <code>{state.issuerContractId ?? "not set"}</code>
            </Text>
            <Input
              id="approve-amount"
              fieldSize="sm"
              label={amountLabel("Amount", units)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              id="approve-expiration"
              fieldSize="sm"
              label="Expiration Offset (ledgers from now)"
              value={expirationOffset}
              onChange={(e) => setExpirationOffset(e.target.value)}
              note="~5 sec per ledger. 1000 ledgers ≈ 83 min"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleApprove}
              isLoading={isApproving}
            >
              Approve
            </Button>
            {approveResult && (
              <div className="InlineSuccess">{approveResult}</div>
            )}
            {approveError && (
              <div className="InlineError">{approveError}</div>
            )}
          </div>
        </Card>
      </div>

      <div className="PageSection">
        <div className="PageSection__title">Balance &amp; Allowance</div>
        <Card>
          <div className="FormStack">
            <Button
              size="sm"
              variant="tertiary"
              onClick={handleQueryBalances}
              isLoading={isQuerying}
            >
              Refresh
            </Button>
            {balance !== null && (
              <Text as="p" size="xs">
                <strong>Balance:</strong> {formatAmount(balance!, units)} {unitSuffix(units)}
              </Text>
            )}
            {allowance !== null && (
              <Text as="p" size="xs">
                <strong>Allowance:</strong> {formatAmount(allowance!, units)} {unitSuffix(units)}
              </Text>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
