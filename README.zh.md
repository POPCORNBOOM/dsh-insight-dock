# dsh-insight-dock

[English](README.md) | 中文

DSH Web GUI 的见解坞。

agent 在专注做一件事的时候，可以把一个简短、边界严格的侧面发现先寄存在这里——「欸，另外那件事其实可以…」——而不打断手上的活。见解会出现在输入框上方，你之后再决定要不要听它讲。

关键在于**上下文锚点**。每条见解都记住自己被创建时所在的会话序号，所以 `insight_load` 能从那一刻把真实的对话日志读回来。那次回读走的是持久化的会话日志，**因此哪怕 agent 自己的上下文已经被压缩掉，见解依然有效**。

## 安装

```
dsh plugin --profile <profile名> add dsh-insight-dock
```

`dsh plugin` 是 pnpm 的薄封装，在 profile 目录里执行。它会把 `dsh.profile.bundles` 与已安装的包对账，看到本包 `package.json` 里的 `dsh.bundle.patch` 声明，就把它追加进 bundle 栈；profile 启动时再合并 `cordis.patch.yml`——一条 `insert`，把插件行挂进去。**不需要手动改任何 profile 文件。**

bundle 栈只在启动时读一次，所以**要重启 `dsh`** 插件才会出现。

<details>
<summary>改用本地 checkout 安装</summary>

```
dsh plugin --profile <profile名> add link:/绝对路径/dsh-insight
```

注意 `realpath` 陷阱：Node 在解析 import 之前会把符号链接换成真实位置，所以被链接的 checkout 只有在自己有 `node_modules` 时才能找到 `@deepseek-ai/*`（否则报 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-tools'`）。从 registry 安装会把包实体化进 profile 内部，没有这个问题。

</details>

## 你会看到什么

**输入框上方**是一行坞——`💡 3 条见解`——展开就是当前这条见解，箭头用来翻其余几条。

| 动作 | 效果 |
| --- | --- |
| 说来听听 | 让 agent 顺着它锚定的那段日志，讲讲自己当时的想法。 |
| 关闭 | 移除这条见解。 |
| 关闭并告诉 agent 为什么 | 移除见解，**并且**把你的原因作为一行 notice 注入给 agent。 |

**设置里**有一个「见解」分区：启用开关、提示强度（见下）、同时保留的上限（1–50）、存活时间（分钟，1–1440，默认 **5**）。

## 提示强度

这个坞只有在 agent 想得起用它时才有用，而那几乎完全取决于它上下文里的**一行环境提示**。「提示强度」决定注入哪一行、以及什么时候注入：

| 等级 | 注入时机 | 内容 |
| --- | --- | --- |
| 关闭 | 从不——但你「关闭并说明原因」的通知仍会送达 | — |
| 弱 | 只在已经有见解时 | 那条已有见解的提醒 |
| 中 | 一直 | 正向判据：*真实、现在做不了、不记就永远丢掉* |
| 强 | 一直 | 上述判据，外加一句「每次开工前先扫一眼」 |

四级是**同一根轴上的序数**；表格后两列说明这根轴上每个点实际做了什么。

默认是「弱」，即保持原行为——而它**在结构上不可能产生第一条见解**：它据以注入的那条提醒，前提是已经有一条被记下来了。中与强在零见解时也注入，那是第一条能出现的唯一途径。

这个文本的每一个早期版本都是一串禁令——*不是待办*、*不是暂缓工作的出口*、*现在能做就现在做*。实测结果就是弃权：**94 个会话、625 轮里，被记录过的见解全部是开发这个插件时造出来的**——17 次调用，每一次都是测试夹具，其余 93 个会话是 **0**。一份完全由「不要」构成的说明，产出的正是这个。所以中与强改成陈述正向判据。

## 两个半身

**Host** —— `exports "."` → `lib/index.js`：

| 表面 | 作用 |
| --- | --- |
| `insight_add` | 记录一条见解。标题 ≤ 60、理由 ≤ 200、必填的 `why_not_now` ≤ 120、一轮最多一条、同时最多 5 条。 |
| `insight_list` | 列出当前会话的见解。 |
| `insight_load` | 读回见解锚点附近的那段日志——**并消费掉这条见解**。 |
| `insight_withdraw` | 让 agent 撤回自己留下的见解。 |
| prompt context | 有见解时注入一行环境提示：这些不是待办；如果其中某条其实属于当前任务，就必须去**做掉**，而不是归档。 |
| `/insight/api/<op>` | 浏览器半身的通道。 |

**Client** —— `exports "./client"` → `lib/client.js`，由 `/plugins/dsh-insight-dock/client.js` 提供：坞注册在 `conversation.input.dock`（order 30），设置页注册在 `settings.section`。

## 生命周期

**每一种结束都会删除记录。没有归档。**

| 转移 | 触发 | 结果 |
| --- | --- | --- |
| `active` → 消失 | 存活时间到了，没人要听 | 删除 |
| `active` → `heard` | 你点了「说来听听」 | host 向 agent 注入一条消息 |
| `heard` → 消失 | agent 用 `insight_load` 读走它 | 上下文已经交付，见解随之移除 |
| `heard` → 消失 | agent 始终没读到（回合被放弃或失败） | 存活时间**从被听到的那一刻**起算，到点删除 |
| `active` / `heard` → 消失 | agent 自己撤回 | 删除 |
| `active` / `heard` → 消失 | 你关掉它 | 删除——*附带原因*的关闭仍会先注入那行 notice |

所以一张被听过的见解通常只活**几秒**而不是几分钟：`insight_load` 在把内容交出去的那一瞬间就删掉它。`heardAt` 那条存活时间只是兜底，防止没人应答的见解永远赖在坞里。

**见解只存在内存里。** 关于见解的任何东西都不会写到磁盘。在"存活时间以分钟计"的前提下这几乎没有代价——重启本来就比任何见解活得久，持久化只可能保住一个空集合——而且它消掉了一整类失效：静默失败的写入、`serial` 记账，以及 side-car 会带来的 fork / workspace / 存储层那一串坑。

## 已知限制

都是实测出来的，不是猜的。

1. **界面文案目前只有中文。** 每个面向用户的字符串（`说来听听`、`关闭并告诉 agent 为什么`、设置项标签）以及每条工具描述都是中文字面量。没有接 locale 绑定，所以英文 locale 的会话看到的也全是中文。

2. **每一种结束都删除，没有归档。** 不存在「已归档」那一行，也没有它背后的记录。过期尤其不可逆：调短存活时间会直接销毁见解，**再调长也救不回来**。

3. **重启会清空这个坞。** 见解存在内存里，所以活不过 `dsh` 重启，fork 出来的会话也不继承。默认 5 分钟存活时间下这一点看不见；只有当你把存活时间调得很长、**并且**在见解还开着的时候重启，才会撞上。

   把见解改成日志驻留——用 `session.append` 写一个只进日志、不面向界面的状态事件，再 `sessionProjections.register`——就能做到 fork 继承与 checkpoint。但那需要用 TypeScript 模块增强去注册事件类型，这是手写 `lib/*.js` 的包做不到的。**这是刻意不付的债**：存活时间以时间为基础时，持久化买不到多少东西。

4. **设置是持久化的**（`~/.dsh/insight-settings.json`），**这是有意的**——存活时间和上限如果每次重启都重置，那这个功能就没法用。它是 side-car，而不是注册进 `ctx.settings` 的命名空间。

5. **设置导航里的图标是 shell 的兜底齿轮。** `settings.section` 的注册只投影 `id`、`order`、`label` 三个字段；图标来自一张内置 id 的封闭表（`models` / `agent-presets` / `plugins`，其余一律齿轮），插件无法提供。

6. **图标会降级。** 坞向 `@deepseek-ai/dsh-client-ui-primitives` 要 `IconLightOutline16`、`IconChevronLeftOutline14`、`IconChevronRightOutline14`，如果这个 require 失败就退回手绘的 16px 内联 SVG。所以缺少 baseline 条目只是外观损失，不会让面板挂掉。

## 通知行为

当你**附带原因**关闭一条见解时，host 会向 agent 注入一条单行 `notice`——**刻意不唤醒 driver**，所以 agent 无法回复它。不带原因关闭则谁也不通知。

## 开发

`lib/index.js` 与 `lib/client.js` 就是发布的产物，而且是手写的；没有构建步骤。`lib/client.js` 是客户端模块加载器期望的那个形状的 lazy-CJS bundle：

```js
window.__ModuleLoader__.load({
  id: "dsh-insight-dock",        // 必须等于 package.json 的 name
  factory: (require) => { /* … */ return module.exports },
})
```

`node --check` 只能证明语法。开发过程中发现的**每一个**真 bug——`join()` 的分隔符被当成正文输出、`heard` 状态逃出了存活时间、以及**把一个持有 state 的组件当普通函数调用**（它的 `useState` 因此记到了调用方头上，使两次渲染的 hook 数不同，React 直接把整个设置分区丢弃）——都**语法检查全绿**，前两个连打桩冒烟测试也是绿的。它们只有真正跑起来才现形。

针对语法检查看不见的那一类，仓库里有一个回归测试：

```
node test/hook-order.mjs lib/client.js
```

它把设置分区**渲染两次**——一次在配置尚未加载时，一次在加载完成后——断言根组件两次消耗的 hook 数相同。它确实会在这个形状上失败，所以是测试而不是摆设：把修复退回成普通函数调用，它就以非零码退出。

## License

MIT
