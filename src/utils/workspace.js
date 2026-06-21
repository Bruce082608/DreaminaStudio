function getSceneDurations(duration, segmentDuration) {
  const count = Math.ceil(duration / segmentDuration);
  const durations = Array.from({ length: count }, () => segmentDuration);
  durations[durations.length - 1] = duration - segmentDuration * (count - 1);

  if (durations.length > 1 && durations[durations.length - 1] < 4) {
    const combined = durations[durations.length - 2] + durations[durations.length - 1];
    durations[durations.length - 2] = Math.floor(combined / 2);
    durations[durations.length - 1] = combined - durations[durations.length - 2];
  }
  return durations;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function createScenes(duration, idea, style, segmentDuration = 10, projectId = 'demo') {
  const titles = [
    '开场氛围建立',
    '主角动机显现',
    '关键线索出现',
    '空间关系推进',
    '情绪转折',
    '动作段落展开',
    '冲突升级',
    '视觉高潮',
    '尾声与回响',
  ];

  let start = 0;
  return getSceneDurations(duration, segmentDuration).map((sceneDuration, index) => {
    const end = start + sceneDuration;
    const status = 'locked';
    const scene = {
      id: `${projectId}-scene-${index + 1}`,
      number: String(index + 1).padStart(2, '0'),
      time: `${formatTime(start)} - ${formatTime(end)}`,
      title: titles[index % titles.length],
      status,
      progress: 0,
      prompt: `${style}，延续同一角色、场景光线和镜头语言：${idea}`,
      duration: sceneDuration,
    };
    start = end;
    return scene;
  });
}
