import { Logo, ThemeSwitch } from "@stellar/design-system";
import { NetworkIndicator } from "@/component/NetworkIndicator/index.tsx";

export const Header = () => {
  return (
    <header className="StellarApp__header">
      <div className="StellarApp__headerLeft">
        <div className="StellarApp__logo">
          <Logo.Stellar />
        </div>
        <span className="StellarApp__headerTitle">Debit Card Reference</span>
        <NetworkIndicator networkId="testnet" networkLabel="Testnet" />
      </div>
      <ThemeSwitch storageKeyId="debitCardDemoTheme" />
    </header>
  );
};
