export const sceneVisuals = Array.from({ length: 12 }, (_, index) =>
  new URL(`../assets/gallery/scene-${String(index + 1).padStart(2, '0')}.jpg`, import.meta.url).href,
);

export const agentStages = [
  '提交创意与参考图',
  '生成分镜剧本',
  '查看并编辑分镜',
  '即梦 CLI 串行生成',
  '返回视频片段结果',
];

export const agentStageLabels = {
  queued: '任务已进入队列',
  deepseek_planning: '正在规划分镜',
  storyboard_planning: '正在规划分镜',
  local_planning: '正在规划分镜',
  awaiting_confirmation: '分镜剧本等待确认',
  jimeng_dispatch: '正在提交视频生成任务',
  jimeng_generating: '即梦 CLI 正在逐段生成',
  completed: '视频片段已全部返回',
  failed: '任务处理失败',
};

export const agentStageIndexes = {
  queued: 0,
  deepseek_planning: 1,
  storyboard_planning: 1,
  local_planning: 1,
  awaiting_confirmation: 2,
  jimeng_dispatch: 3,
  jimeng_generating: 3,
  completed: 4,
  failed: 3,
};

export const AGENT_FAST_POLL_INTERVAL = 1200;
export const AGENT_POLL_INTERVAL = 10000;

export const initialWorkspace = {
  idea: '',
  duration: 180,
  segmentDuration: 15,
  style: '电影感',
  ratio: '16:9',
  jimengModel: 'seedance2.0fast',
};
