import type { InspirationCategory, InspirationEntry } from "../inspiration/types";

/**
 * The local inspiration library. Every entry is written to stand on its own as a
 * usable sentence or tag, and carries `keywords` that connect it to what the editor
 * already knows about the character. Nothing here talks to a network or a model:
 * generation is selection and combination over these strings.
 *
 * Entries are deliberately concrete. "沉默寡言" is a mood; "只在必须开口时才说话，
 * 但一旦开口会先问对方一个问题" is something a writer can use.
 */
export const INSPIRATION_LIBRARY: Record<InspirationCategory, InspirationEntry[]> = {
  appearance: [
    {
      id: "ap-01",
      text: "左眉骨有一道旧疤，平时被刘海遮住，低头时会露出来。",
      keywords: ["档案", "研究", "学者", "军人", "佣兵", "边境", "旧城"],
      tone: "dark",
    },
    {
      id: "ap-02",
      text: "常年穿同一件深色外套，袖口磨得发亮，口袋里总塞着写满字的纸片。",
      keywords: ["档案", "抄写", "学者", "记者", "商人", "研究员"],
      tone: "neutral",
    },
    {
      id: "ap-03",
      text: "手指关节比同龄人粗大，指甲边缘有洗不掉的墨迹或油污。",
      keywords: ["工匠", "机修", "印刷", "抄写", "船工", "工人"],
      tone: "neutral",
    },
    {
      id: "ap-04",
      text: "站姿很直，像随时准备被点名；坐下时却总选背靠墙的位置。",
      keywords: ["军人", "守卫", "警", "逃亡", "追捕", "边境"],
      tone: "dark",
    },
    {
      id: "ap-05",
      text: "耳后别着一支笔，头发用一根旧绳随手束起，几缕总也压不住。",
      keywords: ["档案", "抄写", "学生", "记者", "研究员", "书"],
      tone: "light",
    },
    {
      id: "ap-06",
      text: "身上有淡淡的药味或香料味，靠近时才闻得到。",
      keywords: ["医", "药", "厨房", "祭司", "香", "照护"],
      tone: "neutral",
    },
    {
      id: "ap-07",
      text: "笑起来会先眯眼，像是先确认对方值不值得笑。",
      keywords: ["商人", "骗子", "情报", "赌", "交际"],
      tone: "neutral",
    },
    {
      id: "ap-08",
      text: "随身带着一枚磨旧的徽章或纽扣，从不解释它的来历。",
      keywords: ["旧城", "军队", "家族", "遗失", "纪念", "档案"],
      tone: "dark",
    },
  ],

  personality: [
    {
      id: "pe-01",
      text: "先记录，再判断",
      keywords: ["档案", "研究", "学者", "抄写", "冷静", "谨慎"],
      tone: "neutral",
    },
    {
      id: "pe-02",
      text: "礼貌而疏远",
      keywords: ["交际", "商人", "医", "家人", "旧识"],
      tone: "light",
    },
    {
      id: "pe-03",
      text: "只承诺做得到的事",
      keywords: ["守卫", "军人", "工匠", "责任", "边境"],
      tone: "neutral",
    },
    {
      id: "pe-04",
      text: "安全处警觉，危险处平静",
      keywords: ["逃亡", "追捕", "边境", "战争", "旧城"],
      tone: "dark",
    },
    {
      id: "pe-05",
      text: "用问题回答问题",
      keywords: ["情报", "商人", "骗子", "学者", "审讯"],
      tone: "neutral",
    },
    {
      id: "pe-06",
      text: "记很久，也放得下",
      keywords: ["家人", "旧识", "学徒", "照护"],
      tone: "light",
    },
    {
      id: "pe-07",
      text: "不愿欠人情",
      keywords: ["工匠", "独立", "逃亡", "边境", "旧城"],
      tone: "neutral",
    },
    {
      id: "pe-08",
      text: "人前寡言，独处健谈",
      keywords: ["抄写", "研究", "学生", "内向", "档案"],
      tone: "light",
    },
  ],

  occupation: [
    {
      id: "oc-01",
      text: "档案整理员",
      keywords: ["档案", "研究", "抄写", "旧城", "记录"],
      tone: "neutral",
    },
    {
      id: "oc-02",
      text: "夜班守灯人",
      keywords: ["港口", "灯塔", "守夜", "海", "雾"],
      tone: "dark",
    },
    {
      id: "oc-03",
      text: "旧物修复师",
      keywords: ["工匠", "旧物", "机修", "手艺", "收藏"],
      tone: "light",
    },
    {
      id: "oc-04",
      text: "城际信使",
      keywords: ["信使", "情报", "旧城", "边境", "商人"],
      tone: "neutral",
    },
    {
      id: "oc-05",
      text: "集市药师",
      keywords: ["医", "药", "集市", "照护", "商人"],
      tone: "light",
    },
    {
      id: "oc-06",
      text: "潮汐观测员",
      keywords: ["潮汐", "海", "观测", "档案", "研究"],
      tone: "neutral",
    },
  ],

  background: [
    {
      id: "bg-01",
      text: "曾在一次事故中负责记录伤亡名单，后来发现名单上少了一个本应存在的人。",
      keywords: ["档案", "事故", "记录", "失踪", "责任"],
      tone: "dark",
    },
    {
      id: "bg-02",
      text: "少年时被一位不肯留名的老师带离家乡，学艺多年后才被告知真实原因。",
      keywords: ["学徒", "师承", "家乡", "离开", "旧识"],
      tone: "neutral",
    },
    {
      id: "bg-03",
      text: "为了替家人还债，签过一份自己没读完的契约，如今仍在履行其中一条。",
      keywords: ["债务", "家人", "契约", "商人", "旧城"],
      tone: "dark",
    },
    {
      id: "bg-04",
      text: "在一场几乎无人幸存的灾害里活了下来，因此对被救这件事始终心存戒备。",
      keywords: ["灾害", "幸存", "潮汐", "战争", "边境"],
      tone: "dark",
    },
    {
      id: "bg-05",
      text: "曾经替一个后来失踪的人保管过一只箱子，至今没有打开。",
      keywords: ["失踪", "保管", "箱子", "旧物", "秘密"],
      tone: "dark",
    },
    {
      id: "bg-06",
      text: "因为一次公开的失误被调离原职，来到现在的城市，靠新身份重新开始。",
      keywords: ["调职", "失误", "旧城", "新身份", "迁徙"],
      tone: "neutral",
    },
    {
      id: "bg-07",
      text: "在一个只存在了三年的读书会里认识了几位朋友，后来读书会突然解散。",
      keywords: ["读书", "朋友", "解散", "学生", "档案"],
      tone: "light",
    },
    {
      id: "bg-08",
      text: "自幼在港口长大，能凭气味分辨潮水方向，却说不清自己真正的出生地。",
      keywords: ["港口", "海", "潮汐", "出生", "雾"],
      tone: "neutral",
    },
  ],

  motivation: [
    {
      id: "mo-01",
      text: "想找到名单上被抹去的那个人，但不确定找到后是否应该公开。",
      keywords: ["档案", "失踪", "名单", "记录", "责任"],
      tone: "dark",
    },
    {
      id: "mo-02",
      text: "想证明一次旧事故并非意外，代价是会牵出自己当年的失职。",
      keywords: ["事故", "责任", "旧城", "调查", "真相"],
      tone: "dark",
    },
    {
      id: "mo-03",
      text: "希望攒够钱赎回一件被抵押的旧物，那件东西对别人来说并不值钱。",
      keywords: ["旧物", "债务", "家人", "纪念", "集市"],
      tone: "neutral",
    },
    {
      id: "mo-04",
      text: "想离开现在的城市，却每次都在出发前找到留下的理由。",
      keywords: ["离开", "迁徙", "港口", "旧城", "家人"],
      tone: "neutral",
    },
    {
      id: "mo-05",
      text: "想让一个已经不再联系的人看到自己过得很好，即使对方永远不会知道。",
      keywords: ["旧识", "家人", "师承", "离别", "自尊"],
      tone: "light",
    },
    {
      id: "mo-06",
      text: "想守住一份承诺，但承诺的内容与现在的处境越来越冲突。",
      keywords: ["承诺", "责任", "契约", "守卫", "边境"],
      tone: "dark",
    },
  ],

  interests: [
    {
      id: "in-01",
      text: "收集旧车票和船票，按年份夹在一本不给人看的册子里。",
      keywords: ["旧物", "港口", "旅行", "档案", "收藏"],
      tone: "light",
    },
    {
      id: "in-02",
      text: "习惯在深夜核对白天的记录，把疑点写在页边，第二天再决定要不要追。",
      keywords: ["档案", "记录", "研究", "夜", "谨慎"],
      tone: "neutral",
    },
    {
      id: "in-03",
      text: "喜欢听陌生人讲他们自己的事，但很少主动讲自己的。",
      keywords: ["交际", "情报", "集市", "倾听", "商人"],
      tone: "light",
    },
    {
      id: "in-04",
      text: "每天固定走同一条路回家，只有心情极差时才换一条。",
      keywords: ["旧城", "习惯", "守夜", "规律", "警戒"],
      tone: "neutral",
    },
    {
      id: "in-05",
      text: "会用废纸折小东西，谈事情时手里总要有点什么可折。",
      keywords: ["抄写", "工匠", "手巧", "纸", "紧张"],
      tone: "light",
    },
    {
      id: "in-06",
      text: "喜欢在雨里待一会儿，理由永远是「刚好顺路」。",
      keywords: ["海", "雾", "港口", "孤独", "习惯"],
      tone: "light",
    },
    {
      id: "in-07",
      text: "对食物很挑剔，却愿意为一家不起眼的小店绕远路。",
      keywords: ["集市", "厨房", "生活", "挑剔", "旧城"],
      tone: "light",
    },
  ],

  items: [
    {
      id: "it-01",
      text: "一本缺页的旧册子，缺的那几页边缘还留着撕扯的毛口。",
      keywords: ["档案", "记录", "失踪", "旧物", "秘密"],
      tone: "dark",
    },
    {
      id: "it-02",
      text: "一枚刻着陌生名字的铜钥匙，试过很多锁都打不开。",
      keywords: ["钥匙", "失踪", "秘密", "旧物", "家族"],
      tone: "dark",
    },
    {
      id: "it-03",
      text: "一只补过三次的旧怀表，走时不准，但从没被送去修。",
      keywords: ["时间", "纪念", "旧物", "工匠", "家人"],
      tone: "neutral",
    },
    {
      id: "it-04",
      text: "一小瓶用剩的药粉，标签上的字迹已经模糊，只认得一个「慎」字。",
      keywords: ["药", "医", "事故", "谨慎", "旧物"],
      tone: "dark",
    },
    {
      id: "it-05",
      text: "一张折了很多次的港口地图，某片水域被反复描黑。",
      keywords: ["港口", "海", "潮汐", "地图", "调查"],
      tone: "neutral",
    },
    {
      id: "it-06",
      text: "一段总也舍不得扔的旧绳，据说曾用来系过一件很重要的东西。",
      keywords: ["旧物", "纪念", "港口", "船", "承诺"],
      tone: "light",
    },
  ],
};

export const INSPIRATION_CATEGORY_LABELS: Record<InspirationCategory, string> = {
  appearance: "外貌",
  personality: "性格",
  occupation: "职业身份",
  background: "背景",
  motivation: "动机与冲突",
  interests: "兴趣与习惯",
  items: "重要物品",
};
