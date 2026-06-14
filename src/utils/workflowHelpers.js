/**
 * AI 短剧工作流核心逻辑工具库
 */

/**
 * 智能拆解剧本为分镜列表 (parseScriptToShots)
 * 支持多种剧本标注样式：
 * 1. 样式 A: 明确使用 `【镜头 X】`、`镜头 X` 或 `【镜X】` 作为分镜标识符。
 * 2. 样式 B: 明确使用 `场景一：`、`场景 1`、`[场景1]` 作为分镜标识符。
 * 3. 样式 C (回退机制): 若无任何分镜标识符，自动按照段落或句号（。）将剧本切分为多个分镜。
 * 
 * 同时，函数会自动识别各段分镜中的角色名称并与已有角色库进行关联。
 *
 * @param {string} scriptText 原始剧本长文本
 * @param {Array} existingCharacters 现有的角色库数据
 * @returns {Array|null} 返回拆解后的分镜数组，如果剧本为空则返回 null
 */
export function parseScriptToShots(scriptText, existingCharacters = []) {
  if (!scriptText || !scriptText.trim()) {
    return null;
  }

  const normalizedText = scriptText.trim();
  let shotBlocks = [];

  // 1. 检查是否存在分镜标号（如 【镜头 1】、镜头1、【镜1】、场景一：）
  const shotDelimiterRegex = /(?:【镜头\s*\d+】|镜头\s*\d+[:：]?|【镜\s*\d+】|镜\s*\d+[:：]?|【场景\s*\d+】|场景\s*[\d一二三四五六七八九十]+\s*[:：]?)/i;
  
  const hasDelimiters = shotDelimiterRegex.test(normalizedText);

  if (hasDelimiters) {
    // 使用标号拆分，保留分割符后面的内容
    // 正则使用捕获括号可以保留分割部分，以便识别序号
    const parts = normalizedText.split(/(【镜头\s*\d+】|镜头\s*\d+[:：]?|【镜\s*\d+】|镜\s*\d+[:：]?|【场景\s*\d+】|场景\s*[\d一二三四五六七八九十]+\s*[:：]?)/i);
    
    let currentHeader = '';
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      if (!part) continue;

      if (shotDelimiterRegex.test(part)) {
        currentHeader = part;
      } else {
        shotBlocks.push({
          header: currentHeader || `镜头 ${shotBlocks.length + 1}`,
          content: part
        });
      }
    }
  } else {
    // 2. 回退机制：按双换行（段落）切分，忽略空段
    const paragraphs = normalizedText.split(/\n\s*\n+/);
    paragraphs.forEach((p, idx) => {
      const cleanP = p.trim();
      if (cleanP) {
        shotBlocks.push({
          header: `镜头 ${idx + 1}`,
          content: cleanP
        });
      }
    });

    // 如果只有一个大段落，但包含多个句子，尝试按句号切分以保证体验
    if (shotBlocks.length === 1 && normalizedText.includes('。') && normalizedText.length > 80) {
      const sentences = normalizedText.split(/(?<=[。！？])\s*/);
      shotBlocks = sentences
        .filter(s => s.trim().length > 5)
        .map((s, idx) => ({
          header: `镜头 ${idx + 1}`,
          content: s.trim()
        }));
    }
  }

  // 3. 将各个分镜文本解析为结构化的 Shot 对象
  return shotBlocks.map((block, index) => {
    const text = block.content;

    // 提取登场角色 (支持：角色：苏菲、角色 [苏菲]、人物:苏菲、(苏菲,林德))
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

    // 提取画面动作描述
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

    // 若没提取到画面动作，则清理掉角色标注行后，使用主体段落作为提示词
    if (!promptText) {
      const cleanedLines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('【') && !line.startsWith('（') && !line.startsWith('(') && !line.includes('角色：') && !line.includes('人物：'));
      promptText = cleanedLines.join(' ');
    }

    // 去除多余括号及修饰词
    promptText = promptText.replace(/[()（）[\]]/g, '').trim() || '全景镜头，咖啡馆氛围，电影画质';

    // 匹配角色与已有角色库 ID
    const selectedCharIds = [];
    if (charNamesString) {
      // 分割角色名字（支持逗号，空格，顿号，竖线）
      const names = charNamesString
        .replace(/[()（）[\]]/g, '')
        .split(/[,，|、\s]+/)
        .map(n => n.trim())
        .filter(Boolean);

      names.forEach(name => {
        // 去除外文括号，如 "苏菲(Sophie)" -> "苏菲"
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
      id: `shot-split-${Date.now()}-${index}`,
      characterIds: selectedCharIds,
      prompt: promptText,
      duration: 4, // 默认 4s
      status: 'idle',
      progress: 0,
      videoUrl: null
    };
  });
}

/**
 * 角色一致性增强逻辑 (generateFinalPrompt)
 * 最终提示词 = [角色A固定外貌提示词] + [角色B固定外貌提示词] + ... + [当前分镜动作描述]
 *
 * @param {Object} shot 单个分镜对象
 * @param {Array} characters 全局角色资产列表
 * @returns {string} 拼装后的增强版 Final Prompt
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

  // 如果没有角色提示词，直接返回当前分镜动作描述
  if (selectedCharPrompts.length === 0) {
    return motionPrompt;
  }

  // 拼接格式：[角色提示词1, 角色提示词2], [动作描述]
  const joinedCharactersPrompt = selectedCharPrompts.join(', ');
  
  if (!motionPrompt) {
    return joinedCharactersPrompt;
  }

  return `${joinedCharactersPrompt}, ${motionPrompt}`;
}
