import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Character } from "../types/character";
import { CharacterPreview } from "./CharacterPreview";

type CharacterDraft = Omit<Character, "id" | "updatedAt">;

type CharacterFormProps = {
  character?: Character | null;
  onSave: (character: Character) => void;
  onDraftSave: (character: Character) => void;
  onAutoSave?: (character: Character) => void;
  onDelete?: (character: Character) => void;
  onCancel: () => void;
  saveSignal?: number;
};

type SectionId =
  | "basic"
  | "appearance"
  | "personality"
  | "ability"
  | "backstory"
  | "prompt";

type AvatarCategory = {
  id: string;
  label: string;
  emojis: string[];
};

const DEFAULT_AVATAR_EMOJI = "🙂";
const RECENT_AVATAR_KEY = "character-studio.recent-avatars";
const DASHBOARD_PREFS_KEY = "character-studio.dashboard-prefs";
const tagColorOptions = ["gray", "blue", "green", "yellow", "rose", "violet"] as const;

const avatarCategories: AvatarCategory[] = [
  {
    id: "people",
    label: "😀 人物",
    emojis: ["🙂", "😀", "😐", "😌", "😎", "🤨", "😶", "😏", "🥲", "🤔", "😤", "😈"],
  },
  {
    id: "female",
    label: "👩 女性",
    emojis: ["👩", "👧", "👱‍♀️", "👩‍🦰", "👩‍🦱", "👩‍🦳", "👩‍🦲", "👸", "👰‍♀️", "🧕", "👮‍♀️", "🕵️‍♀️"],
  },
  {
    id: "male",
    label: "👨 男性",
    emojis: ["👨", "👦", "👱‍♂️", "👨‍🦰", "👨‍🦱", "👨‍🦳", "👨‍🦲", "🤴", "🤵‍♂️", "👮‍♂️", "🕵️‍♂️", "🥷"],
  },
  {
    id: "youth",
    label: "🧒 儿童 / 少年",
    emojis: ["🧒", "👶", "👧", "👦", "🙋", "🙋‍♀️", "🙋‍♂️", "🧑‍🎓", "👩‍🎓", "👨‍🎓", "🧑‍🦱", "🧑‍🦰"],
  },
  {
    id: "elder",
    label: "👴 老年",
    emojis: ["👴", "👵", "🧓", "👨‍🦳", "👩‍🦳", "🧙‍♂️", "🧙‍♀️", "🧑‍🏫", "👨‍🏫", "👩‍🏫"],
  },
  {
    id: "magic",
    label: "🧙 魔法角色",
    emojis: ["🧙", "🧙‍♀️", "🧙‍♂️", "🧚", "🧚‍♀️", "🧚‍♂️", "🧞", "🧞‍♀️", "🧞‍♂️", "🧛", "🧛‍♀️", "🧛‍♂️"],
  },
  {
    id: "hero",
    label: "🦸 英雄",
    emojis: ["🦸", "🦸‍♀️", "🦸‍♂️", "🦹", "🦹‍♀️", "🦹‍♂️", "🥷", "🧑‍🚀", "👩‍🚀", "👨‍🚀", "🧑‍✈️", "🧑‍🚒"],
  },
  {
    id: "fantasy-race",
    label: "🧝 奇幻种族",
    emojis: ["🧝", "🧝‍♀️", "🧝‍♂️", "🧌", "🧟", "🧟‍♀️", "🧟‍♂️", "🧜", "🧜‍♀️", "🧜‍♂️", "🧞", "🧛"],
  },
  {
    id: "monster",
    label: "👻 怪物 / 幽灵",
    emojis: ["👻", "💀", "☠️", "👽", "👾", "🤖", "👹", "👺", "😈", "👿", "🧟", "🧌"],
  },
  {
    id: "animal",
    label: "🐱 动物",
    emojis: ["🐱", "🐶", "🦊", "🐺", "🐰", "🐻", "🐼", "🐯", "🦁", "🐮", "🐭", "🐵"],
  },
  {
    id: "creature",
    label: "🐉 幻想生物",
    emojis: ["🐉", "🐲", "🦄", "🦅", "🦇", "🦋", "🐍", "🦎", "🦖", "🦕", "🪶", "🪽"],
  },
];

const avatarEmojiOptions = Array.from(
  new Set(avatarCategories.flatMap((category) => category.emojis)),
);

const initialCharacter: CharacterDraft = {
  name: "",
  avatarEmoji: DEFAULT_AVATAR_EMOJI,
  isDraft: false,
  age: "",
  birthDate: "",
  birthYear: "",
  gender: "",
  species: "",
  occupation: "",
  worldview: "",
  tags: [],
  personalityTags: [],
  appearanceDescription: "",
  abilityDescription: "",
  backstory: "",
  visualStyle: "",
  characterKeywords: "",
  imagePrompt: "",
};

const personalityOptions = [
  "冷静",
  "温柔",
  "傲娇",
  "阴郁",
  "活泼",
  "神秘",
  "疯批",
  "可靠",
  "孤僻",
  "天真",
  "危险",
  "优雅",
  "敏感",
  "迟钝",
  "理性",
  "冲动",
];

const worldviewOptions = [
  "现代都市",
  "奇幻",
  "赛博朋克",
  "废土",
  "校园",
  "异世界",
  "克苏鲁",
  "后室风",
];

const visualStyleOptions = [
  "日系插画",
  "厚涂",
  "像素风",
  "乙游风",
  "暗黑童话",
  "简约漫画",
  "3A 游戏 CG",
];

const randomNames = [
  "林见月",
  "白祈",
  "沈鸢",
  "诺亚",
  "黎烬",
  "叶澜",
  "岑星",
  "维洛",
  "苏眠",
  "顾南枝",
  "江烬雪",
  "洛伊",
  "阿斯塔",
  "闻人昼",
  "夏弥",
  "伊莲",
  "程雾",
  "赫连青",
  "米娅",
  "谢无咎",
  "安珀",
  "陆沉舟",
  "塔莉娅",
  "北原澈",
  "鹿川遥",
  "南宫祈",
  "艾瑞尔",
  "钟离昼",
  "姜停云",
  "凛音",
  "塞西莉亚",
  "乌诺",
  "许照夜",
  "明堂雪",
  "卡洛斯",
  "岚",
  "白鸟栖",
  "伊森",
  "森野萤",
  "罗莎琳",
];

const randomGenders = ["女", "男", "非二元", "其他", "无性别", "性别流动", "未知"];
const randomAges = ["12", "15", "17", "19", "22", "24", "27", "31", "36", "42", "58", "128", "外表约20"];
const genderOptions = ["男", "女", "非二元", "其他", "自定义"];

const randomSpecies = [
  "人类",
  "精灵",
  "半机械人",
  "龙裔",
  "异能者",
  "幽灵",
  "吸血鬼",
  "人造人",
  "堕天使",
  "兽人",
  "海妖",
  "星际移民",
  "梦境居民",
  "旧神眷属",
  "时间旅人",
  "仿生体",
  "星灵",
  "月族",
  "梦魇",
  "灵媒",
  "机械精灵",
  "荒原混血",
  "镜像人",
  "书页妖精",
  "古代守卫",
  "数据幽魂",
  "深海遗民",
  "灾厄容器",
];

const randomOccupations = [
  "调查员",
  "魔法师",
  "赏金猎人",
  "学生",
  "医生",
  "流浪剑士",
  "黑客",
  "档案管理员",
  "机械修理师",
  "占卜师",
  "地下偶像",
  "前线记者",
  "遗迹猎人",
  "心理咨询师",
  "怪谈主播",
  "雇佣兵",
  "炼金术士",
  "图书馆守夜人",
  "异常收容员",
  "失业侦探",
  "星图绘师",
  "梦境潜航员",
  "战地药剂师",
  "记忆修复师",
  "禁书译者",
  "义体调律师",
  "荒野信使",
  "结界工程师",
  "旧货店老板",
  "观测站值夜员",
  "地下剧团演员",
  "灵异案件顾问",
];

const randomAppearances = [
  "银色短发，眼神疏离，常穿深色长外套。",
  "黑发红瞳，佩戴旧式耳机，动作轻快。",
  "浅金长发，衣着整洁，随身带着一本破损手账。",
  "灰蓝色眼睛，身形瘦削，外套上有磨损的徽章。",
  "白色卷发，左眼有细小伤痕，喜欢穿高领毛衣。",
  "深棕短发，笑容温和，手腕上缠着褪色红绳。",
  "紫色挑染，佩戴透明雨衣，鞋底总沾着荧光尘。",
  "长发束成低马尾，制服剪裁利落，指尖常有墨迹。",
  "皮肤苍白，瞳孔像碎裂玻璃，衣摆缝着旧银币。",
  "运动外套搭配战术腰包，动作直接，目光警觉。",
  "戴圆框眼镜，背着过大的帆布包，神情总像没睡醒。",
  "黑色礼服外套，耳坠不成对，说话时很少眨眼。",
  "短靴、披肩和金属护臂混搭，身上带着旅途风尘。",
  "发尾像被火燎过，外套内侧藏着许多纸条。",
  "发间别着细小金属夹，制服干净却总有雨水痕迹。",
  "眼下有淡淡黑眼圈，围巾遮住半张脸，声音很轻。",
  "一侧手臂覆盖精密义体，关节处有微弱蓝光。",
  "披着旧斗篷，靴侧挂着小铃铛，走路几乎没有声响。",
  "异色瞳，手套上绣着陌生符号，常带着礼貌微笑。",
  "短发凌乱，背包上挂满护身符和坏掉的钥匙。",
  "额前有一道浅色印记，衣服层叠但配色克制。",
  "穿着改造过的校服，袖口缝着细密的防护符线。",
];

const randomAbilities = [
  "擅长观察细节，能在混乱中迅速找到线索。",
  "可以短暂操控光影，但过度使用会失去方向感。",
  "拥有强大的近战技巧，弱点是不擅长信任他人。",
  "能读取残留记忆，但会被他人的情绪影响。",
  "能与机械设备建立短暂共感，代价是体温快速下降。",
  "拥有异常稳定的精神力，能抵抗幻觉与低语。",
  "可以召唤纸质符咒形成屏障，但雨天效果会削弱。",
  "擅长伪装和潜入，能够快速模仿他人的语气。",
  "能感知危险来临前的细微预兆，却无法判断来源。",
  "使用古老咒文治疗伤口，但每次都会遗忘一小段记忆。",
  "可以操纵低频声波干扰敌人，安静环境中更强。",
  "对毒素和污染有高度耐受，身体恢复速度缓慢但稳定。",
  "能把情绪具象成短暂武器，情绪越极端越难控制。",
  "拥有精准射击能力，同时依赖一副特制护目镜。",
  "能在短距离内交换两个物体的位置，但必须先触碰目标。",
  "可以记录并重放一段声音，用来误导敌人或保存证词。",
  "能让伤口暂时停止恶化，但代价是自身感官迟钝。",
  "可以看见谎言留下的细线，却无法判断谎言的动机。",
  "能召来小型使魔传递消息，使魔性格很难控制。",
  "可以短暂进入镜面空间，停留太久会迷失方向。",
  "擅长拆解结界和安全系统，但需要安静的准备时间。",
  "能把梦境片段投影成幻象，越真实越消耗精神。",
];

const randomBackstories = [
  "从一场失踪事件后开始独自行动，正在寻找真相。",
  "出生在边境小镇，因一次意外卷入更大的阴谋。",
  "曾经属于某个组织，如今选择隐藏身份重新生活。",
  "看似普通，却保存着一段被刻意抹去的过去。",
  "幼年时被一座不存在的车站带走，数年后突然归来。",
  "为了偿还家族留下的债务，接下了危险的委托工作。",
  "曾在灾难中救下陌生人，却因此被卷入秘密实验。",
  "一直追查一本会改写现实的书，书中偶尔出现自己的名字。",
  "失去了最重要的搭档，只留下一个无法解开的坐标。",
  "在学院里成绩平平，却总能梦见未来发生的片段。",
  "来自已经毁灭的城市，随身携带最后一张旧地图。",
  "被某个神秘组织误认为关键人物，只好边逃边调查。",
  "表面经营小店，实际替附近居民处理异常事件。",
  "曾经背叛过同伴，如今试图用自己的方式补偿过去。",
  "被一封没有署名的信引到陌生城市，从此卷入连续怪事。",
  "继承了一间只在午夜营业的店铺，也继承了店里的契约。",
  "为了保护某个秘密档案，主动从原本的生活中消失。",
  "在一次失败任务后被除名，仍暗中守着旧队友留下的线索。",
  "每年生日都会收到来自未来的礼物，内容越来越危险。",
  "曾短暂成为某个仪式的祭品，因此获得了不稳定的力量。",
  "在废墟中醒来时只记得一个名字，正试图找回自己的身份。",
  "被记录为早已死亡的人，却以新的身份安静生活至今。",
];

const randomWorldviewDetails: Record<string, string[]> = {
  现代都市: ["雨夜霓虹街区", "旧城区怪谈", "大型企业阴影", "深夜便利店", "匿名论坛事件"],
  奇幻: ["边境王国", "浮空群岛", "古老魔法学院", "沉睡森林", "失落神殿"],
  赛博朋克: ["高塔贫民区", "义体诊所", "失控数据城", "地下黑市", "企业实验楼"],
  废土: ["干涸海床", "移动避难所", "污染隔离带", "风暴补给站", "废弃发射井"],
  校园: ["封闭寄宿学校", "社团怪谈", "考试季异常事件", "旧教学楼", "天台约定"],
  异世界: ["召唤后的陌生大陆", "多种族贸易城", "勇者传说背面", "边境驿站", "王都下水道"],
  克苏鲁: ["海边小镇", "禁书图书馆", "低语梦境", "雾中灯塔", "沉没教堂"],
  后室风: ["无尽办公层", "潮湿黄色走廊", "错误出口", "失真商场", "循环楼梯间"],
};

const helperText: Record<
  Exclude<SectionId, "basic" | "prompt">,
  { example: string; inspiration: string; tip: string }
> = {
  appearance: {
    example: "外套袖口有被火烧过的痕迹，左耳戴着不成对的银色耳坠。",
    inspiration: "加入一个能暗示过去经历的随身物品。",
    tip: "从轮廓、颜色、材质、标志物四个角度写，会更容易形成画面。",
  },
  personality: {
    example: "表面冷静可靠，遇到熟悉的人时会露出迟钝又温柔的一面。",
    inspiration: "给角色添加一个和主性格相反的小习惯。",
    tip: "性格标签不必全是优点，矛盾感会让角色更立体。",
  },
  ability: {
    example: "能在短时间内听见机械设备的残留记忆，但会因此短暂失聪。",
    inspiration: "为能力增加一个代价或触发条件。",
    tip: "能力越强，限制越清楚，故事张力越稳定。",
  },
  backstory: {
    example: "曾在一场失踪事件中幸存，之后开始追查一张反复出现在梦里的车票。",
    inspiration: "设计一个角色现在仍在追寻的问题。",
    tip: "背景故事可以包含成长经历、重要事件、当前目标或隐藏秘密。",
  },
};

const promptValueMap: Record<string, string> = {
  女: "female",
  男: "male",
  非二元: "non-binary",
  其他: "other gender expression",
  无性别: "agender",
  性别流动: "genderfluid",
  未知: "unknown gender",
  人类: "human",
  精灵: "elf",
  半机械人: "cyborg",
  龙裔: "dragonborn",
  异能者: "supernatural ability user",
  幽灵: "ghost",
  吸血鬼: "vampire",
  人造人: "artificial human",
  堕天使: "fallen angel",
  兽人: "orc",
  海妖: "siren",
  星际移民: "space colonist",
  梦境居民: "dream realm resident",
  旧神眷属: "old god follower",
  时间旅人: "time traveler",
  仿生体: "android",
  星灵: "astral spirit",
  月族: "moon clan descendant",
  梦魇: "nightmare entity",
  灵媒: "spirit medium",
  机械精灵: "mechanical elf",
  荒原混血: "wasteland hybrid",
  镜像人: "mirror person",
  书页妖精: "book fairy",
  古代守卫: "ancient guardian",
  数据幽魂: "data ghost",
  深海遗民: "deep sea survivor",
  灾厄容器: "vessel of calamity",
  现代都市: "modern urban setting",
  奇幻: "fantasy setting",
  赛博朋克: "cyberpunk setting",
  废土: "wasteland setting",
  校园: "school setting",
  异世界: "isekai fantasy world",
  克苏鲁: "cosmic horror setting",
  后室风: "liminal backrooms setting",
  冷静: "calm",
  温柔: "gentle",
  傲娇: "tsundere",
  阴郁: "gloomy",
  活泼: "lively",
  神秘: "mysterious",
  疯批: "unhinged",
  可靠: "reliable",
  孤僻: "solitary",
  天真: "innocent",
  危险: "dangerous",
  优雅: "elegant",
  敏感: "sensitive",
  迟钝: "slow to notice",
  理性: "rational",
  冲动: "impulsive",
  日系插画: "Japanese illustration style",
  厚涂: "painterly rendering",
  像素风: "pixel art style",
  乙游风: "otome game style",
  暗黑童话: "dark fairy tale style",
  简约漫画: "minimal comic style",
  "3A 游戏 CG": "AAA game cinematic CG style",
};

const sectionMeta: Array<{
  id: SectionId;
  title: string;
  description: string;
}> = [
  { id: "basic", title: "基础信息", description: "角色身份、头像与基础档案。" },
  { id: "appearance", title: "外貌设定", description: "角色可视化的轮廓、服装与标志物。" },
  { id: "personality", title: "性格设定", description: "用标签和短描述确定角色气质。" },
  { id: "ability", title: "能力设定", description: "技能、限制、战斗或特殊天赋。" },
  { id: "backstory", title: "背景故事", description: "经历、关系、目标与隐藏秘密。" },
  { id: "prompt", title: "AI Prompt", description: "本地生成关键词和英文绘图 Prompt。" },
];

function cleanText(value?: string) {
  return value
    ?.trim()
    .replace(/\s+/g, " ")
    .replace(/[；;，,。.、]+$/g, "");
}

function compactParts(parts: Array<string | undefined | false>) {
  return parts
    .map((part) => (typeof part === "string" ? cleanText(part) : ""))
    .filter((part): part is string => Boolean(part));
}

function promptText(value?: string) {
  const cleanedValue = cleanText(value);

  if (!cleanedValue) {
    return "";
  }

  return promptValueMap[cleanedValue] || cleanedValue.replace(/[，；、。]/g, ", ");
}

function pickRandom(options: string[]) {
  return options[Math.floor(Math.random() * options.length)];
}

function loadRecentAvatars() {
  try {
    const value = localStorage.getItem(RECENT_AVATAR_KEY);
    const parsedValue = value ? (JSON.parse(value) as unknown) : [];

    return Array.isArray(parsedValue)
      ? parsedValue.filter((item): item is string => avatarEmojiOptions.includes(item)).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function saveRecentAvatar(emoji: string) {
  const nextRecent = [emoji, ...loadRecentAvatars().filter((item) => item !== emoji)].slice(0, 12);
  localStorage.setItem(RECENT_AVATAR_KEY, JSON.stringify(nextRecent));
  return nextRecent;
}

function avatarCategoryTitle(label: string) {
  return label.replace(/^\S+\s*/, "");
}

function tagColorLabel(color: string) {
  const labels: Record<string, string> = {
    gray: "灰色",
    blue: "蓝色",
    green: "绿色",
    yellow: "黄色",
    rose: "玫瑰",
    violet: "紫色",
  };

  return labels[color] || "灰色";
}

function pickRandomTags() {
  return [...personalityOptions]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.floor(Math.random() * 3) + 2);
}

function generateKeywords(character: CharacterDraft) {
  return compactParts([
    character.name && `名字：${character.name}`,
    character.gender && `性别：${character.gender}`,
    character.age && `年龄：${character.age}`,
    character.species && `种族：${character.species}`,
    character.occupation && `职业：${character.occupation}`,
    character.worldview && `世界观：${character.worldview}`,
    character.personalityTags?.length
      ? `性格：${character.personalityTags.join("、")}`
      : undefined,
    character.visualStyle && `视觉风格：${character.visualStyle}`,
    character.appearanceDescription &&
      `外貌：${character.appearanceDescription}`,
    character.abilityDescription && `能力：${character.abilityDescription}`,
    character.backstory && `背景：${character.backstory}`,
  ]).join("；");
}

function generateImagePrompt(character: CharacterDraft) {
  const personality = character.personalityTags?.map(promptText).join(", ");

  return compactParts([
    "original character design",
    character.name && `named ${promptText(character.name)}`,
    promptText(character.gender),
    character.age && `${promptText(character.age)} years old`,
    promptText(character.species),
    character.occupation && `occupation: ${promptText(character.occupation)}`,
    character.worldview && `set in ${promptText(character.worldview)}`,
    personality && `personality: ${personality}`,
    character.appearanceDescription &&
      `appearance: ${promptText(character.appearanceDescription)}`,
    character.abilityDescription &&
      `abilities: ${promptText(character.abilityDescription)}`,
    character.backstory && `backstory mood: ${promptText(character.backstory)}`,
    character.visualStyle && `visual style: ${promptText(character.visualStyle)}`,
    "high quality, detailed character concept art",
  ]).join(", ");
}

function calculateAgeFromDate(value: string) {
  if (!value) {
    return "";
  }

  const birthDate = new Date(value);

  if (Number.isNaN(birthDate.getTime())) {
    return "";
  }

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() &&
      today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) {
    age -= 1;
  }

  return age >= 0 ? String(age) : "";
}

function calculateAgeFromYear(value: string) {
  const year = Number(value);
  const currentYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < 0 || year > currentYear) {
    return "";
  }

  return String(currentYear - year);
}

function autoGrowTextArea(event: ChangeEvent<HTMLTextAreaElement>) {
  event.currentTarget.style.height = "auto";
  event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
}

function completionStatus(sectionId: SectionId, data: CharacterDraft) {
  const checks: Record<SectionId, boolean[]> = {
    basic: [data.name, data.gender, data.species, data.occupation, data.worldview].map(Boolean),
    appearance: [Boolean(data.appearanceDescription), Boolean(data.visualStyle)],
    personality: [Boolean(data.personalityTags?.length)],
    ability: [Boolean(data.abilityDescription)],
    backstory: [Boolean(data.backstory)],
    prompt: [Boolean(data.characterKeywords), Boolean(data.imagePrompt)],
  };
  const values = checks[sectionId];
  const filled = values.filter(Boolean).length;

  if (filled === 0) {
    return "未完成";
  }

  return filled === values.length ? "已完成" : "部分完成";
}

export function CharacterForm({
  character,
  onSave,
  onDraftSave,
  onAutoSave,
  onDelete,
  onCancel,
  saveSignal = 0,
}: CharacterFormProps) {
  const [formData, setFormData] = useState<CharacterDraft>(initialCharacter);
  const [customTag, setCustomTag] = useState("");
  const [characterTagInput, setCharacterTagInput] = useState("");
  const [customGender, setCustomGender] = useState("");
  const [genderMode, setGenderMode] = useState("自定义");
  const [ageMode, setAgeMode] = useState<"manual" | "birthDate" | "birthYear">(
    "manual",
  );
  const [formError, setFormError] = useState("");
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [activeAvatarCategoryId, setActiveAvatarCategoryId] = useState(
    avatarCategories[0].id,
  );
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [recentAvatars, setRecentAvatars] = useState(loadRecentAvatars);
  const [pendingClear, setPendingClear] = useState<{
    field:
      | "personalityTags"
      | "appearanceDescription"
      | "abilityDescription"
      | "backstory"
      | "characterKeywords"
      | "imagePrompt";
    label: string;
  } | null>(null);
  const [pendingFormAction, setPendingFormAction] = useState<"clear" | "delete" | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("basic");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionId, boolean>>({
    basic: false,
    appearance: false,
    personality: false,
    ability: false,
    backstory: false,
    prompt: false,
  });
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const lastAutoSavedSnapshotRef = useRef("");
  const saveSignalRef = useRef(saveSignal);

  const previewCharacter = useMemo<Character>(
    () => ({
      ...formData,
      id: character?.id || "draft-preview",
      createdAt: character?.createdAt || new Date().toISOString(),
      updatedAt: character?.updatedAt || new Date().toISOString(),
      name: formData.name || "未命名角色",
    }),
    [character, formData],
  );

  const activeAvatarCategory =
    avatarCategories.find((category) => category.id === activeAvatarCategoryId) ||
    avatarCategories[0];

  useEffect(() => {
    const nextData: CharacterDraft = character
      ? {
          name: character.name,
          avatarEmoji: character.avatarEmoji || DEFAULT_AVATAR_EMOJI,
          isDraft: character.isDraft === true,
          draftOfId: character.draftOfId,
          age: character.age || "",
          birthDate: character.birthDate || "",
          birthYear: character.birthYear || "",
          gender: character.gender || "",
          species: character.species || "",
          occupation: character.occupation || "",
          worldview: character.worldview || "",
          tags: character.tags || [],
          personalityTags: character.personalityTags || [],
          appearanceDescription: character.appearanceDescription || "",
          abilityDescription: character.abilityDescription || "",
          backstory: character.backstory || "",
          visualStyle: character.visualStyle || "",
          characterKeywords: character.characterKeywords || "",
          imagePrompt: character.imagePrompt || "",
        }
      : {
          ...initialCharacter,
          avatarEmoji: DEFAULT_AVATAR_EMOJI,
        };

    setFormData(nextData);
    lastAutoSavedSnapshotRef.current = JSON.stringify(nextData);
    setSaveStatus(character ? "saved" : "idle");
    setAgeMode(character?.birthDate ? "birthDate" : character?.birthYear ? "birthYear" : "manual");
    if (character?.gender && genderOptions.includes(character.gender)) {
      setGenderMode(character.gender);
      setCustomGender("");
    } else {
      setGenderMode(character?.gender ? "自定义" : "");
      setCustomGender(character?.gender || "");
    }
    setFormError("");
    setEditorMode("edit");
  }, [character?.id]);

  useEffect(() => {
    if (!character?.isDraft || !onAutoSave) {
      return;
    }

    const snapshot = JSON.stringify(formData);

    if (snapshot === lastAutoSavedSnapshotRef.current) {
      return;
    }

    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        onAutoSave({
          ...formData,
          id: character.id,
          createdAt: character.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          isDraft: character.isDraft === true,
          draftOfId: character.draftOfId,
          name: formData.name || character.name || "未命名角色",
        });
        lastAutoSavedSnapshotRef.current = snapshot;
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 900);

    return () => window.clearTimeout(timer);
  }, [character, formData, onAutoSave]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (JSON.stringify(formData) === lastAutoSavedSnapshotRef.current) {
        return;
      }

      event.preventDefault();
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [formData]);

  useEffect(() => {
    if (saveSignal === saveSignalRef.current) {
      return;
    }

    saveSignalRef.current = saveSignal;
    saveCurrentCharacter();
  }, [saveSignal]);

  function updateField(field: keyof CharacterDraft, value: string | string[]) {
    setFormData((current) => ({ ...current, [field]: value }));
  }

  function selectAvatarEmoji(emoji: string) {
    updateField("avatarEmoji", emoji);
    setRecentAvatars(saveRecentAvatar(emoji));
    setIsAvatarPickerOpen(false);
  }

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 1800);
  }

  function toggleSection(sectionId: SectionId) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function jumpToSection(sectionId: SectionId) {
    setActiveSection(sectionId);
    setCollapsedSections((current) => ({ ...current, [sectionId]: false }));
    window.setTimeout(() => {
      document
        .getElementById(`workspace-${sectionId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function togglePersonalityTag(tag: string) {
    setFormData((current) => {
      const currentTags = current.personalityTags || [];
      const hasTag = currentTags.includes(tag);
      const personalityTags = hasTag
        ? currentTags.filter((item) => item !== tag)
        : [...currentTags, tag];

      return { ...current, personalityTags };
    });
  }

  function handleGenderModeChange(value: string) {
    setGenderMode(value);
    updateField("gender", value === "自定义" ? customGender : value);
  }

  function handleCustomGenderChange(value: string) {
    setCustomGender(value);
    updateField("gender", value);
  }

  function setManualAge(value: string) {
    const numericValue = value.replace(/[^\d]/g, "");
    setAgeMode("manual");
    setFormData((current) => ({
      ...current,
      age: numericValue,
      birthDate: "",
      birthYear: "",
    }));
  }

  function setBirthDate(value: string) {
    setAgeMode("birthDate");
    setFormData((current) => ({
      ...current,
      age: calculateAgeFromDate(value),
      birthDate: value,
      birthYear: "",
    }));
  }

  function setBirthYear(value: string) {
    const numericValue = value.replace(/[^\d]/g, "").slice(0, 4);
    setAgeMode("birthYear");
    setFormData((current) => ({
      ...current,
      age: calculateAgeFromYear(numericValue),
      birthDate: "",
      birthYear: numericValue,
    }));
  }

  function addCustomTag() {
    const nextTag = customTag.trim();

    if (!nextTag) {
      return;
    }

    setFormData((current) => {
      const currentTags = current.personalityTags || [];

      if (currentTags.includes(nextTag)) {
        return current;
      }

      return { ...current, personalityTags: [...currentTags, nextTag] };
    });
    setCustomTag("");
  }

  function removeTag(tag: string) {
    setFormData((current) => ({
      ...current,
      personalityTags: (current.personalityTags || []).filter(
        (item) => item !== tag,
      ),
    }));
  }

  function addCharacterTag() {
    const nextTag = characterTagInput.trim();

    if (!nextTag) {
      return;
    }

    setFormData((current) => {
      const currentTags = current.tags || [];

      if (currentTags.some((tag) => tag.name === nextTag)) {
        return current;
      }

      return {
        ...current,
        tags: [
          ...currentTags,
          { id: crypto.randomUUID(), name: nextTag, color: "gray" },
        ],
      };
    });
    setCharacterTagInput("");
  }

  function updateCharacterTag(
    tagId: string,
    field: "name" | "color",
    value: string,
  ) {
    setFormData((current) => ({
      ...current,
      tags: (current.tags || [])
        .map((tag) => (tag.id === tagId ? { ...tag, [field]: value } : tag))
        .filter((tag) => tag.name.trim()),
    }));
  }

  function removeCharacterTag(tagId: string) {
    setFormData((current) => ({
      ...current,
      tags: (current.tags || []).filter((tag) => tag.id !== tagId),
    }));
  }

  function handleRandomCharacter() {
    setIsRandomizing(true);
    window.setTimeout(() => setIsRandomizing(false), 450);

    const worldview = pickRandom(worldviewOptions);
    const worldviewDetail = pickRandom(randomWorldviewDetails[worldview]);
    const personalityTags = pickRandomTags();
    const randomCharacter: CharacterDraft = {
      name: pickRandom(randomNames),
      avatarEmoji: pickRandom(avatarEmojiOptions),
      gender: pickRandom(randomGenders),
      age: pickRandom(randomAges),
      birthDate: "",
      birthYear: "",
      species: pickRandom(randomSpecies),
      occupation: pickRandom(randomOccupations),
      worldview,
      personalityTags,
      appearanceDescription: `${pickRandom(randomAppearances)}整体气质偏${pickRandom(personalityTags)}，适合出现在${worldviewDetail}。`,
      abilityDescription: pickRandom(randomAbilities),
      backstory: `${pickRandom(randomBackstories)}主要活动地点与${worldviewDetail}有关。`,
      visualStyle: pickRandom(visualStyleOptions),
      characterKeywords: "",
      imagePrompt: "",
    };

    setFormData({
      ...randomCharacter,
      characterKeywords: generateKeywords(randomCharacter),
      imagePrompt: generateImagePrompt(randomCharacter),
    });
    setAgeMode("manual");
    setGenderMode(
      randomCharacter.gender && genderOptions.includes(randomCharacter.gender)
        ? randomCharacter.gender
        : "自定义",
    );
    setCustomGender(
      randomCharacter.gender && genderOptions.includes(randomCharacter.gender)
        ? ""
        : randomCharacter.gender || "",
    );
    setFormError("");
    showToast("角色已随机生成");
  }

  function handleGenerateKeywords() {
    setFormData((current) => ({
      ...current,
      characterKeywords: generateKeywords(current),
    }));
    showToast("中文关键词已生成");
  }

  function handleGenerateImagePrompt() {
    setFormData((current) => ({
      ...current,
      imagePrompt: generateImagePrompt(current),
    }));
    showToast("英文 Prompt 已生成");
  }

  async function copyText(value: string, message: string) {
    await navigator.clipboard.writeText(value || "未填写");
    showToast(message);
  }

  function appendToField(
    field:
      | "appearanceDescription"
      | "abilityDescription"
      | "backstory"
      | "characterKeywords"
      | "imagePrompt",
    value: string,
  ) {
    setFormData((current) => {
      const currentValue = current[field]?.trim();
      return {
        ...current,
        [field]: currentValue ? `${currentValue}\n${value}` : value,
      };
    });
  }

  function buildCharacter(isDraft: boolean) {
    if (!formData.name.trim()) {
      setFormError("请先填写角色名字");
      showToast("请先填写角色名字");
      return null;
    }

    setFormError("");
    return {
      ...formData,
      id: character?.id || crypto.randomUUID(),
      createdAt: character?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      avatarEmoji: formData.avatarEmoji || DEFAULT_AVATAR_EMOJI,
      isDraft,
      name: formData.name.trim(),
    };
  }

  function saveCurrentCharacter() {
    const nextCharacter = buildCharacter(false);

    if (!nextCharacter) {
      return;
    }

    setSaveStatus("saving");
    onSave(nextCharacter);
    setSaveStatus("saved");
  }

  function saveDraftCharacter() {
    const nextCharacter = buildCharacter(true);

    if (!nextCharacter) {
      return;
    }

    setSaveStatus("saving");
    onDraftSave(nextCharacter);
    setSaveStatus("saved");
  }

  function clearField() {
    if (!pendingClear) {
      return;
    }

    updateField(
      pendingClear.field,
      pendingClear.field === "personalityTags" ? [] : "",
    );
    showToast(`${pendingClear.label}已清空`);
    setPendingClear(null);
  }

  function resetEditableForm() {
    const nextData = {
      ...initialCharacter,
      avatarEmoji: DEFAULT_AVATAR_EMOJI,
    };

    setFormData(nextData);
    setCustomTag("");
    setCharacterTagInput("");
    setCustomGender("");
    setGenderMode("");
    setAgeMode("manual");
    setFormError("");
    setSaveStatus("idle");
    lastAutoSavedSnapshotRef.current = JSON.stringify(nextData);
  }

  function confirmFormAction() {
    if (pendingFormAction === "clear") {
      resetEditableForm();
      showToast("当前内容已清空");
      setPendingFormAction(null);
      return;
    }

    if (pendingFormAction === "delete") {
      if (!character || !onDelete) {
        resetEditableForm();
        showToast("当前内容已清空");
        setPendingFormAction(null);
        return;
      }

      onDelete(character);
      localStorage.setItem(
        DASHBOARD_PREFS_KEY,
        JSON.stringify({
          searchTerm: "",
          sortMode: "updated-desc",
          worldviewFilter: "全部",
          genderFilter: "全部",
          visualStyleFilter: "全部",
          tagFilters: [],
          favoriteMode: character.isDraft ? "drafts" : "all",
          viewMode: "cards",
        }),
      );
      setPendingFormAction(null);
      onCancel();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveCurrentCharacter();
  }

  function renderHelperButtons(
    sectionId: Exclude<SectionId, "basic" | "prompt">,
    field: "appearanceDescription" | "abilityDescription" | "backstory",
  ) {
    const helper = helperText[sectionId];
    const labels = {
      appearanceDescription: "外貌描述",
      abilityDescription: "能力描述",
      backstory: "背景故事",
    };

    return (
      <div className="helper-row">
        <button
          className="ghost-button"
          onClick={() => appendToField(field, helper.example)}
          type="button"
        >
          示例
        </button>
        <button
          className="ghost-button"
          onClick={() => appendToField(field, helper.inspiration)}
          type="button"
        >
          随机灵感
        </button>
        <button
          className="ghost-button"
          onClick={() => appendToField(field, helper.tip)}
          type="button"
        >
          写作提示
        </button>
        <button
          className="ghost-button"
          onClick={() => setPendingClear({ field, label: labels[field] })}
          type="button"
        >
          清空
        </button>
      </div>
    );
  }

  if (editorMode === "preview") {
    return (
      <section className="workspace-shell">
        {toastMessage && <div className="toast">{toastMessage}</div>}
        {pendingClear && (
          <div className="modal-backdrop" role="presentation">
            <div className="confirm-dialog" role="dialog" aria-modal="true">
              <h2>清空内容</h2>
              <p>确定要清空「{pendingClear.label}」吗？此操作不可撤销。</p>
              <div className="form-actions">
                <button
                  className="ghost-button"
                  onClick={() => setPendingClear(null)}
                  type="button"
                >
                  取消
                </button>
                <button className="danger-button" onClick={clearField} type="button">
                  确认清空
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="workspace-preview-top">
          <button
            className="ghost-button"
            onClick={() => setEditorMode("edit")}
            type="button"
          >
            返回编辑
          </button>
        </div>
        <CharacterPreview
          character={previewCharacter}
          onBack={() => setEditorMode("edit")}
        />
      </section>
    );
  }

  return (
    <section className="workspace-shell">
      {toastMessage && <div className="toast">{toastMessage}</div>}
      {pendingClear && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>清空内容</h2>
            <p>确定要清空「{pendingClear.label}」吗？此操作不可撤销。</p>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setPendingClear(null)}
                type="button"
              >
                取消
              </button>
              <button className="danger-button" onClick={clearField} type="button">
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingFormAction && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>{pendingFormAction === "clear" ? "清空编辑内容" : "删除角色"}</h2>
            <p>
              {pendingFormAction === "clear"
                ? "确定要清空当前编辑页的全部内容吗？此操作不会删除角色。"
                : character
                  ? `确定要删除「${character.name || "未命名角色"}」吗？此操作不可撤销。`
                  : "当前角色尚未保存，删除会清空当前内容。"}
            </p>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setPendingFormAction(null)}
                type="button"
              >
                取消
              </button>
              <button className="danger-button" onClick={confirmFormAction} type="button">
                {pendingFormAction === "clear" ? "确认清空" : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="panel workspace-hero">
        <div className="workspace-title-block">
          <div className="workspace-avatar" aria-hidden="true">
            {formData.avatarEmoji || DEFAULT_AVATAR_EMOJI}
          </div>
          <div>
            <p className="eyebrow">{character ? "Character Workspace" : "New Character"}</p>
            <h1>{character ? "编辑角色工作台" : "新建角色工作台"}</h1>
            <p className="muted">分模块完善角色设定，系统会在编辑旧角色时自动保存。</p>
          </div>
        </div>
        <div className="workspace-toolbar">
          <button
            className="ghost-button"
            type="button"
            onClick={handleRandomCharacter}
            disabled={isRandomizing}
          >
            {isRandomizing ? "生成中..." : "随机生成角色"}
          </button>
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === "saving"
              ? "正在保存"
              : saveStatus === "error"
                ? "保存失败"
                : saveStatus === "saved"
                  ? "已保存"
                  : "未保存"}
          </span>
          <button
            className="ghost-button"
            onClick={() => setEditorMode("preview")}
            type="button"
          >
            预览
          </button>
          <button className="ghost-button" onClick={onCancel} type="button">
            返回
          </button>
        </div>
      </div>

      <form className="workspace-layout" onSubmit={handleSubmit}>
        <aside className="workspace-nav" aria-label="模块导航">
          {sectionMeta.map((section) => (
            <button
              className={activeSection === section.id ? "active" : ""}
              key={section.id}
              onClick={() => jumpToSection(section.id)}
              type="button"
            >
              <span>{section.title}</span>
              <small>{completionStatus(section.id, formData)}</small>
            </button>
          ))}
        </aside>

        <div className="workspace-content">
          {formError && <div className="form-error">{formError}</div>}

          <section className="workspace-card" id="workspace-basic">
            <button
              className="workspace-card-head"
              onClick={() => toggleSection("basic")}
              type="button"
            >
              <span>
                <strong>基础信息</strong>
                <small>角色身份、头像与基础档案。</small>
              </span>
              <em>{completionStatus("basic", formData)} · {collapsedSections.basic ? "展开" : "折叠"}</em>
            </button>
            {!collapsedSections.basic && (
              <div className="workspace-card-body">
                <div className="avatar-editor">
                  <div className="avatar-picker-header">
                    <div className="avatar-current-wrap">
                      <div className="avatar-current" aria-label="当前头像">
                        {formData.avatarEmoji || DEFAULT_AVATAR_EMOJI}
                      </div>
                      <div>
                        <strong>Avatar Picker</strong>
                        <p className="muted">选择适合角色设定的头像，后续可扩展 SVG、上传或 AI 头像。</p>
                      </div>
                    </div>
                    <button
                      className="ghost-button"
                      onClick={() => setIsAvatarPickerOpen((current) => !current)}
                      type="button"
                    >
                      {isAvatarPickerOpen ? "收起头像" : "更换头像"}
                    </button>
                  </div>

                  {isAvatarPickerOpen && (
                    <div className="avatar-picker">
                      <div className="avatar-category-tabs" aria-label="头像分类">
                        {avatarCategories.map((category) => (
                          <button
                            className={
                              activeAvatarCategoryId === category.id
                                ? "avatar-tab active"
                                : "avatar-tab"
                            }
                            key={category.id}
                            onClick={() => setActiveAvatarCategoryId(category.id)}
                            type="button"
                          >
                            {category.label}
                          </button>
                        ))}
                      </div>

                      <div className="avatar-section">
                        <span>最近使用</span>
                        {recentAvatars.length > 0 ? (
                          <div className="avatar-quick-grid">
                            {recentAvatars.map((emoji) => (
                              <button
                                className={
                                  formData.avatarEmoji === emoji
                                    ? "emoji-option selected"
                                    : "emoji-option"
                                }
                                key={`recent-${emoji}`}
                                onClick={() => selectAvatarEmoji(emoji)}
                                type="button"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="avatar-empty">暂无最近使用</p>
                        )}
                      </div>

                      <div className="avatar-section">
                        <span>{avatarCategoryTitle(activeAvatarCategory.label)}</span>
                        <div className="emoji-picker" aria-label={activeAvatarCategory.label}>
                          {activeAvatarCategory.emojis.map((emoji) => (
                            <button
                              className={
                                formData.avatarEmoji === emoji
                                  ? "emoji-option selected"
                                  : "emoji-option"
                              }
                              key={`${activeAvatarCategory.id}-${emoji}`}
                              onClick={() => selectAvatarEmoji(emoji)}
                              type="button"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <label>
                  名字
                  <input
                    value={formData.name}
                    onChange={(event) => {
                      updateField("name", event.target.value);
                      setFormError("");
                    }}
                    placeholder="例如：林见月"
                  />
                </label>

                <div className="form-row">
                  <label>
                    性别
                    <select
                      value={genderMode}
                      onChange={(event) => handleGenderModeChange(event.target.value)}
                    >
                      <option value="">请选择性别</option>
                      {genderOptions.map((gender) => (
                        <option key={gender} value={gender}>
                          {gender}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    年龄
                    <input
                      value={formData.age}
                      onChange={(event) => setManualAge(event.target.value)}
                      placeholder="例如：19"
                    />
                  </label>
                  <label>
                    种族
                    <input
                      value={formData.species}
                      onChange={(event) => updateField("species", event.target.value)}
                      placeholder="例如：人类 / 精灵"
                    />
                  </label>
                </div>

                {genderMode === "自定义" && (
                  <label>
                    自定义性别
                    <input
                      value={customGender}
                      onChange={(event) => handleCustomGenderChange(event.target.value)}
                      placeholder="输入自定义性别"
                    />
                  </label>
                )}

                <div className="form-row">
                  <label>
                    出生日期
                    <input
                      type="date"
                      value={formData.birthDate}
                      onChange={(event) => setBirthDate(event.target.value)}
                    />
                  </label>
                  <label>
                    出生年份
                    <input
                      value={formData.birthYear}
                      onChange={(event) => setBirthYear(event.target.value)}
                      placeholder="例如：2001"
                    />
                  </label>
                  <div className="age-hint">
                    当前方式：{ageMode === "manual" ? "手动年龄" : ageMode === "birthDate" ? "出生日期" : "出生年份"}
                  </div>
                </div>

                <div className="form-row">
                  <label>
                    职业
                    <input
                      value={formData.occupation}
                      onChange={(event) => updateField("occupation", event.target.value)}
                      placeholder="例如：调查员 / 魔法师"
                    />
                  </label>
                  <label>
                    世界观
                    <select
                      value={formData.worldview}
                      onChange={(event) => updateField("worldview", event.target.value)}
                    >
                      <option value="">请选择世界观</option>
                      {worldviewOptions.map((worldview) => (
                        <option key={worldview} value={worldview}>
                          {worldview}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    视觉风格
                    <select
                      value={formData.visualStyle}
                      onChange={(event) => updateField("visualStyle", event.target.value)}
                    >
                      <option value="">请选择视觉风格</option>
                      {visualStyleOptions.map((style) => (
                        <option key={style} value={style}>
                          {style}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            )}
          </section>

          <section className="workspace-card" id="workspace-appearance">
            <button className="workspace-card-head" onClick={() => toggleSection("appearance")} type="button">
              <span>
                <strong>外貌设定</strong>
                <small>角色可视化的轮廓、服装与标志物。</small>
              </span>
              <em>{completionStatus("appearance", formData)} · {collapsedSections.appearance ? "展开" : "折叠"}</em>
            </button>
            {!collapsedSections.appearance && (
              <div className="workspace-card-body">
                {renderHelperButtons("appearance", "appearanceDescription")}
                <label>
                  外貌描述
                  <textarea
                    value={formData.appearanceDescription}
                    onChange={(event) => {
                      updateField("appearanceDescription", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="描述发型、服装、体态、标志性物品，以及能一眼认出角色的细节。"
                  />
                </label>
              </div>
            )}
          </section>

          <section className="workspace-card" id="workspace-personality">
            <button className="workspace-card-head" onClick={() => toggleSection("personality")} type="button">
              <span>
                <strong>性格设定</strong>
                <small>用标签和短描述确定角色气质。</small>
              </span>
              <em>{completionStatus("personality", formData)} · {collapsedSections.personality ? "展开" : "折叠"}</em>
            </button>
            {!collapsedSections.personality && (
              <div className="workspace-card-body">
                <fieldset className="tag-fieldset">
                  <legend>角色标签</legend>
                  <div className="character-tag-editor">
                    {(formData.tags || []).map((tag) => (
                      <div className="character-tag-row" key={tag.id}>
                        <input
                          value={tag.name}
                          onChange={(event) =>
                            updateCharacterTag(tag.id, "name", event.target.value)
                          }
                          placeholder="标签名称"
                        />
                        <select
                          value={tag.color || "gray"}
                          onChange={(event) =>
                            updateCharacterTag(tag.id, "color", event.target.value)
                          }
                        >
                          {tagColorOptions.map((color) => (
                            <option key={color} value={color}>
                              {tagColorLabel(color)}
                            </option>
                          ))}
                        </select>
                        <button
                          className="ghost-button"
                          onClick={() => removeCharacterTag(tag.id)}
                          type="button"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="custom-tag-row">
                    <input
                      value={characterTagInput}
                      onChange={(event) => setCharacterTagInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addCharacterTag();
                        }
                      }}
                      placeholder="添加角色管理标签，例如：主角 / 反派 / 第一章"
                    />
                    <button className="ghost-button" onClick={addCharacterTag} type="button">
                      添加
                    </button>
                  </div>
                </fieldset>
                <fieldset className="tag-fieldset">
                  <legend>性格标签</legend>
                  <div className="tag-grid">
                    {personalityOptions.map((tag) => (
                      <button
                        className={
                          formData.personalityTags?.includes(tag)
                            ? "tag-button selected"
                            : "tag-button"
                        }
                        key={tag}
                        onClick={() => togglePersonalityTag(tag)}
                        type="button"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <div className="custom-tag-row">
                    <input
                      value={customTag}
                      onChange={(event) => setCustomTag(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addCustomTag();
                        }
                      }}
                      placeholder="添加自定义性格标签"
                    />
                    <button className="ghost-button" onClick={addCustomTag} type="button">
                      添加
                    </button>
                  </div>
                  {(formData.personalityTags || []).some(
                    (tag) => !personalityOptions.includes(tag),
                  ) && (
                    <div className="selected-custom-tags">
                      {(formData.personalityTags || [])
                        .filter((tag) => !personalityOptions.includes(tag))
                        .map((tag) => (
                          <button
                            className="tag-chip-remove"
                            key={tag}
                            onClick={() => removeTag(tag)}
                            type="button"
                          >
                            {tag} ×
                          </button>
                        ))}
                    </div>
                  )}
                </fieldset>
                <div className="helper-row">
                  <button
                    className="ghost-button"
                    onClick={() => {
                      togglePersonalityTag("克制");
                      togglePersonalityTag("笨拙");
                    }}
                    type="button"
                  >
                    示例
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => {
                      const helper = helperText.personality;
                      const nextTag = pickRandom(["矛盾", "克制", "执着", "笨拙"]);
                      togglePersonalityTag(nextTag);
                      showToast(helper.inspiration);
                    }}
                    type="button"
                  >
                    随机灵感
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => showToast(helperText.personality.tip)}
                    type="button"
                  >
                    写作提示
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() =>
                      setPendingClear({
                        field: "personalityTags",
                        label: "性格标签",
                      })
                    }
                    type="button"
                  >
                    清空
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="workspace-card" id="workspace-ability">
            <button className="workspace-card-head" onClick={() => toggleSection("ability")} type="button">
              <span>
                <strong>能力设定</strong>
                <small>技能、限制、战斗或特殊天赋。</small>
              </span>
              <em>{completionStatus("ability", formData)} · {collapsedSections.ability ? "展开" : "折叠"}</em>
            </button>
            {!collapsedSections.ability && (
              <div className="workspace-card-body">
                {renderHelperButtons("ability", "abilityDescription")}
                <label>
                  能力描述
                  <textarea
                    value={formData.abilityDescription}
                    onChange={(event) => {
                      updateField("abilityDescription", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="描述技能、天赋、限制、代价、战斗方式或非战斗专长。"
                  />
                </label>
              </div>
            )}
          </section>

          <section className="workspace-card" id="workspace-backstory">
            <button className="workspace-card-head" onClick={() => toggleSection("backstory")} type="button">
              <span>
                <strong>背景故事</strong>
                <small>经历、关系、目标与隐藏秘密。</small>
              </span>
              <em>{completionStatus("backstory", formData)} · {collapsedSections.backstory ? "展开" : "折叠"}</em>
            </button>
            {!collapsedSections.backstory && (
              <div className="workspace-card-body">
                {renderHelperButtons("backstory", "backstory")}
                <label>
                  背景故事
                  <textarea
                    value={formData.backstory}
                    onChange={(event) => {
                      updateField("backstory", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="描述角色的成长经历、重要事件、当前目标或隐藏秘密。"
                  />
                </label>
              </div>
            )}
          </section>

          <section className="workspace-card" id="workspace-prompt">
            <button className="workspace-card-head" onClick={() => toggleSection("prompt")} type="button">
              <span>
                <strong>AI Prompt</strong>
                <small>本地生成关键词和英文绘图 Prompt。</small>
              </span>
              <em>{completionStatus("prompt", formData)} · {collapsedSections.prompt ? "展开" : "折叠"}</em>
            </button>
            {!collapsedSections.prompt && (
              <div className="workspace-card-body">
                <label>
                  中文人物关键词
                  <textarea
                    value={formData.characterKeywords}
                    onChange={(event) => {
                      updateField("characterKeywords", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="点击重新生成，或手动整理适合分享的中文人物关键词。"
                  />
                </label>
                <div className="form-actions inline-actions">
                  <button className="ghost-button" type="button" onClick={handleGenerateKeywords}>
                    重新生成
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => copyText(formData.characterKeywords || "", "中文关键词已复制")}
                  >
                    复制
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() =>
                      setPendingClear({
                        field: "characterKeywords",
                        label: "中文人物关键词",
                      })
                    }
                  >
                    清空
                  </button>
                </div>

                <label>
                  英文 AI Prompt
                  <textarea
                    value={formData.imagePrompt}
                    onChange={(event) => {
                      updateField("imagePrompt", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="点击重新生成，或手动调整英文绘图 Prompt。"
                  />
                </label>
                <div className="form-actions inline-actions">
                  <button className="ghost-button" type="button" onClick={handleGenerateImagePrompt}>
                    重新生成
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => copyText(formData.imagePrompt || "", "英文 Prompt 已复制")}
                  >
                    复制
                  </button>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() =>
                      setPendingClear({
                        field: "imagePrompt",
                        label: "英文 AI Prompt",
                      })
                    }
                  >
                    清空
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="form-actions workspace-footer">
            <div className="footer-danger-actions">
              <button className="ghost-button" type="button" onClick={() => setPendingFormAction("clear")}>
                清空
              </button>
              <button className="danger-button" type="button" onClick={() => setPendingFormAction("delete")}>
                删除
              </button>
            </div>
            <div className="footer-main-actions">
              <button className="ghost-button" type="button" onClick={onCancel}>
                取消
              </button>
              <button className="ghost-button" type="button" onClick={saveDraftCharacter}>
                临时保存
              </button>
              <button className="primary-button" type="submit">
                保存角色
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
