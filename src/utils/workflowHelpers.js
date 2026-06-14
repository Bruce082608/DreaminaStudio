/**
 * AI 短剧工作流核心逻辑工具库
 */

/**
 * 根据创意想法与目标总时长，生成三个不同的候选剧本
 *
 * @param {string} idea 创意想法
 * @param {number} totalDuration 目标视频时长 (秒)
 * @returns {Array} 包含三个候选剧本对象的数组
 */
export function generateCandidateScripts(idea, totalDuration) {
  if (!idea || !idea.trim()) return [];

  const cleanIdea = idea.trim();

  // 辅助函数：根据时长计算推荐镜头数量
  const getRecommendedShots = (duration) => {
    // 镜头时长在 5s 到 15s 之间，平均每个镜头 8s-10s
    if (duration <= 30) return 3;
    if (duration <= 60) return 6;
    return 8;
  };

  const shotCount = getRecommendedShots(totalDuration);

  return [
    {
      id: 'candidate-1',
      title: `《${cleanIdea.substring(0, 10) || '未命名'} · 温暖回响》`,
      tone: '温馨治愈 · 温暖麦芽色调',
      summary: '采用低饱和度大地暖色，聚焦角色的微小情绪变化，展现静谧时光中的温情碰撞。',
      estimatedShots: shotCount,
      scriptText: `# 《时光的温暖回响》\n\n` +
        `【镜头 1】\n` +
        `女主角推开咖啡馆木门，清晨的第一缕微光洒在她略带疲惫的脸上，风铃轻响。\n` +
        `（角色：苏菲 | 画面动作：推开木门，微风拂面，阳光温暖，微焦特写）\n\n` +
        `【镜头 2】\n` +
        `男主角站在吧台后，专注地调整磨豆机，随后抬头给了一个温暖的微笑。\n` +
        `（角色：林德 | 画面动作：专注磨咖啡豆，抬头微笑着打招呼，暖色调逆光）\n\n` +
        `【镜头 3】\n` +
        `男主角将带有精致旋转星系拉花的拿铁轻轻推向女主角。\n` +
        `（角色：苏菲, 林德 | 画面动作：在吧台递上拿铁，咖啡杯口冒着滚滚热气，双手接触的瞬间）\n\n` +
        (shotCount >= 6 ? 
        `【镜头 4】\n` +
        `女主角双手捧起咖啡杯，蒸汽让她的眼镜起了一层薄雾，她笑了笑。\n` +
        `（角色：苏菲 | 画面动作：双手捧着咖啡杯，雾气模糊镜片，开怀地笑，电影画质）\n\n` +
        `【镜头 5】\n` +
        `咖啡馆外，下起了蒙蒙细雨，将街道染成温润的墨黑色，而馆内却明亮而安详。\n` +
        `（角色：无 | 画面动作：咖啡馆外的细雨，玻璃窗上的雨滴，馆内散发的金黄色灯光）\n\n` +
        `【镜头 6】\n` +
        `两人对视，林德指向窗外雨中的一朵绽放的小花，两人相视一笑。\n` +
        `（角色：苏菲, 林德 | 画面动作：指着窗外细雨中的花朵，对视微笑，温馨极简）\n\n` : '') +
        (shotCount >= 8 ?
        `【镜头 7】\n` +
        `雨渐渐停了，一缕彩虹挂在远处的地平线上，折射出晶莹的光晕。\n` +
        `（角色：无 | 画面动作：雨后彩虹，街道反射着微弱的光芒，宽幅全景）\n\n` +
        `【镜头 8】\n` +
        `女主角起身道别，林德挥手致意，桌上空了的咖啡杯旁留着一张写着感谢的卡片。\n` +
        `（角色：苏菲, 林德 | 画面动作：道别离开，桌上放着小卡片，风铃再次晃动）\n\n` : '')
    },
    {
      id: 'candidate-2',
      title: `《${cleanIdea.substring(0, 10) || '未命名'} · 霓虹幻影》`,
      tone: '赛博科幻 · 琥珀蓝紫霓虹色调',
      summary: '高对比度的霓虹机械感，将温情置于冰冷的未来科技背景中，凸显人性与智能的交织。',
      estimatedShots: shotCount,
      scriptText: `# 《霓虹之下的温情幻影》\n\n` +
        `【镜头 1】\n` +
        `半机械人少女在雨夜走入泛着金属光泽的地下咖啡馆，义眼闪烁着幽蓝的光芒。\n` +
        `（角色：苏菲 | 画面动作：推开钛合金气动门，蓝色义眼闪烁，未来街道霓虹反射，高对比度）\n\n` +
        `• 【镜头 2】\n` +
        `机器人酒保/调酒师用精细的机械臂操作蒸汽泵，有条不紊地调试蓝色星尘咖啡液。\n` +
        `（角色：林德 | 画面动作：多关节机械手操作复古泵阀，倒出泛着微光的幽蓝色咖啡液，金属反光）\n\n` +
        `• 【镜头 3】\n` +
        `机器人倒出带有电路板图案拉花的咖啡，电子屏幕面部显示出一个笑脸颜文字。\n` +
        `（角色：苏菲, 林德 | 画面动作：递上电路拉花咖啡，显示屏笑脸闪烁，冷暖光线交织）\n\n` +
        (shotCount >= 6 ?
        `• 【镜头 4】\n` +
        `少女用仿生手抚摸着杯身，咖啡的热度让她的手掌传感器发出温热的橙色脉冲。\n` +
        `（角色：苏菲 | 画面动作：机械指尖触摸发光杯身，发出橙色脉冲，特写镜头，微距）\n\n` +
        `• 【镜头 5】\n` +
        `窗外是飞驰的磁悬浮列车，投下交错斑驳的光影，咖啡馆内两人的剪影显得格外寂静。\n` +
        `（角色：无 | 画面动作：磁悬浮列车划过夜空，斑驳阴影投射进咖啡馆，冷色调）\n\n` +
        `• 【镜头 6】\n` +
        `少女喝下咖啡，闭上眼睛，系统面板提示“核心温度回暖，情感模块激活”。\n` +
        `（角色：苏菲 | 画面动作：喝下蓝色咖啡，闭眼感受，面部神经元发出淡黄色荧光，赛博朋克）\n\n` : '') +
        (shotCount >= 8 ?
        `• 【镜头 7】\n` +
        `调酒师递过来一个微缩的全息投影盘，上面播放着二十年前绿意盎然的森林景象。\n` +
        `（角色：林德 | 画面动作：递出全息盘，绿色树木在杯子上空跳跃，柔和的绿色漫反射）\n\n` +
        `• 【镜头 8】\n` +
        `少女离开，将一小颗发光的电路芯片留在柜台，调酒师将芯片珍重地存入黄铜胸腔。\n` +
        `（角色：苏菲, 林德 | 画面动作：道别，收起芯片放入黄铜胸膛，风铃声被沉闷的引擎声取代）\n\n` : '')
    },
    {
      id: 'candidate-3',
      title: `《${cleanIdea.substring(0, 10) || '未命名'} · 星尘秘境》`,
      tone: '奇幻魔法 · 金砂羊皮纸色调',
      summary: '魔幻羊皮纸质感，漫天的发光粉尘，林德作为占星咖啡师，为旅者指点命运的迷津。',
      estimatedShots: shotCount,
      scriptText: `# 《占星师的星尘秘境》\n\n` +
        `【镜头 1】\n` +
        `斗篷旅人推开布满星盘浮雕的石门，无数萤火虫般的星尘随之涌入，照亮室内。\n` +
        `（角色：苏菲 | 画面动作：推开刻着星盘的古老石门，漫天飞舞的发光星尘涌入，羊皮纸色调，奇幻风）\n\n` +
        `【镜头 2】\n` +
        `头戴巫师帽的占星咖啡师手持发光水晶勺，在研磨器里撒入发光的干枯星屑。\n` +
        `（角色：林德 | 画面动作：用水晶勺撒入金色发光星尘，研磨器升起淡紫色烟雾，神秘复古）\n\n` +
        `【镜头 3】\n` +
        `咖啡师冲调完毕，杯子里盛装的并非液体，而是一个不断塌缩又爆发的微型金砂风暴。\n` +
        `（角色：苏菲, 林德 | 画面动作：把金砂风暴杯放在桌上，折射出刺眼的金光，两人神秘地低语）\n\n` +
        (shotCount >= 6 ?
        `【镜头 4】\n` +
        `旅人取下兜帽，露出一双闪着金斑的眼眸，凝视着杯子里的微缩风暴。\n` +
        `（角色：苏菲 | 画面动作：取下兜帽，闪烁金光的眼眸，微距注视风暴咖啡杯，奇幻神秘）\n\n` +
        `【镜头 5】\n` +
        `馆内的魔法吊灯像星系一样缓缓旋转，洒下斑斓的光斑，照亮墙壁上的古老占星图。\n` +
        `（角色：无 | 画面动作：古老占星图，旋转的魔法吊灯，星芒闪烁，暗部柔和）\n\n` +
        `【镜头 6】\n` +
        `旅人喝下风暴，耳畔响起古老的呢喃，她的背后隐约浮现出一双半透明的星光翅膀。\n` +
        `（角色：苏菲 | 画面动作：喝下金砂咖啡，背后浮现半透明发光翅膀，光影流转，极其华丽）\n\n` : '') +
        (shotCount >= 8 ?
        `【镜头 7】\n` +
        `占星师拿出一张古老的卷轴，指引她前往星图上闪烁的最亮一点。\n` +
        `（角色：林德 | 画面动作：摊开羊皮纸卷轴，指尖点亮卷轴上的星芒，微距特写）\n\n` +
        `【镜头 8】\n` +
        `旅人戴上兜帽，消失在星光凝聚的门扉中，占星师微笑着合上卷轴，等待下一位旅者。\n` +
        `（角色：苏菲, 林德 | 画面动作：踏入发光门扉，占星师微笑合卷轴，满天星光消散）\n\n` : '')
    }
  ];
}

/**
 * 将选定的详细剧本拆解为分镜脚本，并执行时长限制算法 (5s - 15s)
 * 算法目标：
 * 1. 拆解出来的每个分镜时长必须在 [5, 15] 秒之间。
 * 2. 分镜的总时长必须尽可能逼近用户的 targetDuration。
 *
 * @param {string} scriptText 剧本内容
 * @param {Array} existingCharacters 角色列表
 * @param {number} targetDuration 目标总时长 (秒)
 * @returns {Array} 拆解后的分镜数组
 */
export function parseScriptToStoryboard(scriptText, existingCharacters = [], targetDuration = 60) {
  if (!scriptText || !scriptText.trim()) return [];

  // 首先执行常规的分镜内容和角色抓取
  const normalizedText = scriptText.trim();
  let tempShots = [];

  const shotDelimiterRegex = /(?:【镜头\s*\d+】|•?\s*【镜头\s*\d+】|【镜\s*\d+】|镜\s*\d+[:：]?|【场景\s*\d+】)/i;
  const hasDelimiters = shotDelimiterRegex.test(normalizedText);

  if (hasDelimiters) {
    const parts = normalizedText.split(/(【镜头\s*\d+】|•?\s*【镜头\s*\d+】|【镜\s*\d+】|镜\s*\d+[:：]?|【场景\s*\d+】)/i);
    let currentHeader = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      if (shotDelimiterRegex.test(part)) {
        currentHeader = part;
      } else {
        tempShots.push({
          header: currentHeader || `镜头 ${tempShots.length + 1}`,
          content: part
        });
      }
    }
  } else {
    // 回退段落切分
    const paragraphs = normalizedText.split(/\n\s*\n+/);
    paragraphs.forEach((p, idx) => {
      const cleanP = p.trim();
      if (cleanP) {
        tempShots.push({
          header: `镜头 ${idx + 1}`,
          content: cleanP
        });
      }
    });
  }

  // 限制生成的镜头数
  const totalShotsCount = tempShots.length || 1;

  // ==================================================
  // 时长分配算法：将 targetDuration 平均分配到每个分镜中，
  // 并且保证分配的时长在 [5, 15] 秒范围内。
  // ==================================================
  let allocatedDurations = [];
  const minDuration = 5;
  const maxDuration = 15;

  // 基础平均分配
  let averageDuration = Math.round(targetDuration / totalShotsCount);
  
  // 钳夹至 [5, 15] 区间
  if (averageDuration < minDuration) averageDuration = minDuration;
  if (averageDuration > maxDuration) averageDuration = maxDuration;

  let sumAllocated = 0;
  for (let i = 0; i < totalShotsCount; i++) {
    allocatedDurations.push(averageDuration);
    sumAllocated += averageDuration;
  }

  // 调整差值，尽量贴近 targetDuration
  let difference = targetDuration - sumAllocated;
  let attempts = 0;
  const maxAttempts = 100; // 防止无限循环

  while (difference !== 0 && attempts < maxAttempts) {
    attempts++;
    if (difference > 0) {
      // 需要增加时长，找到没到上限的镜头加1秒
      let found = false;
      for (let i = 0; i < totalShotsCount; i++) {
        if (allocatedDurations[i] < maxDuration) {
          allocatedDurations[i] += 1;
          difference--;
          found = true;
          break;
        }
      }
      if (!found) break; // 所有镜头都已达到上限 (15s)
    } else {
      // 需要减少时长，找到没到下限的镜头减1秒
      let found = false;
      for (let i = 0; i < totalShotsCount; i++) {
        if (allocatedDurations[i] > minDuration) {
          allocatedDurations[i] -= 1;
          difference++;
          found = true;
          break;
        }
      }
      if (!found) break; // 所有镜头都已达到下限 (5s)
    }
  }

  // 组装最终分镜列表
  return tempShots.map((block, index) => {
    const text = block.content;

    // 1. 角色提取
    const charPatterns = [
      /(?:角色|登场角色|人物)[:：]\s*([^\n|）\]]+)/,
      /[(（]角色[:：]\s*([^\n|）]+)/,
      /\[角色[:：]\s*([^\]]+)\]/
    ];
    let charNamesString = '';
    for (const pattern of charPatterns) {
      const match = text.match(pattern);
      if (match) {
        charNamesString = match[1];
        break;
      }
    }

    // 2. 动作提取
    const actionPatterns = [
      /(?:画面动作|画面|动作|提示词)[:：]\s*([^\n）\]]+)/,
      /动作[:：]\s*([^\n）]+)/,
      /画面描述[:：]\s*([^\n）]+)/
    ];
    let promptText = '';
    for (const pattern of actionPatterns) {
      const match = text.match(pattern);
      if (match) {
        promptText = match[1];
        break;
      }
    }

    if (!promptText) {
      const cleanedLines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('【') && !line.startsWith('（') && !line.startsWith('(') && !line.includes('角色：') && !line.includes('人物：'));
      promptText = cleanedLines.join(' ');
    }

    promptText = promptText.replace(/[()（）[\]]/g, '').trim() || '特写，温暖电影质感';

    // 3. 关联角色 ID
    const selectedCharIds = [];
    if (charNamesString) {
      const names = charNamesString
        .replace(/[()（）[\]]/g, '')
        .split(/[,，|、\s]+/)
        .map(n => n.trim())
        .filter(Boolean);

      names.forEach(name => {
        const cleanName = name.split(/[((（]/)[0].trim();
        const matchedChar = existingCharacters.find(char => {
          const baseName = char.name.split(/[((（]/)[0].trim();
          return baseName.includes(cleanName) || cleanName.includes(baseName);
        });
        if (matchedChar && !selectedCharIds.includes(matchedChar.id)) {
          selectedCharIds.push(matchedChar.id);
        }
      });
    }

    return {
      id: `shot-storyboard-${Date.now()}-${index}`,
      characterIds: selectedCharIds,
      prompt: promptText,
      duration: allocatedDurations[index] || 8, // 使用分配好的在 [5, 15] 秒区间的时长
      engine: 'jimeng',
      status: 'idle', // 初始化为未生成状态
      progress: 0,
      videoUrl: null,
      error: null
    };
  });
}

/**
 * 角色一致性增强逻辑 (generateFinalPrompt)
 */
export function generateFinalPrompt(shot, characters = []) {
  if (!shot) return '';

  const selectedCharPrompts = shot.characterIds
    .map(id => {
      const char = characters.find(c => c.id === id);
      return char ? char.basePrompt.trim() : '';
    })
    .filter(Boolean);

  const motionPrompt = shot.prompt ? shot.prompt.trim() : '';

  if (selectedCharPrompts.length === 0) {
    return motionPrompt;
  }

  const joinedCharactersPrompt = selectedCharPrompts.join(', ');
  
  if (!motionPrompt) {
    return joinedCharactersPrompt;
  }

  return `${joinedCharactersPrompt}, ${motionPrompt}`;
}
