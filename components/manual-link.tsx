import { BookOpen } from 'lucide-react';

export function ManualLink() {
  return <a className="nav-item manual-link" href="/manual/"><BookOpen size={18} /><span>使用手冊</span></a>;
}
