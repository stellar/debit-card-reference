import { useState, useCallback } from "react";
import { Button, Card, Heading, Input, Text } from "@stellar/design-system";

import { useAppState } from "@/store.ts";
import { hexToBytes, randomBytes32, bytesToHex } from "@/soroban/codec.ts";
import { transferToDestination } from "@/soroban/factory.ts";
import { errorMessage } from "@/helper/errors.ts";
import { parseAmount, amountLabel, unitSuffix, useConvertOnUnitChange } from "@/helper/units.ts";

export const Debitor = () => {
  const state = useAppState();
  const debitorKp = state.roles.debitor.keypair;
  const cardholderPub = state.roles.cardholder.keypair?.publicKey() ?? "";

  const units = state.displayUnits;
  const [account, setAccount] = useState(cardholderPub);
  const [amount, setAmount] = useState("1000000");
  const [destination, setDestination] = useState(
    state.destinationAddress ?? "",
  );
  const [uuid, setUuid] = useState(() => bytesToHex(randomBytes32()));
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferResult, setTransferResult] = useState("");
  const [transferError, setTransferError] = useState("");

  useConvertOnUnitChange(units, setAmount);

  const handleTransfer = useCallback(async () => {
    if (
      !debitorKp ||
      !state.factoryContractId ||
      !state.issuerId ||
      !state.tokenContractId
    )
      return;

    setIsTransferring(true);
    setTransferError("");
    setTransferResult("");
    try {
      await transferToDestination({
        factoryId: state.factoryContractId,
        issuerId: hexToBytes(state.issuerId),
        token: state.tokenContractId,
        debitor: debitorKp.publicKey(),
        account,
        amount: parseAmount(amount, units),
        destination,
        uuid: hexToBytes(uuid),
        debitorKeypair: debitorKp,
      });
      setTransferResult(
        `Transfer of ${amount} ${unitSuffix(units)} executed successfully (uuid: ${uuid.slice(0, 16)}...)`,
      );
      // Generate new UUID for next transfer
      setUuid(bytesToHex(randomBytes32()));
    } catch (e) {
      setTransferError(errorMessage(e));
    } finally {
      setIsTransferring(false);
    }
  }, [
    debitorKp,
    state.factoryContractId,
    state.issuerId,
    state.tokenContractId,
    account,
    amount,
    destination,
    uuid,
    units,
  ]);

  return (
    <div>
      <Heading as="h1" size="md">
        Debitor
      </Heading>
      <Text as="p" size="sm">
        Execute card payment transfers from cardholder wallet to destination.
      </Text>

      <div className="PageSection">
        <div className="PageSection__title">Transfer to Destination</div>
        <Card>
          <div className="FormStack">
            <Input
              id="transfer-account"
              fieldSize="sm"
              label="Cardholder Account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            />
            <Input
              id="transfer-amount"
              fieldSize="sm"
              label={amountLabel("Amount", units)}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Input
              id="transfer-destination"
              fieldSize="sm"
              label="Destination Address"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            />
            <div className="FormRow">
              <Input
                id="transfer-uuid"
                fieldSize="sm"
                label="UUID (hex, 32 bytes)"
                value={uuid}
                onChange={(e) => setUuid(e.target.value)}
              />
              <Button
                size="sm"
                variant="tertiary"
                onClick={() => setUuid(bytesToHex(randomBytes32()))}
              >
                Randomize
              </Button>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleTransfer}
              isLoading={isTransferring}
            >
              Execute Transfer
            </Button>
            {transferResult && (
              <div className="InlineSuccess">{transferResult}</div>
            )}
            {transferError && (
              <div className="InlineError">{transferError}</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
