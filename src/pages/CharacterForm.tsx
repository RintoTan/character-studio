import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AvatarDisplay } from "../components/AvatarDisplay";
import externalInspirationLibraryRaw from "../data/external-inspiration-library.txt?raw";
import type { Character } from "../types/character";
import {
  compressImageToAvatarBlob,
  listAvatarAssets,
  saveAvatarBlob,
  validateAvatarFile,
  type AvatarAssetRecord,
} from "../utils/avatarAssets";
import { CharacterPreview } from "./CharacterPreview";

type CharacterDraft = Omit<Character, "id" | "updatedAt">;

type CharacterFormProps = {
  character?: Character | null;
  editorSettings?: {
    expandAllSections: boolean;
    collapseAllSections: boolean;
    autoSave: boolean;
    showPromptSection: boolean;
    showPersonalPreferences: boolean;
    compactMobileEditor: boolean;
  };
  featureFlags?: {
    personalPreferences: boolean;
    compactMobileEditor: boolean;
  };
  onSave: (character: Character) => void;
  onDraftSave: (character: Character) => void;
  onAutoSave?: (character: Character) => void;
  onDelete?: (character: Character) => void;
  onCancel: () => void;
  saveSignal?: number;
  draftSaveSignal?: number;
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

type HelperSectionId = Exclude<SectionId, "basic" | "prompt">;
type HelperField =
  | "personalityTags"
  | "appearanceDescription"
  | "abilityDescription"
  | "backstory"
  | "likes"
  | "dislikes"
  | "habits"
  | "importantItems"
  | "relationshipKeywords";
type HelperKind = "example" | "inspiration" | "tip";

const DEFAULT_AVATAR_EMOJI = "🙂";
const RECENT_AVATAR_KEY = "character-studio.recent-avatars";
const DASHBOARD_PREFS_KEY = "character-studio.dashboard-prefs";

const defaultEditorSettings = {
  expandAllSections: false,
  collapseAllSections: false,
  autoSave: true,
  showPromptSection: true,
  showPersonalPreferences: true,
  compactMobileEditor: true,
};

const defaultEditorFeatureFlags = {
  personalPreferences: true,
  compactMobileEditor: true,
};

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
  avatarAssetId: "",
  isDraft: false,
  age: "",
  birthDate: "",
  birthYear: "",
  gender: "",
  species: "",
  occupation: "",
  worldview: "",
  personalityTags: [],
  appearanceDescription: "",
  abilityDescription: "",
  backstory: "",
  likes: "",
  dislikes: "",
  habits: "",
  importantItems: "",
  relationshipKeywords: "",
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
  "朝仓千鹤",
  "林烬",
  "阿黛拉",
  "卫星河",
  "柏冬",
  "莉莉安",
  "唐九歌",
  "尤里安",
  "折原真昼",
  "西泽尔",
  "孟临川",
  "薇尔汀",
  "白鹿鸣",
  "奥菲莉亚",
  "韩雾灯",
  "伊芙琳",
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
  "猫又",
  "狼人",
  "雪原巫族",
  "星舰仿生人",
  "黑塔实验体",
  "雾海亡灵",
  "树海精怪",
  "蜂群意识体",
  "龙血术士",
  "旧日观测者",
  "义体兽人",
  "水晶人偶",
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
  "星舰领航员",
  "怪物生态学者",
  "梦境调音师",
  "秘密社团会计",
  "地下诊所护士",
  "符文枪手",
  "失物回收员",
  "异界导游",
  "灾后植物学家",
  "异常气象播报员",
  "恶魔契约律师",
  "龙骑见习生",
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
  "头发像被月光漂白，颈侧有细小编号，随身带着玻璃药瓶。",
  "宽大的风衣里藏着折叠工具，眼睛在暗处会泛出冷白色。",
  "制服外套总扣错一颗纽扣，腰间挂着磨损严重的通行证。",
  "角质耳尖被银饰遮住，手背有像枝叶一样延展的纹路。",
  "斗篷内衬缀满星图，走动时会发出极轻的金属声。",
  "短发剪得很不整齐，脸上贴着旧创可贴，眼神却异常锐利。",
  "尾巴或兽耳被帽兜遮住，只在紧张时露出细微动作。",
  "半边身体覆盖透明义体，能看见内部缓慢流动的光线。",
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
  "可以和动物短暂共享视野，但会继承它们的本能反应。",
  "能把一段记忆封存在物品里，物品损坏时记忆也会破碎。",
  "可以操纵雾气隐藏行踪，但在强光下能力会失效。",
  "能读取电子设备的最后一条指令，因此常被卷入危险系统。",
  "可以让植物在废土中快速生长，但会消耗自身水分。",
  "能召唤一件失物回到手边，但必须知道它被谁遗忘。",
  "可以短暂预演三秒后的行动结果，却无法连续使用。",
  "能用契约文字限制敌人的动作，前提是对方听见完整条款。",
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
  "在一场城市停电中发现自己能听懂地下传来的广播。",
  "被迫继承家族的怪物档案，里面第一份记录正是自己。",
  "曾作为实验对象逃离研究所，仍会收到来自旧编号的召回信号。",
  "在异世界醒来后没有成为勇者，而是被安排管理边境失物处。",
  "为了寻找失踪的兄长，加入了一个专门处理异常天气的小队。",
  "从小被预言会毁灭某座城，因此一直试图证明预言错误。",
  "在梦里与某个不存在的人交换日记，醒来后内容开始成真。",
  "曾经守护一头幼龙，如今必须隐藏它留下的最后一枚鳞片。",
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

const helperInspirationLibrary: Record<
  HelperSectionId,
  string[]
> = {
  appearance: [
    "给角色添加一个会随情绪变化的小细节，例如眼中光点、发饰位置或手套纹路。",
    "设计一件与职业矛盾的服饰，比如医生穿战术靴，剑士带旧式录音笔。",
    "加入一道不解释来源的旧伤，并让它和角色当前目标产生联系。",
    "使用两种材质形成反差，例如柔软围巾搭配冰冷义体。",
    "给角色一个经常修补的随身物，让外观暗示长期流浪或反复失去。",
  ],
  personality: [
    "选择一个主性格，再添加一个只在亲近的人面前出现的反面特质。",
    "让角色有一个小小的社交误区，例如过度礼貌、不会拒绝或总把玩笑当真。",
    "添加一个隐藏的底线：平时温和，但一旦触碰就会变得非常危险。",
    "给角色安排一个与外表不一致的兴趣，例如冷面角色喜欢收集贴纸。",
    "把性格写成行动习惯：遇到危险先记录、先道歉、先保护别人或先逃跑。",
  ],
  ability: [
    "为能力增加明确代价，例如消耗记忆、体温、听觉或一段未来可能性。",
    "能力触发条件可以和角色弱点绑定，例如必须说真话、必须触碰目标。",
    "设计一个非战斗用途，让能力能服务日常、调查或情感关系。",
    "让能力有一个误判风险：能看到线索，但看不到动机。",
    "给能力添加环境限制，例如雨天增强、强光失效、安静时更稳定。",
  ],
  backstory: [
    "让角色现在追寻的问题与过去的失误有关，而不是单纯复仇。",
    "加入一个仍在寄来的信件、账单或通知，暗示旧生活没有结束。",
    "安排一个角色不敢回去的地点，并让它在主线中不可避免地出现。",
    "给角色一个被误解的身份记录，例如死亡、失踪、叛逃或不存在。",
    "让背景故事留下一个温柔的锚点：旧友、宠物、店铺、课堂或约定。",
  ],
};

const helperFragments = {
  shared: {
    identities: ["被注销身份的继承人", "临时顶替的守门人", "逃离剧团的替身", "被城市误认为不存在的人", "旧档案里的幸存者", "边境站最后一名记录员"],
    contrasts: ["负责救援却害怕触碰别人", "外表像贵族却靠修理废品生活", "擅长谈判但从不说真名", "被称为英雄却一直逃避公开露面", "看似冷漠却记得每个人的忌口"],
    secrets: ["藏着一份会改写身份的旧契约", "每晚都会忘记一个重要名字", "曾经亲手放走真正的灾厄", "身体里封存着另一个人的证词", "一直替敌人保管遗物"],
    desires: ["想被某个人正式记住", "想亲眼确认预言是错的", "想拥有一间不用逃跑的房间", "想把旧城区从地图上救回来", "想偿还一场无人知晓的善意"],
    fears: ["害怕安静房间里的回声", "害怕再次被留下看守出口", "害怕镜子里出现不属于自己的表情", "害怕别人说出自己的旧称呼", "害怕能力失效时仍被期待"],
    relationships: ["与前搭档只靠加密留言联系", "把仇人的孩子当作学生照顾", "和一位失踪多年的亲人互相隐瞒身份", "被某个组织当作吉祥物保护", "欠一名陌生医生三次人情"],
    symbols: ["裂开的白瓷面具", "写满旧地址的手套", "无法点燃的火柴盒", "总是慢一分钟的怀表", "刻着错误生日的铭牌"],
    catchphrases: ["“先别下结论。”", "“我只负责把门打开。”", "“名字这种东西，借用一下也可以吧。”", "“如果灯灭了，就跟着我的声音走。”", "“这次我会留下。”"],
  },
  appearance: {
    features: ["异色瞳", "浅色旧伤", "微光义眼", "被剪短的发尾", "兽耳或尖耳", "颈侧编号", "手背纹路", "瞳孔像碎玻璃", "指尖有墨色烧痕", "影子边缘偶尔延迟半拍"],
    clothing: ["旧风衣", "改造校服", "高领斗篷", "战术外套", "礼服式制服", "宽大雨衣", "层叠披肩", "沾着盐粒的水手外套", "缝着不同徽章的短斗篷", "过于正式的黑色手套"],
    accessories: ["不成对耳坠", "磨损通行证", "玻璃药瓶", "坏掉的钥匙串", "护身符", "旧式录音笔", "折叠工具", "空白学生证", "封蜡信筒", "只剩一半的地图"],
    actions: ["紧张时会整理袖口", "说谎时会避开光源", "走路几乎没有声响", "总把手藏进袖子里", "听见钟声会停顿一下", "靠近门口时会先确认退路", "独处时会练习陌生人的签名"],
  },
  personality: {
    traits: ["克制", "执着", "笨拙", "警觉", "矛盾", "嘴硬心软", "过度礼貌", "慢热", "危险地温柔", "习惯性自嘲", "对规则异常虔诚"],
    behaviors: ["遇到危险先观察出口", "习惯替别人收拾残局", "总把玩笑当真", "做决定前会反复记录", "与人争吵后会默默留下药和水", "听别人说话时会记下关键词"],
    hobbies: ["收集旧车票", "修理坏掉的小物件", "给陌生人写未寄出的信", "整理怪谈剪报", "给无名墓碑拍照", "临摹城市里的禁令标识"],
    flaws: ["不擅长求助", "容易过度负责", "害怕被留下", "会把沉默误认为拒绝", "面对亲近的人反而说不出真话", "一旦承诺就很难停手"],
  },
  ability: {
    powers: ["读取残留记忆", "短暂操控雾气", "预演三秒后的行动", "与机械共感", "封存一段记忆", "看见谎言的线", "让影子替自己回答一次问题", "把伤口转移到无生命物件上", "听见建筑物的恐惧"],
    costs: ["消耗体温", "短暂失聪", "遗忘一件小事", "失去方向感", "情绪被放大", "必须说出真实姓名", "失去一段梦境", "让身边电子设备短暂失灵"],
    triggers: ["触碰目标后", "听到特定频率时", "在雨中", "强光消失后", "完成契约文字时", "进入安静空间后", "读出完整地址时", "被对方叫出旧名字后"],
    limits: ["无法判断动机", "连续使用会失控", "对熟人效果变弱", "会暴露自己的位置", "需要安静准备", "不能对同一对象连续生效", "会留下可追踪的气味或噪点"],
  },
  backstory: {
    events: ["城市停电", "学院失踪案", "边境灾难", "秘密实验", "午夜店铺继承", "匿名委托", "异常天气事故", "列车消失三分钟", "港口出现第二个月亮", "旧神祭典被临时取消"],
    secrets: ["真实身份被记录为死亡", "保管着不该存在的档案", "一直收到未来的信", "曾短暂成为仪式祭品", "知道某位英雄其实没有死", "亲眼见过世界线被重写"],
    goals: ["寻找失踪的家人", "证明预言错误", "偿还一笔旧债", "守住某个温柔约定", "找回被删除的记忆", "把某个名字重新写回城市档案", "让一位敌人获得迟来的葬礼"],
    anchors: ["一张旧地图", "一枚龙鳞", "一封没有署名的信", "一只只在梦里出现的鸟", "一间午夜营业的小店", "刻着两个人名字的车票", "一枚无法被拍照记录的徽章"],
    conflicts: ["官方档案坚持说这件事从未发生", "同伴认为真相不值得公开", "能力越接近答案越容易失控", "关键证人只在梦里出现", "追查对象正是曾经救过自己的人"],
  },
};

type HelperFragmentGroups = typeof helperFragments;
type HelperFragmentGroupName = keyof HelperFragmentGroups;

function parseRawInspirationFragments(rawValue: string) {
  const result: Record<string, Record<string, string[]>> = {};
  let currentGroup = "";
  let currentField = "";

  rawValue.split(/\r?\n/).forEach((line) => {
    const sectionMatch = line.match(/^\/\/\s*=+\s*([\w.]+)/);

    if (sectionMatch) {
      const [group = "", field = ""] = sectionMatch[1].split(".");
      currentGroup = group;
      currentField = field;

      if (currentGroup && currentField) {
        result[currentGroup] = result[currentGroup] || {};
        result[currentGroup][currentField] = result[currentGroup][currentField] || [];
      }

      return;
    }

    if (!currentGroup || !currentField) {
      return;
    }

    const trimmedLine = line.trim();

    if (!trimmedLine.startsWith("\"")) {
      return;
    }

    try {
      const value = JSON.parse(trimmedLine.replace(/,$/, "")) as unknown;

      if (typeof value === "string" && value.trim()) {
        result[currentGroup][currentField].push(value.trim());
      }
    } catch {
      // Ignore malformed resource lines and keep the built-in fallback library usable.
    }
  });

  return result;
}

function mergeInspirationFragments(
  base: HelperFragmentGroups,
  additions: Record<string, Record<string, string[]>>,
) {
  const merged = Object.fromEntries(
    Object.entries(base).map(([groupName, fields]) => [
      groupName,
      Object.fromEntries(
        Object.entries(fields).map(([fieldName, values]) => {
          const extraValues = additions[groupName]?.[fieldName] || [];
          return [fieldName, [...values, ...extraValues]];
        }),
      ),
    ]),
  ) as HelperFragmentGroups;

  return merged;
}

const inspirationFragments = mergeInspirationFragments(
  helperFragments,
  parseRawInspirationFragments(externalInspirationLibraryRaw),
);

const recentHelperOutputs: string[] = [];

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
    .replace(/[；;，,。.、]+/g, (match) => match[0])
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

function normalizeChineseText(value?: string) {
  return cleanText(value)
    ?.replace(/\s*([，、；。])\s*/g, "$1")
    .replace(/[，、]{2,}/g, "、")
    .replace(/；{2,}/g, "；")
    .replace(/。{2,}/g, "。")
    .replace(/[，、；。]+$/g, "") || "";
}

function normalizePromptPart(value?: string) {
  return cleanText(value)
    ?.replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ",")
    .replace(/\s+/g, " ")
    .replace(/[,.，；、。]+$/g, "") || "";
}

function pickRandom(options: string[]) {
  return options[Math.floor(Math.random() * options.length)];
}

function chance(probability: number) {
  return Math.random() < probability;
}

function getPromptDeveloperSetting(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function getPromptProbability(baseProbability: number) {
  const complexity = getPromptDeveloperSetting("character-studio.prompt.complexity", "medium");

  if (complexity === "low") {
    return Math.max(baseProbability - 0.2, 0.2);
  }

  if (complexity === "high") {
    return Math.min(baseProbability + 0.16, 0.94);
  }

  return baseProbability;
}

function pickOptional(options: string[], probability = 0.72) {
  return chance(getPromptProbability(probability)) ? pickRandom(options) : "";
}

function allowRandomMissingFields() {
  return getPromptDeveloperSetting("character-studio.prompt.random-missing-fields", "true") !== "false";
}

function randomFieldChance(probability: number) {
  return allowRandomMissingFields() ? chance(probability) : true;
}

function getRepeatLimit() {
  const repeatControl = getPromptDeveloperSetting("character-studio.prompt.repeat-control", "normal");

  if (repeatControl === "strict") {
    return 18;
  }

  if (repeatControl === "off") {
    return 0;
  }

  return 12;
}

function shouldUseExternalInspirationLibrary() {
  return getPromptDeveloperSetting("character-studio.prompt.external-library", "true") !== "false";
}

function rememberHelperOutput(value: string) {
  const repeatLimit = getRepeatLimit();

  if (repeatLimit <= 0) {
    return;
  }

  recentHelperOutputs.unshift(value);
  recentHelperOutputs.splice(repeatLimit);
}

function isRecentHelperOutput(value: string) {
  return getRepeatLimit() > 0 && recentHelperOutputs.includes(value);
}

function joinClauses(parts: Array<string | undefined | false>) {
  return compactParts(parts).join("，");
}

function finishSentence(value: string) {
  const cleanedValue = cleanText(value);
  return cleanedValue ? `${cleanedValue}。` : "";
}

function pickFragmentGroup<T extends HelperFragmentGroupName>(groupName: T) {
  if (!shouldUseExternalInspirationLibrary()) {
    return helperFragments[groupName];
  }

  const customLibraryText = getPromptDeveloperSetting("character-studio.prompt.custom-library", "");
  if (!customLibraryText.trim()) {
    return inspirationFragments[groupName];
  }

  return mergeInspirationFragments(
    inspirationFragments,
    parseRawInspirationFragments(customLibraryText),
  )[groupName];
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

function pickRandomTags() {
  return [...personalityOptions]
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.floor(Math.random() * 3) + 2);
}

function generateHelperSet(sectionId: HelperSectionId) {
  return {
    example: generateHelperContent(sectionId, "example"),
    inspiration: generateHelperContent(sectionId, "inspiration"),
    tip: generateHelperContent(sectionId, "tip"),
  };
}

function generateHelperContent(sectionId: HelperSectionId, kind: HelperKind) {
  const shared = pickFragmentGroup("shared");
  const unique = (builder: () => string) => {
    for (let index = 0; index < 8; index += 1) {
      const value = builder();
      if (!isRecentHelperOutput(value)) {
        rememberHelperOutput(value);
        return value;
      }
    }

    const fallback = builder();
    rememberHelperOutput(fallback);
    return fallback;
  };

  if (sectionId === "appearance") {
    const parts = pickFragmentGroup("appearance");
    return unique(() => {
      const visualHook = joinClauses([
        pickOptional(parts.features, 0.9),
        pickOptional(parts.clothing, 0.75) && `穿着${pickRandom(parts.clothing)}`,
        pickOptional(parts.accessories, 0.68) && `随身带着${pickRandom(parts.accessories)}`,
        pickOptional(parts.actions, 0.55),
      ]);

      if (kind === "example") {
        return finishSentence(
          pickRandom([
            visualHook,
            `${pickRandom(shared.identities)}的识别点是${joinClauses([pickRandom(parts.features), pickOptional(parts.accessories, 0.8)])}`,
            `${pickRandom(parts.clothing)}被反复修补，${pickRandom(parts.actions)}`,
          ]),
        );
      }
      if (kind === "tip") {
        return finishSentence(
          pickRandom([
            `外貌可以从“识别点、生活痕迹、情绪动作”里随机挑两项，例如${joinClauses([pickRandom(parts.features), pickRandom(parts.actions)])}`,
            `让一个象征物参与外观：${pickRandom(shared.symbols)}可以解释服装、伤痕或动作习惯`,
            `不要只写漂亮或帅气，可以加入反差：${pickRandom(shared.contrasts)}`,
          ]),
        );
      }
      return finishSentence(
        joinClauses([
          chance(0.65) ? `${pickRandom(shared.identities)}留下的外观线索` : "新的视觉灵感",
          pickRandom(parts.features),
          pickOptional(parts.clothing, 0.6) && `外搭${pickRandom(parts.clothing)}`,
          pickOptional(shared.symbols, 0.5) && `与${pickRandom(shared.symbols)}有关`,
          pickOptional(shared.fears, 0.45) && `在害怕${pickRandom(shared.fears)}时变得明显`,
        ]),
      );
    });
  }

  if (sectionId === "personality") {
    const parts = pickFragmentGroup("personality");
    return unique(() => {
      if (kind === "example") {
        return finishSentence(
          joinClauses([
            pickRandom(parts.traits),
            chance(0.72) ? `但${pickRandom(parts.flaws)}` : "",
            chance(0.62) ? `平时${pickRandom(parts.behaviors)}` : "",
            chance(0.42) ? `私下喜欢${pickRandom(parts.hobbies)}` : "",
          ]),
        );
      }
      if (kind === "tip") {
        return finishSentence(
          pickRandom([
            `用“性格矛盾 + 行为证据”写人，例如${pickRandom(shared.contrasts)}，再让 TA ${pickRandom(parts.behaviors)}`,
            `给角色一个会泄露情绪的小动作，再配一个缺点：${pickRandom(parts.flaws)}`,
            `性格可以被欲望推动：${pickRandom(shared.desires)}，但又害怕${pickRandom(shared.fears)}`,
          ]),
        );
      }
      return finishSentence(
        joinClauses([
          `${pickRandom(parts.traits)}的外层下藏着${pickRandom(shared.desires)}`,
          chance(0.6) ? `遇到${pickRandom(shared.relationships)}时会${pickRandom(parts.behaviors)}` : "",
          chance(0.5) ? `说话方式接近${pickRandom(shared.catchphrases)}` : "",
          chance(0.45) ? `最大弱点是${pickRandom(parts.flaws)}` : "",
        ]),
      );
    });
  }

  if (sectionId === "ability") {
    const parts = pickFragmentGroup("ability");
    return unique(() => {
      if (kind === "example") {
        return finishSentence(
          joinClauses([
            `${pickRandom(parts.triggers)}可以${pickRandom(parts.powers)}`,
            chance(0.82) ? `代价是${pickRandom(parts.costs)}` : "",
            chance(0.62) ? pickRandom(parts.limits) : "",
          ]),
        );
      }
      if (kind === "tip") {
        return finishSentence(
          pickRandom([
            `能力限制最好能反过来推动剧情：${pickRandom(parts.limits)}可以成为破局方法`,
            `把能力代价和秘密绑定：${pickRandom(shared.secrets)}，所以每次使用都会更危险`,
            `触发条件越具体越好，例如${pickRandom(parts.triggers)}，会让能力更有画面感`,
          ]),
        );
      }
      return finishSentence(
        joinClauses([
          chance(0.55) ? `因为${pickRandom(shared.secrets)}` : `${pickRandom(shared.identities)}的能力设定`,
          `${pickRandom(parts.triggers)}才会${pickRandom(parts.powers)}`,
          chance(0.75) ? `能力代价是${pickRandom(parts.costs)}` : "",
          chance(0.55) ? `限制为${pickRandom(parts.limits)}` : "",
        ]),
      );
    });
  }

  const parts = pickFragmentGroup("backstory");
  return unique(() => {
    if (kind === "example") {
      return finishSentence(
        joinClauses([
          `经历过${pickRandom(parts.events)}后`,
          chance(0.7) ? `一直带着${pickRandom(parts.anchors)}` : "",
          chance(0.78) ? `目标是${pickRandom(parts.goals)}` : "",
          chance(0.58) ? `真正害怕的是${pickRandom(shared.fears)}` : "",
        ]),
      );
    }
    if (kind === "tip") {
      return finishSentence(
        pickRandom([
          `背景故事可以随机抽取“事件、秘密、目标、冲突”中的三项：${pickRandom(parts.events)}留下了${pickRandom(parts.secrets)}`,
          `让身份影响秘密：${pickRandom(shared.identities)}不一定知道自己其实${pickRandom(parts.secrets)}`,
          `给角色一个小而明确的目标，例如${pickRandom(parts.goals)}，再设置阻碍：${pickRandom(parts.conflicts)}`,
        ]),
      );
    }
    return finishSentence(
      joinClauses([
        `${pickRandom(shared.identities)}卷入${pickRandom(parts.events)}`,
        chance(0.64) ? `留下${pickRandom(parts.anchors)}作为标志物` : "",
        chance(0.7) ? `现在必须${pickRandom(parts.goals)}` : "",
        chance(0.62) ? `否则${pickRandom(parts.conflicts)}` : "",
        chance(0.42) ? `秘密是${pickRandom(parts.secrets)}` : "",
      ]),
    );
  });
}

function buildRandomAppearanceDescription(personalityTags: string[], worldviewDetail: string) {
  const shared = pickFragmentGroup("shared");
  const parts = pickFragmentGroup("appearance");

  return finishSentence(
    joinClauses([
      pickRandom(parts.features),
      chance(0.78) ? `穿着${pickRandom(parts.clothing)}` : "",
      chance(0.68) ? `随身带着${pickRandom(parts.accessories)}` : "",
      chance(0.58) ? pickRandom(parts.actions) : "",
      chance(0.5) ? `整体气质偏${pickRandom(personalityTags)}` : "",
      chance(0.42) ? `适合出现在${worldviewDetail}` : "",
      chance(0.34) ? `象征物是${pickRandom(shared.symbols)}` : "",
    ]),
  );
}

function buildRandomAbilityDescription() {
  const shared = pickFragmentGroup("shared");
  const parts = pickFragmentGroup("ability");

  return finishSentence(
    joinClauses([
      `${pickRandom(parts.triggers)}可以${pickRandom(parts.powers)}`,
      chance(0.78) ? `代价是${pickRandom(parts.costs)}` : "",
      chance(0.62) ? pickRandom(parts.limits) : "",
      chance(0.36) ? `能力与${pickRandom(shared.secrets)}有关` : "",
    ]),
  );
}

function buildRandomBackstoryDescription(worldviewDetail: string) {
  const shared = pickFragmentGroup("shared");
  const parts = pickFragmentGroup("backstory");

  return finishSentence(
    joinClauses([
      chance(0.55) ? pickRandom(shared.identities) : "",
      `经历过${pickRandom(parts.events)}`,
      chance(0.66) ? `留下${pickRandom(parts.anchors)}` : "",
      chance(0.74) ? `目标是${pickRandom(parts.goals)}` : "",
      chance(0.52) ? `主要活动地点与${worldviewDetail}有关` : "",
      chance(0.48) ? `隐藏秘密是${pickRandom(parts.secrets)}` : "",
      chance(0.42) ? `冲突在于${pickRandom(parts.conflicts)}` : "",
    ]),
  );
}

function chooseAvatarForCharacter(character: Pick<CharacterDraft, "species" | "occupation" | "worldview" | "abilityDescription" | "gender">) {
  const text = [
    character.species,
    character.occupation,
    character.worldview,
    character.abilityDescription,
    character.gender,
  ].join(" ");

  const avatarRules: Array<[string[], string[]]> = [
    [["魔法", "巫", "术士", "炼金", "结界"], ["🧙", "🧙‍♀️", "🧙‍♂️"]],
    [["动物", "兽", "狼", "猫又", "狼人"], ["🐺", "🐱", "🦊"]],
    [["机械", "义体", "仿生", "机器人", "数据", "赛博"], ["🤖", "👾", "🧑‍🚀"]],
    [["幽灵", "亡灵", "怪物", "梦魇", "克苏鲁", "旧日"], ["👻", "💀", "👽"]],
    [["龙", "龙裔", "龙骑"], ["🐉", "🐲"]],
    [["精灵", "妖精", "树海"], ["🧝", "🧚", "🧝‍♀️", "🧝‍♂️"]],
    [["英雄", "雇佣兵", "枪手", "守卫"], ["🦸", "🥷", "🧑‍🚒"]],
    [["女"], ["👩", "👩‍🦰", "👸"]],
    [["男"], ["👨", "👨‍🦱", "🤴"]],
  ];

  const matchedRule = avatarRules.find(([keywords]) =>
    keywords.some((keyword) => text.includes(keyword)),
  );

  return matchedRule ? pickRandom(matchedRule[1]) : pickRandom(["🙂", "😐", "😎", "🧑", "🧒"]);
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
    character.likes && `喜好：${character.likes}`,
    character.dislikes && `厌恶：${character.dislikes}`,
    character.habits && `习惯：${character.habits}`,
    character.importantItems && `重要物品：${character.importantItems}`,
    character.relationshipKeywords && `人际关系：${character.relationshipKeywords}`,
  ])
    .map(normalizeChineseText)
    .filter(Boolean)
    .join("；");
}

function generateImagePrompt(character: CharacterDraft) {
  const personality = character.personalityTags?.map(promptText).map(normalizePromptPart).filter(Boolean).join(", ");

  return compactParts([
    "original character design",
    character.name && `named ${promptText(character.name)}`,
    character.gender && `gender: ${promptText(character.gender)}`,
    character.age && `age: ${promptText(character.age)}`,
    character.species && `race: ${promptText(character.species)}`,
    character.occupation && `occupation: ${promptText(character.occupation)}`,
    character.worldview && `world: ${promptText(character.worldview)}`,
    personality && `personality: ${personality}`,
    character.appearanceDescription &&
      `appearance: ${promptText(character.appearanceDescription)}`,
    character.abilityDescription &&
      `ability: ${promptText(character.abilityDescription)}`,
    character.backstory && `backstory: ${promptText(character.backstory)}`,
    character.likes && `likes: ${promptText(character.likes)}`,
    character.dislikes && `dislikes: ${promptText(character.dislikes)}`,
    character.habits && `habits: ${promptText(character.habits)}`,
    character.importantItems && `important items: ${promptText(character.importantItems)}`,
    character.relationshipKeywords && `relationship keywords: ${promptText(character.relationshipKeywords)}`,
    character.visualStyle && `visual style: ${promptText(character.visualStyle)}`,
    "high quality, detailed character concept art",
  ])
    .map(normalizePromptPart)
    .filter(Boolean)
    .join(", ");
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
  editorSettings = defaultEditorSettings,
  featureFlags = defaultEditorFeatureFlags,
  onSave,
  onDraftSave,
  onAutoSave,
  onDelete,
  onCancel,
  saveSignal = 0,
  draftSaveSignal = 0,
}: CharacterFormProps) {
  const effectiveEditorSettings = {
    ...defaultEditorSettings,
    ...editorSettings,
  };
  const effectiveFeatureFlags = {
    ...defaultEditorFeatureFlags,
    ...featureFlags,
  };
  const showPromptSection = effectiveEditorSettings.showPromptSection;
  const showPersonalPreferences =
    effectiveEditorSettings.showPersonalPreferences && effectiveFeatureFlags.personalPreferences;
  const [formData, setFormData] = useState<CharacterDraft>(initialCharacter);
  const [customTag, setCustomTag] = useState("");
  const [customGender, setCustomGender] = useState("");
  const [genderMode, setGenderMode] = useState("自定义");
  const [ageMode, setAgeMode] = useState<"manual" | "birthDate">(
    "manual",
  );
  const [formError, setFormError] = useState("");
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [activeAvatarCategoryId, setActiveAvatarCategoryId] = useState(
    avatarCategories[0].id,
  );
  const [isAvatarPickerOpen, setIsAvatarPickerOpen] = useState(false);
  const [isAvatarImageMenuOpen, setIsAvatarImageMenuOpen] = useState(false);
  const [isAvatarUrlOpen, setIsAvatarUrlOpen] = useState(false);
  const [avatarUrlValue, setAvatarUrlValue] = useState("");
  const [isAvatarDragActive, setIsAvatarDragActive] = useState(false);
  const [isAssetLibraryOpen, setIsAssetLibraryOpen] = useState(false);
  const [avatarAssets, setAvatarAssets] = useState<AvatarAssetRecord[]>([]);
  const [pendingAvatar, setPendingAvatar] = useState<{
    blob: Blob;
    name: string;
    previewUrl: string;
  } | null>(null);
  const [cropDraft, setCropDraft] = useState<{
    fileName: string;
    imageUrl: string;
    offsetX: number;
    offsetY: number;
    zoom: number;
  } | null>(null);
  const [cropDrag, setCropDrag] = useState<{ x: number; y: number } | null>(null);
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
  const [helperSuggestion, setHelperSuggestion] = useState<{
    sectionId: HelperSectionId;
    field: HelperField;
    label: string;
    value: string;
    example: string;
    inspiration: string;
    tip: string;
  } | null>(null);
  const [isHelperReplaceConfirmOpen, setIsHelperReplaceConfirmOpen] = useState(false);
  const [pendingFormAction, setPendingFormAction] = useState<"clear" | "delete" | null>(null);
  const [isEditorMoreOpen, setIsEditorMoreOpen] = useState(false);
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
  const draftSaveSignalRef = useRef(draftSaveSignal);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);
  const avatarImageMenuRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropStageRef = useRef<HTMLDivElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);

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

  const visibleSectionMeta = sectionMeta.filter((section) =>
    section.id === "prompt" ? showPromptSection : true,
  );

  const activeAvatarCategory =
    avatarCategories.find((category) => category.id === activeAvatarCategoryId) ||
    avatarCategories[0];

  useEffect(() => {
    const nextData: CharacterDraft = character
      ? {
          name: character.name,
          avatarEmoji: character.avatarEmoji || DEFAULT_AVATAR_EMOJI,
          avatarAssetId: character.avatarAssetId || "",
          isDraft: character.isDraft === true,
          draftOfId: character.draftOfId,
          age: character.age || "",
          birthDate: character.birthDate || "",
          birthYear: character.birthYear || "",
          gender: character.gender || "",
          species: character.species || "",
          occupation: character.occupation || "",
          worldview: character.worldview || "",
          personalityTags: character.personalityTags || [],
          appearanceDescription: character.appearanceDescription || "",
          abilityDescription: character.abilityDescription || "",
          backstory: character.backstory || "",
          likes: character.likes || "",
          dislikes: character.dislikes || "",
          habits: character.habits || "",
          importantItems: character.importantItems || "",
          relationshipKeywords: character.relationshipKeywords || "",
          visualStyle: character.visualStyle || "",
          characterKeywords: character.characterKeywords || "",
          imagePrompt: character.imagePrompt || "",
        }
      : {
          ...initialCharacter,
          avatarEmoji: DEFAULT_AVATAR_EMOJI,
          avatarAssetId: "",
        };

    setFormData(nextData);
    lastAutoSavedSnapshotRef.current = JSON.stringify(nextData);
    setSaveStatus(character ? "saved" : "idle");
    setAgeMode(character?.birthDate ? "birthDate" : "manual");
    if (character?.gender && genderOptions.includes(character.gender)) {
      setGenderMode(character.gender);
      setCustomGender("");
    } else {
      setGenderMode(character?.gender ? "自定义" : "");
      setCustomGender(character?.gender || "");
    }
    setFormError("");
    setEditorMode("edit");
    if (effectiveEditorSettings.expandAllSections) {
      setCollapsedSections({
        basic: false,
        appearance: false,
        personality: false,
        ability: false,
        backstory: false,
        prompt: false,
      });
    } else if (effectiveEditorSettings.collapseAllSections) {
      setCollapsedSections({
        basic: false,
        appearance: true,
        personality: true,
        ability: true,
        backstory: true,
        prompt: true,
      });
    }
    clearPendingAvatar();
  }, [character?.id, effectiveEditorSettings.collapseAllSections, effectiveEditorSettings.expandAllSections]);

  useEffect(() => {
    if (!effectiveEditorSettings.autoSave || !character?.isDraft || !onAutoSave) {
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
  }, [character, effectiveEditorSettings.autoSave, formData, onAutoSave]);

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
    void saveCurrentCharacter();
  }, [saveSignal]);

  useEffect(() => {
    if (draftSaveSignal === draftSaveSignalRef.current) {
      return;
    }

    draftSaveSignalRef.current = draftSaveSignal;
    void saveDraftCharacter();
  }, [draftSaveSignal]);

  useEffect(() => {
    return () => {
      if (pendingAvatar?.previewUrl) {
        URL.revokeObjectURL(pendingAvatar.previewUrl);
      }
    };
  }, [pendingAvatar?.previewUrl]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      if (cropDraft) {
        closeCropDialog();
      }
      setIsAssetLibraryOpen(false);
      setIsAvatarImageMenuOpen(false);
      setIsAvatarPickerOpen(false);
      setIsAvatarUrlOpen(false);
      setAvatarUrlValue("");
      setHelperSuggestion(null);
      setIsHelperReplaceConfirmOpen(false);
      setIsEditorMoreOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [cropDraft]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!isAvatarImageMenuOpen) {
        return;
      }

      if (avatarImageMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsAvatarImageMenuOpen(false);
      setIsAvatarUrlOpen(false);
      setAvatarUrlValue("");
      setIsAvatarDragActive(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isAvatarImageMenuOpen]);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      if (!isAvatarImageMenuOpen) {
        return;
      }

      const imageItem = Array.from(event.clipboardData?.items || []).find((item) =>
        item.type.startsWith("image/"),
      );

      if (!imageItem) {
        return;
      }

      const file = imageItem.getAsFile();

      if (file) {
        event.preventDefault();
        void handleAvatarUpload(file);
      }
    }

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [isAvatarImageMenuOpen]);

  function updateField(field: keyof CharacterDraft, value: string | string[]) {
    setFormData((current) => ({ ...current, [field]: value }));
  }

  function selectAvatarEmoji(emoji: string) {
    updateField("avatarEmoji", emoji);
    setRecentAvatars(saveRecentAvatar(emoji));
    setIsAvatarPickerOpen(false);
    setIsAvatarImageMenuOpen(false);
  }

  function closeAvatarOverlays() {
    setIsAvatarImageMenuOpen(false);
    setIsAvatarPickerOpen(false);
    setIsAvatarUrlOpen(false);
    setAvatarUrlValue("");
    setIsAvatarDragActive(false);
  }

  function openAvatarCrop(file: File) {
    closeAvatarOverlays();
    setIsAssetLibraryOpen(false);
    setCropDraft({
      fileName: file.name || "avatar",
      imageUrl: URL.createObjectURL(file),
      offsetX: 0,
      offsetY: 0,
      zoom: 1,
    });
  }

  async function handleAvatarUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    const validationError = validateAvatarFile(file);

    if (validationError) {
      showToast(validationError);
      if (avatarFileInputRef.current) {
        avatarFileInputRef.current.value = "";
      }
      return;
    }

    openAvatarCrop(file);
    setIsAvatarImageMenuOpen(false);

    if (avatarFileInputRef.current) {
      avatarFileInputRef.current.value = "";
    }
  }

  function inferImageTypeFromUrl(value: string) {
    const pathname = value.split("?")[0].toLowerCase();

    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) {
      return "image/jpeg";
    }
    if (pathname.endsWith(".png")) {
      return "image/png";
    }
    if (pathname.endsWith(".webp")) {
      return "image/webp";
    }

    return "";
  }

  async function handleAvatarUrlSubmit(urlOverride?: string) {
    const url = (urlOverride || avatarUrlValue).trim();

    if (!url) {
      showToast("请输入图片 URL");
      return;
    }

    try {
      const response = await fetch(url, { mode: "cors" });

      if (!response.ok) {
        throw new Error("图片读取失败");
      }

      const blob = await response.blob();
      const mimeType = blob.type || inferImageTypeFromUrl(url);

      if (!mimeType) {
        throw new Error("无法识别图片格式");
      }

      const file = new File([blob.type ? blob : new Blob([blob], { type: mimeType })], "url-avatar", {
        type: mimeType,
      });
      await handleAvatarUpload(file);
      setIsAvatarUrlOpen(false);
      setAvatarUrlValue("");
      setIsAvatarImageMenuOpen(false);
    } catch {
      showToast("URL 图片读取失败，请下载后上传或尝试拖拽图片");
    }
  }

  function adjustCropZoom(delta: number) {
    setCropDraft((current) =>
      clampCropDraft(
        current
          ? {
              ...current,
              zoom: Math.max(0.25, Math.min(8, current.zoom + delta)),
            }
          : current,
      ),
    );
  }

  async function handleAvatarDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsAvatarDragActive(false);

    const file = Array.from(event.dataTransfer.files).find((item) =>
      item.type.startsWith("image/"),
    );

    if (file) {
      await handleAvatarUpload(file);
      return;
    }

    const url =
      event.dataTransfer.getData("text/uri-list") ||
      event.dataTransfer.getData("text/plain");

    if (url) {
      await handleAvatarUrlSubmit(url);
      return;
    }

    showToast("请拖入 JPG、PNG 或 WEBP 图片");
  }

  function getVisibleCrop() {
    if (!cropDraft || !cropImageRef.current) {
      return null;
    }

    const image = cropImageRef.current;
    const stage = cropStageRef.current;
    const frame = cropFrameRef.current;

    if (!stage || !frame) {
      return null;
    }

    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const stageAspect = stageRect.width / stageRect.height;
    const baseWidth = imageAspect >= stageAspect
      ? stageRect.width
      : stageRect.height * imageAspect;
    const baseHeight = imageAspect >= stageAspect
      ? stageRect.width / imageAspect
      : stageRect.height;
    const renderedWidth = baseWidth * cropDraft.zoom;
    const renderedHeight = baseHeight * cropDraft.zoom;
    const imageLeft = stageRect.left + stageRect.width / 2 + cropDraft.offsetX - renderedWidth / 2;
    const imageTop = stageRect.top + stageRect.height / 2 + cropDraft.offsetY - renderedHeight / 2;
    const frameLeft = frameRect.left;
    const frameTop = frameRect.top;
    const frameSize = Math.min(frameRect.width, frameRect.height);
    const sourceX = ((frameLeft - imageLeft) / renderedWidth) * image.naturalWidth;
    const sourceY = ((frameTop - imageTop) / renderedHeight) * image.naturalHeight;
    const sourceSize = (frameSize / renderedWidth) * image.naturalWidth;

    return { sourceX, sourceY, sourceSize };
  }

  function getCropMetrics(zoom = cropDraft?.zoom || 1) {
    if (!cropImageRef.current || !cropStageRef.current || !cropFrameRef.current) {
      return null;
    }

    const image = cropImageRef.current;
    const stageRect = cropStageRef.current.getBoundingClientRect();
    const frameRect = cropFrameRef.current.getBoundingClientRect();
    const imageAspect = image.naturalWidth / image.naturalHeight;
    const stageAspect = stageRect.width / stageRect.height;
    const baseWidth = imageAspect >= stageAspect
      ? stageRect.width
      : stageRect.height * imageAspect;
    const baseHeight = imageAspect >= stageAspect
      ? stageRect.width / imageAspect
      : stageRect.height;
    const minZoom = Math.max(1, frameRect.width / baseWidth, frameRect.height / baseHeight);
    const nextZoom = Math.max(zoom, minZoom);
    const renderedWidth = baseWidth * nextZoom;
    const renderedHeight = baseHeight * nextZoom;
    const frameLeft = frameRect.left - stageRect.left;
    const frameTop = frameRect.top - stageRect.top;
    const frameRight = frameLeft + frameRect.width;
    const frameBottom = frameTop + frameRect.height;
    const minX = frameRight - renderedWidth / 2 - stageRect.width / 2;
    const maxX = frameLeft + renderedWidth / 2 - stageRect.width / 2;
    const minY = frameBottom - renderedHeight / 2 - stageRect.height / 2;
    const maxY = frameTop + renderedHeight / 2 - stageRect.height / 2;

    return { minZoom, zoom: nextZoom, minX, maxX, minY, maxY };
  }

  function clampCropDraft(nextDraft: typeof cropDraft) {
    if (!nextDraft) {
      return nextDraft;
    }

    const metrics = getCropMetrics(nextDraft.zoom);

    if (!metrics) {
      return nextDraft;
    }

    return {
      ...nextDraft,
      zoom: metrics.zoom,
      offsetX: Math.max(metrics.minX, Math.min(metrics.maxX, nextDraft.offsetX)),
      offsetY: Math.max(metrics.minY, Math.min(metrics.maxY, nextDraft.offsetY)),
    };
  }

  async function confirmCropAvatar() {
    const visibleCrop = getVisibleCrop();

    if (!cropDraft || !cropImageRef.current || !visibleCrop) {
      return;
    }

    try {
      const blob = await compressImageToAvatarBlob(cropImageRef.current, {
        ...cropDraft,
        ...visibleCrop,
      });
      const previewUrl = URL.createObjectURL(blob);

      clearPendingAvatar();
      setPendingAvatar({ blob, name: cropDraft.fileName, previewUrl });
      setFormData((current) => ({ ...current, avatarAssetId: "" }));
      closeCropDialog();
      showToast("头像已裁剪，保存角色后会写入本地素材库");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "头像保存失败");
    }
  }

  function clearPendingAvatar() {
    setPendingAvatar((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }

  function closeCropDialog() {
    if (cropDraft?.imageUrl) {
      URL.revokeObjectURL(cropDraft.imageUrl);
    }
    setCropDraft(null);
    setCropDrag(null);
  }

  async function openAssetLibrary() {
    try {
      closeAvatarOverlays();
      setHelperSuggestion(null);
      setPendingClear(null);
      setAvatarAssets(await listAvatarAssets());
      setIsAssetLibraryOpen(true);
    } catch {
      showToast("本地素材库读取失败");
    }
  }

  function selectAvatarAsset(assetId: string) {
    clearPendingAvatar();
    setFormData((current) => ({ ...current, avatarAssetId: assetId }));
    setIsAssetLibraryOpen(false);
    setIsAvatarImageMenuOpen(false);
    showToast("已应用本地素材头像");
  }

  function removeAvatarImage() {
    clearPendingAvatar();
    setFormData((current) => ({ ...current, avatarAssetId: "" }));
    setIsAvatarImageMenuOpen(false);
    showToast("已恢复 Emoji 头像");
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

  function getSectionShortTitle(sectionId: SectionId) {
    const shortTitles: Record<SectionId, string> = {
      basic: "基础",
      appearance: "外貌",
      personality: "性格",
      ability: "能力",
      backstory: "背景",
      prompt: "Prompt",
    };

    return shortTitles[sectionId];
  }

  function runEditorMoreAction(action: () => void) {
    setIsEditorMoreOpen(false);
    action();
  }

  function openEditorPreview() {
    setEditorMode("preview");
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
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

  function handleRandomCharacter() {
    setIsRandomizing(true);
    window.setTimeout(() => setIsRandomizing(false), 450);

    const worldview = pickRandom(worldviewOptions);
    const worldviewDetail = pickRandom(randomWorldviewDetails[worldview]);
    const personalityTags = pickRandomTags();
    const species = pickRandom(randomSpecies);
    const occupation = pickRandom(randomOccupations);
    const abilityDescription = randomFieldChance(0.82)
      ? buildRandomAbilityDescription()
      : pickRandom(randomAbilities);
    const gender = pickRandom(randomGenders);
    const randomCharacter: CharacterDraft = {
      name: pickRandom(randomNames),
      avatarEmoji: DEFAULT_AVATAR_EMOJI,
      gender,
      age: pickRandom(randomAges),
      birthDate: "",
      birthYear: "",
      species,
      occupation,
      worldview,
      personalityTags,
      appearanceDescription: randomFieldChance(0.82)
        ? buildRandomAppearanceDescription(personalityTags, worldviewDetail)
        : `${pickRandom(randomAppearances)}整体气质偏${pickRandom(personalityTags)}，适合出现在${worldviewDetail}。`,
      abilityDescription,
      backstory: randomFieldChance(0.82)
        ? buildRandomBackstoryDescription(worldviewDetail)
        : `${pickRandom(randomBackstories)}主要活动地点与${worldviewDetail}有关。`,
      visualStyle: pickRandom(visualStyleOptions),
      characterKeywords: "",
      imagePrompt: "",
    };
    randomCharacter.avatarEmoji = chooseAvatarForCharacter(randomCharacter);

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
      | "imagePrompt"
      | "likes"
      | "dislikes"
      | "habits"
      | "importantItems"
      | "relationshipKeywords",
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

  function applyHelperSuggestion(mode: "replace" | "append") {
    if (!helperSuggestion) {
      return;
    }

    applyHelperValue(helperSuggestion.value, mode);
  }

  function applyHelperValue(value: string, mode: "replace" | "append") {
    if (!helperSuggestion) {
      return;
    }

    if (helperSuggestion.field === "personalityTags") {
      const nextTags = value
        .split(/[、，,\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);
      setFormData((current) => ({
        ...current,
        personalityTags:
          mode === "replace"
            ? nextTags
            : Array.from(new Set([...(current.personalityTags || []), ...nextTags])),
      }));
    } else if (mode === "replace") {
      updateField(helperSuggestion.field, value);
    } else {
      appendToField(helperSuggestion.field, value);
    }

    showToast(mode === "replace" ? "内容已应用" : "内容已追加");
    setHelperSuggestion(null);
  }

  function showHelperSuggestion(sectionId: HelperSectionId, field: HelperField) {
    closeAvatarOverlays();
    setIsAssetLibraryOpen(false);
    const nextSet = generateHelperSet(sectionId);
    setHelperSuggestion({
      sectionId,
      field,
      label: "随机灵感",
      value: nextSet.inspiration,
      ...nextSet,
    });
  }

  function refreshHelperItem(kind: HelperKind) {
    setHelperSuggestion((current) =>
      current
        ? {
            ...current,
            [kind]: generateHelperContent(current.sectionId, kind),
          }
        : current,
    );
  }

  function refreshAllHelperSuggestions() {
    setHelperSuggestion((current) =>
      current
        ? {
            ...current,
            ...generateHelperSet(current.sectionId),
          }
        : current,
    );
  }

  async function buildCharacter(isDraft: boolean) {
    if (!formData.name.trim()) {
      setFormError("请先填写角色名字");
      showToast("请先填写角色名字");
      return null;
    }

    let avatarAssetId = formData.avatarAssetId;

    if (pendingAvatar) {
      const asset = await saveAvatarBlob(pendingAvatar.blob, pendingAvatar.name);
      avatarAssetId = asset.id;
    }

    setFormError("");
    return {
      ...formData,
      avatarAssetId,
      id: character?.id || crypto.randomUUID(),
      createdAt: character?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      avatarEmoji: formData.avatarEmoji || DEFAULT_AVATAR_EMOJI,
      isDraft,
      name: formData.name.trim(),
    };
  }

  async function saveCurrentCharacter() {
    const nextCharacter = await buildCharacter(false);

    if (!nextCharacter) {
      return;
    }

    setSaveStatus("saving");
    onSave(nextCharacter);
    clearPendingAvatar();
    setFormData((current) => ({ ...current, avatarAssetId: nextCharacter.avatarAssetId || "" }));
    setSaveStatus("saved");
  }

  async function saveDraftCharacter() {
    const nextCharacter = await buildCharacter(true);

    if (!nextCharacter) {
      return;
    }

    setSaveStatus("saving");
    onDraftSave(nextCharacter);
    clearPendingAvatar();
    setFormData((current) => ({ ...current, avatarAssetId: nextCharacter.avatarAssetId || "" }));
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
      avatarAssetId: "",
    };

    setFormData(nextData);
    clearPendingAvatar();
    setCustomTag("");
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
    void saveCurrentCharacter();
  }

  function renderHelperButtons(
    sectionId: Exclude<SectionId, "basic" | "prompt">,
    field: "appearanceDescription" | "abilityDescription" | "backstory",
  ) {
    const labels = {
      appearanceDescription: "外貌描述",
      abilityDescription: "能力描述",
      backstory: "背景故事",
    };

    return (
      <div className="helper-row">
        <div className="helper-main-actions">
          <button
            className="ghost-button"
            onClick={() => showHelperSuggestion(sectionId, field)}
            type="button"
          >
            随机灵感
          </button>
          <button className="ghost-button" disabled type="button">
            AI 创作 🚧
          </button>
        </div>
        <button
          className="ghost-button helper-clear-button"
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
      {helperSuggestion && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setHelperSuggestion(null);
            }
          }}
          role="presentation"
        >
          <div className="confirm-dialog helper-dialog" role="dialog" aria-modal="true">
            <p className="eyebrow">{helperSuggestion.label}</p>
            <div className="helper-dialog-head">
              <h2>创作辅助</h2>
              <button className="ghost-button" onClick={refreshAllHelperSuggestions} type="button">
                全部换一组
              </button>
            </div>
            <div className="helper-suggestion-list">
              {[
                ["example", "示例", helperSuggestion.example],
                ["inspiration", "随机灵感", helperSuggestion.inspiration],
                ["tip", "写作提示", helperSuggestion.tip],
              ].map(([kind, title, value]) => (
                <article key={kind}>
                  <div className="helper-suggestion-title">
                    <h3>{title}</h3>
                  </div>
                  <p>{value}</p>
                  <div className="helper-suggestion-actions">
                    <div className="helper-action-main">
                      <button
                        className="ghost-button"
                        onClick={() => copyText(value, "辅助内容已复制")}
                        type="button"
                      >
                        复制
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => applyHelperValue(value, "append")}
                        type="button"
                      >
                        追加
                      </button>
                      <button
                        className="ghost-button"
                        onClick={() => {
                          setHelperSuggestion((current) =>
                            current ? { ...current, value } : current,
                          );
                          setIsHelperReplaceConfirmOpen(true);
                        }}
                        type="button"
                      >
                        替换
                      </button>
                    </div>
                    <button
                      className="ghost-button helper-refresh-button"
                      onClick={() => refreshHelperItem(kind as HelperKind)}
                      type="button"
                    >
                      <span aria-hidden="true">↻</span>
                      换一个
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <div className="form-actions">
              <button className="ghost-button" onClick={() => setHelperSuggestion(null)} type="button">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {isHelperReplaceConfirmOpen && helperSuggestion && (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true">
            <h2>替换当前字段</h2>
            <p>确定要用这条辅助内容替换当前字段吗？原内容会被覆盖。</p>
            <div className="form-actions">
              <button
                className="ghost-button"
                onClick={() => setIsHelperReplaceConfirmOpen(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  setIsHelperReplaceConfirmOpen(false);
                  applyHelperSuggestion("replace");
                }}
                type="button"
              >
                确认替换
              </button>
            </div>
          </div>
        </div>
      )}
      {cropDraft && (
        <div className="modal-backdrop" role="presentation">
          <div className="crop-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Avatar Crop</p>
                <h2>裁剪头像</h2>
              </div>
              <button className="ghost-button" onClick={closeCropDialog} type="button">
                取消
              </button>
            </div>
            <div
              className="crop-stage"
              ref={cropStageRef}
              onWheel={(event) => {
                event.preventDefault();
                adjustCropZoom(event.deltaY > 0 ? -0.08 : 0.08);
              }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setCropDrag({ x: event.clientX, y: event.clientY });
              }}
              onPointerMove={(event) => {
                if (!cropDrag) {
                  return;
                }
                const deltaX = event.clientX - cropDrag.x;
                const deltaY = event.clientY - cropDrag.y;
                setCropDraft((current) =>
                  clampCropDraft(
                    current
                      ? {
                          ...current,
                          offsetX: current.offsetX + deltaX,
                          offsetY: current.offsetY + deltaY,
                        }
                      : current,
                  ),
                );
                setCropDrag({ x: event.clientX, y: event.clientY });
              }}
              onPointerUp={() => setCropDrag(null)}
            >
              <img
                alt=""
                ref={cropImageRef}
                onLoad={() => setCropDraft((current) => clampCropDraft(current))}
                src={cropDraft.imageUrl}
                style={{
                  transform: `translate(calc(-50% + ${cropDraft.offsetX}px), calc(-50% + ${cropDraft.offsetY}px)) scale(${cropDraft.zoom})`,
                }}
              />
              <div className="crop-frame" ref={cropFrameRef} />
            </div>
            <label className="crop-slider">
              缩放
              <input
                max="8"
                min="0.25"
                onChange={(event) =>
                  setCropDraft((current) =>
                    clampCropDraft(
                      current ? { ...current, zoom: Number(event.target.value) } : current,
                    ),
                  )
                }
                step="0.05"
                type="range"
                value={cropDraft.zoom}
              />
            </label>
            <div className="crop-zoom-actions">
              <button className="ghost-button" onClick={() => adjustCropZoom(-0.15)} type="button">
                缩小
              </button>
              <button
                className="ghost-button"
                onClick={() =>
                  setCropDraft((current) =>
                    clampCropDraft(current ? { ...current, zoom: 0.25 } : current),
                  )
                }
                type="button"
              >
                最小
              </button>
              <span>{Math.round(cropDraft.zoom * 100)}%</span>
              <button
                className="ghost-button"
                onClick={() =>
                  setCropDraft((current) =>
                    clampCropDraft(current ? { ...current, zoom: 8 } : current),
                  )
                }
                type="button"
              >
                最大
              </button>
              <button className="ghost-button" onClick={() => adjustCropZoom(0.15)} type="button">
                放大
              </button>
            </div>
            <div className="form-actions">
              <button className="ghost-button" onClick={closeCropDialog} type="button">
                取消裁剪
              </button>
              <button className="primary-button" onClick={() => void confirmCropAvatar()} type="button">
                确认裁剪
              </button>
            </div>
          </div>
        </div>
      )}
      {isAssetLibraryOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsAssetLibraryOpen(false);
            }
          }}
          role="presentation"
        >
          <div className="asset-library-dialog" role="dialog" aria-modal="true">
            <div className="preview-card-title">
              <div>
                <p className="eyebrow">Local Assets</p>
                <h2>选择本地头像素材</h2>
              </div>
              <button className="ghost-button" onClick={() => setIsAssetLibraryOpen(false)} type="button">
                关闭
              </button>
            </div>
            {avatarAssets.length > 0 ? (
              <div className="asset-library-grid">
                {avatarAssets.map((asset) => (
                  <button
                    className={formData.avatarAssetId === asset.id ? "asset-item active" : "asset-item"}
                    key={asset.id}
                    onClick={() => selectAvatarAsset(asset.id)}
                    type="button"
                  >
                    <AvatarDisplay assetId={asset.id} className="asset-thumb" emoji="🙂" />
                    <span>{asset.name || "avatar"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">暂无本地头像素材。</p>
            )}
          </div>
        </div>
      )}
      <div className="panel workspace-hero">
        <div className="workspace-title-block">
          <AvatarDisplay
            assetId={formData.avatarAssetId}
            className="workspace-avatar"
            emoji={formData.avatarEmoji || DEFAULT_AVATAR_EMOJI}
            previewImageUrl={pendingAvatar?.previewUrl}
          />
          <div>
            <p className="eyebrow">{character ? "Character Workspace" : "New Character"}</p>
            <h1>{character ? "编辑角色工作台" : "新建角色工作台"}</h1>
            <p className="muted">分模块完善角色设定，系统会在编辑旧角色时自动保存。</p>
          </div>
        </div>
        <div className="workspace-toolbar">
          <button
            className="ghost-button desktop-editor-action"
            type="button"
            onClick={handleRandomCharacter}
            disabled={isRandomizing}
          >
            {isRandomizing ? "生成中..." : "随机生成角色"}
          </button>
          <button
            className="ghost-button helper-clear-button desktop-editor-action"
            type="button"
            onClick={() => setPendingFormAction("clear")}
          >
            清空
          </button>
          <button
            className="ghost-button helper-clear-button desktop-editor-action"
            type="button"
            onClick={() => setPendingFormAction("delete")}
          >
            删除
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
            className="ghost-button desktop-editor-action"
            onClick={openEditorPreview}
            type="button"
          >
            预览
          </button>
          <button className="ghost-button desktop-editor-action" onClick={onCancel} type="button">
            返回
          </button>
          <button
            className="primary-button mobile-editor-primary"
            onClick={() => void saveCurrentCharacter()}
            type="button"
          >
            保存角色
          </button>
          <div className="mobile-editor-more">
            <button
              className="ghost-button"
              onClick={() => setIsEditorMoreOpen((current) => !current)}
              type="button"
            >
              更多
            </button>
            {isEditorMoreOpen && (
              <div className="mobile-editor-more-menu">
                <button
                  type="button"
                  onClick={() => runEditorMoreAction(handleRandomCharacter)}
                  disabled={isRandomizing}
                >
                  {isRandomizing ? "生成中..." : "随机生成角色"}
                </button>
                <button type="button" onClick={() => runEditorMoreAction(() => void saveDraftCharacter())}>
                  临时保存
                </button>
                <button type="button" onClick={() => runEditorMoreAction(openEditorPreview)}>
                  预览
                </button>
                <button type="button" onClick={() => runEditorMoreAction(onCancel)}>
                  返回
                </button>
                <button
                  className="menu-danger"
                  type="button"
                  onClick={() => runEditorMoreAction(() => setPendingFormAction("clear"))}
                >
                  清空
                </button>
                <button
                  className="menu-danger"
                  type="button"
                  onClick={() => runEditorMoreAction(() => setPendingFormAction("delete"))}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <form className="workspace-layout" onSubmit={handleSubmit}>
        <aside className="workspace-nav" aria-label="模块导航">
          {visibleSectionMeta.map((section) => (
            <button
              className={activeSection === section.id ? "active" : ""}
              key={section.id}
              onClick={() => jumpToSection(section.id)}
              type="button"
            >
              <span>
                <span className="nav-full">{section.title}</span>
                <span className="nav-short">{getSectionShortTitle(section.id)}</span>
              </span>
              <small>
                <span className="nav-status-dot" aria-hidden="true" />
                {completionStatus(section.id, formData)}
              </small>
            </button>
          ))}
        </aside>

        <div className="workspace-main">
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
                      <AvatarDisplay
                        assetId={formData.avatarAssetId}
                        className="avatar-current"
                        emoji={formData.avatarEmoji || DEFAULT_AVATAR_EMOJI}
                        previewImageUrl={pendingAvatar?.previewUrl}
                        label="当前头像"
                      />
                      <div>
                        <strong>Avatar Picker</strong>
                        <p className="muted">选择 Emoji 或上传本地头像图片。图片仅保存在当前浏览器。</p>
                      </div>
                    </div>
                    <div className="avatar-actions">
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden-input"
                        onChange={(event) => void handleAvatarUpload(event.target.files?.[0])}
                        ref={avatarFileInputRef}
                        type="file"
                      />
                      <button
                        className="ghost-button"
                        onClick={() => setIsAvatarPickerOpen((current) => !current)}
                        type="button"
                      >
                        {isAvatarPickerOpen ? "收起 Emoji" : "选择 Emoji"}
                      </button>
                      <div className="avatar-image-menu-wrap" ref={avatarImageMenuRef}>
                        <button
                          className="ghost-button"
                          onClick={() => {
                            setIsAvatarImageMenuOpen((current) => !current);
                            setIsAvatarPickerOpen(false);
                            setHelperSuggestion(null);
                          }}
                          type="button"
                        >
                          更换头像
                        </button>
                        {isAvatarImageMenuOpen && (
                          <div
                            className="avatar-upload-panel"
                            onDragEnter={(event) => {
                              event.preventDefault();
                              setIsAvatarDragActive(true);
                            }}
                            onDragLeave={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                setIsAvatarDragActive(false);
                              }
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={(event) => void handleAvatarDrop(event)}
                          >
                            <div className={isAvatarDragActive ? "avatar-upload-drop active" : "avatar-upload-drop"}>
                              <strong>拖拽图片到此处</strong>
                              <span>支持 JPG / PNG / WEBP，也可以在面板打开时粘贴图片</span>
                            </div>
                            <button
                              className="ghost-button"
                              onClick={() => {
                                avatarFileInputRef.current?.click();
                              }}
                              type="button"
                            >
                              选择文件
                            </button>
                            <label className="avatar-url-inline">
                              输入图片 URL
                              <div>
                                <input
                                  onChange={(event) => setAvatarUrlValue(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      void handleAvatarUrlSubmit();
                                    }
                                  }}
                                  placeholder="https://example.com/avatar.webp"
                                  value={avatarUrlValue}
                                />
                                <button className="ghost-button" onClick={() => void handleAvatarUrlSubmit()} type="button">
                                  添加
                                </button>
                              </div>
                            </label>
                            <button className="ghost-button" onClick={() => void openAssetLibrary()} type="button">
                              从素材库选择
                            </button>
                            <button
                              className="ghost-button"
                              disabled={!formData.avatarAssetId && !pendingAvatar}
                              onClick={removeAvatarImage}
                              type="button"
                            >
                              移除头像图片
                            </button>
                          </div>
                        )}
                      </div>
                      {pendingAvatar && (
                        <span className="pending-avatar-note">待保存</span>
                      )}
                    </div>
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

                <div className="basic-info-grid">
                  <label className="field-cell">
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
                  {genderMode === "自定义" && (
                    <label className="field-cell">
                      自定义性别
                      <input
                        value={customGender}
                        onChange={(event) => handleCustomGenderChange(event.target.value)}
                        placeholder="输入自定义性别"
                      />
                    </label>
                  )}
                  <label className="field-cell field-cell-wide">
                    年龄 / 出生日期
                    <div className="age-combo">
                      <input
                        value={formData.age}
                        onChange={(event) => setManualAge(event.target.value)}
                        placeholder="年龄，例如：19"
                      />
                      <input
                        type="date"
                        value={formData.birthDate}
                        onChange={(event) => setBirthDate(event.target.value)}
                      />
                    </div>
                    <span className="field-hint">
                      {ageMode === "manual" ? "当前使用手动年龄" : "根据出生日期计算年龄"}
                    </span>
                  </label>
                  <label className="field-cell">
                    种族
                    <input
                      value={formData.species}
                      onChange={(event) => updateField("species", event.target.value)}
                      placeholder="例如：人类 / 精灵"
                    />
                  </label>
                  <label className="field-cell">
                    职业
                    <input
                      value={formData.occupation}
                      onChange={(event) => updateField("occupation", event.target.value)}
                      placeholder="例如：调查员 / 魔法师"
                    />
                  </label>
                  <label className="field-cell field-cell-wide">
                    世界观
                    <div className="combo-field">
                      <input
                        value={formData.worldview}
                        onChange={(event) => updateField("worldview", event.target.value)}
                        placeholder="选择或输入世界观"
                      />
                      <select
                        aria-label="选择预设世界观"
                        value={worldviewOptions.includes(formData.worldview || "") ? "" : "__custom"}
                        onChange={(event) => {
                          if (event.target.value !== "__custom") {
                            updateField("worldview", event.target.value);
                          }
                        }}
                      >
                        <option value="">预设</option>
                        {worldviewOptions.map((worldview) => (
                          <option key={worldview} value={worldview}>
                            {worldview}
                          </option>
                        ))}
                        <option value="__custom">自定义</option>
                      </select>
                    </div>
                  </label>
                  <label className="field-cell field-cell-wide">
                    视觉风格
                    <div className="combo-field">
                      <input
                        value={formData.visualStyle}
                        onChange={(event) => updateField("visualStyle", event.target.value)}
                        placeholder="选择或输入视觉风格"
                      />
                      <select
                        aria-label="选择预设视觉风格"
                        value={visualStyleOptions.includes(formData.visualStyle || "") ? "" : "__custom"}
                        onChange={(event) => {
                          if (event.target.value !== "__custom") {
                            updateField("visualStyle", event.target.value);
                          }
                        }}
                      >
                        <option value="">预设</option>
                        {visualStyleOptions.map((style) => (
                          <option key={style} value={style}>
                            {style}
                          </option>
                        ))}
                        <option value="__custom">自定义</option>
                      </select>
                    </div>
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
                  <div className="helper-main-actions">
                    <button
                      className="ghost-button"
                      onClick={() => showHelperSuggestion("personality", "personalityTags")}
                      type="button"
                    >
                      随机灵感
                    </button>
                    <button className="ghost-button" disabled type="button">
                      AI 创作 🚧
                    </button>
                  </div>
                  <button
                    className="ghost-button helper-clear-button"
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

          {showPersonalPreferences && (
          <section className="workspace-card" id="workspace-preferences">
            <div className="workspace-card-head static-head">
              <span>
                <strong>个人偏好</strong>
                <small>补充角色的日常倾向、物品与关系线索。</small>
              </span>
              <em>
                {[formData.likes, formData.dislikes, formData.habits, formData.importantItems, formData.relationshipKeywords].filter(Boolean).length
                  ? "部分完成"
                  : "未完成"}
              </em>
            </div>
            <div className="workspace-card-body">
              <div className="preference-grid">
                <label>
                  喜好
                  <textarea
                    value={formData.likes}
                    onChange={(event) => {
                      updateField("likes", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="角色喜欢的人、事物、环境、食物或仪式感。"
                  />
                </label>
                <label>
                  厌恶
                  <textarea
                    value={formData.dislikes}
                    onChange={(event) => {
                      updateField("dislikes", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="角色排斥、害怕或不愿面对的事物。"
                  />
                </label>
                <label>
                  习惯
                  <textarea
                    value={formData.habits}
                    onChange={(event) => {
                      updateField("habits", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="口头禅、小动作、作息、收纳方式或社交习惯。"
                  />
                </label>
                <label>
                  重要物品
                  <textarea
                    value={formData.importantItems}
                    onChange={(event) => {
                      updateField("importantItems", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="随身物、纪念品、武器、信物或不能丢失的东西。"
                  />
                </label>
                <label className="preference-wide">
                  人际关系关键词
                  <textarea
                    value={formData.relationshipKeywords}
                    onChange={(event) => {
                      updateField("relationshipKeywords", event.target.value);
                      autoGrowTextArea(event);
                    }}
                    placeholder="亲友、敌人、阵营、契约、亏欠、羁绊或关系关键词。"
                  />
                </label>
              </div>
            </div>
          </section>
          )}

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

          {showPromptSection && (
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
          )}

          </div>

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
              <button className="ghost-button" type="button" onClick={() => void saveDraftCharacter()}>
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
