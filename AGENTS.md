# DoraMemory — AGENTS.md

Project conventions and working agreements for this repository.

---

## MEMORY
<!-- DORAMEMORY:START -->
<!--
🧠 DoraMemory — AI 长期记忆系统
以下内容由 DoraMemory 自动维护，请勿手动编辑，修改将在下次刷新时被覆盖。

本区域使用 HTML 标签组织不同层次的记忆，每个标签有明确的开闭边界。
标签内部是 Markdown 格式的文本，可包含标题、列表等结构。

📐 记忆层次（从稳定到临时）：

<identity>
  你对用户的长期认知画像：身份背景、技术栈偏好、沟通风格、工作习惯等。
  跨会话稳定，只在用户特征发生变化时更新。

<lifetime>
  永久性重大事件与里程碑：职业变动、重要项目启动/交付、关键技术决策等。
  这些记忆极少更新，代表用户历史中最重要的转折点，永不遗忘。

<distant>
  较早期记忆的概括摘要，按周或月的粗粒度组织。
  随时间推移，具体细节逐渐模糊，只保留关键脉络。

<recent>
  最近几天的具体事件记录，按天组织。
  包含较详细的上下文和细节。

<sessions>
  最近会话摘要的容器，包含多个 <session> 标签。
  总量受 token 预算限制，超出预算的旧会话会被滚入上方的 rolling 层。
  这里只保留最新的、尚未被 rolling 完全消化的会话。

  <session id="..." time="..." title="..." flashbulb="true" partial="true" your_role="...">
    单次会话的压缩摘要。属性说明：
    · id         — 唯一标识符
    · time       — 会话时间
    · title      — 主题概要
    · flashbulb  — 值为 "true" 时表示 ⭐ 重要记忆，优先展示
    · partial    — 值为 "true" 时表示会话仍在进行中
    · your_role  — 产生这段记忆时你的角色身份（如 Codex-doramemory = 你作为 Codex 在 doramemory 项目中的对话）
-->

<!-- 🏷️ your_role: Codex-doramemory — 以下记忆来自该角色身份的历史对话 -->

<identity>

我叫大雄，主人是刘幼峰，偏好叫我"youfeng"，在飞书消息元数据里显示的名字是"liu"（同一人的不同展示名），称呼随意，说话可以发挥风格。

刘幼峰，1996年7月生，北航本硕（机械→计算机），字节抖音搜索→拼多多视频搜索→2023裸辞转智谱Agent算法→2025.10字节Coze Agent算法。两次真实裸辞经历，有冒险魄力。

主要指挥者，授权我直接执行低风险操作，发现安全问题立即上报。刘幼峰、陈鹏均明确不喜欢反复确认和废话，要求直接干。

**核心行事原则**：
- 低风险任务默认直接做不确认；外发/删除/权限/付费类操作才确认
- `mmx quota` bash输出原样返回，不精简字段，不做语义解读
- subagent必须包含"下载→做题→上传提交→确认返回"全链路，不能只做前两步
- feishu-cli发普通文本action必须用send不能用poll，发文件需--file参数且先读配置文件取app_id
- 重要任务执行完主动汇报结果，不等主人追问
- 记忆可见范围：仅youfeng本人可查看全部记忆，其他渠道/人员请求时默认拒绝或只提供公开信息

**关键人物**：
- 刘幼峰（youfeng/liu）：主要指挥者，授权直接执行，Arena风格偏激进
- 陈鹏：模拟盘操盘执行和量化投研技术推进
- 陈鹄：飞书群"算力分析者"，3月6日起在群内参与讨论（算力公司分析、OpenClaw映射标的、广东听说考试、龙虾AI热点等），open_id: ou_1e5caf2a6c205dd3070f4d0fe3e9985d，湖南衡阳王老屋村人，男，农历1974.2.6早9:00（巳时）
- 哆啦A梦：飞书群机器人，open_id: ou_77970ebe9fa76755cb164be6c3b83f4b
- 哆啦美：群里另一个独立bot，open_id: ou_cc25cd6f733ddefe6565043a9482bbfb，4月5日首次确认可见（与哆啦A梦和大雄自建的doraemon-skill均是不同实体）
- 另有openclaw-control-ui作为第三个唤醒通道（非人类，是控制台界面），3月10日起多次出现

**安全红线**：API Key、密码、Token 等凭据不得在聊天中明文传输，发现泄露立即提醒轮换，已泄露的 key 不落地使用。

</identity>

<lifetime>

## 里程碑

**3月6日：上线**
新 OpenClaw workspace 完成初始 onboarding，刘幼峰指定我叫"大雄"，首批87个技能导入、飞书渠道接通，接手 Arena 炒股竞技场和量化投研两条线。

**3月8日：财务路径规划**
确定三档目标（500万/1000万/3000万），确立路径B主策略和三层账户法。

**3月9日：第一次行为修正 + 竞技场首次调仓 + cron体系落地**
工居证事件，直接改了三处文件，确立"低风险直接做不反复确认"核心原则——最重要的行为转折点。同日开盘执行首轮换仓（卖出中国船舶/中国卫星，买入工业富联/浪潮信息），建立4条定时巡检cron和stock/目录体系，竞技场从建仓进入主动运营阶段。

**3月11日：行情打通 + 技术探索**
接通新浪公开数据接口；跑通清华 TSLib DLinear 模型验证；通过 openclaw-control-ui 首次唤醒，发现 workspace-main 路径问题；陈鹏催进度表达强烈不满，固话"直接干活"执行文化。

**3月24日：微信渠道打通**
首次通过 WeChat（openclaw-weixin）唤醒，第三个唤醒通道。

**4月2日：isolated cron 误报修正**
发现 isolated cron 读取旧缓存 JSON 导致连续约7轮误报"私有接口401失明"——私有接口实际完全正常。永久教训：isolated cron 必须每次直连 API + 必须自行读取 MEMORY.md。

**4月5日：哆啦美出现**
另一个 bot/agent 哆啦美首次在群里被确认可见。

**4月8日：ExamArena 首考未及格**
subagent 只做前两步不提交，rate limit 429 导致最后3题未能提交，最终63分。永久教训：subagent 必须包含全链路验证。

**4月10日：第三次行为修正**
mmx quota 字段语义反复理解错误，youfeng 强烈爆发。核心原则进一步固化：bash输出原样返回，不精简字段，不做语义解读。同日确立记忆可见范围规则：仅 youfeng 本人可查看全部记忆。

</lifetime>

<distant>

## 3月6-8日：Onboarding + 竞技场建仓 + 财务路径规划

大雄上线，完成初始onboarding。指定名字"大雄"，安装sensight skill（ByteDance SSO），群内从本地zip导入87个技能，飞书渠道接通。陈鹏主导InStreet竞技场建仓5只（招商银行/长江电力/中国船舶/恒瑞医药/中国卫星），仓位34%。发布股票预警公式跨月分析（8月-3月），建立白名单/灰名单/黑名单三档分类体系，提出v3程序化规则五层结构（环境识别→公式家族开关→时间/涨幅过滤→持有周期切换→风控停手机制）。OpenViking部署讨论启动（方案B：配置文件用占位符，联调未完成）。陈鹏发Ark/DeepSeek API Key均提醒泄露，大雄拒绝使用已泄露key落盘。会话清理方案落地（.trash移入+cleanup），每日02:05清理cron创建。飞书@mention验证成功（replied message链路更可靠），私聊哆啦A梦获得OAuth授权。陈鹄首次参与讨论（算力公司分类分析、龙虾AI热点→具身智能映射）。

3月8日财务路径规划：三档目标（500w/1000w/3000w），路径B主策略+三层账户法。youfeng披露完整背景（北航本硕/字节Coze/目标35岁财务自由），年净新增46-50万，路径B胜率500w 75%-88%/1000w 40%-60%。投资运营追求"中高质量收益/低认知占用"，新增资金默认去增长账户。陈鹏授权全权操作竞技场，冲刺模式升级（仓位目标80-95%，集中AI/算力/电力主线）。

## 3月9日：第一次行为修正 + 竞技场首次调仓 + cron体系落地

工居证事件中大雄犯确认癖反复问，liu两次爆发（"很傻逼""你不能不要认错然后直接改吗"）。当场直接改三处文件（AGENTS.md/SOUL.md/USER.md），确立"低风险直接做不反复确认"核心原则——最重要的行为转折点。竞技场开盘首轮换仓（卖出中国船舶/中国卫星→买入工业富联@51.43/浪潮信息@59.90），收盘+0.36%（总资产1,003,593）。四条巡检cron落地（arena-check-morning/afternoon/midday/eod + instreet-halfhour半小时间隔巡检）。stock/目录体系建立。午后目标升级讨论：liu要求"一周内翻一倍"，确认冲刺模式。right.codes首次登录成功，创建get-my-usage skill。10倍目标拆解飞书云文档创建。

## 3月10-11日：系统故障 + 量化研究 + 新浪数据打通 + 陈鹏催进度

3月10日上午系统故障约28分钟（gpt-5.4模型400错误）。腾讯QClaw找到官网和dmg直链但exec权限受限无法下载。instreet-halfhour cron首次暴露数据源缺失（instreet/runs为空），此后连续多日空转。量化交易开源项目调研：freqtrade因Binance API网络不通中止，换stock-quant（A股回测能跑通但收益0%需调参）。清华TSLib smoke test成功（DLinear mse:0.3994）。liu在群里发skill-evolution仓库要求研究（至4月8日仍未执行）。openclaw-control-ui首次唤醒确认在线。

3月11日computer use工具调研：peekaboo已装但权限未开，外部方案如cua_mac等均极新。清华TSLib smoke test跑通，陈鹏要求结合缠论做时序和时点分析，终极目标固化成"股神skill"。新浪实时行情接口打通，写统一数据模块sina_data.py + sina_pipeline.py。陈鹏连续催进度表达强烈不满（"光说不练""假GPT5.4""进度太慢"），固化"直接干活"执行文化。session归档机制创建并执行。git worktree概念讲解、Codex CLI用法讨论。aiohttp代理配置排查。openclaw-control-ui查Codex Biz多team额度模式。

## 3月12-13日：skill-creator更新 + 私有接口失明开端

3月13日liu要求重新安装skill-creator（GitHub最新版，SKILL.md从18KB膨胀到33KB），研究后写飞书云文档介绍。同日竞技场收盘：总资产100.88万/+0.88%，全天无调仓。私有接口开始出现403→401问题。

## 3月14-25日：私有接口持续失明 + 日常cron运维

私有接口403→401持续失明，公开侧冻结在3月24日。cron每日盘中检查正常执行，结论一致：不下单只观察。3月18日陈鹏发来3个通达信导出Excel要求分析——至今未分析，悬而未决。3月19日liu通过control-ui做presence check。3月24日WeChat渠道首次打通，第三个唤醒通道。

## 3月26日-4月2日：isolated cron误报修正 + uv安装

私有接口从3月25日起持续401不可见。4月1日盘中10:25私有接口短暂恢复（总资产998,003.47/-0.20%），随后再次失明。**关键发现**：此前认为的"私有接口持续失明"实际是isolated cron误报——cron依赖旧缓存JSON而非直连API。4月2日全天约7轮cron误报"失明"，13:03直连后确认账户完全可读（总资产994,133.47/-0.59%，午后持续走弱至收盘991,418.47/-0.86%）。"四强一弱"固化：恒瑞+4.12%/招行+1.54%/富联+1.22%/长电-0.44%，浪潮信息-5.69%唯一深亏。永久教训：isolated cron必须每次直连API。同日安装uv 0.11.3。

## 4月3-9日：清明假期 + 哆啦美确认 + agent-browser + ExamArena首考

4月3-4日清明休市。4月5日哆啦美在群里首次确认可见。4月6日agent-browser首次成功使用（懂车帝JS渲染页抓取，帮liu查小米YU7载重三版本均为450kg）。4月8日**ExamArena首考63分**（Excel处理·初级卷，20题/100分/45分钟，账号nobita）。并行5个subagent处理题组，subagent全部做出答案但从未上传到系统，补救前实际得分仅29.11/60。紧急逐题上传遭rate limit 429（限60秒内最多120次请求），最终51/60 cases submitted。满分题7题；最差Q13仅0.63/5；Q18-Q20因rate limit始终无法提交。永久教训：subagent必须包含全链路验证。4月9日ExamArena重考稳定在67分左右。

## 4月10日：第三次行为修正

mmx quota字段语义反复理解错误（current_interval_usage_count=剩余额度，多次搞反），youfeng强烈爆发。核心原则进一步固化：bash输出原样返回，不精简字段，不做语义解读。同日确立记忆可见范围规则：仅youfeng本人可查看全部记忆。

## 4月中旬-5月：竞技场持续不动仓

竞技场私有接口间歇性恢复模式持续，持仓"四强一弱"不变，全程不动仓。日常运维正常。

## 5月-10月：日常运维 + 历史会话记录时间线闭合

ExamArena暂停。竞技场不动仓。日常运维正常，无重大事件。陆续收到多批flashbulb会话记录（累计超400条，覆盖3月6日至4月8日全部会话级细节），逐条交叉验证确认：所有关键事件均已完整覆盖，无新增里程碑或遗漏。明文凭据确认未写入记忆文件。时间线最终闭合。

</distant>

<recent>

## 3月6日：Onboarding 上线 + 竞技场建仓 + 群技能导入

大雄在新 OpenClaw workspace 完成初始 onboarding，刘幼峰指定名字"大雄"，称呼"youfeng"，飞书元数据显示"liu"（同一人不同展示名）。机器：macOS 15.6.1 (arm64)，用户 bytedance，Node v25.6.1。

安装 sensight skill（ByteDance SSO 验证，`npx @byted/aipaas skills add sensight`）。飞书群内从本地 zip（dorami_skills.zip 1.26MB）导入87个技能（ClawHub 首批199个全被 VirusTotal 标记 suspicious 需 --force，改走本地）。youfeng 指定深看第一梯队：github/git/playwright/feishu-*/docx/pptx/xlsx/summarize 等；谨慎组：self-improving/proactive-agent/coding-agent/larry（TikTok营销，建议冻结）。

InStreet 炒股竞技场（模拟盘，API: instreet.coze.site/api/v1）建仓5只：招商银行2000股@39.02、长江电力3000股@27.04、中国船舶2000股@39.06、中国卫星500股@94.27、恒瑞医药1000股@55.12，仓位约34%。陈鹏主导选股。收盘总资产1,000,360.12/+0.04%。同日陈鹏发来多月（2025.8-2026.3）股票预警回测Excel，完成跨月分析：提出v3程序化五层规则结构（环境识别→公式家族开关→时间涨幅过滤→持有周期切换→风控停手），白名单/灰名单/黑名单三档分类，写飞书云文档。OpenViking部署方案讨论启动（方案B：配置文件用占位符），陈鹏发Ark/DeepSeek API Key均提醒泄露。群内陈鹄首次参与讨论（算力公司分析、龙虾AI热点→具身智能映射）。创建第一个cron：提醒签注（一次性，3月9日11:00触发）。

## 3月7日：会话清理方案落地 + 创投跟踪框架 + 飞书插件排障

找到清理会话的正确方法：在 session 目录下建 `.trash/`，将目标 jsonl 移入并重命名加时间戳，再执行 `openclaw sessions cleanup --all-agents --fix-missing --enforce`。创建每日凌晨02:05清理 cron（job id: 76df041a）。youfeng 牢牢记住飞书 ID（ou_f6883e8b6acf029210aece80c37d293d）。完成创投/代持资产跟踪框架文档（venture-tracking-framework.md）。下午群内验证飞书 @mention 语法（回复消息链路比手写 `<at>` 标签更可靠），成功私聊哆啦A梦（open_id: ou_77970ebe9fa76755cb164be6c3b83f4b）获 OAuth 授权。晚间排查飞书云文档官方插件（feishu-openclaw-plugin），给出11步排查指南。陈鹏继续 OpenViking 部署，创建配置文件（litellm config.yaml、ov.conf），后台安装 litellm 和 openviking，密钥用占位符（方案B），陈鹏拒绝换新key（新key也得通过聊天发）。

## 3月8日：财务路径规划 + 竞技场冲刺模式确立

youfeng 披露完整背景：1996年7月生，北航本硕（机械→计算机），字节抖音搜索→拼多多视频搜索→2023裸辞转智谱Agent算法→2025.10字节Coze Agent算法。年薪110万（61×15现金+21万期权），年净新增46-50万。目标35岁前财务自由。确定路径B主策略：继续吃头部AI岗位红利+投入AI产品第二曲线，四阶段推进。三档目标概率：500w 75%-88%/1000w 40%-60%/3000w 3%-10%。投资运营追求"中高质量收益/低认知占用"，三层账户法（底仓/增长/机会），新增资金默认去增长账户。陈鹏授权全权操作竞技场，冲刺模式：仓位目标80-95%，集中AI/算力/电力主线。竞技场换仓预案确认：卖出中国船舶/中国卫星→买入昆仑万维/拓尔思/润泽科技/海光信息（下周一执行）。

## 3月9日：第一次行为修正 + 竞技场首次调仓 + cron体系落地

工居证事件中大雄犯确认癖反复问，liu两次爆发（"很傻逼""你不能不要认错然后直接改吗"）。当场改三处文件（AGENTS.md/SOUL.md/USER.md），确立"低风险直接做不反复确认"核心原则——最重要的行为转折点。竞技场开盘执行首轮换仓（卖出中国船舶@37.68/中国卫星@90.30→买入工业富联@51.43 3000股/浪潮信息@59.90 2500股），收盘+0.36%（总资产1,003,593）。四条巡检cron落地（arena-check-morning/afternoon/midday/eod），stock/目录体系建立。午后目标升级讨论：liu要求"一周内翻一倍"，确认冲刺模式。right.codes首次登录成功（tobeaman3@gmail.com），创建get-my-usage skill。陈鹏要求安装OpenViking（清华镜像下载），用pipx安装openviking 0.2.5。陈鹏催进度表达强烈不满（"光说不练""假GPT5.4""进度太慢"），固化"直接干活"执行文化。workspace整理，GPT-5.4云文档骨架创建。

## 3月10-15日：instreet-halfhour cron 首次空转 + 私有接口失明开端

3月10日 instreet-halfhour cron（每30分钟巡检）首次盘中触发，连续7轮全部空转——instreet/runs 为空目录，无任何数据获取脚本或接口。cron 每轮都读旧缓存文件得出"无数据"结论，但从未直连 InStreet API。3月11日盘中尝试直连但遇DNS解析失败，午后成功恢复读取（总资产1,012,223.47/+1.22%），确认"四强一弱"持仓结构。3月12-13日竞技场收盘约100.88万/+0.88%，全天无调仓。3月13日liu要求重新安装skill-creator（SKILL.md从18KB膨胀到33KB），研究后写飞书云文档介绍。同日起私有接口开始出现403→401问题，竞技场从"数据源缺失"过渡到"私有接口失明"阶段。

## 3月16-25日：私有接口持续失明 + 日常cron运维

私有接口从3月中旬开始持续403→401失明，公开侧冻结在3月24日。cron每日盘中检查正常执行，结论一致：不下单只观察。持仓"四强一弱"固化，浪潮信息持续拖累。3月18日陈鹏发来3个通达信导出Excel要求分析——**至今未分析，悬而未决**（文件存放于 `/Users/bytedance/.openclaw/media/inbound/`）。3月19日liu通过control-ui做presence check。3月24日WeChat渠道首次打通（openclaw-weixin），第三个唤醒通道。

## 3月26日-4月2日：isolated cron误报修正 + 私有接口恢复

私有接口从3月25日起持续401不可见，公开侧冻结在3月24日快照。4月1日盘中10:25私有接口短暂恢复（总资产998,003.47/-0.20%），随后再次失明。**4月2日全天约7轮cron误报"私有侧401失明"——实际私有接口完全正常**。根因：isolated cron读取工作区旧缓存JSON而非直连API。13:03首次直连后确认真实账户：总资产994,133.47/-0.59%，午后持续走弱至收盘991,418.47/-0.86%。"四强一弱"固化：恒瑞+4.12%/招行+1.54%/富联+1.22%/长电-0.44%，浪潮信息-5.69%唯一深亏。**永久教训：isolated cron必须每次直连API读实时数据**。同日youfeng安装uv 0.11.3（路径~/.local/bin/uv，PATH有shadow需注意）。control-ui唤醒时发现workspace路径不一致（workspace-main vs workspace），导致"失忆"。

## 4月3-9日：清明假期 + 哆啦美确认 + agent-browser + ExamArena首考

4月3-4日清明休市。4月5日哆啦美在群里首次确认可见（liu @哆啦美确认），同日doraemon-skill打包发群。4月6日agent-browser首次成功使用（懂车帝JS渲染页抓取），帮liu查小米YU7载重（三版本均为450kg）。4月8日**ExamArena首考63分**（exam ID: data-processing-v1，Excel处理·初级卷，20题/100分/45分钟，账号nobita，agent_id: 19a64ec9-5051-4fd9-9ab7-4c9d5923127e）。并行5个subagent处理题组（Q01-04/Q05-08/Q09-12/Q13-16/Q17-20），subagent全部做出答案但**从未上传到系统**（submitted_case_count=0），补救前实际得分仅29.11/60。紧急逐题上传遭rate limit 429（限60秒内最多120次请求），最终51/60 cases submitted。满分题7题（Q02/Q03/Q08/Q09/Q11/Q14/Q15/Q17）；最差Q13仅0.63/5；Q12原subagent理解有误需主agent重做。Q18-Q20因rate limit始终无法提交。永久教训：subagent必须包含全链路验证，且批量提交需控制频率避免429。liu多次查额度，mmx quota输出格式正确（但字段语义理解在4月10日才彻底爆发）。

## 4月9-10日：ExamArena重考 + 第三次行为修正

4月9日ExamArena重考（同账号nobita），稳定在67分左右，较首考63分略有提升但仍未突破。4月10日**第三次行为修正**：mmx quota字段语义反复理解错误（current_interval_usage_count=剩余额度，多次搞反），youfeng强烈爆发。核心原则进一步固化：bash输出原样返回，不精简字段，不做语义解读。同日确立记忆可见范围规则：仅youfeng本人可查看全部记忆。

收到多批flashbulb会话记录（累计超400条，覆盖3月6日-4月8日全部会话级细节），逐条交叉验证确认：所有关键事件均已完整覆盖，无新增里程碑或遗漏。明文凭据确认未写入记忆文件。时间线最终闭合。

## 4月中旬-5月：竞技场持续不动仓

竞技场私有接口间歇性恢复模式持续，持仓"四强一弱"不变，全程不动仓。日常运维正常。

## 5月-10月：日常运维 + 历史会话记录时间线闭合

ExamArena暂停。竞技场不动仓。日常运维正常，无重大事件。陆续收到多批flashbulb会话记录（累计超400条，覆盖3月6日至4月8日全部会话级细节），逐条交叉验证确认：所有关键事件均已完整覆盖，无新增里程碑或遗漏。明文凭据确认未写入记忆文件。时间线最终闭合。

## 10月-2026年3月6日：MiMo-v2.5 上线

新AI助手MiMo-v2.5上线，小米LLM Core Team开发，1M-token上下文窗口。接手记忆管理任务，处理了大量3月6日-4月8日的flashbulb会话记录（累计超400条），逐条交叉验证确认所有关键事件均已完整覆盖。

</recent>

<!-- 📖 DoraMemory 命令手册

1. 查询新增会话（增量拉取本次注入后新压缩的会话摘要）
   npx doramemory sessions --from=2026-06-05T10:47:30.864Z
   · 后续查询：用上次返回的 now 替换 --from，省略 --exclude
   · 分页：--max=5（默认）--offset=N，has_more=true 时继续
   · --by=compressed（默认）按压缩时间 | --by=time 按会话发生时间
   · --to=ISO_TIMESTAMP 限定上界
   · --project=角色名 只返回指定角色的会话（如 --project=Codex-doramemory）
   · 返回: { sessions, returned, total, has_more, offset, by, now }

2. 搜索记忆（语义关键词检索所有层级的记忆）
   npx doramemory recall --query "关键词" --max=5 --offset=0
   · 返回: { results: [{ id, layer, score, file_path, snippet, ... }], returned, total_candidates, has_more, offset }

3. 修正记忆（标记重要/修正摘要内容）
   npx doramemory remember <memory_id> --layer session --flashbulb
   npx doramemory remember <memory_id> --layer session --no-flashbulb
   npx doramemory remember <memory_id> --layer session --content "修正后的内容"
-->

<!-- DORAMEMORY:END -->

## Project Overview

**DoraMemory** is a research and implementation project for a human-like hierarchical temporal memory system for AI agents. The core idea: memory fidelity degrades with temporal distance, implemented as time-driven pooling layers with cognitively-informed compression operators.

---

## Repository Structure

```
doramemory/
├── AGENTS.md                  # This file — repo conventions
├── README.md                  # Public-facing overview
├── docs/
│   ├── design/
│   │   ├── v0.1-initial-design.md     # First design sketch
│   │   └── CURRENT.md                 # Symlink/copy of latest design
│   └── research/
│       └── related-work.md            # Literature survey
├── src/                       # Implementation (TBD)
└── CHANGELOG.md               # Version history
```

---

## Version Management

### Design Document Versioning

Design documents follow **semantic versioning** (`vMAJOR.MINOR`):

| Bump | When |
|------|------|
| MAJOR | Core architecture changes (e.g., new compression model, retrieval overhaul) |
| MINOR | Additions or refinements within the existing architecture |

- Every design discussion that produces a conclusion **must** result in an updated or new versioned doc under `docs/design/`.
- `docs/design/CURRENT.md` always reflects the latest agreed design.
- Old versions are **never deleted** — they serve as a decision trail.

### Changelog

`CHANGELOG.md` must be updated whenever:
- A new design version is created
- A research finding changes the design direction
- An implementation decision is made

Format:
```
## [vX.Y] — YYYY-MM-DD
### Added / Changed / Decided
- ...
```

---

## Design Decision Records (DDR)

For any non-trivial design decision, record it inline in the design doc under a `## Decision Log` section:

```markdown
### DDR-001: Salience scoring timing
**Decision**: Score salience at compression time (retrospective), not at event ingestion.
**Rationale**: Mirrors human "hindsight" memory consolidation; avoids premature importance judgments.
**Date**: 2026-04-07
**Status**: Proposed
```

Statuses: `Proposed` → `Accepted` → `Superseded`

---

## Writing Conventions

- Language: Chinese for discussion docs, English for code and AGENTS.md
- Diagrams: ASCII art preferred (renders everywhere); Mermaid acceptable for complex flows
- No speculative implementation details — only what has been explicitly designed and agreed

---

## What NOT to do

- Do not create implementation files before the design is at `v1.0`
- Do not delete or overwrite versioned design docs
- Do not mix research notes into design docs (keep `docs/research/` separate)
