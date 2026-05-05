
export interface VersionFeedback {
  category: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  keyword: string;
  details?: string;
}

export interface EvidenceSource {
  label: string;
  url: string;
  type: 'release' | 'issue' | 'npm' | 'security' | 'search';
}

export interface FeedbackDiagnostics {
  gatewayReports: number;
  pluginReports: number;
  crashOrHangReports: number;
  securityReports: number;
}

export interface VersionInfo {
  version: string;
  releaseDate: string;
  publishedAt?: string;
  isLatest: boolean;
  score: number; // 0-100
  rank: number;
  rankTrend: 'up' | 'down' | 'stable' | 'new';
  recommendationIndex: number; // 0-100
  diagnostics: FeedbackDiagnostics;
  errorKeywords: string[];
  positiveKeywords: string[];
  upgradePros: string[];
  upgradeCons: string[];
  voteRecommend: number;
  voteNotRecommend: number;
  sampleCount: number;
  issueCount: number;
  openIssueCount: number;
  closedIssueCount: number;
  positiveSignalCount: number;
  negativeSignalCount: number;
  confidence: 'high' | 'medium' | 'low';
  scoringBasis: string;
  sources: EvidenceSource[];
}

export interface RankingState {
  lastUpdated: string;
  versions: VersionInfo[];
}
