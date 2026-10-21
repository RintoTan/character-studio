import GuideBlock, { type GuideTip } from "./GuideBlock";

/**
 * Four things the timeline does that are not obvious from the list alone.
 *
 * Every sentence here describes a control that exists on the page: 新建事件, the date
 * field that decides both order and the year grouping, the 年份导航 row, the character
 * picker inside the event dialog, and the search plus three filters above the list.
 */
const TIPS: GuideTip[] = [
  {
    icon: "plus",
    title: "创建一个故事事件",
    body: "点右上角「新建事件」，填标题与日期即可保存；日期决定排序，也决定它落在哪个年份分组。",
    hint: "纪年显示是可选的展示文本，留空时按日期显示；它与日期互不换算。",
  },
  {
    icon: "clock",
    title: "按日期排序，按年份分组",
    body: "事件始终按日期排序，同一年的事件归在同一组下，组标题就是年份。",
    hint: "列表上方有年份导航，点一个年份直接跳到那一组；它不是筛选，列表内容不变。",
  },
  {
    icon: "link",
    title: "关联角色与地点",
    body: "事件可以关联多个角色，也能写地点。关联只记录谁参与了这件事，不会改动角色资料。",
    hint: "卡片上默认显示描述摘要，点「展开完整描述」读全文，再点一次收起。",
  },
  {
    icon: "search",
    title: "搜索、筛选与阅读",
    body: "顶部搜索覆盖标题、描述、地点与角色名；筛选可以按年份、类型与角色收窄列表。",
    hint: "筛选只改变看到的范围，不修改任何事件；清空搜索或筛选即恢复全部。",
  },
];

export default function TimelineGuide() {
  return <GuideBlock id="timeline-guide" tips={TIPS} />;
}
