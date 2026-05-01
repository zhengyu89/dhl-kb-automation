import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  CloudUpload,
  Database,
  Eye,
  FileClock,
  FileJson2,
  FileSearch,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Tag,
  Workflow,
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
  authTokenKey,
  getArticle,
  getArticleVersions,
  getProcessingStatus,
  listArticles,
  type ArticleDetail,
  type KBArticleDraft,
  type ArticleListItem,
  type ArticleType,
  type ArticleUpdatePayload,
  type ArticleVersionSummary,
  type DraftSourceType,
  type LoginResponse,
  type ProcessingStatus,
  type ProcessingStatusResponse,
  type ResolutionStep,
  updateArticle,
  uploadSourceDocument,
  type UserProfile,
  type UserRole,
} from '@/lib/api'
import { cn } from '@/lib/utils'

type NavigationItem = {
  label: string
  icon: typeof LayoutDashboard
  roles: UserRole[]
}

type ArticleWorkspaceMode = 'drafts' | 'knowledge' | 'versions'

type ArticleFormState = {
  title: string
  summary: string
  article_type: ArticleType
  source_type: DraftSourceType
  applies_to: string
  problem_statement: string
  root_cause: string
  resolution_steps: string
  notes: string
  tags: string
  source_reference: string
  change_note: string
}

const allRoles: UserRole[] = ['admin', 'reviewer', 'editor']
const supportedExtensions = ['txt', 'pdf', 'docx', 'eml', 'msg', 'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp']
const terminalStatuses: ProcessingStatus[] = ['created', 'duplicate', 'failed', 'needs_editor_review']
const articleTypeOptions: ArticleType[] = ['troubleshooting', 'sop', 'checklist', 'faq', 'policy', 'general']

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

const metricCards = [
  {
    label: 'Drafts Ready',
    value: 'Live',
    detail: 'New AI-generated articles now persist into editable KB drafts.',
    icon: Bot,
    tone: 'secondary',
  },
  {
    label: 'Versioning',
    value: 'Tracked',
    detail: 'Each draft save now creates a version snapshot for auditability.',
    icon: History,
    tone: 'outline',
  },
  {
    label: 'Review Guardrail',
    value: 'On',
    detail: 'OCR-heavy or low-confidence sources stay clearly marked for editors.',
    icon: ShieldAlert,
    tone: 'outline',
  },
]

function formatDate(value: string | null | undefined) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleString()
}

function splitCsv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function stepsToText(steps: ResolutionStep[]) {
  return steps.map((step) => step.instruction).join('\n')
}

function textToSteps(value: string): ResolutionStep[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((instruction, index) => ({
      step_no: index + 1,
      instruction,
    }))
}

function articleToFormState(article: ArticleDetail): ArticleFormState {
  const draft = article.structured_content
  return {
    title: draft.title,
    summary: draft.summary,
    article_type: draft.article_type,
    source_type: draft.source_type,
    applies_to: draft.applies_to.join(', '),
    problem_statement: draft.problem_statement ?? '',
    root_cause: draft.root_cause ?? '',
    resolution_steps: stepsToText(draft.resolution_steps),
    notes: draft.notes.join(', '),
    tags: draft.tags.join(', '),
    source_reference: draft.source_reference,
    change_note: '',
  }
}

function buildUpdatePayload(form: ArticleFormState, existingDraft: KBArticleDraft): ArticleUpdatePayload {
  return {
    ...existingDraft,
    title: form.title.trim(),
    summary: form.summary.trim(),
    article_type: form.article_type,
    source_type: form.source_type,
    applies_to: splitCsv(form.applies_to),
    problem_statement: form.problem_statement.trim() || null,
    root_cause: form.root_cause.trim() || null,
    resolution_steps: textToSteps(form.resolution_steps),
    notes: splitCsv(form.notes),
    tags: splitCsv(form.tags),
    source_reference: form.source_reference.trim(),
    change_note: form.change_note.trim() || null,
  }
}

function articleStatusVariant(status: string): 'secondary' | 'outline' | 'destructive' {
  if (status === 'failed' || status === 'rejected') {
    return 'destructive'
  }
  if (status === 'needs_editor_review' || status === 'draft' || status === 'submitted') {
    return 'secondary'
  }
  return 'outline'
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ')
}

function LoginScreen({
  onLogin,
}: {
  onLogin: (token: string, profile: UserProfile) => void
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
      onLogin(response.data.access_token, response.data.user)
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
          <CardDescription>Sign in with your assigned role ID and password.</CardDescription>
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
          <div className="mt-5 grid gap-2 text-xs text-muted-foreground">
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
  return (
    <>
      <section className="flex items-start justify-between gap-4 max-xl:flex-col">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              <Sparkles data-icon="inline-start" />
              Modules 4 + 5
            </Badge>
            <Badge variant="outline">{user.full_name}</Badge>
          </div>
          <h2 className="mt-4 text-3xl font-semibold tracking-normal text-foreground max-sm:text-2xl">
            Structured article generation is now part of the live workflow
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Uploads can now become real KB drafts with structured JSON, version history,
            and editable article records instead of stopping at a temporary preview.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {user.role !== 'reviewer' ? (
            <Button onClick={() => onNavigate('Upload Console')}>
              <CloudUpload data-icon="inline-start" />
              Launch Upload Console
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onNavigate('Knowledge Base')}>
            <BookOpen data-icon="inline-start" />
            Open Knowledge Base
          </Button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {metricCards.map((item) => (
          <Card key={item.label} className="bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">{item.label}</CardTitle>
              <CardAction>
                <div className="flex size-9 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <item.icon />
                </div>
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="text-3xl font-semibold tracking-normal">{item.value}</div>
              <p className="text-sm leading-6 text-muted-foreground">{item.detail}</p>
              <Badge variant={item.tone === 'secondary' ? 'secondary' : 'outline'} className="w-fit">
                Ready
              </Badge>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity />
            What changed
          </CardTitle>
          <CardDescription>Module 4 and 5 are wired through the current app shell.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border bg-background p-4">
            <p className="text-sm font-medium">AI generation</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Extracted source text is validated against a structured article schema with retry-aware generation handling.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-sm font-medium">Article persistence</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Successful drafts now create article records, tag links, source links, and initial version snapshots.
            </p>
          </div>
          <div className="rounded-xl border bg-background p-4">
            <p className="text-sm font-medium">Draft editor</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Editors can open a draft, update structured fields, save changes, and inspect version history inside the frontend.
            </p>
          </div>
        </CardContent>
      </Card>
    </>
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
    } catch (error: any) {
      setClientError(error?.response?.data?.detail ?? 'Upload failed. Check the backend server and try again.')
    } finally {
      setIsUploading(false)
    }
  }

  const status = processing?.processing_status ?? 'pending'
  const isFinished = processing ? terminalStatuses.includes(processing.processing_status) : false

  return (
    <div className="grid gap-5">
      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden border-none bg-[linear-gradient(135deg,rgba(255,204,0,0.16),rgba(255,255,255,1)_48%,rgba(207,30,37,0.08))] shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CloudUpload />
              Upload And Source Intake
            </CardTitle>
            <CardDescription>
              Upload a messy source file, track extraction, and open the generated article draft once Module 4 completes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <label className="grid gap-2 text-sm font-medium">
                Source file
                <div className="rounded-xl border border-dashed border-border/90 bg-card/80 p-5">
                  <input type="file" onChange={handleFileChange} className="block w-full text-sm" />
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">
                    Supported inputs: {supportedExtensions.join(', ')}.
                  </p>
                </div>
              </label>
              {selectedFile ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/70 px-3 py-2 text-sm">
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
            <CardDescription>Live state from the backend processing record.</CardDescription>
            <CardAction>
              <Badge variant={articleStatusVariant(status)} className="capitalize">
                {statusLabel(status)}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="text-muted-foreground">Current stage</span>
                <span className="font-medium">{processing?.processing_stage ?? 'waiting for upload'}</span>
              </div>
              <div className="mt-4">
                <Progress
                  value={
                    !processing
                      ? 0
                      : processing.processing_status === 'pending'
                        ? 10
                        : processing.processing_status === 'processing'
                          ? 55
                          : 100
                  }
                />
              </div>
            </div>

            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm">
                <span className="text-muted-foreground">Source type</span>
                <span className="font-medium capitalize">
                  {processing?.source_document.source_type?.replaceAll('_', ' ') ?? 'Pending'}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm">
                <span className="text-muted-foreground">Editor review</span>
                <Badge variant={processing?.source_document.requires_editor_review ? 'secondary' : 'outline'}>
                  {processing?.source_document.requires_editor_review ? 'Required' : 'Not required'}
                </Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm">
                <span className="text-muted-foreground">Article created</span>
                <Badge variant={processing?.article ? 'outline' : 'secondary'}>
                  {processing?.article ? 'Yes' : 'Pending'}
                </Badge>
              </div>
            </div>

            {processing?.ocr_result ? (
              <div className="rounded-xl border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">OCR result</p>
                    <p className="mt-1 text-xs text-muted-foreground">{processing.ocr_result.engine}</p>
                  </div>
                  <Badge variant={processing.ocr_result.is_low_confidence ? 'secondary' : 'outline'}>
                    Confidence {processing.ocr_result.average_confidence?.toFixed(2) ?? 'n/a'}
                  </Badge>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">{processing.ocr_result.model_name}</p>
              </div>
            ) : null}

            {processing?.source_document.processing_error ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {processing.source_document.processing_error}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSearch />
              Extracted Content
            </CardTitle>
            <CardDescription>Raw and normalized text captured before article generation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Raw text</p>
              <pre className="max-h-64 overflow-auto rounded-xl border bg-background p-4 text-xs leading-6 text-foreground whitespace-pre-wrap">
                {processing?.source_document.raw_text ?? 'The backend will populate this once extraction begins.'}
              </pre>
            </div>
            <div className="grid gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Normalized extracted text</p>
              <pre className="max-h-64 overflow-auto rounded-xl border bg-background p-4 text-xs leading-6 text-foreground whitespace-pre-wrap">
                {processing?.source_document.extracted_text ?? 'Normalized text appears here after processing.'}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileJson2 />
              Structured Article
            </CardTitle>
            <CardDescription>Validated article JSON now stored in the KB draft table.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-xl border bg-background p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{processing?.article?.title ?? 'Awaiting result'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {processing?.article?.article_type ?? 'draft'} from {processing?.article?.source_references?.[0] ?? 'source file'}
                  </p>
                </div>
                {processing?.article ? (
                  <Badge variant="outline">v{processing.article.current_version_no}</Badge>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {processing?.article?.summary ?? 'The generated article becomes available here once AI validation completes.'}
              </p>
            </div>

            <pre className="max-h-80 overflow-auto rounded-xl border bg-background p-4 text-xs leading-6 text-foreground whitespace-pre-wrap">
              {processing?.article ? JSON.stringify(processing.article.structured_content, null, 2) : 'No structured article yet.'}
            </pre>

            {processing?.article ? (
              <Button onClick={() => onOpenDraft(processing.article!.id)}>
                <Eye data-icon="inline-start" />
                Open Draft In Builder
              </Button>
            ) : null}

            {isFinished ? (
              <div className="rounded-xl border bg-secondary/10 p-4 text-sm text-foreground">
                Processing finished with status <span className="font-medium">{statusLabel(status)}</span>.
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function ArticleWorkspace({
  user,
  mode,
  preferredArticleId,
  refreshKey,
}: {
  user: UserProfile
  mode: ArticleWorkspaceMode
  preferredArticleId: string | null
  refreshKey: number
}) {
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [articles, setArticles] = useState<ArticleListItem[]>([])
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(preferredArticleId)
  const [article, setArticle] = useState<ArticleDetail | null>(null)
  const [versions, setVersions] = useState<ArticleVersionSummary[]>([])
  const [form, setForm] = useState<ArticleFormState | null>(null)
  const [listError, setListError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [saveMessage, setSaveMessage] = useState('')
  const [isLoadingList, setIsLoadingList] = useState(false)
  const [isLoadingArticle, setIsLoadingArticle] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const canEdit = user.role === 'editor' || user.role === 'admin'

  useEffect(() => {
    let ignore = false
    setIsLoadingList(true)
    setListError('')

    listArticles(deferredSearch)
      .then((response) => {
        if (ignore) {
          return
        }
        setArticles(response.data)
        if (preferredArticleId && response.data.some((item) => item.id === preferredArticleId)) {
          setSelectedArticleId(preferredArticleId)
          return
        }
        if (!selectedArticleId && response.data[0]) {
          setSelectedArticleId(response.data[0].id)
        }
        if (
          selectedArticleId &&
          response.data.length > 0 &&
          !response.data.some((item) => item.id === selectedArticleId)
        ) {
          setSelectedArticleId(response.data[0].id)
        }
      })
      .catch(() => {
        if (!ignore) {
          setListError('Unable to load article records right now.')
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingList(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [deferredSearch, preferredArticleId, refreshKey, selectedArticleId])

  useEffect(() => {
    if (!selectedArticleId) {
      setArticle(null)
      setVersions([])
      setForm(null)
      return
    }

    let ignore = false
    setIsLoadingArticle(true)
    setDetailError('')
    setSaveMessage('')

    Promise.all([getArticle(selectedArticleId), getArticleVersions(selectedArticleId)])
      .then(([articleResponse, versionResponse]) => {
        if (ignore) {
          return
        }
        setArticle(articleResponse.data)
        setVersions(versionResponse.data)
        setForm(articleToFormState(articleResponse.data))
      })
      .catch(() => {
        if (!ignore) {
          setDetailError('Unable to load the selected article.')
        }
      })
      .finally(() => {
        if (!ignore) {
          setIsLoadingArticle(false)
        }
      })

    return () => {
      ignore = true
    }
  }, [selectedArticleId, refreshKey])

  function updateFormField<K extends keyof ArticleFormState>(key: K, value: ArticleFormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current))
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!article || !form) {
      return
    }

    setIsSaving(true)
    setDetailError('')
    setSaveMessage('')

    try {
      const payload = buildUpdatePayload(form, article.structured_content)
      const response = await updateArticle(article.id, payload)
      setArticle(response.data)
      setForm(articleToFormState(response.data))
      const versionsResponse = await getArticleVersions(article.id)
      setVersions(versionsResponse.data)
      setSaveMessage('Draft saved and version history updated.')
    } catch (error: any) {
      setDetailError(error?.response?.data?.detail ?? 'Unable to save this draft right now.')
    } finally {
      setIsSaving(false)
    }
  }

  const headerTitle =
    mode === 'drafts' ? 'AI Draft Builder' : mode === 'versions' ? 'Version History' : 'Knowledge Base'
  const headerDescription =
    mode === 'drafts'
      ? 'Edit the structured article fields created by the Module 4 pipeline.'
      : mode === 'versions'
        ? 'Inspect version snapshots created each time a draft is saved.'
        : 'Browse the current stored article records and their structured content.'

  return (
    <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock />
            {headerTitle}
          </CardTitle>
          <CardDescription>{headerDescription}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label className="flex h-11 items-center gap-3 rounded-lg border bg-background px-3 text-muted-foreground">
            <Search />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, summary, or type"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            />
          </label>
          {listError ? <p className="text-sm text-destructive">{listError}</p> : null}
          <div className="grid max-h-[70vh] gap-3 overflow-auto pr-1">
            {isLoadingList ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Loading article records...
              </div>
            ) : null}
            {!isLoadingList && articles.length === 0 ? (
              <div className="rounded-xl border bg-background p-4 text-sm text-muted-foreground">
                No articles found yet. Upload a source file to create the first draft.
              </div>
            ) : null}
            {articles.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedArticleId(item.id)}
                className={cn(
                  'grid gap-3 rounded-xl border bg-background p-4 text-left transition-colors hover:border-foreground/20',
                  selectedArticleId === item.id && 'border-foreground/30 shadow-sm'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.article_type} · updated {formatDate(item.updated_at)}
                    </p>
                  </div>
                  <Badge variant={articleStatusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  {item.summary ?? 'No summary stored yet.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">v{item.current_version_no}</Badge>
                  {item.requires_editor_review ? <Badge variant="secondary">editor review</Badge> : null}
                  {item.tags.slice(0, 2).map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5">
        <Card className="bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {mode === 'versions' ? <History /> : mode === 'knowledge' ? <BookOpen /> : <Bot />}
              {article?.title ?? 'Select an article'}
            </CardTitle>
            <CardDescription>
              {article
                ? `Status: ${statusLabel(article.status)} · current version ${article.current_version_no}`
                : 'Choose an article from the list to inspect it here.'}
            </CardDescription>
            <CardAction>
              {article ? (
                <Badge variant={articleStatusVariant(article.status)}>{statusLabel(article.status)}</Badge>
              ) : null}
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            {detailError ? <p className="text-sm text-destructive">{detailError}</p> : null}
            {isLoadingArticle ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" />
                Loading article details...
              </div>
            ) : null}
            {!isLoadingArticle && !article ? (
              <div className="rounded-xl border bg-background p-5 text-sm text-muted-foreground">
                No article selected yet.
              </div>
            ) : null}

            {article ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border bg-background p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Source</p>
                    <p className="mt-2 text-sm font-medium">{article.source_references[0] ?? 'n/a'}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Created via</p>
                    <p className="mt-2 text-sm font-medium">{statusLabel(article.created_via)}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Updated</p>
                    <p className="mt-2 text-sm font-medium">{formatDate(article.updated_at)}</p>
                  </div>
                  <div className="rounded-xl border bg-background p-4">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Review flag</p>
                    <p className="mt-2 text-sm font-medium">
                      {article.requires_editor_review ? 'Editor review required' : 'Clear'}
                    </p>
                  </div>
                </div>

                {mode === 'drafts' && canEdit && form ? (
                  <form className="grid gap-4" onSubmit={handleSave}>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium">
                        Title
                        <input
                          value={form.title}
                          onChange={(event) => updateFormField('title', event.target.value)}
                          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Article type
                        <select
                          value={form.article_type}
                          onChange={(event) => updateFormField('article_type', event.target.value as ArticleType)}
                          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {articleTypeOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="grid gap-2 text-sm font-medium">
                      Summary
                      <textarea
                        value={form.summary}
                        onChange={(event) => updateFormField('summary', event.target.value)}
                        className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>

                    <label className="grid gap-2 text-sm font-medium">
                      Problem statement
                      <textarea
                        value={form.problem_statement}
                        onChange={(event) => updateFormField('problem_statement', event.target.value)}
                        className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </label>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium">
                        Applies to
                        <input
                          value={form.applies_to}
                          onChange={(event) => updateFormField('applies_to', event.target.value)}
                          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Comma separated"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Root cause
                        <input
                          value={form.root_cause}
                          onChange={(event) => updateFormField('root_cause', event.target.value)}
                          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </label>
                    </div>

                    <label className="grid gap-2 text-sm font-medium">
                      Resolution steps
                      <textarea
                        value={form.resolution_steps}
                        onChange={(event) => updateFormField('resolution_steps', event.target.value)}
                        className="min-h-40 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="One step per line"
                      />
                    </label>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="grid gap-2 text-sm font-medium">
                        Draft source type
                        <div className="flex h-10 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                          {form.source_type.replaceAll('_', ' ')}
                        </div>
                      </div>
                      <label className="grid gap-2 text-sm font-medium">
                        Notes
                        <textarea
                          value={form.notes}
                          onChange={(event) => updateFormField('notes', event.target.value)}
                          className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Comma separated notes"
                        />
                      </label>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium">
                        Tags
                        <input
                          value={form.tags}
                          onChange={(event) => updateFormField('tags', event.target.value)}
                          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          placeholder="Comma separated tags"
                        />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Source reference
                        <input
                          value={form.source_reference}
                          onChange={(event) => updateFormField('source_reference', event.target.value)}
                          className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      </label>
                    </div>

                    <label className="grid gap-2 text-sm font-medium">
                      Change note
                      <input
                        value={form.change_note}
                        onChange={(event) => updateFormField('change_note', event.target.value)}
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        placeholder="What changed in this revision?"
                      />
                    </label>

                    {saveMessage ? <p className="text-sm text-emerald-700">{saveMessage}</p> : null}

                    <div className="flex flex-wrap items-center gap-3">
                      <Button disabled={isSaving}>
                        {isSaving ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Save data-icon="inline-start" />}
                        Save Draft
                      </Button>
                      <Badge variant="outline">Saving creates a new version entry</Badge>
                    </div>
                  </form>
                ) : (
                  <div className="grid gap-4">
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-sm font-medium">Summary</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{article.summary}</p>
                    </div>
                    <div className="rounded-xl border bg-background p-4">
                      <p className="text-sm font-medium">Structured content</p>
                      <pre className="mt-3 max-h-[28rem] overflow-auto text-xs leading-6 text-foreground whitespace-pre-wrap">
                        {JSON.stringify(article.structured_content, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </CardContent>
        </Card>

        {mode === 'versions' && article ? (
          <Card className="bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History />
                Version snapshots
              </CardTitle>
              <CardDescription>Newest revisions appear first.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {versions.map((version) => (
                <div key={version.id} className="rounded-xl border bg-background p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Version {version.version_no}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{formatDate(version.created_at)}</p>
                    </div>
                    <Badge variant={articleStatusVariant(version.status_snapshot)}>
                      {statusLabel(version.status_snapshot)}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {version.change_note ?? 'No change note provided.'}
                  </p>
                  <pre className="mt-3 max-h-64 overflow-auto rounded-lg border bg-card p-3 text-xs leading-6 whitespace-pre-wrap">
                    {JSON.stringify(version.structured_content, null, 2)}
                  </pre>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {mode !== 'versions' && article ? (
          <Card className="bg-card shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag />
                Article tags and versions
              </CardTitle>
              <CardDescription>Quick metadata alongside the current version trail.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {article.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
                {article.tags.length === 0 ? <p className="text-sm text-muted-foreground">No tags stored.</p> : null}
              </div>
              <Separator />
              <div className="grid gap-3">
                {versions.slice(0, 3).map((version) => (
                  <div key={version.id} className="rounded-xl border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">Version {version.version_no}</p>
                      <Badge variant="outline">{formatDate(version.created_at)}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {version.change_note ?? 'No change note provided.'}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function PlaceholderView({ label }: { label: string }) {
  return (
    <Card className="bg-card shadow-sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardDescription>This area is still using the dashboard shell until its module is implemented.</CardDescription>
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

  const visibleNavigation = useMemo(
    () => navigationItems.filter((item) => user && item.roles.includes(user.role)),
    [user]
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
      setActiveView(visibleNavigation[0].label)
    }
  }, [activeView, visibleNavigation])

  function handleLogout() {
    localStorage.removeItem(authTokenKey)
    setUser(null)
  }

  function handleOpenDraft(articleId: string) {
    setPreferredArticleId(articleId)
    setArticleRefreshKey((value) => value + 1)
    setActiveView('AI Draft Builder')
  }

  if (isCheckingSession) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="animate-spin" />
      </main>
    )
  }

  if (!user) {
    return <LoginScreen onLogin={(_, profile) => setUser(profile)} />
  }

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="grid min-h-svh grid-cols-[18rem_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="sticky top-0 grid h-svh grid-rows-[auto_minmax(0,1fr)_auto] gap-6 border-r border-sidebar-border bg-sidebar px-5 py-6 text-sidebar-foreground max-lg:static max-lg:h-auto max-lg:border-b max-lg:border-r-0">
          <div className="flex items-center gap-3">
            <img src="/DHL_Logo_BF_rgb.png" alt="DHL" className="w-[96px] min-w-[84px] rounded-sm" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase text-sidebar-foreground/55">KnowledgeOps AI</p>
              <h1 className="truncate text-lg font-semibold tracking-normal">Control Tower</h1>
            </div>
          </div>

          <nav className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1" aria-label="Primary">
            {visibleNavigation.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => setActiveView(label)}
                className={cn(
                  'flex h-10 shrink-0 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  activeView === label && 'bg-sidebar-accent text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border'
                )}
              >
                <Icon />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          <Card className="border-sidebar-border bg-sidebar-accent/70 text-sidebar-foreground ring-sidebar-border">
            <CardHeader>
              <CardTitle className="text-sm">Module Progress</CardTitle>
              <CardDescription className="text-sidebar-foreground/55">
                Upload, extraction, AI generation, draft editing, and version history are connected.
              </CardDescription>
              <CardAction>
                <Badge variant="outline" className="border-sidebar-border text-sidebar-foreground">
                  Expanded
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-3">
                <span className="text-3xl font-semibold tracking-normal">5 / 12</span>
                <CheckCircle2 className="text-sidebar-foreground/55" />
              </div>
              <Progress value={42} className="bg-sidebar-border" />
            </CardContent>
          </Card>
        </aside>

        <main className="flex min-w-0 flex-col gap-6 px-6 py-5 max-sm:px-4">
          <header className="flex items-center gap-4 max-md:flex-col max-md:items-stretch">
            <label className="flex h-11 flex-1 items-center gap-3 rounded-lg border bg-card px-3 text-muted-foreground shadow-sm">
              <Search />
              <input
                type="search"
                placeholder="Search articles, uploads, and version history"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
            </label>

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
          {activeView === 'AI Draft Builder' ? (
            <ArticleWorkspace
              user={user}
              mode="drafts"
              preferredArticleId={preferredArticleId}
              refreshKey={articleRefreshKey}
            />
          ) : null}
          {activeView === 'Knowledge Base' ? (
            <ArticleWorkspace
              user={user}
              mode="knowledge"
              preferredArticleId={preferredArticleId}
              refreshKey={articleRefreshKey}
            />
          ) : null}
          {activeView === 'Version History' ? (
            <ArticleWorkspace
              user={user}
              mode="versions"
              preferredArticleId={preferredArticleId}
              refreshKey={articleRefreshKey}
            />
          ) : null}
          {activeView !== 'Dashboard' &&
          activeView !== 'Upload Console' &&
          activeView !== 'AI Draft Builder' &&
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
