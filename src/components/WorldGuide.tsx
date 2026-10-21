import GuideBlock, { type GuideTip } from "./GuideBlock";

/**
 * Four things the world manager does, written against the page as it exists:
 * 新建条目, the category row plus the optional 上级条目 that builds a tree, the
 * character picker on an entry, and the reading pane with search and three filters.
 */
const TIPS: GuideTip[] = [
  {
    icon: "plus",
    title: "创建设定条目",
    body: "点「新建条目」，选择分类并填写名称与简介即可。地点、势力、种族、物品与概念都在同一处建立。",
    hint: "名称必填，简介与详情都可以留空；保存后随时可以在右侧详情里继续补。",
  },
  {
    icon: "layers",
    title: "分类与父子层级",
    body: "每个条目有一个分类；填写「上级条目」后，它会挂在那条设定下面，形成层级。",
    hint: "删除上级条目时，下级不会被删掉，而是变成顶层条目。",
  },
  {
    icon: "link",
    title: "关联角色",
    body: "条目可以关联多个角色，比如地点关联住在这里的人。关联只用于阅读与检索，不写回角色资料。",
    hint: "列表里的「N 位角色」就是这条设定目前关联的人数。",
  },
  {
    icon: "search",
    title: "搜索、筛选与阅读",
    body: "顶部搜索覆盖名称、简介、详情、标签与关联角色名；筛选可按层级、分类和角色收窄。",
    hint: "选中条目后在右侧读详情，手机上详情与列表分屏切换；筛选不修改任何设定。",
  },
];

export default function WorldGuide() {
  return <GuideBlock id="world-guide" tips={TIPS} />;
}
