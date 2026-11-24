export type LinkStatus =
  | "PENDING"
  | "QUEUED"
  | "PROCESSING"
  | "ENRICHING"
  | "INDEXING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "NEEDS_REVIEW";

export const ACTIVE: LinkStatus[] = ["PENDING", "QUEUED", "PROCESSING", "ENRICHING", "INDEXING"];

export interface GithubSummary {
  full_name?: string;
  stars?: number;
  forks?: number;
  language?: string;
  license?: string | null;
  archived?: boolean;
  pushed_at?: string;
  latest_release?: { tag?: string; name?: string; published_at?: string } | null;
  languages?: Record<string, number>;
  topics?: string[];
  homepage?: string | null;
  open_issues?: number;
}

export interface LinkCard {
  id: string;
  url: string;
  normalized_url: string;
  domain: string;
  name: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string[];
  content_type: string | null;
  status: LinkStatus;
  status_detail: string | null;
  is_favorite: boolean;
  availability: "unknown" | "up" | "down" | "redirected";
  has_free_plan: boolean | null;
  is_open_source: boolean | null;
  favicon: string | null;
  thumbnail: string | null;
  duplicate_of_id: string | null;
  created_at: string;
  updated_at: string;
  github: GithubSummary | null;
}

export interface Feature {
  name: string;
  evidence?: string | null;
  verified?: boolean;
}

export interface Enrichment {
  name?: string;
  short_description?: string;
  tldr?: string;
  content_type?: string;
  category?: string | null;
  subcategory?: string | null;
  problems_solved?: string[];
  target_audience?: string[];
  key_features?: Feature[];
  tags?: string[];
  usage?: {
    use_for?: string | null;
    when_to_use?: string | null;
    who_should_use?: string | null;
    differentiators?: string | null;
    limitations?: string | null;
  };
  pricing?: {
    free_plan?: boolean | null;
    free_trial?: boolean | null;
    paid_plans?: boolean | null;
    starting_price?: string | null;
    pricing_url?: string | null;
    evidence?: string | null;
    verified?: boolean;
    checked_at?: string;
    discarded_unverified?: boolean;
  };
  is_open_source?: boolean | null;
  alternatives?: { name: string; reason?: string | null; verified?: boolean }[];
  confidence?: number;
  unknowns?: string[];
  source?: "llm" | "extractive";
}

export interface LinkDetail extends LinkCard {
  tldr: string | null;
  final_url: string | null;
  canonical_url: string | null;
  screenshot: string | null;
  image_url: string | null;
  notes: string | null;
  overrides: Record<string, unknown>;
  http_status: number | null;
  last_checked_at: string | null;
  last_processed_at: string | null;
  ai: {
    provider: string;
    model: string;
    created_at: string;
    data: Enrichment;
    tokens_in: number;
    tokens_out: number;
  } | null;
  extraction: {
    method: string;
    partial: boolean;
    http_status: number | null;
    meta: Record<string, unknown> & { redirects?: string[]; notes?: string[] };
    headings: string[];
    tech_stack: string[];
    text_length: number;
    created_at: string;
  } | null;
  markdown: string | null;
  snippets: Snippet[];
  collections: { id: string; name: string }[];
  logs: { stage: string; level: string; message: string; data: Record<string, unknown> | null; created_at: string }[];
  last_error: string | null;
}

export interface Snippet {
  id: string;
  link_id: string;
  language: string | null;
  code: string;
  context: string | null;
  link_name?: string | null;
}

export interface PreviewItem {
  input: string;
  normalized_url: string | null;
  valid: boolean;
  error: string | null;
  duplicate_of: string | null;
  duplicate_in_batch: boolean;
}

export interface Facet {
  name: string;
  count: number;
  children: Facet[];
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  rules: SmartRules | null;
  is_smart: boolean;
  link_count: number;
  created_at: string;
}

export interface SmartRules {
  query?: string | null;
  category?: string | null;
  subcategory?: string | null;
  tags?: string[];
  domain?: string | null;
  free_plan?: boolean | null;
  open_source?: boolean | null;
  content_type?: string | null;
}

export interface Suggestion {
  type: "smart_collection" | "duplicates" | "retry_failed";
  message: string;
  count: number;
  name?: string;
  rules?: SmartRules;
}

export interface AIStatus {
  provider: string;
  configured: boolean;
  fast_model: string | null;
  smart_model: string | null;
  missing: string | null;
}

export interface Stats {
  total: number;
  completed: number;
  in_progress: number;
  failed: number;
  blocked: number;
  needs_review: number;
  favorites: number;
  by_status: Record<string, number>;
  categories: Facet[];
  top_tags: Facet[];
  recent: LinkCard[];
  recently_accessed: LinkCard[];
  suggestions: Suggestion[];
  ai: AIStatus;
  tokens: Record<string, { analyses: number; input: number; output: number }>;
}

export interface SearchResult {
  link: LinkCard;
  score: number;
  similarity: number | null;
  reasons: string[];
}
