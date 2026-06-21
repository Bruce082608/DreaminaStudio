import { useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Clock3,
  Coins,
  CreditCard,
  Loader2,
  LogOut,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { BrandLogo, CreditNavButton, UserIdentityButton } from '../components/AppChrome';
import CreditConsole from '../components/CreditConsole';
import { formatCny, formatDate, formatNumber } from '../utils/formatters';
import { getRechargeRequestStatusMeta } from '../utils/recharge';

const PAYMENT_QR_SRC = '/payment/alipay-qr.jpg';

function getTransactionMeta(transaction) {
  if (transaction.type === 'recharge') return { label: '充值', tone: 'recharge', sign: '+' };
  if (transaction.type === 'debit') return { label: '使用', tone: 'debit', sign: '' };
  if (transaction.type === 'bonus') return { label: '赠送', tone: 'bonus', sign: '+' };
  return { label: transaction.type || '记录', tone: 'neutral', sign: transaction.amount > 0 ? '+' : '' };
}

function CreditTransactionList({ emptyText, title, transactions }) {
  return (
    <section className="credit-ledger-panel">
      <div className="section-heading">
        <span>
          <CreditCard size={18} />
          {title}
        </span>
        <small>{transactions.length} 条</small>
      </div>
      {transactions.length > 0 ? (
        <div className="credit-transaction-list">
          {transactions.map((transaction) => {
            const meta = getTransactionMeta(transaction);
            return (
              <article className="credit-transaction-row" key={transaction.id}>
                <span className={`credit-transaction-type ${meta.tone}`}>{meta.label}</span>
                <span>
                  <strong>{transaction.description}</strong>
                  <small>{formatDate(transaction.createdAt)}</small>
                </span>
                <em className={transaction.amount >= 0 ? 'positive' : 'negative'}>
                  {meta.sign}{formatNumber(transaction.amount)}
                </em>
                <small>余额 {formatNumber(transaction.balanceAfter)}</small>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-credit-ledger">{emptyText}</div>
      )}
    </section>
  );
}

function RechargePaymentPanel({ canceling, panelRef, request, onCancel, onClose, onRefresh }) {
  if (!request) return null;
  const statusMeta = getRechargeRequestStatusMeta(request.status);

  return (
    <section className="payment-modal-backdrop" ref={panelRef} role="dialog" aria-modal="true" aria-label="充值订单详情">
      <article className="payment-panel">
        <div className="section-heading payment-heading">
          <span>
            <CreditCard size={18} />
            充值订单详情
          </span>
          <small>申请单 {request.id}</small>
        </div>

        <div className="payment-layout">
          <div className="payment-qr-frame">
            <img src={PAYMENT_QR_SRC} alt="支付宝收款码" />
          </div>
          <div className="payment-detail-card">
            <span className={`status-pill ${statusMeta.tone}`}>{statusMeta.label}</span>
            <h2>{request.packageLabel}</h2>
            <div className="payment-amount-grid">
              <span>
                <small>付款金额</small>
                <strong>{formatCny(request.priceCny)}</strong>
              </span>
              <span>
                <small>到账积分</small>
                <strong>{formatNumber(request.credits)}</strong>
              </span>
            </div>
            <p>请核对订单信息后扫码付款，管理员确认到账后会为你的账号增加积分。</p>
            <dl>
              <div>
                <dt>账号</dt>
                <dd>{request.userEmail}</dd>
              </div>
              <div>
                <dt>提交时间</dt>
                <dd>{formatDate(request.createdAt)}</dd>
              </div>
            </dl>
            <div className="payment-actions">
              <button className="primary-button" type="button" onClick={onRefresh}>
                <RefreshCw size={18} />
                我已付款，刷新状态
              </button>
              {request.status === 'pending' ? (
                <button className="ghost-button danger" disabled={canceling} type="button" onClick={() => onCancel(request.id)}>
                  {canceling ? <Loader2 className="spin" size={16} /> : <AlertTriangle size={16} />}
                  取消订单
                </button>
              ) : null}
              <button className="secondary-link-button" type="button" onClick={onClose}>
                关闭
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}

function RechargeRequestHistory({ requests, onPay }) {
  return (
    <section className="credit-ledger-panel recharge-request-panel">
      <div className="section-heading">
        <span>
          <Clock3 size={18} />
          充值申请
        </span>
        <small>{requests.length ? `${requests.length} 条记录` : '暂无待处理申请'}</small>
      </div>

      {requests.length ? (
        <div className="recharge-request-stack">
          {requests.map((request) => {
            const statusMeta = getRechargeRequestStatusMeta(request.status);
            return (
              <article className="recharge-request-card" key={request.id}>
                <span className={`status-pill ${statusMeta.tone}`}>{statusMeta.label}</span>
                <div>
                  <strong>{request.packageLabel}</strong>
                  <small>{formatDate(request.createdAt)} / {request.id}</small>
                </div>
                <em>{formatCny(request.priceCny)}</em>
                <b>{formatNumber(request.credits)} 积分</b>
                {request.status === 'pending' ? (
                  <button className="ghost-button" type="button" onClick={() => onPay(request)}>
                    <CreditCard size={16} />
                    扫码付款
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-credit-ledger">暂无充值申请</div>
      )}
    </section>
  );
}

export default function CreditPage({ auth, billingState, onLogout, onShowCreate, onShowHome, onShowProfile }) {
  const {
    billing,
    billingError,
    cancelRechargeRequest,
    handleRecharge,
    rechargeRequests,
    rechargingPackageId,
    refreshBilling,
    refreshRechargeRequests,
  } = billingState;
  const [selectedRechargePackageId, setSelectedRechargePackageId] = useState('');
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [cancelingRequestId, setCancelingRequestId] = useState('');
  const paymentPanelRef = useRef(null);
  const balance = billing?.balance ?? auth?.user?.creditBalance ?? 0;
  const transactions = billing?.transactions || [];
  const usageTransactions = transactions.filter((transaction) => transaction.type === 'debit');
  const rechargeTransactions = transactions.filter((transaction) => transaction.type === 'recharge');
  const bonusTransactions = transactions.filter((transaction) => transaction.type === 'bonus');
  const pendingRechargeRequests = (rechargeRequests || []).filter((request) => request.status === 'pending');

  async function handleConfirmRecharge() {
    if (!selectedRechargePackageId) return;
    const result = await handleRecharge(selectedRechargePackageId);
    if (result?.mode === 'payment') {
      setSelectedRechargePackageId('');
      setPaymentRequest(result.request);
      return;
    }
    if (result?.mode === 'direct') {
      setSelectedRechargePackageId('');
      setPaymentRequest(null);
    }
  }

  async function handleRefreshPaymentStatus() {
    const [, nextRequests = []] = await Promise.all([
      refreshBilling(),
      refreshRechargeRequests?.(),
    ]);
    if (paymentRequest && Array.isArray(nextRequests)) {
      const updatedRequest = nextRequests.find((request) => request.id === paymentRequest.id);
      if (updatedRequest) setPaymentRequest(updatedRequest);
    }
  }

  async function handleCancelPaymentRequest(requestId) {
    setCancelingRequestId(requestId);
    const canceledRequest = await cancelRechargeRequest?.(requestId);
    if (canceledRequest) {
      setPaymentRequest(canceledRequest);
      await refreshRechargeRequests?.();
    }
    setCancelingRequestId('');
  }

  return (
    <main className="workspace-shell credit-page-shell">
      <header className="app-header">
        <div className="brand-mark">
          <BrandLogo />
          <span>Dreamina Studio</span>
        </div>
        <div className="header-actions">
          <UserIdentityButton user={auth?.user} onClick={onShowProfile} />
          <CreditNavButton balance={balance} onClick={refreshBilling} />
          <button className="icon-text-button" onClick={onShowCreate}>
            <WandSparkles size={16} />
            创作台
          </button>
          <button className="icon-text-button" onClick={onShowHome}>
            <Sparkles size={16} />
            团队官网
          </button>
          <button className="icon-button" title="退出登录" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="credit-dashboard">
        <div className="credit-page-hero">
          <div>
            <div className="eyebrow">
              <Coins size={14} />
              积分中心
            </div>
            <h1>积分详情</h1>
            <p>查看当前余额、使用记录和充值记录。</p>
          </div>
          <div className="credit-total-tile">
            <span>当前余额</span>
            <strong>{formatNumber(balance, '0')}</strong>
            <small>积分</small>
          </div>
        </div>

        <CreditConsole
          balance={balance}
          billing={billing}
          billingError={billingError}
          isAdmin={auth?.user?.role === 'admin'}
          onConfirmRecharge={handleConfirmRecharge}
          onSelectPackage={setSelectedRechargePackageId}
          pendingRechargeRequests={pendingRechargeRequests}
          rechargingPackageId={rechargingPackageId}
          selectedPackageId={selectedRechargePackageId}
          summaryText={auth?.user?.role === 'admin' ? '管理员充值会直接到账' : '普通用户扫码付款，管理员确认后到账'}
          title="可用积分"
        />

        <RechargePaymentPanel
          canceling={cancelingRequestId === paymentRequest?.id}
          panelRef={paymentPanelRef}
          request={paymentRequest}
          onCancel={handleCancelPaymentRequest}
          onClose={() => setPaymentRequest(null)}
          onRefresh={handleRefreshPaymentStatus}
        />

        {auth?.user?.role !== 'admin' ? (
          <RechargeRequestHistory
            requests={rechargeRequests || []}
            onPay={setPaymentRequest}
          />
        ) : null}

        <div className="credit-ledger-grid">
          <CreditTransactionList
            emptyText="暂无积分使用记录"
            title="积分使用详情"
            transactions={usageTransactions}
          />
          <CreditTransactionList
            emptyText="暂无充值记录"
            title="充值详情"
            transactions={rechargeTransactions}
          />
        </div>

        {bonusTransactions.length > 0 ? (
          <CreditTransactionList
            emptyText="暂无赠送记录"
            title="赠送记录"
            transactions={bonusTransactions}
          />
        ) : null}
      </section>
    </main>
  );
}
