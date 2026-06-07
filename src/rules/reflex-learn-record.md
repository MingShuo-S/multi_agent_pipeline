# 条件反射规则 — 学→记

每次交互中发现的新信息必须立即写入，不等待"请记录下来"的指令。

## 触发条件

| 信号类型 | 检测模式 | 动作 |
|---------|---------|------|
| 用户纠正 | `不是 X`、`不对`、`不要用 X` | 写入 forbiddenPatterns + kb.json |
| 正面反馈 | `不赖`、`可以`、`对`、`就是这个` | 写入 kb.json（feedback） |
| 新偏好 | 用户明确说了喜欢/不喜欢什么 | 写入 vocabulary.highFreq + kb.json |
| 用户指令 | 新的配置、路径、工作方式 | 写入 kb.json（fact） |

## 写入目标

| 数据 | 写入方法 | 文件 |
|------|---------|------|
| 风格规则 | `style_write_profile` | style-dna.json |
| 知识条目 | `kb_write` | kb.json |
| 洞察日志 | `appendInsight` | memory/insights.md |
| 用户画像 | `writePersona` | profile/persona.md |
