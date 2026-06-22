const statusMap = {
  done: '已完成',
  active: '生成中',
  queued: '排队中',
  waiting: '等待中',
  locked: '待提交',
  failed: '失败',
  canceled: '已取消',
};

export default function StatusPill({ status }) {
  return <span className={`status-pill ${status}`}>{statusMap[status]}</span>;
}
