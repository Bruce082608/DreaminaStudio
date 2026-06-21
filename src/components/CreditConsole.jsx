import { AlertTriangle, Check, Coins } from 'lucide-react';
import { formatCny, formatNumber } from '../utils/formatters';
import '../styles/credit-console.css';

export default function CreditConsole({
  activeCreditCost,
  balance,
  billing,
  billingError,
  hasEnoughCredits = true,
  isAdmin = false,
  onConfirmRecharge,
  onRecharge,
  onSelectPackage,
  pendingRechargeRequests = [],
  rechargingPackageId,
  selectedPackageId = '',
  summaryText,
  title = '我的积分',
}) {
  const hasCostPreview = Number.isFinite(Number(activeCreditCost));
  const packages = billing?.packages || [];
  const selectedPackage = packages.find((packageItem) => packageItem.id === selectedPackageId);

  return (
    <>
      <section className="credit-console" aria-label="用户积分与充值">
        <div className="credit-balance-block">
          <span>
            <Coins size={17} />
            {title}
          </span>
          <strong>{formatNumber(balance, '0')}</strong>
          <small className={hasEnoughCredits || !hasCostPreview ? '' : 'warning'}>
            {summaryText || (hasCostPreview ? `本次预计消耗 ${activeCreditCost} 积分` : isAdmin ? '管理员充值会直接到账' : '提交后扫码付款，管理员确认后到账')}
          </small>
        </div>
        <div className="recharge-package-row">
          {packages.map((packageItem) => {
            const firstUsed = packageItem.firstPurchaseOnly && !billing?.firstRechargeAvailable;
            const pendingRequest = pendingRechargeRequests.find((request) => request.packageId === packageItem.id);
            return (
              <button
                className={[
                  packageItem.firstPurchaseOnly ? 'featured' : '',
                  selectedPackageId === packageItem.id ? 'selected' : '',
                ].filter(Boolean).join(' ')}
                disabled={Boolean(rechargingPackageId) || firstUsed}
                key={packageItem.id}
                onClick={() => {
                  if (onSelectPackage) {
                    onSelectPackage(packageItem.id);
                    return;
                  }
                  onRecharge?.(packageItem.id);
                }}
                type="button"
              >
                <span>
                  <strong>{packageItem.credits}积分</strong>
                  {pendingRequest ? (
                    <em className="pending">待付款</em>
                  ) : packageItem.badge ? (
                    <em>{firstUsed ? '已使用' : packageItem.badge}</em>
                  ) : null}
                </span>
                <small>
                  {packageItem.originalPriceCny ? <del>{formatCny(packageItem.originalPriceCny)}</del> : null}
                  <b>{formatCny(packageItem.priceCny)}</b>
                </small>
              </button>
            );
          })}
        </div>
        {onConfirmRecharge ? (
          <div className="recharge-confirm-row">
            <span>
              {selectedPackage
                ? `已选择 ${selectedPackage.label}：${selectedPackage.credits} 积分 / ${formatCny(selectedPackage.priceCny)}`
                : '请选择一个充值档位'}
            </span>
            <button
              disabled={!selectedPackage || Boolean(rechargingPackageId)}
              onClick={onConfirmRecharge}
              type="button"
            >
              {rechargingPackageId ? null : <Check size={16} />}
              {rechargingPackageId ? '正在下单...' : isAdmin ? '确认充值' : '确认下单'}
            </button>
          </div>
        ) : null}
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
