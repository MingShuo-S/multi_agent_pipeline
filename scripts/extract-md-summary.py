#!/usr/bin/env python3
"""
extract-md-summary.py — 从 .md 文件提取结构化摘要生成 .ai.md 伴侣文件。
Linux 服务器版。依赖: Python 3.8+（无第三方包）。

用法:
  python3 scripts/extract-md-summary.py <file.md> [file2.md ...]
  python3 scripts/extract-md-summary.py docs/*.md
  find . -name '*.md' -not -name '*.ai.md' -exec python3 scripts/extract-md-summary.py {} \;
"""

import sys, os, re, hashlib, json
from pathlib import Path
from typing import List, Dict, Optional

def extract_sections(content: str) -> List[Dict]:
    """提取标题层级结构"""
    sections = []
    lines = content.split('\n')
    current = {'level': 0, 'title': 'preamble', 'items': []}

    for line in lines:
        m = re.match(r'^(#{1,6})\s+(.+)$', line)
        if m:
            if current['items']:
                sections.append(current)
            current = {
                'level': len(m.group(1)),
                'title': m.group(2).strip(),
                'items': []
            }
        else:
            stripped = line.strip()
            if stripped:
                current['items'].append(stripped)

    if current['items']:
        sections.append(current)

    return sections

def extract_tables(content: str) -> List[Dict]:
    """提取 markdown 表格"""
    tables = []
    lines = content.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if '|' in line and i + 1 < len(lines) and re.match(r'^[\s|:-]+$', lines[i+1].strip()):
            # 找到表格
            headers = [h.strip() for h in line.split('|') if h.strip()]
            rows = []
            i += 2  # 跳过分隔行
            while i < len(lines) and '|' in lines[i]:
                row = [c.strip() for c in lines[i].split('|') if c.strip()]
                if row:
                    rows.append(row)
                i += 1
            if headers:
                tables.append({'headers': headers, 'rows': rows})
        else:
            i += 1

    return tables

def extract_links(content: str) -> List[Dict]:
    """提取 markdown 链接"""
    links = []
    for m in re.finditer(r'\[([^\]]+)\]\(([^)]+)\)', content):
        links.append({'text': m.group(1), 'url': m.group(2)})
    return links

def extract_code_blocks(content: str) -> List[Dict]:
    """提取代码块"""
    blocks = []
    for m in re.finditer(r'```(\w*)\n(.*?)```', content, re.DOTALL):
        blocks.append({
            'language': m.group(1) or 'text',
            'code': m.group(2).strip()[:500]  # 限制长度
        })
    return blocks

def generate_summary(md_path: Path) -> str:
    """生成 .ai.md 摘要"""
    content = md_path.read_text(encoding='utf-8')
    sections = extract_sections(content)
    tables = extract_tables(content)
    links = extract_links(content)
    code_blocks = extract_code_blocks(content)

    # 提取文件头元信息
    title = sections[0]['title'] if sections else md_path.stem
    first_para = ''
    for s in sections:
        for item in s['items']:
            if item and not item.startswith('>') and not item.startswith('|'):
                first_para = item[:200]
                break
        if first_para:
            break

    # 提取关键数字/日期
    dates = re.findall(r'\d{4}-\d{2}-\d{2}', content)

    # 构建摘要
    summary = f"# {title} (.ai.md)\n\n"
    if first_para:
        summary += f"> {first_para}\n\n"
    if dates:
        summary += f"**日期**: {dates[0]}\n\n"

    # 表格摘要
    for t in tables:
        summary += f"**{' | '.join(t['headers'])}**\n\n"
        for row in t['rows'][:5]:
            summary += f"- {' | '.join(row)}\n"
        summary += '\n'

    # 链接
    if links:
        summary += "## 参考链接\n\n"
        for link in links[:10]:
            summary += f"- [{link['text']}]({link['url']})\n"

    return summary.strip()

def main():
    if len(sys.argv) < 2:
        print("Usage: extract-md-summary.py <file.md> [file2.md ...]")
        sys.exit(1)

    for arg in sys.argv[1:]:
        md_path = Path(arg)
        if not md_path.exists() or md_path.suffix.lower() != '.md':
            print(f"SKIP {arg}: not a .md file or not found")
            continue

        summary = generate_summary(md_path)

        # Write to _ai/{name}.ai.md
        ai_dir = md_path.parent / '_ai'
        ai_dir.mkdir(exist_ok=True)
        ai_path = ai_dir / f"{md_path.stem}.ai.md"
        ai_path.write_text(summary + '\n', encoding='utf-8')
        print(f"  OK {ai_path}")

if __name__ == '__main__':
    main()
