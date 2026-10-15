// The emoji an avatar can be, grouped the way the picker shows them.
//
// This used to live at module scope inside CharacterForm. The avatar hook needs
// the flat list (to seed and prune the recents) and the form needs the groups (to
// render the picker), so it sits here rather than forcing one of them to import
// from the other.

export type AvatarCategory = {
  id: string;
  label: string;
  emojis: string[];
};

export const avatarCategories: AvatarCategory[] = [
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

/** Every offered emoji, deduplicated, in picker order. */
export const avatarEmojiOptions = Array.from(
  new Set(avatarCategories.flatMap((category) => category.emojis)),
);

/** The emoji a character shows before the author picks one. */
export const DEFAULT_AVATAR_EMOJI = "🙂";
