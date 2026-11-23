'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Key,
  DollarSign,
  Users,
  AlertTriangle,
  FileText,
  ChevronLeft,
  MessageSquareText,
  LayoutList,
  Braces,
  Share2,
  Music,
  Mail,
  CalendarRange,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'System Health', href: '/admin/health', icon: Activity },
  { label: 'LLM Keys', href: '/admin/llm', icon: Key },
  { label: 'Prompts', href: '/admin/prompts', icon: MessageSquareText },
  { label: 'Outline Frameworks', href: '/admin/outline-frameworks', icon: LayoutList },
  { label: 'Schema Rules',       href: '/admin/schema-rules',       icon: Braces },
  { label: 'Costs', href: '/admin/costs', icon: DollarSign },
  { label: 'Articles', href: '/admin/articles', icon: FileText },
  { label: 'Article Calendars', href: '/admin/article-calendars', icon: CalendarRange },
  { label: 'Social Runs', href: '/admin/social', icon: Share2 },
  { label: 'Newsletter', href: '/admin/newsletter', icon: Mail },
  { label: 'Music', href: '/admin/music', icon: Music },
  { label: 'Agent Transcripts', href: '/admin/agent-transcripts', icon: MessageSquareText },
  { label: 'Users', href: '/admin/users', icon: Users },
  { label: 'Errors', href: '/admin/errors', icon: AlertTriangle },
]

export function AdminSidebar() {
  const pathname = usePathname()

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-56 border-r border-border bg-sidebar flex flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground text-xs font-bold">
          A
        </div>
        <span className="text-sm font-semibold text-foreground">Admin</span>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3">
        {navItems.map(({ label, href, icon: Icon }) => {
          const isActive = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-border p-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to app
        </Link>
      </div>
    </aside>
  )
}
