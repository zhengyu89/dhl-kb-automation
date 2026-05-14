import axios from 'axios'

export type UserRole = 'admin' | 'reviewer' | 'editor'
export type ProcessingStatus =
  | 'pending'
  | 'processing'
  | 'created'
  | 'duplicate'
  | 'failed'
  | 'needs_editor_review'
export type SourceType =
  | 'text'
  | 'pdf'
  | 'docx'
  | 'email'
  | 'image'
  | 'chat_screenshot'
  | 'rpa_import'
export type DraftSourceType = 'text' | 'email' | 'image' | 'pdf' | 'docx' | 'unknown'
export type ArticleStatus =
  | 'draft'
  | 'submitted'
  | 'rpa_submitted'
  | 'reviewed'
  | 'published'
  | 'rejected'
  | 'archived'
export type ArticleKind = 'sop' | 'article'

export type UserProfile = {
  id: string
  login_id: string
  full_name: string
  email: string
  role: UserRole
}

export type LoginResponse = {
  access_token: string
  token_type: 'bearer'
  user: UserProfile
}

export type UploadResponse = {
  processing_id: string
  processing_status: ProcessingStatus
  processing_stage: string
}

export type SourceDocumentSummary = {
  id: string
  original_filename: string
  source_type: SourceType
  mime_type: string | null
  processing_status: ProcessingStatus
  processing_stage: string
  requires_editor_review: boolean
  raw_text: string | null
  extracted_text: string | null
  content_hash: string | null
  file_hash: string | null
  duplicate_of_source_id: string | null
  processing_error: string | null
  created_at: string
  processed_at: string | null
}

export type OCRResultSummary = {
  engine: string
  model_name: string | null
  average_confidence: number | null
  is_low_confidence: boolean
  extracted_text: string
}

export type ArticleStep = {
  step_no: number
  instruction: string
}

export type ArticleSection = {
  heading: string
  content: string
}

export type KBArticleDraft = {
  schema_version: '1.0'
  title: string
  kind: ArticleKind
  summary: string
  description: string
  steps: ArticleStep[]
  sections: ArticleSection[]
  keywords: string[]
  source_reference: string
  source_type: DraftSourceType
  requires_editor_review: boolean
}

export type DraftPreview = {
  title: string
  summary: string
  kind: ArticleKind
  source_reference: string
  extracted_text_preview: string
  keywords: string[]
  steps: ArticleStep[]
}

export type AttachmentSummary = {
  id: string
  file_name: string
  mime_type: string | null
  storage_path: string
  created_at: string
}

export type ArticleListItem = {
  id: string
  title: string
  summary: string | null
  kind: ArticleKind
  status: ArticleStatus
  created_via: string
  requires_editor_review: boolean
  current_version_no: number
  source_references: string[]
  keywords: string[]
  created_at: string
  updated_at: string
}

export type ArticleDetail = {
  id: string
  title: string
  summary: string | null
  kind: ArticleKind
  status: ArticleStatus
  created_via: string
  requires_editor_review: boolean
  current_version_no: number
  description: string | null
  steps: ArticleStep[]
  sections: ArticleSection[]
  structured_content: KBArticleDraft
  source_references: string[]
  keywords: string[]
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export type ArticleVersionSummary = {
  id: string
  version_no: number
  title: string
  summary: string | null
  status_snapshot: ArticleStatus
  change_note: string | null
  created_by: string | null
  created_at: string
  structured_content: KBArticleDraft
}

export type ArticleUpdatePayload = KBArticleDraft & {
  change_note?: string | null
}

export type ArticleStatusTransitionPayload = {
  change_note?: string | null
}

export type ProcessingStatusResponse = {
  processing_id: string
  processing_status: ProcessingStatus
  processing_stage: string
  source_document: SourceDocumentSummary
  attachment: AttachmentSummary | null
  ocr_result: OCRResultSummary | null
  generated_draft: DraftPreview | null
  article: ArticleDetail | null
}

export const authTokenKey = 'dhl-kb-auth-token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:8000',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(authTokenKey)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export function uploadSourceDocument(file: File) {
  const formData = new FormData()
  formData.append('file', file)
  return api.post<UploadResponse>('/api/uploads', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

export function getProcessingStatus(processingId: string) {
  return api.get<ProcessingStatusResponse>(`/api/processing/${processingId}`)
}

export function listArticles(query?: string) {
  return api.get<ArticleListItem[]>('/api/articles', {
    params: query ? { q: query } : undefined,
  })
}

export function getArticle(articleId: string) {
  return api.get<ArticleDetail>(`/api/articles/${articleId}`)
}

export function updateArticle(articleId: string, payload: ArticleUpdatePayload) {
  return api.patch<ArticleDetail>(`/api/articles/${articleId}`, payload)
}

export function deleteArticle(articleId: string) {
  return api.delete(`/api/articles/${articleId}`)
}

export function submitArticleForReview(articleId: string, payload?: ArticleStatusTransitionPayload) {
  return api.post<ArticleDetail>(`/api/articles/${articleId}/submit-review`, payload ?? {})
}

export function approveArticle(articleId: string, payload?: ArticleStatusTransitionPayload) {
  return api.post<ArticleDetail>(`/api/articles/${articleId}/approve`, payload ?? {})
}

export function publishArticle(articleId: string, payload?: ArticleStatusTransitionPayload) {
  return api.post<ArticleDetail>(`/api/articles/${articleId}/publish`, payload ?? {})
}

export function rejectArticle(articleId: string, payload?: ArticleStatusTransitionPayload) {
  return api.post<ArticleDetail>(`/api/articles/${articleId}/reject`, payload ?? {})
}

export function requestArticleChanges(articleId: string, payload?: ArticleStatusTransitionPayload) {
  return api.post<ArticleDetail>(`/api/articles/${articleId}/request-changes`, payload ?? {})
}

export function getArticleVersions(articleId: string) {
  return api.get<ArticleVersionSummary[]>(`/api/articles/${articleId}/versions`)
}
