export interface ChecklistItem {
  id: string;
  description: string;
  verify: () => Promise<boolean> | boolean;
}

export class ReleaseChecklist {
  constructor(private readonly items: ChecklistItem[]) {}

  async run() {
    const results = [] as Array<{ id: string; passed: boolean }>;
    for (const item of this.items) {
      const passed = await Promise.resolve(item.verify());
      results.push({ id: item.id, passed });
    }
    return results;
  }
}
