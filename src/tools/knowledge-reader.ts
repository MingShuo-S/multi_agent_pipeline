import { promises as fs } from 'fs';
import path from 'path';

export interface KnowledgeDoc {
  name: string;
  path: string;
  content: string;
}

export async function knowledgeRead(
  workspaceRoot: string,
  docName?: string,
): Promise<KnowledgeDoc[] | KnowledgeDoc | null> {
  const knowledgeDir = path.join(workspaceRoot, 'knowledge');
  try {
    await fs.access(knowledgeDir);
    const entries = await fs.readdir(knowledgeDir, { withFileTypes: true });
    const mdFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.md') || e.name.endsWith('.txt')));
    if (docName) {
      const file = mdFiles.find(e => e.name === docName);
      if (!file) return null;
      const content = await fs.readFile(path.join(knowledgeDir, file.name), 'utf-8');
      return { name: file.name, path: path.join(knowledgeDir, file.name), content };
    }
    const result: KnowledgeDoc[] = [];
    for (const f of mdFiles) {
      const content = await fs.readFile(path.join(knowledgeDir, f.name), 'utf-8');
      result.push({ name: f.name, path: path.join(knowledgeDir, f.name), content });
    }
    return result;
  } catch {
    return docName ? null : [];
  }
}
