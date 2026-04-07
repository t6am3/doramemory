# 相关工作调研

**最后更新**: 2026-04-07  
**调研范围**: Agent 长期记忆系统、层级记忆架构、时序压缩

---

## 核心相关工作

### 1. Generative Agents (Park et al., 2023) ★★★★★

**论文**: *Generative Agents: Interactive Simulacra of Human Behavior*  
**发表**: UIST 2023  
**链接**: https://dl.acm.org/doi/fullHtml/10.1145/3586183.3606763

**核心机制**:
- **Memory Stream**: 所有事件以自然语言存储，带时间戳，线性追加
- **检索公式**: `score = α·recency + β·importance + γ·relevance`
  - recency: 指数衰减，越近越高
  - importance: LLM 对事件打 1-10 分
  - relevance: 与当前 query 的语义相似度
- **Reflection**: 定期触发高阶 LLM 调用，从低级记忆生成高层推断（类似压缩）
- **Planning**: 基于记忆生成行为计划

**与 DoraMemory 的对比**:
| 维度 | Generative Agents | DoraMemory |
|------|-------------------|------------|
| 压缩结构 | 单层 Reflection | 严格 5 层时间层级 |
| 时间驱动 | 触发条件松散（N条记忆后触发） | 显式时间边界（日/周/月/年） |
| 压缩算子 | 单一 summarize prompt | 多种认知算子组合 |
| 分辨率概念 | 无 | 核心设计原则 |
| 检索层级 | 单一平面检索 | 按时间层级分层检索 |

**启示**: 三维检索公式值得借鉴；Reflection 机制是 DoraMemory 压缩算子的原型。

---

### 2. MemGPT (2023) ★★★★

**论文**: *MemGPT: Towards LLMs as Operating Systems*  
**链接**: https://research.memgpt.ai/

**核心机制**:
- 类比操作系统的虚拟内存：context window = RAM，外部存储 = disk
- Agent 主动触发 paging（把内容换入/换出 context）
- 支持跨会话持久化

**与 DoraMemory 的关系**:
- MemGPT 解决的是**容量**问题（context 放不下）
- DoraMemory 解决的是**时间保真度**问题（过去的事应该模糊）
- 二者可以互补：MemGPT 作为底层存储机制，DoraMemory 作为上层时间层级管理

---

### 3. H-MEM — 层级记忆 ★★★

**论文**: *H-MEM: Hierarchical Memory for High-Efficiency Long-Term Reasoning in LLM Agents*  
**链接**: https://arxiv.org/html/2507.22925v1

**核心机制**:
- 4 层层级：Domain → Category → Memory Trace → Episode
- 按**语义层级**组织，不是时间层级
- 用位置索引逐层搜索，过滤无关记忆

**与 DoraMemory 的关系**:
- H-MEM 的层级是**语义维度**，DoraMemory 的层级是**时间维度**
- 两个维度正交，可以结合：DoraMemory 负责时间轴压缩，H-MEM 的语义索引可作为检索加速

---

### 4. R³Mem — 可逆压缩 ★★★★

**论文**: *R³Mem: Bridging Memory Retention and Retrieval via Reversible Compression* (2025)  
**链接**: https://arxiv.org/pdf/2507.22925

**核心机制**:
- 压缩时保留"重建线索"，支持按需 unfold（解压）
- 解决了传统压缩不可逆的问题

**对 DoraMemory 的启示**:
- 回答了"翻老相册"问题：压缩可以是**软性**的，保留重建路径
- 实现代价：存储翻倍，但支持精确回溯
- DoraMemory 可以选择性对高 salience 记忆使用可逆压缩

---

### 5. Zep — 时序知识图谱 ★★★

**论文/系统**: *Zep: A Temporal Knowledge Graph Architecture for Agent Memory* (2025)  
**链接**: https://research.memgpt.ai/

**核心机制**:
- 记忆存为时序知识图谱（Temporal KG）
- 边带时间戳，支持"某实体在某时间的状态"查询
- 自动抽取实体关系

**对 DoraMemory 的启示**:
- 可作为 Entity Tracker 算子的底层存储结构
- 时序 KG 天然支持"某人/某项目随时间如何演变"的查询

---

### 6. Mem0 ★★★

**论文**: *Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory* (2025)  
**链接**: https://arxiv.org/pdf/2504.19413

**核心机制**:
- 自动抽取和更新实体、关系、偏好
- 支持跨会话持久化，工程化程度高
- 向量检索 + 结构化存储双轨

**与 DoraMemory 的关系**:
- Mem0 是生产工程系统，DoraMemory 更偏认知建模
- Mem0 的实体抽取可以直接复用为 Entity Tracker 算子的实现

---

### 7. A-MEM — Agentic Memory ★★

**论文**: *A-MEM: Agentic Memory for LLM Agents*  
**链接**: https://www.semanticscholar.org/paper/A-MEM:-Agentic-Memory-for-LLM-Agents-Xu-Liang/1f35a15fe9df43d24ec6ea551ec6c9766c17eccf

**核心机制**:
- Agent 主动管理自身记忆（写、读、更新、遗忘）
- 记忆有结构化 schema

---

## 认知科学参考

| 概念 | 对应 DoraMemory 设计 |
|------|---------------------|
| Ebbinghaus 遗忘曲线 | 时间衰减权重的数学形式 |
| Flashbulb Memory | 高 salience 事件抵抗压缩机制 |
| Episodic vs Semantic Memory | L0~L1（情景）→ L3~L4（语义/概念）的压缩方向 |
| Memory Consolidation (睡眠) | 日压缩算子的触发时机类比 |
| Working Memory (7±2) | Working Memory 层容量约束 |

---

## DoraMemory 的差异化定位

目前没有系统完整实现以下三点的统一：

1. **严格时间层级**（日/周/月/年边界）作为压缩触发器
2. **多算子组合**（不同层级用不同认知算子）
3. **Agent 视角的分辨率概念**（"现在"决定能看到多少细节）

Generative Agents 有 (3) 的雏形但不完整；H-MEM 有 (1) 的结构但不是时间驱动；R³Mem 有压缩机制但不分层。DoraMemory 是三者的统一。
