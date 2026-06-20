import { AlertTriangle, Coins } from 'lucide-react';
import { formatCny, formatNumber } from '../utils/formatters';
import '../styles/credit-console.css';

export default function CreditConsole({
  activeCreditCost,
  balance,
  billing,
  billingError,
  hasEnoughCredits,
  onRecharge,
  rechargingPackageId,
}) {
  return (
    <>
      <section className="credit-console" aria-label="用户积分与充值">
        <div className="credit-balance-block">
          <span>
            <Coins size={17} />
            我的积分
          </span>
          <strong>{formatNumber(balance, '0')}</strong>
          <small className={hasEnoughCredits ? '' : 'warning'}>
            本次预计消耗 {activeCreditCost} 积分
          </small>
        </div>
        <div className="recharge-package-row">
          {(billing?.packages || []).map((packageItem) => {
            const firstUsed = packageItem.firstPurchaseOnly && !billing?.firstRechargeAvailable;
            return (
              <button
                className={packageItem.firstPurchaseOnly ? 'featured' : ''}
                disabled={Boolean(rechargingPackageId) || firstUsed}
                key={packageItem.id}
                onClick={() => onRecharge(packageItem.id)}
                type="button"
              >
                <span>
                  <strong>{packageItem.credits}积分</strong>
                  {packageItem.badge ? <em>{firstUsed ? '已使用' : packageItem.badge}</em> : null}
                </span>
                <small>
                  {packageItem.originalPriceCny ? <del>{formatCny(packageItem.originalPriceCny)}</del> : null}
                  <b>{formatCny(packageItem.priceCny)}</b>
                </small>
              </button>
            );
          })}
        </div>
      </section>
      {billingError ? (
        <div className="api-error">
          <AlertTriangle size={15} />
          <span>{billingError}</span>
        </div>
      ) : null}
    </>
  );
}
