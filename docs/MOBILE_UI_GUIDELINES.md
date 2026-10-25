# Character Studio — Mobile UI Guidelines

> **状态（2026-10-25，v2.60.0 候选）**：本文是**设计目标**，不是现状描述。
> 已达成：底部抽屉切换工作区、搜索折叠/展开、44px 触控目标、`scrollWidth === clientWidth`。
> **未达成**：§8 的「画布进入首屏、搜索只占一行」在 320–430px 下实际是 3 行工具栏，375px 首卡 `y=464`。
> 这项差距登记为待决策契约（见 `docs/KNOWN_ISSUES.md` 与 `docs/FEATURES.md`），不在 v2.60.0 内改布局。

Applies to the four workspaces: 角色创作工作台, 角色关系网, 世界观管理, 世界观时间线.
Desktop and phone share business logic and the same design language; they do not have to
share an information architecture.

## 1. Spacing scale

`4 / 8 / 12 / 16 / 24`. The page gutter is `--page-inset-compact` (16px) below 720px.
Cards are separated by `--section-gap` (20px); inside a card, 12–16px between a toolbar
and the list it filters (`--toolbar-gap`).

## 2. Page frame

- Top: app bar (`workspace-switch` + display menu), then **one** bordered Hero card.
- Then **one** workspace card. The page itself is never a card.
- Bottom: nothing fixed except the canvas dock (graph only) and sheets.
- Horizontal overflow must be 0; an inner horizontally-scrollable strip (category chips,
  grouped cards) is allowed and keeps its own scroll.

## 3. Hero vs workspace on a phone

| | Hero | Workspace |
| --- | --- | --- |
| Contains | eyebrow, title, one-line stats, **one** primary task | view switch, search, filters, list/content, secondary actions |
| Examples | 新建角色 / 新建关系 / 新建条目 / 新建事件 | 全部·收藏·草稿, 图谱·管理, 搜索, 筛选, 导出 |
| Never | two same-weight buttons, canvas tools, view switches | a second copy of the title |

Navigation back to the dashboard is a light text link (`← Dashboard`, 40px tall) at the
top of the workspace, not a ghost button competing with the primary task.

## 4. Search

One component, `src/components/WorkspaceSearch.tsx`, used by all four pages.

- Collapsed: icon + 搜索, compact (34px desktop / 44px phone).
- Open: field in place, auto-focused; 收起 returns focus to the trigger.
- Escape closes the field only (`stopPropagation`), never the surrounding panel.
- Collapsing keeps the query; a chip names it and clears it in one tap.
- Clear (×) empties the query and keeps the field open.
- Filters are separate controls and stay visible while a search is active.

## 5. Touch targets

44×44 minimum for anything a thumb aims at: search trigger/field, filter toggle, row
actions, sheet buttons. The canvas dock keeps 36px controls — it is a dense tool strip and
its targets are separated by 8px gaps.

## 6. Sheets, menus, dock

- Lists of choices use `BottomSheet` (dvh-sized, scrolls inside, closes on scrim/Escape).
- Menus are never anchored to a control that a phone hides; commands that do not fit the
  dock move into a labelled 更多.
- `env(safe-area-inset-bottom)` pads sheets and the dock.
- A sheet's body scrolls independently; closing it returns to the same canvas state.

## 7. Typography

Body 14px, meta 12px, page title 22px on a phone. Layout problems are fixed with
rearrangement, not by shrinking type below these sizes.

## 8. Canvas (relationship graph)

Identity and stats in the Hero; view switch, search and scope note in the workspace; the
dock holds zoom/fit/select/pan/grid; tools never sit on top of nodes. The drawing enters
the first screenful (search is one 44px row, not a second toolbar block).

## 9. Verification

Each release checks: 320 / 375 / 430 widths, light and dark, search open/closed/active
chip, filter applied, sheet open/close, and a reduced visual viewport (soft-keyboard
proxy) with the field still visible. `scrollWidth === clientWidth` alone is not accepted
as evidence.
