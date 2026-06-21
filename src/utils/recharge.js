export function getRechargeRequestStatusMeta(status) {
  const statusMap = {
    pending: { label: '待付款', tone: 'queued' },
    processing: { label: '发放中', tone: 'active' },
    approved: { label: '已入账', tone: 'done' },
    rejected: { label: '已驳回', tone: 'failed' },
    canceled: { label: '已取消', tone: 'locked' },
  };
  return statusMap[status] || { label: status || '未知', tone: 'queued' };
}
