import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CloudUpload,
  Database,
  FileText,
  Gauge,
  History,
  Layers3,
  LayoutDashboard,
  Loader2,
  LogOut,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Timer,
  TriangleAlert,
  Workflow,
  Zap,
  XCircle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  api,
  approveArticle,
  authTokenKey,
  deleteArticle,
  getArticle,
  getArticleVersions,
  getProcessingStatus,
  listArticles,
  publishArticle,
  rejectArticle,
  requestArticleChanges,
  submitArticleForReview,
  updateArticle,
  uploadSourceDocument,
  type ArticleDetail,
  type ArticleKind,
  type ArticleListItem,
  type ArticleSection,
  type ArticleStatus,
  type ArticleStep,
  type ArticleUpdatePayload,
  type ArticleVersionSummary,
  type DraftSourceType,
  type LoginResponse,
  type ProcessingStatus,
  type ProcessingStatusResponse,
  type UserProfile,
  type UserRole,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type NavigationItem = {
  label: string
  icon: typeof LayoutDashboard
  roles: UserRole[]
}

type BadgeVariant = 'default' | 'secondary' | 'warning' | 'destructive' | 'outline' | 'ghost' | 'link'

type PageSearchResult = {
  label: string
  detail: string
}

type WorkspaceMode = 'drafts' | 'review' | 'knowledge' | 'versions'

type ArticleFormState = {
  title: string
  kind: ArticleKind
  summary: string
  description: string
  steps: string
  sections: string
  keywords: string
  source_reference: string
  source_type: DraftSourceType
  requires_editor_review: boolean
  change_note: string
}

const allRoles: UserRole[] = ['admin', 'reviewer', 'editor']
const supportedExtensions = ['txt', 'pdf', 'docx', 'eml', 'msg', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp']
const terminalStatuses: ProcessingStatus[] = ['created', 'duplicate', 'failed', 'needs_editor_review']
const articleKindOptions: ArticleKind[] = ['article', 'sop']
const reviewStatuses: ArticleStatus[] = ['submitted', 'rpa_submitted', 'reviewed']

const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, roles: allRoles },
  { label: 'Upload Console', icon: CloudUpload, roles: ['admin', 'editor'] },
  { label: 'AI Draft Builder', icon: Bot, roles: ['admin', 'editor'] },
  { label: 'Review Queue', icon: ClipboardCheck, roles: ['admin', 'reviewer'] },
  { label: 'Knowledge Base', icon: Database, roles: allRoles },
  { label: 'Version History', icon: History, roles: allRoles },
  { label: 'RPA Runs', icon: Workflow, roles: ['admin'] },
  { label: 'Admin Settings', icon: Settings, roles: ['admin'] },
]

const pageSearchDetails: Record<string, string> = {
  Dashboard: 'Overview of the current workflow and module entry points.',
  'Upload Console': 'Upload source files and monitor extraction progress.',
  'AI Draft Builder': 'Edit draft articles and prepare them for review.',
  'Review Queue': 'Review, edit, publish, reject, or return queued articles.',
  'Knowledge Base': 'Browse the KB library and open published SOP pages.',
  'Version History': 'Inspect saved snapshots and change notes.',
  'RPA Runs': 'Review automation activity and operational runs.',
  'Admin Settings': 'Manage administrative controls and configuration.',
}

const businessValueWidgets = [
  {
    title: 'Knowledge Coverage',
    value: '82%',
    detail: 'of uploaded SOP sources converted into searchable articles',
    progress: 82,
    icon: Layers3,
  },
  {
    title: 'Average Review Time',
    value: '2.4h',
    detail: 'from draft creation to approval',
    progress: 76,
    icon: Timer,
  },
  {
    title: 'Automation Savings',
    value: '37.5h',
    detail: 'estimated manual hours saved this week',
    progress: 88,
    icon: Zap,
  },
  {
    title: 'RPA Reliability',
    value: '96%',
    detail: 'successful automation runs',
    progress: 96,
    icon: Gauge,
  },
]

const pipelineStages = [
  { label: 'Ingested', value: '132', detail: 'Sources captured and classified', icon: Database },
  { label: 'OCR + AI Draft', value: '96', detail: 'Text extracted and SOP drafts generated', icon: Sparkles, highlight: true },
  { label: 'Pending Review', value: '18', detail: 'Awaiting reviewer governance checks', icon: ClipboardCheck },
  { label: 'Published', value: '74', detail: 'Searchable KB articles', icon: CheckCircle2 },
  { label: 'Failed RPA', value: '3', detail: 'Critical automations requiring follow-up', icon: TriangleAlert, critical: true },
] satisfies Array<{
  label: string
  value: string
  detail: string
  icon: typeof LayoutDashboard
  highlight?: boolean
  critical?: boolean
}>

const recentRpaLogs = [
  { run: 'RPA-1042', title: 'Published 12 approved SOP articles to KB', time: '14 min ago', status: 'Success', variant: 'outline' },
  { run: 'RPA-1041', title: 'Synced review approvals from governance queue', time: '1 hr ago', status: 'Success', variant: 'outline' },
  { run: 'RPA-1040', title: 'UiPath credential expired during publisher run', time: '2 hr ago', status: 'Critical', variant: 'destructive' },
] satisfies Array<{ run: string; title: string; time: string; status: string; variant: BadgeVariant }>

const recentDrafts = [
  { title: 'POD upload failed again', source: 'Email thread', status: 'Needs review' },
  { title: 'Error Code AUTH 401', source: 'Incident note', status: 'AI draft' },
  { title: 'Customer address invalid', source: 'Support SOP', status: 'Editor pass' },
]

const dashboardAlerts = [
  { title: 'RPA authentication failure', detail: 'Publishing bot is blocked until credentials are refreshed.', variant: 'destructive' },
  { title: 'Duplicate SOP candidate detected', detail: 'Email attachment overlaps with POD upload handling article.', variant: 'warning' },
  { title: 'Scanned PDF fallback outdated', detail: 'OCR fallback procedure needs reviewer validation.', variant: 'outline' },
] satisfies Array<{ title: string; detail: string; variant: BadgeVariant }>

const suggestedSops = [
  'UiPath credential expiration fix',
  'OCR fallback handling',
  'Duplicate article merge procedure',
]

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleString()
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function responseErrorDetail(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response
    if (typeof response?.data?.detail === 'string') {
      return response.data.detail
    }
  }
  return fallback
}

function stepsToText(steps: ArticleStep[]) {
  return steps.map((step) => step.instruction).join('\n')
}

function textToSteps(value: string): ArticleStep[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((instruction, index) => ({
      step_no: index + 1,
      instruction,
    }))
}

function sectionsToText(sections: ArticleSection[]) {
  return sections.map((section) => `${section.heading}\n${section.content}`).join('\n\n')
}

function textToSections(value: string): ArticleSection[] {
  return value
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [headingLine, ...contentLines] = block.split('\n')
      const heading = headingLine.trim()
      const content = contentLines.join('\n').trim()
      return {
        heading: heading.length >= 3 ? heading.slice(0, 120) : 'Notes',
        content: (content || heading).slice(0, 5000),
      }
    })
}

function articleToFormState(article: ArticleDetail): ArticleFormState {
  const draft = article.structured_content
  return {
    title: draft.title,
    kind: draft.kind,
    summary: draft.summary,
    description: draft.description,
    steps: stepsToText(draft.steps),
    sections: sectionsToText(draft.sections),
    keywords: draft.keywords.join(', '),
    source_reference: draft.source_reference,
    source_type: draft.source_type,
    requires_editor_review: draft.requires_editor_review,
    change_note: '',
  }
}

function buildUpdatePayload(form: ArticleFormState): ArticleUpdatePayload {
  return {
    schema_version: '1.0',
    title: form.title.trim(),
    kind: form.kind,
    summary: form.summary.trim(),
    description: form.description.trim(),
    steps: textToSteps(form.steps),
    sections: textToSections(form.sections),
    keywords: splitCsv(form.keywords),
    source_reference: form.source_reference.trim(),
    source_type: form.source_type,
    requires_editor_review: form.requires_editor_review,
    change_note: form.change_note.trim() || null,
  }
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ')
}

function sectionId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function articleFriendlyId(article: Pick<ArticleListItem | ArticleDetail, 'id' | 'kind'>) {
  const numericId = article.id
    .replace(/-/g, '')
    .slice(0, 8)
    .split('')
    .reduce((total, character) => total + character.charCodeAt(0), 0)
  const prefix = article.kind === 'sop' ? 'SOP' : 'KB'
  return `${prefix}-${String((numericId % 99999) + 1).padStart(5, '0')}`
}

function articleCategory(article: Pick<ArticleListItem | ArticleDetail, 'title' | 'summary' | 'keywords' | 'source_references'>) {
  const haystack = [
    article.title,
    article.summary ?? '',
    ...article.keywords,
    ...article.source_references,
  ]
    .join(' ')
    .toLowerCase()

  if (/(shipment|routing|country code|reprocess|delivery|waybill)/.test(haystack)) {
    return 'Shipment Operations'
  }
  if (/(auth|access|login|password|permission|ad group|401)/.test(haystack)) {
    return 'Access & Authentication'
  }
  if (/(pod|document|upload|image|label|printing|compress)/.test(haystack)) {
    return 'POD & Documents'
  }
  if (/(customer|onboarding|credit|approval|account)/.test(haystack)) {
    return 'Customer Onboarding'
  }
  if (/(billing|invoice|payment|charge|mismatch)/.test(haystack)) {
    return 'Billing & Invoice'
  }
  return 'General Knowledge'
}

function sourceLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function articleStatusVariant(status: string): 'secondary' | 'outline' | 'destructive' {
  if (status === 'failed' || status === 'rejected') {
    return 'destructive'
  }
  if (status === 'draft' || status === 'submitted' || status === 'rpa_submitted' || status === 'needs_editor_review') {
    return 'secondary'
  }
  return 'outline'
}

function articleDestinationView(status: ArticleStatus): string {
  if (status === 'published') {
    return 'Knowledge Base'
  }
  if (reviewStatuses.includes(status)) {
    return 'Review Queue'
  }
  if (status === 'draft' || status === 'rejected') {
    return 'AI Draft Builder'
  }
  return 'Version History'
}

function WorkspaceMetaBadge({
  label,
  variant = 'outline',
}: {
  label: string
  variant?: BadgeVariant
}) {
  return (
    <Badge variant={variant} className="max-w-full min-w-0">
      <span className="truncate">{label}</span>
    </Badge>
  )
}

function WorkspaceArticleListItem({
  item,
  selected,
  onSelect,
}: {
  item: ArticleListItem
  selected: boolean
  onSelect: (articleId: string) => void
}) {
  return (
    <button
      key={item.id}
      type="button"
      onClick={() => onSelect(item.id)}
      className={cn(
        'group relative h-auto w-full shrink-0 rounded-xl border border-border/80 bg-background/95 px-3.5 py-3 text-left shadow-sm transition-[transform,background-color,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'border-primary/45 bg-card shadow-md ring-1 ring-primary/20'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium leading-6">{item.title}</p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {statusLabel(item.status)} · updated {formatShortDate(item.updated_at)}
          </p>
        </div>
        <WorkspaceMetaBadge label={statusLabel(item.status)} variant={articleStatusVariant(item.status)} />
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary ?? 'No summary stored.'}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <WorkspaceMetaBadge label={item.kind} />
        <WorkspaceMetaBadge label={`v${item.current_version_no}`} />
        {item.source_references[0] ? <WorkspaceMetaBadge label={item.source_references[0]} /> : null}
        {item.requires_editor_review ? <WorkspaceMetaBadge label="review flag" variant="secondary" /> : null}
      </div>
    </button>
  )
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (profile: UserProfile) => void
}) {
  const [loginId, setLoginId] = useState('Admin1')
  const [password, setPassword] = useState('admin123')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      const response = await api.post<LoginResponse>('/api/auth/login', {
        login_id: loginId,
        password,
      })
      localStorage.setItem(authTokenKey, response.data.access_token)
      onLogin(response.data.user)
    } catch {
      setError('Invalid ID or password, or the FastAPI server is not reachable.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md bg-card shadow-lg shadow-foreground/5">
        <CardHeader>
          <img src="/DHL_Logo_BF_rgb.png" alt="DHL" className="mb-3 w-[112px] min-w-[84px] rounded-sm" />
          <CardTitle className="text-2xl">KnowledgeOps AI Console</CardTitle>
          <CardDescription>Sign in with a demo role to manage drafts, reviews, and KB articles.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              User ID
              <input
                value={loginId}
                onChange={(event) => setLoginId(event.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                autoComplete="username"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                type="password"
                autoComplete="current-password"
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button className="mt-1" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              Sign in
            </Button>
          </form>
          <div className="mt-5 flex flex-col gap-2 text-xs text-muted-foreground">
            <p>Admin1 / admin123</p>
            <p>Reviewer1 / reviewer123</p>
            <p>Editor1 / editor123</p>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

function DashboardView({
  user,
  onNavigate,
}: {
  user: UserProfile
  onNavigate: (label: string) => void
}) {
  const workflowTarget = user.role === 'editor' ? 'AI Draft Builder' : 'Review Queue'
  const workflowLabel = user.role === 'editor' ? 'Draft Queue: 96' : 'Review Queue: 18'
  const rpaIssueTarget = user.role === 'admin' ? 'RPA Runs' : 'Knowledge Base'
  const draftActionTarget = user.role === 'reviewer' ? 'Review Queue' : 'AI Draft Builder'
  const draftActionLabel = user.role === 'reviewer' ? 'Open Review Queue' : 'Open AI Draft Builder'

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-5">
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="warning">
                  <Sparkles data-icon="inline-start" />
                  AI-assisted operations
                </Badge>
                <Badge variant="outline">{user.full_name}</Badge>
                <Badge variant="outline" className="capitalize">
                  {user.role} access
                </Badge>
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground max-sm:text-2xl">
                  DHL KnowledgeOps AI Console
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  AI-assisted SOP ingestion, review, and RPA control.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {user.role !== 'reviewer' ? (
                <Button onClick={() => onNavigate('Upload Console')}>
                  <CloudUpload data-icon="inline-start" />
                  Upload Source
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onNavigate(workflowTarget)}>
                <ClipboardCheck data-icon="inline-start" />
                {workflowLabel}
              </Button>
              <Button variant="destructive" onClick={() => onNavigate(rpaIssueTarget)}>
                <TriangleAlert data-icon="inline-start" />
                RPA Issues: 3
              </Button>
              <Button variant="outline" onClick={() => onNavigate('Knowledge Base')}>
                <BookOpen data-icon="inline-start" />
                Search SOPs
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-primary/35 bg-primary/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Publishing Readiness</p>
                <p className="mt-1 text-xs text-muted-foreground">Governed knowledge flow</p>
              </div>
              <ShieldCheck />
            </div>
            <div className="mt-4 flex items-end justify-between gap-3">
              <p className="text-5xl font-semibold tracking-tight">91%</p>
              <Badge variant="secondary">Ready</Badge>
            </div>
            <Progress value={91} className="mt-4" />
          </div>
        </div>
      </section>

      <Card className="bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Workflow />
            AI Processing Pipeline
          </CardTitle>
          <CardDescription>Linked article flow from ingestion through governed publication and RPA exception handling.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {pipelineStages.map(({ label, value, detail, icon: Icon, highlight, critical }, index) => (
              <Card
                key={label}
                size="sm"
                className={cn(
                  'relative min-h-[9rem] bg-surface-muted shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-md',
                  highlight && 'border-primary/50 bg-primary/10',
                  critical && 'border-destructive/25 bg-destructive/[0.03]'
                )}
              >
                <CardContent className="flex h-full flex-col justify-between gap-3 pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={cn(
                        'flex size-9 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-sm',
                        highlight && 'border-primary bg-primary text-primary-foreground',
                        critical && 'border-destructive/25 bg-destructive/[0.08] text-destructive'
                      )}
                    >
                      <Icon />
                    </div>
                    <span className="rounded-full border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className={cn('text-3xl font-semibold tracking-tight', critical && 'text-destructive')}>{value}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Priority Attention</CardTitle>
            <CardDescription>Problems that should be handled before normal queue work.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {dashboardAlerts.map((alert) => (
              <button
                key={alert.title}
                type="button"
                onClick={() => onNavigate(alert.variant === 'destructive' ? rpaIssueTarget : 'Review Queue')}
                className="flex items-start justify-between gap-3 rounded-lg border bg-surface-muted p-3 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div>
                  <p className="text-sm font-semibold">{alert.title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{alert.detail}</p>
                </div>
                <Badge variant={alert.variant}>
                  {alert.variant === 'destructive' ? 'Critical' : alert.variant === 'warning' ? 'Review' : 'Normal'}
                </Badge>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Suggested Related SOPs</CardTitle>
            <CardDescription>Relevant guidance surfaced from the knowledge base.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {suggestedSops.map((sop) => (
              <button
                key={sop}
                type="button"
                onClick={() => onNavigate('Knowledge Base')}
                className="flex items-center justify-between gap-3 rounded-lg border bg-surface-muted p-3 text-left text-sm transition-[background-color,border-color,transform] hover:-translate-y-0.5 hover:border-primary/45 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="leading-6">{sop}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Secondary Operations</CardTitle>
            <CardDescription>Recent activity is available below the fold so priority issues stay dominant.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Recent RPA Logs</p>
                <Button variant="outline" size="sm" onClick={() => onNavigate(rpaIssueTarget)}>
                  View RPA
                </Button>
              </div>
              {recentRpaLogs.map((log) => (
                <div key={log.run} className="rounded-lg border bg-surface-muted p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{log.run}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{log.title}</p>
                    </div>
                    <Badge variant={log.variant}>{log.status}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{log.time}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Recently Created Drafts</p>
                <Button variant="outline" size="sm" onClick={() => onNavigate(draftActionTarget)}>
                  {draftActionLabel}
                </Button>
              </div>
              {recentDrafts.map((draft) => (
                <div key={draft.title} className="flex items-start justify-between gap-3 rounded-lg border bg-surface-muted p-3">
                  <div>
                    <p className="text-sm font-semibold">{draft.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{draft.source}</p>
                  </div>
                  <Badge variant="secondary">{draft.status}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Business Impact</CardTitle>
            <CardDescription>Management summary compressed into one strip.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {businessValueWidgets.map(({ title, value, detail, progress, icon: Icon }) => (
              <div key={title} className="rounded-lg border bg-surface-muted p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-semibold tracking-tight">{value}</p>
                    <Icon className="text-muted-foreground" />
                  </div>
                </div>
                <Progress value={progress} className="mt-3" />
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function UploadConsole({
  onOpenDraft,
}: {
  onOpenDraft: (articleId: string) => void
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [clientError, setClientError] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [processing, setProcessing] = useState<ProcessingStatusResponse | null>(null)

  useEffect(() => {
    if (!uploadId) {
      return
    }
    if (processing && terminalStatuses.includes(processing.processing_status)) {
      return
    }

    const timer = window.setTimeout(async () => {
      try {
        const response = await getProcessingStatus(uploadId)
        setProcessing(response.data)
      } catch {
        setClientError('Unable to refresh processing status right now.')
      }
    }, 1400)

    return () => window.clearTimeout(timer)
  }, [uploadId, processing])

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    setClientError('')

    if (!file) {
      setSelectedFile(null)
      return
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!supportedExtensions.includes(extension)) {
      setSelectedFile(null)
      setClientError(`Unsupported file type. Use: ${supportedExtensions.join(', ')}`)
      return
    }

    setSelectedFile(file)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedFile) {
      setClientError('Choose a file before starting the upload.')
      return
    }

    setClientError('')
    setIsUploading(true)
    setProcessing(null)

    try {
      const response = await uploadSourceDocument(selectedFile)
      setUploadId(response.data.processing_id)
    } catch (error: unknown) {
      setClientError(responseErrorDetail(error, 'Upload failed. Check the backend server and try again.'))
    } finally {
      setIsUploading(false)
    }
  }

  const status = processing?.processing_status ?? 'pending'
  const progressValue = !processing ? 0 : processing.processing_status === 'processing' ? 55 : terminalStatuses.includes(status) ? 100 : 15

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
      <Card className="bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <CloudUpload />
            Upload Console
          </CardTitle>
          <CardDescription>Upload a source file and let the backend extract, structure, and persist the draft.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Source file
              <div className="rounded-lg border border-dashed bg-background p-5">
                <input type="file" onChange={handleFileChange} className="block w-full text-sm" />
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Supported inputs: {supportedExtensions.join(', ')}.
                </p>
              </div>
            </label>
            {selectedFile ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm">
                <Badge variant="outline">{selectedFile.name}</Badge>
                <span className="text-muted-foreground">{Math.max(1, Math.round(selectedFile.size / 1024))} KB</span>
              </div>
            ) : null}
            {clientError ? <p className="text-sm text-destructive">{clientError}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!selectedFile || isUploading}>
                {isUploading ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <CloudUpload data-icon="inline-start" />}
                Start Processing
              </Button>
              {uploadId ? <Badge variant="outline">Processing ID: {uploadId}</Badge> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity />
            Processing Tracker
          </CardTitle>
          <CardDescription>Live status from `/api/processing`.</CardDescription>
          <CardAction>
            <Badge variant={articleStatusVariant(status)}>{statusLabel(status)}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border bg-background p-4">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">Current stage</span>
              <span className="font-medium">{processing?.processing_stage ?? 'waiting for upload'}</span>
            </div>
            <div className="mt-4">
              <Progress value={progressValue} />
            </div>
          </div>

          {processing?.generated_draft ? (
            <div className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{processing.generated_draft.kind}</Badge>
                <Badge variant="outline">{processing.generated_draft.source_reference}</Badge>
              </div>
              <p className="mt-3 text-sm font-medium">{processing.generated_draft.title}</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{processing.generated_draft.summary}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {processing.generated_draft.keywords.map((keyword) => (
                  <Badge key={keyword} variant="outline">
                    {keyword}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {processing?.article ? (
            <Button onClick={() => onOpenDraft(processing.article!.id)}>
              <Bot data-icon="inline-start" />
              Open Draft Builder
            </Button>
          ) : null}

          {processing?.source_document.processing_error ? (
            <p className="text-sm text-destructive">{processing.source_document.processing_error}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed bg-background/90 px-8 py-14 text-center shadow-sm">
      <FileText className="text-muted-foreground" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  )
}

function ArticleWorkspace({
  user,
  mode,
  preferredArticleId,
  refreshKey,
  query,
}: {
  user: UserProfile
  mode: WorkspaceMode
  preferredArticleId: string | null
  refreshKey: number
  query: string
}) {
  const deferredQuery = useDeferredValue(query)
  const [articles, setArticles] = useState<ArticleListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(preferredArticleId)
  const [article, setArticle] = useState<ArticleDetail | null>(null)
  const [versions, setVersions] = useState<ArticleVersionSummary[]>([])
  const [form, setForm] = useState<ArticleFormState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [isReviewEditing, setIsReviewEditing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const filteredArticles = useMemo(() => {
    if (mode === 'drafts') {
      return articles.filter((item) => ['draft', 'rejected'].includes(item.status))
    }
    if (mode === 'review') {
      return articles.filter((item) => reviewStatuses.includes(item.status))
    }
    if (mode === 'knowledge') {
      return articles.filter((item) => item.status === 'published')
    }
    return articles
  }, [articles, mode])

  useEffect(() => {
    async function loadArticles() {
      setIsLoading(true)
      setError('')
      try {
        const response = await listArticles(deferredQuery)
        setArticles(response.data)
      } catch {
        setError('Unable to load articles. Check that FastAPI is running.')
      } finally {
        setIsLoading(false)
      }
    }
    loadArticles()
  }, [deferredQuery, refreshKey, mode])

  useEffect(() => {
    const nextSelectedId = preferredArticleId ?? (mode === 'knowledge' ? null : filteredArticles[0]?.id ?? null)
    const timer = window.setTimeout(() => {
      setSelectedId(nextSelectedId)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [filteredArticles, mode, preferredArticleId])

  useEffect(() => {
    async function loadSelectedArticle() {
      if (!selectedId) {
        setArticle(null)
        setVersions([])
        setForm(null)
        return
      }

      setIsLoading(true)
      setError('')
      try {
        const [articleResponse, versionResponse] = await Promise.all([
          getArticle(selectedId),
          getArticleVersions(selectedId),
        ])
        setArticle(articleResponse.data)
        setVersions(versionResponse.data)
        setForm(articleToFormState(articleResponse.data))
        setIsReviewEditing(false)
      } catch {
        setError('Unable to load the selected article.')
      } finally {
        setIsLoading(false)
      }
    }
    loadSelectedArticle()
  }, [selectedId, refreshKey])

  const title =
    mode === 'drafts'
      ? 'AI Draft Builder'
      : mode === 'review'
        ? 'Review Queue'
        : mode === 'knowledge'
          ? 'Knowledge Base'
          : 'Version History'

  const description =
    mode === 'drafts'
      ? 'Edit AI-generated structured drafts, save revisions, and submit them for reviewer approval.'
      : mode === 'review'
        ? 'Review submitted drafts, request changes, approve content, or publish reviewed articles.'
        : mode === 'knowledge'
          ? 'Search and read published operational knowledge articles.'
          : 'Inspect version snapshots created by draft edits and review transitions.'

  const canEdit = user.role === 'admin' || user.role === 'editor'
  const canReview = user.role === 'admin' || user.role === 'reviewer'
  const isKnowledgeMode = mode === 'knowledge'
  const isKnowledgeSearch = isKnowledgeMode && deferredQuery.trim().length > 0

  function updateFormField<K extends keyof ArticleFormState>(field: K, value: ArticleFormState[K]) {
    setForm((current) => (current ? { ...current, [field]: value } : current))
  }

  async function refreshCurrentArticle(articleId: string) {
    const [articleResponse, versionResponse, listResponse] = await Promise.all([
      getArticle(articleId),
      getArticleVersions(articleId),
      listArticles(deferredQuery),
    ])
    setArticle(articleResponse.data)
    setVersions(versionResponse.data)
    setArticles(listResponse.data)
    setForm(articleToFormState(articleResponse.data))
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!article || !form) {
      return
    }

    setIsSaving(true)
    setMessage('')
    setError('')
    try {
      const payload = buildUpdatePayload(form)
      const response = await updateArticle(article.id, payload)
      setArticle(response.data)
      setForm(articleToFormState(response.data))
      await refreshCurrentArticle(response.data.id)
      setIsReviewEditing(false)
      setMessage(response.data.current_version_no === article.current_version_no ? 'No content changes detected. Version history was not updated.' : 'Article saved and version history updated.')
    } catch (caught: unknown) {
      setError(responseErrorDetail(caught, 'Unable to save the draft.'))
    } finally {
      setIsSaving(false)
    }
  }

  async function runTransition(action: 'submit' | 'approve' | 'publish' | 'reject' | 'changes') {
    if (!article) {
      return
    }

    setIsTransitioning(true)
    setMessage('')
    setError('')

    try {
      const payload = { change_note: form?.change_note.trim() || null }
      if (action === 'submit') {
        await submitArticleForReview(article.id, payload)
        setMessage('Draft submitted to the review queue.')
      }
      if (action === 'approve') {
        await approveArticle(article.id, payload)
        setMessage('Article approved.')
      }
      if (action === 'publish') {
        await publishArticle(article.id, payload)
        setMessage('Article published to the Knowledge Base.')
      }
      if (action === 'reject') {
        await rejectArticle(article.id, payload)
        setMessage('Article rejected.')
      }
      if (action === 'changes') {
        await requestArticleChanges(article.id, payload)
        setMessage('Article returned to draft.')
      }
      await refreshCurrentArticle(article.id)
    } catch (caught: unknown) {
      setError(responseErrorDetail(caught, 'Unable to update article status.'))
    } finally {
      setIsTransitioning(false)
    }
  }

  async function handleDeleteArticle() {
    if (!article || user.role !== 'admin') {
      return
    }
    const confirmed = window.confirm(`Delete "${article.title}" from the Knowledge Base? This cannot be undone.`)
    if (!confirmed) {
      return
    }

    setIsDeleting(true)
    setMessage('')
    setError('')
    try {
      await deleteArticle(article.id)
      setArticles((current) => current.filter((item) => item.id !== article.id))
      closeArticlePage()
      setMessage('Article deleted from the Knowledge Base.')
    } catch (caught: unknown) {
      setError(responseErrorDetail(caught, 'Unable to delete the article.'))
    } finally {
      setIsDeleting(false)
    }
  }

  function openArticlePage(articleId: string) {
    setSelectedId(articleId)
    window.history.replaceState(null, '', `#knowledge-base/${articleId}`)
  }

  function closeArticlePage() {
    setSelectedId(null)
    setArticle(null)
    setVersions([])
    setForm(null)
    setIsReviewEditing(false)
    window.history.replaceState(null, '', '#knowledge-base')
  }

  function renderPublishedEditForm() {
    if (!article || !form) {
      return null
    }
    return (
      <Card className="bg-card shadow-sm">
        <CardHeader>
          <CardTitle>Admin Edit</CardTitle>
          <CardDescription>Directly edit this published article. A new version is created only when content changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSave}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="flex flex-col gap-2 text-sm font-medium">
                Title
                <input
                  value={form.title}
                  onChange={(event) => updateFormField('title', event.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Kind
                <select
                  value={form.kind}
                  onChange={(event) => updateFormField('kind', event.target.value as ArticleKind)}
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {articleKindOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Summary
              <textarea
                value={form.summary}
                onChange={(event) => updateFormField('summary', event.target.value)}
                className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Description
              <textarea
                value={form.description}
                onChange={(event) => updateFormField('description', event.target.value)}
                className="min-h-44 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium">
                Steps
                <textarea
                  value={form.steps}
                  onChange={(event) => updateFormField('steps', event.target.value)}
                  className="min-h-36 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="One step per line"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Sections
                <textarea
                  value={form.sections}
                  onChange={(event) => updateFormField('sections', event.target.value)}
                  className="min-h-36 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Heading on first line, content below. Separate sections with a blank line."
                />
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium">
                Keywords
                <input
                  value={form.keywords}
                  onChange={(event) => updateFormField('keywords', event.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Comma separated"
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Source reference
                <input
                  value={form.source_reference}
                  onChange={(event) => updateFormField('source_reference', event.target.value)}
                  className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Change note
              <input
                value={form.change_note}
                onChange={(event) => updateFormField('change_note', event.target.value)}
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="What changed in this revision?"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={isSaving}>
                {isSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                Save Published Article
              </Button>
              <Button type="button" variant="outline" onClick={() => setIsReviewEditing(false)}>
                Cancel Edit
              </Button>
              <Badge variant="outline">New version only when content changes</Badge>
            </div>
          </form>
        </CardContent>
      </Card>
    )
  }

  if (isKnowledgeMode && article) {
    return (
      <div className="grid gap-5">
        <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-6 py-4 shadow-sm max-sm:flex-col max-sm:items-stretch">
          <Button type="button" variant="outline" onClick={closeArticlePage}>
            Back to KB Library
          </Button>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="text-sm text-muted-foreground">
              {articleFriendlyId(article)} · {articleCategory(article)}
            </div>
            {user.role === 'admin' ? (
              <>
                <Button type="button" variant="outline" onClick={() => setIsReviewEditing((value) => !value)}>
                  <Save data-icon="inline-start" />
                  {isReviewEditing ? 'Close Edit' : 'Edit Article'}
                </Button>
                <Button type="button" variant="destructive" disabled={isDeleting} onClick={handleDeleteArticle}>
                  <XCircle data-icon="inline-start" />
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        {isReviewEditing ? renderPublishedEditForm() : null}
        <Card className="overflow-hidden bg-card shadow-sm">
          <CardContent className="p-0">
            <ArticleReadable article={article} documentMode />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (isKnowledgeMode) {
    return (
      <div className="grid gap-5">
        <section className="rounded-xl border bg-card px-6 py-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <BookOpen data-icon="inline-start" />
              Knowledge Base
            </Badge>
            <Badge variant="outline">{filteredArticles.length} files</Badge>
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-tight">KB Library</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {isKnowledgeSearch
              ? `Showing relevant files for "${deferredQuery}". Select a file to open its SOP page.`
              : 'Browse operational SOP and KB files by category. Use search to find a specific file.'}
          </p>
        </section>

        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText />
              {isKnowledgeSearch ? 'Relevant Files' : 'KB Library'}
            </CardTitle>
            <CardDescription>
              {isKnowledgeSearch ? `${filteredArticles.length} matching files` : 'Category and document tree'}
            </CardDescription>
          </CardHeader>
          <CardContent className="app-scrollbar max-h-[calc(100svh-18rem)] overflow-y-auto">
            {isLoading && !filteredArticles.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Loading files
              </div>
            ) : isKnowledgeSearch ? (
              <KnowledgeSearchResults articles={filteredArticles} query={deferredQuery} selectedId={null} onSelect={openArticlePage} />
            ) : (
              <KnowledgeNavigationTree articles={filteredArticles} selectedId={null} onSelect={openArticlePage} />
            )}
            {!isLoading && !filteredArticles.length ? (
              <EmptyPanel title="No matching files" detail="Try another search term or publish an article into the Knowledge Base." />
            ) : null}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      <section className="flex items-start justify-between gap-4 max-xl:flex-col">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {mode === 'drafts' ? <Bot data-icon="inline-start" /> : null}
              {mode === 'review' ? <ClipboardCheck data-icon="inline-start" /> : null}
              {mode === 'versions' ? <History data-icon="inline-start" /> : null}
              {title}
            </Badge>
            <Badge variant="outline">{filteredArticles.length} items</Badge>
          </div>
          <h2 className="mt-4 text-2xl font-semibold tracking-normal">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText />
              Articles
            </CardTitle>
            <CardDescription>
              {deferredQuery ? `Filtered by "${deferredQuery}"` : 'Newest updates first'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-col pb-3">
            <div className="app-scrollbar min-h-0 max-h-[42rem] flex-1 rounded-2xl bg-muted/20 p-2 pr-1">
              <div className="flex min-h-0 flex-col gap-2">
            {isLoading && !filteredArticles.length ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Loading articles
              </div>
            ) : null}
            {filteredArticles.map((item) => (
              <WorkspaceArticleListItem
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                onSelect={setSelectedId}
              />
            ))}
            {!isLoading && !filteredArticles.length ? (
              <EmptyPanel
                title="No matching articles"
                detail="Try another search term, upload a source file, or move an article into this workflow state."
              />
            ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5">
          <Card className="bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {mode === 'review' ? <ClipboardCheck /> : mode === 'versions' ? <History /> : <Bot />}
                {article ? article.title : 'Select an article'}
              </CardTitle>
              <CardDescription>
                {article ? `${article.kind} · ${statusLabel(article.status)} · version ${article.current_version_no}` : 'Open an item from the list to continue.'}
              </CardDescription>
              {article ? (
                <CardAction>
                  <Badge variant={articleStatusVariant(article.status)}>{statusLabel(article.status)}</Badge>
                </CardAction>
              ) : null}
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

              {!article ? (
                <EmptyPanel title="Nothing selected" detail="Choose an article from the list to edit, review, read, or inspect its history." />
              ) : null}

              {article && form && ((mode === 'drafts' && canEdit) || (mode === 'review' && canReview && isReviewEditing)) ? (
                <form className="flex flex-col gap-4" onSubmit={handleSave}>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_10rem]">
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Title
                      <input
                        value={form.title}
                        onChange={(event) => updateFormField('title', event.target.value)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Kind
                      <select
                        value={form.kind}
                        onChange={(event) => updateFormField('kind', event.target.value as ArticleKind)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {articleKindOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Summary
                    <textarea
                      value={form.summary}
                      onChange={(event) => updateFormField('summary', event.target.value)}
                      className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Description
                    <textarea
                      value={form.description}
                      onChange={(event) => updateFormField('description', event.target.value)}
                      className="min-h-44 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Steps
                      <textarea
                        value={form.steps}
                        onChange={(event) => updateFormField('steps', event.target.value)}
                        className="min-h-36 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="One step per line"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Sections
                      <textarea
                        value={form.sections}
                        onChange={(event) => updateFormField('sections', event.target.value)}
                        className="min-h-36 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="Heading on first line, content below. Separate sections with a blank line."
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Keywords
                      <input
                        value={form.keywords}
                        onChange={(event) => updateFormField('keywords', event.target.value)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="Comma separated"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-sm font-medium">
                      Source reference
                      <input
                        value={form.source_reference}
                        onChange={(event) => updateFormField('source_reference', event.target.value)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>
                  </div>

                  {article.requires_editor_review ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
                      <p className="font-medium text-destructive">System review flag</p>
                      <p className="mt-1 leading-6 text-muted-foreground">
                        This flag is set automatically by source quality heuristics such as OCR confidence or processing issues.
                      </p>
                    </div>
                  ) : null}

                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Change note
                    <input
                      value={form.change_note}
                      onChange={(event) => updateFormField('change_note', event.target.value)}
                      className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="What changed in this revision?"
                    />
                  </label>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button disabled={isSaving}>
                      {isSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                      {mode === 'review' ? 'Save Article' : 'Save Draft'}
                    </Button>
                    {(article.status === 'draft' || article.status === 'rejected') ? (
                      <Button type="button" variant="outline" disabled={isTransitioning} onClick={() => runTransition('submit')}>
                        <Send data-icon="inline-start" />
                        Submit For Review
                      </Button>
                    ) : null}
                    {mode === 'review' ? (
                      <Button type="button" variant="outline" onClick={() => setIsReviewEditing(false)}>
                        Cancel Edit
                      </Button>
                    ) : null}
                    <Badge variant="outline">New version only when content changes</Badge>
                  </div>
                </form>
              ) : null}

              {article && mode === 'review' && canReview && !isReviewEditing ? (
                <div className="flex flex-col gap-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-sm font-medium">Summary</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{article.summary}</p>
                    </div>
                    <div className="rounded-lg border bg-background p-4">
                      <p className="text-sm font-medium">Review context</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {article.requires_editor_review ? 'This draft carries an editor review flag.' : 'No editor review flag is currently set.'}
                      </p>
                    </div>
                  </div>
                  <ArticleReadable article={article} />
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Review note
                    <input
                      value={form?.change_note ?? ''}
                      onChange={(event) => updateFormField('change_note', event.target.value)}
                      className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      placeholder="Optional note for the version history"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" disabled={isTransitioning} onClick={() => setIsReviewEditing(true)}>
                      <Save data-icon="inline-start" />
                      Edit Article
                    </Button>
                    {['submitted', 'rpa_submitted', 'reviewed'].includes(article.status) ? (
                      <Button disabled={isTransitioning} onClick={() => runTransition('publish')}>
                        <BookOpen data-icon="inline-start" />
                        Publish
                      </Button>
                    ) : null}
                    {['submitted', 'rpa_submitted', 'reviewed', 'rejected'].includes(article.status) ? (
                      <Button variant="outline" disabled={isTransitioning} onClick={() => runTransition('changes')}>
                        <Send data-icon="inline-start" />
                        Request Changes
                      </Button>
                    ) : null}
                    {['submitted', 'rpa_submitted', 'reviewed'].includes(article.status) ? (
                      <Button variant="destructive" disabled={isTransitioning} onClick={() => runTransition('reject')}>
                        <XCircle data-icon="inline-start" />
                        Reject
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {article && ((mode === 'drafts' && !canEdit) || (mode === 'review' && !canReview)) ? (
                <ArticleReadable article={article} />
              ) : null}

              {article && mode === 'versions' ? (
                <VersionList versions={versions} />
              ) : null}
            </CardContent>
          </Card>

          {article && mode !== 'versions' && !isKnowledgeMode ? (
            <Card className="bg-card shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History />
                  Recent Version History
                </CardTitle>
                <CardDescription>Newest snapshots from edits and review transitions.</CardDescription>
              </CardHeader>
              <CardContent>
                <VersionList versions={versions.slice(0, 3)} compact />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function KnowledgeNavigationTree({
  articles,
  selectedId,
  onSelect,
}: {
  articles: ArticleListItem[]
  selectedId: string | null
  onSelect: (articleId: string) => void
}) {
  const groups = articles.reduce<Record<string, ArticleListItem[]>>((current, article) => {
    const category = articleCategory(article)
    current[category] = [...(current[category] ?? []), article]
    return current
  }, {})
  const recentlyViewed = articles.filter((article) => article.id === selectedId).concat(articles.filter((article) => article.id !== selectedId).slice(0, 2))

  return (
    <nav className="flex flex-col gap-5" aria-label="Knowledge Base navigation">
      {recentlyViewed.length ? (
        <div className="flex flex-col gap-2">
          <p className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recently Viewed</p>
          <div className="flex flex-col gap-1">
            {recentlyViewed.map((article) => (
              <KnowledgeTreeItem key={article.id} article={article} selected={selectedId === article.id} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ) : null}

      {Object.entries(groups).map(([category, categoryArticles]) => (
        <details key={category} className="group flex flex-col gap-2" open>
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium hover:bg-muted">
            {category}
            <span className="text-xs text-muted-foreground">{categoryArticles.length}</span>
          </summary>
          <div className="mt-1 flex flex-col gap-1 border-l pl-2">
            {categoryArticles.map((article) => (
              <KnowledgeTreeItem key={article.id} article={article} selected={selectedId === article.id} onSelect={onSelect} />
            ))}
          </div>
        </details>
      ))}
    </nav>
  )
}

function KnowledgeTreeItem({
  article,
  selected,
  onSelect,
}: {
  article: ArticleListItem
  selected: boolean
  onSelect: (articleId: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(article.id)}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-secondary/25 font-medium text-foreground'
      )}
    >
      <span className="line-clamp-2 min-w-0">{article.title}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{formatShortDate(article.updated_at)}</span>
    </button>
  )
}

function KnowledgeSearchResults({
  articles,
  query,
  selectedId,
  onSelect,
}: {
  articles: ArticleListItem[]
  query: string
  selectedId: string | null
  onSelect: (articleId: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Search Results</p>
      {articles.map((article) => (
        <button
          key={article.id}
          type="button"
          onClick={() => onSelect(article.id)}
          className={cn(
            'rounded-lg border bg-background p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selectedId === article.id && 'border-secondary bg-secondary/20'
          )}
        >
          <p className="text-xs font-medium text-muted-foreground">
            {articleFriendlyId(article)} · {articleCategory(article)}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-medium">{highlightMatch(article.title, query)}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {highlightMatch(searchSnippet(article, query), query)}
          </p>
          {article.keywords.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {article.keywords.slice(0, 3).map((keyword) => (
                <Badge key={keyword} variant="outline" className="font-normal">
                  #{keyword}
                </Badge>
              ))}
            </div>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function GlobalSearchDropdown({
  query,
  isLoading,
  pageResults,
  articleResults,
  onSelectPage,
  onSelectArticle,
}: {
  query: string
  isLoading: boolean
  pageResults: PageSearchResult[]
  articleResults: ArticleListItem[]
  onSelectPage: (label: string) => void
  onSelectArticle: (article: ArticleListItem) => void
}) {
  const hasResults = pageResults.length > 0 || articleResults.length > 0

  return (
    <div className="absolute inset-x-0 top-[calc(100%+0.75rem)] z-30 overflow-hidden rounded-2xl border bg-card/98 shadow-xl backdrop-blur">
      <div className="app-scrollbar max-h-[26rem] overflow-y-auto p-2">
        {pageResults.length ? (
          <div className="flex flex-col gap-1 pb-2">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pages</p>
            {pageResults.map((result) => (
              <button
                key={result.label}
                type="button"
                onClick={() => onSelectPage(result.label)}
                className="rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center gap-2">
                  <WorkspaceMetaBadge label="page" variant="secondary" />
                  <p className="text-sm font-medium">{highlightMatch(result.label, query)}</p>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{result.detail}</p>
              </button>
            ))}
          </div>
        ) : null}

        {articleResults.length ? (
          <div className="flex flex-col gap-1">
            <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Articles</p>
            {articleResults.slice(0, 8).map((article) => (
              <button
                key={article.id}
                type="button"
                onClick={() => onSelectArticle(article)}
                className="rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{highlightMatch(article.title, query)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {articleDestinationView(article.status)} · {statusLabel(article.status)}
                    </p>
                  </div>
                  <WorkspaceMetaBadge label={article.kind} />
                </div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {highlightMatch(searchSnippet(article, query), query)}
                </p>
              </button>
            ))}
          </div>
        ) : null}

        {!isLoading && !hasResults ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm font-medium">No global matches</p>
            <p className="mt-2 text-sm text-muted-foreground">Try a page name, article title, keyword, or source reference.</p>
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="animate-spin" />
            Searching everywhere
          </div>
        ) : null}
      </div>
    </div>
  )
}

function searchSnippet(article: ArticleListItem, query: string) {
  const text = article.summary || article.title
  const index = text.toLowerCase().indexOf(query.toLowerCase().trim())
  if (index < 0) {
    return text
  }
  const start = Math.max(0, index - 32)
  const end = Math.min(text.length, index + query.length + 48)
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`
}

function highlightMatch(text: string, query: string) {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return text
  }
  const index = text.toLowerCase().indexOf(trimmedQuery.toLowerCase())
  if (index < 0) {
    return text
  }
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-secondary/45 px-0.5 text-foreground">{text.slice(index, index + trimmedQuery.length)}</mark>
      {text.slice(index + trimmedQuery.length)}
    </>
  )
}

function ArticleReadable({
  article,
  documentMode = false,
}: {
  article: ArticleDetail
  documentMode?: boolean
}) {
  const sourceReferences = article.source_references.length ? article.source_references : [article.structured_content.source_reference].filter(Boolean)
  const outline = [
    { id: 'summary', label: 'Summary' },
    { id: 'problem', label: 'Problem / Symptom' },
    ...(article.steps.length ? [{ id: 'steps', label: 'Resolution Steps' }] : []),
    ...article.sections.map((section) => ({
      id: sectionId(section.heading),
      label: section.heading,
    })),
    { id: 'sources', label: 'Sources & Tags' },
  ]

  if (!documentMode) {
    return (
      <article className="flex flex-col gap-8 rounded-xl border bg-background p-6">
        <ArticleDocumentBody article={article} sourceReferences={sourceReferences} />
      </article>
    )
  }

  return (
    <div className="grid min-h-[calc(100svh-15rem)] xl:grid-cols-[minmax(0,1fr)_16rem]">
      <article className="mx-auto w-full max-w-3xl px-8 py-10 max-sm:px-5">
        <ArticleDocumentBody article={article} sourceReferences={sourceReferences} />
      </article>

      <aside className="hidden border-l bg-muted/20 px-6 py-10 xl:block">
        <div className="sticky top-24 flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium">On this page</p>
            <nav className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground" aria-label="Article sections">
              {outline.map((item) => (
                <a key={item.id} href={`#${item.id}`} className="transition-colors hover:text-foreground">
                  {item.label}
                </a>
              ))}
            </nav>
          </div>

          <Separator />

          <div className="flex flex-col gap-4 text-sm">
            <p className="font-medium">Article Info</p>
            <div>
              <p className="text-muted-foreground">Status</p>
              <p className="mt-1 font-medium capitalize">{statusLabel(article.status)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Version</p>
              <p className="mt-1 font-medium">v{article.current_version_no}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Owner</p>
              <p className="mt-1 font-medium">{article.updated_by ?? article.created_by ?? 'Operations Support'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Source</p>
              <p className="mt-1 font-medium capitalize">{sourceLabel(article.created_via)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Last reviewed</p>
              <p className="mt-1 font-medium">{formatDate(article.updated_at)}</p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}

function ArticleDocumentBody({
  article,
  sourceReferences,
}: {
  article: ArticleDetail
  sourceReferences: string[]
}) {
  return (
    <>
      <header className="flex flex-col gap-4">
        <p className="text-sm font-medium text-muted-foreground">{articleFriendlyId(article)}</p>
        <div className="flex flex-col gap-3">
          <h1 className="scroll-m-20 text-3xl font-bold tracking-tight text-foreground max-sm:text-2xl">{article.title}</h1>
          <p className="text-base leading-7 text-muted-foreground">{article.summary ?? 'No summary stored for this article yet.'}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium capitalize text-foreground">{statusLabel(article.status)}</span>
          {' · '}v{article.current_version_no}
          {' · '}<span className="uppercase">{article.kind}</span>
          {' · '}<span className="capitalize">{sourceLabel(article.created_via)}</span>
          {' · '}Last reviewed {formatDate(article.updated_at)}
        </p>
      </header>

      <Separator className="my-8" />

      <section id="summary" className="scroll-m-24">
        <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
        <p className="mt-3 leading-7 text-muted-foreground">{article.summary ?? 'No summary stored for this article yet.'}</p>
      </section>

      <section id="problem" className="mt-10 scroll-m-24">
        <h2 className="border-b pb-2 text-xl font-semibold tracking-tight">Problem / Symptom</h2>
        <p className="mt-4 whitespace-pre-wrap leading-7 text-muted-foreground">
          {article.description ?? 'No detailed problem description has been added yet.'}
        </p>
      </section>

      {article.requires_editor_review ? (
        <div className="my-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="font-medium text-destructive">Editor review flag</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            This article was marked for additional editor review during draft generation.
          </p>
        </div>
      ) : null}

      {article.steps.length ? (
        <section id="steps" className="mt-10 scroll-m-24">
          <h2 className="border-b pb-2 text-xl font-semibold tracking-tight">Resolution Steps</h2>
          <ol className="mt-5 ml-6 list-decimal text-muted-foreground [&>li]:mt-3 [&>li]:leading-7">
            {article.steps.map((step) => (
              <li key={step.step_no}>{step.instruction}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {article.sections.map((section) => (
        <section key={section.heading} id={sectionId(section.heading)} className="mt-10 scroll-m-24">
          <h2 className="border-b pb-2 text-xl font-semibold tracking-tight">{section.heading}</h2>
          <p className="mt-4 whitespace-pre-wrap leading-7 text-muted-foreground">{section.content}</p>
        </section>
      ))}

      <section id="sources" className="mt-10 scroll-m-24">
        <h2 className="border-b pb-2 text-xl font-semibold tracking-tight">Sources & Tags</h2>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {sourceReferences.map((source) => (
              <Badge key={source} variant="outline" className="font-normal">
                {source}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {article.keywords.map((keyword) => (
              <Badge key={keyword} variant="outline" className="font-normal">
                <Tag data-icon="inline-start" />
                #{keyword}
              </Badge>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

function VersionList({
  versions,
  compact = false,
}: {
  versions: ArticleVersionSummary[]
  compact?: boolean
}) {
  if (!versions.length) {
    return <EmptyPanel title="No versions yet" detail="Version snapshots will appear after edits or status changes." />
  }

  return (
    <div className="flex flex-col gap-3">
      {versions.map((version) => (
        <div key={version.id} className="rounded-lg border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Version {version.version_no}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(version.created_at)}</p>
            </div>
            <Badge variant={articleStatusVariant(version.status_snapshot)}>{statusLabel(version.status_snapshot)}</Badge>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{version.change_note ?? 'No change note provided.'}</p>
          {!compact ? (
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg border bg-card p-3 text-xs leading-6 whitespace-pre-wrap">
              {JSON.stringify(version.structured_content, null, 2)}
            </pre>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function PlaceholderView({ label }: { label: string }) {
  return (
    <Card className="bg-card shadow-sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>This module shell is ready for the next implementation pass.</CardDescription>
      </CardHeader>
    </Card>
  )
}

function App() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(true)
  const [activeView, setActiveView] = useState('Dashboard')
  const [preferredArticleId, setPreferredArticleId] = useState<string | null>(null)
  const [articleRefreshKey, setArticleRefreshKey] = useState(0)
  const [query, setQuery] = useState('')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [globalSearchResults, setGlobalSearchResults] = useState<ArticleListItem[]>([])
  const [isGlobalSearchLoading, setIsGlobalSearchLoading] = useState(false)
  const deferredQuery = useDeferredValue(query)

  const visibleNavigation = useMemo(
    () => navigationItems.filter((item) => user && item.roles.includes(user.role)),
    [user]
  )
  const normalizedGlobalQuery = deferredQuery.trim()
  const pageSearchResults = useMemo<PageSearchResult[]>(
    () =>
      !normalizedGlobalQuery
        ? []
        : visibleNavigation
            .filter((item) => item.label.toLowerCase().includes(normalizedGlobalQuery.toLowerCase()))
            .map((item) => ({
              label: item.label,
              detail: pageSearchDetails[item.label] ?? 'Open this section.',
            })),
    [normalizedGlobalQuery, visibleNavigation]
  )

  useEffect(() => {
    async function loadSession() {
      const token = localStorage.getItem(authTokenKey)
      if (!token) {
        setIsCheckingSession(false)
        return
      }

      try {
        const response = await api.get<UserProfile>('/api/users/me')
        setUser(response.data)
      } catch {
        localStorage.removeItem(authTokenKey)
      } finally {
        setIsCheckingSession(false)
      }
    }

    loadSession()
  }, [])

  useEffect(() => {
    if (!visibleNavigation.length) {
      return
    }
    if (!visibleNavigation.some((item) => item.label === activeView)) {
      const timer = window.setTimeout(() => {
        setActiveView(visibleNavigation[0].label)
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [activeView, visibleNavigation])

  useEffect(() => {
    async function loadGlobalSearch() {
      if (!normalizedGlobalQuery) {
        setGlobalSearchResults([])
        return
      }

      setIsGlobalSearchLoading(true)
      try {
        const response = await listArticles(normalizedGlobalQuery)
        setGlobalSearchResults(response.data)
      } catch {
        setGlobalSearchResults([])
      } finally {
        setIsGlobalSearchLoading(false)
      }
    }

    loadGlobalSearch()
  }, [normalizedGlobalQuery])

  function handleLogout() {
    localStorage.removeItem(authTokenKey)
    setUser(null)
    setPreferredArticleId(null)
  }

  function handleOpenDraft(articleId: string) {
    setPreferredArticleId(articleId)
    setArticleRefreshKey((value) => value + 1)
    setActiveView('AI Draft Builder')
  }

  function handleSearchPageSelect(label: string) {
    setPreferredArticleId(null)
    setActiveView(label)
    setQuery('')
    window.history.replaceState(null, '', '#')
  }

  function handleSearchArticleSelect(article: ArticleListItem) {
    const targetView = articleDestinationView(article.status)
    setPreferredArticleId(article.id)
    setArticleRefreshKey((value) => value + 1)
    setActiveView(targetView)
    setQuery('')
    if (targetView === 'Knowledge Base') {
      window.history.replaceState(null, '', `#knowledge-base/${article.id}`)
      return
    }
    window.history.replaceState(null, '', '#')
  }

  if (isCheckingSession) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="animate-spin" />
      </main>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={setUser} />
  }

  const workspaceProps = {
    user,
    preferredArticleId,
    refreshKey: articleRefreshKey,
    query,
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
        <div
        className={cn(
          'grid min-h-svh transition-[grid-template-columns] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] max-lg:grid-cols-1',
          isSidebarCollapsed ? 'grid-cols-[5.25rem_minmax(0,1fr)]' : 'grid-cols-[18rem_minmax(0,1fr)]'
        )}
      >
        <aside
          className={cn(
            'sticky top-0 grid h-svh grid-rows-[auto_minmax(0,1fr)_auto] gap-6 overflow-hidden border-r border-sidebar-border bg-sidebar py-6 text-sidebar-foreground transition-[padding,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] max-lg:static max-lg:h-auto max-lg:border-b max-lg:border-r-0',
            isSidebarCollapsed ? 'px-3' : 'px-5'
          )}
        >
          <div className={cn('flex items-center gap-3 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]', isSidebarCollapsed && 'justify-center')}>
            <img
              src="/DHL_Logo_BF_rgb.png"
              alt="DHL"
              className={cn('min-w-[48px] rounded-sm transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]', isSidebarCollapsed ? 'w-[52px]' : 'w-[96px] min-w-[84px]')}
            />
            <div
              aria-hidden={isSidebarCollapsed}
              className={cn(
                'min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-out',
                isSidebarCollapsed ? 'max-w-0 translate-x-1 opacity-0' : 'max-w-44 translate-x-0 opacity-100'
              )}
            >
              <p className="text-xs font-medium uppercase text-sidebar-foreground/55">KnowledgeOps AI</p>
              <h1 className="truncate text-lg font-semibold tracking-normal">Control Tower</h1>
            </div>
          </div>

          <nav
            className={cn(
              'flex min-h-0 flex-col gap-1 overflow-y-auto transition-[padding] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
              isSidebarCollapsed ? 'items-center' : 'pr-1'
            )}
            aria-label="Primary"
          >
            {visibleNavigation.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                title={isSidebarCollapsed ? label : undefined}
                aria-label={label}
                onClick={() => setActiveView(label)}
                className={cn(
                  'group flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/70 transition-[width,background-color,color,box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  isSidebarCollapsed && 'w-10 justify-center px-0',
                  !isSidebarCollapsed && 'w-full',
                  activeView === label && 'bg-sidebar-accent text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border'
                )}
              >
                <Icon className="shrink-0 transition-transform duration-300 group-hover:scale-105" />
                <span
                  aria-hidden={isSidebarCollapsed}
                  className={cn(
                    'min-w-0 truncate transition-[max-width,opacity,transform] duration-300 ease-out',
                    isSidebarCollapsed ? 'max-w-0 translate-x-1 opacity-0' : 'max-w-44 translate-x-0 opacity-100'
                  )}
                >
                  {label}
                </span>
              </button>
            ))}
          </nav>

          <div className="flex flex-col gap-3">
            <Button
              type="button"
              variant="outline"
              size={isSidebarCollapsed ? 'icon' : 'default'}
              className={cn(
                'overflow-hidden border-sidebar-border bg-sidebar-accent text-sidebar-foreground transition-[width,background-color,box-shadow,transform] duration-300 ease-out hover:-translate-y-0.5 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                isSidebarCollapsed ? 'mx-auto' : 'justify-start'
              )}
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <span className="transition-transform duration-300">
                {isSidebarCollapsed ? <ChevronRight data-icon="inline-start" /> : <ChevronLeft data-icon="inline-start" />}
              </span>
              <span
                aria-hidden={isSidebarCollapsed}
                className={cn(
                  'truncate transition-[max-width,opacity,transform] duration-300 ease-out',
                  isSidebarCollapsed ? 'max-w-0 translate-x-1 opacity-0' : 'max-w-36 translate-x-0 opacity-100'
                )}
              >
                Minimize sidebar
              </span>
            </Button>
          </div>
        </aside>

        <main className="flex min-w-0 flex-col gap-6 px-6 py-5 max-sm:px-4">
          <header className="flex items-center gap-4 max-md:flex-col max-md:items-stretch">
            <div className="relative flex-1">
              <label className="flex h-12 items-center gap-3 rounded-xl border border-primary/25 bg-card/95 px-4 text-muted-foreground shadow-sm">
                <Search className="text-muted-foreground" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search SOPs, incidents, RPA logs, drafts, and review governance"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </label>
              {normalizedGlobalQuery ? (
                <GlobalSearchDropdown
                  query={normalizedGlobalQuery}
                  isLoading={isGlobalSearchLoading}
                  pageResults={pageSearchResults}
                  articleResults={globalSearchResults}
                  onSelectPage={handleSearchPageSelect}
                  onSelectArticle={handleSearchArticleSelect}
                />
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Notifications">
                <Bell data-icon="inline-start" />
              </Button>
              <Badge variant="outline" className="h-8 px-3 capitalize">
                {user.role}
              </Badge>
              <Button variant="outline" size="icon" aria-label="Sign out" onClick={handleLogout}>
                <LogOut data-icon="inline-start" />
              </Button>
            </div>
          </header>

          {activeView === 'Dashboard' ? <DashboardView user={user} onNavigate={setActiveView} /> : null}
          {activeView === 'Upload Console' ? <UploadConsole onOpenDraft={handleOpenDraft} /> : null}
          {activeView === 'AI Draft Builder' ? <ArticleWorkspace {...workspaceProps} mode="drafts" /> : null}
          {activeView === 'Review Queue' ? <ArticleWorkspace {...workspaceProps} mode="review" /> : null}
          {activeView === 'Knowledge Base' ? <ArticleWorkspace {...workspaceProps} mode="knowledge" /> : null}
          {activeView === 'Version History' ? <ArticleWorkspace {...workspaceProps} mode="versions" /> : null}
          {activeView !== 'Dashboard' &&
          activeView !== 'Upload Console' &&
          activeView !== 'AI Draft Builder' &&
          activeView !== 'Review Queue' &&
          activeView !== 'Knowledge Base' &&
          activeView !== 'Version History' ? (
            <PlaceholderView label={activeView} />
          ) : null}
        </main>
      </div>
    </div>
  )
}

export default App
