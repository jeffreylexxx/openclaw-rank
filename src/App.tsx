import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ThumbsUp, 
  ThumbsDown, 
  AlertCircle, 
  ExternalLink
} from 'lucide-react';
import { VersionInfo } from './types.ts';
import { fetchAndAnalyzeVersions } from './services/realDataService.ts';
import { voteForVersion, subscribeToVotes, getStoredRankingHistory, saveRankingHistory } from './services/firebaseService.ts';

export default function App() {
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [votes, setVotes] = useState<Record<string, { recommend: number, notRecommend: number }>>({});
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);

  const loadData = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const history = await getStoredRankingHistory();
      const freshData = await fetchAndAnalyzeVersions(history as any); 
      setVersions(freshData);
      setLastSynced(new Date().toISOString());
      await saveRankingHistory(freshData);
    } catch (error) {
      console.error(error);
      setError(error instanceof Error ? error.message : 'Unable to load public OpenClaw evidence.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = subscribeToVotes((newVotes) => {
      setVotes(newVotes);
    });
    return () => unsubscribe();
  }, []);

  const handleVote = async (version: string, type: 'recommend' | 'notRecommend') => {
    await voteForVersion(version, type);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-300 font-sans p-4 md:p-8 flex flex-col border-[6px] md:border-[12px] border-zinc-950">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 border-b border-zinc-800 pb-6 gap-4">
        <div>
          <h1 className="text-4xl md:text-5xl font-extralight tracking-tight text-white mb-2">
            OPENCLAW <span className="text-zinc-600 font-serif-italic">Version Index</span>
          </h1>
          <p className="text-[10px] md:text-[11px] uppercase tracking-[0.3em] text-zinc-500 font-bold">
            Public GitHub Issues, Release Reactions, and npm Registry Signals
          </p>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          <div className="flex items-center justify-end gap-2">
            <span className={`w-2 h-2 rounded-full ${loading ? 'bg-orange-500 animate-pulse' : 'bg-emerald-500'}`}></span>
            <span className="text-[10px] font-mono text-zinc-400 tracking-widest uppercase">
              {loading ? 'Fetching Public Sources...' : 'Public Sources Synced'}
            </span>
          </div>
          <div className="text-[10px] font-mono text-zinc-600 uppercase">
            LAST SYNC: {lastSynced ? lastSynced.replace('T', ' ').slice(0, 19) : 'Pending'}
          </div>
          <button 
            onClick={() => loadData(true)}
            className="text-[10px] text-emerald-500/70 hover:text-emerald-400 underline decoration-emerald-500/30 transition-colors uppercase tracking-widest font-bold"
          >
            Refresh Evidence From Network
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-rose-900/40 bg-rose-950/20 px-4 py-3 text-xs text-rose-300">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Formal Releases Ranked" value={versions.length > 0 ? versions.length.toString() : '--'} />
        <StatCard label="Mean Evidence Score" value={versions.length > 0 ? (versions.reduce((acc, v) => acc + v.score, 0) / versions.length).toFixed(2) : '--'} />
        <StatCard label="GitHub Issues / Refs" value={versions.reduce((acc, v) => acc + v.issueCount, 0).toLocaleString()} color="text-rose-500" />
        <StatCard label="Evidence Items" value={versions.reduce((acc, v) => acc + (v.sampleCount || 0), 0).toLocaleString()} />
      </div>

      {/* Main Ranking Table */}
      <div className="flex-1 flex flex-col bg-zinc-900/20 border border-zinc-800 rounded-xl overflow-hidden backdrop-blur-sm">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-4 text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-bold border-b border-zinc-800 bg-zinc-950/50">
          <div className="col-span-3">Version Identifier</div>
          <div className="col-span-1 text-center">Rank</div>
          <div className="col-span-1 text-center">Score</div>
          <div className="col-span-3">Public Feedback Evidence</div>
          <div className="col-span-2 text-center">Recommendation Tier</div>
          <div className="col-span-2 text-right">On-Site Pulse</div>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {loading && versions.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-500">
              Fetching public OpenClaw evidence...
            </div>
          ) : versions.length === 0 ? (
            <div className="flex min-h-[360px] items-center justify-center text-xs uppercase tracking-[0.2em] text-zinc-500">
              No public release evidence loaded yet.
            </div>
          ) : (() => {
            const maxRec: any = Object.values(votes).reduce((acc: number, curr: any) => Math.max(acc, curr?.recommend || 0), 0);
            const threshold = maxRec * 0.8 || 50;
            
            return (
              <AnimatePresence mode="popLayout">
                {versions.map((v, idx) => (
                  <motion.div 
                    key={v.version}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="contents" // Use contents to keep original layout flow if grid/flex requires it
                  >
                    <div 
                      onClick={() => setExpandedVersion(expandedVersion === v.version ? null : v.version)}
                      className={`grid grid-cols-12 gap-4 px-6 py-5 border-b border-zinc-800 items-center transition-all cursor-pointer hover:bg-white/[0.02]
                        ${v.isLatest ? 'bg-emerald-500/5' : ''} 
                        ${v.recommendationIndex < 50 ? 'bg-rose-500/[0.02]' : ''}`}
                    >
                      {/* ... column content ... */}
                      <div className="col-span-3 flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono text-base font-bold ${v.isLatest ? 'text-white' : 'text-zinc-400'}`}>{v.version}</span>
                          {v.isLatest && (
                            <span className="bg-emerald-500 text-black text-[9px] font-bold px-1.5 py-0.5 rounded-sm">LATEST</span>
                          )}
                        </div>
                        <span className="text-[9px] text-zinc-600 mt-1 uppercase tracking-tighter">Published {v.releaseDate}</span>
                      </div>

                      <div className="col-span-1 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-white font-mono text-xl">#{v.rank}</span>
                          <TrendIcon trend={v.rankTrend} />
                        </div>
                      </div>

                      <div className={`col-span-1 text-center font-mono text-lg ${v.score >= 75 ? 'text-emerald-400' : v.score < 55 ? 'text-rose-500' : 'text-amber-400'}`}>
                        {v.score.toFixed(2)}
                      </div>

                      <div className="col-span-3 flex flex-wrap items-start gap-1.5 overflow-visible py-0.5">
                        <span className="bg-blue-950/30 text-blue-300 text-[9px] leading-4 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {v.issueCount.toLocaleString()} GitHub issues/refs
                        </span>
                        <span className="bg-zinc-800 text-zinc-400 text-[9px] leading-4 px-1.5 py-0.5 rounded whitespace-nowrap">
                          {v.sampleCount} samples
                        </span>
                        {v.positiveKeywords.slice(0, 3).map(k => (
                          <span key={k} className="bg-zinc-800 text-zinc-400 text-[9px] leading-4 px-1.5 py-0.5 rounded whitespace-nowrap">{k}</span>
                        ))}
                        {v.errorKeywords.slice(0, 3).map(k => (
                          <span key={k} className="bg-rose-900/20 text-rose-500 text-[9px] leading-4 px-1.5 py-0.5 rounded whitespace-nowrap">{k}</span>
                        ))}
                      </div>

                      <div className="col-span-2 flex flex-col items-center gap-2 px-4 text-center">
                        {(() => {
                          const index = v.score;
                          let tier = { label: 'Disaster', color: 'text-rose-600', bg: 'bg-rose-600 shadow-[0_0_10px_rgba(225,29,72,0.4)]' };
                          
                          if (index >= 90) {
                            tier = { label: 'Strongly Recommended', color: 'text-emerald-400', bg: 'bg-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.5)]' };
                          } else if (index >= 80) {
                            tier = { label: 'Recommended', color: 'text-teal-400', bg: 'bg-teal-500/80 shadow-[0_0_10px_rgba(20,184,166,0.3)]' };
                          } else if (index >= 70) {
                            tier = { label: 'Neutral', color: 'text-zinc-500', bg: 'bg-zinc-600' };
                          } else if (index >= 40) {
                            tier = { label: 'Not Recommended', color: 'text-orange-500', bg: 'bg-orange-500/80' };
                          }

                          return (
                            <>
                              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                                <motion.div 
                                  initial={{ width: 0 }}
                                  animate={{ width: `${index}%` }}
                                  className={`h-full transition-all duration-1000 ${tier.bg}`} 
                                />
                              </div>
                              <span className={`text-[8px] font-black uppercase tracking-[0.15em] ${tier.color}`}>
                                {tier.label}
                              </span>
                            </>
                          );
                        })()}
                      </div>

                      <div className="col-span-2 flex justify-end gap-2 pr-2">
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleVote(v.version, 'recommend'); }}
                          className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all active:scale-90 border
                            ${(votes[v.version]?.recommend || 0) > threshold 
                              ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-[0_0_15px_-3px_rgba(16,185,129,0.3)]' 
                              : 'bg-zinc-800/50 text-zinc-500 border-transparent hover:bg-zinc-800'}`}
                        >
                          <ThumbsUp size={12} className={ (votes[v.version]?.recommend || 0) > threshold ? 'fill-emerald-400/20' : ''} />
                          <span className="font-mono font-bold leading-none">{votes[v.version]?.recommend || 0}</span>
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleVote(v.version, 'notRecommend'); }}
                          className={`text-xs px-2.5 py-1.5 rounded-lg flex items-center gap-2 transition-all active:scale-90 border
                            ${(votes[v.version]?.notRecommend || 0) > 50 ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' : 'bg-zinc-800/50 text-zinc-500 border-transparent hover:bg-zinc-800'}`}
                        >
                          <ThumbsDown size={12} className={ (votes[v.version]?.notRecommend || 0) > 50 ? 'fill-rose-400/20' : ''} />
                          <span className="font-mono font-bold leading-none">{votes[v.version]?.notRecommend || 0}</span>
                        </button>
                      </div>
                    </div>

                    {/* Expanded Details */}
                <AnimatePresence>
                  {expandedVersion === v.version && (
                    <motion.div 
                      key={`${v.version}-expanded`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden bg-zinc-950/40"
                    >
                      <div className="px-12 py-8 grid grid-cols-1 md:grid-cols-3 gap-12 border-b border-zinc-800">
                        <div className="space-y-4">
                          <h4 className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em]">Diagnostics</h4>
                          <Diag label="Gateway Reports" value={`${v.diagnostics.gatewayReports}`} />
                          <Diag label="Plugin Reports" value={`${v.diagnostics.pluginReports}`} />
                          <Diag label="Crash/Hang Reports" value={`${v.diagnostics.crashOrHangReports}`} highlight={v.diagnostics.crashOrHangReports === 0} />
                          <Diag label="Security Terms" value={`${v.diagnostics.securityReports}`} highlight={v.diagnostics.securityReports === 0} />
                          <Diag label="Open / Closed Issues" value={`${v.openIssueCount} / ${v.closedIssueCount}`} />
                          <p className="text-[10px] leading-relaxed text-zinc-600">
                            These counts come from public GitHub release text and version-matched GitHub issues. No private benchmark is inferred.
                          </p>
                        </div>
                        <div className="col-span-2 space-y-6">
                           <div className="grid grid-cols-2 gap-8">
                             <div>
                               <h5 className="text-[9px] text-zinc-500 font-bold uppercase mb-3 tracking-widest">Positive Release Signals</h5>
                               <div className="flex flex-wrap gap-1.5">
                                 {(v.positiveKeywords.length ? v.positiveKeywords : ['No matched positive terms']).map(k => (
                                   <span key={k} className="bg-zinc-800 text-zinc-300 text-[9px] px-2 py-1 rounded">{k}</span>
                                 ))}
                               </div>
                             </div>
                             <div>
                               <h5 className="text-[9px] text-zinc-500 font-bold uppercase mb-3 tracking-widest">Issue Risk Terms</h5>
                               <div className="flex flex-wrap gap-1.5">
                                 {(v.errorKeywords.length ? v.errorKeywords : ['No matched issue-risk terms']).map(k => (
                                   <span key={k} className="bg-rose-950/30 text-rose-500 text-[9px] px-2 py-1 rounded border border-rose-900/20">{k}</span>
                                 ))}
                               </div>
                             </div>
                           </div>
                           <div className="pt-6 border-t border-zinc-800 grid grid-cols-2 gap-8">
                              <div>
                                <h5 className="text-[9px] text-zinc-600 font-bold uppercase mb-2">Release Notes Evidence</h5>
                                {(v.upgradePros.length ? v.upgradePros : ['No public release-note bullet matched the selected headings.']).map(p => <div key={p} className="text-xs text-zinc-400 mb-1">• {p}</div>)}
                              </div>
                              <div>
                                <h5 className="text-[9px] text-zinc-600 font-bold uppercase mb-2">Version-Matched Issues</h5>
                                {(v.upgradeCons.length ? v.upgradeCons : ['No public GitHub issues explicitly matched this version in the current fetch.']).map(c => <div key={c} className="text-xs text-zinc-400 mb-1">• {c}</div>)}
                              </div>
                           </div>
                           <div className="pt-6 border-t border-zinc-800">
                             <h5 className="text-[9px] text-zinc-600 font-bold uppercase mb-3 tracking-widest">Source References</h5>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                               {v.sources.slice(0, 8).map(source => (
                                 <a
                                   key={`${v.version}-${source.url}-${source.label}`}
                                   href={source.url}
                                   target="_blank"
                                   rel="noreferrer"
                                   className="flex items-center gap-2 text-[11px] text-zinc-400 hover:text-emerald-300 transition-colors"
                                   onClick={(event) => event.stopPropagation()}
                                 >
                                   <ExternalLink size={12} />
                                   <span className="truncate">{source.label}</span>
                                 </a>
                               ))}
                             </div>
                             <p className="mt-4 text-[10px] text-zinc-600">{v.scoringBasis}</p>
                           </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        );
      })()}
    </div>
  </div>

      {/* Footer */}
      <footer className="mt-6 flex justify-between items-center text-[10px] text-zinc-600 tracking-[0.2em] uppercase font-bold">
        <div className="flex gap-6">
          <span>Ranking Rule: Evidence Score, Not Publish Date</span>
          <span>Sample Pool: {versions.length} Formal Releases</span>
        </div>
        <div className="flex gap-4">
          <div className="bg-zinc-900 px-4 py-1.5 rounded-full border border-zinc-800 flex items-center gap-2">
            Sources: <span className="text-blue-400 font-mono">GitHub + npm</span>
          </div>
          <div className="bg-zinc-900 px-4 py-1.5 rounded-full border border-zinc-800 flex items-center gap-2">
            Synthetic Metrics: <span className="text-emerald-500">Removed</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function StatCard({ label, value, color = "text-white", tail }: { label: string, value: string, color?: string, tail?: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 p-5 rounded-lg hover:border-zinc-700 transition-colors">
      <div className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mb-2">{label}</div>
      <div className={`text-3xl font-light ${color}`}>
        {value} {tail}
      </div>
    </div>
  );
}

function Diag({ label, value, highlight }: { label: string, value: string, highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center border-b border-zinc-900 pb-2">
      <span className="text-[10px] text-zinc-600 uppercase tracking-widest">{label}</span>
      <span className={`font-mono text-xs ${highlight ? 'text-emerald-400' : 'text-zinc-400'}`}>{value}</span>
    </div>
  );
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' | 'new' }) {
  if (trend === 'up') return <span className="text-emerald-500 text-xs">▲</span>;
  if (trend === 'down') return <span className="text-rose-500 text-xs">▼</span>;
  if (trend === 'new') return <span className="text-[8px] px-1 bg-blue-500/20 text-blue-400 rounded">NEW</span>;
  return <span className="text-zinc-600 text-xs">—</span>;
}
