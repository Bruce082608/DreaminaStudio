export const durationOptions = [
  { label: '15秒', value: 15 },
  { label: '30秒', value: 30 },
  { label: '45秒', value: 45 },
  { label: '1分钟', value: 60 },
  { label: '2分钟', value: 120 },
  { label: '3分钟', value: 180 },
  { label: '5分钟', value: 300 },
  { label: '7分钟', value: 420 },
  { label: '10分钟', value: 600 },
];

export const segmentDurationOptions = [5, 10, 15];

export const styleOptions = ['电影感', '写实', '动漫', '商业广告', 'MV', '纪录片', '跟随参考图'];
export const ratioOptions = ['1:1', '3:4', '16:9', '4:3', '9:16', '21:9'];

export const jimengModelOptions = [
  {
    value: 'seedance2.0fast',
    label: 'Seedance 2.0 Fast',
    shortLabel: 'Seedance 2.0 Fast',
    pricePer5: 10,
    priceLabel: '10积分 / 5秒',
    speed: '更快',
    quality: '标准',
    cost: '10积分 / 5秒',
  },
  {
    value: 'seedance2.0',
    label: 'Seedance 2.0',
    shortLabel: 'Seedance 2.0',
    pricePer5: 15,
    priceLabel: '15积分 / 5秒',
    speed: '均衡',
    quality: '高',
    cost: '15积分 / 5秒',
  },
  {
    value: 'seedance2.0mini',
    label: 'Seedance 2.0 Mini',
    shortLabel: 'Seedance 2.0 Mini',
    pricePer5: 30,
    priceLabel: '30积分 / 5秒',
    speed: '最快',
    quality: '轻量',
    cost: '30积分 / 5秒',
  },
  {
    value: 'seedance2.0_vip',
    label: 'Seedance 2.0 VIP',
    shortLabel: 'Seedance 2.0 VIP',
    pricePer5: 70,
    priceLabel: '70积分 / 5秒',
    speed: '较慢',
    quality: '最高',
    cost: '70积分 / 5秒',
  },
  {
    value: 'seedance2.0fast_vip',
    label: 'Seedance 2.0 Fast VIP',
    shortLabel: 'Seedance 2.0 Fast VIP',
    pricePer5: 45,
    priceLabel: '45积分 / 5秒',
    speed: '快',
    quality: '高',
    cost: '45积分 / 5秒',
  },
];

export const jimengCliDocs = [
  {
    title: '登录与账号',
    points: [
      '首次使用先运行 dreamina login；本地会保存 OAuth 登录态。',
      'headless 登录会输出 verification_uri、user_code、device_code，需要再用 checklogin 完成登录。',
      'dreamina user_credit 可读取账号剩余积分，dreamina list_task 可查看最近任务。',
    ],
  },
  {
    title: '视频生成命令',
    points: [
      'prompt-only 视频使用 dreamina text2video。',
      '带参考图、视频或音频时使用 dreamina multimodal2video；本地文件会自动上传。',
      '异步任务可用 --poll 短暂等待；后续用 dreamina query_result --submit_id 查询。',
    ],
  },
  {
    title: '模型与限制',
    points: [
      '官方 CLI 支持 seedance2.0、seedance2.0fast、seedance2.0_vip、seedance2.0fast_vip、seedance2.0mini。',
      '单段视频 duration 支持 4-15 秒，本网站会按目标总长拆分为多段顺序生成。',
      'ratio 支持 1:1、3:4、16:9、4:3、9:16、21:9；当前创作台开放常用画幅。',
    ],
  },
  {
    title: '素材与分辨率',
    points: [
      'multimodal2video 至少需要一个 image 或 video 输入。',
      '参考素材限制：image<=9、video<=3、audio<=3；audio 需为 2-15 秒。',
      'seedance2.0_vip 支持 720p 或 1080p，其余模型官方帮助标注为 720p。',
    ],
  },
  {
    title: '计费与风险',
    points: [
      '所有真实生成都会消耗积分，测试前应先确认账号余额。',
      'CLI 帮助不直接给出固定积分单价，实际消耗以 list_task 返回的 credit_count 为准。',
      '部分高内容安全风险模型首次使用前可能需要在 Web 端授权；遇到 AigcComplianceConfirmationRequired 后先完成网页确认再重试。',
    ],
  },
];

export function getJimengModelOption(value) {
  return jimengModelOptions.find((option) => option.value === value) || jimengModelOptions[0];
}

export function calculateCreditCost(model, durations) {
  const option = getJimengModelOption(model);
  return durations.reduce((sum, duration) => (
    sum + Math.max(Math.ceil(Number(duration || 0) / 5), 1) * option.pricePer5
  ), 0);
}
