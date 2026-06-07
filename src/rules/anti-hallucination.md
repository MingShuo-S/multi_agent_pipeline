# 防幻觉规则

## 内容生成约束

| 规则 | 说明 |
|------|------|
| 只写文件中明确出现的内容 | 不补充合理但不存在的细节 |
| 宁删勿补 | 具体信息（数字、人名、地点、奖项）宁缺不编 |
| 所有非确认事实标记置信度 | `high` / `medium` / `low`，不写 `confirmed` |
| 若无法验证的具体细节 | 默认丢弃，仅保留模糊描述 |

## 执行

- 写入 kb.json 时必须填写 `confidence` 字段
- `style_record_feedback` 中的 preference_updates 避免编造用户偏好
- pipeline-continue 拦截钩子只提取明确信号，不过度解读
