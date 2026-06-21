export function getRechargeRequestStatusMeta(status) {
  const statusMap = {
    pending: { label: '待付款/待确认', tone: 'queued' },
    approved: { label: '已入账', tone: 'done' },
    rejected: { label: '已驳回', tone: 'failed' },
    canceled: { label: '已取消', tone: 'locked' },
  };
  return statusMap[status] || { label: status || '未知', tone: 'queued' };
}
