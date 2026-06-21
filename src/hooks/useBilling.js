import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';

export default function useBilling(authToken, authUser) {
  const [billing, setBilling] = useState(null);
  const [billingError, setBillingError] = useState('');
  const [rechargeRequests, setRechargeRequests] = useState([]);
  const [rechargingPackageId, setRechargingPackageId] = useState('');
  const isAdmin = authUser?.role === 'admin';

  async function refreshRechargeRequests() {
    if (!authToken || isAdmin) {
      setRechargeRequests([]);
      return [];
    }
    const nextRequests = await apiRequest('/billing/recharge-requests/me', { authToken });
    setRechargeRequests(nextRequests);
    return nextRequests;
  }

  async function refreshBilling() {
    if (!authToken) return null;
    const [nextBilling] = await Promise.all([
      apiRequest('/billing/me', { authToken }),
      refreshRechargeRequests().catch(() => []),
    ]);
    setBilling(nextBilling);
    setBillingError('');
    return nextBilling;
  }

  async function handleRecharge(packageId) {
    if (!authToken || rechargingPackageId) return null;
    setRechargingPackageId(packageId);
    setBillingError('');

    try {
      if (isAdmin) {
        const nextBilling = await apiRequest('/billing/recharge', {
          method: 'POST',
          authToken,
          body: JSON.stringify({ packageId }),
        });
        setBilling(nextBilling);
        return { mode: 'direct', billing: nextBilling };
      }

      const rechargeRequest = await apiRequest('/billing/recharge-requests', {
        method: 'POST',
        authToken,
        body: JSON.stringify({ packageId }),
      });
      setRechargeRequests((current) => {
        const rest = current.filter((item) => item.id !== rechargeRequest.id);
        return [rechargeRequest, ...rest].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      });
      return { mode: 'payment', request: rechargeRequest };
    } catch (error) {
      setBillingError(error.message);
      return null;
    } finally {
      setRechargingPackageId('');
    }
  }

  async function cancelRechargeRequest(requestId) {
    if (!authToken || !requestId) return null;
    setBillingError('');

    try {
      const canceledRequest = await apiRequest(`/billing/recharge-requests/${requestId}/cancel`, {
        method: 'POST',
        authToken,
      });
      setRechargeRequests((current) => {
        const rest = current.filter((item) => item.id !== canceledRequest.id);
        return [canceledRequest, ...rest].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      });
      return canceledRequest;
    } catch (error) {
      setBillingError(error.message);
      return null;
    }
  }

  async function markRechargeRequestPaid(requestId) {
    if (!authToken || !requestId) return null;
    setBillingError('');

    try {
      const paidRequest = await apiRequest(`/billing/recharge-requests/${requestId}/mark-paid`, {
        method: 'POST',
        authToken,
      });
      setRechargeRequests((current) => {
        const rest = current.filter((item) => item.id !== paidRequest.id);
        return [paidRequest, ...rest].sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
      });
      return paidRequest;
    } catch (error) {
      setBillingError(error.message);
      return null;
    }
  }

  useEffect(() => {
    let isMounted = true;

    if (!authToken) {
      return () => {
        isMounted = false;
      };
    }

    const billingRequest = apiRequest('/billing/me', { authToken });
    const rechargeRequest = isAdmin
      ? Promise.resolve([])
      : apiRequest('/billing/recharge-requests/me', { authToken });

    Promise.all([billingRequest, rechargeRequest])
      .then(([nextBilling, nextRequests]) => {
        if (isMounted) {
          setBilling(nextBilling);
          setRechargeRequests(nextRequests);
          setBillingError('');
        }
      })
      .catch((error) => {
        if (isMounted) setBillingError(error.message);
      });

    return () => {
      isMounted = false;
    };
  }, [authToken, isAdmin]);

  return {
    billing: authToken ? billing : null,
    billingError: authToken ? billingError : '',
    cancelRechargeRequest,
    handleRecharge,
    markRechargeRequestPaid,
    rechargeRequests: authToken ? rechargeRequests : [],
    rechargingPackageId,
    refreshBilling,
    refreshRechargeRequests,
  };
}
